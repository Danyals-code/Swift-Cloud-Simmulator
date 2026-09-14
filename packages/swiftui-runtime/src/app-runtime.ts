import type { SourceSpan } from '@studio/shared'
import type { SourceFileNode, VarDecl } from '@studio/swift-syntax'
import {
  ExecutionBudgetExceeded,
  Interpreter,
  SwiftTrap,
  UnsupportedAtRuntime,
  type StructValue,
  type SwiftValue,
} from '@studio/swift-runtime'
import type { SemanticModel } from '@studio/swift-sema'
import { SwiftUIHost } from './swiftui-host'
import { asView, flattenViews, type ViewValue } from './view-value'

export interface RuntimeFailure {
  readonly message: string
  readonly span: SourceSpan
  readonly frames: readonly string[]
  readonly kind: 'trap' | 'budget' | 'unsupported'
}

export interface EvaluationResult {
  readonly views: readonly ViewValue[]
  readonly logs: readonly { message: string; span: SourceSpan }[]
  readonly failure: RuntimeFailure | null
  readonly rootTypeName: string | null
}

/**
 * Owns one running app: its interpreter, its root view instance, and its state.
 *
 * The reason this exists rather than the pipeline evaluating statelessly is `@State`.
 * A preview that resets every counter on each keystroke is not a preview, it is a
 * screenshot — so state has to outlive both re-renders and edits (FR-5.3).
 *
 * Phase 3 replaces the single root instance here with identity-keyed state boxes, at
 * which point state survives per-view rather than per-app. The carry-over rule below
 * is the crude ancestor of that.
 */
export class AppRuntime {
  private interpreter = new Interpreter()
  private host = new SwiftUIHost()
  private root: StructValue | null = null
  private rootTypeName: string | null = null
  /** Action closures from the last evaluation, addressed by handler id. */
  private actions = new Map<string, SwiftValue>()
  /** Identifies the loaded program, so a real edit rebuilds and a tap does not. */
  private programKey = ''

  /**
   * Loads a program, preserving `@State` across edits where it still makes sense.
   *
   * A value is carried over when the property still exists *and its initialiser is
   * unchanged*. Both halves of that rule follow from what the edit means:
   *
   *   change a colour            counter survives — you are not editing the counter
   *   change `= 0` to `= 10`     counter resets   — you edited it precisely to see 10
   *   rename or delete it        nothing to carry
   *
   * Matching on name alone would keep showing `0` after the user changed the
   * initialiser to `10`, which reads as the preview being stuck.
   */
  load(files: readonly SourceFileNode[], model: SemanticModel, programKey: string): void {
    if (programKey === this.programKey && this.root) return

    const carried = this.root ? this.statefulFields(this.root) : new Map<string, CarriedState>()

    this.interpreter = new Interpreter({ host: this.host })
    this.host.expandStruct = (value) => this.expand(value)
    this.interpreter.load(files)

    this.rootTypeName = this.findRootViewType(model)
    this.root = null
    this.programKey = programKey

    if (!this.rootTypeName) return

    const decl = this.interpreter.types.get(this.rootTypeName)
    if (!decl) return

    const instance = this.interpreter.instantiate(this.rootTypeName, [], decl.span)
    for (const [name, previous] of carried) {
      if (!instance.fields.has(name)) continue
      const current = decl.members.find(
        (m): m is VarDecl => m.kind === 'varDecl' && m.name === name,
      )
      if (fingerprint(current?.initializer ?? null) !== previous.initializer) continue
      instance.fields.set(name, previous.value)
    }
    this.root = instance
  }

  /** Evaluates the root view's body into a view tree. */
  evaluate(): EvaluationResult {
    this.actions.clear()
    this.interpreter.resetSteps()

    if (!this.root) {
      return { views: [], logs: this.host.takeLogs(), failure: null, rootTypeName: this.rootTypeName }
    }

    try {
      const views = this.expand(this.root)
      this.indexActions(views)
      return { views, logs: this.host.takeLogs(), failure: null, rootTypeName: this.rootTypeName }
    } catch (error) {
      return {
        views: [],
        logs: this.host.takeLogs(),
        failure: toFailure(error),
        rootTypeName: this.rootTypeName,
      }
    }
  }

  /** Runs a button's action. Returns false when the id is unknown. */
  dispatch(handlerId: string): boolean {
    const action = this.actions.get(handlerId)
    if (!action || action.kind !== 'closure') return false

    this.interpreter.resetSteps()
    try {
      this.interpreter.callClosure(action, [], action.span)
    } catch (error) {
      // A trap inside an action is reported on the next evaluation rather than
      // thrown here, so one bad tap cannot tear down the preview.
      this.host.log(`Action failed: ${toFailure(error).message}`, action.span)
    }
    return true
  }

  /** Drops all state and rebuilds the root instance from its declared initialisers. */
  reset(): void {
    if (!this.rootTypeName) return
    const decl = this.interpreter.types.get(this.rootTypeName)
    if (!decl) return
    this.root = this.interpreter.instantiate(this.rootTypeName, [], decl.span)
  }

  // ------------------------------------------------------------------ private

  /**
   * Expands a user `View` struct into the views its `body` produces.
   *
   * Uses the result-builder path rather than plain evaluation, so a multi-statement
   * body contributes every view rather than only its last.
   */
  private expand(value: SwiftValue): ViewValue[] {
    if (value.kind !== 'struct') return []

    const decl = this.interpreter.types.get(value.typeName)
    const body = decl?.members.find(
      (m): m is VarDecl => m.kind === 'varDecl' && m.name === 'body' && m.accessor !== null,
    )
    if (!body?.accessor) return []

    const env = this.interpreter.globals.child(value)
    const produced = this.interpreter.runViewBuilderBlock(body.accessor, env)

    return produced.flatMap((v) => {
      const view = asView(v)
      if (view) return [view]
      return v.kind === 'struct' ? this.expand(v) : []
    })
  }

  /** The root view is what the entry point's `WindowGroup` contains. */
  private findRootViewType(model: SemanticModel): string | null {
    const entry = model.entryPoint
    if (entry) {
      // Evaluating the scene would work, but reading it from the model avoids
      // constructing the root view twice on every load.
      const sceneBody = entry.properties.find((p) => p.name === 'body')
      const inner = sceneBody?.decl.accessor
      if (inner) {
        for (const name of collectCalledTypeNames(inner)) {
          if (model.types.get(name)?.isView) return name
        }
      }
    }
    return [...model.types.values()].find((t) => t.isView)?.name ?? null
  }

  private statefulFields(instance: StructValue): Map<string, CarriedState> {
    const decl = this.interpreter.types.get(instance.typeName)
    const out = new Map<string, CarriedState>()
    if (!decl) return out

    for (const member of decl.members) {
      if (member.kind !== 'varDecl') continue
      if (!member.attributes.some((a) => a.name === 'State')) continue
      const value = instance.fields.get(member.name)
      if (value === undefined) continue
      out.set(member.name, { value, initializer: fingerprint(member.initializer) })
    }
    return out
  }

  private indexActions(views: readonly ViewValue[]): void {
    for (const { view, path } of flattenViews(views)) {
      if (view.action) this.actions.set(actionId(path), view.action)
    }
  }
}

interface CarriedState {
  readonly value: SwiftValue
  /** Structure of the declared initialiser, so an edit to it can be detected. */
  readonly initializer: string
}

/**
 * A span-free structural summary of an expression.
 *
 * Spans shift whenever anything above a declaration changes, so comparing them would
 * report every edit as an initialiser change. Comparing structure and literal values
 * detects the edit that actually matters.
 */
function fingerprint(node: unknown): string {
  if (node === null || node === undefined) return 'nil'
  if (typeof node !== 'object') return String(node)
  if (Array.isArray(node)) return `[${node.map(fingerprint).join(',')}]`

  const entries = Object.entries(node as Record<string, unknown>)
    .filter(([key]) => key !== 'span' && key !== 'memberSpan' && key !== 'nameSpan' && key !== 'labelSpan')
    .map(([key, value]) => `${key}=${fingerprint(value)}`)
  return `{${entries.join(',')}}`
}

/** Handler id for the view at a given tree path. */
export function actionId(path: string): string {
  return `action-${path}`
}

function toFailure(error: unknown): RuntimeFailure {
  if (error instanceof SwiftTrap) {
    return {
      message: `Swift runtime failure: ${error.reason}`,
      span: error.span,
      frames: error.frames.map((f) => f.name),
      kind: 'trap',
    }
  }
  if (error instanceof ExecutionBudgetExceeded) {
    return {
      message: error.message,
      span: error.span,
      frames: error.frames.map((f) => f.name),
      kind: 'budget',
    }
  }
  if (error instanceof UnsupportedAtRuntime) {
    return { message: error.message, span: error.span, frames: [], kind: 'unsupported' }
  }
  throw error
}

/** Type names that appear as calls inside a block — how `WindowGroup { ContentView() }` names its root. */
function collectCalledTypeNames(block: { statements: readonly unknown[] }): string[] {
  const names: string[] = []
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const candidate = node as { kind?: string; callee?: unknown; name?: string }
    if (candidate.kind === 'call') {
      const callee = candidate.callee as { kind?: string; name?: string } | undefined
      if (callee?.kind === 'identifier' && callee.name) names.push(callee.name)
    }
    for (const value of Object.values(node as Record<string, unknown>)) {
      if (Array.isArray(value)) value.forEach(visit)
      else visit(value)
    }
  }
  visit(block)
  return names
}
