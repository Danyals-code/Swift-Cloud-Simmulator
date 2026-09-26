import type { LogLevel, SourceSpan } from '@studio/shared'
import { hasCornerRadii } from '@studio/shared'
import {
  asKeyPath,
  readKeyPath,
  bool,
  describe,
  identityKey,
  double,
  int,
  asProjection,
  copyValue,
  dateValue,
  NIL,
  opaque,
  projection,
  str,
  type ClosureValue,
  type HostCall,
  type CallArgument,
  truthy,
  SwiftTrap,
  PreviewLimitExceeded,
  PREVIEW_LIMITS,
  type InterpreterHost,
  type SwiftValue,
} from '@studio/swift-runtime'
import { LEGACY_STYLE_TOKENS, SUPPORTED_VIEWS, UNIMPLEMENTED_VIEWS, isKnownGlobal } from '@studio/swift-sema'
import { ZERO_INSETS } from '@studio/swiftui-layout'
import { ConsoleBuffer, type ConsoleLine } from './console-buffer'
import { CORNER_NAMES, cornerRadii, largestCorner } from './corners'
import { containable, toFailure } from './failures'
import { colorForName, fontForToken } from './style'
import { DISMISS_TYPE, EnvironmentStack, OPEN_URL_TYPE } from './view-environment'
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
  RECT_TYPE,
  size,
  withHandler,
  withUpdate,
  type GestureKind,
} from './gestures'
import {
  asView,
  ANIMATION_TYPE,
  BUTTON_CONFIGURATION_TYPE,
  COLOR_TYPE,
  stoppedView,
  EDGE_INSETS_TYPE,
  DIMENSIONS_TYPE,
  GEOMETRY_TYPE,
  SCROLL_PROXY_TYPE,
  isView,
  STROKE_STYLE_TYPE,
  STYLE_TYPE,
  TOKEN_TYPE,
  TRANSITION_TYPE,
  VIEW_TYPE,
  type ActionValue,
  type AnimationPayload,
  type ButtonConfigurationPayload,
  type ColorPayload,
  type EdgeInsetsPayload,
  type GeometryPayload,
  type GradientPayload,
  type ModifierValue,
  type StrokeStylePayload,
  type TokenPayload,
  type TransitionPayload,
  type ViewArg,
  type ViewValue,
} from './view-value'

/** Every name the host will build a view for - implemented or not. */
const VIEW_NAMES: ReadonlySet<string> = new Set([
  ...SUPPORTED_VIEWS,
  ...UNIMPLEMENTED_VIEWS,
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
 * action - with a title argument it is the destination (`NavigationLink("More") {
 * Detail() }`, the form most code still uses), and without one it is the label. That
 * ambiguity is resolved in `callGlobal`.
 */
const ACTION_VIEWS: ReadonlySet<string> = new Set(['Button'])

/**
 * Labelled trailing closures that carry content rather than behaviour.
 *
 * `Button { save() } label: { Text("Save") }` and `Section { rows } header: { … }`
 * are the Swift 5.3 spelling, and the label is the only thing that says which part
 * of the view each closure is.
 */
const CONTENT_CLOSURE_LABELS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['Button', new Set(['label'])],
  ['Menu', new Set(['label'])],
  ['Label', new Set(['icon'])],
  ['Tab', new Set(['label'])],
  ['Section', new Set(['header', 'footer'])],
  ['Toggle', new Set(['label'])],
  ['Picker', new Set(['label'])],
  ['Stepper', new Set(['label'])],
  ['NavigationLink', new Set(['label'])],
  ['DisclosureGroup', new Set(['label'])],
  ['GroupBox', new Set(['label'])],
  ['LabeledContent', new Set(['label'])],
  ['Gauge', new Set(['currentValueLabel', 'minimumValueLabel', 'maximumValueLabel'])],
])

/**
 * What `.environmentObject(store)`, `.environment(\.key, value)` and `.environment(model)`
 * put in scope for the views below them. An object is kept by its type, which is how
 * `@EnvironmentObject` and `@Environment(Model.self)` find it again.
 */
function injectedEnvironment(member: string, args: readonly { readonly value: SwiftValue }[]): { values: [string, SwiftValue][]; objects: [string, SwiftValue][] } {
  const values: [string, SwiftValue][] = []
  const objects: [string, SwiftValue][] = []
  const first = args[0]?.value
  const key = member === 'environment' ? asKeyPath(first)?.components[0] : undefined
  const second = args[1]?.value
  if (key && second) values.push([key, second])
  else if (first?.kind === 'struct' && (member === 'environmentObject' || member === 'environment' && first.reference)) objects.push([first.typeName, first])
  return { values, objects }
}

const EDGE_LABELS: ReadonlySet<string> = new Set(['top', 'leading', 'bottom', 'trailing'])

/** `EdgeInsets(top:leading:bottom:trailing:)`, any edge left out being 0. */
function edgeInsets(call: HostCall): SwiftValue {
  const edge = (label: string): number => numberOf(call.args.find((a) => a.label === label)?.value) ?? 0
  return opaque(EDGE_INSETS_TYPE, { top: edge('top'), leading: edge('leading'), bottom: edge('bottom'), trailing: edge('trailing') } satisfies EdgeInsetsPayload)
}

/** Names that are types rather than views: `Color.red`, `Font.title`. */
const NAMESPACES: ReadonlySet<string> = new Set([
  'Color', 'Font', 'Alignment', 'Edge', 'Edge.Set', 'Angle', 'UnitPoint', 'Axis',
  'Animation', 'AnyTransition', 'Text', 'Image', 'ContentMode',
  'HorizontalAlignment', 'VerticalAlignment', 'PresentationDetent', 'ToolbarItemPlacement',
  'CGSize', 'CGPoint', 'CGRect', 'CGFloat', 'Material',
  'Task', 'MainActor', 'Gradient', 'StrokeStyle',
  // `Color(UIColor.systemGray6)`: UIKit's colours, bridged by name like `Color(.systemGray6)`.
  'UIColor',
])

/**
 * `Material.ultraThin` and `.ultraThinMaterial` are the same value.
 *
 * The type's members drop the suffix the contextual spelling carries, and the
 * renderer knows only the contextual one - so the spelling is normalised here rather
 * than teaching the material table two names for each.
 */
const MATERIAL_MEMBERS: Readonly<Record<string, string>> = {
  ultraThin: 'ultraThinMaterial',
  thin: 'thinMaterial',
  regular: 'regularMaterial',
  thick: 'thickMaterial',
  ultraThick: 'ultraThickMaterial',
  bar: 'bar',
}

/**
 * The concurrency surface, run synchronously.
 *
 * One rule covers all of it: **the preview has no concurrency, so everything async
 * runs immediately and in order.** `.task` has worked this way since Phase 7, `await`
 * is transparent, and `Task { … }` runs its body where it is written.
 *
 * That is a real limitation and it is stated rather than hidden. The alternative -
 * deferring a `Task` body and re-rendering, or splitting one at a `Task.sleep` - needs
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

/**
 * Whether a view may take part in a `Text` concatenation.
 *
 * Only `Text` itself, and only because Swift's `+` on views is declared on `Text`
 * alone. Accepting a `VStack` here would build a Text whose spans have no text and
 * quietly draw nothing, which is the kind of silent wrong the preview exists to
 * avoid - so it declines and the operator reports itself instead.
 */
function isTextLike(v: ViewValue | null): boolean {
  return v?.name === 'Text'
}

/** The words of a `Text`, joined or not, without its styling. */
function plainText(text: ViewValue): string {
  if (text.children.length > 0) return text.children.map(plainText).join('')
  const words = text.args.find((arg) => arg.label === null || arg.label === 'verbatim')?.value
  return words?.kind === 'string' ? words.value : ''
}

function token(name: string): SwiftValue {
  return opaque(TOKEN_TYPE, { name })
}

function color(payload: ColorPayload): SwiftValue {
  return opaque(COLOR_TYPE, payload)
}

/**
 * A `Button`'s `action:` argument: `Button("Save", action: save)`, and Xcode's own
 * `Button(action: { … }) { Label(…) }`, whose trailing closure is then the label. A
 * function named as a value arrives as a function rather than a closure.
 */
function actionArgument(name: string, call: HostCall): ActionValue | null {
  if (!ACTION_VIEWS.has(name)) return null
  const value = call.args.find((a) => a.label === 'action')?.value
  return value?.kind === 'closure' || value?.kind === 'function' ? value : null
}

/** Modifiers that run something when an event happens, rather than drawing anything. */
const EVENT_MODIFIERS: ReadonlySet<string> = new Set([
  'onAppear', 'onDisappear', 'task', 'onChange', 'onDelete', 'onTapGesture', 'onLongPressGesture', 'onSubmit',
])

/**
 * What an event modifier was given to run when no trailing closure was written:
 * `perform:` or `action:`, or the unlabelled argument of `.task(load)` and
 * `.onSubmit(save)`, as a closure or as a function named as a value.
 */
function eventArgument(call: HostCall): ActionValue | null {
  const argument =
    call.args.find((a) => a.label === 'perform' || a.label === 'action') ??
    call.args.find((a) => a.label === null && (a.value.kind === 'closure' || a.value.kind === 'function'))
  const value = argument?.value
  return value?.kind === 'closure' || value?.kind === 'function' ? value : null
}

function toArgs(call: HostCall): ViewArg[] {
  return call.args.map((a) => ({ label: a.label, value: a.value }))
}

/**
 * The views and modifiers whose first unlabelled argument is a title, a
 * `LocalizedStringKey`, when it is written as a string literal. Such a title writes a
 * number put into it for the locale: `Text("Goal: \\(goal) mL")` reads "Goal: 2,000 mL"
 * in the iOS 27 simulator, and a Double shows six decimals. A String, `Text(verbatim:)`
 * and the project's own views keep Swift's text, "2000", as they do on iOS.
 */
const TITLED_VIEWS = new Set([
  'Text', 'Label', 'Button', 'Toggle', 'Section', 'TextField', 'SecureField', 'Picker', 'Stepper', 'Link', 'Menu',
  'NavigationLink', 'LabeledContent', 'ContentUnavailableView', 'ProgressView', 'DatePicker', 'Tab', 'DisclosureGroup', 'ColorPicker',
])
const TITLED_MODIFIERS = new Set(['navigationTitle', 'alert', 'confirmationDialog', 'badge', 'help'])

/** `call` with its title as a title writes it, when `titled` and the interpreter wrote one. */
function withTitleText(titled: boolean, call: HostCall): HostCall {
  if (!titled) return call
  const index = call.args.findIndex((arg) => arg.title !== undefined)
  if (index < 0) return call
  const args = [...call.args]
  args[index] = { ...args[index]!, value: str(args[index]!.title!) }
  return { ...call, args }
}

function numberOf(value: SwiftValue | undefined): number | null {
  if (!value) return null
  return value.kind === 'int' || value.kind === 'double' ? value.value : null
}

/** The darker stop of a `.gradient`, at roughly the contrast SwiftUI's own uses. */
function dimmed(payload: ColorPayload): SwiftValue {
  return color({ ...payload, shade: (payload.shade ?? 1) * 0.7 })
}

function tokenNameOf(value: SwiftValue | undefined): string | null {
  if (!value || value.kind !== 'opaque' || value.typeName !== TOKEN_TYPE) return null
  return (value.payload as TokenPayload).name
}

/**
 * Turns evaluated Swift into a view tree.
 *
 * This is the whole of `swift-runtime`'s SwiftUI knowledge - the interpreter itself
 * has none, and the ESLint boundary rule would reject the import if it tried. Every
 * view, colour and modifier the preview understands is defined here, which also
 * means the coverage matrix has exactly one place to be wrong.
 */
export class SwiftUIHost implements InterpreterHost {
  private readonly console = new ConsoleBuffer()

  /**
   * Expands a user-declared `View` struct into its evaluated body.
   *
   * Supplied by the pipeline, because expansion needs the interpreter and this class
   * must not hold one - it is the interpreter's *host*, not its owner. Without it,
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
  builderIdentity: (<T>(slot: string, branch: string, fn: () => T) => T) | null = null

  withBuilderScope(slot: string, branch: string, build: () => SwiftValue[]): readonly SwiftValue[] {
    const expand = () => this.toViews(build()).map(value => view(value))
    return this.builderIdentity ? this.builderIdentity(slot, branch, expand) : expand()
  }

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
   * Whether the project declared a type by this name. Supplied with `conformsTo`.
   *
   * The host answers for a lot of names on the strength of the name alone, and
   * several of them are ones an app would reasonably declare for itself: `Tab`,
   * `Settings`, `Marker`, `Table`, `Annotation`. Without this, `enum Tab { case home }`
   * - which is how the selection for a `TabView` is written - had `Tab.allCases`
   * answer with a *view*, and the failure surfaced two members later as "Value of type
   * 'View' has no member 'count'".
   */
  declaresType: ((typeName: string) => boolean) | null = null

  /**
   * Calls a method the project declared in `extension View`.
   *
   * `extension View { func cardStyle() -> some View { … } }` is how nearly every real
   * SwiftUI codebase names a reusable modifier chain, and the receiver is a *view* -
   * `Text("x").cardStyle()` - not a struct whose own type declares the method. So the
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
   * What each `GeometryReader` was measured at on the previous layout pass: its size,
   * where it is on the screen and its safe area.
   *
   * Empty on the first pass of a new screen, which is why `defaultGeometry` exists:
   * a reader has to report *something* the first time, and the content rect is the
   * closest guess available before anything has been laid out.
   */
  geometry: ReadonlyMap<string, GeometryPayload> = new Map()
  defaultGeometry = { width: 393, height: 759 }

  /** Per-pass counter, so two readers on one source line get distinct keys. */
  private geometryOrdinals = new Map<string, number>()
  private constructedViews = 0

  /** Scope the entire receiver expression, including children built eagerly inside stacks. */
  withMemberScope(member: string, args: readonly CallArgument[], evaluate: () => SwiftValue): SwiftValue {
    const first = args[0]?.value
    // `.id(x)`: what the receiver builds is a different view for each x, so its state
    // starts over when x changes, as SwiftUI's does.
    if (member === 'id' && first && args.length === 1 && this.scopeIdentity) return this.scopeIdentity(`id:${identityKey(first)}`, evaluate)
    const { values, objects } = injectedEnvironment(member, args)
    if (member === 'disabled' && first) {
      values.push(['isEnabled', bool(!truthy(first) && truthy(this.environment.value('isEnabled') ?? bool(true)))])
    } else if ((member === 'controlSize' || member === 'font' || member === 'dynamicTypeSize') && first) {
      values.push([member, first])
    }
    return values.length || objects.length ? this.environment.scoped(values, objects, evaluate) : evaluate()
  }

  beginPass(): void {
    this.constructedViews = 0
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
   * greedy - its size is its proposal, and the proposal does not depend on what the
   * closure built.
   */
  private makeGeometryReader(call: HostCall): SwiftValue {
    const key = this.measuredSite(`g${call.span.start}`)
    const measured: GeometryPayload = this.geometry.get(key) ?? { ...this.defaultGeometry, x: 0, y: 0, insets: ZERO_INSETS }
    const proxy = opaque(GEOMETRY_TYPE, measured)

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
   * A key for one site that needs to know the size it was given.
   *
   * The same site expands more than once - a reader inside a `ForEach` - so the
   * ordinal keeps each occurrence's measurement apart. Shared with the shape
   * expansion below, which has exactly the same ordering problem.
   */
  private measuredSite(site: string): string {
    const ordinal = this.geometryOrdinals.get(site) ?? 0
    this.geometryOrdinals.set(site, ordinal + 1)
    return ordinal === 0 ? site : `${site}#${ordinal}`
  }

  /**
   * A user type conforming to `Shape`, as something that can be drawn.
   *
   * `struct Arc: Shape { func path(in rect: CGRect) -> Path }` is how real SwiftUI
   * code writes a shape, and it needs the one thing the interpreter cannot have: the
   * rect it is about to be laid out in. That is the same ordering problem
   * `GeometryReader` has, so it gets the same answer - the size measured last pass,
   * with the pipeline running a second one when the guess was wrong.
   *
   * The result is a greedy container holding the `Path` the shape drew, which is
   * exactly what a shape is: it fills what it is given.
   */
  shapeAsView(target: SwiftValue, span: SourceSpan): ViewValue | null {
    if (target.kind !== 'struct') return null
    if (!this.conformsTo?.(target.typeName, 'Shape') || !this.callMethod) return null

    const key = this.measuredSite(`shape${span.start}`)
    const size = this.geometry.get(key) ?? this.defaultGeometry
    const rect = opaque(RECT_TYPE, { x: 0, y: 0, width: size.width, height: size.height })

    const drawn = this.callMethod(target, 'path', [rect])
    if (!drawn || !asPath(drawn)) return null

    const path: ViewValue = {
      name: 'Path',
      args: [{ label: null, value: drawn }],
      children: [],
      modifiers: [],
      action: null,
      span,
    }

    return {
      name: 'ShapeView',
      args: [],
      children: [path],
      modifiers: [],
      action: null,
      span,
      geometryKey: key,
    }
  }

  /**
   * A modifier written on a custom shape.
   *
   * Two kinds, and they belong in different places. `.fill`, `.stroke` and `.trim`
   * are the shape's own - they change what is drawn, so they go on the `Path` - while
   * `.frame`, `.padding` and everything else are view modifiers and belong on the
   * container, or a `.frame(width: 160)` would leave the shape greedy and the ring
   * would fill the screen.
   *
   * Returns null when the target is not a shape at all, so every other dispatch below
   * is untouched.
   */
  private shapeModifier(target: SwiftValue, member: string, call: HostCall): SwiftValue | null {
    const existing = asView(target)
    const container =
      existing?.name === 'ShapeView' ? existing : this.shapeAsView(target, call.span)
    if (!container) return null

    const modifier = this.makeModifier(member, call)
    if (!SHAPE_MEMBERS.has(member)) {
      return view({ ...container, modifiers: [...container.modifiers, modifier] })
    }

    const drawn = container.children[0]
    if (!drawn) return null
    return view({
      ...container,
      children: [{ ...drawn, modifiers: [...drawn.modifiers, modifier] }],
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
   * draw. That makes a canvas a list of vector paths rather than a bitmap - which
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
   * Direct custom views expand here; children already constructed by the receiver
   * were evaluated under withMemberScope. Keep the modifier for inspection.
   */
  private withInjectedEnvironment(
    target: SwiftValue,
    member: string,
    call: HostCall,
  ): SwiftValue | undefined {
    const { values, objects } = injectedEnvironment(member, call.args)
    const modifier = this.makeModifier(member, call)

    return this.environment.scoped(values, objects, () => {
      const base = asView(target) ?? this.expandForModifier(target, call.span)
      if (!base) return undefined
      return view({ ...base, modifiers: [...base.modifiers, modifier] })
    })
  }

  /**
   * Collected builder results, with user views expanded and non-views dropped.
   *
   * A `Color` is a `View` in SwiftUI - `VStack { Color.red }` paints a red panel -
   * so a colour reaching a builder is wrapped rather than discarded. Dropping it was
   * silent, which is the failure mode this project refuses: the code looked honoured
   * and drew nothing.
   */
  /**
   * Every value a view builder can produce, as views.
   *
   * Public because the runtime's own builders need the same conversion: a `Color` and
   * a `Path` are views without being view *values*, and a builder that only accepts
   * the latter drops them. `var body: some View { Color.blue }` drew nothing at all
   * for exactly that reason - the canonical one-liner for filling a screen.
   */
  toViews(values: readonly SwiftValue[]): ViewValue[] {
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

  takeLogs(): ConsoleLine[] {
    return this.console.drain()
  }

  /**
   * A line for the console.
   *
   * The level matters more than it looks. Everything used to arrive as `log`, which
   * meant "Action failed: Index out of range" was painted in the same grey as a
   * `print` - so a tap that crashed looked exactly like a tap that worked and said
   * something. The console already styles errors; it had nothing to style.
   */
  log(message: string, span: SourceSpan, level: LogLevel = 'log'): void {
    this.console.write({ message, span, level })
  }

  resolveGlobal(name: string): SwiftValue | undefined {
    if (GESTURE_CONSTRUCTORS[name]) return { kind: 'type', name }
    if (NAMESPACES.has(name)) return { kind: 'type', name }
    // A view referenced without a call, e.g. passed as a value.
    if (VIEW_NAMES.has(name)) return { kind: 'type', name }
    return undefined
  }

  callGlobal(name: string, call: HostCall): SwiftValue | undefined {
    call = withTitleText(TITLED_VIEWS.has(name), call)
    // Values first: these are not views, so they have to be handled before the
    // "is this a view name?" guard below rejects them.
    if (name === 'Task') return this.runTask(call)
    if (name === 'Binding') return this.makeBinding(call)
    // `UIColor(red:green:blue:alpha:)` is a colour like any other, bridged by `Color(uiColor:)`.
    if (name === 'Color' || name === 'UIColor') return this.makeColor(call)
    if (name === 'withAnimation') return this.runWithAnimation(call)
    if (GRADIENTS[name]) return this.makeGradient(GRADIENTS[name]!, call)
    if (name === 'GridItem') return this.makeGridItem(call)
    if (name === 'Gradient') return opaque('Gradient', this.gradientStops(call))
    if (name === 'Gradient.Stop') return this.gradientStop(call)

    if (name === 'Angle') {
      const arg = call.args.find(a => a.label === 'degrees' || a.label === 'radians')
      return token(`${arg?.label ?? 'degrees'}:${numberOf(arg?.value) ?? 0}`)
    }
    if (name === 'CGSize') {
      return size(
        numberOf(call.args.find((a) => a.label === 'width')?.value) ?? 0,
        numberOf(call.args.find((a) => a.label === 'height')?.value) ?? 0,
      )
    }

    if (name === 'CGPoint' || name === 'UnitPoint') {
      return point(
        numberOf(call.args.find((a) => a.label === 'x')?.value) ?? 0,
        numberOf(call.args.find((a) => a.label === 'y')?.value) ?? 0,
      )
    }

    // `.padding(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))` - the form
    // that sets all four edges to different lengths, and the only one `.padding` has
    // no shorthand for.
    if (name === 'EdgeInsets') return edgeInsets(call)
    if (name === 'RectangleCornerRadii') return cornerRadii(call.args)

    if (name === 'StrokeStyle') {
      const dash = call.args.find((a) => a.label === 'dash')?.value
      return opaque(STROKE_STYLE_TYPE, {
        lineWidth: numberOf(call.args.find((a) => a.label === 'lineWidth')?.value) ?? 1,
        lineCap: (tokenNameOf(call.args.find(a => a.label === 'lineCap')?.value) ?? 'butt') as StrokeStylePayload['lineCap'],
        lineJoin: (tokenNameOf(call.args.find(a => a.label === 'lineJoin')?.value) ?? 'miter') as StrokeStylePayload['lineJoin'],
        miterLimit: numberOf(call.args.find(a => a.label === 'miterLimit')?.value) ?? 10,
        dashPhase: numberOf(call.args.find(a => a.label === 'dashPhase')?.value) ?? 0,
        dash:
          dash?.kind === 'array'
            ? dash.elements.map((e) => numberOf(e) ?? 0).filter((n) => n >= 0)
            : [],
      } satisfies StrokeStylePayload)
    }

    if (name === 'CGRect') {
      return opaque(RECT_TYPE, {
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

    // `PlainButtonStyle()` is the style `.plain` names.
    const legacy = LEGACY_STYLE_TOKENS.get(name)
    if (legacy) return token(legacy)

    if (!VIEW_NAMES.has(name)) {
      // A view nothing declares, which the checker has warned about, is a placeholder
      // named after it. What it was given is never run: there is no telling what it
      // would have done with it.
      if (!/^[A-Z]/.test(name) || isKnownGlobal(name)) return undefined
      return view({ name, args: toArgs(call), children: [], modifiers: [], action: null, span: call.span })
    }
    if (++this.constructedViews > PREVIEW_LIMITS.totalViews) throw new PreviewLimitExceeded('The preview exceeds 10,000 constructed views in one pass. Reduce nested collections or preview data.', call.span)

    // A direct destination may be a user-defined View value, not a built-in view.
    // Expand it with the same path used for destination builder closures.
    const args = name === 'NavigationLink' ? toArgs(call).flatMap(argument => argument.label === 'destination'
      ? this.destinationArgs(() => [argument.value], call.span)
      : [argument]) : toArgs(call)

    if (DATA_DRIVEN_VIEWS.has(name) && call.trailingClosure && this.looksDataDriven(call)) {
      return this.makeDataDriven(name, args, call)
    }

    // `AsyncImage(url:) { image in … } placeholder: { … }`. The content closure takes
    // the loaded image, which there is never going to be - the worker has no network -
    // so running it would hand the user's code a nil where an `Image` belongs. Only
    // the placeholder is built, which is what a real device shows first anyway.
    if (name === 'AsyncImage') {
      const placeholder = call.args.find((a) => a.label === 'placeholder')?.value
      return view({
        name,
        args,
        children: placeholder?.kind === 'closure' ? this.toViews(call.invokeBuilder(placeholder)) : [],
        modifiers: [],
        action: null,
        span: call.span,
      })
    }

    /**
     * `AnyView(someView)` - erasure, which at runtime is its content and nothing else.
     *
     * The content arrives as an *argument* rather than as a trailing closure, and the
     * layout flattens this view by walking its children - so with nothing moved
     * across, an erased view drew nothing at all. There is no type here to erase; the
     * wrapper exists only so the layout can see through it.
     */
    if (name === 'AnyView') {
      const content = call.args.find((a) => a.label === null)?.value
      return view({
        name,
        args: [],
        children: content ? this.toViews([content]) : [],
        modifiers: [],
        action: null,
        span: call.span,
      })
    }

    // `Text("\(Text("Bold").bold()) and plain")` arrives already joined, as a Text.
    const given = call.args[0]
    if (name === 'Text' && given?.label === null && given.value.kind === 'string' && given.value.styled) return given.value.styled
    if (name === 'Path') return this.makePath(call)
    if (name === 'Canvas' && call.trailingClosure) return this.makeCanvas(call)
    if (name === 'GeometryReader' && call.trailingClosure) return this.makeGeometryReader(call)
    // Content handed one value, drawn at rest: a reader's proxy, an animator's first
    // phase, a keyframe animator's initial value. What would move them never runs.
    const handed = name === 'ScrollViewReader' ? opaque(SCROLL_PROXY_TYPE, null)
      : name === 'PhaseAnimator' ? firstPhase(call.args.find((a) => a.label === null)?.value)
      : name === 'KeyframeAnimator' ? call.args.find((a) => a.label === 'initialValue')?.value
      : undefined
    if (handed !== undefined && call.trailingClosure) {
      return view({ name, args: [], children: this.toViews(call.invokeBuilder(call.trailingClosure, [handed])), modifiers: [], action: null, span: call.span })
    }
    // `TimelineView(...) { context in ... }`: drawn once, for the moment of the render.
    if (name === 'TimelineView' && call.trailingClosure) {
      const context: SwiftValue = { kind: 'struct', typeName: 'TimelineViewDefaultContext', fields: new Map<string, SwiftValue>([['date', dateValue(Date.now() / 1000)], ['cadence', token('live')]]) }
      return view({ name, args: toArgs(call), children: this.toViews(call.invokeBuilder(call.trailingClosure, [context])), modifiers: [], action: null, span: call.span })
    }

    // A labelled closure argument that names content: `Button { … } label: { … }`,
    // `Menu { … } label: { … }`, `Section { … } header: { … } footer: { … }`. Swift
    // 5.3 spells these as trailing closures, and the parser hands them over as
    // ordinary labelled arguments - so the view is built from them the same way it
    // would be from a content closure.
    const contentClosures = CONTENT_CLOSURE_LABELS.get(name)
    if (contentClosures) {
      const named = call.args.filter(
        (a) => a.label !== null && contentClosures.has(a.label) && a.value.kind === 'closure',
      )
      if (named.length > 0) {
        return this.viewWithNamedContent(name, call, args, named)
      }
    }

    const isAction =
      ACTION_VIEWS.has(name) &&
      (call.args.some((a) => a.label === null) ||
        // `Button { save() } label: { Text("Save") }` - the label is elsewhere, so the
        // trailing closure is the action even though no plain title was given.
        call.args.some((a) => a.label === 'label'))

    // `NavigationLink("Title") { Destination() }` - a title plus a trailing closure
    // means the closure is the destination, not the label.
    if (name === 'NavigationLink' && call.trailingClosure && this.hasPlainTitle(call)) {
      const destination = call.trailingClosure
      return view({
        name,
        args: [...args, ...this.destinationArgs(() => call.invokeBuilder(destination), call.span)],
        children: [],
        modifiers: [],
        action: null,
        span: call.span,
      })
    }

    // Content closures are result builders: `VStack { a; b }` yields two children,
    // and an `if` inside contributes only the taken branch.
    //
    // Not for a view the preview does not draw. Its children are discarded in favour
    // of a placeholder, so running the closure can only have side effects - and a
    // closure that takes a parameter the caller cannot supply gets `nil` and traps.
    // `TableColumn("Name") { row in Text(row.name) }` took the whole preview down
    // that way: a view listed as *unimplemented* stopped the screen rather than
    // drawing the labelled box that listing promises.
    const children =
      call.trailingClosure && !isAction && !UNIMPLEMENTED_VIEWS.has(name)
        ? this.toViews(call.invokeBuilder(call.trailingClosure))
        : []

    return view({
      name,
      args,
      children,
      modifiers: [],
      action: actionArgument(name, call) ?? (isAction ? call.trailingClosure : null),
      span: call.span,
    })
  }

  /**
   * A view whose content arrived as labelled trailing closures.
   *
   * Each labelled closure is expanded where it stands and its views become children,
   * carrying the label so the layout can tell a `header:` from a `footer:`. The
   * unlabelled trailing closure keeps its usual meaning: content for a `Section`, the
   * action for a `Button`.
   */
  private viewWithNamedContent(
    name: string,
    call: HostCall,
    args: ViewArg[],
    named: readonly { label: string | null; value: SwiftValue }[],
  ): SwiftValue {
    const isAction = ACTION_VIEWS.has(name)
    const content = call.trailingClosure && !isAction ? call.trailingClosure : null
    // In `NavigationLink { Detail() } label: { Card() }`, only Card belongs on the
    // current screen. Detail is the link's destination, for the presentation resolver
    // to select after a push.
    const destination = name === 'NavigationLink' && content ? this.destinationArgs(() => call.invokeBuilder(content), call.span) : null
    const children = content && !destination ? this.toViews(call.invokeBuilder(content)) : []

    const labelled: ViewArg[] = []
    for (const argument of named) {
      const produced = this.toViews(call.invokeBuilder(argument.value as ClosureValue))
      for (const item of produced) labelled.push({ label: argument.label, value: view(item) })
    }

    if (name === 'NavigationLink') {
      return view({
        name,
        args: [...args.filter((a) => !named.some((n) => n.label === a.label)), ...(destination ?? [])],
        children: labelled.flatMap((argument) => {
          const child = asView(argument.value)
          return child ? [child] : []
        }),
        modifiers: [],
        action: null,
        span: call.span,
      })
    }

    return view({
      name,
      args: [...args.filter((a) => !named.some((n) => n.label === a.label)), ...labelled],
      children,
      modifiers: [],
      action: actionArgument(name, call) ?? (isAction ? call.trailingClosure : null),
      span: call.span,
    })
  }

  callMember(target: SwiftValue, member: string, call: HostCall): SwiftValue | undefined {
    call = withTitleText(TITLED_MODIFIERS.has(member), call)
    if (target.kind === 'type' && (target.name === 'Gradient' && member === 'Stop' || target.name === 'Gradient.Stop' && member === 'init')) return this.gradientStop(call)
    // `Edge.Set([.top, .leading])` and `Edge.Set(.top)` are the set they are given.
    if (target.kind === 'type' && (target.name === 'Edge' && member === 'Set' || target.name === 'Edge.Set' && member === 'init')) return call.args[0]?.value ?? { kind: 'array', elements: [] }
    // `.modifier(Shadowed())` - a custom `ViewModifier`. Its `body(content:)` takes
    // the view it is applied to and returns a new one, so the content is handed over
    // as a value: inside the modifier, `content.padding()` is then an ordinary
    // modifier on an ordinary view, with nothing special about it at all.
    if (member === 'modifier') {
      const applied = this.applyViewModifier(target, call)
      if (applied !== undefined) return applied
    }

    // `proxy.scrollTo(id)`: there is no channel from the worker to the browser's scroll
    // position, so it does nothing, and the checker says so at the reader.
    if (target.kind === 'opaque' && target.typeName === SCROLL_PROXY_TYPE && member === 'scrollTo') return { kind: 'void' }

    // `geo.frame(in: .local)` is the proxy's own rectangle, and `.global` where it is on
    // the screen, as the last layout pass placed it. A named space is read as the
    // screen too: the preview doesn't track `.coordinateSpace(name:)`.
    if (target.kind === 'opaque' && target.typeName === GEOMETRY_TYPE && member === 'frame') {
      const { width, height, x: screenX, y: screenY } = target.payload as GeometryPayload
      const local = tokenNameOf(call.args[0]?.value) === 'local'
      const x = local ? 0 : screenX, y = local ? 0 : screenY
      return opaque(RECT_TYPE, {
        x,
        y,
        width,
        height,
        minX: x,
        minY: y,
        midX: x + width / 2,
        midY: y + height / 2,
        maxX: x + width,
        maxY: y + height,
        origin: point(x, y),
        size: size(width, height),
      })
    }

    // `.opacity.combined(with: .slide)`.
    if (target.kind === 'opaque' && target.typeName === TRANSITION_TYPE && member === 'combined') {
      const other = call.args.find((a) => a.label === 'with')?.value
      const payload = target.payload as TransitionPayload
      const added = other?.kind === 'opaque' && other.typeName === TRANSITION_TYPE
        ? (other.payload as TransitionPayload).kind
        : null
      return opaque(TRANSITION_TYPE, {
        ...payload,
        ...(added ? { combinedWith: [...(payload.combinedWith ?? []), added] } : {}),
      } satisfies TransitionPayload)
    }

    // `.easeInOut.repeatForever(autoreverses: true)`, `.delay(0.2)`, `.speed(2)`. A delay
    // and a speed change the one animation the preview plays. A repeat plays once here,
    // as the checker's warning beside it says; without these the view stopped instead.
    if (target.kind === 'opaque' && target.typeName === ANIMATION_TYPE) {
      const payload = target.payload as AnimationPayload
      const amount = numberOf(call.args[0]?.value)
      if (member === 'delay') return opaque(ANIMATION_TYPE, { ...payload, delay: amount ?? 0 } satisfies AnimationPayload)
      if (member === 'speed') return amount !== null && amount > 0 ? opaque(ANIMATION_TYPE, { ...payload, duration: payload.duration / amount } satisfies AnimationPayload) : target
      if (member === 'repeatForever' || member === 'repeatCount') return target
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
    // touches the target - by which point a struct would already have been expanded.
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
    // original is untouched - SwiftUI modifiers are value-semantic too.
    //
    // A user-declared view arrives here as a plain struct, because the interpreter
    // has no idea it is a view. `TodayView().tabItem { … }` is entirely ordinary
    // SwiftUI, so the struct is expanded into the views its `body` produces and the
    // modifier applied to those - a struct with no `body` expands to nothing and
    // falls through to the interpreter's own "no such member" reporting.
    // Before the general view path: a shape's `.stroke` has to land on the path it
    // draws, and a shape's `.frame` on the box it draws into.
    const shaped = this.shapeModifier(target, member, call)
    if (shaped) return shaped

    const base = asView(target) ?? this.expandForModifier(target, call.span)
    if (base) {
      if (base.name === 'Tab' && ['font', 'foregroundStyle', 'foregroundColor', 'background', 'padding', 'frame', 'cornerRadius', 'clipShape', 'opacity', 'offset', 'border', 'shadow', 'blur', 'bold', 'italic', 'underline', 'strikethrough', 'tracking', 'lineSpacing', 'lineLimit', 'multilineTextAlignment', 'rotationEffect', 'scaleEffect'].includes(member)) {
        throw new SwiftTrap(`Tab is TabContent, not a View. Apply .${member} to the view inside the tab.`, call.span)
      }
      return view({ ...base, modifiers: [...base.modifiers, this.makeModifier(member, call)] })
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

    // `context.fill(path, with: .color(.red))` - the Canvas drawing API. The context
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
      // `.onEnded { … }`, or `.onEnded(tapped)` naming a function.
      const last = call.args[call.args.length - 1]?.value
      const action = call.trailingClosure ?? (last?.kind === 'closure' || last?.kind === 'function' ? last : null)

      if ((member === 'onChanged' || member === 'onEnded') && action) {
        return withHandler(chain, { phase: member === 'onChanged' ? 'changed' : 'ended', action })
      }
      if (member === 'updating' && action) {
        const binding = call.args.find((a) => a.label === null)?.value
        if (binding) return withUpdate(chain, { binding, action })
      }
      if (member === 'simultaneously' || member === 'exclusively' || member === 'sequenced') {
        const other = asGesture(call.args[0]?.value)
        return other ? combined(chain, other) : target
      }
      return target
    }

    // ShapeStyle opacity must remain a value: it can be passed to fill/background
    // as well as used on a gradient view.
    if (member === 'opacity' && target.kind === 'opaque' &&
      (target.typeName === STYLE_TYPE || target.typeName === TOKEN_TYPE && Object.values(MATERIAL_MEMBERS).includes((target.payload as TokenPayload).name))) {
      const payload = target.payload as GradientPayload | TokenPayload
      const amount = Math.max(0, Math.min(1, numberOf(call.args[0]?.value) ?? 1))
      return opaque(target.typeName, { ...payload, opacity: (payload.opacity ?? 1) * amount })
    }

    // `.red.opacity(0.5)` - a contextual colour asked for one of `Color`'s members.
    const promoted = this.colorFromToken(target, member)
    if (promoted) return this.callMember(promoted, member, call)

    // `.title.bold()` - the same shape of problem one type over.
    const restyled = this.fontFromToken(target, member, call)
    if (restyled) return restyled

    // A view modifier written on a colour: `Color.red.frame(width: 100)`. The colour
    // becomes the view it already is, and the modifier applies to that.
    if (
      target.kind === 'opaque' &&
      (target.typeName === COLOR_TYPE || target.typeName === STYLE_TYPE) &&
      !COLOR_MEMBERS.has(member)
    ) {
      const wrapped = this.colorAsView(target, call.span)
      if (wrapped) return view({ ...wrapped, modifiers: [this.makeModifier(member, call)] })
    }

    if (target.kind === 'opaque' && target.typeName === COLOR_TYPE) {
      const payload = target.payload as ColorPayload
      if (member === 'opacity') {
        const amount = numberOf(call.args[0]?.value)
        return color({ ...payload, opacity: (payload.opacity ?? 1) * Math.max(0, Math.min(1, amount ?? 1)) })
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

    if (target.kind === 'type' && target.name === 'Binding' && member === 'constant') {
      return this.constantBinding(call)
    }

    if (target.kind === 'type' && target.name === 'Animation') {
      return this.makeAnimation(member, call)
    }

    if (target.kind === 'type' && target.name === 'Font' && member === 'system') {
      return this.makeSystemFont(call)
    }

    return undefined
  }

  /**
   * `Text("\(Text("Bold").bold()) and plain")`: a `Text` interpolated into a string keeps
   * its own styling, as `+` does, for a `Text` to draw as the same kind of joined `Text`.
   * Anything else given the string, a Button's title, reads its plain words.
   */
  interpolate(parts: readonly (string | SwiftValue)[], span: SourceSpan): { text: string; styled: SwiftValue } | undefined {
    if (!parts.some((part) => typeof part !== 'string' && isTextLike(asView(part)))) return undefined
    const pieces = parts.map((part): string | ViewValue => typeof part === 'string' ? part : isTextLike(asView(part)) ? asView(part)! : describe(part, false))
    const children = pieces.filter((piece) => piece !== '').map((piece): ViewValue =>
      typeof piece === 'string' ? { name: 'Text', args: [{ label: null, value: str(piece) }], children: [], modifiers: [], action: null, span } : piece)
    return { text: pieces.map((piece) => typeof piece === 'string' ? piece : plainText(piece)).join(''), styled: view({ name: 'Text', args: [], children, modifiers: [], action: null, span }) }
  }

  /** `dismiss()` - the one callable the environment hands out. */
  /**
   * `Text("Hello, ") + Text(name).bold()` - the one operator SwiftUI defines on views.
   *
   * The result is a `Text` whose children are the two operands, so each half keeps its
   * own modifier chain and the layout pass can turn them into attributed runs. Making
   * it a view rather than a joined string is what lets the halves differ: joining the
   * text would throw away exactly the styling the operator exists to combine.
   *
   * Anything else opaque is left alone and traps as it did, because inventing a
   * meaning for `Color.red + 1` would be a worse answer than the error.
   */
  applyOperator(operator: string, left: SwiftValue, right: SwiftValue, span: SourceSpan): SwiftValue | undefined {
    if (operator !== '+') return undefined

    const a = asView(left)
    const b = asView(right)
    if (!a || !b) return undefined
    if (!isTextLike(a) || !isTextLike(b)) return undefined

    return view({
      name: 'Text',
      args: [],
      children: [a, b],
      modifiers: [],
      action: null,
      span,
    })
  }

  /**
   * `Binding.constant(x)` - a binding that reads a value and swallows what is written.
   *
   * The spelling every preview and every stateless subview uses, and the one place a
   * `Binding` appears without a `@State` behind it. Without it, `.constant(…)` was an
   * unresolved member and a control given one had nothing to read.
   */
  private constantBinding(call: HostCall): SwiftValue | undefined {
    const value = call.args.find((a) => a.label === null)?.value
    if (!value) return undefined
    return projection({ get: () => value, set: () => {}, description: 'Binding.constant' })
  }

  /**
   * `Binding(get:set:)` - a binding computed rather than projected.
   *
   * The mechanism was already there: a projection is a pair of functions over storage
   * someone else owns, and `$count` builds one from a variable. This builds the same
   * pair from the user's own closures, so a computed binding is indistinguishable
   * downstream from a projected one - a `Toggle` cannot tell them apart, which is the
   * point of the form.
   *
   * `.constant(x)` is the other spelling and the one previews are full of: a binding
   * that reads a value and discards what is written to it.
   */
  private makeBinding(call: HostCall): SwiftValue | undefined {
    const get = call.args.find((a) => a.label === 'get')?.value
    const set = call.args.find((a) => a.label === 'set')?.value
    if (get?.kind !== 'closure') return undefined

    return projection({
      get: () => call.invoke(get),
      set: (value) => {
        if (set?.kind === 'closure') call.invoke(set, [value])
      },
      description: 'Binding(get:set:)',
    })
  }

  /**
   * `d[.leading]` inside an `.alignmentGuide` closure.
   *
   * `ViewDimensions` is subscripted by an alignment, and every guide but `.width`
   * and `.height` is written that way. The values are the defaults SwiftUI uses,
   * measured from the view's own leading and top edges - which is what makes
   * `.alignmentGuide(.leading) { d in d[.trailing] }` line up the right edges.
   */
  subscript(target: SwiftValue, index: SwiftValue): SwiftValue | undefined {
    if (target.kind !== 'opaque' || target.typeName !== DIMENSIONS_TYPE) return undefined
    const size = target.payload as { width: number; height: number }

    const name = tokenNameOf(index) ?? ''
    switch (name) {
      case 'leading':
      case 'top':
        return { kind: 'double', value: 0 }
      case 'trailing':
        return { kind: 'double', value: size.width }
      case 'bottom':
        return { kind: 'double', value: size.height }
      case 'center':
        // Ambiguous on its own: `HorizontalAlignment.center` and its vertical twin are
        // both spelled `.center`, and the token carries no axis. The horizontal one is
        // the reading that is right in a VStack, which is where guides are written.
        return { kind: 'double', value: size.width / 2 }
      case 'firstTextBaseline':
      case 'lastTextBaseline':
        // Approximated as the text baseline of a single line, which is what a view
        // with one line of text has. Recorded in the coverage matrix.
        return { kind: 'double', value: size.height * 0.78 }
      default:
        return undefined
    }
  }

  /**
   * Modifier content that is always on screen, evaluated now rather than held.
   *
   * A sheet's closure must not run while the sheet is down, which is why modifier
   * closures are kept unevaluated by default. A `.safeAreaInset`'s is the opposite
   * case: it is part of the layout from the first frame, and holding it would mean
   * the layout pass asking the interpreter to run something, which is a seam that
   * does not exist and should not be opened for one modifier.
   */
  private makeModifier(member: string, call: HostCall): ModifierValue {
    if (member === 'frame') {
      for (const arg of call.args) {
        if (!arg.label || !['width', 'height', 'minWidth', 'minHeight', 'idealWidth', 'idealHeight', 'maxWidth', 'maxHeight'].includes(arg.label)) continue
        const value = numberOf(arg.value)
        if (value !== null && (value < 0 || (!Number.isFinite(value) && !(value === Infinity && arg.label.startsWith('max'))))) {
          throw new SwiftTrap(`Invalid frame ${arg.label}: use a finite, nonnegative dimension; .infinity is allowed only for maximum dimensions.`, call.span)
        }
      }
    }
    const deferred = member === 'contextMenu'
      ? call.args.some(arg => arg.label === 'forSelectionType') ? null
        : call.trailingClosure ?? asClosure(call.args.find(arg => arg.label === 'menuItems')?.value)
      : call.trailingClosure
    const action = EVENT_MODIFIERS.has(member) ? (call.trailingClosure ?? eventArgument(call)) : null
    return {
      name: member,
      args: [...toArgs(call), ...this.eagerContent(member, call)],
      span: call.span,
      // Unevaluated on purpose: a sheet's content must not run while it is down.
      closure: deferred,
      ...(action ? { action } : {}),
      // Only where there is something deferred to run later. Every other modifier
      // resolves inside the scope it was written in and has no use for this.
      ...(deferred ? { environment: this.environment.snapshot() } : {}),
    }
  }

  private eagerContent(member: string, call: HostCall): ViewArg[] {
    if (!['safeAreaInset', 'background', 'overlay'].includes(member)) return []
    const content = call.trailingClosure ?? asClosure(call.args.find((arg) => arg.label === 'content')?.value)
    // `.overlay(Badge())`: a custom view given as the argument is a struct until it is
    // expanded, and nothing after this point can expand it.
    const given = content ? undefined : call.args.find((arg) => arg.label === null)?.value
    const values = content ? call.invokeBuilder(content) : given?.kind === 'struct' ? [given] : []
    // A `Color`, a gradient and a custom view are views without being view values, so
    // they take the same conversion as `body`: `.background { Color.red }` drew nothing.
    return this.toViews(values).map((content) => ({ label: 'content', value: view(content) }))
  }

  callValue(target: SwiftValue, call: HostCall): SwiftValue | undefined {
    if (target.kind !== 'opaque') return undefined

    if (target.typeName === DISMISS_TYPE) {
      this.dismissAction?.()
      return { kind: 'void' }
    }

    if (target.typeName === OPEN_URL_TYPE) {
      // Logged rather than opened. Navigating the browser away would take the user's
      // unsaved project with it, and opening a tab is a side effect a preview was not
      // asked for - so the call runs, says what it would have done, and the exported
      // project does it for real.
      const url = call.args[0]?.value
      this.log(`openURL(${url ? describe(url, true) : ''})`, call.span, 'log')
      return { kind: 'void' }
    }

    return undefined
  }

  /**
   * Implicit member syntax *with* arguments: `.easeInOut(duration: 0.3)`.
   *
   * Separate from `resolveImplicitMember` because that one never sees the call -
   * without this hook, every animation collapses to its default duration and the
   * number the user typed is silently discarded.
   */
  /**
   * What a `@ViewBuilder` body of more than one statement produces.
   *
   * SwiftUI calls it a `TupleView`; the preview has no such thing and does not need
   * one, because an implicit `Group` behaves identically - its children are laid out
   * by whatever contains it, and a modifier applied to it applies to all of them.
   */
  groupValues(values: readonly SwiftValue[], span: SourceSpan): SwiftValue | undefined {
    const children = this.toViews(values)
    if (children.length === 0) return undefined

    return view({
      name: 'Group',
      args: [],
      children,
      modifiers: [],
      action: null,
      span,
    })
  }

  callImplicitMember(member: string, call: HostCall): SwiftValue | undefined {
    if (member === 'init' && call.args.length === 2 && call.args[0]?.label === 'color' && call.args[1]?.label === 'location') return this.gradientStop(call)
    // `.padding(.init(top: 8, leading: 16, bottom: 8, trailing: 16))`, where the type is `EdgeInsets`.
    if (member === 'init' && call.args.length > 0 && call.args.every((a) => a.label && EDGE_LABELS.has(a.label))) return edgeInsets(call)
    // `.rect(cornerRadii: .init(topLeading: 8, bottomTrailing: 8))`, where the type is `RectangleCornerRadii`.
    if (member === 'init' && call.args.length > 0 && call.args.every((a) => a.label && CORNER_NAMES.includes(a.label))) return cornerRadii(call.args)
    if (ANIMATION_CURVES[member] || member === 'spring' || member === 'interpolatingSpring') {
      return this.makeAnimation(member, call)
    }
    if (TRANSITIONS.has(member)) return this.makeTransition(member, call)
    if (member === 'system') return this.makeSystemFont(call)

    // `.constant(false)` where a `Binding` is expected - the contextual spelling, and
    // the one previews actually use. `Binding.constant(…)` reaches `callMember`.
    if (member === 'constant') return this.constantBinding(call)

    // `.custom("Avenir", size: 24)`. The face itself cannot be honoured - a browser
    // has no access to a project's bundled fonts - but the *size* is a layout input,
    // and dropping it left every custom-font view previewing at the 17-point body
    // size with nothing said about it.
    if (member === 'custom') {
      const size = numberOf(call.args.find((a) => a.label === 'size')?.value)
      const fixed = numberOf(call.args.find((a) => a.label === 'fixedSize')?.value)
      return token(`system:${size ?? fixed ?? 17}:regular:default`)
    }

    // `.currency(code:)` carries the code, and a format style that loses it renders
    // every amount in dollars.
    if (member === 'currency') {
      const code = call.args.find((a) => a.label === 'code')?.value
      return token(`currency:${code?.kind === 'string' ? code.value : 'USD'}`)
    }

    if (member === 'fixed' || member === 'flexible' || member === 'adaptive') {
      return this.makeGridItem(call, member)
    }
    if (member === 'degrees' || member === 'radians') {
      return token(`${member}:${numberOf(call.args[0]?.value) ?? 0}`)
    }
    if (member === 'height' || member === 'fraction') {
      return token(`detent:${member}:${numberOf(call.args[0]?.value) ?? 0}`)
    }
    // `.rect(topLeadingRadius: 20, bottomTrailingRadius: 8)`, a radius per corner: drawn
    // with the largest on every corner (D7a), which the checker says where it is written.
    if (member === 'rect' && hasCornerRadii(call.args.map((a) => a.label))) {
      const style = call.args.find((a) => a.label === 'style')?.value
      return opaque(TOKEN_TYPE, { name: 'rect', args: [double(largestCorner(call.args)), ...(style ? [style] : [])] } satisfies TokenPayload)
    }

    /**
     * Anything else is the project's own: `.done("hi")` where a `Load` is expected.
     *
     * The host cannot know which enum that is - only the declared type at the call
     * site can say - so it answers with the name *and the arguments*, and
     * `coerceToEnum` builds the case once the expected type is known. Returning a
     * bare name here is what used to lose the payload.
     */
    return opaque(TOKEN_TYPE, {
      name: member,
      args: call.args.map((a) => a.value),
    } satisfies TokenPayload)
  }

  getMember(target: SwiftValue, member: string, span: SourceSpan): SwiftValue | undefined {
    // `binding.wrappedValue` - the long spelling of reading the binding, and how a
    // computed `Binding(get:set:)` is nearly always read.
    //
    // It answers for any value, not only a projection, because reading a variable
    // already unwraps one: `let b = Binding(get:set:)` puts a projection in `b` and
    // `b` reads as the value it projects. So by the time `.wrappedValue` is asked for,
    // the projection is gone and the value is the answer - which is the same erasure
    // `Optional(x)` being `x` relies on.
    if (member === 'wrappedValue') {
      return asProjection(target)?.get() ?? target
    }

    // `value.translation.width`, `value.location.x`, `size.width` …
    const geometry = geometryMember(target, member)
    if (geometry !== undefined) return geometry

    // `CGSize.zero`, `CGPoint.zero` - the initialiser almost every `@GestureState`
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
      if (member === 'safeAreaInsets') return opaque(EDGE_INSETS_TYPE, (target.payload as GeometryPayload).insets)
    }

    // `configuration.label` and `configuration.isPressed` inside a custom ButtonStyle.
    if (target.kind === 'opaque' && target.typeName === BUTTON_CONFIGURATION_TYPE) {
      const payload = target.payload as ButtonConfigurationPayload
      if (member === 'label') return payload.label
      if (member === 'isPressed') return bool(payload.isPressed)
    }

    // `insets.top` - the four edges, by name.
    if (target.kind === 'opaque' && target.typeName === EDGE_INSETS_TYPE) {
      const payload = target.payload as unknown as Record<string, number>
      if (member in payload) return double(payload[member]!)
    }

    // `.blue.gradient` - the same promotion the call path does, for the member of
    // `Color` that is written without parentheses.
    const promoted = this.colorFromToken(target, member)
    if (promoted) return this.getMember(promoted, member, span)

    // `Color.red.gradient` - SwiftUI's one-line shade of a flat colour.
    if (target.kind === 'opaque' && target.typeName === COLOR_TYPE && member === 'gradient') {
      return this.colorGradient(target, target.payload as ColorPayload)
    }

    // `.blue.secondary` - the colour at a lower level of the hierarchy. It stopped the
    // whole preview as an unknown member.
    const level = HIERARCHY_OPACITY[member]
    if (level !== undefined && target.kind === 'opaque' && target.typeName === COLOR_TYPE) {
      const payload = target.payload as ColorPayload
      return color({ ...payload, opacity: (payload.opacity ?? 1) * level })
    }

    // Every branch below answers on the strength of a type's *name*, so a name the
    // project declared belongs to the project. Declining sends the member back to the
    // interpreter, which reports against the real declaration.
    if (target.kind === 'type' && this.declaresType?.(target.name)) return undefined

    if (target.kind === 'type') {
      if (target.name === 'Gradient' && member === 'Stop') return { kind: 'type', name: 'Gradient.Stop' }
      if (target.name === 'Edge' && member === 'Set') return { kind: 'type', name: 'Edge.Set' }
      if (target.name === 'Color') return color({ name: member })
      if (target.name === 'Animation') return this.animationToken(member)
      if (target.name === 'AnyTransition') return this.transitionToken(member)
      // `Material.ultraThin` is the same value as the `.ultraThinMaterial` everyone
      // writes; only the spelling differs.
      if (target.name === 'Material') return token(MATERIAL_MEMBERS[member] ?? member)
      if (NAMESPACES.has(target.name)) return token(member)
      // A view type referenced without arguments: `Spacer` used as `Spacer`.
      if (VIEW_NAMES.has(target.name)) {
        return view({ name: target.name, args: [], children: [], modifiers: [], action: null, span })
      }
    }
    return undefined
  }

  /**
   * Turns a contextual token into the host value its declared type calls for.
   *
   * Only named types the host actually owns, and only from a token - anything else is
   * declined, because guessing here would replace a value the user built with one the
   * host invented.
   */
  coerceToType(value: SwiftValue, typeName: string): SwiftValue | undefined {
    if (value.kind !== 'opaque' || value.typeName !== TOKEN_TYPE) return undefined
    const name = (value.payload as TokenPayload).name

    if (typeName === 'Color') return color({ name })
    if (typeName === 'Animation') return this.animationToken(name)
    if (typeName === 'AnyTransition') return this.transitionToken(name)
    return undefined
  }

  /**
   * A contextual colour that has been asked for one of `Color`'s own members.
   *
   * `.red` is a token because nothing where it is written says which type it belongs
   * to, and `coerceToType` above settles that when a *declaration* does. A member
   * settles it just as well, and it is the only thing that can inside a modifier
   * argument - which is exactly where `.foregroundStyle(.red.opacity(0.5))` and
   * `.shadow(color: .black.opacity(0.1), radius: 8)` live. Both used to trap, and a
   * trap takes the whole preview down rather than the one view that caused it.
   *
   * Narrow in both directions on purpose: only the members `Color` itself answers,
   * and only names the palette knows. Materials keep their own ShapeStyle opacity
   * path, because promoting any token that was asked for any
   * member would replace a value the user built with one the host invented - which is
   * the rule `coerceToType` is written to.
   */
  private colorFromToken(target: SwiftValue, member: string): SwiftValue | undefined {
    if (target.kind !== 'opaque' || target.typeName !== TOKEN_TYPE) return undefined
    if (!COLOR_MEMBERS.has(member)) return undefined

    const { name } = target.payload as TokenPayload
    return colorForName(name) === null ? undefined : color({ name })
  }

  /**
   * A contextual text style asked to change its face: `.title.bold()`.
   *
   * `Color` was not the only type with the problem above it - `.font(.title.bold())`
   * and `.font(.body.weight(.semibold))` trapped on "Value of type 'Token' has no
   * member", and took the screen with them, for exactly the same reason.
   *
   * The result is a token again rather than a font value, because that is how fonts
   * already travel here: `.system(size:weight:)` is a token whose *name* carries its
   * size and weight, and `resolveFontArg` is the one place that reads them. A `style:`
   * token is the same idea keeping the style's name, so the line height stays the one
   * the table gives rather than a ratio recomputed from the size.
   *
   * Only the four members whose effect the preview can honour. `.monospacedDigit()`
   * and `.leading(_:)` are deliberately absent: answering them would mean returning a
   * font that ignores what was asked, which is worse than the report.
   */
  private fontFromToken(
    target: SwiftValue,
    member: string,
    call: HostCall,
  ): SwiftValue | undefined {
    if (target.kind !== 'opaque' || target.typeName !== TOKEN_TYPE) return undefined

    const { name } = target.payload as TokenPayload
    const [style = '', weight = '', design = '', italic = ''] = name.startsWith('style:')
      ? name.slice('style:'.length).split(':')
      : [name, '', '', '']

    // A text style and nothing else. `.done.bold()` on a project's own enum case is
    // not a font, and must go on reporting as one of its own members.
    if (fontForToken(style) === null) return undefined

    const next = { style, weight, design, italic }
    switch (member) {
      case 'weight':
        next.weight = tokenNameOf(call.args[0]?.value) ?? weight
        break
      case 'bold':
        next.weight = call.args[0]?.value.kind === 'bool' && !call.args[0].value.value ? '' : 'bold'
        break
      case 'italic':
        next.italic = call.args[0]?.value.kind === 'bool' && !call.args[0].value.value ? '' : 'italic'
        break
      case 'monospaced':
        next.design = 'monospaced'
        break
      default:
        return undefined
    }

    return token(`style:${next.style}:${next.weight}:${next.design}:${next.italic}`)
  }

  /**
   * `.modifier(SomeModifier())`.
   *
   * Returns undefined - "not a custom modifier" - unless the argument is a struct
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
   * only their name, and whoever consumes them decides what they mean - a font
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
    const value = asProjection(first)?.get() ?? first
    return value?.kind === 'array' || value?.kind === 'range'
  }

  /**
   * A `NavigationLink`'s destination, as the link's `destination` arguments.
   *
   * The preview builds it with the link, where SwiftUI builds it only when it is
   * pushed. So a destination that stops is kept as a stopped view: the screen with the
   * link draws, and pushing it shows why, as a view stopped anywhere else does.
   */
  private destinationArgs(build: () => readonly SwiftValue[], span: SourceSpan): ViewArg[] {
    try {
      return this.toViews(build()).map((destination) => ({ label: 'destination', value: view(destination) }))
    } catch (error) {
      if (!containable(error)) throw error
      return [{ label: 'destination', value: view(stoppedView('Destination', toFailure(error, span), span)) }]
    }
  }

  private hasPlainTitle(call: HostCall): boolean {
    const first = call.args.find((a) => a.label === null)?.value
    return first?.kind === 'string'
  }

  /**
   * Expands `ForEach` (and the collection forms of `List` and `Picker`).
   *
   * Each element's rows are built inside an identity scope keyed by the element's
   * `id` - so `@State` inside a row follows the row's data when the collection is
   * reordered, which is the whole observable difference between identifying by
   * identity and identifying by position.
   */
  private makeDataDriven(name: string, args: readonly ViewArg[], call: HostCall): SwiftValue {
    const original = call.args.find((a) => a.label === null)?.value
    const binding = asProjection(original)
    const data = binding?.get() ?? original
    const idPath = asKeyPath(call.args.find((a) => a.label === 'id')?.value)
    const builder = call.trailingClosure!

    const count = data?.kind === 'array' ? data.elements.length
      : data?.kind === 'range' ? Math.max(0, data.upper - data.lower + (data.closed ? 1 : 0)) : 0
    if (!Number.isSafeInteger(count) || count > PREVIEW_LIMITS.collectionViews) {
      throw new PreviewLimitExceeded(`${name} is limited to ${PREVIEW_LIMITS.collectionViews.toLocaleString()} elements per collection in the preview. Reduce the preview data; the source exports unchanged.`, call.span)
    }
    const elements: SwiftValue[] =
      data?.kind === 'array'
        ? [...data.elements]
        : data?.kind === 'range'
          ? rangeElements(data.lower, data.upper, data.closed)
          : []

    const children: ViewValue[] = []
    const childKeys: string[] = []
    const childOffsets: number[] = []

    // A row's id, read as Swift reads it: a key path can name a computed property or an
    // enum's `rawValue`, which walking stored fields can't see, and then every row had
    // the same key and the same action.
    const idOf = (element: SwiftValue): SwiftValue | undefined => {
      if (idPath) return readKeyPath(idPath, element, call.member)
      if (element.kind === 'struct' || element.kind === 'enum') {
        const id = call.member(element, 'id') ?? NIL
        return id.kind === 'nil' ? undefined : id
      }
      return element.kind === 'string' || element.kind === 'int' || element.kind === 'double' ? element : undefined
    }
    // Its identity is its id, else its place, which is what SwiftUI falls back to too.
    const rowKey = (element: SwiftValue, index: number): string => {
      const id = idOf(element)
      return id === undefined ? `#${index}` : identityKey(id, true)
    }

    elements.forEach((element, index) => {
      const key = rowKey(element, index)
      const implicitTag = idOf(element)
      // A row binding follows stable identity even if a pending handler outlives a reorder.
      const row = binding ? projection({
        description: `${binding.description}[${key}]`,
        get: () => {
          const current = binding.get()
          if (current.kind !== 'array') return { kind: 'nil' }
          const at = current.elements[index] && rowKey(current.elements[index]!, index) === key ? index : current.elements.findIndex((value, i) => rowKey(value, i) === key)
          return at < 0 ? { kind: 'nil' } : copyValue(current.elements[at]!)
        },
        set: value => {
          const current = binding.get()
          if (current.kind !== 'array') return
          const at = current.elements[index] && rowKey(current.elements[index]!, index) === key ? index : current.elements.findIndex((value, i) => rowKey(value, i) === key)
          if (at < 0) return
          const elements = [...current.elements]; elements[at] = copyValue(value)
          binding.set({ ...current, elements })
        },
      }) : element
      const build = () => this.toViews(call.invokeBuilder(builder, [row]))
      const rows = this.scopeIdentity ? this.scopeIdentity(key, build) : build()

      for (const row of rows) {
        children.push(implicitTag === undefined ? row : { ...row, implicitTag })
        childKeys.push(key)
        childOffsets.push(index)
      }
    })

    return view({ name, args, children, modifiers: [], action: null, span: call.span, childKeys, childOffsets })
  }

  /**
   * `withAnimation { … }` - runs the closure, and marks what it changed as animated.
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

  /**
   * `Color.red.gradient` - the shade SwiftUI makes from a flat colour.
   *
   * A linear gradient from the colour to a dimmer version of itself, top to bottom,
   * which is what the real one is: the exact curve is private to SwiftUI, and a
   * two-stop approximation reads correctly at the sizes a preview draws.
   */
  private colorGradient(value: SwiftValue, payload: ColorPayload): SwiftValue {
    return opaque(STYLE_TYPE, {
      kind: 'linear',
      colors: [value, dimmed(payload)],
      startPoint: 'top',
      endPoint: 'bottom',
    } satisfies GradientPayload)
  }

  private gradientStop(call: HostCall): SwiftValue {
    return opaque('Gradient.Stop', { color: call.args.find(a => a.label === 'color')?.value, location: numberOf(call.args.find(a => a.label === 'location')?.value) ?? 0 })
  }

  private gradientStops(call: HostCall): { color: SwiftValue; location: number }[] {
    const gradient = call.args.find(a => a.label === 'gradient')?.value
    if (gradient?.kind === 'opaque' && gradient.typeName === 'Gradient') return gradient.payload as { color: SwiftValue; location: number }[]
    const stops = call.args.find(a => a.label === 'stops')?.value
    if (stops?.kind === 'array') return stops.elements.flatMap(stop => {
      if (stop.kind !== 'opaque' || stop.typeName !== 'Gradient.Stop') return []
      const value = stop.payload as { color: SwiftValue; location: number }
      return value.color ? [value] : []
    })
    const colors = call.args.find(a => a.label === 'colors')?.value
    const list = colors?.kind === 'array' ? colors.elements : call.args.filter(a => a.label === null).map(a => a.value)
    return list.map((color, index) => ({ color, location: list.length < 2 ? 0 : index / (list.length - 1) }))
  }

  private makeGradient(kind: GradientPayload['kind'], call: HostCall): SwiftValue {
    const stops = this.gradientStops(call)
    const pointValue = (label: string) => {
      const value = call.args.find(a => a.label === label)?.value
      return pointOf(value) ?? tokenNameOf(value)
    }
    return opaque(STYLE_TYPE, {
      kind, stops, colors: stops.map(stop => stop.color),
      center: pointValue('center'),
      startRadius: numberOf(call.args.find(a => a.label === 'startRadius')?.value) ?? 0,
      endRadius: numberOf(call.args.find(a => a.label === 'endRadius')?.value) ?? 100,
      startAngle: angleOf(call.args.find(a => a.label === 'startAngle' || a.label === 'angle')?.value),
      endAngle: call.args.some(a => a.label === 'endAngle') ? angleOf(call.args.find(a => a.label === 'endAngle')?.value) : angleOf(call.args.find(a => a.label === 'angle')?.value) + 360,
      startPoint: pointValue('startPoint'), endPoint: pointValue('endPoint'),
    } satisfies GradientPayload)
  }

  /**
   * `GridItem(.adaptive(minimum: 100))` and the bare `.adaptive(minimum: 100)`.
   *
   * The size argument is itself a contextual member call, which resolves to a
   * finished `GridItem` before the enclosing initialiser ever runs. Passing it
   * straight back through is what stops the outer call flattening an adaptive track
   * into a flexible one - a silent difference that shows up only as the wrong number
   * of columns.
   */
  private makeGridItem(call: HostCall, kind?: string): SwiftValue {
    const inner = call.args.find((a) => a.label === null)?.value
    if (kind === undefined && inner?.kind === 'opaque' && inner.typeName === 'GridItem') {
      return opaque('GridItem', { ...(inner.payload as object),
        spacing: numberOf(call.args.find(a => a.label === 'spacing')?.value) ?? undefined,
        alignment: tokenNameOf(call.args.find(a => a.label === 'alignment')?.value) ?? undefined })
    }

    const size = numberOf(inner)
    const minimum = numberOf(call.args.find((a) => a.label === 'minimum')?.value)
    const spacing = numberOf(call.args.find((a) => a.label === 'spacing')?.value)

    return opaque('GridItem', {
      kind: kind ?? tokenNameOf(inner) ?? 'flexible',
      size: size ?? minimum ?? null,
      maximum: numberOf(call.args.find(a => a.label === 'maximum')?.value) ?? undefined,
      spacing: spacing ?? undefined,
      alignment: tokenNameOf(call.args.find(a => a.label === 'alignment')?.value) ?? undefined,
    })
  }

  private makeSystemFont(call: HostCall): SwiftValue {
    const weight = tokenNameOf(call.args.find((a) => a.label === 'weight')?.value)
    const design = tokenNameOf(call.args.find((a) => a.label === 'design')?.value)
    // `.system(.headline, weight: .bold)` - a text style with a face change, which
    // keeps the style's Dynamic Type size and leading. Encoded the way `.headline.bold()`
    // already is, so both spellings of the same font resolve identically.
    const style = tokenNameOf(call.args.find((a) => a.label === null)?.value)
    if (style && fontForToken(style)) return token(`style:${style}:${weight ?? ''}:${design ?? ''}:`)
    const size =
      numberOf(call.args.find((a) => a.label === 'size')?.value) ??
      numberOf(call.args.find((a) => a.label === null)?.value)
    return token(`system:${size ?? 17}:${weight ?? 'regular'}:${design ?? 'default'}`)
  }

  private makeColor(call: HostCall): SwiftValue {
    const opacity = numberOf(call.args.find((a) => a.label === 'opacity' || a.label === 'alpha')?.value)
    const alpha = opacity !== null ? { opacity } : {}
    const white = numberOf(call.args.find((a) => a.label === 'white')?.value)
    if (white !== null) return color({ name: null, white, ...alpha })

    // `Color(hue:saturation:brightness:)` was drawn clear.
    const hue = numberOf(call.args.find((a) => a.label === 'hue')?.value)
    const saturation = numberOf(call.args.find((a) => a.label === 'saturation')?.value)
    const brightness = numberOf(call.args.find((a) => a.label === 'brightness')?.value)
    if (hue !== null && saturation !== null && brightness !== null) {
      const [r, g, b] = hsbToRgb(hue, saturation, brightness)
      return color({ name: null, red: r, green: g, blue: b, ...alpha })
    }

    const red = numberOf(call.args.find((a) => a.label === 'red')?.value)
    const green = numberOf(call.args.find((a) => a.label === 'green')?.value)
    const blue = numberOf(call.args.find((a) => a.label === 'blue')?.value)
    if (red !== null && green !== null && blue !== null) {
      return color({ name: null, red, green, blue, ...alpha })
    }

    const first = call.args[0]?.value
    // `Color("accent")` names a colour set in the asset catalog - never a system colour,
    // even one spelled the same - so it is marked and resolved against the project.
    if (first?.kind === 'string') return color({ name: first.value, asset: true })
    // `Color(uiColor: UIColor(red: …))`: a colour already built.
    if (first?.kind === 'opaque' && first.typeName === COLOR_TYPE) return first

    // `Color(.systemGroupedBackground)` - the UIKit bridge, where the argument is a
    // contextual member rather than a string. This is how idiomatic SwiftUI reaches
    // the adaptive backgrounds, so it has to work for dark mode to be usable at all.
    const named = tokenNameOf(first)
    if (named) return uikitColor(named)
    return color({ name: 'clear' })
  }
}

// -------------------------------------------------------------------- helpers

/**
 * UIKit's fixed colours, as it defines them. Through the bridge `Color(.red)` is
 * `UIColor.red`, which is pure red, and `Color(.gray)` is half white, not SwiftUI's
 * system red and grey. Every other name is a system or semantic colour the palette has.
 */
const UIKIT_FIXED: Readonly<Record<string, readonly [number, number, number]>> = {
  black: [0, 0, 0], darkGray: [1 / 3, 1 / 3, 1 / 3], lightGray: [2 / 3, 2 / 3, 2 / 3], white: [1, 1, 1],
  gray: [0.5, 0.5, 0.5], red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1], cyan: [0, 1, 1], yellow: [1, 1, 0],
  magenta: [1, 0, 1], orange: [1, 0.5, 0], purple: [0.5, 0, 0.5], brown: [0.6, 0.4, 0.2],
}

/** A `UIColor` by name, as the bridge reads it. `tintColor` is the app's accent. */
function uikitColor(name: string): SwiftValue {
  const fixed = UIKIT_FIXED[name]
  if (fixed) return color({ name: null, red: fixed[0], green: fixed[1], blue: fixed[2] })
  return color({ name: name === 'tintColor' ? 'accentColor' : name })
}

/**
 * A colour's hierarchical levels, as opacity. `.secondary` and `.tertiary` are measured
 * in the iOS 27 simulator (0.5 and 0.25); the two lower levels take the label's.
 */
const HIERARCHY_OPACITY: Readonly<Record<string, number>> = { secondary: 0.5, tertiary: 0.25, quaternary: 0.18, quinary: 0.086 }

/** HSB to sRGB components, each 0 to 1, as `Color(hue:saturation:brightness:)` means them. */
function hsbToRgb(hue: number, saturation: number, brightness: number): [number, number, number] {
  const h = ((hue % 1) + 1) % 1 * 6
  const s = Math.max(0, Math.min(1, saturation))
  const v = Math.max(0, Math.min(1, brightness))
  const chroma = v * s
  const x = chroma * (1 - Math.abs((h % 2) - 1))
  const [r, g, b] =
    h < 1 ? [chroma, x, 0] : h < 2 ? [x, chroma, 0] : h < 3 ? [0, chroma, x]
    : h < 4 ? [0, x, chroma] : h < 5 ? [x, 0, chroma] : [chroma, 0, x]
  const m = v - chroma
  return [r + m, g + m, b + m]
}

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
/**
 * The members that belong to the shape rather than to the view around it.
 *
 * SwiftUI's own split: these are declared on `Shape` and either answer another shape
 * or turn one into a view. Everything else a shape accepts, it accepts because a
 * shape is a view.
 */
const SHAPE_MEMBERS = new Set(['fill', 'stroke', 'strokeBorder', 'trim', 'inset', 'offset', 'size'])

/** Members of a colour, which `.blue.secondary` reaches through its leading-dot `.blue`. */
const COLOR_MEMBERS: ReadonlySet<string> = new Set(['opacity', 'gradient', 'init', ...Object.keys(HIERARCHY_OPACITY)])

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
  // The caller checks the count before expanding, so no rows are silently lost.
  for (let i = lower; i <= end; i++) out.push(int(i))
  return out
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

/** The phase a `PhaseAnimator` rests at: the first of those it was given. */
function firstPhase(phases: SwiftValue | undefined): SwiftValue {
  const given = asProjection(phases)?.get() ?? phases
  return given?.kind === 'array' ? given.elements[0] ?? NIL : NIL
}
