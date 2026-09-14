import {
  asProjection,
  describe,
  truthy,
  type ClosureValue,
  type SwiftValue,
} from '@studio/swift-runtime'
import {
  asView,
  handlerIdFor,
  payloadOf,
  ANIMATION_TYPE,
  type AnimationPayload,
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
 * the user never wrote it — SwiftUI supplies that behaviour, so something has to.
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

export type OverlayKind = 'sheet' | 'cover' | 'alert' | 'dialog' | 'popover'

export interface Overlay {
  readonly kind: OverlayKind
  readonly views: readonly ViewValue[]
  /** Fraction of the screen height a sheet occupies. */
  readonly detent: number
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
  /** The view's path — how "has this appeared before?" is answered. */
  readonly path: string
  readonly closure: ClosureValue
  /** For `.onChange(of:)`: the value being watched, compared against last pass. */
  readonly watched?: SwiftValue
}

export interface ResolvedUI {
  readonly content: readonly ViewValue[]
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
   * A pushed screen can disappear from under you — the row it came from was deleted,
   * or a filter changed. Truncating is the honest response; keeping a dangling entry
   * would leave the back button one tap short of working forever.
   */
  truncate(id: string, depth: number): void {
    const current = this.stack(id)
    if (current.length > depth) this.navigation.set(id, current.slice(0, depth))
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
  }
}

export interface ResolveContext {
  readonly state: UIState
  /** Runs a view-builder closure, returning the views it produced. */
  build(closure: ClosureValue, args?: readonly SwiftValue[]): readonly ViewValue[]
  readonly animation: AnimationPayload | null
}

export function resolveUI(views: readonly ViewValue[], ctx: ResolveContext): ResolvedUI {
  return new Resolver(ctx).run(views)
}

class Resolver {
  private readonly handlers = new Map<string, ViewIntent>()
  private readonly lifecycle: LifecycleHook[] = []

  constructor(private readonly ctx: ResolveContext) {}

  run(views: readonly ViewValue[]): ResolvedUI {
    const stamped = this.stampList(views, 'v')

    const tabs = findView(stamped, 'TabView')
    const withTabs = tabs ? this.resolveTabs(tabs) : { content: stamped, tabBar: null }

    const nav = findView(withTabs.content, 'NavigationStack') ?? findView(withTabs.content, 'NavigationView')
    const screen = nav ? this.resolveNavigation(nav) : { content: withTabs.content, navigationBar: null }

    const overlay = this.findOverlay(screen.content)

    return {
      content: screen.content,
      navigationBar: screen.navigationBar,
      tabBar: withTabs.tabBar,
      overlay,
      handlers: this.handlers,
      animation: this.ctx.animation,
      lifecycle: this.lifecycle,
    }
  }

  // ------------------------------------------------------------- identity

  /**
   * Stamps every view in a list with its path, and registers its handler.
   *
   * The single traversal that assigns identity. `childKeys` from a `ForEach` are
   * used in preference to the ordinal, so a row keeps its path — and therefore its
   * `@State` and its DOM node — when the collection is reordered.
   */
  private stampList(views: readonly ViewValue[], prefix: string): ViewValue[] {
    return views.map((view, index) => this.stamp(view, `${prefix}-${index}`))
  }

  private stamp(view: ViewValue, path: string): ViewValue {
    const children = view.childKeys
      ? view.children.map((child, i) => this.stamp(child, `${path}-${keySegment(view.childKeys![i], i)}`))
      : this.stampList(view.children, path)

    const intent = this.intentFor(view)
    const stamped: ViewValue = { ...view, path, children, ...(intent ? { intent } : {}) }

    if (intent) this.handlers.set(handlerIdFor(path), intent)
    this.collectLifecycle(view, path)
    return stamped
  }

  /** Records `.onAppear`, `.onDisappear`, `.task` and `.onChange` for this view. */
  private collectLifecycle(view: ViewValue, path: string): void {
    for (const modifier of view.modifiers) {
      if (!modifier.closure) continue

      if (modifier.name === 'onAppear' || modifier.name === 'task') {
        this.lifecycle.push({ kind: 'appear', path, closure: modifier.closure })
        continue
      }
      if (modifier.name === 'onDisappear') {
        this.lifecycle.push({ kind: 'disappear', path, closure: modifier.closure })
        continue
      }
      if (modifier.name === 'onChange') {
        const watched = modifier.args.find((a) => a.label === 'of')?.value ?? modifier.args[0]?.value
        this.lifecycle.push({
          kind: 'change',
          path: `${path}/${modifier.name}`,
          closure: modifier.closure,
          ...(watched !== undefined ? { watched } : {}),
        })
      }
    }
  }

  /**
   * What this view does when tapped.
   *
   * A `Button`'s own closure, a gesture modifier's closure, or — for controls the
   * user wrote no closure for — a framework behaviour derived from the binding it
   * was given. All three arrive at the same place so that the layout pass has exactly
   * one question to ask about interactivity.
   */
  private intentFor(view: ViewValue): ViewIntent | null {
    if (view.intent) return view.intent
    if (view.action) return { kind: 'run', closure: view.action }

    // Controls the user gave a binding need no closure of their own: writing the
    // binding *is* the behaviour, and it is the framework's job to do it. The value
    // written comes from the event — the text typed, the slider's new position — so
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
    if (tap?.closure) return { kind: 'run', closure: tap.closure }

    return null
  }

  /**
   * Gives every `NavigationLink` on a screen the intent to push its own destination.
   *
   * A second pass rather than part of stamping, because a link's behaviour depends on
   * which stack encloses it — and the stack's identity is itself a stamped path. A
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

  // ----------------------------------------------------------- navigation

  /**
   * Resolves a navigation stack to the screen currently on top.
   *
   * The whole tree is evaluated every pass, including the screens underneath — which
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
    const pushed = this.ctx.state.stack(stackId)

    let screen: readonly ViewValue[] = stack.children
    const titles: string[] = [titleOf(stack.children, 'Home')]
    let depth = 0

    for (const linkPath of pushed) {
      const link = findByPath(screen, linkPath)
      const destination = link ? this.destinationFor(link, screen) : null
      if (!destination || destination.length === 0) break

      screen = this.stampList(destination, `n${depth + 1}`)
      titles.push(titleOf(screen, labelTextOf(link!) || 'Back'))
      depth++
    }

    // Anything we could not resolve is dropped, so the back button stays truthful.
    this.ctx.state.truncate(stackId, depth)
    screen = this.attachPushIntents(screen, stackId)

    const explicitTitle = collectModifier(screen, 'navigationTitle')
    const title =
      stringArg(explicitTitle?.args[0]?.value) ?? (depth === 0 ? titles[0]! : titles[depth]!)
    const displayMode = tokenName(collectModifier(screen, 'navigationBarTitleDisplayMode')?.args[0]?.value)

    const backId = depth > 0 ? this.register(`${stackId}/back`, { kind: 'pop' }) : null
    const toolbar = this.resolveToolbar(screen, stackId)

    const backButton: ViewValue | null = backId
      ? {
          name: BACK_BUTTON,
          args: [{ label: 'title', value: { kind: 'string', value: titles[depth - 1] ?? 'Back' } }],
          children: [],
          modifiers: [],
          action: null,
          span: stack.span,
          path: `${stackId}/back`,
          intent: { kind: 'pop' },
        }
      : null

    const bar: NavigationBar = {
      title,
      large: displayMode !== 'inline' && depth === 0 && title.length > 0,
      canGoBack: depth > 0,
      backTitle: titles[Math.max(0, depth - 1)] ?? 'Back',
      leading: backButton ? [backButton] : toolbar.leading,
      trailing: toolbar.trailing,
      view: {
        name: NAV_BAR,
        args: [{ label: 'title', value: { kind: 'string', value: title } }],
        children: [...(backButton ? [backButton] : toolbar.leading), ...toolbar.trailing],
        modifiers: [],
        action: null,
        span: stack.span,
        path: `${stackId}/bar`,
      },
    }

    return { content: screen, navigationBar: title.length > 0 || depth > 0 ? bar : null }
  }

  /**
   * The destination a link leads to.
   *
   * Two shapes, both common: an eagerly built `destination:` view, and the
   * value-plus-`navigationDestination(for:)` pair introduced in iOS 16. The second is
   * resolved by finding the matching destination builder on the current screen and
   * running it with the link's value — which is also why destination content is not
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

    const builder = collectModifier(screen, 'navigationDestination')
    if (!builder?.closure) return null
    return this.ctx.build(builder.closure, [value])
  }

  private resolveToolbar(
    screen: readonly ViewValue[],
    stackId: string,
  ): { leading: ViewValue[]; trailing: ViewValue[] } {
    const toolbar = collectModifier(screen, 'toolbar')
    if (!toolbar?.closure) return { leading: [], trailing: [] }

    const items = this.ctx.build(toolbar.closure)
    const leading: ViewValue[] = []
    const trailing: ViewValue[] = []

    items.forEach((item, index) => {
      // `ToolbarItem(placement:)` wraps its content; a bare view is a trailing item.
      const placement = tokenName(labelled(item.args, 'placement'))
      const contents = item.name === 'ToolbarItem' || item.name === 'ToolbarItemGroup'
        ? item.children
        : [item]

      const bucket = placement && LEADING_PLACEMENTS.has(placement) ? leading : trailing
      contents.forEach((content, inner) => {
        bucket.push(this.stamp(content, `${stackId}/tb-${index}-${inner}`))
      })
    })

    return { leading, trailing }
  }

  // ----------------------------------------------------------------- tabs

  private resolveTabs(tabs: ViewValue): { content: readonly ViewValue[]; tabBar: TabBar | null } {
    const tabId = tabs.path ?? 'tabs'
    const selection = labelled(tabs.args, 'selection')
    const binding = asProjection(selection)

    const pages = tabs.children
    if (pages.length === 0) return { content: [], tabBar: null }

    const tagged = pages.map((page) => tokenOrValue(collectModifier([page], 'tag')?.args[0]?.value))
    const current = binding ? describe(binding.get(), true) : null
    const index = current !== null ? Math.max(0, tagged.indexOf(current)) : this.ctx.state.selectedTab(tabId)
    const selected = Math.min(index, pages.length - 1)

    const items = pages.map((page, i) => {
      const item = collectModifier([page], 'tabItem')
      const label = item?.closure ? this.ctx.build(item.closure) : []
      const path = `${tabId}/tab-${i}`
      const intent: ViewIntent =
        binding && tagged[i] !== null
          ? { kind: 'write', binding: selection!, value: tagValue(page) }
          : { kind: 'selectTab', tab: tabId, index: i }

      this.register(path, intent)

      return {
        name: TAB_ITEM,
        args: [
          { label: 'selected', value: { kind: 'bool', value: i === selected } },
          { label: 'index', value: { kind: 'int', value: i } },
        ],
        children: label.map((l, j) => this.stamp(l, `${path}-${j}`)),
        modifiers: [],
        action: null,
        span: page.span,
        path,
        intent,
      } satisfies ViewValue
    })

    return {
      content: [pages[selected]!],
      tabBar: {
        items,
        view: {
          name: TAB_BAR,
          args: [],
          children: items,
          modifiers: [],
          action: null,
          span: tabs.span,
          path: `${tabId}/bar`,
        },
      },
    }
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
  private findOverlay(views: readonly ViewValue[]): Overlay | null {
    for (const { view, modifier } of allModifiers(views)) {
      const kind = OVERLAY_KINDS[modifier.name]
      if (!kind) continue

      const presented = labelled(modifier.args, 'isPresented')
      const item = labelled(modifier.args, 'item')

      // Read *through* the binding. `isPresented:` is always a projection, and an
      // opaque value is truthy by default — so testing it directly would present
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
          )
        : []

      const overlayViews = this.stampList(built, path)
      const dismissId = dismiss ? this.register(`${path}/dismiss`, dismiss) : null

      return {
        kind,
        views: overlayViews,
        detent: detentOf(view, modifier),
        title: stringArg(modifier.args.find((a) => a.label === null)?.value) ?? '',
        message: stringArg(labelled(modifier.args, 'message')) ?? '',
        dismiss,
        dismissId,
      }
    }
    return null
  }
}

// -------------------------------------------------------------------- helpers

/** Controls whose behaviour is entirely "write what happened to this binding". */
const CONTROL_BINDINGS: Readonly<Record<string, { argument: string }>> = {
  Toggle: { argument: 'isOn' },
  TextField: { argument: 'text' },
  SecureField: { argument: 'text' },
  Slider: { argument: 'value' },
  Picker: { argument: 'selection' },
}

const OVERLAY_KINDS: Readonly<Record<string, OverlayKind>> = {
  sheet: 'sheet',
  fullScreenCover: 'cover',
  alert: 'alert',
  confirmationDialog: 'dialog',
  popover: 'popover',
}

const LEADING_PLACEMENTS: ReadonlySet<string> = new Set([
  'navigationBarLeading', 'topBarLeading', 'cancellationAction', 'leading',
])

/** Presentation detents, as a fraction of screen height. */
function detentOf(view: ViewValue, modifier: ModifierValue): number {
  void modifier
  const detents = view.modifiers.find((m) => m.name === 'presentationDetents')
  const value = detents?.args[0]?.value
  if (value?.kind === 'array') {
    const first = value.elements[0]
    const name = tokenName(first)
    if (name === 'medium') return 0.5
    if (name === 'large') return 0.92
    if (name?.startsWith('detent:fraction:')) return clamp(Number(name.split(':')[2]), 0.2, 0.95)
    if (name?.startsWith('detent:height:')) return -Number(name.split(':')[2])
  }
  return 0.92
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

function tokenName(value: SwiftValue | undefined): string | null {
  return payloadOf<{ name: string }>(value, 'Token')?.name ?? null
}

/**
 * A `.tag(…)` value as a comparable string.
 *
 * Tokens are unwrapped to their name first: `.tag(Tab.home)` and a selection holding
 * that same case must compare equal, and `describe` renders every opaque value as its
 * type name — so without this, every tag in a `TabView` would look identical.
 */
function tokenOrValue(value: SwiftValue | undefined): string | null {
  if (value === undefined) return null
  return tokenName(value) ?? describe(value, true)
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
