import { LAYERED_LABEL_VIEWS, type Diagnostic, type PagePreview, type SourceSpan, type ViewLayer } from '@studio/shared'
import { exhausts, toFailure } from './failures'
import { labelArgView, layerLabel, tabIcon, unavailablePart, viewLayers } from './view-hierarchy'
import { inheritVisualStyle, visualModifiers } from './inherited-style'
import {
  asDate,
  asProjection,
  dateValue,
  double,
  identityKey,
  opaque,
  projection as makeProjection,
  str,
  truthy,
  typeNameOf,
  Environment,
  type ArrayValue,
  type ClosureValue,
  type EnumValue,
  type ProjectionPayload,
  type StructValue,
  type SwiftValue,
} from '@studio/swift-runtime'
import type { Stmt } from '@studio/swift-syntax'
import { HIDDEN_BARS } from '@studio/swift-sema'
import {
  asSwiftValue,
  asView,
  datePickerParts,
  handlerIdFor,
  payloadOf,
  ANIMATION_TYPE,
  COLOR_TYPE,
  LABEL_CONFIGURATION_TYPE,
  TOGGLE_CONFIGURATION_TYPE,
  stopped,
  type ActionValue,
  type AnimationPayload,
  type ColorPayload,
  type EnvironmentFrame,
  type ModifierValue,
  type RuntimeFailure,
  type PageDots,
  type SwipeActions,
  type TokenPayload,
  type ViewArg,
  type ViewIntent,
  type ViewValue,
  TOKEN_TYPE,
} from './view-value'

/**
 * The screen compositor.
 *
 * Everything in Phase 6 that is *not* in the user's code lives here: which screen a
 * navigation stack is showing, whether a sheet is up, which tab is selected, and what
 * a back button does when tapped. None of it can come from evaluating `body`, because
 * the user never wrote it - SwiftUI supplies that behaviour, so something has to.
 *
 * Three rules keep this from becoming a second, competing view system:
 *
 * 1. **Nothing here invents content.** Every view it shows came out of the user's
 *    `body`; the resolver only chooses *which* of them is on screen.
 * 2. **One traversal owns identity.** Paths are stamped here and nowhere else, so the
 *    hit target a tap arrives at is provably the view that was drawn.
 * 3. **Framework chrome is explicit.** Nav bars and tab bars are real view values with
 *    reserved names, so they appear in the inspector and in tests like everything
 *    else, instead of being drawn by a side channel the rest of the system cannot see.
 */

/**
 * Reserved names for framework-synthesised chrome.
 *
 * A leading underscore keeps them out of the way of anything a user would write, and
 * naming them at all is the point: a navigation bar is a view value like any other, so
 * it shows up in the inspector and can be asserted on in tests, rather than being
 * drawn through a side channel the rest of the system cannot see.
 */
export const NAV_BAR = '_NavigationBar'
export const TAB_BAR = '_TabBar'
export const BACK_BUTTON = '_BackButton'
export const TAB_ITEM = '_TabItem'
export const BOTTOM_BAR = '_BottomBar'
export const ALERT = '_Alert'
export const DIALOG = '_ConfirmationDialog'
export const MENU = '_Menu'
/** A `DatePicker`'s calendar, and one day of it. */
export const DATE_EDITOR = '_DateEditor'
export const DATE_CELL = '_DateCell'
/** A `ColorPicker`'s palette, and one colour of it. */
export const COLOUR_EDITOR = '_ColourEditor'
export const COLOUR_SWATCH = '_ColourSwatch'

/**
 * A `DatePicker`'s selection, its value in seconds (now when it has none), and the range
 * `in:` allows, for its popup and its graphical month alike.
 */
function dateSelection(control: ViewValue) {
  const selection = labelled(control.args, 'selection')
  const binding = asProjection(selection)
  const range = labelled(control.args, 'in')
  return {
    selection, binding,
    seconds: asDate(binding?.get() ?? { kind: 'nil' })?.epochSeconds ?? Date.now() / 1000,
    lower: range?.kind === 'range' ? range.lower : -Infinity,
    upper: range?.kind === 'range' ? range.upper : Infinity,
  }
}

/** Month names for the calendar header. Not localised; neither is the rest of the chrome. */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * The colours a `ColorPicker` offers.
 *
 * SwiftUI's own named colours, because those are the ones the exported code can name.
 * A continuous surface would let the user land on a colour their Swift cannot say.
 */
const SWATCHES = [
  'red', 'orange', 'yellow', 'green', 'mint', 'teal',
  'cyan', 'blue', 'indigo', 'purple', 'pink', 'brown',
  'gray', 'black', 'white', 'primary',
]

export interface NavigationBar {
  readonly title: string
  readonly large: boolean
  readonly canGoBack: boolean
  /** What the back button returns to, for the label iOS puts beside the chevron. */
  readonly backTitle: string
  /** The back button's handler, when the screen can go back: what `dismiss` does on a pushed screen. */
  readonly back?: string
  readonly leading: readonly ViewValue[]
  readonly trailing: readonly ViewValue[]
  /** A `.principal` item, drawn in the title's place (Wave 4b). */
  readonly principal: readonly ViewValue[]
  readonly view: ViewValue
  /** `.navigationSubtitle`, drawn under the title, inline or large (Wave 6c). */
  readonly subtitle?: string
  /** The `.confirmationAction` items, whose titles iOS 27 draws semibold (Wave 6c). */
  readonly confirm?: ReadonlySet<ViewValue>
}

export interface TabBar {
  readonly items: readonly ViewValue[]
  readonly view: ViewValue
  /** What `.tabViewBottomAccessory` shows, in a capsule above the bar (Wave 6c). */
  readonly accessory?: readonly ViewValue[]
}

/** A screen's toolbar items by where they are drawn: a principal item in place of the title (Wave 4b). */
interface Toolbar {
  readonly leading: readonly ViewValue[]
  readonly trailing: readonly ViewValue[]
  readonly principal: readonly ViewValue[]
  readonly bottom: readonly ViewValue[]
  /** Which of the bottom items are `.status` ones, and which of the bar's `.confirmationAction` ones (Wave 6c). */
  readonly status?: ReadonlySet<ViewValue>
  readonly confirm?: ReadonlySet<ViewValue>
}

/** No views, shared, so a screen without a toolbar allocates nothing for one each pass (Wave 4b). */
const NO_VIEWS: readonly ViewValue[] = Object.freeze([])
const NO_TOOLBAR: Toolbar = Object.freeze({ leading: NO_VIEWS, trailing: NO_VIEWS, principal: NO_VIEWS, bottom: NO_VIEWS })

/** Every item of a toolbar, as Layers lists them: the bar's, then the bottom bar's, in a new list only when the bar has any. */
function toolbarViews(bar: Pick<NavigationBar, 'leading' | 'trailing' | 'principal'> | null | undefined, bottom: readonly ViewValue[] = NO_VIEWS): readonly ViewValue[] {
  return bar && (bar.leading.length || bar.principal.length || bar.trailing.length) ? [...bar.leading, ...bar.principal, ...bar.trailing, ...bottom] : bottom
}

/** The `.bottomBar` toolbar items, drawn in glass capsules above the home indicator (Wave 4b). */
export interface BottomBar {
  readonly items: readonly ViewValue[]
  readonly view: ViewValue
  /** Which items are `.status` ones, centred in a capsule of their own (Wave 6c). */
  readonly status?: ReadonlySet<ViewValue>
}

export type OverlayKind = 'sheet' | 'cover' | 'alert' | 'dialog' | 'popover' | 'menu'

/** What each presentation is called where one stops. */
const PRESENTATION_NAMES: Readonly<Record<OverlayKind, string>> = {
  sheet: 'Sheet', cover: 'Full-screen cover', alert: 'Alert', dialog: 'Confirmation dialog', popover: 'Popover', menu: 'Menu',
}

export interface Overlay {
  readonly kind: OverlayKind
  readonly views: readonly ViewValue[]
  /** Fraction of the screen height a sheet occupies. */
  readonly detent: number
  readonly detents?: readonly number[]
  readonly anchorId?: string
  /**
   * A popover drawn as one on a phone, `.presentationCompactAdaptation(.popover)`, rather than
   * as a sheet (Wave 6c): beside `source`, the path of the view it is written on.
   */
  readonly compact?: { readonly source: string }
  readonly cornerRadius?: number
  readonly background?: SwiftValue
  /** Omitted disables interaction; a number enables it through that encoded detent. */
  readonly backgroundInteraction?: number
  readonly showsDragIndicator?: boolean
  readonly screen?: Pick<ResolvedUI, 'content' | 'navigationBar' | 'bottomBar' | 'tabBar' | 'search' | 'overlay'>
  readonly title: string
  readonly message: string
  /** An alert's or a dialog's title as the layer it is drawn as, which a click on its words finds. */
  readonly titleLayer?: ViewLayer
  /** The views its message closure built, whose words `message` holds, as layers of their own. */
  readonly messageViews?: readonly ViewValue[]
  /** Tapping outside dismisses, unless the presentation is non-interactive. */
  readonly dismiss: ViewIntent | null
  /** The handler id the dim layer reports, so the layout does not have to derive it. */
  readonly dismissId: string | null
  /**
   * A view's `.contextMenu`, drawn as iOS 27 draws one rather than as a Menu's options, by
   * the path of the view it is open on, which it is placed beside (Wave 4a).
   */
  readonly contextMenu?: string
}

/**
 * A lifecycle callback found while resolving.
 *
 * Collected rather than run, because running it here would mutate state in the middle
 * of building the screen that state describes. The runtime runs them after the pass
 * and re-evaluates if anything changed.
 */
export interface LifecycleHook {
  readonly kind: 'appear' | 'disappear' | 'change'
  /**
   * The view's path, the hook's name and its place among the view's modifiers of that
   * name - how "has this run before?" is answered. Not the raw modifier index, so
   * adding or removing an unrelated modifier doesn't run a hook again.
   */
  readonly key: string
  readonly action: ActionValue
  /** For `.onChange(of:)` and `.task(id:)`: the value watched, compared against last pass. */
  readonly watched?: SwiftValue
  readonly initial?: boolean
}

/** Search placement is resolved by device context during screen composition. */
export interface SearchField {
  readonly text: string
  readonly prompt: string
  readonly placement: string
  readonly path: string
}

export interface ResolvedUI {
  readonly viewHierarchy?: readonly ViewLayer[]
  readonly content: readonly ViewValue[]
  readonly search: SearchField | null
  readonly navigationBar: NavigationBar | null
  /** The toolbar's `.bottomBar` items (Wave 4b). */
  readonly bottomBar?: BottomBar | null
  /** The navigation stack's visual environment: what a screen pushed onto it inherits. */
  readonly environment?: readonly ModifierValue[]
  readonly tabBar: TabBar | null
  readonly overlay: Overlay | null
  readonly handlers: ReadonlyMap<string, ViewIntent>
  /** Set when the last state change happened inside `withAnimation`. */
  readonly animation: AnimationPayload | null
  /** The key of each view whose key isn't its path, by its path (Wave 5a): see `RenderNode.key`. */
  readonly keys?: ReadonlyMap<string, string>
  /** Each `.animation` that animates this frame, by the key of the view it is written on (Wave 5a). */
  readonly armed?: readonly { readonly key: string; readonly animation: AnimationPayload }[]
  readonly lifecycle: readonly LifecycleHook[]
  /** What was written around the screen's containers and isn't drawn (see `notDrawn`). */
  readonly notDrawn?: readonly NotDrawn[]
  /**
   * The views around the screen's outermost container, when something is written beside it or
   * on it (Wave 6c): the window's views, with the container at `slot`, its path, where the
   * screen, its bars included, is laid out.
   */
  readonly outer?: { readonly views: readonly ViewValue[]; readonly slot: string }
  /** What resolving the screen found that the checker can't see, such as a Picker that can't select. */
  readonly warnings?: readonly Diagnostic[]
  /**
   * For a page of the Design canvas (Wave 4a): the swipe and context-menu modifiers it met,
   * each once for where it is written, and whether the selection drew one of them open.
   */
  readonly reveal?: { readonly modifiers: readonly Revealable[]; readonly drawn: boolean }
}

/**
 * A `.swipeActions` or `.contextMenu` the Design canvas can draw open (Wave 4a): where it is
 * written, and its closure. A pager's page, which it can draw shown, has no closure (Wave 4c).
 */
export type Revealable = Pick<ModifierValue, 'span'> & Partial<Pick<ModifierValue, 'closure'>>

/**
 * Whether the Design canvas's selection is in a `.swipeActions` or a `.contextMenu` (Wave 4a):
 * its closure, a view in it, or its slot, from the modifier's name on. The call's span starts
 * with the view it is written on, so that view, or a view inside it, ends before the closure
 * starts and reveals nothing. A pager's page is revealed by itself or a view in it (Wave 4c).
 */
export function reveals(target: SourceSpan | null | undefined, modifier: Revealable): boolean {
  const span = modifier.span, closure = modifier.closure?.span
  if (!target || target.file !== span.file) return false
  if (!modifier.closure) return target.start >= span.start && target.end <= span.end
  return !!closure && target.start > span.start && target.end <= span.end && target.end > closure.start
}

/**
 * Something the preview leaves out when it cuts a screen out of its containers: a
 * view beside a NavigationStack or a TabView - a floating button in a `ZStack`, a
 * banner above - or a drawing modifier written on the container itself.
 */
export interface NotDrawn {
  readonly span: SourceSpan
  readonly container: string
  /** The modifier left out, when it is one; otherwise a view is. */
  readonly modifier?: string
}

/**
 * Why each view drawn as stopped on this screen stopped: its content, its bars and
 * whatever it presents, and the layers drawn behind and over them.
 *
 * Only what is on screen. A destination is built with its link but not shown until it
 * is pushed, so a view in it that stopped says nothing before then, as iOS runs a
 * destination's body only on the push.
 */
export function stoppedFailures(ui: Pick<ResolvedUI, 'content' | 'navigationBar' | 'bottomBar' | 'tabBar' | 'overlay'> | null | undefined): RuntimeFailure[] {
  const found: RuntimeFailure[] = []
  const visit = (view: ViewValue): void => {
    const halted = stopped(view)
    if (halted) found.push(halted.failure)
    view.children.forEach(visit)
    for (const modifier of view.modifiers) {
      for (const argument of modifier.args) {
        const layer = asView(argument.value)
        if (layer) visit(layer)
      }
    }
  }
  const screen = (shown: Pick<ResolvedUI, 'content' | 'navigationBar' | 'bottomBar' | 'tabBar' | 'overlay'>): void => {
    shown.content.forEach(visit)
    shown.navigationBar?.leading.forEach(visit)
    shown.navigationBar?.principal.forEach(visit)
    shown.navigationBar?.trailing.forEach(visit)
    shown.bottomBar?.items.forEach(visit)
    shown.tabBar?.items.forEach(visit)
    shown.tabBar?.accessory?.forEach(visit)
    if (shown.overlay?.screen) screen(shown.overlay.screen)
    else shown.overlay?.views.forEach(visit)
  }
  if (ui) screen(ui)
  return found
}

/** Framework-owned state: what the user's code does not hold but the screen needs. */
export class UIState {
  /** Navigation stacks, keyed by the stack's path; values are pushed link paths. */
  private navigation = new Map<string, string[]>()
  /** Tab selection for a `TabView` with no `selection:` binding. */
  private tabs = new Map<string, number>()

  stack(id: string): readonly string[] {
    return this.navigation.get(id) ?? []
  }

  push(id: string, link: string): void {
    this.navigation.set(id, [...this.stack(id), link])
  }

  pop(id: string): void {
    const current = [...this.stack(id)]
    current.pop()
    this.navigation.set(id, current)
  }

  /**
   * Drops entries the resolver could not resolve.
   *
   * A pushed screen can disappear from under you - the row it came from was deleted,
   * or a filter changed. Truncating is the honest response; keeping a dangling entry
   * would leave the back button one tap short of working forever.
   */
  truncate(id: string, depth: number): void {
    const current = this.stack(id)
    if (current.length > depth) this.navigation.set(id, current.slice(0, depth))
  }

  /**
   * `DisclosureGroup`s that are open.
   *
   * Framework state in the same sense the navigation stack is: SwiftUI's
   * `DisclosureGroup(_:content:)` has no binding to write, so the only place the
   * open-ness can live is here. The `isExpanded:` form does have one, and that form
   * reads its binding instead - the user's storage wins wherever they provided it.
   */
  private expanded = new Set<string>()

  isExpanded(id: string): boolean {
    return this.expanded.has(id)
  }

  toggleExpanded(id: string): void {
    if (!this.expanded.delete(id)) this.expanded.add(id)
  }

  /**
   * The `Picker` or `Menu` whose options are showing, by path.
   *
   * One at a time, like the real thing: opening a second closes the first, and there
   * is no state to reconcile because a menu that is not on screen has none.
   */
  private menu: string | null = null

  openMenu(): string | null {
    return this.menu
  }

  setOpenMenu(id: string | null): void {
    this.menu = id
  }

  /**
   * The last value each `.animation(_:value:)` was gated on, by path.
   *
   * SwiftUI animates that subtree only when `value` changes; without this the
   * modifier animated everything below it on every render, so a view that merely
   * re-rendered slid around. Holding the previous value is the whole mechanism -
   * there is nothing to diff against otherwise.
   */
  private animationValues = new Map<string, string>()

  /** True when the gate's value differs from the last render's, and records the new one. */
  animationGateOpen(path: string, value: string): boolean {
    const previous = this.animationValues.get(path)
    this.animationValues.set(path, value)
    // The first sight of a view is not a change. SwiftUI does not animate a view in
    // because it appeared - that is what `.transition` is for.
    return previous !== undefined && previous !== value
  }

  /**
   * Which month each open `DatePicker` is showing, relative to its value's own.
   *
   * Framework state in the same sense the navigation stack is: the user's binding
   * holds a *date*, and paging to another month before choosing a day must not change
   * it - so there is nowhere else for this to live.
   */
  private months = new Map<string, number>()

  monthOffset(control: string): number {
    return this.months.get(control) ?? 0
  }

  stepMonth(control: string, by: number): void {
    this.months.set(control, this.monthOffset(control) + by)
  }

  /**
   * How far the list row that is swiped is open, in points, positive towards its trailing
   * actions; infinite once let go open. One row at a time, as in iOS: swiping another
   * shuts it.
   */
  private swipes = new Map<string, number>()

  swipeOffset(row: string): number {
    return this.swipes.get(row) ?? 0
  }

  setSwipeOffset(row: string, offset: number): void {
    if (offset === 0) this.swipes.delete(row)
    else { this.swipes.clear(); this.swipes.set(row, offset) }
  }

  closeSwipes(): void {
    this.swipes.clear()
  }

  selectedTab(id: string): number {
    return this.tabs.get(id) ?? 0
  }

  selectTab(id: string, index: number): void {
    this.tabs.set(id, index)
  }

  clear(): void {
    this.navigation.clear()
    this.tabs.clear()
    this.swipes.clear()
    this.expanded.clear()
    this.menu = null
  }
}

export interface ResolveContext {
  /** Extra gallery images reuse the live pass’s authoring hierarchy. */
  readonly includeViewHierarchy?: boolean
  readonly state: UIState
  /**
   * The view the Design canvas has selected, when this draws a page of the canvas, or null
   * for none there (Wave 4a). A selection in a row's `.swipeActions` draws that row swiped
   * open, and one in a `.contextMenu` draws that menu up, as the gallery draws an alert's
   * page up; the running preview has no `reveal` and is never drawn so.
   */
  readonly reveal?: SourceSpan | null
  /**
   * Runs a view-builder closure, returning the views it produced.
   *
   * `environment` is the frame the closure was *written* in, which a deferred one -
   * a pushed destination, a presented sheet - needs because the scope that declared
   * it unwound long before this runs.
   */
  build(
    closure: ClosureValue,
    args?: readonly SwiftValue[],
    environment?: EnvironmentFrame,
    /** What the closure draws, for the placeholder shown if it stops: "Sheet", "Destination". */
    name?: string,
  ): readonly ViewValue[]
  /**
   * Runs a custom `ButtonStyle`'s `makeBody(configuration:)`.
   *
   * Supplied by the runtime because it needs the interpreter, which this module must
   * not hold. Returns null when the value is not a style the project declared, so the
   * built-in `.bordered` path still runs.
   */
  styleButton?(
    style: SwiftValue,
    label: readonly ViewValue[],
    isPressed: boolean,
  ): readonly ViewValue[] | null
  /**
   * Runs a custom `ToggleStyle`'s or `LabelStyle`'s `makeBody(configuration:)`, for the
   * same reason; null when the value is not a style the project declared.
   */
  styleBody?(style: SwiftValue, protocol: string, configuration: SwiftValue): readonly ViewValue[] | null
  readonly animation: AnimationPayload | null
  /** Whether the program declares a view by this name, which the gallery names a page that shows one after. */
  isView?(name: string): boolean
  /** A project enum's cases that hold no values: what the gallery draws a path of them with. */
  cases?(type: string): readonly SwiftValue[]
}

/** What a style's own body is drawn with: the control's stock style. */
const AUTOMATIC_STYLE: SwiftValue = opaque('Token', { name: 'automatic' })

/** A view of its own, as a style's configuration hands it over. */
function viewOf(views: readonly ViewValue[], span: SourceSpan): SwiftValue {
  return asSwiftValue(views.length === 1 ? views[0]! : { name: 'Group', args: [], children: [...views], modifiers: [], action: null, span })
}

/** A control's title as the view SwiftUI makes of it: `Toggle("Wi-Fi", …)` is labelled by `Text("Wi-Fi")`. */
function titleView(view: ViewValue): readonly ViewValue[] {
  const title = view.args.find((a) => a.label === null)?.value
  if (title?.kind === 'string') return [{ name: 'Text', args: [{ label: null, value: title }], children: [], modifiers: [], action: null, span: view.span }]
  // `Toggle(isOn: $on, label: { … })` keeps its label among its arguments.
  return view.children.length > 0 ? view.children : view.args.flatMap((a) => a.label === 'label' || a.label === 'title' ? asView(a.value) ?? [] : [])
}

/** `ToggleStyleConfiguration`: `label`, and `isOn`, the toggle's own binding. */
function toggleConfiguration(view: ViewValue): SwiftValue {
  const isOn = view.args.find((a) => a.label === 'isOn')?.value ?? makeProjection({ get: () => ({ kind: 'bool', value: false }), set: () => {}, description: 'isOn' })
  return { kind: 'struct', typeName: TOGGLE_CONFIGURATION_TYPE, fields: new Map([['label', viewOf(titleView(view), view.span)], ['isOn', isOn]]) }
}

/** `LabelStyleConfiguration`: the label's `title` and `icon`, each a view. */
function labelConfiguration(view: ViewValue): SwiftValue {
  const symbol = view.args.find((a) => a.label === 'systemImage' || a.label === 'image')
  const icon: readonly ViewValue[] = symbol
    ? [{ name: 'Image', args: [{ label: symbol.label === 'systemImage' ? 'systemName' : null, value: symbol.value }], children: [], modifiers: [], action: null, span: view.span }]
    : view.args.flatMap((a) => a.label === 'icon' ? asView(a.value) ?? [] : [])
  return { kind: 'struct', typeName: LABEL_CONFIGURATION_TYPE, fields: new Map([['title', viewOf(titleView(view), view.span)], ['icon', viewOf(icon, view.span)]]) }
}

/**
 * Composes the evaluated views into a screen.
 *
 * `forceTab` draws the app as it would look with that tab selected, which is what
 * the page gallery asks for. It is a resolution-time override and writes nothing:
 * the selection the app itself holds - a `@State` binding, or the framework's own
 * record for a `TabView` without one - is read, not touched, so rendering the other
 * pages cannot fire an `.onChange` or move the app somebody is using.
 */
export function resolveUI(views: readonly ViewValue[], ctx: ResolveContext, forceTab?: number, preview?: { prefix?: string; basePage?: boolean }): ResolvedUI {
  return new Resolver(ctx, forceTab, preview?.prefix, preview?.basePage).run(views)
}

/** How a screen another opens is reached: pushed, or presented over it. */
type NestedKind = Exclude<NonNullable<PagePreview['kind']>, 'root' | 'preview'>

/**
 * A screen another opens, as the gallery shows it under that one: its screen, or why the
 * gallery can't draw it. A screen is listed with its reason, never dropped without a word.
 */
export type NestedPage = {
  readonly id: string
  readonly parentId: string
  readonly rootId: string
  readonly kind: NestedKind
  readonly name: string
  readonly source: SourceSpan
} & ({ readonly ui: ResolvedUI } | { readonly notDrawn: string })

/** Where a page goes: how it is reached, where that is written, and what it is called until it is drawn. */
interface Place {
  readonly kind: NestedKind
  readonly source: SourceSpan
  readonly name: string
}

/** Why a page isn't drawn, as the gallery lists it. */
interface Refused {
  readonly notDrawn: string
}

/** A page the gallery draws: its screen's content, the tab it is on, and the chrome around it. */
interface Page {
  readonly content: readonly ViewValue[]
  readonly tab?: number
  readonly dress: (ui: ResolvedUI, resolver: Resolver, id: string) => ResolvedUI
}

/** The one presentation drawn up over its screen, for its page in the gallery. */
interface Forced {
  /** Its modifier's, which finds it. */
  readonly span: SourceSpan
  /** What it shows, a sheet's `item:` when it holds none now (Wave 4b). */
  readonly value?: SwiftValue
  /** What its closure built, when the gallery built it already, so a sheet's views are built once (Wave 4b). */
  readonly views?: readonly ViewValue[]
}

/**
 * One page drawn, and what drawing it found; `page` when the screens it opens are drawn too.
 * `ui` draws a sheet up over the screen that opens it, and `alone` is the sheet's own screen,
 * where what it opens is found (Wave 4b).
 */
interface Composed {
  readonly ui: ResolvedUI
  readonly resolver: Resolver
  readonly name: string
  readonly page?: Page
  readonly alone?: ResolvedUI
}

/** Discover real routes with real sample values; never invoke their button actions. */
export function resolveNestedPages(views: readonly ViewValue[], ctx: ResolveContext, tab: number, rootId: string, limit: number): readonly NestedPage[] {
  const resolver = new Resolver(ctx, tab, 'v', true)
  return resolver.nestedPages(views, rootId, Math.max(0, limit))
}

class Resolver {
  private readonly handlers = new Map<string, ViewIntent>()
  private readonly lifecycle: LifecycleHook[] = []
  /**
   * Custom button styles in scope, innermost last.
   *
   * `.buttonStyle` applies to every `Button` *below* it, not only the one it is
   * written on - that is what makes one line at the top of a screen restyle all of
   * them. The resolver is the only traversal that sees the whole tree, so it is the
   * only place that can know what is above a given button.
   */
  private readonly buttonStyles: SwiftValue[] = []
  private visualStyle: readonly ModifierValue[] = []
  private contextMenuPath: string | undefined
  /** The context menu the canvas's selection is in, drawn up; once the first is met, the others stay down. */
  private revealedMenu: string | null = null
  /** Whether a row is drawn swiped open for the selection: only its first instance is. */
  private revealedRow = false
  /**
   * The swipe and context-menu modifiers met on a page of the canvas, for it to know when a
   * selection reveals one: by where each is written, so a ForEach's rows add it once.
   */
  private readonly revealable = new Map<SourceSpan, Revealable>()
  private previewScope: readonly ViewValue[] = []
  /** The containers the screen was cut out of (see `containersAbove`). */
  private around: readonly ViewValue[] = []
  /** What each screen cut out of its containers leaves out, the root's and any sheet's. */
  private readonly notDrawn: NotDrawn[] = []
  private readonly warnings: Diagnostic[] = []
  /** The list the screen's navigation stack is bound to, `NavigationStack(path:)`, when it is. */
  private route: SwiftValue | undefined
  /** The bars `.toolbar(.hidden, for:)` hides on the screen drawn, as `HIDES` bits (Wave 4b). */
  private hidden = 0
  /** Where the screen's root TabView is written, which is its app's tabs in any style; any other in the page style is a pager (Wave 4c). */
  private rootTabs: SourceSpan | undefined
  /** Whether a pager is drawn on another page than its own for the selection (Wave 4c). */
  private revealedPage = false
  /** The key of each view whose key isn't its path, by its path (Wave 5a): see `RenderNode.key`. */
  private readonly keys = new Map<string, string>()
  /** The nearest view being stamped whose key isn't its path, which the views below it follow. */
  private keyAt: { readonly from: string; readonly to: string } | null = null
  /** Each `.animation` that animates this frame, by the key of the view it is written on (Wave 5a). */
  private readonly armed: { readonly key: string; readonly animation: AnimationPayload }[] = []

  constructor(
    private readonly ctx: ResolveContext,
    private readonly forceTab?: number,
    private readonly prefix = 'v',
    private readonly basePage = false,
    /** The one presentation drawn up for its page in the gallery. */
    private readonly forced?: Forced,
  ) {}

  /**
   * Whether `.toolbar(.hidden, for: .tabBar)` is written on the screen drawn, or on its stack:
   * for a pushed page, drawn with a stack, under the root's tab bar (Wave 4b).
   */
  get hidesTabBar(): boolean {
    return (this.hidden & HIDES.tabBar) !== 0
  }

  run(views: readonly ViewValue[]): ResolvedUI {
    this.rootTabs = rootTabView(views)?.span
    const stamped = this.stampList(views, this.prefix)

    const tabs = findTabs(stamped)
    const withTabs = tabs ? this.resolveTabs(tabs) : { content: stamped, tabBar: null, pages: [], selected: 0 }
    this.previewScope = withTabs.content

    const nav =
      findView(withTabs.content, 'NavigationStack') ??
      findView(withTabs.content, 'NavigationView') ??
      // A phone collapses a split view into a stack, so it is resolved as one.
      findView(withTabs.content, 'NavigationSplitView')
    const screen = nav ? this.resolveNavigation(nav) : { content: withTabs.content, navigationBar: null, bottomBar: null, hidden: 0 }
    // `.toolbar(.hidden, for: .tabBar)` on the screen on top, or on its stack, hides the tab bar
    // (Wave 4b): found in the walk that found the screen's toolbars, or in one of its own for a
    // tab without a stack, and only where there is a tab bar to hide.
    this.hidden = nav ? screen.hidden | hiddenBy(nav.modifiers) : withTabs.tabBar ? toolbarsOf(withTabs.content).hidden : 0
    const route = nav ? labelled(nav.args, 'path') : undefined
    this.route = route && (asProjection(route)?.get() ?? route)
    this.around = containersAbove(stamped, tabs, withTabs.content, nav)
    const searchAround = searchContainers(withTabs.content, nav, screen.navigationBar)
    // What is beside or on the outermost container is drawn around the screen, which is laid out
    // in the container's place (Wave 6c); beside a stack inside a tab's page, it still isn't.
    let slot: ViewValue | null = null
    if (tabs) {
      if (notDrawnAround(stamped, tabs).length) slot = tabs
      if (nav) this.notDrawn.push(...notDrawnAround(withTabs.content, nav))
    } else if (nav && notDrawnAround(withTabs.content, nav).length) slot = nav

    // A menu sits above everything, including a sheet: it is the thing the user just
    // opened, and it is the only one they can interact with while it is up.
    const overlay = this.forced ? this.findOverlay(screen.content, 0, this.around)
      : this.basePage ? this.menuOverlay(screen.content, this.revealedMenu, screen)
      : this.findOverlay(screen.content, 0, this.around) ?? this.menuOverlay(screen.content, this.revealedMenu ?? this.ctx.state.openMenu(), screen)

    // A screen's toolbar items are one Toolbar layer, wherever each is drawn: a click on one
    // in the bar, in the title's place or in the bottom bar finds it there (Wave 4b).
    const screenLayers = (content: readonly ViewValue[], bar: NavigationBar | null | undefined, bottom: BottomBar | null | undefined): ViewLayer[] => {
      const items = toolbarViews(bar, bottom?.items)
      return [
        ...viewLayers(content),
        ...(items.length ? [{ id: `${(bar ?? bottom)!.view.path}/layers`, name: 'Toolbar', type: 'Toolbar', children: viewLayers(items) }] : []),
      ]
    }
    const activeLayers: ViewLayer[] = this.ctx.includeViewHierarchy === false ? [] : screenLayers(screen.content, screen.navigationBar, screen.bottomBar)
    // The views drawn around the container are layers of the page shown, with the container left out (Wave 6c).
    if (slot && this.ctx.includeViewHierarchy !== false) activeLayers.push(...besideLayers(viewLayers(stamped), slot.path!))
    // What the bottom accessory shows is a layer a click on it finds, on whichever tab is shown (Wave 6c).
    const accessory = withTabs.tabBar?.accessory
    if (accessory && this.ctx.includeViewHierarchy !== false) activeLayers.push({ id: `${withTabs.tabBar!.view.path}/accessory`, name: 'Bottom accessory', type: 'Toolbar', children: viewLayers(accessory) })
    const pageLayers: ViewLayer[] = this.ctx.includeViewHierarchy === false ? [] : withTabs.pages.length ? withTabs.pages.map((page, index) => {
      const item = withTabs.tabBar?.items[index]
      const active = index === withTabs.selected
      return {
        id: `page:${page.path}`, name: (item && layerLabel(item)) || titleOf([page], `Page ${index + 1}`),
        type: 'Page', source: page.span,
        page: { active, ...(item?.path ? { handlerId: handlerIdFor(item.path) } : {}), ...(item && tabIcon(item) ? { icon: tabIcon(item) } : {}) },
        children: active ? screen.navigationBar?.canGoBack ? [{
          id: `destination:${page.path}`, name: screen.navigationBar.title || 'Details',
          type: 'Destination', children: activeLayers,
        }] : activeLayers : viewLayers([page]),
      }
    }) : [{
      id: 'page:root', name: screen.navigationBar?.title || 'Main page', type: 'Page',
      page: { active: true }, children: activeLayers,
    }]
    if (overlay && this.ctx.includeViewHierarchy !== false) pageLayers.push({
      id: `page:overlay:${overlay.kind}`, name: overlay.title || overlay.screen?.navigationBar?.title || ({ sheet: 'Sheet', cover: 'Full screen', alert: 'Alert', dialog: 'Confirmation', popover: 'Popover', menu: 'Menu' })[overlay.kind],
      type: 'Presentation', page: { active: true },
      children: [
        ...(overlay.titleLayer ? [overlay.titleLayer] : []), ...viewLayers(overlay.messageViews ?? []),
        ...screenLayers(overlay.screen?.content ?? overlay.views, overlay.screen?.navigationBar, overlay.screen?.bottomBar),
      ],
    })

    return {
      viewHierarchy: pageLayers,
      content: screen.content,
      search: this.findSearchField(screen.content, searchAround),
      navigationBar: screen.navigationBar,
      bottomBar: screen.bottomBar,
      ...(nav ? { environment: visualModifiers(nav) } : {}),
      tabBar: this.hidesTabBar ? null : withTabs.tabBar,
      overlay,
      handlers: this.handlers,
      animation: this.ctx.animation,
      ...(this.keys.size ? { keys: this.keys } : {}),
      ...(this.armed.length ? { armed: this.armed } : {}),
      lifecycle: this.lifecycle,
      ...(this.notDrawn.length ? { notDrawn: this.notDrawn } : {}),
      outer: slot ? { views: stamped, slot: slot.path! } : undefined,
      ...(this.warnings.length ? { warnings: this.warnings } : {}),
      ...(this.ctx.reveal !== undefined ? { reveal: { modifiers: [...this.revealable.values()], drawn: this.revealedRow || this.revealedPage || !!this.revealedMenu && overlay?.kind === 'menu' } } : {}),
    }
  }

  /** One example per destination declaration, with bounded recursive discovery. */
  nestedPages(views: readonly ViewValue[], rootId: string, limit: number): readonly NestedPage[] {
    const root = this.run(views)
    const out: (NestedPage & { readonly ui: ResolvedUI })[] = []
    /** Presentations the gallery can't draw, each with why. */
    const skipped: NestedPage[] = []
    const seen = new Set<string>()
    const isView = (name: string) => this.ctx.isView?.(name) ?? false
    /** Each screen to look for others in, with the path its stack is bound to, whose values a destination there may show. */
    const queue: { ui: ResolvedUI; scope: readonly ViewValue[]; around: readonly ViewValue[]; parentId: string; depth: number; page: Page; route?: SwiftValue }[] =
      [{ ui: root, scope: this.previewScope, around: this.around, parentId: rootId, depth: 0, page: { content: views, tab: this.forceTab, dress: ui => ui }, route: this.route }]
    /** A page's screen drawn on its own, or with one of its presentations up. */
    const draw = (page: Page, id: string, forced?: Forced) => {
      const resolver = new Resolver(this.ctx, page.tab, `preview:${id}`, true, forced)
      return { resolver, ui: page.dress(resolver.run(page.content), resolver, id) }
    }
    let attempts = 0
    while (queue.length && out.length < limit && attempts < 64) {
      const current = queue.shift()!
      if (current.depth >= 3) continue
      /**
       * Draws the page `compose` makes at `place`, under the current one, or lists it with
       * why it isn't drawn. One it makes nothing for has nothing to show. `variant` tells
       * apart the pages one modifier makes, one for each case a path can hold.
       */
      const add = (place: Place, compose: (id: string) => Composed | Refused | null, variant = '') => {
        const key = `${place.kind}:${encodeURIComponent(place.source.file)}:${place.source.start}:${place.source.end}${variant}`
        if (seen.has(key) || out.length >= limit || attempts++ >= 64) return
        // Route order remains stable when text or modifier values change. Byte
        // offsets are only a within-pass dedup key, never a persistent page id.
        const ordinal = out.filter(page => page.kind === place.kind && page.source.file === place.source.file).length
        const id = `${rootId}/preview:${place.kind}:${encodeURIComponent(place.source.file)}:${ordinal}`
        let made: Composed | Refused | null
        try {
          made = compose(id)
        } catch (error) {
          // A destination lacking valid data does not blank other pages, and is listed
          // with why. One that spends the gallery's budget is for the gallery to report.
          if (exhausts(error)) throw error
          made = { notDrawn: toFailure(error, place.source).message }
        }
        if (!made) return
        seen.add(key)
        const { kind, source } = place
        if ('notDrawn' in made) {
          skipped.push({ id: `${current.parentId}/not-drawn:${kind}:${source.start}`, parentId: current.parentId, rootId, kind, name: place.name, source, notDrawn: made.notDrawn })
          return
        }
        out.push({ id, parentId: current.parentId, rootId, kind, name: made.name, source, ui: made.ui })
        // An alert is its screen with the alert up: what that screen opens is under the screen.
        if (made.page) queue.push({ ui: made.alone ?? made.ui, scope: made.resolver.previewScope, around: made.resolver.around, parentId: id, depth: current.depth + 1, page: made.page, route: made.resolver.route ?? (kind === 'destination' ? current.route : undefined) })
      }
      /**
       * The page of a screen `build` builds, pushed or presented at `place`: named by its
       * title, or `place.name`, with `heading` in its bar when it sets no title.
       */
      const screen = (place: Place, build: () => readonly ViewValue[], heading = place.name) => (id: string): Composed | null => {
        const built = build()
        if (!built.length) return null
        const { kind, source } = place
        const hasNavigation = findView(built, 'NavigationStack') ?? findView(built, 'NavigationView')
        const content = kind === 'destination' && !hasNavigation ? [{
          name: 'NavigationStack', args: [], children: built, modifiers: visualModifiers(built[0]!), action: null, span: source,
        } satisfies ViewValue] : built
        const backTitle = current.ui.navigationBar?.title || 'Back'
        const page: Page = { content, dress: kind === 'destination' ? (ui, resolver, at) => {
          const title = ui.navigationBar?.title || heading
          const path = `preview:${at}/back`
          const back: ViewValue = { name: BACK_BUTTON, args: [{ label: 'title', value: { kind: 'string', value: backTitle } }], children: [], modifiers: [], action: null, span: source, path }
          const bar = ui.navigationBar
          const tabBar = root.tabBar && !resolver.hidesTabBar ? { items: root.tabBar.items.map((item, index) => resolver.stamp(item, `preview:${at}/tab-${index}`)), view: resolver.stamp(root.tabBar.view, `preview:${at}/tabs`) } : null
          return { ...ui, tabBar, navigationBar: {
            title, large: bar?.large ?? false, canGoBack: true, backTitle,
            leading: [back], trailing: bar?.trailing ?? NO_VIEWS, principal: bar?.principal ?? NO_VIEWS,
            view: bar ? { ...bar.view, children: [back, ...bar.principal, ...bar.trailing] } : { name: NAV_BAR, args: [{ label: 'title', value: { kind: 'string', value: title } }], children: [back], modifiers: [], action: null, span: source, path: `preview:${at}/bar` },
          } }
        } : ui => ui }
        const { ui, resolver } = draw(page, id)
        return { ui, resolver, page, name: ui.navigationBar?.title || titleOf(built, place.name) }
      }
      const visitLinks = (content: readonly ViewValue[]) => {
        for (const view of content) {
          if (view.name === 'NavigationLink') {
            const builder = this.destinationBuilder(view, current.scope)
            // A pushed screen is drawn under the navigation stack, so it takes the stack's
            // environment, not modifiers written on the link.
            const environment = current.ui.environment ?? visualModifiers(view)
            const place: Place = { kind: 'destination', source: builder?.span ?? view.span, name: labelTextOf(view) || 'Details' }
            add(place, screen(place, () => (this.destinationFor(view, current.scope) ?? []).map(content => inheritVisualStyle(content, environment))))
          }
          visitLinks(view.children)
        }
      }
      const toolbar = toolbarViews(current.ui.navigationBar, current.ui.bottomBar?.items)
      visitLinks([...current.ui.content, ...toolbar])
      for (const { view, modifier } of modifiersFor([...current.scope, ...toolbar], current.around)) {
        const kind = OVERLAY_KINDS[modifier.name]
        if (kind === 'alert' || kind === 'dialog') {
          // Drawn as iOS draws it, over the screen that shows it, and named by its title.
          const place: Place = { kind, source: modifier.span, name: wordsIn(modifier.args.find(a => a.label === null)?.value) || PRESENTATION_NAMES[kind] }
          const data = labelled(modifier.args, 'presenting')
          add(place, id => {
            if (labelled(modifier.args, 'error')) return { notDrawn: 'the preview doesn\'t draw an alert made from an error, whose title is its description' }
            if (data?.kind === 'nil') return { notDrawn: 'it shows the data it presents, and that is nil now' }
            const { ui, resolver } = draw(current.page, id, { span: modifier.span })
            const layer = ui.viewHierarchy?.find(item => item.type === 'Presentation')
            // An `Alert(...)` is named by the title it is given.
            const name = ui.overlay?.title || place.name
            return ui.overlay ? { ui: { ...ui, viewHierarchy: layer ? [{ ...layer, type: 'Page', name }] : [] }, resolver, name }
              : { notDrawn: 'the preview can\'t put it up over the screen from where it is written' }
          })
          continue
        }
        // A destination for a type no link here pushes, as a path's is, is drawn with values
        // of that type: each case of an enum that holds no values, or else one the screen
        // holds. One a link pushes is drawn already, with the link's.
        const type = modifier.name === 'navigationDestination' ? labelled(modifier.args, 'for') : undefined
        if (type?.kind === 'type' && modifier.closure && current.route) {
          const place: Place = { kind: 'destination', source: modifier.span, name: shownView(modifier.closure.body.statements, isView)?.name ?? 'Details' }
          const shows = (value: SwiftValue) => this.ctx.build(modifier.closure!, [value], modifier.environment, 'Destination').map(content => inheritVisualStyle(content, current.ui.environment ?? []))
          const cases = this.ctx.cases?.(type.name) ?? []
          for (const value of cases) {
            const name = (value as EnumValue).caseName
            add(place, id => {
              const built = shows(value)
              return screen({ ...place, name: componentOf(built) ?? name }, () => built, '')(id)
            }, `:${name}`)
          }
          const value = cases.length ? undefined : firstHeld(type.name, modifier.closure)
          if (value) add(place, screen(place, () => shows(value), ''))
          else if (!cases.length) add(place, () => ({ notDrawn: isEmptyList(current.route) ? startsEmpty(type.name) : needs(type.name) }))
        }
        if (type) continue
        // A destination a binding pushes is drawn as one a link pushes (`boundDestination`).
        const bound = modifier.name === 'navigationDestination'
        if (!modifier.closure || (kind !== 'sheet' && kind !== 'cover' && kind !== 'popover' && !bound)) continue
        const shown = given(modifier.args, modifier.closure)
        // Named after the view it shows where it is shown with a value; a plain sheet keeps its name.
        const place: Place = {
          kind: bound ? 'destination' : kind as 'sheet' | 'cover' | 'popover',
          source: modifier.span,
          name: (bound || labelled(modifier.args, 'item') ? shownView(modifier.closure.body.statements, isView)?.name : undefined) ?? (bound ? 'Details' : kind === 'sheet' ? 'Sheet' : kind === 'cover' ? 'Full screen' : 'Popover'),
        }
        // A pushed screen takes the stack's environment, a presented one the view's it is written on.
        const environment = bound ? current.ui.environment ?? [] : visualModifiers(view)
        const build = () => this.ctx.build(modifier.closure!, shown.value ? [shown.value] : [], modifier.environment, bound ? 'Destination' : PRESENTATION_NAMES[kind!])
        const styled = (views: readonly ViewValue[]) => views.map(content => inheritVisualStyle(content, environment))
        if (shown.why) add(place, () => ({ notDrawn: shown.why! }))
        else if (kind === 'sheet' || kind === 'popover') {
          // Drawn as iOS draws it, up over the screen that opens it at its first detent, as an
          // alert is (Wave 4b); what it opens is found in its own screen. A sheet opened from
          // several screens is drawn once, over the first, as `seen` keeps one page a place.
          add(place, id => {
            // Its closure runs once, for its own screen and for the sheet over its opener.
            const views = build()
            const own = screen(place, () => styled(views))(id)
            if (!own) return null
            let over: ResolvedUI
            try {
              over = draw(current.page, id, { span: modifier.span, value: shown.value, views }).ui
            } catch (error) {
              // What its opener can't be drawn with, the sheet still is, on its own.
              if (exhausts(error)) throw error
              return own
            }
            const layer = over.viewHierarchy?.find(item => item.type === 'Presentation')
            return over.overlay ? { ...own, alone: own.ui, ui: { ...over, viewHierarchy: layer ? [{ ...layer, type: 'Page', name: own.name }] : [] } } : own
          })
        } else add(place, screen(place, () => styled(build()), bound ? '' : place.name))
      }
    }
    return [...out, ...skipped]
  }

  // ------------------------------------------------------------- identity

  /**
   * Stamps every view in a list with its path, and registers its handler.
   *
   * The single traversal that assigns identity. `childKeys` from a `ForEach` are
   * used in preference to the ordinal, so a row keeps its path - and therefore its
   * `@State` and its DOM node - when the collection is reordered.
   */
  private stampList(views: readonly ViewValue[], prefix: string, inherited = this.visualStyle): ViewValue[] {
    const transitionOccurrences = new Map<string, number>()
    // Keys (Wave 5a): a view a branch made is counted among that branch's views, and any
    // other among the views no branch made, so a view keeps its key when an `if` before
    // it opens. A view whose key isn't its path is noted, and what is below it follows.
    const at = this.keyAt
    const parent = this.keyOf(prefix)
    let plain = 0
    let branches: Map<string, number> | undefined
    return views.map((view, index) => {
      let segment = String(index)
      let key: string
      if (view.branch) {
        branches ??= new Map()
        const count = branches.get(view.branch) ?? 0
        branches.set(view.branch, count + 1)
        key = `#${view.branch}#${count}`
      } else key = String(plain++)
      if (view.modifiers.some(modifier => modifier.name === 'transition')) {
        // An evaluated conditional removes a slot from this list. Its following
        // sibling must not inherit the disappearing view's identity, or presence
        // reconciliation cannot retain the old view for its exit transition.
        const source = `${encodeURIComponent(view.span.file)}-${view.span.start}-${view.span.end}-${encodeURIComponent(view.name)}`
        const occurrence = transitionOccurrences.get(source) ?? 0
        transitionOccurrences.set(source, occurrence + 1)
        segment = `transition-${source}-${occurrence}`
      }
      // `.id(x)`: a new x is a new view, so its hooks run as it appears and the old one's
      // as it goes, and the framework state kept by path starts over.
      const identity = view.modifiers.find((modifier) => modifier.name === 'id')?.args[0]?.value
      if (identity !== undefined) {
        const given = `@${encodeURIComponent(identityKey(identity, true))}`
        segment += given
        key += given
      }
      const path = `${prefix}-${segment}`
      if (key === segment) return this.stamp(inheritVisualStyle(view, inherited), path)
      const to = `${parent}-${key}`
      this.keys.set(path, to)
      this.keyAt = { from: path, to }
      try {
        return this.stamp(inheritVisualStyle(view, inherited), path)
      } finally {
        this.keyAt = at
      }
    })
  }

  /** The key of the view at `path`, as `stampList` gives it (Wave 5a). */
  private keyOf(path: string): string {
    const at = this.keyAt
    return at && path.startsWith(at.from) ? at.to + path.slice(at.from.length) : path
  }

  private stamp(view: ViewValue, path: string, row?: RowActions): ViewValue {
    view = inheritVisualStyle(view, this.visualStyle)
    view = this.applyControlStyle(view) ?? view
    const outerStyle = this.visualStyle
    const outerContextMenu = this.contextMenuPath
    const menu = view.modifiers.find(m => m.name === 'contextMenu' && m.closure)
    if (menu) {
      this.contextMenuPath = path
      this.register(`${path}/context-menu`, { kind: 'openMenu', menu: `${path}/context-menu` })
      this.meet(menu)
      if (reveals(this.ctx.reveal, menu)) this.revealedMenu ??= `${path}/context-menu`
    }
    this.visualStyle = visualModifiers(view)
    const onDelete = view.modifiers.find((m) => m.name === 'onDelete')?.action ?? null

    // A custom style written on this view is in scope for its whole subtree, and for
    // this view itself when it is the button.
    const style = this.buttonStyleValue(view)
    if (style) this.buttonStyles.push(style)

    try {
      const restyled = view.name === 'Button' ? this.applyButtonStyle(view, path) : view

      // A page-style TabView inside a screen is drawn in place, with only its page shown (Wave 4c).
      const pager = restyled.name === 'TabView' && restyled.span !== this.rootTabs && pageStyled(restyled) ? this.pager(restyled, path) : undefined
      const children = pager ? pager.children
        : restyled.childKeys ? this.stampRows(restyled, path, onDelete)
        : this.stampList(restyled.children, path)
      const swipe = row || restyled.modifiers.some(m => m.name === 'swipeActions') ? this.swipeActions(restyled, path, row) : undefined

      const intent = this.intentFor(restyled)
      // `Button { … } label: { … }` keeps what it is drawn with among its arguments, as
      // its content closure is the action. Those views are stamped where the layout
      // draws them, so a view in a tappable card has an identity of its own (D16).
      // The closure form of `ContentUnavailableView` keeps its description and actions there too (Wave 4b).
      const args = LAYERED_LABEL_VIEWS.has(restyled.name) ? this.stampLabel(restyled.args, path, labelArgView)
        : restyled.name === 'ContentUnavailableView' && restyled.children.length ? this.stampLabel(restyled.args, path, unavailablePart) : restyled.args
      // Layers are view subtrees too: register their controls and lifecycle hooks.
      const modifiers = restyled.modifiers.map((modifier, m) => {
        if (!['background', 'overlay', 'safeAreaInset'].includes(modifier.name)) return modifier
        return { ...modifier, args: modifier.args.map((arg, a) => {
          const layer = asView(arg.value)
          return layer && (arg.label === null || arg.label === 'content')
            ? { ...arg, value: opaque('View', this.stamp(layer, `${path}-layer-${m}-${a}`)) } : arg
        }) }
      })
      const stamped: { -readonly [K in keyof ViewValue]: ViewValue[K] } = { ...restyled, path, args, children, modifiers, contextMenuPath: this.contextMenuPath, ...(intent ? { intent } : {}) }
      if (swipe) stamped.swipe = swipe
      if (pager) stamped.pager = pager.dots

      if (intent) this.handlers.set(handlerIdFor(path), intent)
      this.collectLifecycle(restyled, path)
      return this.operable(this.gateAnimation(stamped, path), path)
    } finally {
      if (style) this.buttonStyles.pop()
      this.visualStyle = outerStyle
      this.contextMenuPath = outerContextMenu
    }
  }

  /**
   * The views a control is drawn with from its arguments, a `label:` or a Label's `icon:`,
   * stamped in order under `…label` or `…icon`, the prefix the layout draws them with. A
   * label then has an identity of its own, and a click on the canvas finds it (Wave 3a).
   */
  private stampLabel(args: readonly ViewArg[], path: string, part: (arg: ViewArg) => ViewValue | null): readonly ViewArg[] {
    const stamped = new Map<string, ViewValue[]>()
    for (const label of new Set(args.flatMap(arg => part(arg) ? [arg.label!] : []))) {
      stamped.set(label, this.stampList(args.flatMap(arg => arg.label === label ? part(arg) ?? [] : []), `${path}${label}`))
    }
    return args.map(arg => part(arg) ? { ...arg, value: opaque('View', stamped.get(arg.label!)!.shift()!) } : arg)
  }

  /**
   * A `Toggle` or a `Label` drawn by a custom style's `makeBody(configuration:)`, the
   * style written on it or above it (`inheritVisualStyle` has already brought it down).
   *
   * The style draws the whole control, as in SwiftUI: a toggle with a custom style
   * switches only where its body says so, `configuration.isOn.toggle()`, which writes
   * through to the toggle's own binding. What the body draws stands where the control
   * did, as a group, so the control's own modifiers still apply to it. Inside the body
   * the style is the stock one again, as in SwiftUI, or a Toggle the style draws would
   * be drawn by the style again.
   */
  private applyControlStyle(view: ViewValue): ViewValue | null {
    const name = view.name === 'Toggle' ? 'toggleStyle' : view.name === 'Label' ? 'labelStyle' : null
    const style = name ? view.modifiers.find((m) => m.name === name)?.args[0]?.value : undefined
    if (!name || style?.kind !== 'struct' || !this.ctx.styleBody) return null
    const configuration = name === 'toggleStyle' ? toggleConfiguration(view) : labelConfiguration(view)
    const body = this.ctx.styleBody(style, name === 'toggleStyle' ? 'ToggleStyle' : 'LabelStyle', configuration)
    if (!body || body.length === 0) return null
    const modifiers = view.modifiers.map((m) => m.name === name ? { ...m, args: [{ label: null, value: AUTOMATIC_STYLE }] } : m)
    return { ...view, name: 'Group', args: [], children: body, modifiers }
  }

  /** Built-in tokens also shadow an inherited custom style. */
  private buttonStyleValue(view: ViewValue): SwiftValue | null {
    const modifier = view.modifiers.find((m) => m.name === 'buttonStyle')
    const argument = modifier?.args[0]?.value
    return argument ?? null
  }

  /**
   * Replaces a button's label with what its style's `makeBody(configuration:)` drew.
   *
   * The `Button` itself survives - its action, its path and its hit target are the
   * button's *behaviour*, and a style describes only its appearance. Replacing the
   * whole view would take the tap with it.
   */
  private applyButtonStyle(view: ViewValue, path: string): ViewValue {
    const style = this.buttonStyles[this.buttonStyles.length - 1]
    if (!style || style.kind !== 'struct' || !this.ctx.styleButton) return view

    // `configuration.label` is whatever the button was going to draw: its title when
    // it was given one, otherwise its content views.
    const title = view.args.find((a) => a.label === null)?.value
    const label: readonly ViewValue[] =
      view.children.length > 0
        ? view.children
        : title !== undefined && title.kind === 'string'
          ? [{ name: 'Text', args: [{ label: null, value: title }], children: [], modifiers: [], action: null, span: view.span }]
          : []

    // `isPressed` is always false. The tree is built between interactions, never
    // during one, so there is no press to report - and a style that draws a pressed
    // state simply draws its resting one, which is what the preview is showing.
    void path
    const body = this.ctx.styleButton(style, label, false)
    if (!body || body.length === 0) return view

    // The title is dropped along with it: leaving it would draw the label twice.
    return { ...view, args: [], children: body }
  }

  /** Records `.onAppear`, `.onDisappear`, `.task` and `.onChange` for this view. */
  private collectLifecycle(view: ViewValue, path: string): void {
    const seen = new Map<string, number>()
    for (const modifier of view.modifiers) {
      const place = seen.get(modifier.name) ?? 0
      seen.set(modifier.name, place + 1)
      const action = modifier.action
      if (!action) continue
      const key = `${path}/${modifier.name}-${place}`

      if (modifier.name === 'onAppear' || modifier.name === 'task') {
        const id = modifier.name === 'task' ? labelled(modifier.args, 'id') : undefined
        this.lifecycle.push({ kind: 'appear', key, action, ...(id !== undefined ? { watched: id } : {}) })
        continue
      }
      if (modifier.name === 'onDisappear') {
        this.lifecycle.push({ kind: 'disappear', key, action })
        continue
      }
      if (modifier.name === 'onChange') {
        const watched = modifier.args.find((a) => a.label === 'of')?.value ?? modifier.args[0]?.value
        this.lifecycle.push({
          kind: 'change',
          key,
          initial: truthy(labelled(modifier.args, 'initial') ?? { kind: 'bool', value: false }),
          action,
          ...(watched !== undefined ? { watched } : {}),
        })
      }
    }
  }

  /**
   * Stamps a `ForEach`'s rows by their ids.
   *
   * An element's first row is at its id, a second row it draws at the id and its place
   * (`B.1`), and an element whose id an earlier one already has is counted (`A~2`), so
   * every row has a path and a handler of its own, and a swipe deletes the element its
   * row was drawn for. SwiftUI warns about a shared id at run time, and so does this.
   */
  private stampRows(view: ViewValue, path: string, onDelete: ActionValue | null): ViewValue[] {
    // `.swipeActions` on the ForEach gives each of its rows the same actions.
    const swipes = view.modifiers.filter(m => m.name === 'swipeActions' && m.closure)
    const keys = view.childKeys!
    const holders = new Map<string, number[]>()
    const firstRow = new Map<number, number>()
    let shared: string | undefined
    const rows = view.children.map((child, i) => {
      const key = keys[i]!
      const offset = view.childOffsets?.[i] ?? i
      if (!firstRow.has(offset)) firstRow.set(offset, i)
      const place = i - firstRow.get(offset)!
      const holding = holders.get(key) ?? []
      if (!holding.includes(offset)) holding.push(offset)
      holders.set(key, holding)
      const repeat = holding.indexOf(offset)
      if (repeat > 0) shared ??= key
      const segment = `${keySegment(key, i)}${repeat > 0 ? `~${repeat + 1}` : ''}${place > 0 ? `.${place}` : ''}`
      return this.stamp(child, `${path}-${segment}`, onDelete || swipes.length ? { onDelete, offset, swipes } : undefined)
    })
    if (shared !== undefined) {
      this.warnings.push({
        span: view.span,
        severity: 'warning',
        code: 'runtime_trap',
        message: `Two rows of this ForEach have the id ${shared}. SwiftUI needs every row's id to be different, or it can draw or update the wrong row.`,
      })
    }
    return rows
  }

  /**
   * A list row's swipe actions (Wave 4a). `.onDelete` is written on the `ForEach`, and gives
   * each row a Delete at its trailing edge, which iOS 27 offers beside leading actions and
   * not beside trailing ones. Only the edge the row is open towards, swiped or revealed on
   * the canvas, has its closures built and its buttons stamped under the row's path, the
   * outermost first: a shut row builds none, and its drag needs only to know which edges
   * have actions and which button a full swipe runs, by the path it is stamped at. A tap on
   * any of them closes the row, as its drag opens it.
   */
  private swipeActions(view: ViewValue, path: string, row?: RowActions): SwipeActions | undefined {
    const own = view.modifiers.filter(m => m.name === 'swipeActions' && m.closure)
    const written = row?.swipes.length ? own.concat(row.swipes) : own
    const edgeOf = (modifier: ModifierValue) => tokenName(labelled(modifier.args, 'edge')) === 'leading' ? 'leading' : 'trailing'
    const has = { leading: false, trailing: false }
    const fullSwipe = { leading: true, trailing: true }
    let reveal: 'leading' | 'trailing' | null = null
    for (const modifier of written) {
      const edge = edgeOf(modifier)
      const full = labelled(modifier.args, 'allowsFullSwipe')
      if (full) fullSwipe[edge] = truthy(full)
      has[edge] = true
      this.meet(modifier)
      if (!reveal && !this.revealedRow && reveals(this.ctx.reveal, modifier)) reveal = edge
    }
    const onDelete: ViewIntent | null = row?.onDelete && !has.trailing ? { kind: 'delete', action: row.onDelete, offset: row.offset, row: path } : null
    if (!has.leading && !has.trailing && !onDelete) return undefined
    if (onDelete) this.register(`${path}/delete`, onDelete)
    if (reveal) this.revealedRow = true

    const full: { leading?: string; trailing?: string } = {}
    if (fullSwipe.leading && has.leading) full.leading = `${path}/swipe-leading-0`
    if (fullSwipe.trailing && (has.trailing || onDelete)) full.trailing = onDelete ? `${path}/delete` : `${path}/swipe-trailing-0`
    const close: ViewIntent = { kind: 'swipe', row: path, edges: { leading: has.leading, trailing: has.trailing || !!onDelete }, full }
    this.register(`${path}/swipe`, close)

    const offset = reveal === 'leading' ? -Infinity : reveal ? Infinity : this.ctx.state.swipeOffset(path)
    const leading: ViewValue[] = [], trailing: ViewValue[] = []
    const open = offset < 0 ? 'leading' : offset > 0 ? 'trailing' : null
    if (open) {
      const buttons = open === 'leading' ? leading : trailing
      for (const modifier of written) {
        if (edgeOf(modifier) !== open) continue
        for (const button of flattenForEach(this.ctx.build(modifier.closure!, [], modifier.environment, 'Swipe actions'))) {
          buttons.push(this.stamp(button, `${path}/swipe-${open}-${buttons.length}`))
        }
      }
      if (open === 'trailing' && onDelete) trailing.push({ name: 'Button', args: DELETE_ACTION, children: [], modifiers: [], action: null, span: view.span, path: `${path}/delete`, intent: onDelete })
      for (const button of buttons) {
        if (button.intent?.kind === 'run') this.handlers.set(handlerIdFor(button.path!), { kind: 'run', action: button.intent.action, dismiss: close })
      }
    }
    return { offset, path, leading, trailing, fullSwipe }
  }

  /** Notes a swipe or context-menu modifier on a page of the canvas, which can draw it open (Wave 4a). */
  private meet(modifier: ModifierValue): void {
    if (this.ctx.reveal !== undefined && modifier.closure) this.revealable.set(modifier.span, modifier)
  }

  /**
   * What this view does when tapped.
   *
   * A `Button`'s own closure, a gesture modifier's closure, or - for controls the
   * user wrote no closure for - a framework behaviour derived from the binding it
   * was given. All three arrive at the same place so that the layout pass has exactly
   * one question to ask about interactivity.
   */
  private intentFor(view: ViewValue): ViewIntent | null {
    if (view.intent) return view.intent
    if (view.action) return { kind: 'run', action: view.action }

    // Controls the user gave a binding need no closure of their own: writing the
    // binding *is* the behaviour, and it is the framework's job to do it. The value
    // written comes from the event - the text typed, the slider's new position - so
    // the constant here is only the fallback for a control activated without one.
    const control = CONTROL_BINDINGS[view.name]
    if (control) {
      const binding = labelled(view.args, control.argument)
      if (binding && asProjection(binding)) {
        return control.argument === 'isOn'
          ? { kind: 'toggle', binding }
          : { kind: 'write', binding, value: asProjection(binding)!.get() }
      }
    }

    // A real gesture wins over a tap handler on the same view: it is the more
    // specific statement of intent, and SwiftUI resolves it the same way.
    const attached = view.modifiers.find(
      (m) => m.name === 'gesture' || m.name === 'simultaneousGesture' || m.name === 'highPriorityGesture',
    )
    const gestureValue = attached?.args.find((a) => a.label === null)?.value
    if (gestureValue) return { kind: 'gesture', gesture: gestureValue }

    const tap = view.modifiers.find(
      (m) => m.name === 'onTapGesture' || m.name === 'onLongPressGesture',
    )
    if (tap?.action) return { kind: 'run', action: tap.action }

    return null
  }

  /**
   * Gives every `NavigationLink` on a screen the intent to push its own destination.
   *
   * A second pass rather than part of stamping, because a link's behaviour depends on
   * which stack encloses it - and the stack's identity is itself a stamped path. A
   * link outside any stack is left inert, which is also what SwiftUI does with it.
   */
  private attachPushIntents(views: readonly ViewValue[], stackId: string, route?: { binding: SwiftValue; list: ArrayValue }): ViewValue[] {
    return views.map((view) => {
      const children = this.attachPushIntents(view.children, stackId, route)

      if (view.name !== 'NavigationLink' || !view.path) {
        return children === view.children ? view : { ...view, children }
      }

      // In a stack bound to a path, a link's value is appended to the path, as SwiftUI does.
      const value = route && labelled(view.args, 'value')
      const intent: ViewIntent = value ? { kind: 'write', binding: route.binding, value: withElements(route.list, [...route.list.elements, value]) }
        : { kind: 'push', link: `${stackId}|${view.path}` }
      this.handlers.set(handlerIdFor(view.path), intent)
      return { ...view, children, intent }
    })
  }

  private register(path: string, intent: ViewIntent): string {
    const id = handlerIdFor(path)
    this.handlers.set(id, intent)
    return id
  }

  /** `path`, once what a tap there does is registered. */
  private registered(path: string, intent: ViewIntent): string {
    this.register(path, intent)
    return path
  }

  /**
   * Controls whose parts are pressed separately, rather than the view as a whole.
   *
   * A `Button` is one tap on one view, which `intentFor` covers. A `Stepper` is two
   * taps on two halves of one view, and a `DisclosureGroup` is a tap on its row that
   * shows or hides everything below it - neither fits "one intent per view", which is
   * why both were drawn correctly and did nothing at all.
   *
   * The sub-paths registered here are the ones `to-layout` builds hit targets at, and
   * the two agree because both derive the id from the same path.
   */
  /**
   * Decides whether an `.animation(_:value:)` on this view is armed this frame.
   *
   * Recorded as an argument on the modifier rather than resolved in the layout pass,
   * for the same reason a `DisclosureGroup`'s open-ness is: the decision needs state
   * that outlives one render, and the resolver is the one stage that has it.
   */
  private gateAnimation(view: ViewValue, path: string): ViewValue {
    const index = view.modifiers.findIndex((m) => m.name === 'animation')
    if (index < 0) return view

    const modifier = view.modifiers[index]!
    const gate = modifier.args.find((a) => a.label === 'value')?.value
    const open = gate === undefined || this.ctx.state.animationGateOpen(`${path}m${index}`, identityKey(gate, true))
    // What it animates this frame is said by the view's key, for the views leaving it (Wave 5a).
    const animation = open ? animationOf(modifier.args[0]?.value) : null
    if (animation) this.armed.push({ key: this.keyOf(path), animation })
    if (gate === undefined) return view

    const modifiers = [...view.modifiers]
    modifiers[index] = {
      ...modifier,
      args: [...modifier.args, { label: 'armed', value: { kind: 'bool' as const, value: open } }],
    }
    return { ...view, modifiers }
  }

  private operable(view: ViewValue, path: string): ViewValue {
    const submit = view.modifiers.find(m => m.name === 'onSubmit')
    if (submit?.action && ['TextField', 'SecureField', 'TextEditor'].includes(view.name)) this.register(`${path}/submit`, { kind: 'run', action: submit.action })
    if (view.name === 'Stepper') {
      const binding = labelled(view.args, 'value')
      if (!binding || !asProjection(binding)) return view

      // `step:` is how much each press is worth; SwiftUI's default is 1.
      const step = numberOf(labelled(view.args, 'step')) ?? 1
      const range = labelled(view.args, 'in')
      const bounds =
        range?.kind === 'range'
          ? { min: range.lower, max: range.closed ? range.upper : range.upper - 1 }
          : undefined

      this.register(`${path}/minus`, { kind: 'adjust', binding, by: -step, ...(bounds ? { bounds } : {}) })
      this.register(`${path}/plus`, { kind: 'adjust', binding, by: step, ...(bounds ? { bounds } : {}) })
      return view
    }

    if (view.name === 'DatePicker' || view.name === 'ColorPicker') {
      // Drawn and unopenable until now. Each needs an editor of its own rather than
      // the list of options that made the other four cheap - a calendar and a colour
      // surface - so they share the menu's *mechanism* and none of its content.
      const intent: ViewIntent = { kind: 'openMenu', menu: path }
      this.handlers.set(handlerIdFor(path), intent)
      // A graphical DatePicker draws its month in place (Wave 6d). Its style is written on it
      // or inherited from around it, so the month is built only for one that is graphical.
      const graphical = view.name === 'DatePicker' && tokenName(view.modifiers.find(m => m.name === 'datePickerStyle')?.args[0]?.value) === 'graphical'
      const calendar = graphical ? this.calendar(view, path, dateSelection(view)) : null
      return calendar ? { ...view, intent, args: [...view.args, { label: '_calendar', value: opaque('View', calendar) }] } : { ...view, intent }
    }

    if (view.name === 'Picker' || view.name === 'Menu') {
      // Pressing the control shows its options. This replaces the intent
      // `CONTROL_BINDINGS` gives a Picker - writing the selection back over itself,
      // which is what "drawn but does not open" looked like from the inside.
      const intent: ViewIntent = { kind: 'openMenu', menu: path }
      this.handlers.set(handlerIdFor(path), intent)

      // A Picker drawn inline - segmented, wheel or inline - shows every option on
      // screen rather than behind a press, so each option needs a target of its own.
      // They are registered whatever the style, and the layout decides which ones it
      // actually draws: the resolver owns what choosing *means*, the layout owns what
      // is on screen, and a registration nothing points at costs a map entry.
      const selection = labelled(view.args, 'selection')
      if (view.name === 'Picker' && selection) {
        const binding = asProjection(selection)
        const current = binding ? identityKey(binding.get(), true) : null

        // `Picker { ForEach(options) { … } }` is how a picker over a collection is
        // written, and its options are a level down. Flattened once, here, so the
        // overlay and the segmented drawing both see options rather than a container -
        // otherwise each has to know, and one of them will not.
        const options = flattenForEach(view.children)
        this.warnIfUnselectable(view, options, binding)

        const children = options.map((child, index) => {
          const value = rowTag(child, binding)
          const tag = tokenOrValue(value)
          if (value !== undefined) {
            this.register(`${path}/seg-${index}`, {
              kind: 'choose',
              binding: selection,
              value,
            })
          }
          return {
            ...child,
            args: [
              ...child.args,
              {
                label: 'selected',
                value: { kind: 'bool' as const, value: tag !== null && tag === current },
              },
            ],
          } satisfies ViewValue
        })

        return { ...view, intent, children }
      }

      if (view.name === 'Picker') return { ...view, intent, children: flattenForEach(view.children) }

      return { ...view, intent }
    }

    if (view.name === 'DisclosureGroup') {
      // `isExpanded:` is the form with a binding. Where the user wrote one it is the
      // truth and the framework's own record is not consulted at all.
      const binding = labelled(view.args, 'isExpanded')
      const projection = asProjection(binding)
      const open = projection ? truthy(projection.get()) : this.ctx.state.isExpanded(path)

      this.register(
        `${path}/row`,
        projection ? { kind: 'toggle', binding: binding! } : { kind: 'expand', group: path },
      )

      return {
        ...view,
        args: [...view.args, { label: 'isExpanded', value: { kind: 'bool', value: open } }],
        // A closed group's content is not drawn. Dropping it here rather than in the
        // layout keeps the decision next to the state that makes it.
        children: open ? view.children : [],
      }
    }

    return view
  }

  /**
   * A `DatePicker`'s editor: the month its value falls in, as a grid of days.
   *
   * The month on show is framework state - the user's binding holds a *date*, and
   * paging to another month before choosing a day must not change it - so it lives
   * beside the navigation stack and the open menu, keyed by the control's path.
   *
   * The arithmetic is done here in JavaScript, where a real calendar exists. That is
   * not the same as giving the *interpreter* a `Calendar`: this is framework chrome,
   * and the coverage matrix's "a Date has no calendar" is about what the user's own
   * code can call, which is unchanged.
   */
  private dateEditor(
    control: ViewValue,
    open: string,
    dismiss: ViewIntent,
    dismissId: string,
  ): Overlay {
    const picked = dateSelection(control)
    const { binding, seconds, lower, upper } = picked
    const valid = (date: Date) => date.getTime() / 1000 >= lower && date.getTime() / 1000 <= upper
    const timeVisible = datePickerParts(control) !== 'date'
    const views: ViewValue[] = []
    const calendar = this.calendar(control, open, picked)
    if (calendar) views.push(calendar)
    if (timeVisible) {
      const path = `${open}/time`
      const timeText = () => {
        const date = new Date((asDate(binding?.get() ?? { kind: 'nil' })?.epochSeconds ?? seconds) * 1000)
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
      }
      const timeBinding = makeProjection({
        description: 'DatePicker time', get: () => str(timeText()),
        set: value => {
          if (value.kind !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.value)) return
          const date = new Date((asDate(binding?.get() ?? { kind: 'nil' })?.epochSeconds ?? seconds) * 1000)
          const [hour, minute] = value.value.split(':').map(Number)
          date.setHours(hour!, minute!)
          if (valid(date)) binding?.set(dateValue(date.getTime() / 1000))
        },
      })
      const intent: ViewIntent = { kind: 'write', binding: timeBinding, value: str(timeText()) }
      this.register(path, intent)
      views.push({ name: 'TextField', args: [{ label: null, value: str('Time') }, { label: 'text', value: timeBinding }, { label: '_inputType', value: str('time') }], children: [], modifiers: [], action: null, span: control.span, path, intent })
    }
    return { kind: 'menu', views, detent: 0, title: stringArg(control.args.find(a => a.label === null)?.value) ?? '', message: '', dismiss, dismissId }
  }

  /**
   * The month a `DatePicker`'s value falls in, as a grid of days that each choose that day,
   * with arrows that page the month: its popup's calendar and a graphical one's (Wave 6d).
   * Null when it shows no date. Calendar and time editor use the same local timezone as
   * the collapsed label.
   */
  private calendar(control: ViewValue, open: string, { selection, seconds, lower, upper }: ReturnType<typeof dateSelection>): ViewValue | null {
    if (datePickerParts(control) === 'time') return null
    const chosen = new Date(seconds * 1000)
    const shown = new Date(Math.max(lower, Math.min(upper, seconds)) * 1000)
    shown.setDate(1)
    shown.setMonth(shown.getMonth() + this.ctx.state.monthOffset(open))
    const year = shown.getFullYear(), month = shown.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const leading = new Date(year, month, 1).getDay()
    const cells: ViewValue[] = []
    for (let i = 0; i < leading; i++) cells.push(this.editorCell(`${open}/pad-${i}`, '', false, null))
    for (let day = 1; day <= daysInMonth; day++) {
      const path = `${open}/day-${day}`, value = new Date(chosen)
      value.setFullYear(year, month, day)
      const selected = chosen.getFullYear() === year && chosen.getMonth() === month && chosen.getDate() === day
      const bounded = new Date(Math.max(lower, Math.min(upper, value.getTime() / 1000)) * 1000)
      const allowed = bounded.getFullYear() === year && bounded.getMonth() === month && bounded.getDate() === day
      const write: ViewIntent | null = selection && allowed ? { kind: 'choose', binding: selection, value: dateValue(bounded.getTime() / 1000) } : null
      if (write) this.register(path, write)
      cells.push(this.editorCell(path, String(day), selected, write))
    }
    const step = (delta: number, label: string): ViewValue => {
      const path = `${open}/month-${delta}`
      const start = new Date(year, month + delta, 1).getTime() / 1000
      const end = new Date(year, month + delta + 1, 1).getTime() / 1000
      const intent: ViewIntent | null = end > lower && start <= upper ? { kind: 'stepMonth', control: open, by: delta } : null
      if (intent) this.register(path, intent)
      return this.editorCell(path, label, false, intent)
    }
    return { name: DATE_EDITOR, args: [{ label: 'title', value: str(MONTHS[month]! + ' ' + year) }], children: [step(-1, '‹'), step(1, '›'), ...cells], modifiers: [], action: null, span: control.span, path: `${open}/editor` }
  }

  /**
   * Named color swatches with an alpha slider when supportsOpacity is enabled.
   * Arbitrary RGB selection remains outside the preview palette's scope.
   */
  private colourEditor(
    control: ViewValue,
    open: string,
    dismiss: ViewIntent,
    dismissId: string,
  ): Overlay {
    const selection = labelled(control.args, 'selection')
    const projection = asProjection(selection)
    const current = payloadOf<ColorPayload>(projection?.get(), COLOR_TYPE)

    const supportsOpacity = labelled(control.args, 'supportsOpacity')?.kind !== 'bool' || truthy(labelled(control.args, 'supportsOpacity')!)
    const alpha = () => payloadOf<ColorPayload>(projection?.get(), COLOR_TYPE)?.opacity ?? 1
    const swatches = SWATCHES.map((name) => {
      const path = `${open}/colour-${name}`
      const value = opaque(COLOR_TYPE, { name, ...(supportsOpacity ? { opacity: alpha() } : {}) })
      const intent: ViewIntent | null = selection
        ? { kind: 'choose', binding: selection, value }
        : null
      if (intent) this.register(path, intent)

      return {
        name: COLOUR_SWATCH,
        args: [
          { label: 'colour', value },
          { label: 'selected', value: { kind: 'bool' as const, value: current?.name === name && !current.asset } },
        ],
        children: [],
        modifiers: [],
        action: null,
        span: control.span,
        path,
        ...(intent ? { intent } : {}),
      } satisfies ViewValue
    })

    const opacityViews: ViewValue[] = []
    if (supportsOpacity && projection) {
      const path = `${open}/opacity`
      const binding = makeProjection({ description: 'ColorPicker opacity', get: () => double(alpha()), set: value => {
        const color = payloadOf<ColorPayload>(projection.get(), COLOR_TYPE)
        if (color && (value.kind === 'double' || value.kind === 'int')) projection.set(opaque(COLOR_TYPE, { ...color, opacity: Math.max(0, Math.min(1, value.value)) }))
      } })
      const intent: ViewIntent = { kind: 'write', binding, value: double(alpha()) }
      this.register(path, intent)
      opacityViews.push({ name: 'Text', args: [{ label: null, value: str('Opacity') }], children: [], modifiers: [], action: null, path: `${path}-label`, span: control.span })
      opacityViews.push({ name: 'Slider', args: [{ label: null, value: str('Opacity') }, { label: 'value', value: binding }, { label: 'step', value: double(0.01) }], children: [], modifiers: [], action: null, path, span: control.span, intent })
    }
    return {
      kind: 'menu',
      views: [
        {
          name: COLOUR_EDITOR,
          args: [],
          children: swatches,
          modifiers: [],
          action: null,
          span: control.span,
          path: `${open}/editor`,
        },
        ...opacityViews,
      ],
      detent: 0,
      title: stringArg(control.args.find((a) => a.label === null)?.value) ?? '',
      message: '',
      dismiss,
      dismissId,
    }
  }

  /** One cell of the date grid: a label, whether it is chosen, and what pressing it does. */
  private editorCell(
    path: string,
    label: string,
    selected: boolean,
    intent: ViewIntent | null,
  ): ViewValue {
    return {
      name: DATE_CELL,
      args: [
        { label: 'label', value: { kind: 'string', value: label } },
        { label: 'selected', value: { kind: 'bool', value: selected } },
        { label: 'enabled', value: { kind: 'bool', value: !!intent } },
      ],
      children: [],
      modifiers: [],
      action: null,
      span: { file: '', start: 0, end: 0 },
      path,
      ...(intent ? { intent } : {}),
    }
  }

  /**
   * The open `Picker` or `Menu`, as an overlay of its options.
   *
   * Built from the control's own children rather than invented: a Picker's options
   * are the views the user wrote inside it, each carrying the `.tag` that says what
   * choosing it means. The selected one is ticked, which is the only thing on screen
   * that reports the current value once the list is up.
   *
   * iOS anchors this popup to the control it came from. This draws it as a panel at
   * the bottom, which is where the same list appears when a Picker is presented from
   * a form - an approximation of position, never of content, and recorded as one in
   * the coverage matrix.
   */
  private menuOverlay(views: readonly ViewValue[], open: string | null, bars?: { readonly navigationBar: NavigationBar | null; readonly bottomBar: BottomBar | null }): Overlay | null {
    if (!open) return null

    const isContextMenu = open.endsWith('/context-menu')
    const ownerPath = isContextMenu ? open.slice(0, -'/context-menu'.length) : open
    // A menu in the toolbar opens as one in the screen does, the ellipsis menu among them (Wave 6c).
    const control = findByPath(views, ownerPath) ?? (bars ? findByPath(toolbarViews(bars.navigationBar, bars.bottomBar?.items), ownerPath) : null)
    if (!control) {
      // The control is gone - a filter changed, a row was deleted. Closing is the
      // honest response; leaving it open would dim the screen over nothing.
      this.ctx.state.setOpenMenu(null)
      return null
    }

    const dismiss: ViewIntent = { kind: 'openMenu', menu: null }
    const dismissId = this.register(`${open}/dismiss`, dismiss)

    if (!isContextMenu && control.name === 'DatePicker') return this.dateEditor(control, open, dismiss, dismissId)
    if (!isContextMenu && control.name === 'ColorPicker') return this.colourEditor(control, open, dismiss, dismissId)

    const selection = isContextMenu ? undefined : labelled(control.args, 'selection')
    const binding = asProjection(selection)
    const current = binding ? identityKey(binding.get(), true) : null

    const contextMenu = control.modifiers.find(m => m.name === 'contextMenu')
    // A menu over `ForEach` shows its rows, as a Picker over one does.
    const items = flattenForEach(isContextMenu && contextMenu?.closure
      ? this.ctx.build(contextMenu.closure, [], contextMenu.environment, 'Context menu')
      : control.children)
    const rows = items.map((child, index) => {
      const path = `${open}/opt-${index}`
      const value = selection ? rowTag(child, binding) : undefined
      const tag = tokenOrValue(value)

      // A Picker's row selects; a Menu's row is already a Button and keeps its own
      // action. Either way the menu closes, which the runtime does for any press
      // made while one is open.
      if (selection && value !== undefined) {
        this.register(path, { kind: 'choose', binding: selection, value })
      }

      const stamped = this.stamp(child, path)
      return {
        ...stamped,
        args: [
          ...stamped.args,
          { label: 'selected', value: { kind: 'bool' as const, value: tag !== null && tag === current } },
        ],
        ...(selection && value !== undefined
          ? { intent: { kind: 'choose' as const, binding: selection, value } }
          : {}),
      } satisfies ViewValue
    })

    return {
      kind: 'menu',
      // A context menu is placed beside its view by the layout, and named by the handler that
      // opens it, which that view carries, for the renderer to keep it there when a list scrolls.
      anchorId: handlerIdFor(isContextMenu ? open : ownerPath),
      views: rows,
      detent: 0,
      title: stringArg(control.args.find((a) => a.label === null)?.value) ?? '',
      message: '',
      dismiss,
      dismissId,
      ...(isContextMenu ? { contextMenu: ownerPath } : {}),
    }
  }

  /**
   * A Picker none of whose rows its selection can match selects nothing, on a device
   * too, and nothing says why. The preview says so where it is written.
   */
  private warnIfUnselectable(picker: ViewValue, rows: readonly ViewValue[], binding: ProjectionPayload | null): void {
    if (!binding || rows.length === 0 || rows.some((row) => rowTag(row, binding) !== undefined)) return
    const selected = binding.get()
    const written = collectModifier(rows, 'tag')?.args[0]?.value
    const tag = written ?? rows.find((row) => row.implicitTag !== undefined)?.implicitTag
    const reason = tag === undefined ? 'its rows have no .tag'
      : binding.declared?.optional && written === undefined ? "its selection is Optional, and the tag a ForEach row gets is not"
      : `its rows are tagged ${typeNameOf(tag)}, and its selection is ${selected.kind === 'nil' ? binding.declared?.name ?? 'nil' : typeNameOf(selected)}`
    this.warnings.push({
      span: picker.span,
      severity: 'warning',
      code: 'type_mismatch',
      message: `This Picker can't select any of its rows: ${reason}. Tag each row with .tag(value) of the selection's type.`,
    })
  }

  // ----------------------------------------------------------- navigation

  /**
   * Resolves a navigation stack to the screen currently on top.
   *
   * The whole tree is evaluated every pass, including the screens underneath - which
   * is what keeps a pushed detail view live when the data behind it changes. What the
   * stack stores is a list of *link paths*, resolved against the freshly evaluated
   * tree each time. A link that has vanished truncates the stack rather than leaving
   * it pointing at nothing.
   */
  private resolveNavigation(stack: ViewValue): {
    content: readonly ViewValue[]
    navigationBar: NavigationBar | null
    bottomBar: BottomBar | null
    /** The bars `.toolbar(.hidden, for:)` hides on the screen on top, as `HIDES` bits. */
    hidden: number
  } {
    const stackId = stack.path ?? 'nav'
    const pushed = this.basePage ? [] : this.ctx.state.stack(stackId)

    let screen: readonly ViewValue[] = stack.children
    // The root's title when it sets none is *no title*, as in SwiftUI. It used to
    // default to "Home", which put a word on screen that appears nowhere in the
    // user's code - a small invention, and the preview inventing anything is the one
    // thing it must not do.
    const titles: string[] = [titleOf(stack.children, '')]
    let depth = 0
    const rootMode = tokenName(collectModifier(screen, 'navigationBarTitleDisplayMode')?.args[0]?.value)
    // Whether the screen on top shows a large title. A pushed screen left automatic shows
    // what the one before it showed, so one pushed after a screen with no title, which
    // shows none, is titled inline, as iOS 27 does (D13).
    let large = rootMode !== 'inline' && titles[0]!.length > 0
    /** What Back does on the screen on top: pops a link, or clears the binding that pushed it. */
    let back: ViewIntent = { kind: 'pop' }

    /** Puts `destination` on top of the stack, titled `label` when it sets no title of its own. */
    const push = (destination: readonly ViewValue[], label: string) => {
      // A reusable destination may declare its own navigation container (for
      // example a screen also used as a tab). The active stack already owns its
      // chrome and back history; keep the container's content, modifiers and
      // source identity as a transparent group instead of laying out an unknown
      // NavigationStack node. Descendant links then push onto this same history.
      const content = (view: ViewValue): ViewValue => ({
        ...view,
        name: ['NavigationStack', 'NavigationView', 'NavigationSplitView'].includes(view.name) ? 'Group' : view.name,
        children: view.children.map(content),
      })
      // The stack's environment, not the link's: `.buttonStyle(.plain)` on a list row's
      // link styles that row, and must not turn every button on the pushed screen plain.
      screen = this.stampList(destination.map(content), `n${depth + 1}`, visualModifiers(stack))
      const requestedMode = tokenName(collectModifier(screen, 'navigationBarTitleDisplayMode')?.args[0]?.value)
      if (requestedMode && requestedMode !== 'automatic') large = requestedMode !== 'inline'
      large &&= titleOf(screen, '').length > 0
      titles.push(titleOf(screen, label))
      depth++
    }

    // A stack bound to a path shows a screen for each value in it, from the
    // `navigationDestination(for:)` for its type, written on the screens below it (Wave 3b).
    const route = labelled(stack.args, 'path')
    const values = asProjection(route)?.get()
    if (!this.basePage && values?.kind === 'array' && values.elements.length) {
      const kept: ViewValue[] = [...stack.children]
      for (const [index, value] of values.elements.entries()) {
        const builder = builderFor(value, kept, true)
        // SwiftUI pushes nothing for a value no destination shows, and says so as it runs.
        if (!builder?.closure) { this.warnings.push(unshown(value, stack.span)); break }
        const destination = this.ctx.build(builder.closure, [value], builder.environment, 'Destination')
        if (!destination.length) break
        push(destination, '')
        kept.push(...screen)
        back = { kind: 'write', binding: route!, value: withElements(values, values.elements.slice(0, index)) }
      }
    }

    const below = depth
    for (const linkPath of pushed) {
      // A link in the toolbar pushes as one in the screen does, as `History` does in a
      // bar's corner.
      const link = findByPath(screen, linkPath) ?? findByPath(this.toolbarItems(screen, stackId), linkPath)
      const destination = link ? this.destinationFor(link, screen) : null
      if (!destination || destination.length === 0) break
      push(destination, labelTextOf(link!) || 'Back')
      back = { kind: 'pop' }
    }

    // Anything we could not resolve is dropped, so the back button stays truthful.
    this.ctx.state.truncate(stackId, depth - below)
    // A destination a binding pushes is on top while the binding holds (Wave 3b).
    for (let bound = this.basePage ? null : boundDestination(screen); bound && depth < 16; bound = boundDestination(screen)) {
      const destination = this.ctx.build(bound.modifier.closure!, bound.args, bound.modifier.environment, 'Destination')
      if (!destination.length) break
      back = bound.back
      push(destination, '')
    }
    screen = this.attachPushIntents(screen, stackId, values?.kind === 'array' ? { binding: route!, list: values } : undefined)

    const explicitTitle = collectModifier(screen, 'navigationTitle')
    const title =
      stringArg(explicitTitle?.args[0]?.value) ?? (depth === 0 ? titles[0]! : titles[depth]!)

    // `.navigationSubtitle` takes a string or a Text (Wave 6c); a Text with no words the preview can read isn't drawn, and says so.
    const writtenSubtitle = collectModifier(screen, 'navigationSubtitle')
    const subtitle = writtenSubtitle ? wordsIn(writtenSubtitle.args[0]?.value) : ''
    if (writtenSubtitle && !subtitle && writtenSubtitle.args[0]?.value.kind !== 'string') this.warnings.push({ span: writtenSubtitle.span, severity: 'warning', code: 'unsupported_swiftui_modifier', feature: '.navigationSubtitle', message: "The preview doesn't draw this .navigationSubtitle: it can't read its Text's words. It still appears in the app." })

    const backId = depth > 0 ? this.register(`${stackId}/back`, back) : null
    // One walk finds the screen's toolbars and the bars it hides (Wave 4b).
    const toolbars = toolbarsOf(screen)
    const toolbar = this.resolveToolbar(toolbars.owners, stackId)

    // An untitled screen still needs a back button that says something, and "Back" is
    // what iOS itself falls back to.
    const backButton: ViewValue | null = backId
      ? {
          name: BACK_BUTTON,
          args: [{ label: 'title', value: { kind: 'string', value: titles[depth - 1] || 'Back' } }],
          children: [],
          modifiers: visualModifiers(stack),
          action: null,
          span: stack.span,
          path: `${stackId}/back`,
          intent: back,
        }
      : null

    const bar: NavigationBar = {
      title,
      large,
      canGoBack: depth > 0,
      backTitle: titles[Math.max(0, depth - 1)] || 'Back',
      ...(backId ? { back: backId } : {}),
      leading: backButton ? [backButton] : toolbar.leading,
      trailing: toolbar.trailing,
      principal: toolbar.principal,
      subtitle: subtitle || undefined,
      confirm: toolbar.confirm,
      view: {
        name: NAV_BAR,
        args: [{ label: 'title', value: { kind: 'string', value: title } }],
        children: [...(backButton ? [backButton] : toolbar.leading), ...toolbar.principal, ...toolbar.trailing],
        modifiers: visualModifiers(stack),
        action: null,
        span: stack.span,
        path: `${stackId}/bar`,
      },
    }

    // A bar with nothing in it is not drawn. A toolbar counts as something in it, or
    // a screen whose only chrome is a trailing button would lose that button.
    const hasChrome =
      title.length > 0 || depth > 0 || toolbar.leading.length > 0 || toolbar.trailing.length > 0 || toolbar.principal.length > 0
    const bottomBar: BottomBar | null = toolbar.bottom.length && !(toolbars.hidden & HIDES.bottomBar) ? {
      items: toolbar.bottom,
      status: toolbar.status,
      view: { name: BOTTOM_BAR, args: [], children: toolbar.bottom, modifiers: visualModifiers(stack), action: null, span: stack.span, path: `${stackId}/bottom` },
    } : null

    return { content: screen, navigationBar: hasChrome && !(toolbars.hidden & HIDES.navigationBar) ? bar : null, bottomBar, hidden: toolbars.hidden }
  }

  /**
   * The destination a link leads to.
   *
   * Two shapes, both common: an eagerly built `destination:` view, and the
   * value-plus-`navigationDestination(for:)` pair introduced in iOS 16. The second is
   * resolved by finding the matching destination builder on the current screen and
   * running it with the link's value - which is also why destination content is not
   * built until a push actually happens.
   */
  private destinationFor(link: ViewValue, screen: readonly ViewValue[]): readonly ViewValue[] | null {
    const direct = link.args.filter((a) => a.label === 'destination')
    if (direct.length > 0) {
      const views = direct.map((a) => asView(a.value)).filter((v): v is ViewValue => v !== null)
      if (views.length > 0) return views
    }

    const value = labelled(link.args, 'value')
    if (!value) return null

    const builder = this.destinationBuilder(link, screen)
    if (!builder?.closure) return null
    return this.ctx.build(builder.closure, [value], builder.environment, 'Destination')
  }

  private destinationBuilder(link: ViewValue, screen: readonly ViewValue[]): ModifierValue | null {
    const value = labelled(link.args, 'value')
    return value ? builderFor(value, screen) : null
  }

  /**
   * A screen's toolbar items, by where each is drawn. iOS merges every `.toolbar` written on the
   * screen (Wave 4b), so each is built in turn, its items numbered on from the one before's. A
   * place with no items allocates nothing, as most screens have no principal or bottom bar.
   */
  private resolveToolbar(owners: readonly ToolbarOwner[], stackId: string): Toolbar {
    if (!owners.length) return NO_TOOLBAR
    let leading: ViewValue[] | undefined, trailing: ViewValue[] | undefined, principal: ViewValue[] | undefined, bottom: ViewValue[] | undefined
    /** `.secondaryAction` items, unstamped, which go in the trailing ellipsis menu (Wave 6c). */
    let secondary: ViewValue[] | undefined
    /** Where in `bottom` each `.status` item is, and in `trailing` each `.confirmationAction` one (Wave 6c). */
    let status: Set<number> | undefined, confirm: Set<number> | undefined
    let index = 0, menuSpan: SourceSpan | undefined
    for (const { view, modifier } of owners) {
      const style = visualModifiers(view)
      for (const item of toolbarItemsIn(this.ctx.build(modifier.closure!, [], modifier.environment, 'Toolbar'))) {
        const at = index++
        // `ToolbarItem(placement:)` wraps its content; a bare view is a trailing item.
        const placement = tokenName(labelled(item.args, 'placement'))
        // The keyboard's bar is up only while a field is being typed in, which a preview never is.
        if (placement === 'keyboard') continue
        const contents = item.name === 'ToolbarItem' || item.name === 'ToolbarItemGroup' ? item.children : [item]
        if (placement === 'secondaryAction') {
          menuSpan ??= item.span
          for (const content of contents) (secondary ??= []).push(inheritVisualStyle(content, style))
          continue
        }
        const bucket = placement === 'principal' ? principal ??= [] : placement === 'bottomBar' || placement === 'status' ? bottom ??= []
          : placement && LEADING_PLACEMENTS.has(placement) ? leading ??= [] : trailing ??= []
        const marks = placement === 'status' ? status ??= new Set() : placement === 'confirmationAction' ? confirm ??= new Set() : undefined
        contents.forEach((content, inner) => {
          // A helper whose `if` drew nothing is an empty group, and no item (Wave 5a).
          if (content.name === 'Group' && !content.children.length) return
          marks?.add(bucket.length)
          bucket.push(this.stamp(inheritVisualStyle(content, style), `${stackId}/tb-${at}-${inner}`))
        })
      }
    }
    // iOS 27 folds `.secondaryAction` items into an ellipsis menu after the trailing items (Wave 6c).
    if (secondary) (trailing ??= []).push(this.stamp(moreMenu(secondary, menuSpan!), `${stackId}/tb-more`))
    const linked = (views: ViewValue[] | undefined) => views ? this.attachPushIntents(views, stackId) : NO_VIEWS
    /** The views at `marks`, once their push intents are attached. */
    const marked = (views: readonly ViewValue[], marks: Set<number> | undefined) => marks && new Set(views.filter((_, i) => marks.has(i)))
    const shownTrailing = linked(trailing), shownBottom = linked(bottom)
    return {
      leading: linked(leading),
      trailing: shownTrailing,
      principal: linked(principal),
      bottom: shownBottom,
      status: marked(shownBottom, status),
      confirm: marked(shownTrailing, confirm),
    }
  }

  /** Every item a screen's toolbar holds, for finding a link pushed from it. */
  private toolbarItems(screen: readonly ViewValue[], stackId: string): readonly ViewValue[] {
    const toolbar = this.resolveToolbar(toolbarsOf(screen).owners, stackId)
    return toolbarViews(toolbar, toolbar.bottom)
  }

  // ----------------------------------------------------------------- tabs

  /**
   * A TabView's pages, the one shown, and what choosing each does: write its tag to the
   * `selection:` binding, or else note it in the framework's own state for `tabId`. `force`
   * shows another, for a page of the gallery, without touching either.
   */
  private tabPages(tabs: ViewValue, tabId: string, force?: number): { pages: readonly ViewValue[]; selected: number; intents: readonly ViewIntent[] } {
    const selection = labelled(tabs.args, 'selection')
    const binding = asProjection(selection)

    // On a phone a `TabSection`'s tabs are tabs like any other; its title heads them only in a sidebar.
    const flatten = (views: readonly ViewValue[]): readonly ViewValue[] => views.flatMap(v => ['Group', 'ForEach', 'TabSection'].includes(v.name) ? flatten(v.children) : [v])
    const pages = flatten(tabs.children)
    const valueOf = (page: ViewValue) => page.name === 'Tab' ? labelled(page.args, 'value') : rowTag(page, binding)
    const tagged = pages.map((page) => tokenOrValue(valueOf(page)))
    const current = binding ? identityKey(binding.get(), true) : null
    const index = force ?? (current !== null ? Math.max(0, tagged.indexOf(current)) : this.ctx.state.selectedTab(tabId))
    const intents = pages.map((page, i): ViewIntent => binding && tagged[i] !== null
      ? { kind: 'write', binding: selection!, value: valueOf(page)! }
      : { kind: 'selectTab', tab: tabId, index: i })
    return { pages, selected: Math.max(0, Math.min(index, pages.length - 1)), intents }
  }

  /**
   * A page-style TabView inside a screen, drawn in place as a carousel (Wave 4c): only the
   * page shown is built and stamped, as iOS draws no other, at the path it has among the
   * TabView's children, and each dot shows its page. On the Design canvas a selection in
   * another page shows that one instead, as a selection in a swipe action opens its row.
   */
  private pager(view: ViewValue, path: string): { children: ViewValue[]; dots: PageDots } {
    const { pages, selected: current, intents } = this.tabPages(view, path)
    let selected = current
    if (this.ctx.reveal !== undefined) {
      for (const page of pages) this.revealable.set(page.span, { span: page.span })
      const revealed = pages.findIndex(page => reveals(this.ctx.reveal, page))
      if (revealed >= 0 && revealed !== current && !this.revealedPage) {
        selected = revealed
        this.revealedPage = true
      }
    }
    const shown = pages[selected]
    return {
      children: shown ? [this.stamp(shown, `${path}-${selected}`)] : [],
      dots: {
        dots: showsDots(view, pages.length) ? pages.map((_, i) => ({ path: this.registered(`${path}/tab-${i}`, intents[i]!), selected: i === selected })) : [],
        background: dotsBackground(view),
      },
    }
  }

  private resolveTabs(tabs: ViewValue): { content: readonly ViewValue[]; tabBar: TabBar | null; pages: readonly ViewValue[]; selected: number } {
    const tabId = tabs.path ?? 'tabs'
    const { pages, selected, intents } = this.tabPages(tabs, tabId, this.forceTab)
    if (pages.length === 0) return { content: [], tabBar: null, pages, selected: 0 }

    // `.tabViewStyle(.page)` replaces the tab bar with page dots: a row of indicators
    // rather than labelled buttons, and one that is still pressable - iOS pages by
    // swiping, which a preview has no analogue for, so the dots are the way through.
    const paged = pageStyled(tabs)

    const items = pages.map((page, i) => {
      const item = collectModifier([page], 'tabItem')
      const badge = page.modifiers.find(m => m.name === 'badge')?.args[0]?.value
      const modernLabel = page.args.filter(a => a.label === 'label').map(a => asView(a.value)).filter((v): v is ViewValue => !!v)
      const label: readonly ViewValue[] = paged ? [] : page.name === 'Tab'
        ? modernLabel.length ? modernLabel : [{ name: 'Label', args: tabLabelArgs(page), children: [], modifiers: [], action: null, span: page.span }]
        : item?.closure ? this.ctx.build(item.closure, [], item.environment, 'Tab item') : []
      const path = `${tabId}/tab-${i}`
      const intent = intents[i]!

      this.register(path, intent)

      return {
        name: TAB_ITEM,
        args: [
          { label: 'selected', value: { kind: 'bool', value: i === selected } },
          { label: 'index', value: { kind: 'int', value: i } },
          ...(badge ? [{ label: 'badge', value: badge }] : []),
          ...(paged ? [{ label: 'paged', value: { kind: 'bool' as const, value: true } }] : []),
        ],
        children: this.stampList(label, path, visualModifiers(page)),
        modifiers: visualModifiers(page),
        action: null,
        span: page.span,
        path,
        intent,
      } satisfies ViewValue
    })

    const written = paged ? null : modifierOn(tabs, 'tabViewBottomAccessory')
    // `isEnabled: false` hides it, as Apple documents (Wave 6c).
    const enabled = written && labelled(written.args, 'isEnabled')
    const accessory = written?.closure && !(enabled?.kind === 'bool' && !enabled.value) ? this.stampList(this.ctx.build(written.closure, [], written.environment, 'Bottom accessory'), `${tabId}/accessory`, visualModifiers(tabs)) : NO_VIEWS
    return {
      pages, selected,
      content: [pages[selected]!],
      tabBar: {
        items,
        accessory: accessory.length ? accessory : undefined,
        view: {
          name: TAB_BAR,
          // A root pager's dots, hidden as `.page(indexDisplayMode:)` says (Wave 4c).
          args: paged && !showsDots(tabs, pages.length) ? [{ label: 'hidden', value: { kind: 'bool', value: true } }] : [],
          children: items,
          modifiers: visualModifiers(tabs),
          action: null,
          span: tabs.span,
          path: `${tabId}/bar`,
        },
      },
    }
  }

  /**
   * The `.searchable` field, if the screen has one.
   *
   * Registered as a control writing its binding, exactly like a `TextField` - because
   * that is all `.searchable` is. Placement is resolved later from device context.
   */
  private findSearchField(views: readonly ViewValue[], around: readonly ViewValue[] = []): SearchField | null {
    for (const { view, modifier } of modifiersFor(views, around)) {
      if (modifier.name !== 'searchable') continue

      const binding = labelled(modifier.args, 'text') ?? modifier.args[0]?.value
      const projection = asProjection(binding)
      if (!binding || !projection) continue

      const path = `${view.path ?? 'v'}/search`
      this.register(path, { kind: 'write', binding, value: projection.get() })

      const current = projection.get()
      return {
        text: current.kind === 'string' ? current.value : '',
        prompt: stringArg(labelled(modifier.args, 'prompt')) ?? 'Search',
        placement: tokenName(labelled(modifier.args, 'placement')) ?? 'automatic',
        path,
      }
    }
    return null
  }

  // ------------------------------------------------------------- overlays

  /**
   * The topmost active presentation, if any.
   *
   * Content is built here rather than during evaluation, which is not an
   * optimisation: `.sheet(isPresented: $showing) { Detail(item: selected!) }` would
   * trap on the force-unwrap every render if the closure ran while the sheet was
   * down. SwiftUI is lazy for the same reason.
   */
  private findOverlay(views: readonly ViewValue[], depth = 0, around: readonly ViewValue[] = []): Overlay | null {
    if (depth >= 4) return null
    for (const { view, modifier } of modifiersFor(views, around)) {
      const kind = OVERLAY_KINDS[modifier.name]
      if (!kind) continue

      const presented = labelled(modifier.args, 'isPresented')
      const item = labelled(modifier.args, 'item')

      // Read *through* the binding. `isPresented:` is always a projection, and an
      // opaque value is truthy by default - so testing it directly would present
      // every sheet in the file, permanently.
      const presentedValue = presented ? (asProjection(presented)?.get() ?? presented) : undefined
      const itemValue = item ? (asProjection(item)?.get() ?? item) : undefined

      // An alert's `presenting:` data is what it shows, and one with none is not up.
      const data = labelled(modifier.args, 'presenting')
      const forced = this.forced && sameSpan(modifier.span, this.forced.span)
      const shown = forced && this.forced!.value ? this.forced!.value : [itemValue, data].find(value => value !== undefined && value.kind !== 'nil')
      if (this.forced && !forced) continue
      if (!forced && !(presentedValue ? truthy(presentedValue) && (!data || shown) : shown)) continue

      const binding = asProjection(presented) ? presented! : item && asProjection(item) ? item : null
      const dismiss: ViewIntent | null = binding
        ? presented && asProjection(presented)
          ? { kind: 'write', binding, value: { kind: 'bool', value: false } }
          : { kind: 'write', binding, value: { kind: 'nil' } }
        : null

      const path = `${view.path ?? 'v'}/${modifier.name}`
      const built = forced && this.forced!.views ? this.forced!.views
        : modifier.closure
        ? this.ctx.build(
            modifier.closure,
            shown ? [shown] : [],
            modifier.environment,
            PRESENTATION_NAMES[kind],
          )
        : []

      // `Alert(title:message:dismissButton:)`, as alerts were written before iOS 15: its words
      // and buttons are what it is given.
      const legacy = kind === 'alert' && built.length === 1 && built[0]!.name === 'Alert' ? built[0]! : null
      const overlayViews = this.stampList(legacy ? alertButtons(legacy) : built, path, visualModifiers(view))
      // Native alerts supply an OK action when their builder supplies no buttons.
      // Without this, disabling backdrop dismissal would leave an empty alert stuck.
      if (kind === 'alert' && dismiss && !findView(overlayViews, 'Button')) {
        const buttonPath = `${path}/default-action`
        this.register(buttonPath, dismiss)
        overlayViews.push({ name: 'Button', args: [{ label: null, value: { kind: 'string', value: 'OK' } }],
          children: [], modifiers: visualModifiers(view), action: null, span: view.span, path: buttonPath, intent: dismiss })
      }
      // Alert/dialog actions dismiss their presentation even when their closure is empty.
      if ((kind === 'alert' || kind === 'dialog') && dismiss) {
        const attachDismiss = (view: ViewValue) => {
          if (view.name === 'Button' && view.path) {
            const id = handlerIdFor(view.path), intent = this.handlers.get(id)
            if (intent?.kind === 'run') this.handlers.set(id, { ...intent, dismiss })
          }
          view.children.forEach(attachDismiss)
        }
        overlayViews.forEach(attachDismiss)
      }
      const disableModifier = collectModifier(overlayViews, 'interactiveDismissDisabled')
      const disabled = disableModifier ? disableModifier.args[0] ? truthy(disableModifier.args[0].value) : true : false
      const dismissId = dismiss && kind !== 'alert' && !disabled ? this.register(`${path}/dismiss`, dismiss) : null
      const tabs = findTabs(overlayViews)
      const tabbed = tabs ? this.resolveTabs(tabs) : { content: overlayViews, tabBar: null }
      const nav = findView(tabbed.content, 'NavigationStack') ?? findView(tabbed.content, 'NavigationView')
      const resolved = nav ? this.resolveNavigation(nav) : { content: tabbed.content, navigationBar: null, bottomBar: null, hidden: 0 }
      const around = containersAbove(overlayViews, tabs, tabbed.content, nav)
      this.notDrawn.push(
        ...(tabs ? notDrawnAround(overlayViews, tabs) : []),
        ...(nav ? notDrawnAround(tabbed.content, nav) : []),
      )
      const searchAround = searchContainers(tabbed.content, nav, resolved.navigationBar)
      const cornerRadius = numberOf(collectModifier(overlayViews, 'presentationCornerRadius')?.args[0]?.value)

      return {
        kind,
        views: overlayViews,
        ...detentsOf(overlayViews),
        ...(cornerRadius !== null ? { cornerRadius: Math.max(0, cornerRadius) } : {}),
        showsDragIndicator: dragIndicatorOf(overlayViews),
        background: collectModifier(overlayViews, 'presentationBackground')?.args[0]?.value,
        backgroundInteraction: backgroundInteractionOf(overlayViews),
        ...(kind === 'dialog' && view.intent && view.path ? { anchorId: handlerIdFor(view.path) } : {}),
        ...(kind === 'popover' && view.path && compactPopover(overlayViews) ? { compact: { source: view.path } } : {}),
        screen: {
          content: resolved.content, navigationBar: resolved.navigationBar, bottomBar: resolved.bottomBar,
          overlay: this.findOverlay(resolved.content, depth + 1, around) ?? this.menuOverlay(resolved.content, this.ctx.state.openMenu()),
          tabBar: tabbed.tabBar, search: this.findSearchField(resolved.content, searchAround),
        },
        ...(legacy ? this.alertWords(legacy, path) : this.wordsOf(kind, modifier, shown, path)),
        dismiss,
        dismissId,
      }
    }
    return null
  }

  /**
   * An alert's explanatory line.
   *
   * `.alert(title:isPresented:actions:message:)` spells the message as a second
   * trailing closure, so it arrives as a labelled closure argument rather than as a
   * string - and reading only the string form dropped it entirely.
   */
  private messageOf(modifier: ModifierValue, shown: SwiftValue | undefined, path: string): Pick<Overlay, 'message' | 'messageViews'> {
    const direct = stringArg(labelled(modifier.args, 'message'))
    if (direct !== null) return { message: direct }

    const closure = modifier.args.find((a) => a.label === 'message')?.value
    if (closure?.kind !== 'closure') return { message: '' }

    const views = this.stampList(this.ctx.build(closure, shown ? [shown] : [], modifier.environment), `${path}/message`)
    return { message: views.flatMap((v) => textOf(v)).join(' '), messageViews: views }
  }

  /** An `Alert(...)`'s title and message, each a `Text`, and the layers they are drawn as. */
  private alertWords(alert: ViewValue, path: string): Pick<Overlay, 'title' | 'titleLayer' | 'message' | 'messageViews'> {
    const title = labelled(alert.args, 'title'), message = labelled(alert.args, 'message')
    const titleView = title && asView(title) && this.stamp(asView(title)!, `${path}/title`)
    const messageViews = message && asView(message) ? [this.stamp(asView(message)!, `${path}/message`)] : []
    const words = { title: titleView ? textOf(titleView).join(' ') : '', message: messageViews.flatMap(textOf).join(' '), messageViews }
    return titleView ? { ...words, titleLayer: viewLayers([titleView])[0] } : words
  }

  /**
   * A presentation's title and message, and the layers they are drawn as. A dialog shows its
   * title only when `titleVisibility` says so, and a title is words, or a `Text` of them.
   */
  private wordsOf(kind: OverlayKind, modifier: ModifierValue, shown: SwiftValue | undefined, path: string): Pick<Overlay, 'title' | 'titleLayer' | 'message' | 'messageViews'> {
    const written = modifier.args.find((a) => a.label === null)?.value
    const view = written && asView(written)
    const title = kind === 'dialog' && tokenName(labelled(modifier.args, 'titleVisibility')) !== 'visible' ? '' : wordsIn(written)
    const layer = !title ? undefined : view ? viewLayers([this.stamp(view, `${path}/title`)])[0]
      : modifier.titleSpan && { id: `${path}/title`, name: title, type: 'Text', source: modifier.titleSpan, children: [] }
    return { title, ...(layer ? { titleLayer: layer } : {}), ...this.messageOf(modifier, shown, path) }
  }
}

/**
 * The buttons an `Alert(...)` is given, `.default(Text("OK"))`, `.destructive(Text("Delete"),
 * action:)` and `.cancel()`, as the Buttons an alert draws, with their roles.
 */
function alertButtons(alert: ViewValue): ViewValue[] {
  return ['primaryButton', 'secondaryButton', 'dismissButton'].flatMap((label) => {
    const button = payloadOf<{ name: string; args?: readonly SwiftValue[] }>(labelled(alert.args, label), 'Token')
    if (!button) return []
    const title = button.args?.find((arg) => asView(arg)), action = button.args?.find((arg) => arg.kind === 'closure')
    const words = (title && wordsIn(title)) || (button.name === 'cancel' ? 'Cancel' : 'OK')
    const role: ViewArg[] = button.name === 'default' ? [] : [{ label: 'role', value: opaque('Token', { name: button.name }) }]
    return [{ name: 'Button', args: [{ label: null, value: str(words) }, ...role], children: [], modifiers: [], action: action?.kind === 'closure' ? action : null, span: alert.span }]
  })
}

/** Every string a view draws, for the one-line summary an alert message needs. */
function textOf(view: ViewValue): string[] {
  const own = view.args
    .map((a) => (a.value.kind === 'string' ? a.value.value : null))
    .filter((s): s is string => s !== null)
  return [...own, ...view.children.flatMap(textOf)]
}

// -------------------------------------------------------------------- helpers

/** Controls whose behaviour is entirely "write what happened to this binding". */
const CONTROL_BINDINGS: Readonly<Record<string, { argument: string }>> = {
  Toggle: { argument: 'isOn' },
  TextField: { argument: 'text' },
  TextEditor: { argument: 'text' },
  SecureField: { argument: 'text' },
  Slider: { argument: 'value' },
  Picker: { argument: 'selection' },
}

const OVERLAY_KINDS: Readonly<Record<string, OverlayKind>> = {
  sheet: 'sheet',
  inspector: 'sheet',
  fullScreenCover: 'cover',
  alert: 'alert',
  confirmationDialog: 'dialog',
  popover: 'popover',
}

const LEADING_PLACEMENTS: ReadonlySet<string> = new Set([
  'navigationBarLeading', 'topBarLeading', 'cancellationAction', 'leading', 'navigation',
])

/**
 * Whether a popover stays one on a phone: `.presentationCompactAdaptation(.popover)`, or `.none`,
 * which doesn't adapt, either for both size classes or `horizontal:`, a portrait phone's compact
 * one (Wave 6c). Any other is the sheet a phone adapts a popover to.
 */
function compactPopover(views: readonly ViewValue[]): boolean {
  const written = collectModifier(views, 'presentationCompactAdaptation')
  const adaptation = written && tokenName(written.args[0]?.label === null ? written.args[0].value : labelled(written.args, 'horizontal'))
  return adaptation === 'popover' || adaptation === 'none'
}

/**
 * The menu iOS 27 draws for a toolbar's `.secondaryAction` items: an ellipsis button named
 * More after the trailing items, sharing their capsule, which opens on them (Wave 6c,
 * iphone18pro-chrome placements).
 */
function moreMenu(items: readonly ViewValue[], span: SourceSpan): ViewValue {
  const label: ViewValue = { name: 'Label', args: [{ label: null, value: { kind: 'string', value: 'More' } }, { label: 'systemImage', value: { kind: 'string', value: 'ellipsis' } }], children: [], modifiers: [], action: null, span }
  return { name: 'Menu', args: [{ label: 'label', value: asSwiftValue(label) }], children: items, modifiers: [], action: null, span }
}

/**
 * Presentation detents, as a fraction of screen height.
 *
 * Read from the sheet's *content*, which is where SwiftUI puts it:
 *
 * ```swift
 * .sheet(isPresented: $show) {
 *     ComposeView().presentationDetents([.medium])
 * }
 * ```
 *
 * This used to look at the modifiers of the view carrying `.sheet`, where nobody
 * writes it and nothing was ever found, so every sheet in every project fell to the
 * `.large` default and a `.medium` one was impossible to see.
 *
 * `collectModifier` searches the whole presented subtree rather than only its root,
 * because a detent is a preference in SwiftUI and propagates up from wherever inside
 * the sheet it was written.
 */
function dragIndicatorOf(presented: readonly ViewValue[]): boolean {
  const visibility = tokenName(collectModifier(presented, 'presentationDragIndicator')?.args[0]?.value)
  if (visibility === 'visible') return true
  if (visibility === 'hidden') return false
  const detents = collectModifier(presented, 'presentationDetents')?.args[0]?.value
  return detents?.kind === 'array' && detents.elements.length > 1
}

function decodeDetent(v: SwiftValue | undefined): number {
  const name = tokenName(v)
  if (name === 'medium') return 0.5
  if (name === 'large') return 1
  if (name?.startsWith('detent:fraction:')) return clamp(Number(name.split(':')[2]), 0.01, 1)
  if (name?.startsWith('detent:height:')) return -Math.max(1, Number(name.split(':')[2]) || 1)
  return 1
}

function backgroundInteractionOf(views: readonly ViewValue[]): number | undefined {
  const value = collectModifier(views, 'presentationBackgroundInteraction')?.args[0]?.value
  const option = payloadOf<{ name: string; args?: readonly SwiftValue[] }>(value, 'Token')
  return option?.name === 'enabled' ? option.args?.length ? decodeDetent(option.args[0]) : Infinity : undefined
}

function detentsOf(presented: readonly ViewValue[]): Pick<Overlay, 'detent' | 'detents'> {
  const detents = collectModifier(presented, 'presentationDetents')
  const value = detents?.args[0]?.value
  const selected = asProjection(detents?.args.find(a => a.label === 'selection')?.value)?.get()
  if (selected) return { detent: decodeDetent(selected) }
  if (value?.kind === 'array' && value.elements.length) {
    // Compare mixed point/fraction detents only once the actual viewport is known.
    return { detent: 1, detents: value.elements.map(decodeDetent) }
  }
  return { detent: 1 }
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : max
}

/**
 * A row's id as a path segment.
 *
 * Paths end up in DOM ids and test selectors, so a segment keeps to letters, digits
 * and `_`. Every other character is written out rather than dropped, or "C", "C++"
 * and "C#" would be one row and the last registered would take every tap: `_` is
 * doubled, and anything else becomes its code in hex between two, so no two ids share
 * a segment; the empty id is a lone `_`. A string id's quotes and a place's `#` are
 * left off, as before, so an id of letters and digits keeps the path it always had.
 */
function keySegment(key: string | undefined, index: number): string {
  if (!key) return String(index)
  if (key.startsWith('#')) return key.slice(1)
  const bare = /^".*"$/s.test(key) ? key.slice(1, -1) : key
  if (/^[A-Za-z0-9]+$/.test(bare)) return bare
  // The empty string is an id too, and a lone `_` is what no other id writes.
  if (bare === '') return '_'
  return [...bare].map((c) => (/[A-Za-z0-9]/.test(c) ? c : c === '_' ? '__' : `_${c.codePointAt(0)!.toString(16)}_`)).join('')
}

function labelled(args: readonly ViewArg[], label: string): SwiftValue | undefined {
  return args.find((a) => a.label === label)?.value
}

function stringArg(value: SwiftValue | undefined): string | null {
  return value?.kind === 'string' ? value.value : null
}

function numberOf(value: SwiftValue | undefined): number | null {
  return value?.kind === 'int' || value?.kind === 'double' ? value.value : null
}

function tokenName(value: SwiftValue | undefined): string | null {
  return payloadOf<{ name: string }>(value, 'Token')?.name ?? null
}

/**
 * A `.tag(…)` value as a comparable string.
 *
 * Tokens are unwrapped to their name first: `.tag(Tab.home)` and a selection holding
 * that same case must compare equal, and `describe` renders every opaque value as its
 * type name - so without this, every tag in a `TabView` would look identical.
 */
function tokenOrValue(value: SwiftValue | undefined): string | null {
  if (value === undefined) return null
  return tokenName(value) ?? identityKey(value, true)
}

/** A modifier written on this view itself, rather than anywhere in its subtree. */
function modifierOn(view: ViewValue, name: string): ModifierValue | null {
  return view.modifiers.find((m) => m.name === name) ?? null
}

/**
 * The tag a row answers a selection with, by SwiftUI's rule as measured in the iOS 27
 * simulator (docs/parity/native/iphone18pro-misrenders-ii): a row carries the `.tag`
 * written on it and the one its `ForEach` gave it, its id, and a selection takes the
 * one of its own type. `ForEach`'s tag is never Optional, so it never answers an
 * Optional selection; a written `.tag` does, unless it says `includeOptional: false`.
 */
function rowTag(row: ViewValue, binding: ProjectionPayload | null): SwiftValue | undefined {
  const optional = binding?.declared?.optional === true
  const written = collectModifier([row], 'tag')
  const tag = written?.args[0]?.value
  const include = written ? labelled(written.args, 'includeOptional') : undefined
  if (tag !== undefined && tagFits(tag, binding) && !(optional && include !== undefined && !truthy(include))) return tag
  if (row.implicitTag !== undefined && !optional && tagFits(row.implicitTag, binding)) return row.implicitTag
  return undefined
}

/**
 * Whether a tag has the selection's type: the type of its value, or, while it is nil,
 * the type it was declared with. A leading-dot name carries no type to compare.
 */
function tagFits(tag: SwiftValue, binding: ProjectionPayload | null): boolean {
  const selected = binding?.get()
  if (tokenName(tag) !== null || (selected !== undefined && tokenName(selected) !== null)) return true
  if (selected !== undefined && selected.kind !== 'nil') return typeNameOf(tag) === typeNameOf(selected)
  const declared = binding?.declared?.name
  return declared === undefined || typeNameOf(tag) === (DECLARED_AS_RUNTIME[declared] ?? declared)
}

/** Declared names the preview holds as another type: a `CGFloat` is a `Double` here. */
const DECLARED_AS_RUNTIME: Readonly<Record<string, string>> = { CGFloat: 'Double', Float: 'Double' }

/** What a `ForEach` gives each of its rows to swipe: its `.onDelete`, at the row's place, and its `.swipeActions`. */
interface RowActions {
  readonly onDelete: ActionValue | null
  readonly offset: number
  readonly swipes: readonly ModifierValue[]
}

/** The Delete `.onDelete` makes, as iOS 27 draws it: `Button("Delete", systemImage: "trash", role: .destructive)`. */
const DELETE_ACTION: readonly ViewArg[] = [
  { label: null, value: str('Delete') },
  { label: 'systemImage', value: str('trash') },
  { label: 'role', value: opaque(TOKEN_TYPE, { name: 'destructive' }) },
]

/** A `ForEach`'s rows are siblings of whatever surrounds it, never a nested container. */
function flattenForEach(views: readonly ViewValue[]): ViewValue[] {
  return views.flatMap((v) => (v.name === 'ForEach' ? flattenForEach(v.children) : [v]))
}

/**
 * What a `Tab(…)`'s item is labelled with: its title and symbol, or for `Tab(role: .search)`
 * written without them, iOS 27's own, Search with a magnifying glass, as an ordinary item at
 * the bar's end (Wave 6c, iphone18pro-chrome).
 */
function tabLabelArgs(page: ViewValue): readonly ViewArg[] {
  const args = page.args.filter(a => a.label === null || a.label === 'systemImage')
  if (args.length || tokenName(labelled(page.args, 'role')) !== 'search') return args
  return [{ label: null, value: { kind: 'string', value: 'Search' } }, { label: 'systemImage', value: { kind: 'string', value: 'magnifyingglass' } }]
}

/** The app's tabs: the first TabView that isn't drawn in place as a pager (Wave 4c). */
function findTabs(views: readonly ViewValue[]): ViewValue | null {
  for (const view of views) {
    if (view.name === 'TabView' && !view.pager) return view
    const nested = findTabs(view.children)
    if (nested) return nested
  }
  return null
}

/**
 * The TabView a screen is, its app's tabs in any style (Wave 4c), as the authoring model's
 * `rootTabView` reads it: at the top of what the window shows, or in a Group there, written
 * there or as the body of up to three of the project's own views called there. One a helper
 * draws, or one deeper, is drawn in place, as a carousel.
 */
function rootTabView(views: readonly ViewValue[]): ViewValue | undefined {
  for (const view of views) {
    if (view.name === 'TabView' && rootOwners(view)) return view
    const inner = view.name === 'Group' ? rootTabView(view.children) : undefined
    if (inner) return inner
  }
  return undefined
}

/** Whether what draws a view at a screen's root is only the project's views, `ROOT_VIEWS` at most, and no helper. */
function rootOwners(view: ViewValue): boolean {
  const owners = view.componentSources ?? []
  return owners.length <= ROOT_VIEWS && !owners.some(owner => owner.helper)
}

/** How many of the project's views called one in another the authoring model follows to a screen's root TabView. */
const ROOT_VIEWS = 3

/**
 * Whether a TabView is written in the page style, `.tabViewStyle(.page)`, `.page(indexDisplayMode:)`
 * or the older `PageTabViewStyle(…)`, from the style's token, as swift-sema's `isPageStyle` reads
 * it from the argument as written (Wave 4c).
 */
function pageStyled(view: ViewValue): boolean {
  return tokenName(modifierOn(view, 'tabViewStyle')?.args[0]?.value) === 'page'
}

/**
 * Whether a page-style TabView shows its dots: always, never, or, as `.automatic` does, for
 * more than one page, as measured in the iOS 27 simulator (Wave 4c).
 */
function showsDots(view: ViewValue, count: number): boolean {
  const mode = tokenName(payloadOf<TokenPayload>(modifierOn(view, 'tabViewStyle')?.args[0]?.value, TOKEN_TYPE)?.args?.[0])
  return mode === 'always' || mode !== 'never' && count > 1
}

/** Whether `.indexViewStyle(.page(backgroundDisplayMode: .always))`, on a pager or above it, puts its dots on a background. */
export function dotsBackground(view: ViewValue): boolean {
  return tokenName(payloadOf<TokenPayload>(modifierOn(view, 'indexViewStyle')?.args[0]?.value, TOKEN_TYPE)?.args?.[0]) === 'always'
}

/** Depth-first search for the first view with a given name. */
function findView(views: readonly ViewValue[], name: string): ViewValue | null {
  for (const view of views) {
    if (view.name === name) return view
    const nested = findView(view.children, name)
    if (nested) return nested
  }
  return null
}

/**
 * The `navigationDestination(for:)` for a value's type among a screen's views. A link takes
 * the one builder there is whatever its type; a path's value takes only its own type's.
 */
function builderFor(value: SwiftValue, screen: readonly ViewValue[], exact = false): ModifierValue | null {
  const typeName = value.kind === 'struct' || value.kind === 'enum' ? value.typeName : ({ int: 'Int', double: 'Double', string: 'String', bool: 'Bool' } as Record<string, string>)[value.kind]
  const builders = [...allModifiers(screen)].map(item => item.modifier).filter(modifier => modifier.name === 'navigationDestination' && modifier.closure && labelled(modifier.args, 'for'))
  return builders.find(builder => {
    const type = labelled(builder.args, 'for')
    return type?.kind === 'type' && type.name === typeName
  }) ?? (builders.length === 1 && !exact ? builders[0]! : null)
}

/**
 * The destination a binding on this screen pushes now: `navigationDestination(isPresented:)`
 * while it is true, or `(item:)` while it holds a value, given to its closure. Back sets it
 * false, or nil, as SwiftUI does.
 */
function boundDestination(screen: readonly ViewValue[]): { modifier: ModifierValue; args: SwiftValue[]; back: ViewIntent } | null {
  // A plain walk that stops at the first: every stack asks this on every pass.
  for (const view of screen) {
    for (const modifier of view.modifiers) {
      if (modifier.name !== 'navigationDestination' || !modifier.closure) continue
      const presented = labelled(modifier.args, 'isPresented'), binding = presented ?? labelled(modifier.args, 'item')
      const value = asProjection(binding)?.get()
      if (!binding || !value || (presented ? !truthy(value) : value.kind === 'nil')) continue
      return { modifier, args: presented ? [] : [value], back: { kind: 'write', binding, value: presented ? { kind: 'bool', value: false } : { kind: 'nil' } } }
    }
    const below = view.children.length ? boundDestination(view.children) : null
    if (below) return below
  }
  return null
}

/** A path's list holding `elements`, of the type it held: `.detail` appended to it later is still a case of it. */
function withElements(list: ArrayValue, elements: SwiftValue[]): ArrayValue {
  const next: ArrayValue = { kind: 'array', elements }
  if (list.element) next.element = list.element
  return next
}

/** Why a value on a stack's path shows nothing: no destination for its type is written in the stack. */
function unshown(value: SwiftValue, span: SourceSpan): Diagnostic {
  const type = typeNameOf(value)
  return { span, severity: 'warning', code: 'type_mismatch', message: `This NavigationStack shows nothing for the ${type} on its path: no navigationDestination(for: ${type}.self) is written inside it.` }
}

const sameSpan = (a: SourceSpan, b: SourceSpan) => a.file === b.file && a.start === b.start && a.end === b.end

function findByPath(views: readonly ViewValue[], path: string): ViewValue | null {
  for (const view of views) {
    if (view.path === path) return view
    const nested = findByPath(view.children, path)
    if (nested) return nested
  }
  return null
}

/**
 * The first occurrence of a modifier anywhere in a subtree.
 *
 * `.navigationTitle` is written on the content *inside* a `NavigationStack`, not on
 * the stack, so the bar has to go looking for it. Same for `.toolbar` and
 * `.searchable`. Taking the first in tree order matches SwiftUI's behaviour of the
 * innermost-applied title winning for the screen it is on.
 */
function collectModifier(views: readonly ViewValue[], name: string): ModifierValue | null {
  for (const { modifier } of allModifiers(views)) {
    if (modifier.name === name) return modifier
  }
  return null
}

/**
 * The containers a screen was cut out of: the views from the root down to its
 * `TabView`, and from the tab page down to its `NavigationStack`, both inclusive.
 *
 * The screen is the stack's content, but a sheet or an alert written on the stack -
 * or on the TabView, or on the view around either - belongs to it too. That is where
 * a toolbar's "Add" button's sheet is most often written, and where every tab of a
 * tab app puts its own. Only their own modifiers count: their other content is what
 * the screen already is, or isn't drawn at all.
 */
function containersAbove(
  root: readonly ViewValue[],
  tabs: ViewValue | null,
  page: readonly ViewValue[],
  nav: ViewValue | null,
): ViewValue[] {
  return [...(tabs ? pathTo(root, tabs) : []), ...(nav ? pathTo(page, nav) : [])]
}

/**
 * The layers of the views around a screen's container, without it: its ancestors, holding
 * what is beside it, and nothing at all where nothing is (Wave 6c).
 */
function besideLayers(layers: readonly ViewLayer[], container: string): ViewLayer[] {
  return layers.flatMap(layer => {
    if (layer.id === container) return []
    const children = besideLayers(layer.children, container)
    return children.length === layer.children.length && children.every((child, i) => child === layer.children[i]) ? [layer] : [{ ...layer, children }]
  })
}

/** Modifiers that draw, and are left out when they are written on a screen's container. */
const DRAWN_ON_CONTAINER: ReadonlySet<string> = new Set(['overlay', 'safeAreaInset'])

/**
 * Everything on the way down to `container` that the screen leaves out: the views
 * beside each step, and the drawing modifiers written on the steps themselves. The
 * container's own content is the screen, so only what surrounds it is lost.
 */
function notDrawnAround(views: readonly ViewValue[], container: ViewValue): NotDrawn[] {
  const path = pathTo(views, container)
  const beside = path.flatMap((step, i) =>
    (i === 0 ? views : path[i - 1]!.children).filter((view) => view !== step))
  return [
    ...beside.map((view) => ({ span: view.span, container: container.name })),
    ...path.flatMap((step) => step.modifiers.flatMap((modifier, i) => {
      if (!DRAWN_ON_CONTAINER.has(modifier.name)) return []
      // A modifier's span runs from the start of the whole chain, so its own text is
      // what follows the step before it: the view's call, or the previous modifier.
      const start = (i === 0 ? step.span : step.modifiers[i - 1]!.span).end
      return [{ span: { ...modifier.span, start }, container: container.name, modifier: modifier.name }]
    })),
  ]
}

/**
 * The containers whose `.searchable` searches this screen: the stack's, and only on
 * its root screen. In iOS 27 a pushed screen has no search field, and a TabView's
 * `.searchable` draws none without a search tab (both checked in the simulator).
 */
function searchContainers(page: readonly ViewValue[], nav: ViewValue | null, bar: NavigationBar | null): ViewValue[] {
  return nav && !bar?.canGoBack ? pathTo(page, nav) : []
}

/** The views from a list down to `target`, both inclusive, or none when it isn't there. */
function pathTo(views: readonly ViewValue[], target: ViewValue): ViewValue[] {
  for (const view of views) {
    if (view === target) return [view]
    const below = pathTo(view.children, target)
    if (below.length) return [view, ...below]
  }
  return []
}

/**
 * Every modifier in a screen's views, and the modifiers written on the containers it was
 * cut out of (see `containersAbove`) - on the containers themselves, not inside them.
 */
function modifiersFor(views: readonly ViewValue[], around: readonly ViewValue[]): { view: ViewValue; modifier: ModifierValue }[] {
  return [...allModifiers(views), ...around.flatMap((view) => view.modifiers.map((modifier) => ({ view, modifier })))]
}

/**
 * A toolbar's items, with a `Group`'s taken out of it: what a `@ToolbarContentBuilder` property
 * or function of several items gives, and `Group { … }` among the items (Wave 4b).
 */
function toolbarItemsIn(views: readonly ViewValue[]): readonly ViewValue[] {
  return views.some(view => view.name === 'Group') ? views.flatMap(view => view.name === 'Group' ? toolbarItemsIn(view.children) : [view]) : views
}

/** A `.toolbar { … }` with items, and the view it is written on (Wave 4b). */
interface ToolbarOwner {
  readonly view: ViewValue
  readonly modifier: ModifierValue
}

/** What a screen's `.toolbar` modifiers say: the toolbars with items, and the bars hidden as `HIDES` bits (Wave 4b). */
interface Toolbars {
  readonly owners: ToolbarOwner[]
  hidden: number
}

/** A screen's with none, shared. Never written to: `toolbarsOf` makes its own before it adds anything. */
const NO_TOOLBARS: Toolbars = { owners: [], hidden: 0 }

/**
 * Every `.toolbar` on a screen, in one walk (Wave 4b). iOS merges every toolbar with items, a
 * view's own after those of the views inside it, as its modifiers wrap them; and
 * `.toolbar(.hidden, for:)` anywhere on the screen hides that bar. A screen with none is
 * `NO_TOOLBARS`, so most allocate nothing here.
 */
function toolbarsOf(views: readonly ViewValue[], found: Toolbars = NO_TOOLBARS): Toolbars {
  for (const view of views) {
    found = toolbarsOf(view.children, found)
    for (const modifier of view.modifiers) {
      if (modifier.name !== 'toolbar') continue
      if (found === NO_TOOLBARS) found = { owners: [], hidden: 0 }
      if (modifier.closure) found.owners.push({ view, modifier })
      else found.hidden |= hiddenBars(modifier)
    }
  }
  return found
}

/** The bars hidden by `.toolbar(.hidden, for:)` among a view's own modifiers, as `HIDES` bits (Wave 4b). */
function hiddenBy(modifiers: readonly ModifierValue[]): number {
  let hidden = 0
  for (const modifier of modifiers) if (modifier.name === 'toolbar' && !modifier.closure) hidden |= hiddenBars(modifier)
  return hidden
}

/** One bit for each bar the preview hides (`HIDDEN_BARS`), in that list's order (Wave 4b). */
const HIDES = { navigationBar: 1 << HIDDEN_BARS.indexOf('navigationBar'), bottomBar: 1 << HIDDEN_BARS.indexOf('bottomBar'), tabBar: 1 << HIDDEN_BARS.indexOf('tabBar') }

/**
 * The bars one `.toolbar(.hidden, for: …)` hides, as `HIDES` bits, as SwiftUI reads it. Written
 * with no bar, it is the navigation bar. A bar the preview doesn't hide, the checker warns of
 * (Wave 4b).
 */
function hiddenBars(modifier: ModifierValue): number {
  if (tokenName(modifier.args[0]?.value) !== 'hidden') return 0
  if (modifier.args.length === 1) return HIDES.navigationBar
  let hidden = 0
  for (let i = 1; i < modifier.args.length; i++) {
    const bar = HIDDEN_BARS.indexOf(tokenName(modifier.args[i]!.value) ?? '')
    if (bar >= 0) hidden |= 1 << bar
  }
  return hidden
}

function* allModifiers(
  views: readonly ViewValue[],
): Generator<{ view: ViewValue; modifier: ModifierValue }> {
  for (const view of views) {
    for (const modifier of view.modifiers) yield { view, modifier }
    yield* allModifiers(view.children)
  }
}

/** A screen's own title, used as the back button's label on the screen above it. */
function titleOf(views: readonly ViewValue[], fallback: string): string {
  const title = collectModifier(views, 'navigationTitle')
  return stringArg(title?.args[0]?.value) ?? fallback
}

function labelTextOf(view: ViewValue): string {
  const first = view.args.find((a) => a.label === null)?.value
  if (first?.kind === 'string') return first.value
  for (const child of view.children) {
    const text = labelTextOf(child)
    if (text) return text
  }
  return ''
}

/**
 * What an item-driven presentation or destination is drawn with: its item, or while that is
 * nil, a record of its type the screen holds (`firstHeld`). Inventing one could draw an
 * impossible screen, or force-unwrap data that isn't there, so with neither it says why not.
 */
function given(args: readonly ViewArg[], closure: ClosureValue): { value?: SwiftValue; why?: string } {
  const item = labelled(args, 'item')
  const selected = item && (asProjection(item)?.get() ?? item)
  const type = item && asProjection(item)?.declared?.name
  const value = selected?.kind === 'nil' && type ? firstHeld(type, closure) : selected?.kind === 'nil' ? undefined : selected
  return !item || value ? { value } : { why: type ? needs(type) : 'it needs an item to show, and none is selected now' }
}

/** Why a screen that shows a value of `type` isn't drawn when nothing holds one. */
const needs = (type: string) => `it needs ${/^(?:[AEIO]|U(?!ni|s|RL|UID))/.test(type) ? 'an' : 'a'} ${type} to show, and the view holds no [${type}] to take one from`

/** Why a path's destination for `type` isn't drawn while the path is empty and nothing else holds one. */
const startsEmpty = (type: string) => `the path starts empty, and the view holds no other [${type}] to take one from`

const isEmptyList = (value: SwiftValue | undefined) => value?.kind === 'array' && !value.elements.length

/**
 * A value of `type` to draw a screen that shows one with, while none is chosen: the first of
 * a list of them that the view holds, or a model the view holds does, as a `value:` link's
 * destination is drawn with the row it is in.
 */
function firstHeld(type: string, closure: ClosureValue): SwiftValue | undefined {
  const view = closure.env instanceof Environment ? closure.env.resolveSelf() : null
  if (view?.kind !== 'struct') return undefined
  const read = (value: SwiftValue) => asProjection(value)?.get() ?? value
  const models = [...view.fields.values()].map(read).filter(value => value.kind === 'struct' && value.reference)
  for (const holder of [view, ...models] as StructValue[]) {
    for (const value of holder.fields.values()) {
      const list = read(value)
      const first = list.kind === 'array' ? list.elements[0] : undefined
      if (first && typeNameOf(first) === type) return first
    }
  }
  return undefined
}

/** Modifiers that give a view what it reads from its environment, and change nothing it draws. */
const ENVIRONMENT_MODIFIERS: ReadonlySet<string> = new Set(['environment', 'environmentObject', 'modelContainer'])

/**
 * The one view of the program a builder shows: `BookDetail` in `{ book in BookDetail(book: book) }`,
 * and `Greeting` in `NavigationStack { Greeting(name: "A").padding() }`, past its modifiers and any
 * container holding nothing else. `asIs` when it is that view as the app draws it: called with no
 * arguments, and given only what it reads from its environment, `ContentView().environment(store)`.
 * None where the builder shows more than one view, or none of the program's. A sheet's page and a
 * `#Preview`'s are named by it.
 */
export function shownView(statements: readonly Stmt[], isView: (name: string) => boolean): { readonly name: string; readonly asIs: boolean } | undefined {
  const [only, more] = statements.filter(statement => statement.kind !== 'declStmt')
  let expr = more ? undefined : only?.kind === 'exprStmt' ? only.expression : only?.kind === 'returnStmt' ? only.value ?? undefined : undefined
  let asIs = true
  while (expr?.kind === 'call' && expr.callee.kind === 'memberAccess' && expr.callee.base) {
    asIs &&= ENVIRONMENT_MODIFIERS.has(expr.callee.member)
    expr = expr.callee.base
  }
  if (expr?.kind !== 'call' || expr.callee.kind !== 'identifier') return undefined
  if (isView(expr.callee.name)) return { name: expr.callee.name, asIs: asIs && !expr.args.length && !expr.trailingClosure }
  const inner = expr.trailingClosure && shownView(expr.trailingClosure.body.statements, isView)
  return inner ? { name: inner.name, asIs: false } : undefined
}

/** The program's view a page's content is, `DetailView`, when it is one view, and one of the program's. */
const componentOf = (views: readonly ViewValue[]) => views.length === 1 ? views[0]!.componentSources?.[0]?.name : undefined

/** The words a title is written as: a string, or a `Text` of one. */
function wordsIn(written: SwiftValue | undefined): string {
  const view = written && asView(written)
  return stringArg(written) ?? (view ? textOf(view).join(' ') : '')
}

export function animationOf(value: SwiftValue | undefined): AnimationPayload | null {
  return payloadOf<AnimationPayload>(value, ANIMATION_TYPE)
}
