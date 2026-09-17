import type { LogLevel, Size, SourceSpan, UIEvent } from '@studio/shared'
import type { Block, Decl, FuncDecl, SourceFileNode, StructDecl, VarDecl } from '@studio/swift-syntax'
import {
  asKeyPath,
  asProjection,
  bool,
  copyValue,
  PreviewLimitExceeded,
  describe,
  double,
  ExecutionBudgetExceeded,
  int,
  Interpreter,
  indexSet,
  opaque,
  str,
  SwiftThrow,
  SwiftTrap,
  UnsupportedAtRuntime,
  valuesEqual,
  type ClosureValue,
  type HostCall,
  type StructValue,
  type SwiftValue,
} from '@studio/swift-runtime'
import type { SemanticModel } from '@studio/swift-sema'
import { fingerprint, IdentityPath, StateStore } from './identity'
import { resolveUI, UIState, type LifecycleHook, type ResolvedUI } from './presentation'
import { DEFAULT_ENVIRONMENT, type EnvironmentInputs } from './view-environment'
import {
  asGesture,
  flattenGesture,
  gestureValue,
  kindOfEvent,
  phaseOfEvent,
} from './gestures'
import { SwiftUIHost } from './swiftui-host'
import {
  asSwiftValue,
  asView,
  BUTTON_CONFIGURATION_TYPE,
  DIMENSIONS_TYPE,
  handlerIdFor,
  type AnimationPayload,
  type EnvironmentFrame,
  type ViewIntent,
  type ViewValue,
} from './view-value'

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
  readonly logs: readonly { message: string; span: SourceSpan; level: LogLevel }[]
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
 * Phase 6 adds a second kind of state beside `@State`: what the *framework* holds -
 * which screen a navigation stack is showing, which tab is selected. It lives in
 * `UIState` rather than in the interpreter, because the user's code never declared
 * it and nothing in their source can be asked what it should be.
 */
export class AppRuntime {
  private interpreter = new Interpreter()
  private host = new SwiftUIHost()
  private readonly state = new StateStore()
  /**
   * `@AppStorage` and `@SceneStorage`, keyed by the string they name.
   *
   * Not a `StateStore`: those boxes are pruned when the view that owned them leaves
   * the tree, and the point of this storage is that it does not go away with the view.
   */
  private readonly defaults = new Map<string, { value: SwiftValue; initializer: string }>()
  /** What each view was handed for a stored property, so harvest can tell a write from a copy. */
  private readonly seeded = new Map<string, SwiftValue>()
  private readonly ui = new UIState()

  private entryTypeName: string | null = null
  /** `#Preview { … }`'s body, used as the root when nothing is marked `@main`. */
  private previewBody: Block | null = null
  private rootTypeName: string | null = null
  private identity = new IdentityPath()

  /** Instances built during the last pass, so an action's writes can be harvested. */
  private live = new Map<string, StructValue>()
  /**
   * The pass before that.
   *
   * Only `.onDisappear` needs it, and it needs it for a specific reason: the closure
   * is remembered from the pass that still had the view, so it writes into *that*
   * pass's instance. Harvesting only the current one would drop the write silently.
   */
  private previousLive = new Map<string, StructValue>()
  /** What each interactive element does, from the last resolved screen. */
  private handlers: ReadonlyMap<string, ViewIntent> = new Map()
  /** Identifies the loaded program, so a real edit reloads and a tap does not. */
  private programKey = ''

  /**
   * A failure raised while loading, held over until the next `evaluate`.
   *
   * Top-level `let`/`var` initialisers run during the load, so `let first = items[0]`
   * on an empty array traps there rather than inside the render pass. Letting that
   * throw out of `load` takes the whole compile with it: the worker rejects, the
   * studio reports that the compiler stopped, and the line that actually failed is
   * never marked. Holding it makes it an ordinary runtime failure with a span.
   */
  private loadFailure: RuntimeFailure | null = null

  /** How many custom views deep the current expansion is. See `expand`. */
  private expandDepth = 0
  /** Set when the change being rendered happened inside `withAnimation`. */
  private animation: AnimationPayload | null = null

  /** Device and preview state the SwiftUI environment exposes to user code. */
  private environmentInputs: EnvironmentInputs = DEFAULT_ENVIRONMENT

  /** Sizes each `GeometryReader` was measured at, from the last layout pass. */
  private geometry = new Map<string, { width: number; height: number }>()

  /** Paths whose `.onAppear` has already run, so it does not run every pass. */
  private appeared = new Set<string>()
  /** Values `.onChange(of:)` is watching, as of the last pass. */
  private watched = new Map<string, SwiftValue>()
  /** `.onDisappear` closures, kept from the pass that last saw each view. */
  private disappearing = new Map<string, ClosureValue>()


  /**
   * Records what the layout pass actually measured, and says whether it moved.
   *
   * A true answer means the sizes a `GeometryReader` reported to its closure were
   * wrong, so the caller runs one more pass with the corrected ones. Two passes are
   * enough because a reader is greedy: its size is whatever it was proposed, and the
   * proposal does not depend on what its closure produced. The half-point tolerance
   * stops sub-pixel jitter from looping forever.
   */
  updateGeometry(measured: ReadonlyMap<string, { width: number; height: number }>): boolean {
    let changed = false

    for (const [key, size] of measured) {
      const previous = this.geometry.get(key)
      if (
        !previous ||
        Math.abs(previous.width - size.width) > 0.5 ||
        Math.abs(previous.height - size.height) > 0.5
      ) {
        changed = true
      }
      this.geometry.set(key, size)
    }

    this.host.geometry = this.geometry
    return changed
  }

  /** The size a reader reports before anything has been laid out. */
  setDefaultGeometry(size: { width: number; height: number }): void {
    this.host.defaultGeometry = size
  }

  /**
   * Tells the runtime what the device looks like this frame.
   *
   * Separate from `load` because it changes without the program changing - flipping
   * to dark mode must not reload the interpreter and discard every `@State`.
   */
  setEnvironment(inputs: EnvironmentInputs): void {
    this.environmentInputs = inputs
  }

  load(files: readonly SourceFileNode[], model: SemanticModel, programKey: string): void {
    if (programKey === this.programKey && this.entryTypeName) return

    this.interpreter = new Interpreter({ host: this.host })
    this.host.expandStruct = (value) => this.expand(value)
    this.host.scopeIdentity = (key, fn) => this.identity.scope(key, fn)
    this.host.callMethod = (receiver, name, args) => this.callMethod(receiver, name, args)
    this.host.conformsTo = (typeName, protocolName) =>
      this.interpreter.conformsTo(typeName, protocolName)
    this.host.declaresType = (typeName) => this.interpreter.declaresType(typeName)
    this.host.callViewExtension = (name, receiver, call) => this.callViewExtension(name, receiver, call)

    this.loadFailure = null
    this.host.beginPass()
    try {
      this.interpreter.load(files)
    } catch (error) {
      this.loadFailure = toFailure(error)
    }

    this.entryTypeName = model.entryPoint?.name ?? null
    // A file with a view and a `#Preview` and no `@main` is an ordinary thing to
    // paste in, and it is what Xcode itself renders. Falling back to the preview's
    // body is the difference between that file showing something and reporting that
    // the project has no entry point.
    this.previewBody = this.entryTypeName ? null : findPreviewBody(files)
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
    if (this.loadFailure) {
      return {
        views: [],
        ui: null,
        logs: this.host.takeLogs(),
        failure: this.loadFailure,
        rootTypeName: null,
      }
    }

    this.previousLive = this.live
    this.live = new Map()
    this.handlers = new Map()
    this.identity = new IdentityPath()
    this.interpreter.resetSteps()
    this.host.environment.reset(this.environmentInputs)
    this.host.beginPass()
    this.state.beginPass()

    const entry = this.entryTypeName ? this.interpreter.types.get(this.entryTypeName) : undefined
    if (!entry && !this.previewBody) {
      this.state.endPass()
      return { views: [], ui: null, logs: this.host.takeLogs(), failure: null, rootTypeName: null }
    }

    try {
      const produced = entry
        ? this.expand(this.interpreter.instantiate(entry.name, [], entry.span))
        : this.runPreviewBody(this.previewBody!)

      // The scene wrapper is not content; the app is what it contains.
      const views = produced.flatMap((scene) => (isSceneWrapper(scene) ? scene.children : [scene]))

      const ui = resolveUI(views, {
        state: this.ui,
        build: (closure, args, environment) => this.buildViews(closure, args, environment),
        styleButton: (style, label, isPressed) => this.styleButton(style, label, isPressed),
        animation: this.animation,
      })
      this.handlers = ui.handlers
      // `@Environment(\.dismiss)` is callable at any depth, so it has to resolve to
      // whatever is presented *now* rather than to whatever was when it was read.
      let presented = ui.overlay
      while (presented?.screen?.overlay) presented = presented.screen.overlay
      const dismiss = presented?.dismiss ?? null
      this.host.dismissAction = dismiss
        ? () => {
            this.perform(dismiss, { kind: 'tap', handlerId: '', location: { x: 0, y: 0 } })
          }
        : null
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

    // Any press made while a menu is up closes it, which is what the real one does:
    // while it is open it is the only thing on screen that can be pressed, so the
    // press is either a choice, one of its buttons, or the dim layer dismissing it.
    // Recorded before the intent runs, so an intent that opens a *different* menu
    // still leaves its own open.
    const wasOpen = this.ui.openMenu()

    try {
      this.perform(intent, event)
      // `stepMonth` is the exception: paging a calendar is a press *within* the
      // editor rather than a choice made from it, and closing on it would make the
      // arrows unusable - one press forward, and the picker is gone.
      if (
        wasOpen !== null &&
        this.ui.openMenu() === wasOpen &&
        intent.kind !== 'openMenu' &&
        intent.kind !== 'stepMonth'
      ) {
        this.ui.setOpenMenu(null)
      }
    } catch (error) {
      // A trap inside an action is surfaced as a log rather than thrown, so one bad
      // tap cannot tear down the preview.
      this.host.log(`Action failed: ${toFailure(error).message}`, spanOf(intent), 'error')
    }

    this.animation = this.host.pendingAnimation
    this.host.pendingAnimation = null
    this.harvest()
    return true
  }

  /**
   * Runs an `.alignmentGuide` closure with a view's measured dimensions.
   *
   * Handed to the layout pass, which is the only stage that knows the size and the
   * only one that cannot run Swift. A closure that traps answers with the default
   * guide rather than taking the preview down: the guide is a number, and a wrong
   * number misplaces one view where an exception blanks the screen.
   */
  guideRunner(): (closure: ClosureValue, size: Size) => number {
    return (closure, size) => {
      const dimensions = opaque(DIMENSIONS_TYPE, { width: size.width, height: size.height })
      try {
        const result = this.interpreter.callClosure(closure, [dimensions], closure.span)
        return result.kind === 'int' || result.kind === 'double' ? result.value : 0
      } catch (error) {
        this.host.log(`Alignment guide failed: ${toFailure(error).message}`, closure.span, 'error')
        return 0
      }
    }
  }

  /** Drops every state box, framework state included. */
  reset(): void {
    this.state.clear()
    this.defaults.clear()
    this.seeded.clear()
    this.ui.clear()
    this.geometry.clear()
    this.host.geometry = this.geometry
    this.appeared.clear()
    this.watched.clear()
    this.disappearing.clear()
    this.animation = null
  }

  /**
   * Runs the lifecycle callbacks a pass turned up, and says whether anything changed.
   *
   * A true answer means the caller should evaluate again: `.onAppear` very often sets
   * the state the view is about to draw from, and rendering the pass that discovered
   * it would show the screen as it was one instant before the app started.
   *
   * A callback runs at most once per appearance, tracked by path - so a re-render
   * does not re-fire it, and a view that leaves the tree and comes back does fire
   * again, which is what SwiftUI does too.
   */
  runLifecycle(hooks: readonly LifecycleHook[]): boolean {
    const seen = new Set<string>()
    let ran = false
    let ranDisappear = false

    for (const hook of hooks) {
      if (hook.kind === 'appear') {
        seen.add(hook.path)
        if (this.appeared.has(hook.path)) continue
        this.appeared.add(hook.path)
        this.invokeHook(hook.closure, [])
        ran = true
        continue
      }

      if (hook.kind === 'change' && hook.watched !== undefined) {
        seen.add(hook.path)
        const previous = this.watched.get(hook.path)
        this.watched.set(hook.path, copyValue(hook.watched))
        if (previous === undefined ? !hook.initial : valuesEqual(previous, hook.watched)) continue
        const args = hook.closure.params.length >= 2
          ? [previous ?? hook.watched, hook.watched] : [hook.watched]
        this.invokeHook(hook.closure, args)
        ran = true
      }
    }

    // `.onDisappear` has to be remembered rather than looked up: by the time a view
    // has left the tree its modifiers have left with it, so the closure is not in
    // this pass's hooks. It is kept from the pass that last saw the view.
    for (const hook of hooks) {
      if (hook.kind !== 'disappear') continue
      seen.add(hook.path)
      // Also counted as present: a view may have `.onDisappear` without `.onAppear`,
      // and something has to record that it was here in order to notice it leaving.
      this.appeared.add(hook.path)
      this.disappearing.set(hook.path, hook.closure)
    }

    for (const path of [...this.appeared]) {
      if (seen.has(path)) continue
      this.appeared.delete(path)

      const gone = this.disappearing.get(path)
      if (gone) {
        this.disappearing.delete(path)
        this.invokeHook(gone, [])
        ranDisappear = true
        ran = true
      }
    }

    for (const path of this.watched.keys()) if (!seen.has(path)) this.watched.delete(path)

    if (ran) this.harvest(this.live)
    // A disappear closure wrote into the previous pass's instance - the one that
    // still had the view - so that pass is harvested second and therefore wins.
    if (ranDisappear) this.harvest(this.previousLive)
    return ran
  }

  private invokeHook(closure: ClosureValue, args: readonly SwiftValue[]): void {
    try {
      this.interpreter.callClosure(closure, args, closure.span)
    } catch (error) {
      // A failing lifecycle callback is reported, not fatal: the screen it was about
      // to decorate is still worth showing.
      this.host.log(`Lifecycle callback failed: ${toFailure(error).message}`, closure.span, 'error')
    }
  }

  get stateSnapshot(): ReadonlyMap<string, { value: SwiftValue }> {
    return this.state.snapshot()
  }

  // ------------------------------------------------------------------ private

  private perform(intent: ViewIntent, event: UIEvent): void {
    switch (intent.kind) {
      case 'run':
        if (intent.dismiss) this.perform(intent.dismiss, event)
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

      case 'gesture':
        this.runGesture(intent.gesture, event)
        return

      case 'swipe': {
        // Dragging a row leftwards reveals its actions; letting go snaps to open or
        // closed rather than leaving the row half-way, which is what iOS does.
        if (event.kind !== 'drag') return
        const revealed = Math.max(0, Math.min(SWIPE_WIDTH, -event.translation.x))
        this.ui.setSwipeOffset(
          intent.row,
          event.phase === 'ended' ? (revealed > SWIPE_WIDTH / 2 ? SWIPE_WIDTH : 0) : revealed,
        )
        return
      }

      case 'delete': {
        this.interpreter.callClosure(
          intent.closure,
          [indexSet([intent.offset])],
          intent.closure.span,
        )
        // The row is gone, so nothing should stay swiped open behind it.
        this.ui.closeSwipes()
        return
      }

      case 'expand': {
        this.ui.toggleExpanded(intent.group)
        return
      }

      case 'stepMonth': {
        // Pages the calendar without touching the binding: the user has not chosen a
        // date yet, and moving their appointment by pressing an arrow would be a
        // surprise the real picker does not spring.
        this.ui.stepMonth(intent.control, intent.by)
        return
      }

      case 'openMenu': {
        this.ui.setOpenMenu(intent.menu)
        return
      }

      case 'choose': {
        const binding = asProjection(intent.binding)
        if (binding) binding.set(intent.value)
        this.ui.setOpenMenu(null)
        return
      }

      case 'adjust': {
        const binding = asProjection(intent.binding)
        if (!binding) return
        const current = binding.get()
        const base = current.kind === 'int' || current.kind === 'double' ? current.value : 0

        // `Stepper(value:in:)` stops at its bounds rather than running past them, and
        // a control that counts past the range it was given is a confident wrong
        // answer: the number on screen is one the app could never show.
        const raw = base + intent.by
        const next = intent.bounds
          ? Math.min(intent.bounds.max, Math.max(intent.bounds.min, raw))
          : raw

        binding.set(current.kind === 'int' ? int(Math.round(next)) : double(next))
        return
      }
    }
  }

  /**
   * Runs the handlers a gesture event triggers.
   *
   * `.updating` is the interesting one. Its closure's second parameter is `inout`,
   * which the interpreter has no notion of - but the projection that implements
   * `@Binding` is exactly an `inout` by another name, so the parameter is bound to a
   * projection onto the `@GestureState` box and `state = …` writes through it. On
   * `ended` the box is restored, which is what makes gesture state transient.
   */
  private runGesture(value: SwiftValue, event: UIEvent): void {
    const root = asGesture(value)
    if (!root) return

    const kind = kindOfEvent(event)
    const phase = phaseOfEvent(event)
    const payload = gestureValue(event)

    for (const part of flattenGesture(root)) {
      if (part.kind !== kind) continue

      if (phase !== 'ended') {
        for (const update of part.updates) {
          if (!asProjection(update.binding)) continue
          this.interpreter.callClosure(
            update.closure,
            [payload, update.binding, { kind: 'void' }],
            update.closure.span,
          )
        }
      }

      for (const handler of part.handlers) {
        const wanted = phase === 'ended' ? 'ended' : 'changed'
        if (handler.phase !== wanted) continue
        this.interpreter.callClosure(handler.closure, [payload], handler.closure.span)
      }
    }

    if (phase === 'ended') this.resetGestureState()
  }

  /**
   * Restores every `@GestureState` to its declared initial value.
   *
   * That reversion is the defining property of gesture state - ordinary `@State`
   * keeps whatever it was last given. Re-evaluating the initialiser is what makes it
   * work regardless of how the value was written: the projection a `.updating`
   * closure wrote through is rebuilt on every pass, so remembering "the value before
   * the gesture" against one of those would never match the one that comes back.
   */
  private resetGestureState(): void {
    for (const [identity, instance] of this.live) {
      const decl = this.interpreter.types.get(instance.typeName)
      if (!decl) continue

      for (const property of this.interpreter.membersOf(instance.typeName)) {
        if (property.kind !== 'varDecl') continue
        if (!property.attributes.some((a) => a.name === 'GestureState')) continue

        const initial = property.initializer
          ? this.interpreter.evaluateInScope(property.initializer, instance)
          : ({ kind: 'nil' } as SwiftValue)

        instance.fields.set(property.name, initial)
        this.state.store(identity, property.name, initial, fingerprint(property.initializer))
      }
    }
  }

  /** The stack ids a back button belongs to - derived from its own handler path. */
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

    // A view whose body names itself recurses until the JavaScript stack gives out,
    // and an engine-level stack overflow is not something `toFailure` recognises, so
    // it escapes the compile entirely. The interpreter already budgets Swift call
    // depth; view expansion is the other recursion and needs its own.
    if (this.expandDepth >= MAX_VIEW_DEPTH) {
      throw new SwiftTrap(
        `View nesting is more than ${MAX_VIEW_DEPTH} deep. This usually means a view's body contains the view itself.`,
        decl.span,
        [],
      )
    }

    const identity = this.identity.push(instance.typeName)
    this.expandDepth++
    try {
      this.seedState(instance, decl, identity)
      this.live.set(identity, instance)

      // Conformance and `body` both come from the merged member list: either may be
      // written in an extension, which is how a long view is normally split up.
      if (this.rootTypeName === null && this.interpreter.conformsTo(instance.typeName, 'View')) {
        this.rootTypeName = instance.typeName
      }

      const body = this.interpreter.membersOf(instance.typeName).find(
        (m): m is VarDecl => m.kind === 'varDecl' && m.name === 'body' && m.accessor !== null,
      )
      if (!body?.accessor) {
        // A `Shape` conformance has `path(in:)` and no `body`, and is a view all the
        // same: `Arc()` in a stack draws, filled with the foreground style.
        const shape = this.host.shapeAsView(instance, decl.span)
        return shape ? [shape] : []
      }

      const env = this.interpreter.globals.child(instance)
      const produced = this.interpreter.runViewBuilderBlock(body.accessor, env)

      return this.viewsFrom(produced)
    } finally {
      this.expandDepth--
      this.identity.pop()
    }
  }

  /**
   * Runs a deferred view builder - a sheet's content, a toolbar, a destination.
   *
   * These closures are held unevaluated by the resolver and run only if the screen
   * they belong to is actually shown, which is both faster and, more importantly,
   * correct: a sheet body that force-unwraps its selection must not run while there
   * is no selection.
   */
  /**
   * Calls a named method on a user struct.
   *
   * The seam a custom `ViewModifier` needs: its `body(content:)` is an ordinary method
   * on an ordinary struct, and the host cannot call one. Scoped by the receiver's type
   * name so a modifier holding `@State` gets its own identity rather than sharing the
   * caller's.
   */
  private callMethod(
    receiver: SwiftValue,
    name: string,
    args: readonly SwiftValue[],
  ): SwiftValue | undefined {
    if (receiver.kind !== 'struct') return undefined

    const method = this.interpreter
      .membersOf(receiver.typeName)
      .find((m): m is FuncDecl => m.kind === 'funcDecl' && m.name === name && m.body !== null)
    if (!method) return undefined

    return this.identity.scope(receiver.typeName, () =>
      this.interpreter.callFunction(
        { kind: 'function', decl: method, self: receiver, env: this.interpreter.globals },
        args.map((value) => ({ label: null, value, span: method.span })),
        method.span,
      ),
    )
  }

  /**
   * Calls a method declared in `extension View`, with `self` bound to the receiver.
   *
   * `self` is bound as a *name* rather than as the environment's receiver, because a
   * view value is neither a struct nor an enum case and only those can be receivers.
   * Nothing is lost: the same path already carries `extension Int`, and an unqualified
   * call inside the body resolves back through the binding.
   */
  private callViewExtension(
    name: string,
    receiver: SwiftValue,
    call: HostCall,
  ): SwiftValue | undefined {
    const method = this.interpreter
      .membersOf('View')
      .find((m): m is FuncDecl => m.kind === 'funcDecl' && m.name === name && m.body !== null)
    if (!method) return undefined

    const env = this.interpreter.globals.child(null)
    env.define('self', receiver, true, method.span)

    const args = [...call.args]
    if (call.trailingClosure) {
      args.push({ label: null, value: call.trailingClosure, span: call.span })
    }

    return this.interpreter.callFunction(
      { kind: 'function', decl: method, self: null, env },
      args,
      call.span,
    )
  }

  /**
   * Runs a custom `ButtonStyle`'s `makeBody(configuration:)`.
   *
   * The configuration is an opaque value with two members, because that is all
   * `ButtonStyleConfiguration` has that a preview can supply: `label`, which is
   * whatever the button was going to draw, and `isPressed`. Building it as a real
   * struct would mean synthesising a declaration nothing else needs.
   */
  private styleButton(
    style: SwiftValue,
    label: readonly ViewValue[],
    isPressed: boolean,
  ): readonly ViewValue[] | null {
    if (style.kind !== 'struct') return null
    if (!this.interpreter.conformsTo(style.typeName, 'ButtonStyle')) return null

    const content =
      label.length === 1
        ? asSwiftValue(label[0]!)
        : asSwiftValue({
            name: 'Group',
            args: [],
            children: [...label],
            modifiers: [],
            action: null,
            span: { file: '', start: 0, end: 0 },
          })

    const configuration = opaque(BUTTON_CONFIGURATION_TYPE, { label: content, isPressed })
    const produced = this.callMethod(style, 'makeBody', [configuration])
    if (produced === undefined) return null

    const drawn = asView(produced)
    if (drawn) return [drawn]
    return produced.kind === 'struct' ? this.expand(produced) : null
  }

  /**
   * Runs a `#Preview` body as the root.
   *
   * A view builder like any other, evaluated in the global scope because a preview
   * body has no enclosing type - `#Preview { ContentView() }` is written at file
   * level and sees exactly what a top-level function would.
   */
  private runPreviewBody(body: Block): ViewValue[] {
    const env = this.interpreter.globals.child(null)
    return this.viewsFrom(this.interpreter.runViewBuilderBlock(body, env))
  }

  /**
   * Runs a view-builder closure, optionally with the environment it was written in.
   *
   * The frame matters only for the deferred ones - a pushed destination, a presented
   * sheet, a toolbar - which run at resolve time, after the expansion that declared
   * them has unwound. Without it `@EnvironmentObject` on a detail screen resolves to
   * nothing, which is not a limitation the user can see coming.
   */
  private buildViews(
    closure: ClosureValue,
    args: readonly SwiftValue[] = [],
    environment?: EnvironmentFrame,
  ): readonly ViewValue[] {
    return this.host.environment.withFrame(environment, () =>
      this.viewsFrom(this.interpreter.runViewBuilder(closure, args)),
    )
  }

  /**
   * Everything a builder produced, as views.
   *
   * A user's struct is expanded here, because only the runtime can run a `body`;
   * everything else goes to the host, which knows that a `Color` and a `Path` are
   * views too. Three builders each had their own copy of this and all three kept only
   * the values that were already views - so `var body: some View { Color.blue }` drew
   * nothing, while the same colour inside a `VStack` drew fine.
   */
  private viewsFrom(values: readonly SwiftValue[]): ViewValue[] {
    return values.flatMap((value) =>
      value.kind === 'struct' ? this.expand(value) : this.host.toViews([value]),
    )
  }

  private seedState(instance: StructValue, decl: StructDecl, identity: string): void {
    for (const property of statefulProperties(this.interpreter.membersOf(decl.name))) {
      // `@FocusState private var focused: Bool` is written without an initialiser and
      // starts false, which is the one wrapper that declares its value that way.
      const declared = instance.fields.get(property.name)
      const initial =
        declared === undefined || declared.kind === 'nil'
          ? (defaultForWrapper(property) ?? declared)
          : declared
      if (initial === undefined) continue

      const stored = this.state.resolve(
        identity,
        property.name,
        initial,
        fingerprint(property.initializer),
      )
      instance.fields.set(property.name, stored)
    }

    this.seedDefaults(instance, decl, identity)
    this.seedEnvironment(instance, decl)
  }

  /**
   * `@AppStorage("key")` and `@SceneStorage("key")`.
   *
   * Keyed by the *string*, not by the view that declared it, which is the whole
   * difference from `@State`: two views naming the same key see one value, and the
   * value outlives the view that wrote it. So these boxes are never pruned when a
   * view leaves the tree, and the `endPass` sweep that keeps `@State` honest would
   * be exactly wrong here.
   *
   * It follows `@State` on one point: editing the default re-seeds. Real
   * `UserDefaults` would keep the old value, but a user who just changed `= 0` to
   * `= 10` is waiting to see 10, and a preview that ignores the edit reads as stuck.
   */
  private seedDefaults(instance: StructValue, decl: StructDecl, identity: string): void {
    for (const property of storedProperties(this.interpreter.membersOf(decl.name))) {
      const key = storageKey(property)
      if (key === null) continue

      const initial = instance.fields.get(property.name)
      if (initial === undefined) continue

      const print = fingerprint(property.initializer)
      const existing = this.defaults.get(key)
      const value = existing && existing.initializer === print ? existing.value : initial
      this.defaults.set(key, { value, initializer: print })
      instance.fields.set(property.name, value)
      this.seeded.set(`${identity}.${property.name}`, value)
    }
  }

  /**
   * Fills in properties whose value comes from the environment rather than the view.
   *
   * `@Environment(\.colorScheme)` names its key in the attribute's argument;
   * `@EnvironmentObject` names its type in the annotation. Both are seeded before the
   * body runs, for the same reason `@State` is: the body must see the value, not the
   * placeholder the initialiser left behind.
   */
  private seedEnvironment(instance: StructValue, decl: StructDecl): void {
    for (const member of this.interpreter.membersOf(decl.name)) {
      if (member.kind !== 'varDecl') continue

      const environment = member.attributes.find((a) => a.name === 'Environment')
      if (environment) {
        const key = asKeyPath(keyPathArgument(environment))?.components[0]
        const value = key ? this.host.environment.value(key) : undefined
        if (value === undefined) throw new UnsupportedAtRuntime(`@Environment(${key ?? 'type-based lookup'})`, member.span)
        instance.fields.set(member.name, value)
        continue
      }

      if (!member.attributes.some((a) => a.name === 'EnvironmentObject')) continue

      const typeName =
        member.typeAnnotation?.kind === 'namedType' ? member.typeAnnotation.name : null
      const object =
        (typeName ? this.host.environment.object(typeName) : undefined) ??
        this.host.environment.soleObject()

      if (object !== undefined) instance.fields.set(member.name, object)
    }
  }

  /** Copies `@State` values out of a pass's instances and back into their boxes. */
  private harvest(instances: ReadonlyMap<string, StructValue> = this.live): void {
    for (const [identity, instance] of instances) {
      if (!this.interpreter.types.has(instance.typeName)) continue

      for (const property of statefulProperties(this.interpreter.membersOf(instance.typeName))) {
        const value = instance.fields.get(property.name)
        if (value === undefined) continue
        this.state.store(identity, property.name, value, fingerprint(property.initializer))
      }

      // Only what *changed*. Every view holding a key has its own copy of the value,
      // and a pass ends with all of them still holding what they were seeded with
      // except the one an action wrote through - so writing them all back lets a
      // sibling's stale copy overwrite the new value. `@State` never had this problem
      // because each box belongs to one view; shared storage is the whole point here.
      for (const property of storedProperties(this.interpreter.membersOf(instance.typeName))) {
        const key = storageKey(property)
        const value = instance.fields.get(property.name)
        if (key === null || value === undefined) continue

        const seeded = this.seeded.get(`${identity}.${property.name}`)
        if (seeded && valuesEqual(seeded, value)) continue

        this.defaults.set(key, { value, initializer: fingerprint(property.initializer) })
      }
    }
  }
}

/**
 * The properties whose value must outlive the view struct.
 *
 * `@StateObject` belongs here beside `@State` and `@ObservedObject` does not - that
 * is the entire difference between them. A `@StateObject` is created once and kept;
 * an `@ObservedObject` is handed in from outside and owned by whoever made it.
 *
 * `@FocusState` is here too. There is no keyboard in the preview, so nothing focuses
 * a field from outside the program - but the property is still storage the code reads
 * and writes, and treating it as such is what makes `isFocused = true` in an
 * `.onAppear` run rather than fail.
 */
function statefulProperties(members: readonly Decl[]): VarDecl[] {
  return members.filter(
    (m): m is VarDecl =>
      m.kind === 'varDecl' &&
      m.attributes.some(
        (a) =>
          a.name === 'State' ||
          a.name === 'StateObject' ||
          a.name === 'GestureState' ||
          a.name === 'FocusState',
      ),
  )
}

/**
 * The value a wrapper starts at when the user wrote no initialiser.
 *
 * Only `@FocusState` reaches here: SwiftUI gives it a zero value from its type, and
 * `@FocusState var focused: Bool` is the spelling in every example Apple writes.
 * Without it the property is `nil`, and `if focused` then takes the wrong branch -
 * a preview quietly disagreeing with the device.
 */
function defaultForWrapper(property: VarDecl): SwiftValue | undefined {
  if (!property.attributes.some((a) => a.name === 'FocusState')) return undefined
  const annotation = property.typeAnnotation
  if (annotation?.kind === 'namedType' && annotation.name === 'Bool') return { kind: 'bool', value: false }
  // An enum-typed `@FocusState` is optional in SwiftUI - nothing is focused yet.
  return { kind: 'nil' }
}

/** `@AppStorage("key")` and `@SceneStorage("key")` - keyed by the string, not the view. */
function storedProperties(members: readonly Decl[]): VarDecl[] {
  return members.filter(
    (m): m is VarDecl =>
      m.kind === 'varDecl' &&
      m.attributes.some((a) => a.name === 'AppStorage' || a.name === 'SceneStorage'),
  )
}

/**
 * The key a storage wrapper was given, or null when it was not given a literal one.
 *
 * An attribute's argument is an *expression node*, not a value - nothing has run yet
 * when the key is needed - so this reads the literal's text segments rather than
 * evaluating it. A key built at runtime is therefore not one this can see, and the
 * property falls back to behaving as plain state, which is the safe direction: it
 * still reads and writes, it simply is not shared.
 */
function storageKey(property: VarDecl): string | null {
  const attribute = property.attributes.find(
    (a) => a.name === 'AppStorage' || a.name === 'SceneStorage',
  )
  const first = attribute?.args[0]?.value
  if (!first || first.kind !== 'stringLiteral') return null

  const literal = first.segments.every((segment) => segment.kind === 'text')
  return literal ? first.segments.map((segment) => (segment.kind === 'text' ? segment.value : '')).join('') : null
}

/** `@Environment(\.colorScheme)` - the key path the attribute was given. */
function keyPathArgument(attribute: { args: readonly { value: unknown }[] }): SwiftValue | undefined {
  const first = attribute.args[0]?.value as { kind?: string; components?: readonly string[] } | undefined
  if (first?.kind !== 'keyPath' || !first.components) return undefined
  return { kind: 'opaque', typeName: 'KeyPath', payload: { components: first.components } }
}

/** How far a list row slides to reveal its delete action. */
const SWIPE_WIDTH = 88

/**
 * The deepest chain of custom views the preview will expand.
 *
 * Generous by the standards of a real screen - a deeply factored app nests perhaps
 * fifteen - and far below the depth at which the JavaScript stack gives out, which
 * is the failure this exists to convert into a diagnostic.
 */
const MAX_VIEW_DEPTH = 120

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
 * A typed event carries one - a text field's new string, a slider's new number - and
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
  if (error instanceof PreviewLimitExceeded) {
    return { message: error.message, span: error.span, frames: [], kind: 'budget' }
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
  if (error instanceof SwiftThrow) {
    // An error that reached the top of the tree was never caught. In a real app that
    // is a fatal error; here it has to become a diagnostic, because anything this
    // function does not recognise is re-thrown and takes the whole compile with it.
    return {
      message: `An error was thrown and never caught: ${describe(error.value as SwiftValue, false)}`,
      span: error.span,
      frames: [],
      kind: 'trap',
    }
  }
  throw error
}

export { describe }

/**
 * The body of the first `#Preview` in the project, if there is one.
 *
 * First rather than all: Xcode shows several previews side by side, and a simulated
 * phone has one screen. Picking the first is the choice that needs no interface, and a
 * second preview is still parsed and still exported.
 */
function findPreviewBody(files: readonly SourceFileNode[]): Block | null {
  for (const file of files) {
    for (const decl of file.declarations) {
      if (decl.kind === 'macroDecl' && decl.name === 'Preview' && decl.body) return decl.body
    }
  }
  return findPreviewsProperty(files)
}

/**
 * `struct C_Previews: PreviewProvider { static var previews: some View { C() } }`.
 *
 * The spelling before the `#Preview` macro, and the one every project written before
 * Xcode 15 still carries. It names a view to show exactly as `#Preview` does, so it
 * is read the same way: the body of `previews` becomes the root when nothing is
 * `@main`.
 *
 * Looked for only after the macro, because a file carrying both was written to be
 * seen through the newer one.
 */
function findPreviewsProperty(files: readonly SourceFileNode[]): Block | null {
  for (const file of files) {
    for (const decl of file.declarations) {
      if (decl.kind !== 'structDecl') continue
      if (!decl.inherits.some((t) => t.name === 'PreviewProvider')) continue

      for (const member of decl.members) {
        if (member.kind !== 'varDecl' || member.name !== 'previews') continue
        if (member.accessor) return member.accessor
      }
    }
  }
  return null
}
