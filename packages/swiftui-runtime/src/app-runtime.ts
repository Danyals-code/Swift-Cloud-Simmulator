import type { SourceSpan, UIEvent } from '@studio/shared'
import type { SourceFileNode, StructDecl, VarDecl } from '@studio/swift-syntax'
import {
  asProjection,
  bool,
  describe,
  double,
  ExecutionBudgetExceeded,
  int,
  Interpreter,
  str,
  SwiftTrap,
  UnsupportedAtRuntime,
  type ClosureValue,
  type StructValue,
  type SwiftValue,
} from '@studio/swift-runtime'
import type { SemanticModel } from '@studio/swift-sema'
import { fingerprint, IdentityPath, StateStore } from './identity'
import { resolveUI, UIState, type ResolvedUI } from './presentation'
import { SwiftUIHost } from './swiftui-host'
import { asView, handlerIdFor, type AnimationPayload, type ViewIntent, type ViewValue } from './view-value'

export interface RuntimeFailure {
  readonly message: string
  readonly span: SourceSpan
  readonly frames: readonly string[]
  readonly kind: 'trap' | 'budget' | 'unsupported'
}

export interface EvaluationResult {
  readonly views: readonly ViewValue[]
  /** The composed screen: navigation, tabs and presentation applied. */
  readonly ui: ResolvedUI | null
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
 *
 * Phase 6 adds a second kind of state beside `@State`: what the *framework* holds —
 * which screen a navigation stack is showing, which tab is selected. It lives in
 * `UIState` rather than in the interpreter, because the user's code never declared
 * it and nothing in their source can be asked what it should be.
 */
export class AppRuntime {
  private interpreter = new Interpreter()
  private host = new SwiftUIHost()
  private readonly state = new StateStore()
  private readonly ui = new UIState()

  private entryTypeName: string | null = null
  private rootTypeName: string | null = null
  private identity = new IdentityPath()

  /** Instances built during the last pass, so an action's writes can be harvested. */
  private live = new Map<string, StructValue>()
  /** What each interactive element does, from the last resolved screen. */
  private handlers: ReadonlyMap<string, ViewIntent> = new Map()
  /** Identifies the loaded program, so a real edit reloads and a tap does not. */
  private programKey = ''
  /** Set when the change being rendered happened inside `withAnimation`. */
  private animation: AnimationPayload | null = null

  load(files: readonly SourceFileNode[], model: SemanticModel, programKey: string): void {
    if (programKey === this.programKey && this.entryTypeName) return

    this.interpreter = new Interpreter({ host: this.host })
    this.host.expandStruct = (value) => this.expand(value)
    this.host.scopeIdentity = (key, fn) => this.identity.scope(key, fn)
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
   * root from the AST. The resolver then decides what of it is actually on screen.
   */
  evaluate(): EvaluationResult {
    this.live.clear()
    this.handlers = new Map()
    this.identity = new IdentityPath()
    this.interpreter.resetSteps()
    this.state.beginPass()

    const entry = this.entryTypeName ? this.interpreter.types.get(this.entryTypeName) : undefined
    if (!entry) {
      this.state.endPass()
      return { views: [], ui: null, logs: this.host.takeLogs(), failure: null, rootTypeName: null }
    }

    try {
      const app = this.interpreter.instantiate(entry.name, [], entry.span)
      const scenes = this.expand(app)
      // The scene wrapper is not content; the app is what it contains.
      const views = scenes.flatMap((scene) => (isSceneWrapper(scene) ? scene.children : [scene]))

      const ui = resolveUI(views, {
        state: this.ui,
        build: (closure, args) => this.buildViews(closure, args),
        animation: this.animation,
      })
      this.handlers = ui.handlers
      this.state.endPass()

      return { views, ui, logs: this.host.takeLogs(), failure: null, rootTypeName: this.rootTypeName }
    } catch (error) {
      this.state.endPass()
      return {
        views: [],
        ui: null,
        logs: this.host.takeLogs(),
        failure: toFailure(error),
        rootTypeName: this.rootTypeName,
      }
    }
  }

  /**
   * Applies an interaction, then writes back any `@State` it changed.
   *
   * Returns false when nothing matched, so the caller can skip a re-render entirely
   * rather than repainting an unchanged screen.
   */
  dispatch(incoming: UIEvent | string): boolean {
    // A bare handler id is taken as a tap, which is what every caller that does not
    // carry a value means by it.
    const event: UIEvent =
      typeof incoming === 'string'
        ? { kind: 'tap', handlerId: incoming, location: { x: 0, y: 0 } }
        : incoming

    const intent = this.handlers.get(event.handlerId)
    if (!intent) return false

    this.interpreter.resetSteps()
    this.animation = null
    this.host.pendingAnimation = null

    try {
      this.perform(intent, event)
    } catch (error) {
      // A trap inside an action is surfaced as a log rather than thrown, so one bad
      // tap cannot tear down the preview.
      this.host.log(`Action failed: ${toFailure(error).message}`, spanOf(intent))
    }

    this.animation = this.host.pendingAnimation
    this.host.pendingAnimation = null
    this.harvest()
    return true
  }

  /** Drops every state box, framework state included. */
  reset(): void {
    this.state.clear()
    this.ui.clear()
    this.animation = null
  }

  get stateSnapshot(): ReadonlyMap<string, { value: SwiftValue }> {
    return this.state.snapshot()
  }

  // ------------------------------------------------------------------ private

  private perform(intent: ViewIntent, event: UIEvent): void {
    switch (intent.kind) {
      case 'run':
        this.interpreter.callClosure(intent.closure, [], intent.closure.span)
        return

      case 'push': {
        const [stack, link] = splitLink(intent.link)
        this.ui.push(stack, link)
        return
      }

      case 'pop':
        for (const stack of this.navigationStacksFor(event.handlerId)) this.ui.pop(stack)
        return

      case 'selectTab':
        this.ui.selectTab(intent.tab, intent.index)
        return

      case 'toggle': {
        const binding = asProjection(intent.binding)
        if (!binding) return
        const current = binding.get()
        // A typed event wins over flipping, so dragging a switch to a known position
        // lands there rather than inverting whatever it was.
        binding.set(event.kind === 'toggle' ? bool(event.value) : bool(!truthyValue(current)))
        return
      }

      case 'write': {
        const binding = asProjection(intent.binding)
        if (!binding) return
        binding.set(valueForEvent(intent.value, event))
        return
      }

      case 'adjust': {
        const binding = asProjection(intent.binding)
        if (!binding) return
        const current = binding.get()
        const base = current.kind === 'int' || current.kind === 'double' ? current.value : 0
        const next = base + intent.by
        binding.set(current.kind === 'int' ? int(Math.round(next)) : double(next))
        return
      }
    }
  }

  /** The stack ids a back button belongs to — derived from its own handler path. */
  private navigationStacksFor(handlerId: string): string[] {
    const path = handlerId.replace(/^action-/, '')
    const stack = path.replace(/\/back$/, '')
    return stack === path ? [] : [stack]
  }

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

  /**
   * Runs a deferred view builder — a sheet's content, a toolbar, a destination.
   *
   * These closures are held unevaluated by the resolver and run only if the screen
   * they belong to is actually shown, which is both faster and, more importantly,
   * correct: a sheet body that force-unwraps its selection must not run while there
   * is no selection.
   */
  private buildViews(closure: ClosureValue, args: readonly SwiftValue[] = []): readonly ViewValue[] {
    const produced = this.interpreter.runViewBuilder(closure, args)
    return produced.flatMap((value) => {
      const view = asView(value)
      if (view) return [view]
      return value.kind === 'struct' ? this.expand(value) : []
    })
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

function splitLink(link: string): [string, string] {
  const index = link.indexOf('|')
  return index === -1 ? ['nav', link] : [link.slice(0, index), link.slice(index + 1)]
}

function truthyValue(value: SwiftValue): boolean {
  return value.kind === 'bool' ? value.value : value.kind !== 'nil' && value.kind !== 'void'
}

/**
 * The value an intent writes.
 *
 * A typed event carries one — a text field's new string, a slider's new number — and
 * it takes precedence over the intent's own constant, which is what a tap-only
 * control (a dismiss button, a tab) supplies instead.
 */
function valueForEvent(fallback: SwiftValue, event: UIEvent): SwiftValue {
  switch (event.kind) {
    case 'textChange':
      return str(event.value)
    case 'slide':
      return fallback.kind === 'int' ? int(Math.round(event.value)) : double(event.value)
    case 'toggle':
      return bool(event.value)
    default:
      return fallback
  }
}

function spanOf(intent: ViewIntent): SourceSpan {
  return intent.kind === 'run' ? intent.closure.span : { file: '', start: 0, end: 0 }
}

/** Handler id for the view at a given tree path. */
export function actionId(path: string): string {
  return handlerIdFor(path)
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

export { describe }
