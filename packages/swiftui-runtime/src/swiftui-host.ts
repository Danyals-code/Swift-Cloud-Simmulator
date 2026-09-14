import type { SourceSpan } from '@studio/shared'
import {
  applyKeyPath,
  asKeyPath,
  describe,
  double,
  int,
  opaque,
  str,
  type ClosureValue,
  type HostCall,
  type InterpreterHost,
  type SwiftValue,
} from '@studio/swift-runtime'
import { SUPPORTED_VIEWS, UNIMPLEMENTED_VIEWS } from '@studio/swift-sema'
import { DISMISS_TYPE, EnvironmentStack } from './view-environment'
import {
  asCanvasContext,
  asPath,
  newCanvasContext,
  newPath,
  PATH_TYPE,
  toSVGPath,
  type PathCommand,
  type PathPoint,
} from './paths'
import {
  asGesture,
  combined,
  geometryMember,
  gesture,
  point,
  size,
  withHandler,
  withUpdate,
  type GestureKind,
} from './gestures'
import {
  asView,
  ANIMATION_TYPE,
  COLOR_TYPE,
  GEOMETRY_TYPE,
  isView,
  STYLE_TYPE,
  TOKEN_TYPE,
  TRANSITION_TYPE,
  VIEW_TYPE,
  type AnimationPayload,
  type ColorPayload,
  type GradientPayload,
  type ModifierValue,
  type TokenPayload,
  type TransitionPayload,
  type ViewArg,
  type ViewValue,
} from './view-value'

/** Every name the host will build a view for — implemented or not. */
const VIEW_NAMES: ReadonlySet<string> = new Set([
  ...SUPPORTED_VIEWS,
  ...UNIMPLEMENTED_VIEWS.keys(),
  'Spacer',
  'Divider',
])

/**
 * Views whose trailing closure is an action rather than content.
 *
 * `Button("Save") { save() }` has the same shape as `VStack { Text(…) }`, so the
 * label argument is what distinguishes them: with one, the closure is behaviour;
 * without, it is the view's own label content.
 *
 * `NavigationLink` is deliberately *not* here. Its trailing closure is never an
 * action — with a title argument it is the destination (`NavigationLink("More") {
 * Detail() }`, the form most code still uses), and without one it is the label. That
 * ambiguity is resolved in `callGlobal`.
 */
const ACTION_VIEWS: ReadonlySet<string> = new Set(['Button'])

/** Names that are types rather than views: `Color.red`, `Font.title`. */
const NAMESPACES: ReadonlySet<string> = new Set([
  'Color', 'Font', 'Alignment', 'Edge', 'Angle', 'UnitPoint', 'Axis',
  'Animation', 'AnyTransition', 'Text', 'Image', 'ContentMode',
  'HorizontalAlignment', 'VerticalAlignment', 'PresentationDetent', 'ToolbarItemPlacement',
  'CGSize', 'CGPoint', 'CGRect', 'CGFloat',
  'Task', 'MainActor',
])

/**
 * The concurrency surface, run synchronously.
 *
 * One rule covers all of it: **the preview has no concurrency, so everything async
 * runs immediately and in order.** `.task` has worked this way since Phase 7, `await`
 * is transparent, and `Task { … }` runs its body where it is written.
 *
 * That is a real limitation and it is stated rather than hidden. The alternative —
 * deferring a `Task` body and re-rendering, or splitting one at a `Task.sleep` — needs
 * suspension the interpreter does not have, and a half-built version of it would make
 * ordering depend on which special case a program happened to hit. One rule that is
 * always true beats several that are usually true.
 */
const TASK_TYPE = 'Task'

/**
 * Views that take a data collection and a row builder.
 *
 * `List(items) { item in … }` is sugar for `List { ForEach(items) { … } }`, and
 * expanding it here means the rest of the pipeline only ever sees the explicit form.
 */
const DATA_DRIVEN_VIEWS: ReadonlySet<string> = new Set(['ForEach', 'List', 'Picker'])

function view(v: ViewValue): SwiftValue {
  return opaque(VIEW_TYPE, v)
}

function token(name: string): SwiftValue {
  return opaque(TOKEN_TYPE, { name })
}

function color(payload: ColorPayload): SwiftValue {
  return opaque(COLOR_TYPE, payload)
}

function toArgs(call: HostCall): ViewArg[] {
  return call.args.map((a) => ({ label: a.label, value: a.value }))
}

function numberOf(value: SwiftValue | undefined): number | null {
  if (!value) return null
  return value.kind === 'int' || value.kind === 'double' ? value.value : null
}

function tokenNameOf(value: SwiftValue | undefined): string | null {
  if (!value || value.kind !== 'opaque' || value.typeName !== TOKEN_TYPE) return null
  return (value.payload as TokenPayload).name
}

/**
 * Turns evaluated Swift into a view tree.
 *
 * This is the whole of `swift-runtime`'s SwiftUI knowledge — the interpreter itself
 * has none, and the ESLint boundary rule would reject the import if it tried. Every
 * view, colour and modifier the preview understands is defined here, which also
 * means the coverage matrix has exactly one place to be wrong.
 */
export class SwiftUIHost implements InterpreterHost {
  private readonly logs: { message: string; span: SourceSpan }[] = []

  /**
   * Expands a user-declared `View` struct into its evaluated body.
   *
   * Supplied by the pipeline, because expansion needs the interpreter and this class
   * must not hold one — it is the interpreter's *host*, not its owner. Without it,
   * `WindowGroup { ContentView() }` collects a struct the host cannot recognise and
   * silently drops the entire app.
   */
  expandStruct: ((value: SwiftValue) => readonly ViewValue[]) | null = null

  /**
   * Runs a function inside a named identity scope.
   *
   * `ForEach` needs this: without it, every row of a list expands `RowView` in the
   * same scope, so all rows share one `@State` box. Scoping each iteration by the
   * element's identity is also what makes state follow a row when the list is
   * reordered, rather than staying with the position.
   */
  scopeIdentity: (<T>(key: string, fn: () => T) => T) | null = null

  /**
   * Calls a method on a user struct, by name.
   *
   * Supplied by the pipeline for the same reason as `expandStruct`: a custom
   * `ViewModifier` is wired up by calling its `body(content:)`, and a `ButtonStyle` by
   * calling its `makeBody(configuration:)`. Both are ordinary methods on a struct the
   * host cannot call itself.
   */
  callMethod: ((receiver: SwiftValue, name: string, args: readonly SwiftValue[]) => SwiftValue | undefined) | null =
    null

  /** Whether a user type conforms to a protocol. Supplied with `callMethod`. */
  conformsTo: ((typeName: string, protocolName: string) => boolean) | null = null

  /**
   * Calls a method the project declared in `extension View`.
   *
   * `extension View { func cardStyle() -> some View { … } }` is how nearly every real
   * SwiftUI codebase names a reusable modifier chain, and the receiver is a *view* —
   * `Text("x").cardStyle()` — not a struct whose own type declares the method. So the
   * lookup has to start from the protocol rather than from the value.
   */
  callViewExtension:
    | ((name: string, receiver: SwiftValue, call: HostCall) => SwiftValue | undefined)
    | null = null

  /**
   * The SwiftUI environment, as a dynamic scope.
   *
   * Owned by the host because it is the host that expands views, and the environment
   * has to be in scope at exactly that moment. See `view-environment.ts` for the
   * limitation this implies and why it is the honest approximation.
   */
  readonly environment = new EnvironmentStack()

  /**
   * What `@Environment(\.dismiss)` should do when called.
   *
   * Supplied by the runtime, which is the only thing that knows what is presented.
   * Null when nothing is: `dismiss()` outside a presentation does nothing in SwiftUI
   * too, rather than failing.
   */
  dismissAction: (() => void) | null = null

  /**
   * Sizes measured for each `GeometryReader` on the previous layout pass.
   *
   * Empty on the first pass of a new screen, which is why `defaultGeometry` exists:
   * a reader has to report *something* the first time, and the content rect is the
   * closest guess available before anything has been laid out.
   */
  geometry: ReadonlyMap<string, { width: number; height: number }> = new Map()
  defaultGeometry = { width: 393, height: 759 }

  /** Per-pass counter, so two readers on one source line get distinct keys. */
  private geometryOrdinals = new Map<string, number>()

  beginPass(): void {
    this.geometryOrdinals.clear()
  }

  /**
   * The animation `withAnimation` was called with, if any.
   *
   * Read and cleared by the runtime after dispatching an event: a state change made
   * inside `withAnimation { }` animates, one made outside it does not, and the only
   * thing that distinguishes them is that this was set while the closure ran.
   */
  pendingAnimation: AnimationPayload | null = null

  /**
   * `GeometryReader { geo in … }`.
   *
   * The proxy has to carry a size *before* layout has run, which is the ordering
   * problem this whole feature is. The size used is the one the same reader was
   * measured at last time; the pipeline compares that against what it actually got
   * and runs one more pass if they differ. Two passes converge because a reader is
   * greedy — its size is its proposal, and the proposal does not depend on what the
   * closure built.
   */
  private makeGeometryReader(call: HostCall): SwiftValue {
    const site = `g${call.span.start}`
    const ordinal = this.geometryOrdinals.get(site) ?? 0
    this.geometryOrdinals.set(site, ordinal + 1)
    const key = ordinal === 0 ? site : `${site}#${ordinal}`

    const size = this.geometry.get(key) ?? this.defaultGeometry
    const proxy = opaque(GEOMETRY_TYPE, { width: size.width, height: size.height })

    return view({
      name: 'GeometryReader',
      args: toArgs(call),
      children: this.toViews(call.invokeBuilder(call.trailingClosure!, [proxy])),
      modifiers: [],
      action: null,
      span: call.span,
      geometryKey: key,
    })
  }

  /**
   * `Path()`, `Path { p in … }`, `Path(roundedRect:cornerRadius:)`.
   *
   * The closure form hands the closure a live path and returns the same one, which is
   * how the builder can fill it in place.
   */
  private makePath(call: HostCall): SwiftValue {
    const value = newPath()


    if (call.trailingClosure) {
      call.invoke(call.trailingClosure, [value])
      return value
    }

    // `Path(CGRect(…))` and `Path(roundedRect:cornerRadius:)`.
    const rect = call.args.find((a) => a.label === null || a.label === 'roundedRect')?.value
    const radius = numberOf(call.args.find((a) => a.label === 'cornerRadius')?.value) ?? 0
    const bounds = rectOf(rect)
    if (bounds) {
      asPath(value)!.commands.push({ kind: 'rect', ...bounds, radius })
    }
    return value
  }

  /** One drawing command, or null when the member is not a drawing command. */
  private pathCommand(member: string, call: HostCall): PathCommand | null {
    const first = call.args.find((a) => a.label === 'to' || a.label === null)?.value

    switch (member) {
      case 'move':
        return { kind: 'move', to: pointOf(first) ?? { x: 0, y: 0 } }
      case 'addLine':
        return { kind: 'line', to: pointOf(first) ?? { x: 0, y: 0 } }
      case 'closeSubpath':
        return { kind: 'close' }

      case 'addCurve':
        return {
          kind: 'curve',
          to: pointOf(first) ?? { x: 0, y: 0 },
          control1: pointOf(call.args.find((a) => a.label === 'control1')?.value) ?? { x: 0, y: 0 },
          control2: pointOf(call.args.find((a) => a.label === 'control2')?.value) ?? { x: 0, y: 0 },
        }

      case 'addQuadCurve':
        return {
          kind: 'quad',
          to: pointOf(first) ?? { x: 0, y: 0 },
          control: pointOf(call.args.find((a) => a.label === 'control')?.value) ?? { x: 0, y: 0 },
        }

      case 'addArc':
        return {
          kind: 'arc',
          centre: pointOf(call.args.find((a) => a.label === 'center')?.value) ?? { x: 0, y: 0 },
          radius: numberOf(call.args.find((a) => a.label === 'radius')?.value) ?? 0,
          startDegrees: angleOf(call.args.find((a) => a.label === 'startAngle')?.value),
          endDegrees: angleOf(call.args.find((a) => a.label === 'endAngle')?.value),
          clockwise: call.args.find((a) => a.label === 'clockwise')?.value.kind === 'bool'
            ? (call.args.find((a) => a.label === 'clockwise')!.value as { value: boolean }).value
            : true,
        }

      case 'addRect': {
        const bounds = rectOf(first)
        return bounds ? { kind: 'rect', ...bounds, radius: 0 } : null
      }

      case 'addRoundedRect': {
        const bounds = rectOf(first)
        const radius = numberOf(call.args.find((a) => a.label === 'cornerRadius')?.value) ?? 0
        return bounds ? { kind: 'rect', ...bounds, radius } : null
      }

      case 'addEllipse': {
        const bounds = rectOf(first)
        return bounds ? { kind: 'ellipse', ...bounds } : null
      }

      default:
        return null
    }
  }

  /**
   * `Canvas { context, size in … }`.
   *
   * The closure is run once, now, with a context that records what it was asked to
   * draw. That makes a canvas a list of vector paths rather than a bitmap — which
   * reuses the path renderer exactly, and means a canvas is inspectable and
   * diffable like everything else.
   *
   * The honest limitation: the closure runs at evaluation time, so it sees the size
   * from the last layout pass rather than the one it is about to get. The same
   * two-pass loop that serves `GeometryReader` corrects it on the next pass.
   */
  private makeCanvas(call: HostCall): SwiftValue {
    const context = newCanvasContext()
    const size = this.defaultGeometry
    const proxy = opaque('CGSize', { width: size.width, height: size.height })

    call.invoke(call.trailingClosure!, [context, proxy])

    return view({
      name: 'Canvas',
      args: [{ label: null, value: context }],
      children: [],
      modifiers: [],
      action: null,
      span: call.span,
    })
  }

  /** A path with a view modifier on it becomes the view it already is. */
  private pathAsStyledView(target: SwiftValue, member: string, call: HostCall): SwiftValue {
    const modifier: ModifierValue = {
      name: member,
      args: toArgs(call),
      span: call.span,
      closure: call.trailingClosure,
    }

    return view({
      name: 'Path',
      args: [{ label: null, value: target }],
      children: [],
      modifiers: [modifier],
      action: null,
      span: call.span,
    })
  }

  /**
   * Expands a user view so a modifier can be applied to it.
   *
   * Several views become an implicit `Group`, which is what SwiftUI does with a
   * multi-statement body: the modifier applies to all of them together.
   */
  private expandForModifier(target: SwiftValue, span: SourceSpan): ViewValue | null {
    if (target.kind !== 'struct' || !this.expandStruct) return null

    const produced = this.expandStruct(target)
    if (produced.length === 0) return null
    if (produced.length === 1) return produced[0]!

    return {
      name: 'Group',
      args: [],
      children: [...produced],
      modifiers: [],
      action: null,
      span,
    }
  }

  /**
   * Applies `.environmentObject` / `.environment`, with the injection in scope.
   *
   * The target is expanded *inside* the scope, which is what gets the value to the
   * view's `body`. A view value that is already built keeps the modifier recorded so
   * the inspector still shows it, even though nothing below it can read it — see the
   * limitation in `view-environment.ts`.
   */
  private withInjectedEnvironment(
    target: SwiftValue,
    member: string,
    call: HostCall,
  ): SwiftValue | undefined {
    const values: [string, SwiftValue][] = []
    const objects: [string, SwiftValue][] = []

    if (member === 'environmentObject') {
      const object = call.args[0]?.value
      if (object?.kind === 'struct') objects.push([object.typeName, object])
    } else {
      const key = asKeyPath(call.args[0]?.value)?.components[0]
      const value = call.args[1]?.value
      if (key && value) values.push([key, value])
    }

    const modifier: ModifierValue = {
      name: member,
      args: toArgs(call),
      span: call.span,
      closure: call.trailingClosure,
    }

    return this.environment.scoped(values, objects, () => {
      const base = asView(target) ?? this.expandForModifier(target, call.span)
      if (!base) return undefined
      return view({ ...base, modifiers: [...base.modifiers, modifier] })
    })
  }

  /**
   * Collected builder results, with user views expanded and non-views dropped.
   *
   * A `Color` is a `View` in SwiftUI — `VStack { Color.red }` paints a red panel —
   * so a colour reaching a builder is wrapped rather than discarded. Dropping it was
   * silent, which is the failure mode this project refuses: the code looked honoured
   * and drew nothing.
   */
  private toViews(values: readonly SwiftValue[]): ViewValue[] {
    return values.flatMap((value) => {
      const view = asView(value)
      if (view) return [view]
      if (value.kind === 'struct' && this.expandStruct) return [...this.expandStruct(value)]

      const asColour = this.colorAsView(value)
      if (asColour) return [asColour]

      if (value.kind === 'opaque' && value.typeName === PATH_TYPE) {
        return [
          {
            name: 'Path',
            args: [{ label: null, value }],
            children: [],
            modifiers: [],
            action: null,
            span: { file: '', start: 0, end: 0 },
          },
        ]
      }
      return []
    })
  }

  /** Wraps a `Color` (or a gradient) as the view it is. */
  private colorAsView(value: SwiftValue, span?: SourceSpan): ViewValue | null {
    if (value.kind !== 'opaque') return null
    if (value.typeName !== COLOR_TYPE && value.typeName !== STYLE_TYPE) return null

    return {
      name: 'Color',
      args: [{ label: null, value }],
      children: [],
      modifiers: [],
      action: null,
      span: span ?? { file: '', start: 0, end: 0 },
    }
  }

  takeLogs(): { message: string; span: SourceSpan }[] {
    return this.logs.splice(0, this.logs.length)
  }

  log(message: string, span: SourceSpan): void {
    this.logs.push({ message, span })
  }

  resolveGlobal(name: string): SwiftValue | undefined {
    if (GESTURE_CONSTRUCTORS[name]) return { kind: 'type', name }
    if (NAMESPACES.has(name)) return { kind: 'type', name }
    // A view referenced without a call, e.g. passed as a value.
    if (VIEW_NAMES.has(name)) return { kind: 'type', name }
    return undefined
  }

  callGlobal(name: string, call: HostCall): SwiftValue | undefined {
    // Values first: these are not views, so they have to be handled before the
    // "is this a view name?" guard below rejects them.
    if (name === 'Task') return this.runTask(call)
    if (name === 'Color') return this.makeColor(call)
    if (name === 'withAnimation') return this.runWithAnimation(call)
    if (GRADIENTS[name]) return this.makeGradient(GRADIENTS[name]!, call)
    if (name === 'GridItem') return this.makeGridItem(call)

    if (name === 'CGSize') {
      return size(
        numberOf(call.args.find((a) => a.label === 'width')?.value) ?? 0,
        numberOf(call.args.find((a) => a.label === 'height')?.value) ?? 0,
      )
    }

    if (name === 'CGPoint') {
      return point(
        numberOf(call.args.find((a) => a.label === 'x')?.value) ?? 0,
        numberOf(call.args.find((a) => a.label === 'y')?.value) ?? 0,
      )
    }

    if (name === 'CGRect') {
      return opaque('CGRect', {
        x: numberOf(call.args.find((a) => a.label === 'x')?.value) ?? 0,
        y: numberOf(call.args.find((a) => a.label === 'y')?.value) ?? 0,
        width: numberOf(call.args.find((a) => a.label === 'width')?.value) ?? 0,
        height: numberOf(call.args.find((a) => a.label === 'height')?.value) ?? 0,
      })
    }

    if (GESTURE_CONSTRUCTORS[name]) {
      const minimum = numberOf(call.args.find((a) => a.label === 'minimumDistance')?.value)
      return gesture(GESTURE_CONSTRUCTORS[name]!, minimum ?? 10)
    }

    if (!VIEW_NAMES.has(name)) return undefined

    const args = toArgs(call)

    if (DATA_DRIVEN_VIEWS.has(name) && call.trailingClosure && this.looksDataDriven(call)) {
      return this.makeDataDriven(name, args, call)
    }

    if (name === 'Path') return this.makePath(call)
    if (name === 'Canvas' && call.trailingClosure) return this.makeCanvas(call)
    if (name === 'GeometryReader' && call.trailingClosure) return this.makeGeometryReader(call)

    const isAction = ACTION_VIEWS.has(name) && call.args.some((a) => a.label === null)

    // `NavigationLink("Title") { Destination() }` — a title plus a trailing closure
    // means the closure is the destination, not the label.
    if (name === 'NavigationLink' && call.trailingClosure && this.hasPlainTitle(call)) {
      const destination = this.toViews(call.invokeBuilder(call.trailingClosure))
      return view({
        name,
        args: [...args, ...destination.map((d) => ({ label: 'destination', value: view(d) }))],
        children: [],
        modifiers: [],
        action: null,
        span: call.span,
      })
    }

    // Content closures are result builders: `VStack { a; b }` yields two children,
    // and an `if` inside contributes only the taken branch.
    const children =
      call.trailingClosure && !isAction ? this.toViews(call.invokeBuilder(call.trailingClosure)) : []

    return view({
      name,
      args,
      children,
      modifiers: [],
      action: isAction ? call.trailingClosure : null,
      span: call.span,
    })
  }

  callMember(target: SwiftValue, member: string, call: HostCall): SwiftValue | undefined {
    // `.modifier(Shadowed())` — a custom `ViewModifier`. Its `body(content:)` takes
    // the view it is applied to and returns a new one, so the content is handed over
    // as a value: inside the modifier, `content.padding()` is then an ordinary
    // modifier on an ordinary view, with nothing special about it at all.
    if (member === 'modifier') {
      const applied = this.applyViewModifier(target, call)
      if (applied !== undefined) return applied
    }

    if (target.kind === 'type' && (target.name === 'Task' || target.name === 'MainActor')) {
      if (member === 'detached' || member === 'run') return this.runTask(call)
      // `Task.sleep` and `Task.yield` are the suspension points, and there is nothing
      // here to suspend. Returning a value rather than reporting them unsupported is
      // what keeps `try await Task.sleep(…)` from putting a warning on correct Swift.
      if (member === 'sleep' || member === 'yield') return opaque(TASK_TYPE, { done: true })
    }

    // `.environmentObject(store)` and `.environment(\.key, value)` must be in scope
    // *while* the view below them expands, so they are handled before anything else
    // touches the target — by which point a struct would already have been expanded.
    if (member === 'environmentObject' || member === 'environment') {
      return this.withInjectedEnvironment(target, member, call)
    }

    // A method the project wrote in `extension View`. Checked before the generic
    // modifier path, which accepts any name at all and would otherwise swallow it as
    // an unrecognised-but-harmless modifier.
    if (asView(target) !== null || target.kind === 'struct') {
      const extended = this.callViewExtension?.(member, target, call)
      if (extended !== undefined) return extended
    }

    // A modifier on a view returns a *new* view with the modifier appended, so the
    // original is untouched — SwiftUI modifiers are value-semantic too.
    //
    // A user-declared view arrives here as a plain struct, because the interpreter
    // has no idea it is a view. `TodayView().tabItem { … }` is entirely ordinary
    // SwiftUI, so the struct is expanded into the views its `body` produces and the
    // modifier applied to those — a struct with no `body` expands to nothing and
    // falls through to the interpreter's own "no such member" reporting.
    const base = asView(target) ?? this.expandForModifier(target, call.span)
    if (base) {
      const modifier: ModifierValue = {
        name: member,
        args: toArgs(call),
        span: call.span,
        // Unevaluated on purpose: a sheet's content must not run while it is down.
        closure: call.trailingClosure,
      }
      return view({ ...base, modifiers: [...base.modifiers, modifier] })
    }

    // Path building. The payload is mutated in place, which is what the closure form
    // needs: `Path { p in p.move(to: …) }` expects `p` to be the path it is filling.
    const path = asPath(target)
    if (path) {
      const command = this.pathCommand(member, call)
      if (command) {
        path.commands.push(command)
        return target
      }
      if (member === 'trim') {
        path.trim = {
          from: numberOf(call.args.find((a) => a.label === 'from')?.value) ?? 0,
          to: numberOf(call.args.find((a) => a.label === 'to')?.value) ?? 1,
        }
        return target
      }
      // Anything else on a path is a view modifier: `.fill`, `.stroke`, `.frame`.
      return this.pathAsStyledView(target, member, call)
    }

    // `context.fill(path, with: .color(.red))` — the Canvas drawing API. The context
    // collects drawings rather than rasterising, so a canvas ends up as the same
    // vector nodes a `Path` produces and needs no second renderer.
    const canvas = asCanvasContext(target)
    if (canvas && (member === 'fill' || member === 'stroke')) {
      const drawn = asPath(call.args.find((a) => a.label === null)?.value)
      const style = call.args.find((a) => a.label === 'with')?.value ?? null
      if (drawn) {
        canvas.drawings.push({
          d: toSVGPath(drawn),
          fill: member === 'fill' ? style : null,
          stroke: member === 'stroke' ? style : null,
          lineWidth:
            numberOf(call.args.find((a) => a.label === 'lineWidth')?.value) ??
            numberOf(call.args.find((a) => a.label === 'style')?.value) ??
            1,
        })
      }
      return { kind: 'void' }
    }

    // Building a gesture by chaining: each link returns a new gesture with one more
    // handler on it, which is value semantics, same as SwiftUI.
    const chain = asGesture(target)
    if (chain) {
      const closure = call.trailingClosure ?? asClosure(call.args[call.args.length - 1]?.value)

      if ((member === 'onChanged' || member === 'onEnded') && closure) {
        return withHandler(chain, { phase: member === 'onChanged' ? 'changed' : 'ended', closure })
      }
      if (member === 'updating' && closure) {
        const binding = call.args.find((a) => a.label === null)?.value
        if (binding) return withUpdate(chain, { binding, closure })
      }
      if (member === 'simultaneously' || member === 'exclusively' || member === 'sequenced') {
        const other = asGesture(call.args[0]?.value)
        return other ? combined(chain, other) : target
      }
      return target
    }

    // A view modifier written on a colour: `Color.red.frame(width: 100)`. The colour
    // becomes the view it already is, and the modifier applies to that.
    if (
      target.kind === 'opaque' &&
      (target.typeName === COLOR_TYPE || target.typeName === STYLE_TYPE) &&
      !COLOR_MEMBERS.has(member)
    ) {
      const wrapped = this.colorAsView(target, call.span)
      if (wrapped) {
        const modifier: ModifierValue = {
          name: member,
          args: toArgs(call),
          span: call.span,
          closure: call.trailingClosure,
        }
        return view({ ...wrapped, modifiers: [modifier] })
      }
    }

    if (target.kind === 'opaque' && target.typeName === COLOR_TYPE) {
      const payload = target.payload as ColorPayload
      if (member === 'opacity') {
        const amount = numberOf(call.args[0]?.value)
        return color({ ...payload, opacity: amount ?? 1 })
      }
      if (member === 'gradient') {
        return opaque(STYLE_TYPE, {
          kind: 'linear',
          colors: [target, color({ ...payload, opacity: (payload.opacity ?? 1) * 0.55 })],
          startPoint: 'top',
          endPoint: 'bottom',
        } satisfies GradientPayload)
      }
    }

    // `Color(white: 0.95)` reaching here as `Color.init(...)`.
    if (target.kind === 'type' && target.name === 'Color' && member === 'init') {
      return this.makeColor(call)
    }

    if (target.kind === 'type' && target.name === 'Angle') {
      if (member === 'color') {
      const inner = call.args.find((a) => a.label === null)?.value
      if (inner) return inner.kind === 'opaque' ? inner : color({ name: 'primary' })
    }
    if (member === 'degrees' || member === 'radians') {
        return token(`${member}:${numberOf(call.args[0]?.value) ?? 0}`)
      }
    }

    if (target.kind === 'type' && target.name === 'Animation') {
      return this.makeAnimation(member, call)
    }

    if (target.kind === 'type' && target.name === 'Font' && member === 'system') {
      return this.makeSystemFont(call)
    }

    return undefined
  }

  /** `dismiss()` — the one callable the environment hands out. */
  callValue(target: SwiftValue): SwiftValue | undefined {
    if (target.kind !== 'opaque' || target.typeName !== DISMISS_TYPE) return undefined
    this.dismissAction?.()
    return { kind: 'void' }
  }

  /**
   * Implicit member syntax *with* arguments: `.easeInOut(duration: 0.3)`.
   *
   * Separate from `resolveImplicitMember` because that one never sees the call —
   * without this hook, every animation collapses to its default duration and the
   * number the user typed is silently discarded.
   */
  callImplicitMember(member: string, call: HostCall): SwiftValue | undefined {
    if (ANIMATION_CURVES[member] || member === 'spring' || member === 'interpolatingSpring') {
      return this.makeAnimation(member, call)
    }
    if (TRANSITIONS.has(member)) return this.makeTransition(member, call)
    if (member === 'system') return this.makeSystemFont(call)
    if (member === 'fixed' || member === 'flexible' || member === 'adaptive') {
      return this.makeGridItem(call, member)
    }
    if (member === 'degrees' || member === 'radians') {
      return token(`${member}:${numberOf(call.args[0]?.value) ?? 0}`)
    }
    if (member === 'height' || member === 'fraction') {
      return token(`detent:${member}:${numberOf(call.args[0]?.value) ?? 0}`)
    }
    return undefined
  }

  getMember(target: SwiftValue, member: string, span: SourceSpan): SwiftValue | undefined {
    // `value.translation.width`, `value.location.x`, `size.width` …
    const geometry = geometryMember(target, member)
    if (geometry !== undefined) return geometry

    // `CGSize.zero`, `CGPoint.zero` — the initialiser almost every `@GestureState`
    // is declared with.
    if (target.kind === 'type' && member === 'zero') {
      if (target.name === 'CGSize') return size(0, 0)
      if (target.name === 'CGPoint') return point(0, 0)
    }

    // `geo.size`, `geo.size.width`, `geo.size.height`.
    if (target.kind === 'opaque' && target.typeName === GEOMETRY_TYPE) {
      const size = target.payload as { width: number; height: number }
      if (member === 'size') return target
      if (member === 'width') return double(size.width)
      if (member === 'height') return double(size.height)
      if (member === 'safeAreaInsets') return opaque(GEOMETRY_TYPE, { width: 0, height: 0 })
    }

    if (target.kind === 'type') {
      if (target.name === 'Color') return color({ name: member })
      if (target.name === 'Animation') return this.animationToken(member)
      if (target.name === 'AnyTransition') return this.transitionToken(member)
      if (NAMESPACES.has(target.name)) return token(member)
      // A view type referenced without arguments: `Spacer` used as `Spacer`.
      if (VIEW_NAMES.has(target.name)) {
        return view({ name: target.name, args: [], children: [], modifiers: [], action: null, span })
      }
    }
    return undefined
  }

  /**
   * `.modifier(SomeModifier())`.
   *
   * Returns undefined — "not a custom modifier" — unless the argument is a struct
   * that conforms to `ViewModifier` and has a `body`. SwiftUI's own `.modifier` never
   * reaches here, so declining is the safe answer and the built-in path still runs.
   */
  private applyViewModifier(target: SwiftValue, call: HostCall): SwiftValue | undefined {
    const argument = call.args[0]?.value
    if (!argument || argument.kind !== 'struct') return undefined
    if (!this.conformsTo?.(argument.typeName, 'ViewModifier')) return undefined

    const content = asView(target) ?? this.expandForModifier(target, call.span)
    if (!content) return undefined

    return this.callMethod?.(argument, 'body', [view(content)])
  }

  /**
   * `Task { … }`, `Task.detached { … }` and `MainActor.run { … }`.
   *
   * The body runs now. See `TASK_TYPE` above for why that is the whole design rather
   * than a shortcut, and the coverage matrix for the limitation stated plainly.
   */
  private runTask(call: HostCall): SwiftValue {
    if (call.trailingClosure) call.invoke(call.trailingClosure)
    return opaque(TASK_TYPE, { done: true })
  }

  /**
   * Contextual member syntax, resolved without type information.
   *
   * `.largeTitle`, `.primary` and `.infinity` all resolve against an expected type
   * the interpreter does not track. Rather than guess, they become tokens carrying
   * only their name, and whoever consumes them decides what they mean — a font
   * token inside `.font()`, a colour inside `.foregroundStyle()`. `.infinity` is the
   * one exception: it is genuinely a number wherever it appears.
   */
  resolveImplicitMember(member: string): SwiftValue | undefined {
    if (member === 'infinity') return double(Number.POSITIVE_INFINITY)
    if (ANIMATION_CURVES[member]) return this.animationToken(member)
    if (TRANSITIONS.has(member)) return this.transitionToken(member)
    return token(member)
  }

  // ------------------------------------------------------------------ private

  /** True when the first argument is a collection rather than a label or a style. */
  private looksDataDriven(call: HostCall): boolean {
    const first = call.args.find((a) => a.label === null)?.value
    return first?.kind === 'array' || first?.kind === 'range'
  }

  private hasPlainTitle(call: HostCall): boolean {
    const first = call.args.find((a) => a.label === null)?.value
    return first?.kind === 'string'
  }

  /**
   * Expands `ForEach` (and the collection forms of `List` and `Picker`).
   *
   * Each element's rows are built inside an identity scope keyed by the element's
   * `id` — so `@State` inside a row follows the row's data when the collection is
   * reordered, which is the whole observable difference between identifying by
   * identity and identifying by position.
   */
  private makeDataDriven(name: string, args: readonly ViewArg[], call: HostCall): SwiftValue {
    const data = call.args.find((a) => a.label === null)?.value
    const idPath = asKeyPath(call.args.find((a) => a.label === 'id')?.value)
    const builder = call.trailingClosure!

    const elements: SwiftValue[] =
      data?.kind === 'array'
        ? [...data.elements]
        : data?.kind === 'range'
          ? rangeElements(data.lower, data.upper, data.closed)
          : []

    const children: ViewValue[] = []
    const childKeys: string[] = []

    elements.forEach((element, index) => {
      const key = identityKey(element, idPath?.components ?? null, index)
      const build = () => this.toViews(call.invokeBuilder(builder, [element]))
      const rows = this.scopeIdentity ? this.scopeIdentity(key, build) : build()

      for (const row of rows) {
        children.push(row)
        childKeys.push(key)
      }
    })

    return view({ name, args, children, modifiers: [], action: null, span: call.span, childKeys })
  }

  /**
   * `withAnimation { … }` — runs the closure, and marks what it changed as animated.
   *
   * The animation is recorded rather than applied: the change happens now, but what
   * animates is the *next* render, which is the only place a from-and-to pair exists.
   */
  private runWithAnimation(call: HostCall): SwiftValue {
    const explicit = call.args.find((a) => a.label === null)?.value
    const fromToken = tokenNameOf(explicit)

    this.pendingAnimation =
      (explicit?.kind === 'opaque' && explicit.typeName === ANIMATION_TYPE
        ? (explicit.payload as AnimationPayload)
        : null) ??
      (fromToken ? curveFor(fromToken, null) : null) ??
      DEFAULT_ANIMATION

    const body = call.trailingClosure ?? asClosure(call.args[call.args.length - 1]?.value)
    if (body) call.invoke(body)
    return { kind: 'void' }
  }

  private makeAnimation(member: string, call: HostCall): SwiftValue {
    const duration = numberOf(call.args.find((a) => a.label === 'duration')?.value)
    const payload = curveFor(member, duration) ?? DEFAULT_ANIMATION
    const delay = numberOf(call.args.find((a) => a.label === 'delay')?.value)
    return opaque(ANIMATION_TYPE, delay === null ? payload : { ...payload, delay })
  }

  private animationToken(member: string): SwiftValue {
    const payload = curveFor(member, null)
    return payload ? opaque(ANIMATION_TYPE, payload) : token(member)
  }

  private makeTransition(member: string, call: HostCall): SwiftValue {
    const edge = tokenNameOf(call.args.find((a) => a.label === 'edge')?.value)
    return opaque(TRANSITION_TYPE, {
      kind: transitionKind(member),
      ...(edge ? { edge } : {}),
    } satisfies TransitionPayload)
  }

  private transitionToken(member: string): SwiftValue {
    return opaque(TRANSITION_TYPE, { kind: transitionKind(member) } satisfies TransitionPayload)
  }

  private makeGradient(kind: GradientPayload['kind'], call: HostCall): SwiftValue {
    const colors = call.args.find((a) => a.label === 'colors')?.value
    const stops = call.args.find((a) => a.label === 'stops')?.value
    const list =
      colors?.kind === 'array'
        ? colors.elements
        : stops?.kind === 'array'
          ? stops.elements
          : call.args.filter((a) => a.label === null).map((a) => a.value)

    return opaque(STYLE_TYPE, {
      kind,
      colors: list,
      startPoint: tokenNameOf(call.args.find((a) => a.label === 'startPoint')?.value),
      endPoint: tokenNameOf(call.args.find((a) => a.label === 'endPoint')?.value),
    } satisfies GradientPayload)
  }

  /**
   * `GridItem(.adaptive(minimum: 100))` and the bare `.adaptive(minimum: 100)`.
   *
   * The size argument is itself a contextual member call, which resolves to a
   * finished `GridItem` before the enclosing initialiser ever runs. Passing it
   * straight back through is what stops the outer call flattening an adaptive track
   * into a flexible one — a silent difference that shows up only as the wrong number
   * of columns.
   */
  private makeGridItem(call: HostCall, kind?: string): SwiftValue {
    const inner = call.args.find((a) => a.label === null)?.value
    if (kind === undefined && inner?.kind === 'opaque' && inner.typeName === 'GridItem') {
      return inner
    }

    const size = numberOf(inner)
    const minimum = numberOf(call.args.find((a) => a.label === 'minimum')?.value)
    const spacing = numberOf(call.args.find((a) => a.label === 'spacing')?.value)

    return opaque('GridItem', {
      kind: kind ?? tokenNameOf(inner) ?? 'flexible',
      size: size ?? minimum ?? null,
      spacing,
    })
  }

  private makeSystemFont(call: HostCall): SwiftValue {
    const size =
      numberOf(call.args.find((a) => a.label === 'size')?.value) ??
      numberOf(call.args.find((a) => a.label === null)?.value)
    const weight = tokenNameOf(call.args.find((a) => a.label === 'weight')?.value)
    const design = tokenNameOf(call.args.find((a) => a.label === 'design')?.value)
    return token(`system:${size ?? 17}:${weight ?? 'regular'}:${design ?? 'default'}`)
  }

  private makeColor(call: HostCall): SwiftValue {
    const white = numberOf(call.args.find((a) => a.label === 'white')?.value)
    if (white !== null) return color({ name: null, white })

    const red = numberOf(call.args.find((a) => a.label === 'red')?.value)
    const green = numberOf(call.args.find((a) => a.label === 'green')?.value)
    const blue = numberOf(call.args.find((a) => a.label === 'blue')?.value)
    if (red !== null && green !== null && blue !== null) {
      const opacity = numberOf(call.args.find((a) => a.label === 'opacity')?.value)
      return color({ name: null, red, green, blue, ...(opacity !== null ? { opacity } : {}) })
    }

    const first = call.args[0]?.value
    if (first?.kind === 'string') return color({ name: first.value })

    // `Color(.systemGroupedBackground)` — the UIKit bridge, where the argument is a
    // contextual member rather than a string. This is how idiomatic SwiftUI reaches
    // the adaptive backgrounds, so it has to work for dark mode to be usable at all.
    const named = tokenNameOf(first)
    if (named) return color({ name: named })
    return color({ name: 'clear' })
  }
}

// -------------------------------------------------------------------- helpers

/** The gesture constructors, mapped to the kind of event each responds to. */
const GESTURE_CONSTRUCTORS: Readonly<Record<string, GestureKind>> = {
  DragGesture: 'drag',
  LongPressGesture: 'longPress',
  MagnificationGesture: 'magnify',
  MagnifyGesture: 'magnify',
  RotationGesture: 'rotate',
  RotateGesture: 'rotate',
  TapGesture: 'tap',
  SpatialTapGesture: 'tap',
}

/** Members that belong to `Color` itself rather than to it as a view. */
const COLOR_MEMBERS: ReadonlySet<string> = new Set(['opacity', 'gradient', 'init'])

const GRADIENTS: Readonly<Record<string, GradientPayload['kind']>> = {
  LinearGradient: 'linear',
  RadialGradient: 'radial',
  AngularGradient: 'angular',
}

const ANIMATION_CURVES: Readonly<Record<string, AnimationPayload['curve']>> = {
  linear: 'linear',
  easeIn: 'easeIn',
  easeOut: 'easeOut',
  easeInOut: 'easeInOut',
  default: 'easeInOut',
  spring: 'spring',
  bouncy: 'spring',
  snappy: 'spring',
  smooth: 'spring',
  interpolatingSpring: 'spring',
  interactiveSpring: 'spring',
}

const TRANSITIONS: ReadonlySet<string> = new Set([
  'opacity', 'slide', 'scale', 'move', 'identity', 'blurReplace', 'push',
])

const DEFAULT_ANIMATION: AnimationPayload = { curve: 'easeInOut', duration: 0.35 }

function transitionKind(member: string): TransitionPayload['kind'] {
  switch (member) {
    case 'slide':
      return 'slide'
    case 'scale':
      return 'scale'
    case 'move':
    case 'push':
      return 'move'
    case 'identity':
      return 'identity'
    default:
      return 'opacity'
  }
}

function curveFor(member: string, duration: number | null): AnimationPayload | null {
  const curve = ANIMATION_CURVES[member]
  if (!curve) return null

  // Apple's spring presets differ mostly in how much they overshoot; approximating
  // them with a duration and a bounce keeps the preview's motion recognisable
  // without pretending to reimplement the solver.
  if (curve === 'spring') {
    const bounce = member === 'bouncy' ? 0.4 : member === 'snappy' ? 0.15 : 0.25
    return { curve, duration: duration ?? (member === 'snappy' ? 0.3 : 0.55), bounce }
  }
  return { curve, duration: duration ?? 0.35 }
}

function rangeElements(lower: number, upper: number, closed: boolean): SwiftValue[] {
  const out: SwiftValue[] = []
  const end = closed ? upper : upper - 1
  // A range this long is a mistake rather than a list; capping stops one typo from
  // spending the whole step budget building views nobody will see.
  for (let i = lower; i <= end && out.length < 1_000; i++) out.push(int(i))
  return out
}

/**
 * The identity of one `ForEach` element.
 *
 * Explicit `id:` wins; then a stored `id` property, which is what `Identifiable`
 * means in practice; then the index, which is what `ForEach(0..<n)` needs and what
 * SwiftUI itself falls back to.
 */
function identityKey(
  element: SwiftValue,
  idComponents: readonly string[] | null,
  index: number,
): string {
  if (idComponents) {
    return describe(applyKeyPath({ components: idComponents }, element), true)
  }
  if (element.kind === 'struct') {
    const id = element.fields.get('id')
    if (id !== undefined) return describe(id, true)
  }
  if (element.kind === 'string' || element.kind === 'int' || element.kind === 'double') {
    return describe(element, true)
  }
  return `#${index}`
}

function pointOf(value: SwiftValue | undefined): PathPoint | null {
  if (!value || value.kind !== 'opaque') return null
  const payload = value.payload as { x?: number; y?: number }
  return typeof payload.x === 'number' && typeof payload.y === 'number'
    ? { x: payload.x, y: payload.y }
    : null
}

function rectOf(
  value: SwiftValue | undefined,
): { x: number; y: number; width: number; height: number } | null {
  if (!value || value.kind !== 'opaque') return null
  const payload = value.payload as Record<string, number>
  if (typeof payload.width !== 'number' || typeof payload.height !== 'number') return null
  return {
    x: payload.x ?? 0,
    y: payload.y ?? 0,
    width: payload.width,
    height: payload.height,
  }
}

/** `.degrees(90)` / `.radians(…)`, as `addArc`'s angles are written. */
function angleOf(value: SwiftValue | undefined): number {
  const name = tokenNameOf(value)
  if (name?.startsWith('degrees:')) return Number(name.split(':')[1])
  if (name?.startsWith('radians:')) return (Number(name.split(':')[1]) * 180) / Math.PI
  return numberOf(value) ?? 0
}

function asClosure(value: SwiftValue | undefined): ClosureValue | null {
  return value?.kind === 'closure' ? value : null
}

export { isView, asView, str }
export type { ClosureValue }
