import type { SourceSpan, ViewLayer } from '@studio/shared'
import { layerLabel, tabIcon, viewLayers } from './view-hierarchy'
import { inheritVisualStyle, visualModifiers } from './inherited-style'
import {
  asDate,
  asProjection,
  dateValue,
  double,
  describe,
  opaque,
  projection as makeProjection,
  str,
  truthy,
  type ClosureValue,
  type SwiftValue,
} from '@studio/swift-runtime'
import {
  asView,
  handlerIdFor,
  payloadOf,
  ANIMATION_TYPE,
  COLOR_TYPE,
  type ActionValue,
  type AnimationPayload,
  type ColorPayload,
  type EnvironmentFrame,
  type ModifierValue,
  type ViewArg,
  type ViewIntent,
  type ViewValue,
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
export const ALERT = '_Alert'
export const DIALOG = '_ConfirmationDialog'
export const MENU = '_Menu'
/** A `DatePicker`'s calendar, and one day of it. */
export const DATE_EDITOR = '_DateEditor'
export const DATE_CELL = '_DateCell'
/** A `ColorPicker`'s palette, and one colour of it. */
export const COLOUR_EDITOR = '_ColourEditor'
export const COLOUR_SWATCH = '_ColourSwatch'

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
  readonly leading: readonly ViewValue[]
  readonly trailing: readonly ViewValue[]
  readonly view: ViewValue
}

export interface TabBar {
  readonly items: readonly ViewValue[]
  readonly view: ViewValue
}

export type OverlayKind = 'sheet' | 'cover' | 'alert' | 'dialog' | 'popover' | 'menu'

export interface Overlay {
  readonly kind: OverlayKind
  readonly views: readonly ViewValue[]
  /** Fraction of the screen height a sheet occupies. */
  readonly detent: number
  readonly detents?: readonly number[]
  readonly anchorId?: string
  readonly cornerRadius?: number
  readonly background?: SwiftValue
  /** Omitted disables interaction; a number enables it through that encoded detent. */
  readonly backgroundInteraction?: number
  readonly showsDragIndicator?: boolean
  readonly screen?: Pick<ResolvedUI, 'content' | 'navigationBar' | 'tabBar' | 'search' | 'ignoresSafeArea' | 'overlay'>
  readonly title: string
  readonly message: string
  /** Tapping outside dismisses, unless the presentation is non-interactive. */
  readonly dismiss: ViewIntent | null
  /** The handler id the dim layer reports, so the layout does not have to derive it. */
  readonly dismissId: string | null
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
  /** The view's path - how "has this appeared before?" is answered. */
  readonly path: string
  readonly action: ActionValue
  /** For `.onChange(of:)`: the value being watched, compared against last pass. */
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
  /** True when the content asked to extend under the device's edges. */
  readonly ignoresSafeArea: boolean
  readonly navigationBar: NavigationBar | null
  readonly tabBar: TabBar | null
  readonly overlay: Overlay | null
  readonly handlers: ReadonlyMap<string, ViewIntent>
  /** Set when the last state change happened inside `withAnimation`. */
  readonly animation: AnimationPayload | null
  readonly lifecycle: readonly LifecycleHook[]
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

  /** How far a list row has been swiped open, in points. */
  private swipes = new Map<string, number>()

  swipeOffset(row: string): number {
    return this.swipes.get(row) ?? 0
  }

  setSwipeOffset(row: string, offset: number): void {
    if (offset <= 0) this.swipes.delete(row)
    else this.swipes.set(row, offset)
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
  readonly animation: AnimationPayload | null
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

export interface NestedPage {
  readonly id: string
  readonly parentId: string
  readonly rootId: string
  readonly kind: 'destination' | 'sheet' | 'cover' | 'popover'
  readonly name: string
  readonly source: SourceSpan
  readonly ui: ResolvedUI
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
  private previewScope: readonly ViewValue[] = []

  constructor(
    private readonly ctx: ResolveContext,
    private readonly forceTab?: number,
    private readonly prefix = 'v',
    private readonly basePage = false,
  ) {}

  run(views: readonly ViewValue[]): ResolvedUI {
    const stamped = this.stampList(views, this.prefix)

    const tabs = findView(stamped, 'TabView')
    const withTabs = tabs ? this.resolveTabs(tabs) : { content: stamped, tabBar: null, pages: [], selected: 0 }
    this.previewScope = withTabs.content

    const nav =
      findView(withTabs.content, 'NavigationStack') ??
      findView(withTabs.content, 'NavigationView') ??
      // A phone collapses a split view into a stack, so it is resolved as one.
      findView(withTabs.content, 'NavigationSplitView')
    const screen = nav ? this.resolveNavigation(nav) : { content: withTabs.content, navigationBar: null }

    // A menu sits above everything, including a sheet: it is the thing the user just
    // opened, and it is the only one they can interact with while it is up.
    const overlay = this.basePage ? null : this.findOverlay(screen.content) ?? this.menuOverlay(screen.content)

    const screenLayers = (content: readonly ViewValue[], bar: NavigationBar | null | undefined): ViewLayer[] => [
      ...viewLayers(content),
      ...(bar && (bar.leading.length || bar.trailing.length) ? [{
        id: `${bar.view.path}/layers`, name: 'Toolbar', type: 'Toolbar',
        children: viewLayers([...bar.leading, ...bar.trailing]),
      }] : []),
    ]
    const activeLayers = this.ctx.includeViewHierarchy === false ? [] : screenLayers(screen.content, screen.navigationBar)
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
      children: screenLayers(overlay.screen?.content ?? overlay.views, overlay.screen?.navigationBar),
    })

    return {
      viewHierarchy: pageLayers,
      content: screen.content,
      search: this.findSearchField(screen.content),
      ignoresSafeArea: collectModifier(screen.content, 'ignoresSafeArea') !== null,
      navigationBar: screen.navigationBar,
      tabBar: withTabs.tabBar,
      overlay,
      handlers: this.handlers,
      animation: this.ctx.animation,
      lifecycle: this.lifecycle,
    }
  }

  /** One example per destination declaration, with bounded recursive discovery. */
  nestedPages(views: readonly ViewValue[], rootId: string, limit: number): readonly NestedPage[] {
    const root = this.run(views)
    const out: NestedPage[] = []
    const seen = new Set<string>()
    const queue = [{ ui: root, scope: this.previewScope, parentId: rootId, depth: 0 }]
    let attempts = 0
    while (queue.length && out.length < limit && attempts < 64) {
      const current = queue.shift()!
      if (current.depth >= 3) continue
      const add = (kind: NestedPage['kind'], source: SourceSpan, build: () => readonly ViewValue[], fallback: string) => {
        const key = `${kind}:${encodeURIComponent(source.file)}:${source.start}:${source.end}`
        if (seen.has(key) || out.length >= limit || attempts++ >= 64) return
        try {
          const built = build()
          if (!built.length) return
          // Route order remains stable when text or modifier values change. Byte
          // offsets are only a within-pass dedup key, never a persistent page id.
          const ordinal = out.filter(page => page.kind === kind && page.source.file === source.file).length
          const id = `${rootId}/preview:${kind}:${encodeURIComponent(source.file)}:${ordinal}`
          const nestedResolver = new Resolver(this.ctx, undefined, `preview:${id}`, true)
          const hasNavigation = findView(built, 'NavigationStack') ?? findView(built, 'NavigationView')
          const content = kind === 'destination' && !hasNavigation ? [{
            name: 'NavigationStack', args: [], children: built, modifiers: visualModifiers(built[0]!), action: null, span: source,
          } satisfies ViewValue] : built
          let ui = nestedResolver.run(content)
          if (kind === 'destination') {
            const title = ui.navigationBar?.title || fallback
            const backTitle = current.ui.navigationBar?.title || 'Back'
            const path = `preview:${id}/back`
            const back: ViewValue = { name: BACK_BUTTON, args: [{ label: 'title', value: { kind: 'string', value: backTitle } }], children: [], modifiers: [], action: null, span: source, path }
            const bar = ui.navigationBar
            const tabBar = root.tabBar ? { items: root.tabBar.items.map((item, index) => nestedResolver.stamp(item, `preview:${id}/tab-${index}`)), view: nestedResolver.stamp(root.tabBar.view, `preview:${id}/tabs`) } : null
            ui = { ...ui, tabBar, navigationBar: {
              title, large: bar?.large ?? false, canGoBack: true, backTitle,
              leading: [back], trailing: bar?.trailing ?? [],
              view: bar ? { ...bar.view, children: [back, ...bar.trailing] } : { name: NAV_BAR, args: [{ label: 'title', value: { kind: 'string', value: title } }], children: [back], modifiers: [], action: null, span: source, path: `preview:${id}/bar` },
            } }
          }
          const name = ui.navigationBar?.title || titleOf(built, fallback)
          seen.add(key)
          out.push({ id, parentId: current.parentId, rootId, kind, name, source, ui })
          queue.push({ ui, scope: nestedResolver.previewScope, parentId: id, depth: current.depth + 1 })
        } catch { /* A destination lacking valid data does not blank other pages. */ }
      }
      const visitLinks = (content: readonly ViewValue[]) => {
        for (const view of content) {
          if (view.name === 'NavigationLink') {
            const builder = this.destinationBuilder(view, current.scope)
            add('destination', builder?.span ?? view.span, () => (this.destinationFor(view, current.scope) ?? []).map(content => inheritVisualStyle(content, visualModifiers(view))), labelTextOf(view) || 'Details')
          }
          visitLinks(view.children)
        }
      }
      const toolbar = [...(current.ui.navigationBar?.leading ?? []), ...(current.ui.navigationBar?.trailing ?? [])]
      visitLinks([...current.ui.content, ...toolbar])
      for (const { view, modifier } of allModifiers([...current.scope, ...toolbar])) {
        const kind = OVERLAY_KINDS[modifier.name]
        if (!modifier.closure || (kind !== 'sheet' && kind !== 'cover' && kind !== 'popover')) continue
        const item = labelled(modifier.args, 'item')
        const itemValue = item ? (asProjection(item)?.get() ?? item) : undefined
        // Item-driven presentations need an actual selected item; inventing one
        // can produce an impossible screen or force-unwrap unavailable data.
        if (item && (!itemValue || itemValue.kind === 'nil')) continue
        add(kind, modifier.span, () => this.ctx.build(modifier.closure!, itemValue ? [itemValue] : [], modifier.environment).map(content => inheritVisualStyle(content, visualModifiers(view))), kind === 'sheet' ? 'Sheet' : kind === 'cover' ? 'Full screen' : 'Popover')
      }
    }
    return out
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
    return views.map((view, index) => {
      let segment = String(index)
      if (view.modifiers.some(modifier => modifier.name === 'transition')) {
        // An evaluated conditional removes a slot from this list. Its following
        // sibling must not inherit the disappearing view's identity, or presence
        // reconciliation cannot retain the old view for its exit transition.
        const source = `${encodeURIComponent(view.span.file)}-${view.span.start}-${view.span.end}-${encodeURIComponent(view.name)}`
        const occurrence = transitionOccurrences.get(source) ?? 0
        transitionOccurrences.set(source, occurrence + 1)
        segment = `transition-${source}-${occurrence}`
      }
      return this.stamp(inheritVisualStyle(view, inherited), `${prefix}-${segment}`)
    })
  }

  private stamp(view: ViewValue, path: string): ViewValue {
    view = inheritVisualStyle(view, this.visualStyle)
    const outerStyle = this.visualStyle
    const outerContextMenu = this.contextMenuPath
    if (view.modifiers.some(m => m.name === 'contextMenu' && m.closure)) {
      this.contextMenuPath = path
      this.register(`${path}/context-menu`, { kind: 'openMenu', menu: `${path}/context-menu` })
    }
    this.visualStyle = visualModifiers(view)
    const onDelete = view.modifiers.find((m) => m.name === 'onDelete')?.action ?? null

    // A custom style written on this view is in scope for its whole subtree, and for
    // this view itself when it is the button.
    const style = this.buttonStyleValue(view)
    if (style) this.buttonStyles.push(style)

    try {
      const restyled = view.name === 'Button' ? this.applyButtonStyle(view, path) : view

      const children = restyled.childKeys
        ? restyled.children.map((child, i) =>
            this.stampRow(child, `${path}-${keySegment(restyled.childKeys![i], i)}`, onDelete, i),
          )
        : this.stampList(restyled.children, path)

      const intent = this.intentFor(restyled)
      // Layers are view subtrees too: register their controls and lifecycle hooks.
      const modifiers = restyled.modifiers.map((modifier, m) => {
        if (!['background', 'overlay', 'safeAreaInset'].includes(modifier.name)) return modifier
        return { ...modifier, args: modifier.args.map((arg, a) => {
          const layer = asView(arg.value)
          return layer && (arg.label === null || arg.label === 'content')
            ? { ...arg, value: opaque('View', this.stamp(layer, `${path}-layer-${m}-${a}`)) } : arg
        }) }
      })
      const stamped: ViewValue = { ...restyled, path, children, modifiers, contextMenuPath: this.contextMenuPath, ...(intent ? { intent } : {}) }

      if (intent) this.handlers.set(handlerIdFor(path), intent)
      this.collectLifecycle(restyled, path)
      return this.operable(this.gateAnimation(stamped, path), path)
    } finally {
      if (style) this.buttonStyles.pop()
      this.visualStyle = outerStyle
      this.contextMenuPath = outerContextMenu
    }
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
    for (const [index, modifier] of view.modifiers.entries()) {
      const action = modifier.action
      if (!action) continue

      if (modifier.name === 'onAppear' || modifier.name === 'task') {
        this.lifecycle.push({ kind: 'appear', path, action })
        continue
      }
      if (modifier.name === 'onDisappear') {
        this.lifecycle.push({ kind: 'disappear', path, action })
        continue
      }
      if (modifier.name === 'onChange') {
        const watched = modifier.args.find((a) => a.label === 'of')?.value ?? modifier.args[0]?.value
        this.lifecycle.push({
          kind: 'change',
          path: `${path}/${modifier.name}-${index}`,
          initial: truthy(labelled(modifier.args, 'initial') ?? { kind: 'bool', value: false }),
          action,
          ...(watched !== undefined ? { watched } : {}),
        })
      }
    }
  }

  /**
   * Stamps one row of a collection, wiring up its delete action if it has one.
   *
   * `.onDelete` is written on the `ForEach`, not on the row - but it is the *row*
   * that gets swiped, and the closure needs to know which offset was deleted. Both
   * facts are only available here, where the parent and the index are in hand.
   */
  private stampRow(
    view: ViewValue,
    path: string,
    onDelete: ActionValue | null,
    offset: number,
  ): ViewValue {
    const stamped = this.stamp(view, path)
    if (!onDelete) return stamped

    this.register(`${path}/swipe`, { kind: 'swipe', row: path })
    this.register(`${path}/delete`, { kind: 'delete', action: onDelete, offset, row: path })
    return { ...stamped, swipe: { offset: this.ctx.state.swipeOffset(path), path } }
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
  private attachPushIntents(views: readonly ViewValue[], stackId: string): ViewValue[] {
    return views.map((view) => {
      const children = this.attachPushIntents(view.children, stackId)

      if (view.name !== 'NavigationLink' || !view.path) {
        return children === view.children ? view : { ...view, children }
      }

      const intent: ViewIntent = { kind: 'push', link: `${stackId}|${view.path}` }
      this.handlers.set(handlerIdFor(view.path), intent)
      return { ...view, children, intent }
    })
  }

  private register(path: string, intent: ViewIntent): string {
    const id = handlerIdFor(path)
    this.handlers.set(id, intent)
    return id
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
    const index = view.modifiers.findIndex(
      (m) => m.name === 'animation' && m.args.some((a) => a.label === 'value'),
    )
    if (index < 0) return view

    const modifier = view.modifiers[index]!
    const gate = modifier.args.find((a) => a.label === 'value')!.value
    const open = this.ctx.state.animationGateOpen(`${path}m${index}`, describe(gate, true))

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
      return { ...view, intent }
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
        const current = binding ? describe(binding.get(), true) : null

        // `Picker { ForEach(options) { … } }` is how a picker over a collection is
        // written, and its options are a level down. Flattened once, here, so the
        // overlay and the segmented drawing both see options rather than a container -
        // otherwise each has to know, and one of them will not.
        const options = flattenForEach(view.children)

        const children = options.map((child, index) => {
          const tag = tokenOrValue(collectModifier([child], 'tag')?.args[0]?.value)
          if (tag !== null) {
            this.register(`${path}/seg-${index}`, {
              kind: 'choose',
              binding: selection,
              value: tagValue(child),
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
    const selection = labelled(control.args, 'selection')
    const binding = asProjection(selection)
    const seconds = asDate(binding?.get() ?? { kind: 'nil' })?.epochSeconds ?? Date.now() / 1000
    const chosen = new Date(seconds * 1000)
    const range = labelled(control.args, 'in')
    const lower = range?.kind === 'range' ? range.lower : -Infinity
    const upper = range?.kind === 'range' ? range.upper : Infinity
    const valid = (date: Date) => date.getTime() / 1000 >= lower && date.getTime() / 1000 <= upper
    const components = labelled(control.args, 'displayedComponents')
    const names = components ? (components.kind === 'array' ? components.elements : [components]).map(tokenName) : ['date', 'hourAndMinute']
    const dateVisible = names.includes('date'), timeVisible = names.includes('hourAndMinute')
    const views: ViewValue[] = []

    if (dateVisible) {
      // Calendar and time editor use the same local timezone as the collapsed label.
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
      views.push({ name: DATE_EDITOR, args: [{ label: 'title', value: str(MONTHS[month]! + ' ' + year) }], children: [step(-1, '‹'), step(1, '›'), ...cells], modifiers: [], action: null, span: control.span, path: `${open}/editor` })
    }
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
  private menuOverlay(views: readonly ViewValue[]): Overlay | null {
    const open = this.ctx.state.openMenu()
    if (!open) return null

    const isContextMenu = open.endsWith('/context-menu')
    const ownerPath = isContextMenu ? open.slice(0, -'/context-menu'.length) : open
    const control = findByPath(views, ownerPath)
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
    const current = binding ? describe(binding.get(), true) : null

    const contextMenu = control.modifiers.find(m => m.name === 'contextMenu')
    const items = isContextMenu && contextMenu?.closure
      ? this.ctx.build(contextMenu.closure, [], contextMenu.environment)
      : control.children
    const rows = items.map((child, index) => {
      const path = `${open}/opt-${index}`
      const tag = tokenOrValue(collectModifier([child], 'tag')?.args[0]?.value)

      // A Picker's row selects; a Menu's row is already a Button and keeps its own
      // action. Either way the menu closes, which the runtime does for any press
      // made while one is open.
      if (selection && tag !== null) {
        this.register(path, { kind: 'choose', binding: selection, value: tagValue(child) })
      }

      const stamped = this.stamp(child, path)
      return {
        ...stamped,
        args: [
          ...stamped.args,
          { label: 'selected', value: { kind: 'bool' as const, value: tag !== null && tag === current } },
        ],
        ...(selection && tag !== null
          ? { intent: { kind: 'choose' as const, binding: selection, value: tagValue(child) } }
          : {}),
      } satisfies ViewValue
    })

    return {
      kind: 'menu',
      anchorId: handlerIdFor(ownerPath),
      views: rows,
      detent: 0,
      title: stringArg(control.args.find((a) => a.label === null)?.value) ?? '',
      message: '',
      dismiss,
      dismissId,
    }
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
    let displayMode = tokenName(collectModifier(screen, 'navigationBarTitleDisplayMode')?.args[0]?.value)

    for (const linkPath of pushed) {
      const link = findByPath(screen, linkPath)
      const destination = link ? this.destinationFor(link, screen) : null
      if (!destination || destination.length === 0) break

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
      screen = this.stampList(destination.map(content), `n${depth + 1}`, visualModifiers(link ?? stack))
      const requestedMode = tokenName(collectModifier(screen, 'navigationBarTitleDisplayMode')?.args[0]?.value)
      if (requestedMode && requestedMode !== 'automatic') displayMode = requestedMode
      titles.push(titleOf(screen, labelTextOf(link!) || 'Back'))
      depth++
    }

    // Anything we could not resolve is dropped, so the back button stays truthful.
    this.ctx.state.truncate(stackId, depth)
    screen = this.attachPushIntents(screen, stackId)

    const explicitTitle = collectModifier(screen, 'navigationTitle')
    const title =
      stringArg(explicitTitle?.args[0]?.value) ?? (depth === 0 ? titles[0]! : titles[depth]!)

    const backId = depth > 0 ? this.register(`${stackId}/back`, { kind: 'pop' }) : null
    const toolbar = this.resolveToolbar(screen, stackId)

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
          intent: { kind: 'pop' },
        }
      : null

    const bar: NavigationBar = {
      title,
      large: displayMode !== 'inline' && title.length > 0,
      canGoBack: depth > 0,
      backTitle: titles[Math.max(0, depth - 1)] || 'Back',
      leading: backButton ? [backButton] : toolbar.leading,
      trailing: toolbar.trailing,
      view: {
        name: NAV_BAR,
        args: [{ label: 'title', value: { kind: 'string', value: title } }],
        children: [...(backButton ? [backButton] : toolbar.leading), ...toolbar.trailing],
        modifiers: visualModifiers(stack),
        action: null,
        span: stack.span,
        path: `${stackId}/bar`,
      },
    }

    // A bar with nothing in it is not drawn. A toolbar counts as something in it, or
    // a screen whose only chrome is a trailing button would lose that button.
    const hasChrome =
      title.length > 0 || depth > 0 || toolbar.leading.length > 0 || toolbar.trailing.length > 0

    return { content: screen, navigationBar: hasChrome ? bar : null }
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
    return this.ctx.build(builder.closure, [value], builder.environment)
  }

  private destinationBuilder(link: ViewValue, screen: readonly ViewValue[]): ModifierValue | null {
    const value = labelled(link.args, 'value')
    if (!value) return null
    const typeName = value.kind === 'struct' || value.kind === 'enum' ? value.typeName : ({ int: 'Int', double: 'Double', string: 'String', bool: 'Bool' } as Record<string, string>)[value.kind]
    const builders = [...allModifiers(screen)].map(item => item.modifier).filter(modifier => modifier.name === 'navigationDestination' && modifier.closure && labelled(modifier.args, 'for'))
    return builders.find(builder => {
      const type = labelled(builder.args, 'for')
      return type?.kind === 'type' && type.name === typeName
    }) ?? (builders.length === 1 ? builders[0]! : null)
  }

  private resolveToolbar(
    screen: readonly ViewValue[],
    stackId: string,
  ): { leading: ViewValue[]; trailing: ViewValue[] } {
    const owner = [...allModifiers(screen)].find(({ modifier }) => modifier.name === 'toolbar')
    const toolbar = owner?.modifier
    if (!toolbar?.closure) return { leading: [], trailing: [] }

    const items = this.ctx.build(toolbar.closure, [], toolbar.environment)
    const leading: ViewValue[] = []
    const trailing: ViewValue[] = []

    items.forEach((item, index) => {
      // `ToolbarItem(placement:)` wraps its content; a bare view is a trailing item.
      const placement = tokenName(labelled(item.args, 'placement'))
      // Unsupported placements must not appear as unrelated navigation actions.
      if (placement && ['keyboard', 'bottomBar', 'principal'].includes(placement)) return
      const contents = item.name === 'ToolbarItem' || item.name === 'ToolbarItemGroup'
        ? item.children
        : [item]

      const bucket = placement && LEADING_PLACEMENTS.has(placement) ? leading : trailing
      contents.forEach((content, inner) => {
        bucket.push(this.stamp(inheritVisualStyle(content, visualModifiers(owner!.view)), `${stackId}/tb-${index}-${inner}`))
      })
    })

    return { leading, trailing }
  }

  // ----------------------------------------------------------------- tabs

  private resolveTabs(tabs: ViewValue): { content: readonly ViewValue[]; tabBar: TabBar | null; pages: readonly ViewValue[]; selected: number } {
    const tabId = tabs.path ?? 'tabs'
    const selection = labelled(tabs.args, 'selection')
    const binding = asProjection(selection)

    const flatten = (views: readonly ViewValue[]): readonly ViewValue[] => views.flatMap(v => ['Group', 'ForEach'].includes(v.name) ? flatten(v.children) : [v])
    const pages = flatten(tabs.children)
    if (pages.length === 0) return { content: [], tabBar: null, pages, selected: 0 }

    const valueOf = (page: ViewValue) => page.name === 'Tab' ? labelled(page.args, 'value') : tagValue(page)
    const tagged = pages.map((page) => page.name === 'Tab' ? tokenOrValue(valueOf(page)) : tokenOrValue(collectModifier([page], 'tag')?.args[0]?.value))
    const current = binding ? describe(binding.get(), true) : null
    const index = this.forceTab ?? (current !== null ? Math.max(0, tagged.indexOf(current)) : this.ctx.state.selectedTab(tabId))
    const selected = Math.max(0, Math.min(index, pages.length - 1))

    // `.tabViewStyle(.page)` replaces the tab bar with page dots: a row of indicators
    // rather than labelled buttons, and one that is still pressable - iOS pages by
    // swiping, which a preview has no analogue for, so the dots are the way through.
    const paged = (tokenName(modifierOn(tabs, 'tabViewStyle')?.args[0]?.value) ?? '').startsWith('page')

    const items = pages.map((page, i) => {
      const item = collectModifier([page], 'tabItem')
      const badge = page.modifiers.find(m => m.name === 'badge')?.args[0]?.value
      const modernLabel = page.args.filter(a => a.label === 'label').map(a => asView(a.value)).filter((v): v is ViewValue => !!v)
      const label: readonly ViewValue[] = paged ? [] : page.name === 'Tab'
        ? modernLabel.length ? modernLabel : [{ name: 'Label', args: page.args.filter(a => a.label === null || a.label === 'systemImage'), children: [], modifiers: [], action: null, span: page.span }]
        : item?.closure ? this.ctx.build(item.closure, [], item.environment) : []
      const path = `${tabId}/tab-${i}`
      const intent: ViewIntent =
        binding && tagged[i] !== null
          ? { kind: 'write', binding: selection!, value: valueOf(page)! }
          : { kind: 'selectTab', tab: tabId, index: i }

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

    return {
      pages, selected,
      content: [pages[selected]!],
      tabBar: {
        items,
        view: {
          name: TAB_BAR,
          args: [],
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
  private findSearchField(views: readonly ViewValue[]): SearchField | null {
    for (const { view, modifier } of allModifiers(views)) {
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
  private findOverlay(views: readonly ViewValue[], depth = 0): Overlay | null {
    if (depth >= 4) return null
    for (const { view, modifier } of allModifiers(views)) {
      const kind = OVERLAY_KINDS[modifier.name]
      if (!kind) continue

      const presented = labelled(modifier.args, 'isPresented')
      const item = labelled(modifier.args, 'item')

      // Read *through* the binding. `isPresented:` is always a projection, and an
      // opaque value is truthy by default - so testing it directly would present
      // every sheet in the file, permanently.
      const presentedValue = presented ? (asProjection(presented)?.get() ?? presented) : undefined
      const itemValue = item ? (asProjection(item)?.get() ?? item) : undefined

      const active = presentedValue
        ? truthy(presentedValue)
        : itemValue !== undefined && itemValue.kind !== 'nil'
      if (!active) continue

      const binding = asProjection(presented) ? presented! : item && asProjection(item) ? item : null
      const dismiss: ViewIntent | null = binding
        ? presented && asProjection(presented)
          ? { kind: 'write', binding, value: { kind: 'bool', value: false } }
          : { kind: 'write', binding, value: { kind: 'nil' } }
        : null

      const path = `${view.path ?? 'v'}/${modifier.name}`
      const built = modifier.closure
        ? this.ctx.build(
            modifier.closure,
            itemValue && itemValue.kind !== 'nil' ? [itemValue] : [],
            modifier.environment,
          )
        : []

      const overlayViews = this.stampList(built, path, visualModifiers(view))
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
      const tabs = findView(overlayViews, 'TabView')
      const tabbed = tabs ? this.resolveTabs(tabs) : { content: overlayViews, tabBar: null }
      const nav = findView(tabbed.content, 'NavigationStack') ?? findView(tabbed.content, 'NavigationView')
      const resolved = nav ? this.resolveNavigation(nav) : { content: tabbed.content, navigationBar: null }
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
        screen: { ...resolved, overlay: this.findOverlay(resolved.content, depth + 1) ?? this.menuOverlay(resolved.content), tabBar: tabbed.tabBar, search: this.findSearchField(resolved.content), ignoresSafeArea: collectModifier(resolved.content, 'ignoresSafeArea') !== null },
        title: kind === 'dialog' && tokenName(labelled(modifier.args, 'titleVisibility')) !== 'visible' ? '' : stringArg(modifier.args.find((a) => a.label === null)?.value) ?? '',
        message: this.messageOf(modifier),
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
  private messageOf(modifier: ModifierValue): string {
    const direct = stringArg(labelled(modifier.args, 'message'))
    if (direct !== null) return direct

    const closure = modifier.args.find((a) => a.label === 'message')?.value
    if (closure?.kind !== 'closure') return ''

    return this.ctx
      .build(closure, [], modifier.environment)
      .flatMap((v) => textOf(v))
      .join(' ')
  }
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
  'navigationBarLeading', 'topBarLeading', 'cancellationAction', 'leading',
])

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

function keySegment(key: string | undefined, index: number): string {
  if (!key) return String(index)
  // Paths end up in DOM ids and test selectors, so keep them to safe characters.
  return key.replace(/[^A-Za-z0-9_]+/g, '') || String(index)
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
  return tokenName(value) ?? describe(value, true)
}

/** A modifier written on this view itself, rather than anywhere in its subtree. */
function modifierOn(view: ViewValue, name: string): ModifierValue | null {
  return view.modifiers.find((m) => m.name === name) ?? null
}

/** A `ForEach`'s rows are siblings of whatever surrounds it, never a nested container. */
function flattenForEach(views: readonly ViewValue[]): ViewValue[] {
  return views.flatMap((v) => (v.name === 'ForEach' ? flattenForEach(v.children) : [v]))
}

function tagValue(page: ViewValue): SwiftValue {
  return collectModifier([page], 'tag')?.args[0]?.value ?? { kind: 'nil' }
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

export function animationOf(value: SwiftValue | undefined): AnimationPayload | null {
  return payloadOf<AnimationPayload>(value, ANIMATION_TYPE)
}
