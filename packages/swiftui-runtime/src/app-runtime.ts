import type { SourceSpan } from '@studio/shared'
import type { SourceFileNode, StructDecl, VarDecl } from '@studio/swift-syntax'
import {
  ExecutionBudgetExceeded,
  Interpreter,
  SwiftTrap,
  UnsupportedAtRuntime,
  type StructValue,
  type SwiftValue,
} from '@studio/swift-runtime'
import type { SemanticModel } from '@studio/swift-sema'
import { fingerprint, IdentityPath, StateStore } from './identity'
import { SwiftUIHost } from './swiftui-host'
import { asView, type ViewValue } from './view-value'

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
 * Owns one running app.
 *
 * View structs are disposable here, exactly as in SwiftUI: every pass rebuilds them
 * from their initialisers, and `@State` is restored from identity-keyed boxes that
 * outlive them (see `identity.ts`). That is what makes a counter survive both a
 * re-render and an edit (FR-5.3), without the single-root-instance shortcut Phase 2
 * used.
 */
export class AppRuntime {
  private interpreter = new Interpreter()
  private host = new SwiftUIHost()
  private readonly state = new StateStore()

  private entryTypeName: string | null = null
  private rootTypeName: string | null = null
  private identity = new IdentityPath()

  /** Instances built during the last pass, so an action's writes can be harvested. */
  private live = new Map<string, StructValue>()
  /** Action closures from the last pass, addressed by handler id. */
  private actions = new Map<string, SwiftValue>()
  /** Identifies the loaded program, so a real edit reloads and a tap does not. */
  private programKey = ''

  load(files: readonly SourceFileNode[], model: SemanticModel, programKey: string): void {
    if (programKey === this.programKey && this.entryTypeName) return

    this.interpreter = new Interpreter({ host: this.host })
    this.host.expandStruct = (value) => this.expand(value)
    this.interpreter.load(files)

    this.entryTypeName = model.entryPoint?.name ?? null
    this.rootTypeName = null
    this.programKey = programKey

    // State boxes deliberately survive a reload. Whether each individual value
    // survives is decided per-property by its initialiser fingerprint.
  }

  /**
   * Builds the view tree for this frame.
   *
   * Starts from the `@main` type and evaluates its scene, so `WindowGroup` and the
   * root view are produced by running the user's code rather than by inferring the
   * root from the AST.
   */
  evaluate(): EvaluationResult {
    this.actions.clear()
    this.live.clear()
    this.identity = new IdentityPath()
    this.interpreter.resetSteps()
    this.state.beginPass()

    const entry = this.entryTypeName ? this.interpreter.types.get(this.entryTypeName) : undefined
    if (!entry) {
      this.state.endPass()
      return { views: [], logs: this.host.takeLogs(), failure: null, rootTypeName: null }
    }

    try {
      const app = this.interpreter.instantiate(entry.name, [], entry.span)
      const scenes = this.expand(app)
      // The scene wrapper is not content; the app is what it contains.
      const views = scenes.flatMap((scene) => (isSceneWrapper(scene) ? scene.children : [scene]))

      this.indexActions(views)
      this.state.endPass()

      return {
        views,
        logs: this.host.takeLogs(),
        failure: null,
        rootTypeName: this.rootTypeName,
      }
    } catch (error) {
      this.state.endPass()
      return {
        views: [],
        logs: this.host.takeLogs(),
        failure: toFailure(error),
        rootTypeName: this.rootTypeName,
      }
    }
  }

  /** Runs a button's action, then writes any `@State` it changed back to its box. */
  dispatch(handlerId: string): boolean {
    const action = this.actions.get(handlerId)
    if (!action || action.kind !== 'closure') return false

    this.interpreter.resetSteps()
    try {
      this.interpreter.callClosure(action, [], action.span)
    } catch (error) {
      // A trap inside an action is surfaced as a log rather than thrown, so one bad
      // tap cannot tear down the preview.
      this.host.log(`Action failed: ${toFailure(error).message}`, action.span)
    }

    this.harvest()
    return true
  }

  /** Drops every state box. The next pass rebuilds from the declared initialisers. */
  reset(): void {
    this.state.clear()
  }

  get stateSnapshot(): ReadonlyMap<string, { value: SwiftValue }> {
    return this.state.snapshot()
  }

  // ------------------------------------------------------------------ private

  /**
   * Expands a user `View` struct into the views its `body` produces.
   *
   * Seeding runs *before* the body is evaluated: the instance's `@State` fields are
   * replaced with their stored values, so the body sees current state rather than
   * whatever its initialisers just produced.
   */
  private expand(instance: SwiftValue): ViewValue[] {
    if (instance.kind !== 'struct') return []

    const decl = this.interpreter.types.get(instance.typeName)
    if (!decl) return []

    const identity = this.identity.push(instance.typeName)
    try {
      this.seedState(instance, decl, identity)
      this.live.set(identity, instance)

      if (this.rootTypeName === null && decl.inherits.some((t) => t.name === 'View')) {
        this.rootTypeName = instance.typeName
      }

      const body = decl.members.find(
        (m): m is VarDecl => m.kind === 'varDecl' && m.name === 'body' && m.accessor !== null,
      )
      if (!body?.accessor) return []

      const env = this.interpreter.globals.child(instance)
      const produced = this.interpreter.runViewBuilderBlock(body.accessor, env)

      return produced.flatMap((value) => {
        const view = asView(value)
        if (view) return [view]
        return value.kind === 'struct' ? this.expand(value) : []
      })
    } finally {
      this.identity.pop()
    }
  }

  private seedState(instance: StructValue, decl: StructDecl, identity: string): void {
    for (const property of statefulProperties(decl)) {
      const initial = instance.fields.get(property.name)
      if (initial === undefined) continue

      const stored = this.state.resolve(
        identity,
        property.name,
        initial,
        fingerprint(property.initializer),
      )
      instance.fields.set(property.name, stored)
    }
  }

  /** Copies `@State` values out of the live instances and back into their boxes. */
  private harvest(): void {
    for (const [identity, instance] of this.live) {
      const decl = this.interpreter.types.get(instance.typeName)
      if (!decl) continue

      for (const property of statefulProperties(decl)) {
        const value = instance.fields.get(property.name)
        if (value === undefined) continue
        this.state.store(identity, property.name, value, fingerprint(property.initializer))
      }
    }
  }

  private indexActions(views: readonly ViewValue[], prefix = 'v'): void {
    views.forEach((view, index) => {
      const path = `${prefix}-${index}`
      if (view.action) this.actions.set(`action-${path}`, view.action)
      this.indexActions(view.children, path)
    })
  }
}

function statefulProperties(decl: StructDecl): VarDecl[] {
  return decl.members.filter(
    (m): m is VarDecl =>
      m.kind === 'varDecl' && m.attributes.some((a) => a.name === 'State'),
  )
}

/** `WindowGroup` holds the app's content; it is a scene, not a view. */
function isSceneWrapper(view: ViewValue): boolean {
  return view.name === 'WindowGroup' && view.modifiers.length === 0
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
