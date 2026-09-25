import { prependSearch } from './containers/screen'
import { buildList } from './containers/list'
import { SURFACES, listAppearance } from './appearance/surfaces'
import { controlMetrics, CONTROL_PARTS } from './appearance/controls'
import { controlFont, switchControl } from './controls/primitives'
import { inheritVisualStyle, visualModifiers } from './inherited-style'
import { appearanceFor, IOS_27 } from './appearance/ios27'
import {
  type PreviewTarget,
  type PreviewImageAsset,
  type DynamicTypeSize,
  isDynamicTypeSize,
  hasCornerRadii,
  MONO_FAMILY,
  rgba,
  ROUNDED_FAMILY,
  SERIF_FAMILY,
  UI_FONT_FAMILY,
  type Fill,
  type RGBA,
  type ShapeKind,
  type Size,
} from '@studio/shared'
import {
  asDate,
  asKeyPath,
  asProjection,
  foundationDescription,
  truthy,
  type ClosureValue,
  type SwiftValue,
} from '@studio/swift-runtime'
import { BLEND_MODES, UNIMPLEMENTED_VIEWS } from '@studio/swift-sema'
import {
  CENTER,
  insets,
  uniformInsets,
  ZERO_INSETS,
  type Alignment,
  type Axis,
  type EdgeInsets,
  type GridTrack,
  type HitRole,
  type HorizontalAlignment,
  type LayoutElement,
  type LayoutModifier,
  type SafeAreaEdges,
  type TextRunSpec,
  type VerticalAlignment,
} from '@studio/swiftui-layout'
import {
  ALERT,
  BACK_BUTTON,
  COLOUR_EDITOR,
  COLOUR_SWATCH,
  DATE_CELL,
  DATE_EDITOR,
  DIALOG,
  MENU,
  NAV_BAR,
  TAB_BAR,
  TAB_ITEM,
  type Overlay,
  type ResolvedUI,
  type SearchField,
} from './presentation'
import { largestCorner } from './corners'
import { applyTrim, asCanvasContext, asPath, toSVGPath } from './paths'
import { resolveSymbol } from './sf-symbols'
import {
  unitPoint,
  bodyFont,
  colorForName,
  fontForToken,
  monospacedFont,
  numberArg,
  resolveColorArg,
  resolveColorPayload,
  resolveFillArg,
  resolveFontArg,
  resolveWeightArg,
  stringArg,
  systemBackground,
  type ColorScheme,
} from './style'
import {
  ANIMATION_TYPE,
  COLOR_TYPE,
  EDGE_INSETS_TYPE,
  STROKE_STYLE_TYPE,
  TOKEN_TYPE,
  TRANSITION_TYPE,
  asView,
  handlerIdFor,
  payloadOf,
  stopped,
  type AnimationPayload,
  type ColorPayload,
  type EdgeInsetsPayload,
  type ModifierValue,
  type StrokeStylePayload,
  type TokenPayload,
  type TransitionPayload,
  type ViewArg,
  type ViewValue,
} from './view-value'

/**
 * Turns the evaluated view tree into layout elements.
 *
 * The two trees look similar but answer different questions. `ViewValue` records
 * *what the user wrote* - names, arguments, modifiers in source order.
 * `LayoutElement` records *how it sizes and paints*. Keeping them separate is what
 * lets the layout engine stay free of SwiftUI knowledge, and what makes modifier
 * nesting (rather than a flat list) expressible at all.
 */

export interface ConversionResult {
  readonly element: LayoutElement
  /** Handler id -> the view path it belongs to, for the inspector. */
  readonly hitTargets: ReadonlyMap<string, string>
}

/**
 * Where a search field is drawn: at the top of the content, as in the drawer under the
 * title; in an iPad's toolbar; or at the bottom of a phone's screen, in a glass capsule
 * on the tab bar's line.
 */
type SearchPlacement = 'top' | 'toolbar' | 'bottom'

/** A whole screen: content, the bars around it, and anything presented over it. */
export interface ScreenLayout {
  readonly content: LayoutElement
  /**
   * What colour the screen itself is.
   *
   * A grouped `List` or `Form` sits on `systemGroupedBackground`, and on iOS the
   * whole screen behind it is that colour - including behind the navigation bar.
   * Painting the screen white and the list grey is what produced a visible seam
   * under the bar on every navigation-plus-list screen.
   */
  readonly background: RGBA
  readonly navigationBar: { readonly element: LayoutElement; readonly height: number; readonly large: boolean } | null
  readonly tabBar: LayoutElement | null
  readonly search?: { readonly element: LayoutElement; readonly placement: 'top' | 'bottom'; readonly height: number }
  readonly overlay: {
    readonly element: LayoutElement
    readonly light: boolean
    readonly kind: Overlay['kind']
    readonly detent: number
    readonly detents?: readonly number[]
    readonly anchorId?: string
    readonly dismissId: string | null
    readonly cornerRadius?: number
    readonly showsDragIndicator?: boolean
    readonly background?: Fill
    readonly backgroundInteraction?: number
    readonly material?: { readonly opacity: number; readonly blur: number; readonly light: boolean }
    readonly screen?: ScreenLayout
  } | null
  readonly hitTargets: ReadonlyMap<string, string>
}

const SHAPES: Readonly<Record<string, ShapeKind>> = {
  Rectangle: 'rectangle',
  RoundedRectangle: 'roundedRectangle',
  Circle: 'circle',
  Ellipse: 'ellipse',
  Capsule: 'capsule',
  UnevenRoundedRectangle: 'roundedRectangle',
}

/**
 * Views that stand for their content, like a `Group`: a modifier on one applies to
 * each thing it holds. A reader or an animator hands its content a value and adds no
 * box of its own.
 */
const GROUP_LIKE_VIEWS: ReadonlySet<string> = new Set(['Group', 'ScrollViewReader', 'PhaseAnimator', 'KeyframeAnimator'])

/** Views that contribute their children to the enclosing stack rather than nesting. */
const TRANSPARENT_VIEWS: ReadonlySet<string> = new Set([
  'Group',
  'WindowGroup',
  'ForEach',
  'NavigationStack',
  'NavigationView',
  // On a phone a split view *is* a stack: the sidebar is the first screen and the
  // detail is pushed onto it. The multi-column form needs a width an iPhone has not
  // got, so collapsing is the real behaviour rather than an approximation of it.
  'NavigationSplitView',
  'TabView', 'Tab', 'TabSection',
  'AnyView',
  ...GROUP_LIKE_VIEWS,
])

/** iOS metrics the chrome is built from. Points, at the default Dynamic Type size. */
export const NAV_BAR_HEIGHT = IOS_27.metrics.navigationBar
export const LARGE_TITLE_HEIGHT = IOS_27.metrics.largeTitle
export const TAB_BAR_HEIGHT = SURFACES.tab.height + SURFACES.tab.bottom
const ROW_INSET = IOS_27.metrics.rowInset

/** A row in an alert or confirmation dialog, which iOS sizes like a list row. */
const ALERT_BUTTON_HEIGHT = SURFACES.alert.buttonHeight
/** Must match the runtime's swipe width, or the action would not line up. */
const SWIPE_WIDTH = 88

export interface ConversionOptions {
  readonly images?: readonly PreviewImageAsset[]
  readonly sheetSurface?: boolean
  readonly viewportWidth?: number
  readonly previewTarget?: PreviewTarget
  readonly colorScheme?: ColorScheme
  /** Dynamic Type multiplier applied to every resolved text style. */
  readonly typeScale?: number
  readonly dynamicTypeSize?: DynamicTypeSize
  readonly displayScale?: number
  readonly rootAxis?: Axis
  /**
   * Device safe-area insets.
   *
   * The bars need them, and only the bars: a navigation bar's *background* runs to
   * the very top of the screen while its content sits below the status bar, which is
   * one element with internal padding rather than two rects.
   */
  readonly safeArea?: {
    readonly top: number
    readonly leading: number
    readonly bottom: number
    readonly trailing: number
  }
  /**
   * Runs an `.alignmentGuide` closure with the view's measured dimensions.
   *
   * The one thing the layout pass cannot do for itself: the closure is the user's,
   * and it runs in the interpreter, which lives a layer up. Supplied as a function so
   * `swiftui-layout` stays free of any interpreter knowledge - it calls this, it does
   * not know what is on the other side.
   */
  readonly callGuide?: (closure: ClosureValue, size: Size) => number
}

export function viewsToLayout(
  views: readonly ViewValue[],
  options: ConversionOptions = {},
): ConversionResult {
  const rootAxis = options.rootAxis ?? 'vertical'
  const hitTargets = new Map<string, string>()
  const converter = new Converter(hitTargets, options.colorScheme ?? 'light', options.dynamicTypeSize ?? options.typeScale ?? 1, ZERO_INSETS, undefined, appearanceFor(options.previewTarget), options.displayScale ?? 3, options.viewportWidth ?? 393, options.sheetSurface, options.images)
  converter.useGuideRunner(options.callGuide ?? null)
  const children = converter.convertList(views, 'v', rootAxis)

  return { element: joinRoot(children, rootAxis), hitTargets }
}

/**
 * Lays out a composed screen.
 *
 * Bars and presentations are returned separately rather than wrapped around the
 * content, because each is positioned against the *device*, not against the content:
 * a tab bar sits on the bottom edge whatever the content does, and a sheet covers
 * the status bar. The pipeline places them geometrically, which keeps the layout
 * engine free of any idea that screens have edges.
 */
export function screenToLayout(ui: ResolvedUI, options: ConversionOptions = {}): ScreenLayout {
  const hitTargets = new Map<string, string>()
  const scheme = options.colorScheme ?? 'light'
  const safeArea = options.safeArea ?? ZERO_INSETS
  const background = screenBackground(ui.content, scheme, options.viewportWidth ?? 393, options.sheetSurface) ?? (options.sheetSurface ? rgba(0, 0, 0, 0) : systemBackground(scheme))
  const converter = new Converter(hitTargets, scheme, options.dynamicTypeSize ?? options.typeScale ?? 1, safeArea, background, appearanceFor(options.previewTarget), options.displayScale ?? 3, options.viewportWidth ?? 393, options.sheetSurface, options.images)
  converter.useGuideRunner(options.callGuide ?? null)

  const body = converter.convertList(ui.content, 'v', 'vertical')

  // On a phone, iOS 27 puts the search field at the bottom of the screen, where a tab
  // bar would be. Where there is one, it goes in the drawer under the title instead.
  const compact = (options.viewportWidth ?? 393) < 600
  const drawerSearch = ui.search && (['navigationBarDrawer', 'sidebar'].includes(ui.search.placement) || ui.search.placement === 'automatic' && compact && !!ui.tabBar)
  const toolbarSearch = ui.search && !drawerSearch && !compact && ui.navigationBar ? converter.searchField(ui.search, 'toolbar') : null
  const search = ui.search && !drawerSearch && !toolbarSearch
    ? compact
      ? { element: converter.searchField(ui.search, 'bottom'), placement: 'bottom' as const, height: TAB_BAR_HEIGHT }
      : { element: converter.searchField(ui.search, 'top'), placement: 'top' as const, height: SURFACES.search.height + 12 }
    : undefined
  const content = ui.search && drawerSearch
    ? prependSearch(joinRoot(body, 'vertical'), converter.searchField(ui.search, 'top'))
    : joinRoot(body, 'vertical')

  const navigationBar = ui.navigationBar
    ? {
        element: converter.navigationBar(ui.navigationBar, toolbarSearch),
        large: ui.navigationBar.large,
        height: NAV_BAR_HEIGHT + (ui.navigationBar.large ? Math.max(LARGE_TITLE_HEIGHT, fontForToken('largeTitle', options.dynamicTypeSize ?? options.typeScale ?? 1)!.lineHeight + 7) : 0),
      }
    : null

  const tabBar = ui.tabBar ? converter.tabBar(ui.tabBar) : null

  const overlay = ui.overlay
    ? {
        element: converter.overlay(ui.overlay),
        light: scheme === 'light',
        kind: ui.overlay.kind,
        detent: ui.overlay.detent,
        detents: ui.overlay.detents,
        anchorId: ui.overlay.anchorId,
        backgroundInteraction: ui.overlay.backgroundInteraction,
        dismissId: ui.overlay.dismissId,
        cornerRadius: ui.overlay.cornerRadius,
        showsDragIndicator: ui.overlay.showsDragIndicator,
        ...(ui.overlay.background ? { background: resolveFillArg(ui.overlay.background, scheme) ?? undefined } : {}),
        ...(MATERIALS[tokenName(ui.overlay.background) ?? ''] ? { material: { ...MATERIALS[tokenName(ui.overlay.background)!]!, light: scheme === 'light' } } : {}),
        ...(ui.overlay.screen && ['sheet', 'cover', 'popover'].includes(ui.overlay.kind) ? {
          screen: screenToLayout({ ...ui, ...ui.overlay.screen }, { ...options, sheetSurface: ui.overlay.kind !== 'cover', viewportWidth: ui.overlay.kind === 'cover' ? options.viewportWidth : Math.min(SURFACES.sheet.maxWidth, (options.viewportWidth ?? 393) - SURFACES.sheet.margin * 2), safeArea: { ...safeArea, top: ui.overlay.kind === 'cover' ? safeArea.top : ui.overlay.showsDragIndicator !== false ? 10 : 12 } }),
        } : {}),
      }
    : null

  return {
    content,
    search,
    background,
    navigationBar,
    tabBar,
    overlay,
    hitTargets,
  }
}

/** Grouped lists supply a screen surface. Other backgrounds paint only their view's bounds. */
function screenBackground(views: readonly ViewValue[], scheme: ColorScheme, width = 393, sheetSurface = false): RGBA | null {
  for (const view of views) {
    if (TRANSPARENT_VIEWS.has(view.name)) {
      const inner = screenBackground(view.children, scheme, width, sheetSurface)
      if (inner) return inner
      continue
    }

    if (view.name === 'List' || view.name === 'Form') {
      if (tokenName(modifierArg(view, 'scrollContentBackground', 0)) === 'hidden') continue
      const style = listAppearance(tokenName(modifierArg(view, 'listStyle', 0)), view.name === 'Form', width)
      if (style !== 'plain') {
        return sheetSurface ? rgba(0, 0, 0, 0) : colorForName('systemGroupedBackground', scheme)
      }
    }
  }
  return null
}

function joinRoot(children: LayoutElement[], axis: Axis): LayoutElement {
  if (children.length === 1) return children[0]!
  return {
    kind: 'stack',
    id: 'root-stack',
    axis,
    spacing: 0,
    alignment: CENTER,
    children,
  }
}

/**
 * The style modifiers that decide how a control draws.
 *
 * Kept apart from `LayoutModifier` because these are resolved while the tree is being
 * *built* - a segmented picker is a different set of elements, not the same elements
 * painted differently - so the engine's own inherited environment is too late.
 */
interface ControlStyles {
  readonly colorScheme?: ColorScheme
  readonly dynamicTypeSize?: DynamicTypeSize
  readonly container?: 'content' | 'toolbar' | 'list' | 'form'
  readonly scrollIndicators?: string
  readonly imageScale?: string
  readonly button?: string
  readonly textField?: string
  readonly tint?: RGBA
  readonly toggle?: string
  readonly picker?: string
  readonly label?: string
  readonly progressView?: string
  readonly gauge?: string
  readonly controlSize?: string
  readonly buttonBorderShape?: string
}

const STYLE_MODIFIERS: readonly (readonly [string, keyof ControlStyles])[] = [
  ['scrollIndicators', 'scrollIndicators'],
  ['imageScale', 'imageScale'],
  ['buttonStyle', 'button'],
  ['textFieldStyle', 'textField'],
  ['toggleStyle', 'toggle'],
  ['pickerStyle', 'picker'],
  ['labelStyle', 'label'],
  ['progressViewStyle', 'progressView'],
  ['gaugeStyle', 'gauge'],
  ['controlSize', 'controlSize'],
  ['buttonBorderShape', 'buttonBorderShape'],
]

function withStyles(outer: ControlStyles, view: ViewValue, scheme: ColorScheme): ControlStyles {
  let next = view.name === 'List' ? { ...outer, container: 'list' as const }
    : view.name === 'Form' ? { ...outer, container: 'form' as const } : outer
  const colorScheme = view.modifiers.find((modifier) => modifier.name === 'environment' && asKeyPath(modifier.args[0]?.value)?.components[0] === 'colorScheme')
  const appearance = tokenName(colorScheme?.args[1]?.value)
  if (appearance === 'light' || appearance === 'dark') next = { ...next, colorScheme: appearance }
  const typeEnvironment = view.modifiers.find((m) => m.name === 'environment' && asKeyPath(m.args[0]?.value)?.components[0] === 'dynamicTypeSize')
  const category = tokenName(modifierArg(view, 'dynamicTypeSize', 0) ?? typeEnvironment?.args[1]?.value)
  if (isDynamicTypeSize(category)) next = { ...next, dynamicTypeSize: category }
  scheme = next.colorScheme ?? scheme
  for (const [modifier, key] of STYLE_MODIFIERS) {
    const name = tokenName(modifierArg(view, modifier, 0))
    if (name !== null) next = { ...next, [key]: name }
  }
  const tint = view.modifiers.find((modifier) => modifier.name === 'tint' || modifier.name === 'accentColor')
  if (tint) next = { ...next, tint: resolveColorArg(tint.args[0]?.value, scheme, outer.tint) ?? undefined }
  return next
}

/** `axis: (x: 0, y: 1, z: 0)` - the tuple `.rotation3DEffect` takes. */
function axisVector(value: SwiftValue | undefined): { x: number; y: number; z: number } {
  const fallback = { x: 0, y: 1, z: 0 }
  if (!value || value.kind !== 'tuple') return fallback

  const component = (name: string, index: number): number => {
    const labelled = value.labels.indexOf(name)
    return numberArg(value.elements[labelled >= 0 ? labelled : index]) ?? 0
  }

  const vector = { x: component('x', 0), y: component('y', 1), z: component('z', 2) }
  return vector
}

function transformAnchor(value: SwiftValue | undefined): { x: number; y: number } {
  const point = payloadOf<{ x: number; y: number }>(value, 'CGPoint')
  return point ?? unitPoint(tokenName(value) ?? 'center')
}

/** Outside a List/Form, Section contributes siblings to its enclosing layout. */
function sectionChildren(view: ViewValue, path: string): ViewValue[] {
  const accessory = (name: 'header' | 'footer'): ViewValue[] => {
    const value = labelled(view.args, name) ?? (name === 'header' ? positional(view.args, 0) : undefined)
    const custom = value && asView(value)
    if (custom) return [{ ...custom, path: custom.path ?? `${path}-${name}` }]
    return stringArg(value) === null ? [] : [{ ...view, name: 'Text', args: [{ label: null, value: value! }], children: [], modifiers: [], action: null, path: `${path}-${name}` }]
  }
  return [...accessory('header'), ...view.children, ...accessory('footer')].map(child => ({ ...child, modifiers: [...child.modifiers, ...view.modifiers] }))
}

/** The weekday initials over a calendar. Not localised; neither is the rest of the chrome. */
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

class Converter {
  constructor(
    private readonly hitTargets: Map<string, string>,
    private readonly rootScheme: ColorScheme,
    private readonly rootTypeSize: number | DynamicTypeSize,
    private readonly safeArea: EdgeInsets = ZERO_INSETS,
    /** The screen's own background, which the navigation bar has to match. */
    private readonly screenBackground: RGBA = { r: 255, g: 255, b: 255, a: 1 },
    private readonly appearance = IOS_27,
    private readonly displayScale = 3,
    private readonly viewportWidth = 393,
    private readonly sheetSurface = false,
    private readonly images: readonly PreviewImageAsset[] = [],
  ) {}

  private get separatorHeight(): number { return 1 / Math.max(1, this.displayScale) }

  private get typeScale(): number | DynamicTypeSize { return this.styles.dynamicTypeSize ?? this.rootTypeSize }

  private get scheme(): ColorScheme { return this.styles.colorScheme ?? this.rootScheme }

  /**
   * How deep inside a `List` or `Form` the conversion currently is.
   *
   * One thing depends on it: a `NavigationLink` draws a disclosure chevron in a
   * list row and nothing at all anywhere else. A link in a grid of cards was
   * getting one, which is not what iOS draws and which also ate the width the card
   * needed - so the card's title wrapped and its statistics stacked.
   */
  private listDepth = 0

  /**
   * Makes an element fill the rect it is laid out in.
   *
   * Chrome and presentations are positioned against the device, so each is given an
   * exact rect and must occupy all of it. Without this they would hug their content
   * and a navigation bar's background would be exactly as tall as its title.
   */
  private fill(
    element: LayoutElement,
    id: string,
    alignment: Alignment = CENTER,
    vertical = true,
  ): LayoutElement {
    return {
      kind: 'modified',
      id,
      modifier: {
        kind: 'frame',
        maxWidth: Number.POSITIVE_INFINITY,
        ...(vertical ? { maxHeight: Number.POSITIVE_INFINITY } : {}),
        alignment,
      },
      child: element,
    }
  }

  // ------------------------------------------------------------------ chrome

  /**
   * A framework-drawn symbol.
   *
   * The chevrons on a navigation row, a back button, a picker and a disclosure
   * group are supplied by SwiftUI rather than written by the user, and each used to
   * be built inline from a resolved glyph with no record of *which* symbol it was.
   * The renderer needs the name to draw the right shape, and four inline copies is
   * four chances for the name and the glyph to disagree.
   */
  /** Runs an `.alignmentGuide` closure; absent when nothing can run one. */
  private callGuide: ((closure: ClosureValue, size: Size) => number) | null = null

  useGuideRunner(run: ((closure: ClosureValue, size: Size) => number) | null): void {
    this.callGuide = run
  }

  /**
   * The control styles in force, inherited like the font.
   *
   * `.labelStyle(.iconOnly)` on a `Button` applies to the `Label` inside it, and
   * `.pickerStyle(.segmented)` is nearly always written on the `Form` rather than on
   * each picker - so reading only a control's own modifiers would miss the spelling
   * people actually use. Pushed and popped around each subtree by `convert`.
   */
  private styles: ControlStyles = {}

  /** Confirmation-dialog cancellation emphasis; native alert pills use regular text. */
  private alertCancelWeight = false

  /** A simple outline keeps translucent system controls visible on a flat background. */
  private chromeOutline(child: LayoutElement, id: string, radius: number): LayoutElement {
    return { kind: 'modified', id, modifier: { kind: 'border', width: 0.5, cornerRadius: radius, color: { ...this.color('label'), a: 0.15 } }, child }
  }

  /** The outlined glass capsule of iOS 27's floating bars: the tab bar, and a phone's search. */
  private glassCapsule(content: LayoutElement, id: string, outlineId: string): LayoutElement {
    return this.chromeOutline({
      kind: 'modified', id: `${id}-radius`, modifier: { kind: 'cornerRadius', radius: 999 },
      child: { kind: 'modified', id, modifier: { kind: 'material', ...this.appearance.materials.regularMaterial!, light: this.scheme === 'light' }, child: content },
    }, outlineId, 999)
  }

  private symbolImage(id: string, name: string): LayoutElement {
    const symbol = resolveSymbol(name)
    return {
      kind: 'image',
      id,
      glyph: symbol.glyph,
      symbolScale: this.styles.imageScale === 'small' ? 0.8 : this.styles.imageScale === 'large' ? 1.3 : 1,
      resizable: false,
      approximated: symbol.approximated,
      symbol: name,
    }
  }

  /** The navigation bar: a translucent strip with a title and its bar buttons. */
  navigationBar(bar: ResolvedUI['navigationBar'] & object, search: LayoutElement | null = null): LayoutElement {
    const outer = this.styles
    this.styles = withStyles(outer, bar.view, this.scheme)
    this.styles = { ...this.styles, container: 'toolbar' }
    try { return this.navigationBarContent(bar, search) } finally { this.styles = outer }
  }

  /** System bar controls keep a compact font; content still follows Dynamic Type. */
  private chromeContent(id: string, build: () => LayoutElement): LayoutElement {
    const outer = this.styles
    this.styles = { ...outer, dynamicTypeSize: 'large' }
    try { return { kind: 'modified', id, modifier: { kind: 'font', font: bodyFont('large') }, child: build() } }
    finally { this.styles = outer }
  }

  private navigationBarContent(bar: ResolvedUI['navigationBar'] & object, search: LayoutElement | null): LayoutElement {
    const inline: LayoutElement = {
      kind: 'zstack',
      id: 'navbar-inline',
      alignment: CENTER,
      children: [
        {
          kind: 'stack',
          id: 'navbar-row',
          axis: 'horizontal',
          spacing: 8,
          alignment: CENTER,
          children: [
            ...bar.leading.map((item, i) => this.chromeContent(`navbar-l${i}-font`, () => this.convert(item, `navbar-l${i}`, 'horizontal'))),
            { kind: 'spacer', id: 'navbar-gap-l', axis: 'horizontal', minLength: 0 },
            ...(search ? [{ kind: 'modified' as const, id: 'navbar-search-width', modifier: { kind: 'frame' as const, width: Math.min(280, this.viewportWidth * 0.34), alignment: CENTER }, child: search }] : []),
            ...bar.trailing.map((item, i) => this.chromeContent(`navbar-t${i}-font`, () => this.convert(item, `navbar-t${i}`, 'horizontal'))),
          ],
        },
        // Both titles exist so the DOM can cross-fade them without evaluating Swift.
        search ? { kind: 'modified', id: 'navbar-title-inset', modifier: { kind: 'padding', insets: insets(0, bar.leading.length ? 90 : 0, 0, Math.min(280, this.viewportWidth * 0.34) + bar.trailing.length * 100) }, child: this.chromeContent('navbar-title-font', () => this.styledText('navbar-title', bar.title, 'headline', 'label')) } : this.chromeContent('navbar-title-font', () => this.styledText('navbar-title', bar.title, 'headline', 'label')),
      ],
    }

    const strip: LayoutElement = {
      kind: 'modified',
      id: 'navbar-pad',
      modifier: { kind: 'padding', insets: insets(0, ROW_INSET, 0, ROW_INSET) },
      child: { kind: 'modified', id: 'navbar-controls', modifier: { kind: 'frame', height: 44, alignment: CENTER }, child: inline },
      debugName: NAV_BAR,
    }

    const column: LayoutElement = bar.large
      ? {
          // The large-title bar is the inline row with the title below it.
          kind: 'stack',
          id: 'navbar-large',
          axis: 'vertical',
          spacing: 0,
          alignment: { horizontal: 'leading', vertical: 'center' },
          children: [
            {
              kind: 'modified',
              id: 'navbar-strip',
              modifier: { kind: 'frame', height: NAV_BAR_HEIGHT, alignment: { horizontal: 'center', vertical: 'top' } },
              child: strip,
            },
            {
              kind: 'modified',
              id: 'navbar-large-pad',
              modifier: { kind: 'padding', insets: insets(4, SURFACES.navigation.titleInset, 3, SURFACES.navigation.titleInset) },
              child: this.styledText('navbar-large-title', bar.title, 'largeTitle', 'label', 700),
            },
          ],
        }
      : {
          kind: 'modified',
          id: 'navbar-strip',
          modifier: { kind: 'frame', height: NAV_BAR_HEIGHT, alignment: { horizontal: 'center', vertical: 'top' } },
          child: strip,
        }

    // The background runs all the way to the top of the screen; the content starts
    // below the status bar. One element with a top inset, not two stacked rects.
    const inset: LayoutElement = {
      kind: 'modified',
      id: 'navbar-safe',
      modifier: { kind: 'padding', insets: insets(this.safeArea.top, 0, 0, 0) },
      child: column,
    }

    /*
      The bar takes the *screen's* background, not `systemBackground`.

      It used to be white unconditionally, so a navigation stack over a grouped list
      drew a white strip above a #F2F2F7 list and left a visible horizontal seam
      across every such screen. On iOS 15 and later a bar at the top of its content
      is transparent and the content's own background runs behind it, which is why
      no seam exists there; matching the background is the same result without
      having to let the content scroll under the bar.
    */
    return this.background(
      this.fill(inset, 'navbar-fill', { horizontal: 'center', vertical: 'top' }),
      'navbar-bg',
      this.screenBackground,
    )
  }

  /**
   * A `Label` inside a tab item.
   *
   * `Label` is an icon beside its title everywhere else, and in a tab bar it is an
   * icon *above* a much smaller one - a 25pt symbol over a 10pt caption. Converting
   * it like any other label produced a tiny symbol sitting next to the word at the
   * same size, which is the one piece of chrome on screen at all times and so the
   * one worth getting right.
   */
  /**
   * The page indicator a `.page` tab view draws instead of a tab bar.
   *
   * iOS pages by swiping and the dots are only an indicator. A preview has no swipe,
   * so each dot is also the control that gets to that page - an addition rather than
   * an approximation, and the only way through the pages here.
   */
  private pageDots(bar: NonNullable<ResolvedUI['tabBar']>): LayoutElement {
    const dots = bar.items.map((item, index) => {
      const selected = boolArg(labelled(item.args, 'selected'))
      const dot: LayoutElement = {
        kind: 'modified',
        id: `dot-${index}-frame`,
        modifier: { kind: 'frame', width: 7, height: 7, alignment: CENTER },
        child: {
          kind: 'modified',
          id: `dot-${index}-tint`,
          modifier: {
            kind: 'foregroundStyle',
            color: selected ? this.color('label') : this.color('tertiaryLabel'),
          },
          child: { kind: 'shape', id: `dot-${index}`, shape: 'circle' },
        },
      }

      // The target is bigger than the dot, because a 7pt circle is not a tap target.
      const target: LayoutElement = {
        kind: 'modified',
        id: `dot-${index}-hit`,
        modifier: { kind: 'padding', insets: uniformInsets(6) },
        child: dot,
      }

      return item.path ? this.withHitTarget(target, item.path, 'button', `Page ${index + 1}`) : target
    })

    return {
      kind: 'modified',
      id: 'pagedots-height',
      modifier: { kind: 'frame', height: TAB_BAR_HEIGHT, alignment: CENTER },
      child: {
        kind: 'stack',
        id: 'pagedots-row',
        axis: 'horizontal',
        spacing: 2,
        alignment: CENTER,
        children: [
          { kind: 'spacer', id: 'pagedots-lead', axis: 'horizontal', minLength: 0 },
          ...dots,
          { kind: 'spacer', id: 'pagedots-trail', axis: 'horizontal', minLength: 0 },
        ],
        debugName: TAB_BAR,
      },
    }
  }

  private tabLabel(view: ViewValue, path: string): LayoutElement {
    const title = stringArg(positional(view.args, 0))
    const systemImage = stringArg(labelled(view.args, 'systemImage'))

    const children: LayoutElement[] = []
    if (systemImage) {
      children.push({
        kind: 'modified',
        id: `${path}iconfont`,
        modifier: { kind: 'font', font: { ...fontForToken('title2')!, size: 25, lineHeight: 28 } },
        child: this.symbolImage(`${path}icon`, resolveSymbol(`${systemImage}.fill`).known ? `${systemImage}.fill` : systemImage),
      })
    }
    if (title !== null) children.push({ kind: 'text', id: `${path}title`, text: title })

    return {
      kind: 'stack',
      id: path,
      axis: 'vertical',
      spacing: 2,
      alignment: CENTER,
      children,
    }
  }

  private badgeText(value: SwiftValue | undefined): string | null {
    if (!value || value.kind === 'nil' || (value.kind === 'int' && value.value === 0)) return null
    const text = stringArg(value) ?? numberArg(value)?.toString() ?? (asView(value) ? textIn(asView(value)!).join(' ') : null)
    return text || null
  }

  private badgePill(text: string, path: string): LayoutElement {
    const label: LayoutElement = { kind: 'modified', id: `${path}-font`,
      modifier: { kind: 'font', font: { ...fontForToken('footnote', 'large')!, size: 12, lineHeight: 16 } },
      child: { kind: 'modified', id: `${path}-color`, modifier: { kind: 'foregroundStyle', color: rgba(255, 255, 255) },
        child: { kind: 'text', id: `${path}-text`, text } } }
    return this.background({ kind: 'modified', id: `${path}-frame`, modifier: { kind: 'frame', minWidth: 18, minHeight: 18, alignment: CENTER },
      child: { kind: 'modified', id: `${path}-pad`, modifier: { kind: 'padding', insets: insets(1, 4, 1, 4) }, child: label } },
      path, rgba(255, 56, 60), 999, 'circular')
  }

  /** The tab bar: evenly divided items, the selected one tinted. */
  tabBar(bar: NonNullable<ResolvedUI['tabBar']>): LayoutElement {
    const outer = this.styles
    this.styles = withStyles(outer, bar.view, this.scheme)
    try { return this.tabBarContent(bar) } finally { this.styles = outer }
  }

  private tabBarContent(bar: NonNullable<ResolvedUI['tabBar']>): LayoutElement {
    // `.tabViewStyle(.page)` is a row of dots, not a bar of labels.
    if (bar.items.some((item) => boolArg(labelled(item.args, 'paged')))) {
      return this.pageDots(bar)
    }

    const items = bar.items.map((item, index) => {
      const selected = boolArg(labelled(item.args, 'selected'))
      const tint = selected ? this.color('accentColor') : this.color('label')

      const content: LayoutElement = {
        kind: 'stack',
        id: `tab-${index}`,
        axis: 'vertical',
        spacing: 2,
        alignment: CENTER,
        children: item.children.map((child, i) =>
          child.name === 'Label'
            ? this.tabLabel(child, `tab-${index}-${i}`)
            : this.convert(child, `tab-${index}-${i}`, 'vertical'),
        ),
        debugName: TAB_ITEM,
      }

      const tinted: LayoutElement = {
        kind: 'modified',
        id: `tab-${index}-tint`,
        modifier: { kind: 'foregroundStyle', color: tint },
        child: {
          kind: 'modified',
          id: `tab-${index}-font`,
          modifier: { kind: 'font', font: { ...fontForToken('caption2')!, weight: selected ? 600 : 500 } },
          child: content,
        },
      }

      const expanded: LayoutElement = {
        kind: 'modified',
        id: `tab-${index}-frame`,
        modifier: { kind: 'frame', maxWidth: Number.POSITIVE_INFINITY, height: SURFACES.tab.height - SURFACES.tab.inset * 2, alignment: CENTER },
        child: tinted,
      }

      const badge = this.badgeText(labelled(item.args, 'badge'))
      const decorated: LayoutElement = badge === null ? expanded : { kind: 'modified', id: `tab-${index}-badge-overlay`,
        modifier: { kind: 'overlay', alignment: { horizontal: 'center', vertical: 'top' }, content: {
          kind: 'modified', id: `tab-${index}-badge-offset`, modifier: { kind: 'offset', x: 18, y: 2 },
          child: this.badgePill(badge, `tab-${index}-badge`),
        } }, child: expanded }
      const surface = selected ? this.background(decorated, `tab-${index}-selected`, { ...this.color('label'), a: 0.07 }, SURFACES.tab.selectedRadius, 'circular') : decorated
      return item.path ? this.withHitTarget(surface, item.path, 'button', labelOf(item)) : surface
    })

    const row: LayoutElement = {
      kind: 'modified',
      id: 'tabbar-height',
      modifier: { kind: 'frame', height: SURFACES.tab.height - SURFACES.tab.inset * 2, alignment: CENTER },
      child: {
        kind: 'stack',
        id: 'tabbar-row',
        axis: 'horizontal',
        spacing: 0,
        alignment: { horizontal: 'center', vertical: 'top' },
        children: items,
        debugName: TAB_BAR,
      },
    }

    const surface = this.glassCapsule({ kind: 'modified', id: 'tabbar-inset', modifier: { kind: 'padding', insets: uniformInsets(SURFACES.tab.inset) }, child: row }, 'tabbar-surface', 'tabbar-outline')
    return {
      kind: 'modified', id: 'tabbar-margin', modifier: { kind: 'padding', insets: insets(0, SURFACES.tab.margin, SURFACES.tab.bottom, SURFACES.tab.margin) },
      child: { kind: 'modified', id: 'tabbar-width', modifier: { kind: 'frame', maxWidth: Math.min(this.viewportWidth >= 600 ? SURFACES.tab.regularWidth : this.viewportWidth - SURFACES.tab.margin * 2, bar.items.length * SURFACES.tab.itemWidth + SURFACES.tab.inset * 2), height: SURFACES.tab.height, alignment: CENTER }, child: surface },
    }
  }

  /** Two actions share a row; more actions stack. Native alert actions use pills;
   * confirmation dialogs retain their separate, provisionally modeled row style. */
  private alertButtons(overlay: Overlay): LayoutElement[] {
    const buttons = overlay.views.filter((v) => v.name === 'Button' && (overlay.kind !== 'dialog' || tokenName(labelled(v.args, 'role')) !== 'cancel'))
    if (buttons.length === 0) {
      // A dialog with something other than buttons in it, or an alert with none. The
      // content is converted as it stands rather than forced into a strip.
      return overlay.views.map((v, i) => this.convert(v, `ov-${i}`, 'vertical'))
    }

    const cancelAt = buttons.findIndex((v) => tokenName(labelled(v.args, 'role')) === 'cancel')
    const others = buttons.filter((_, i) => i !== cancelAt)
    const cancel = cancelAt >= 0 ? buttons[cancelAt]! : null
    const side = overlay.kind === 'alert' && buttons.length === 2

    const ordered = cancel ? (side ? [cancel, ...others] : [...others, cancel]) : buttons

    const rows = ordered.map((view, index) => {
      const isCancel = tokenName(labelled(view.args, 'role')) === 'cancel'
      const previous = this.alertCancelWeight
      this.alertCancelWeight = isCancel && overlay.kind !== 'alert'
      try {
        const converted = this.convert(view, `ov-${index}`, 'vertical')
        const row: LayoutElement = {
          kind: 'modified',
          id: `ov-btn${index}frame`,
          modifier: {
            kind: 'frame' as const,
            minHeight: ALERT_BUTTON_HEIGHT,
            maxWidth: Number.POSITIVE_INFINITY,
            alignment: CENTER,
          },
          child: converted.kind === 'modified' && converted.modifier.kind === 'hitTarget' ? converted.child : converted,
        }
        return converted.kind === 'modified' && converted.modifier.kind === 'hitTarget' ? { ...converted, child: row } : row
      } finally {
        this.alertCancelWeight = previous
      }
    })

    return [{ kind: 'modified', id: 'ov-actions-pad', modifier: { kind: 'padding', insets: insets(0, 16, 16, 16) },
      child: { kind: 'stack', id: 'ov-btns', axis: side ? 'horizontal' : 'vertical', spacing: 8, alignment: CENTER,
        children: rows.map((row, i) => this.background(row, `ov-btn${i}-pill`, { ...this.color('label'), a: 0.13 }, 999, 'circular')) } }]
  }

  private alertField(view: ViewValue, path: string): LayoutElement {
    const input = this.withHitTarget({ kind: 'modified', id: `${path}frame`,
      modifier: { kind: 'inputFrame', minHeight: 48, paddingY: 13 },
      child: { kind: 'empty', id: `${path}inner` } }, view.path ?? path, 'textField', labelOf(view), view, disabledBy(view))
    const paddedInput = input.kind === 'modified' && input.modifier.kind === 'hitTarget'
      ? { ...input, modifier: { ...input.modifier, inputInset: 16 } } : input
    return this.background(paddedInput, `${path}-capsule`, { ...this.color('label'), a: 0.13 }, 999, 'circular')
  }

  /** A sheet, cover, alert, dialog or menu, laid out as its own little screen. */
  overlay(overlay: Overlay): LayoutElement {
    const body = overlay.views.map((v, i) => this.convert(v, `ov-${i}`, 'vertical'))

    if (overlay.kind === 'menu') return this.menuSurface(overlay)

    if (overlay.kind === 'alert' || overlay.kind === 'dialog') {
      const title = this.styledText('ov-title', overlay.title, overlay.kind === 'dialog' ? 'body' : 'headline', 'label', overlay.kind === 'dialog' ? 400 : 600)
      const message = overlay.message
        ? [this.styledText('ov-message', overlay.message, overlay.kind === 'alert' ? 'subheadline' : 'footnote', 'secondaryLabel')]
        : []

      const head: LayoutElement = {
        kind: 'modified',
        id: 'ov-pad',
        modifier: { kind: 'padding', insets: overlay.kind === 'alert' ? insets(20, 30, 20, 30) : insets(19, 16, 19, 16) },
        child: {
          kind: 'stack',
          id: 'ov-headstack',
          axis: 'vertical',
          spacing: overlay.kind === 'alert' ? 6 : 4,
          alignment: overlay.kind === 'alert' ? { horizontal: 'leading', vertical: 'center' } : CENTER,
          children: [...(overlay.title ? [title] : []), ...message],
        },
      }

      const panel: LayoutElement = {
        kind: 'stack',
        id: 'ov-stack',
        axis: 'vertical',
        spacing: 0,
        alignment: CENTER,
        children: [
          ...(overlay.title || message.length > 0 ? [this.fill(head, 'ov-head-fill', { horizontal: overlay.kind === 'dialog' ? 'center' : 'leading', vertical: 'center' }, false)] : []),
          ...(overlay.kind === 'alert' ? overlay.views.filter(v => v.name === 'TextField' || v.name === 'SecureField').map((v, i): LayoutElement => ({
            kind: 'modified', id: `ov-input${i}-pad`,
            modifier: { kind: 'padding', insets: insets(0, 16, 20, 16) },
            child: this.alertField(v, `ov-input${i}`),
          })) : []),
          ...this.alertButtons(overlay),
        ],
        debugName: overlay.kind === 'alert' ? ALERT : DIALOG,
      }

      // An alert hugs its content vertically and fills the width it is given, which
      // is why only the horizontal axis is filled here.
      return {
        kind: 'modified',
        id: 'ov-bgr',
        modifier: { kind: 'cornerRadius', radius: SURFACES.alert.radius, style: 'continuous' },
        child: {
          kind: 'modified',
          id: 'ov-bg',
          // A material, which is what iOS puts behind an alert. A flat panel over a
          // dimmed screen is the one part of this that a screenshot always gave away.
          modifier: {
            kind: 'material',
            ...(overlay.kind === 'alert' ? { opacity: 0.625, blur: 28 } : MATERIALS.thickMaterial!),
            light: this.scheme === 'light',
          },
          child: this.chromeOutline(this.fill(panel, 'ov-fill', CENTER, false), 'ov-outline', SURFACES.alert.radius),
        },
      }
    }

    const grabber: LayoutElement = {
      kind: 'modified',
      id: 'ov-grabber-frame',
      modifier: { kind: 'frame', width: 36, height: 5, alignment: CENTER },
      child: {
        kind: 'fill',
        id: 'ov-grabber',
        fill: { kind: 'solid', color: this.color('tertiaryLabel') },
      },
    }

    const stack: LayoutElement = {
      kind: 'stack',
      id: 'ov-stack',
      axis: 'vertical',
      spacing: 0,
      alignment: CENTER,
      children: [
        ...(overlay.kind === 'sheet' && overlay.showsDragIndicator !== false
          ? [
              {
                kind: 'modified' as const,
                id: 'ov-grabber-pad',
                modifier: { kind: 'padding' as const, insets: insets(8, 0, 8, 0) },
                child: { kind: 'modified' as const, id: 'ov-grabber-round', modifier: { kind: 'cornerRadius' as const, radius: 2.5 }, child: grabber },
              },
            ]
          : []),
        ...body,
      ],
    }

    // A sheet or cover fills the rect the pipeline gave it, content at the top.
    return this.background(
      this.fill(stack, 'ov-fill', { horizontal: 'center', vertical: 'top' }),
      'ov-bg',
      this.color('systemBackground'),
      overlay.kind === 'sheet' ? overlay.cornerRadius ?? SURFACES.sheet.radius : 0,
    )
  }

  // ----------------------------------------------------------------- content

  convertList(views: readonly ViewValue[], prefix: string, axis: Axis): LayoutElement[] {
    const out: LayoutElement[] = []
    views.forEach((view, index) => {
      const path = view.path ?? `${prefix}-${index}`
      if (view.name === 'Section') {
        out.push(...this.convertList(sectionChildren(view, path), path, axis))
        return
      }
      // A `Group` is not a container - it exists so a builder can exceed its child
      // limit, and its children belong to the enclosing stack. `ForEach` is the same:
      // its rows are siblings of whatever surrounds it, never a nested stack.
      //
      // A `ForEach` stays transparent even when it carries modifiers, because the
      // modifiers it carries - `.onDelete`, `.onMove` - describe the *collection*
      // rather than a box around it. Treating it as opaque made an entire list
      // collapse into one unrecognised view.
      if (isTransparent(view)) {
        out.push(...this.convertList(view.children.map((child) => inheritVisualStyle(child, visualModifiers(view))), path, axis))
        return
      }

      /**
       * A `Group` carrying modifiers is still not a container, nor is a reader or an
       * animator standing for its content.
       *
       * SwiftUI applies a `Group`'s modifiers to each of its children rather than to
       * a box around them - `Group { A; B }.font(.caption)` *is* `A.font(.caption)`
       * and `B.font(.caption)`, and `.frame(width: 100)` sizes each of them. So the
       * modifiers are pushed down and the group disappears, which is both simpler and
       * more correct than wrapping. The others in `GROUP_LIKE_VIEWS` hold one view in
       * practice, where the two are the same.
       *
       * Without this, a modified group reached the switch below, matched nothing, and
       * drew a placeholder - which is what `Group { … }.font(…)` did, and what every
       * `@ViewBuilder` helper of more than one statement now produces.
       */
      if (GROUP_LIKE_VIEWS.has(view.name) && view.children.length > 0) {
        out.push(
          ...this.convertList(
            view.children.map((child, i) => ({
              ...child,
              path: child.path ?? `${path}-${i}`,
              modifiers: [...child.modifiers, ...view.modifiers],
            })),
            path,
            axis,
          ),
        )
        return
      }

      if (view.name !== 'EmptyView' || view.modifiers.length > 0) out.push(this.convert(view, path, axis))
    })
    return out
  }

  convert(view: ViewValue, fallbackPath: string, parentAxis: Axis): LayoutElement {
    const path = view.path ?? fallbackPath
    const outer = this.styles
    this.styles = withStyles(outer, view, this.scheme)
    try {
      return this.convertInner(view, path, parentAxis)
    } finally {
      this.styles = outer
    }
  }

  private convertInner(view: ViewValue, path: string, parentAxis: Axis): LayoutElement {
    let element = this.baseElement(view, path, parentAxis)
    const accessibility: { index: number; modifier: LayoutModifier }[] = []

    // Modifiers wrap outward in source order, so `.padding().background()` nests as
    // background(padding(view)) and therefore covers the padding.
    for (const [index, modifier] of view.modifiers.entries()) {
      const converted = this.convertModifier(modifier, `${path}m${index}`, view)
      if (!converted) continue
      if (view.intent && converted.kind === 'a11y') {
        accessibility.push({ index, modifier: converted })
        continue
      }
      element = { kind: 'modified', id: `${path}m${index}`, modifier: converted, child: element }
    }

    // The tap area covers everything the modifiers added, so the hit target goes
    // outermost - tapping a button's padding must count, exactly as on iOS.
    // Segments own their hit areas. A full-size picker target would cover them.
    const segmented = view.name === 'Picker' && this.styles.picker === 'segmented'
    if (view.intent) {
      if (isDisabled(view)) element = { kind: 'modified', id: `${path}disabled`, modifier: { kind: 'opacity', value: 0.4 }, child: element }
      if (!segmented) element = this.withHitTarget(element, path, roleOf(view), labelOf(view), view, disabledBy(view))
    }
    // A passive context target sits behind descendant controls. Those controls
    // also carry the menu handler, so a hold never steals their normal short tap.
    if (!view.intent && view.contextMenuPath) {
      element = this.withHitTarget(element, path, 'contextMenu', labelOf(view), view, disabledBy(view))
    }
    for (const { index, modifier } of accessibility) {
      element = { kind: 'modified', id: `${path}m${index}`, modifier, child: element }
    }

    const preferredSpacing = view.name === 'Text' ? this.appearance.spacing.text
      : view.name === 'Image' ? this.appearance.spacing.image
      : ['Button', 'Toggle', 'Slider', 'TextField', 'SecureField', 'Stepper', 'Picker', 'ProgressView'].includes(view.name)
        ? this.appearance.spacing.control : undefined
    return preferredSpacing ? { ...element, preferredSpacing } : element
  }

  private withHitTarget(
    element: LayoutElement,
    path: string,
    role: HitRole,
    label: string,
    view?: ViewValue,
    disabled = false,
    override?: { value?: string; placeholder?: string; min?: number; max?: number; step?: number },
  ): LayoutElement {
    const handlerId = handlerIdFor(path)
    this.hitTargets.set(handlerId, path)

    const control = override ?? (view ? this.controlState(view) : {})

    return {
      kind: 'modified',
      id: `${path}hit`,
      modifier: {
        kind: 'hitTarget',
        handlerId,
        label,
        role,
        enabled: !disabled,
        ...control,
        ...(view?.contextMenuPath ? { contextMenuHandlerId: handlerIdFor(`${view.contextMenuPath}/context-menu`) } : {}),
        ...(role === 'textField' && view ? this.inputOptions(view, path) : {}),
        ...(role === 'slider' ? { color: this.color('accentColor'), thumbDiameter: CONTROL_PARTS.slider.thumb } : {}),
        ...(role === 'textField' ? { inputInset: this.styles.textField === 'roundedBorder' ? CONTROL_PARTS.field.insetX : 0, placeholderColor: this.color('secondaryLabel') } : {}),
        ...(role === 'button' ? { cornerRadius: this.styles.buttonBorderShape === 'roundedRectangle' ? this.appearance.button.roundedRectangleRadius : this.appearance.button.cornerRadius } : {}),
        ...(role === 'textField' ? { color: resolveColorArg(view?.modifiers.find((m) => m.name === 'foregroundStyle' || m.name === 'foregroundColor')?.args[0]?.value, this.scheme, this.styles.tint) ?? this.color('primary') } : {}),
      },
      child: element,
      ...(view?.span ? { origin: view.span } : {}),
    }
  }

  private inputOptions(view: ViewValue, path: string) {
    const mode = tokenName(modifierArg(view, 'keyboardType', 0))
    const inputMode = ({ emailAddress: 'email', URL: 'url', phonePad: 'tel', numberPad: 'numeric', decimalPad: 'decimal', numbersAndPunctuation: 'decimal', webSearch: 'search' } as const)[mode as 'emailAddress'] ?? 'text'
    const requested = tokenName(modifierArg(view, 'submitLabel', 0)) ?? 'return'
    const enterKeyHint = ({ done: 'done', go: 'go', next: 'next', previous: 'previous', search: 'search', send: 'send', continue: 'next', join: 'go', route: 'go' } as const)[requested as 'done'] ?? 'enter'
    const capitalization = tokenName(modifierArg(view, 'textInputAutocapitalization', 0))
    const correction = view.modifiers.find(m => m.name === 'autocorrectionDisabled')
    return { inputMode, enterKeyHint,
      ...(stringArg(labelled(view.args, '_inputType')) === 'time' ? { inputType: 'time' as const } : {}),
      ...(view.modifiers.some(m => m.name === 'onSubmit' && m.closure) ? { submitHandlerId: handlerIdFor(`${path}/submit`) } : {}),
      ...(capitalization ? { autocapitalization: capitalization === 'never' ? 'none' : capitalization } : {}),
      ...(correction ? { autocorrection: correction.args[0] ? !boolArg(correction.args[0].value) : false } : {}),
    }
  }

  /** Values a real DOM control needs: a text field's contents, a slider's range. */
  private controlState(view: ViewValue): {
    value?: string
    placeholder?: string
    min?: number
    max?: number
    step?: number
    secure?: boolean
    multiline?: boolean
  } {
    switch (view.name) {
      case 'TextField':
      case 'SecureField':
      case 'TextEditor': {
        const bound = bindingValue(labelled(view.args, 'text'))
        return {
          value: bound?.kind === 'string' ? bound.value : '',
          placeholder: stringArg(positional(view.args, 0)) ?? '',
          secure: view.name === 'SecureField',
          multiline: view.name === 'TextEditor',
        }
      }
      case 'Slider': {
        const bound = bindingValue(labelled(view.args, 'value'))
        const range = labelled(view.args, 'in')
        return {
          value: String(numberArg(bound ?? undefined) ?? 0),
          min: range?.kind === 'range' ? range.lower : 0,
          max: range?.kind === 'range' ? range.upper : 1,
          step: numberArg(labelled(view.args, 'step')) ?? undefined,
        }
      }
      case 'Toggle': {
        const bound = bindingValue(labelled(view.args, 'isOn'))
        return { value: bound && truthy(bound) ? 'on' : 'off' }
      }
      default:
        return {}
    }
  }

  private baseElement(view: ViewValue, path: string, parentAxis: Axis): LayoutElement {
    const origin = {
      ...(view.span ? { origin: view.span } : {}),
      debugName: view.name,
      ...(view.modifiers.length > 0
        ? { debugModifiers: view.modifiers.map((m) => `.${m.name}`) }
        : {}),
    }

    switch (view.name) {
      case 'Text': {
        // A concatenation carries its operands as children; anything else is one run,
        // and stays on the path that allocates nothing per run.
        const runs = view.children.length > 0 ? this.textRuns(view) : null
        return {
          kind: 'text',
          id: path,
          text: runs ? runs.map((run) => run.text).join('') : textOf(view),
          ...(runs ? { runs } : {}),
          ...origin,
        }
      }

      case 'VStack':
      case 'HStack':
      case 'LazyVStack':
      case 'LazyHStack': {
        const axis: Axis = view.name.endsWith('VStack') ? 'vertical' : 'horizontal'
        return {
          kind: 'stack',
          id: path,
          axis,
          spacing: numberArg(labelled(view.args, 'spacing')) ?? null,
          alignment: stackAlignment(view.args, axis),
          children: this.convertList(view.children, path, axis),
          ...origin,
        }
      }

      case 'ZStack':
        return {
          kind: 'zstack',
          id: path,
          alignment: zstackAlignment(view.args),
          children: this.convertList(view.children, path, parentAxis),
          ...origin,
        }

      case 'Spacer':
        return {
          kind: 'spacer',
          id: path,
          // A Spacer's axis is its *parent's* - the same view expands down in a
          // VStack and across in an HStack.
          axis: parentAxis,
          minLength: numberArg(labelled(view.args, 'minLength')) ?? this.appearance.metrics.spacerMinimum,
          ...origin,
        }

      case 'Divider':
        return this.divider(path, parentAxis, origin)

      case 'EmptyView':
        return { kind: 'empty', id: path, ...origin }

      case 'Path': {
        const payload = asPath(positional(view.args, 0))
        if (!payload) return { kind: 'empty', id: path, ...origin }

        const fill = resolveFillArg(modifierArg(view, 'fill', 0), this.scheme, this.styles.tint)
        const strokeColor = view.modifiers.some(m => m.name === 'stroke') ? resolveColorArg(modifierArg(view, 'stroke', 0), this.scheme, this.styles.tint) ?? this.color('primary') : null
        const strokeWidth =
          numberArg(modifierNamedArg(view, 'stroke', 'lineWidth')) ??
          numberArg(modifierArg(view, 'stroke', 1)) ??
          strokeStyle(view)?.lineWidth ??
          1

        const trimmed = trimOf(view) ?? payload.trim
        return {
          kind: 'path',
          id: path,
          d: toSVGPath(applyTrim({ commands: payload.commands, trim: trimmed })),
          fill: fill ?? null,
          stroke: strokeColor ? { ...strokeStyle(view), color: strokeColor, width: strokeWidth, usesForeground: !resolveColorArg(modifierArg(view, 'stroke', 0), this.scheme, this.styles.tint) } : null,
          fillRule: tokenName(modifierNamedArg(view, 'fill', 'style')) === 'evenOdd'
            ? 'evenodd'
            : 'nonzero',
          ...origin,
        }
      }

      case 'Canvas': {
        const context = asCanvasContext(positional(view.args, 0))
        if (!context || context.drawings.length === 0) {
          return { kind: 'empty', id: path, ...origin }
        }

        // Each drawing is its own path node, stacked in the order they were made -
        // which is what a graphics context's painter's-algorithm ordering means.
        return {
          kind: 'zstack',
          id: path,
          alignment: { horizontal: 'leading', vertical: 'top' },
          children: context.drawings.map((drawing, index) => {
            const fill = resolveFillArg(drawing.fill ?? undefined, this.scheme, this.styles.tint)
            const stroke = resolveColorArg(drawing.stroke ?? undefined, this.scheme, this.styles.tint)
            return {
              kind: 'path' as const,
              id: `${path}d${index}`,
              d: drawing.d,
              fill: fill ?? null,
              stroke: stroke ? { color: stroke, width: drawing.lineWidth } : null,
              fillRule: 'nonzero' as const,
            }
          }),
          ...origin,
        }
      }

      case 'Color': {
        // A colour used as a view fills whatever it is offered, like a shape.
        const fill = resolveFillArg(positional(view.args, 0), this.scheme, this.styles.tint)
        return fill
          ? { kind: 'fill', id: path, fill, ...origin }
          : { kind: 'empty', id: path, ...origin }
      }

      case 'ScrollView':
        return this.scrollView(view, path, origin)

      case 'List':
        return this.list(view, path, origin)

      case 'Section':
        return { kind: 'stack', id: path, axis: parentAxis, spacing: null, alignment: CENTER,
          children: this.convertList(sectionChildren({ ...view, modifiers: [] }, path), path, parentAxis), ...origin }

      case 'Form':
        return this.list({ ...view, name: 'Form' }, path, origin)

      case 'LazyVGrid':
      case 'LazyHGrid':
        return this.grid(view, path, origin)

      case 'Grid':
        return this.table(view, path, origin)

      case 'GridRow':
        // A row outside a `Grid` is an ordinary row, which is also what SwiftUI does.
        return {
          kind: 'stack',
          id: path,
          axis: 'horizontal',
          spacing: defaultSpacing(),
          alignment: CENTER,
          children: this.convertList(view.children, path, 'horizontal'),
          ...origin,
        }

      case 'ViewThatFits':
        return {
          kind: 'firstFit',
          id: path,
          axes: fitAxes(positional(view.args, 0)),
          children: this.convertList(view.children, path, parentAxis),
          ...origin,
        }

      // A custom `Shape` draws into the box it is given, which is the same thing a
      // `GeometryReader` is: greedy, its own coordinate space, and measured so the
      // next pass can hand the shape the rect it actually got.
      case 'ShapeView':
      case 'GeometryReader':
        return {
          kind: 'modified',
          id: `${path}geo`,
          modifier: { kind: 'geometry', key: geometryKeyOf(view) },
          child: {
            kind: 'zstack',
            id: path,
            alignment: { horizontal: 'leading', vertical: 'top' },
            children: this.convertList(view.children, path, 'vertical'),
            ...origin,
          },
        }

      case 'Image':
        return this.image(view, path, origin)

      case 'Label':
        return this.label(view, path, origin)

      case 'Button':
        return this.button(view, path, origin)

      case 'NavigationLink':
        return this.navigationLink(view, path, origin)

      case 'Toggle':
        return this.toggle(view, path, origin)

      case 'TextField':
      case 'SecureField':
        return this.textField(view, path, origin)

      case 'Slider':
        return this.slider(view, path, origin)

      case 'Stepper':
        return this.stepper(view, path, origin)

      case 'ProgressView':
        return this.progressView(view, path, origin)

      case 'Picker':
        return this.picker(view, path, origin)
      case 'Menu':
        return this.button({ ...view, children: argViews(view, 'label') }, path, origin)

      case 'Link':
      case 'ShareLink':
        return this.link(view, path, origin)

      case 'AsyncImage':
        return this.asyncImage(view, path, origin)

      case 'DatePicker':
      case 'ColorPicker':
        return this.picker(view, path, origin)

      case 'TextEditor':
        return this.textField(view, path, origin)

      case 'DisclosureGroup':
        return this.disclosureGroup(view, path, origin)

      case 'GroupBox':
        return this.groupBox(view, path, origin)

      case 'LabeledContent':
        return this.labeledContent(view, path, origin)

      case 'ControlGroup':
        return this.controlGroup(view, path, origin)

      case DATE_EDITOR:
        return this.dateEditor(view, path, origin)

      case DATE_CELL:
        return this.dateCell(view, path, origin)

      case COLOUR_EDITOR:
        return this.colourEditor(view, path, origin)

      case COLOUR_SWATCH:
        return this.colourSwatch(view, path, origin)

      case 'TimelineView':
        // The schedule is a clock the preview does not run, so the content is drawn
        // once, for the moment of the render: its `context.date` is now.
        return {
          kind: 'stack',
          id: path,
          axis: 'vertical',
          spacing: 0,
          alignment: CENTER,
          children: this.convertList(view.children, `${path}c`, 'vertical'),
          ...origin,
        }

      case 'ContentUnavailableView':
        return this.contentUnavailable(view, path, origin)

      case 'Gauge':
        return this.gauge(view, path, origin)

      case 'AnyView':
        // Type erasure is a compile-time concern; at runtime it is its content.
        return {
          kind: 'stack',
          id: path,
          axis: 'vertical',
          spacing: 0,
          alignment: CENTER,
          children: this.convertList(view.children, path, 'vertical'),
          ...origin,
        }

      case BACK_BUTTON:
        return this.backButton(view, path, origin)

      default:
        break
    }

    // A custom view whose body stopped: what it is, and why, where it would have been.
    const halted = stopped(view)
    if (halted) return { kind: 'placeholder', id: path, placeholder: { kind: 'stopped', feature: halted.name, reason: halted.failure.message }, ...origin }

    const shape = SHAPES[view.name]
    if (shape) {
      const radius = hasCornerRadii(view.args.map((a) => a.label)) ? largestCorner(view.args) : numberArg(labelled(view.args, 'cornerRadius'))
      const fill = resolveFillArg(modifierArg(view, 'fill', 0), this.scheme, this.styles.tint)
      const strokeName = view.modifiers.some((m) => m.name === 'strokeBorder') ? 'strokeBorder' : 'stroke'
      const hasStroke = view.modifiers.some((m) => m.name === strokeName)
      const strokeColor = resolveColorArg(modifierArg(view, strokeName, 0), this.scheme, this.styles.tint) ?? (hasStroke ? this.color('primary') : null)
      const strokeWidth =
        numberArg(modifierNamedArg(view, strokeName, 'lineWidth')) ??
        numberArg(modifierArg(view, strokeName, 1)) ??
        strokeStyle(view)?.lineWidth ??
        1

      const trim = trimOf(view)
      return {
        kind: 'shape',
        id: path,
        shape,
        cornerStyle: tokenName(labelled(view.args, 'style')) === 'continuous' ? 'continuous' : 'circular',
        ...(radius !== null ? { cornerRadius: radius } : {}),
        ...(fill ? { fill } : {}),
        ...(trim ? { trim } : {}),
        ...(strokeColor ? { stroke: { ...strokeStyle(view), color: strokeColor, width: Math.max(0, strokeWidth), usesForeground: !resolveColorArg(modifierArg(view, strokeName, 0), this.scheme, this.styles.tint), placement: strokeName === 'strokeBorder' ? 'inside' as const : 'center' as const } } : {}),
        ...origin,
      }
    }

    // A real SwiftUI view the preview cannot draw yet renders as a labelled box
    // naming the feature, never as a blank space (FR-4.11).
    return {
      kind: 'placeholder',
      id: path,
      placeholder: { kind: UNIMPLEMENTED_VIEWS.has(view.name) ? 'unsupported' : 'unknown', feature: view.name },
      ...origin,
    }
  }

  // ------------------------------------------------------------- containers

  /**
   * The spans of a concatenated `Text`.
   *
   * `Text("a").bold() + Text("b")` reaches here as a `Text` with the two operands as
   * children, each carrying its own modifier chain. Each chain is read into an
   * *override* rather than a resolved style, so a span that set nothing still takes
   * the size and colour of wherever the concatenation ends up - which is what SwiftUI
   * does, and what makes `.font(.title)` on the whole expression reach both halves.
   *
   * Nested concatenation is left-associative, so the tree is flattened here and the
   * renderer only ever sees a flat list.
   */
  private textRuns(view: ViewValue): readonly TextRunSpec[] {
    const out: TextRunSpec[] = []

    const walk = (operand: ViewValue): void => {
      if (operand.name === 'Text' && operand.children.length > 0) {
        for (const child of operand.children) walk(child)
        // A modifier on the concatenation itself applies to every span below it.
        const outer = this.runAttributes(operand)
        if (Object.keys(outer).length > 0) {
          for (let i = 0; i < out.length; i++) out[i] = { ...outer, ...out[i]! }
        }
        return
      }
      out.push({ text: textOf(operand), ...this.runAttributes(operand) })
    }

    for (const child of view.children) walk(child)
    const outer = this.runAttributes(view)
    if (Object.keys(outer).length > 0) {
      for (let i = 0; i < out.length; i++) out[i] = { ...outer, ...out[i]! }
    }
    return out
  }

  /** What one span's own modifier chain sets, as overrides on its surroundings. */
  private runAttributes(view: ViewValue): Omit<TextRunSpec, 'text'> {
    let font: { family?: string; size?: number; lineHeight?: number; weight?: number; italic?: boolean } | undefined
    let color: RGBA | undefined
    let foregroundFill: Fill | undefined
    let underline: boolean | undefined
    let underlineColor: RGBA | null | undefined
    let strikethrough: boolean | undefined
    let strikethroughColor: RGBA | null | undefined
    let tracking: number | undefined
    let baselineOffset: number | undefined

    const face = (patch: { family?: string; size?: number; lineHeight?: number; weight?: number; italic?: boolean }) => {
      font = { ...font, ...patch }
    }

    for (const modifier of view.modifiers) {
      const first = positional(modifier.args, 0)
      switch (modifier.name) {
        case 'font': {
          const resolved = resolveFontArg(first, this.typeScale)
          if (resolved) {
            face({
              family: resolved.family,
              size: resolved.size,
              lineHeight: resolved.lineHeight,
              weight: resolved.weight,
              italic: resolved.italic,
            })
          }
          break
        }
        case 'fontWeight':
          face({ weight: resolveWeightArg(first) ?? 700 })
          break
        case 'bold':
          if (first?.kind !== 'bool' || first.value) face({ weight: 700 })
          break
        case 'italic':
          face({ italic: first?.kind !== 'bool' || first.value })
          break
        case 'monospaced':
          face({ family: MONO_FAMILY })
          break
        case 'fontDesign': {
          const design = tokenName(first)
          face({
            family:
              design === 'rounded'
                ? ROUNDED_FAMILY
                : design === 'monospaced'
                  ? MONO_FAMILY
                  : design === 'serif' ? SERIF_FAMILY : UI_FONT_FAMILY,
          })
          break
        }
        case 'foregroundColor':
        case 'foregroundStyle': {
          const resolved = resolveFillArg(first, this.scheme, this.styles.tint)
          if (resolved?.kind === 'solid') { color = resolved.color; foregroundFill = undefined }
          else if (resolved) { foregroundFill = resolved; color = undefined }
          break
        }
        case 'underline':
          underlineColor = resolveColorArg(labelled(modifier.args, 'color'), this.scheme, this.styles.tint)
          underline = first === undefined ? true : first.kind === 'bool' ? first.value : true
          break
        case 'strikethrough':
          strikethroughColor = resolveColorArg(labelled(modifier.args, 'color'), this.scheme, this.styles.tint)
          strikethrough = first === undefined ? true : first.kind === 'bool' ? first.value : true
          break
        case 'kerning':
        case 'tracking': {
          const value = numberArg(first)
          if (value !== null) tracking = value
          break
        }
        case 'baselineOffset': {
          const value = numberArg(first)
          if (value !== null) baselineOffset = value
          break
        }
        default:
          break
      }
    }

    return {
      ...(font ? { font } : {}),
      ...(color ? { color } : {}),
      ...(foregroundFill ? { foregroundFill } : {}),
      ...(underline !== undefined ? { underline, underlineColor } : {}),
      ...(strikethrough !== undefined ? { strikethrough, strikethroughColor } : {}),
      ...(tracking !== undefined ? { tracking } : {}),
      ...(baselineOffset !== undefined ? { baselineOffset } : {}),
    }
  }

  /** GroupBox keeps its label and content inside one inset surface. */
  private groupBox(view: ViewValue, path: string, origin: object): LayoutElement {
    const title = stringArg(positional(view.args, 0))
    const labels = title !== null ? [this.styledText(`${path}t`, title, 'headline', 'label')]
      : this.convertList(argViews(view, 'label'), `${path}label`, 'horizontal')
    const body: LayoutElement = { kind: 'stack', id: `${path}body`, axis: 'vertical', spacing: 8,
      alignment: CENTER, children: this.convertList(view.children, `${path}c`, 'vertical') }
    const content: LayoutElement = { kind: 'stack', id: path, axis: 'vertical', spacing: 0,
      alignment: CENTER, ...origin, children: [
        ...labels.map((label, i): LayoutElement => ({ kind: 'modified', id: `${path}label${i}wide`,
          modifier: { kind: 'frame', maxWidth: Infinity, alignment: { horizontal: 'leading', vertical: 'center' } }, child: label })),
        { kind: 'modified', id: `${path}bodywide`, modifier: { kind: 'frame', maxWidth: Infinity, alignment: CENTER }, child: body },
      ] }
    return this.background({ kind: 'modified', id: `${path}pad`, modifier: { kind: 'padding', insets: uniformInsets(16) }, child: content },
      `${path}bg`, this.color('secondarySystemBackground'), 8)
  }

  /**
   * `LabeledContent("Total", value: "$12")` - a label leading, its value trailing.
   *
   * The same row a `Form` draws for a setting, which is where the view is nearly
   * always written. The value takes the secondary colour, so the pair reads as
   * label-and-value rather than as two labels.
   */
  private labeledContent(view: ViewValue, path: string, origin: object): LayoutElement {
    const title = stringArg(positional(view.args, 0)) ?? argText(view, 'label') ?? ''
    const valueArg = labelled(view.args, 'value')
    const value = valueArg ? (stringArg(valueArg) ?? displayValue(valueArg)) : null

    // The content form - `LabeledContent("Total") { Text("$12") }` - puts the value
    // in the children instead, and either spelling draws the same row.
    const trailing: LayoutElement =
      value !== null
        ? this.styledText(`${path}v`, value, 'body', 'secondaryLabel')
        : {
            kind: 'stack',
            id: `${path}v`,
            axis: 'horizontal',
            spacing: 4,
            alignment: CENTER,
            children: this.convertList(view.children, `${path}c`, 'horizontal'),
          }

    return {
      kind: 'stack',
      id: path,
      axis: 'horizontal',
      spacing: 8,
      alignment: CENTER,
      children: [
        this.styledText(`${path}l`, title, 'body', 'label'),
        { kind: 'spacer', id: `${path}sp`, axis: 'horizontal', minLength: 0 },
        trailing,
      ],
      ...origin,
    }
  }

  /**
   * `ControlGroup { … }` - its controls in a row.
   *
   * Drawn as the row iOS draws in a toolbar rather than as a segmented picker: the
   * segmented form is what `ControlGroup` looks like in a menu, and the resolver has
   * no way to know which it landed in. The row is the form that is right more often,
   * and the difference is spacing rather than content.
   */
  private controlGroup(view: ViewValue, path: string, origin: object): LayoutElement {
    return {
      kind: 'stack',
      id: path,
      axis: 'horizontal',
      spacing: 12,
      alignment: CENTER,
      children: this.convertList(view.children, `${path}c`, 'horizontal'),
      ...origin,
    }
  }

  /**
   * A `DatePicker`'s calendar.
   *
   * The month's name between its two arrows, a row of weekday initials, then the days
   * in a seven-column grid. The resolver decided which days exist and what pressing
   * one does; this only draws them, which is why the leading blanks arrive as cells
   * with no label rather than being counted here.
   */
  private dateEditor(view: ViewValue, path: string, origin: object): LayoutElement {
    const title = stringArg(labelled(view.args, 'title')) ?? ''
    const [back, forward, ...days] = view.children

    const header: LayoutElement = {
      kind: 'stack',
      id: `${path}hdr`,
      axis: 'horizontal',
      spacing: 8,
      alignment: CENTER,
      children: [
        { kind: 'modified', id: `${path}month-fit`, modifier: { kind: 'fixedSize', horizontal: true, vertical: false }, child: this.styledText(`${path}month`, title, 'headline', 'label') },
        { kind: 'spacer', id: `${path}gap`, axis: 'horizontal', minLength: 8 },
        ...(back ? [this.convert(back, `${path}back`, 'horizontal')] : []),
        ...(forward ? [this.convert(forward, `${path}fwd`, 'horizontal')] : []),
      ],
    }

    const weekdays: LayoutElement = {
      kind: 'stack',
      id: `${path}dow`,
      axis: 'horizontal',
      spacing: 0,
      alignment: CENTER,
      children: WEEKDAYS.map((day, i) => ({
        kind: 'modified',
        id: `${path}dow${i}f`,
        modifier: { kind: 'frame', maxWidth: Number.POSITIVE_INFINITY, alignment: CENTER },
        child: this.styledText(`${path}dow${i}`, day, 'caption', 'secondaryLabel'),
      })),
    }

    const rows: LayoutElement[] = []
    for (let start = 0; start < days.length; start += 7) {
      const week = days.slice(start, start + 7)
      rows.push({
        kind: 'stack',
        id: `${path}w${start}`,
        axis: 'horizontal',
        spacing: 0,
        alignment: CENTER,
        children: week.map((day, i) => ({
          kind: 'modified' as const,
          id: `${path}w${start}c${i}f`,
          modifier: {
            kind: 'frame' as const,
            maxWidth: Number.POSITIVE_INFINITY,
            alignment: CENTER,
          },
          child: this.convert(day, `${path}w${start}c${i}`, 'horizontal'),
        })),
      })
    }

    return {
      kind: 'modified',
      id: `${path}pad`,
      modifier: { kind: 'padding', insets: uniformInsets(12) },
      child: {
        kind: 'stack',
        id: path,
        axis: 'vertical',
        spacing: 8,
        alignment: CENTER,
        children: [header, weekdays, ...rows],
      },
      ...origin,
    }
  }

  /** One day of the calendar: the number, on a tinted disc when it is the chosen one. */
  private dateCell(view: ViewValue, path: string, origin: object): LayoutElement {
    const label = stringArg(labelled(view.args, 'label')) ?? ''
    const selected = truthyBinding(labelled(view.args, 'selected'))

    const text = this.styledText(
      `${path}t`,
      label,
      'body',
      selected ? 'systemBackground' : truthyBinding(labelled(view.args, 'enabled')) ? 'label' : 'tertiaryLabel',
    )

    const box: LayoutElement = {
      kind: 'modified',
      id: `${path}box`,
      modifier: { kind: 'frame', width: 32, height: 32, alignment: CENTER },
      child: text,
    }

    return selected
      ? { ...this.background(box, `${path}bg`, this.color('accentColor'), 16), ...origin }
      : { ...box, ...origin }
  }

  /** A `ColorPicker`'s palette: the named colours, four to a row. */
  private colourEditor(view: ViewValue, path: string, origin: object): LayoutElement {
    const rows: LayoutElement[] = []
    for (let start = 0; start < view.children.length; start += 4) {
      const row = view.children.slice(start, start + 4)
      rows.push({
        kind: 'stack',
        id: `${path}r${start}`,
        axis: 'horizontal',
        spacing: 12,
        alignment: CENTER,
        children: row.map((swatch, i) => this.convert(swatch, `${path}r${start}s${i}`, 'horizontal')),
      })
    }

    return {
      kind: 'modified',
      id: `${path}pad`,
      modifier: { kind: 'padding', insets: uniformInsets(this.appearance.metrics.padding) },
      child: {
        kind: 'stack',
        id: path,
        axis: 'vertical',
        spacing: 12,
        alignment: CENTER,
        children: rows,
      },
      ...origin,
    }
  }

  /** One swatch: the colour as a disc, ringed when it is the one selected. */
  private colourSwatch(view: ViewValue, path: string, origin: object): LayoutElement {
    const fill = resolveColorArg(labelled(view.args, 'colour'), this.scheme, this.styles.tint) ?? this.color('label')
    const selected = truthyBinding(labelled(view.args, 'selected'))

    const disc: LayoutElement = {
      kind: 'modified',
      id: `${path}f`,
      modifier: { kind: 'frame', width: 36, height: 36, alignment: CENTER },
      child: {
        kind: 'modified',
        id: `${path}c`,
        modifier: { kind: 'foregroundStyle', color: fill },
        child: { kind: 'shape', id: path, shape: 'circle' },
      },
    }

    if (!selected) return { ...disc, ...origin }

    return {
      kind: 'modified',
      id: `${path}ring`,
      modifier: {
        kind: 'border',
        color: this.color('label'),
        width: 2,
        cornerRadius: 22,
      },
      child: {
        kind: 'modified',
        id: `${path}ringpad`,
        modifier: { kind: 'padding', insets: uniformInsets(3) },
        child: disc,
      },
      ...origin,
    }
  }

  private divider(path: string, parentAxis: Axis, origin: object): LayoutElement {
    const line: LayoutElement = {
      kind: 'fill',
      pixelAligned: true,
      id: path,
      fill: { kind: 'solid', color: this.color('separator') },
      ...origin,
    }
    // A divider is a hairline *across* its stack's axis and greedy along it.
    return {
      kind: 'modified',
      id: `${path}line`,
      modifier:
        parentAxis === 'vertical'
          ? { kind: 'frame', height: this.separatorHeight, alignment: CENTER }
          : { kind: 'frame', width: this.separatorHeight, alignment: CENTER },
      child: line,
    }
  }

  private scrollView(view: ViewValue, path: string, origin: object): LayoutElement {
    const axisToken = tokenName(positional(view.args, 0))
    const axis: Axis = axisToken === 'horizontal' ? 'horizontal' : 'vertical'
    const indicators = this.styles.scrollIndicators === 'hidden' ? false : this.styles.scrollIndicators === 'visible' ? true : boolArg(labelled(view.args, 'showsIndicators')) ?? true

    const children = this.convertList(view.children, path, axis)
    const content: LayoutElement =
      children.length === 1
        ? children[0]!
        : {
            kind: 'stack',
            id: `${path}content`,
            axis,
            spacing: 0,
            alignment: axis === 'vertical' ? { horizontal: 'center', vertical: 'top' } : CENTER,
            children,
          }

    return { kind: 'scroll', id: path, axis, showsIndicators: indicators, content, ...origin }
  }

  /**
   * A `List` or a `Form`.
   *
   * Both are a scroll view of rows with system chrome: hairline separators inset from
   * the leading edge, a 44pt minimum row height, and - in the grouped styles - each
   * section as a rounded card on a tinted background. Building it from the same
   * primitives as everything else means a list row obeys the same layout rules as any
   * other view, which is the behaviour people actually rely on.
   */
  private list(view: ViewValue, path: string, origin: object): LayoutElement {
    this.listDepth++
    try {
      return this.listBody(view, path, origin)
    } finally {
      this.listDepth--
    }
  }

  private listBody(view: ViewValue, path: string, origin: object): LayoutElement {
    return buildList(view, path, origin, {
      width: this.viewportWidth, scheme: this.scheme, tint: this.styles.tint, showsIndicators: this.styles.scrollIndicators !== 'hidden',
      captionFont: fontForToken('footnote', this.typeScale)!,
      headerFont: fontForToken('headline', this.typeScale)!,
      separatorHeight: 1,
      convert: (v, id) => this.convert(v, id, 'horizontal'),
      swipe: (v, content, id) => this.swipeableRow(v, content, id),
      text: (id, text, style, color, weight) => this.styledText(id, text, style, color, weight),
      color: name => this.color(name),
      background: (child, id, color, radius) => this.background(child, id, color, radius),
    })
  }

  /** `Grid { GridRow { … } }` - the two-dimensional form, aligned across rows. */
  private table(view: ViewValue, path: string, origin: object): LayoutElement {
    const flattened = view.children.flatMap((child) =>
      child.name === 'ForEach' ? child.children : [child],
    )

    const rows = flattened.map((row, index) =>
      row.name === 'GridRow'
        ? this.convertList(row.children, row.path ?? `${path}-${index}`, 'horizontal')
        : [this.convert(row, row.path ?? `${path}-${index}`, 'horizontal')],
    )

    return {
      kind: 'table',
      id: path,
      rows,
      spacing: numberArg(labelled(view.args, 'horizontalSpacing')) ?? defaultSpacing(),
      rowAlignments: flattened.map(row => labelled(row.args, 'alignment') ? stackAlignment(row.args, 'horizontal').vertical : stackAlignment(view.args, 'vertical').vertical),
      rowSpacing: numberArg(labelled(view.args, 'verticalSpacing')) ?? (flattened.every(row => row.name === 'GridRow' && row.children.every(cell => cell.name === 'Text')) ? 0 : defaultSpacing()),
      alignment: stackAlignment(view.args, 'vertical'),
      ...origin,
    }
  }

  /**
   * A row that can be swiped to reveal a delete action.
   *
   * The action sits *behind* the row and the row slides over it, which is how iOS
   * does it and why the offset is a paint-time translation rather than a layout
   * change: the row keeps its place in the list while it moves.
   */
  private swipeableRow(view: ViewValue, content: LayoutElement, path: string): LayoutElement {
    const swipe = view.swipe!
    const offset = swipe.offset

    const action = this.withHitTarget(
      this.background(
        {
          kind: 'modified',
          id: `${path}delframe`,
          modifier: { kind: 'frame', width: SWIPE_WIDTH, alignment: CENTER },
          child: {
            kind: 'modified',
            id: `${path}delcolor`,
            modifier: { kind: 'foregroundStyle', color: rgba(255, 255, 255) },
            child: { kind: 'text', id: `${path}deltext`, text: 'Delete' },
          },
        },
        `${path}delbg`,
        this.color('red'),
      ),
      `${swipe.path}/delete`,
      'button',
      'Delete',
    )

    const sliding: LayoutElement = {
      kind: 'modified',
      id: `${path}swipeoffset`,
      modifier: { kind: 'offset', x: -offset, y: 0 },
      child: content,
    }

    return this.withHitTarget(
      {
        kind: 'zstack',
        id: `${path}swipe`,
        alignment: { horizontal: 'trailing', vertical: 'center' },
        children: offset > 0 ? [action, sliding] : [sliding],
      },
      `${swipe.path}/swipe`,
      'drag',
      'Swipe row',
    )
  }

  private grid(view: ViewValue, path: string, origin: object): LayoutElement {
    const vertical = view.name === 'LazyVGrid'
    const tracks = gridTracks(labelled(view.args, vertical ? 'columns' : 'rows'))
    const spacing = numberArg(labelled(view.args, 'spacing')) ?? 8

    return {
      kind: 'grid',
      id: path,
      axis: vertical ? 'vertical' : 'horizontal',
      tracks,
      spacing,
      trackSpacing: 8,
      alignment: alignmentFromToken(labelled(view.args, 'alignment')) ?? CENTER,
      children: this.convertList(view.children, path, vertical ? 'vertical' : 'horizontal'),
      ...origin,
    }
  }

  // --------------------------------------------------------------- controls

  private image(view: ViewValue, path: string, origin: object): LayoutElement {
    const systemName = stringArg(labelled(view.args, 'systemName'))
    const assetName = stringArg(positional(view.args, 0))
    const resizable = view.modifiers.some((m) => m.name === 'resizable')

    if (systemName === null && assetName !== null) {
      const image = this.images.find(image => image.name === assetName)
      const url = image && (this.scheme === 'dark' ? image.dark ?? image.light : image.light)
      if (image && url && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(url)) return {
        kind: 'image', id: path, glyph: '', resizable, approximated: false,
        bitmap: { url, name: assetName, width: image.width, height: image.height }, ...origin,
      }
      return {
        kind: 'placeholder',
        id: path,
        placeholder: { kind: 'missing', feature: assetName },
        ...origin,
      }
    }

    const symbol = resolveSymbol(systemName ?? '')
    return {
      kind: 'image',
      id: path,
      glyph: symbol.glyph,
      symbolScale: this.styles.imageScale === 'small' ? 0.8 : this.styles.imageScale === 'large' ? 1.3 : 1,
      resizable,
      approximated: symbol.approximated,
      ...(systemName ? { symbol: systemName } : {}),
      ...origin,
      ...(systemName ? { debugName: `Image(systemName: "${systemName}")` } : {}),
    }
  }

  private label(view: ViewValue, path: string, origin: object): LayoutElement {
    const title = stringArg(positional(view.args, 0))
    const systemImage = stringArg(labelled(view.args, 'systemImage'))
    const symbol = systemImage ? resolveSymbol(systemImage) : null

    // `.labelStyle` decides which halves are drawn. `.titleAndIcon` is the default
    // and needs no branch; the other two drop a half that is still exported.
    const style = this.styles.label
    const wantsIcon = style !== 'titleOnly'
    const wantsTitle = style !== 'iconOnly'

    const children: LayoutElement[] = []
    if (symbol && wantsIcon) {
      children.push({
        kind: 'image',
        id: `${path}icon`,
        glyph: symbol.glyph,
      symbolScale: this.styles.imageScale === 'small' ? 0.8 : this.styles.imageScale === 'large' ? 1.3 : 1,
        resizable: false,
        approximated: symbol.approximated,
        ...(systemImage ? { symbol: systemImage } : {}),
      })
    }
    if (this.listDepth > 0 && children[0]) children[0] = {
      kind: 'modified', id: `${path}icon-column`, modifier: { kind: 'frame', width: 32, alignment: { horizontal: 'leading', vertical: 'center' } },
      child: { kind: 'modified', id: `${path}icon-tint`, modifier: { kind: 'foregroundStyle', color: this.color('accentColor') }, child: children[0] },
    }
    if (title !== null && wantsTitle) children.push({ kind: 'text', id: `${path}title`, text: title })
    if (wantsTitle || !symbol) children.push(...this.convertList(view.children, path, 'horizontal'))

    return {
      kind: 'stack',
      id: path,
      axis: 'horizontal',
      spacing: this.listDepth > 0 ? 8 : 6,
      alignment: CENTER,
      children,
      ...origin,
    }
  }

  private button(view: ViewValue, path: string, origin: object): LayoutElement {
    const iconLabel = titleAndIconLabel(view)
    const title = iconLabel ? null : stringArg(positional(view.args, 0))
    // `Button { save() } label: { … }` puts the content in a labelled argument,
    // because the unlabelled trailing closure is already the action.
    const content = iconLabel ? [iconLabel] : view.children.length > 0 ? view.children : argViews(view, 'label')
    const label: LayoutElement =
      title !== null
        ? { kind: 'text', id: `${path}label`, text: title, ...origin }
        : {
            kind: 'stack',
            id: `${path}label`,
            axis: 'horizontal',
            spacing: 4,
            alignment: CENTER,
            children: this.convertList(content, `${path}label`, 'horizontal'),
            ...origin,
          }

    const m = controlMetrics(this.styles.controlSize)
    const base = bodyFont(this.typeScale)
    const font = { ...base, size: Math.max(12, m.fontSize + base.size - 17),
      lineHeight: m.lineHeight + base.lineHeight - 22, weight: this.alertCancelWeight ? 600 : m.weight }
    const styled = controlFont(label, font)

    return this.applyButtonStyle(view, styled, path)
  }

  /**
   * The colour a button's label takes.
   *
   * `role: .destructive` is red, and `.tint(_:)` overrides the accent. The role used
   * to be dropped entirely - `grep destructive` over the whole of `packages/` found
   * one unrelated comment - so "Delete" and "Cancel" were the same colour in a form,
   * in an alert, in a confirmation dialog and in a swipe action, which is the one
   * place a colour is load-bearing rather than decorative.
   */
  private buttonTint(view: ViewValue): RGBA {
    if (tokenName(labelled(view.args, 'role')) === 'destructive') return this.color('red')
    return resolveColorArg(modifierArg(view, 'tint', 0), this.scheme, this.styles.tint) ?? this.color('accentColor')
  }

  /**
   * `.bordered` and `.borderedProminent` are shape-and-fill; the rest is a tint.
   *
   * A button's label is the accent colour in SwiftUI, and that is most of what makes
   * an iOS screen look like one: the blue is how you can tell what is pressable. This
   * returned the label untouched for `.automatic`, `.borderless` and `.plain` - three
   * of the five styles, and the two defaults - so every button, every toolbar item
   * and every alert button was drawn in the label colour.
   *
   * `.plain` is the one that genuinely keeps the inherited foreground, and it is why
   * this cannot simply tint everything: `.plain` exists precisely to opt out.
   */
  private applyButtonStyle(view: ViewValue, label: LayoutElement, path: string): LayoutElement {
    if (modifierArg(view, 'buttonStyle', 0)?.kind === 'struct') return label
    const requested = this.styles.button ?? 'automatic'
    const style = requested === 'automatic' ? this.appearance.button.automatic[this.styles.container ?? 'content'] : requested
    const tint = this.buttonTint(view)

    if (style !== 'bordered' && style !== 'borderedProminent' && style !== 'glass' && style !== 'glassProminent') {
      if (style === 'plain') return label
      return {
        kind: 'modified',
        id: `${path}btntint`,
        modifier: { kind: 'foregroundStyle', color: tint },
        child: label,
      }
    }

    const cornerStyle = this.styles.buttonBorderShape === 'roundedRectangle' ? 'continuous' as const : 'circular' as const
    const prominent = style === 'borderedProminent' || style === 'glassProminent'
    const glass = style === 'glass' || style === 'glassProminent'

    const metrics = controlMetrics(this.styles.controlSize)
    const padV = this.styles.container === 'toolbar' ? 11 : metrics.padY
    const padH = this.styles.container === 'toolbar' ? 16 : metrics.padX

    const radius = this.styles.buttonBorderShape === 'roundedRectangle'
      ? this.appearance.button.roundedRectangleRadius
      : this.appearance.button.cornerRadius

    const tinted: LayoutElement = {
      kind: 'modified',
      id: `${path}btncolor`,
      modifier: {
        kind: 'foregroundStyle',
        color: prominent ? rgba(255, 255, 255) : tint,
      },
      child: label,
    }

    let padded: LayoutElement = {
      kind: 'modified',
      id: `${path}btnpad`,
      modifier: { kind: 'padding', insets: insets(padV, padH, padV, padH) },
      child: tinted,
    }

    if (this.styles.buttonBorderShape === 'circle') {
      padded = { kind: 'modified', id: `${path}circle-size`, modifier: { kind: 'square' }, child: padded }
    }

    // Through the helper, which puts the radius *outside* the background. Written
    // inside-out here until now, and a corner radius only reaches a fill through the
    // inherited environment - so a bordered button has been drawing square corners
    // since the style was added, which no test asserted either way.
    if (glass) {
      const background: LayoutElement = {
        kind: 'modified', id: `${path}glass`,
        modifier: { kind: 'material', ...this.appearance.materials.thinMaterial!, light: this.scheme === 'light' },
        child: { kind: 'empty', id: `${path}glassbox` },
      }
      const surface: LayoutElement = {
        kind: 'modified', id: `${path}glassbg`,
        modifier: { kind: 'background', content: background },
        child: prominent ? this.background(padded, `${path}btn`, { ...tint, a: tint.a * 0.85 }, radius, cornerStyle) : padded,
      }
      return { kind: 'modified', id: `${path}glassclip`, modifier: { kind: 'cornerRadius', radius, style: cornerStyle }, child: this.chromeOutline(surface, `${path}outline`, radius) }
    }
    return this.background(
      padded,
      `${path}btn`,
      prominent ? tint : { ...tint, a: tint.a * (this.scheme === 'dark' ? 0.25 : 0.18) },
      radius,
      cornerStyle,
    )
  }

  private navigationLink(view: ViewValue, path: string, origin: object): LayoutElement {
    const title = stringArg(positional(view.args, 0))
    const label: LayoutElement =
      title !== null
        ? { kind: 'text', id: `${path}label`, text: title }
        : {
            kind: 'stack',
            id: `${path}label`,
            axis: 'horizontal',
            spacing: 6,
            alignment: CENTER,
            children: this.convertList(view.children, `${path}label`, 'horizontal'),
          }

    // The disclosure chevron is what makes a link legible as one - inside a list.
    // Outside one, iOS 27 draws a `NavigationLink` as it draws a button: tinted,
    // unless its style is `.plain`, which is how a card wrapped in one keeps its look
    // (measured in the simulator for D16).
    if (this.listDepth === 0) {
      return {
        kind: 'stack',
        id: path,
        axis: 'horizontal',
        spacing: 0,
        alignment: CENTER,
        children: [this.applyButtonStyle(view, label, path)],
        ...origin,
      }
    }

    return {
      kind: 'stack',
      id: path,
      axis: 'horizontal',
      spacing: 8,
      alignment: CENTER,
      children: [
        { kind: 'modified', id: `${path}labelwidth`, modifier: { kind: 'frame', maxWidth: Infinity, alignment: { horizontal: 'leading', vertical: 'center' } }, child: label },
        {
          kind: 'modified',
          id: `${path}chevcolor`,
          modifier: { kind: 'foregroundStyle', color: this.color('tertiaryLabel') },
          child: {
            kind: 'modified',
            id: `${path}chevfont`,
            modifier: { kind: 'font', font: fontForToken('footnote', 'large')! },
            child: this.symbolImage(`${path}chev`, 'chevron.right'),
          },
        },
      ],
      ...origin,
    }
  }

  private backButton(_view: ViewValue, path: string, origin: object): LayoutElement {
    const icon: LayoutElement = { kind: 'modified', id: `${path}size`,
      modifier: { kind: 'frame', width: 44, height: 44, alignment: CENTER },
      child: { kind: 'modified', id: `${path}font`, modifier: { kind: 'font', font: { ...bodyFont('large'), size: 24, lineHeight: 28, weight: 600 } },
        child: { kind: 'modified', id: `${path}tint`, modifier: { kind: 'foregroundStyle', color: this.color('label') }, child: this.symbolImage(`${path}chev`, 'chevron.left') } }, ...origin }
    return { kind: 'modified', id: `${path}round`, modifier: { kind: 'cornerRadius', radius: 22 },
      child: this.chromeOutline({ kind: 'modified', id: `${path}surface`, modifier: { kind: 'material', ...this.appearance.materials.thinMaterial!, light: this.scheme === 'light' }, child: icon }, `${path}outline`, 22) }
  }

  private toggle(view: ViewValue, path: string, origin: object): LayoutElement {
    const on = truthyBinding(labelled(view.args, 'isOn'))
    const iconLabel = titleAndIconLabel(view)
    const title = iconLabel ? null : stringArg(positional(view.args, 0))
    const style = this.styles.toggle

    const label: LayoutElement =
      title !== null
        ? { kind: 'text', id: `${path}label`, text: title }
        : {
            kind: 'stack',
            id: `${path}label`,
            axis: 'horizontal',
            spacing: 6,
            alignment: CENTER,
            children: this.convertList(iconLabel ? [iconLabel] : view.children, `${path}label`, 'horizontal'),
          }

    const track = switchControl(path, on, this.styles.tint ?? this.color('green'), this.color('tertiarySystemFill'))

    // `.button` is the toggle drawn as a control that stays pressed - iOS tints the
    // whole thing while it is on - so there is no track at all, and `.checkbox` puts a
    // box where the switch was and leads with it rather than trailing.
    if (style === 'button') {
      const tinted: LayoutElement = {
        kind: 'modified',
        id: `${path}btncolor`,
        modifier: {
          kind: 'foregroundStyle',
          color: on ? this.color('accentColor') : this.color('label'),
        },
        child: label,
      }
      return {
        kind: 'modified', id: `${path}button-capsule`, modifier: { kind: 'cornerRadius', radius: 999, style: 'circular' }, child: {
        kind: 'modified',
        id: `${path}btnbg`,
        modifier: {
          kind: 'background',
          content: {
            kind: 'fill',
            id: `${path}btnfill`,
            fill: {
              kind: 'solid',
              color: on
                ? { ...this.color('accentColor'), a: this.scheme === 'dark' ? 0.2 : 0.18 }
                : this.color('systemFill'),
            },
          },
        },
        child: {
          kind: 'modified',
          id: `${path}btnradius`,
          modifier: { kind: 'cornerRadius', radius: 999, style: 'circular' },
          child: {
            kind: 'modified',
            id: `${path}btnpad`,
            modifier: { kind: 'padding', insets: insets(6, 12, 6, 12) },
            child: tinted,
          },
        },
        ...origin,
      } }
    }

    if (style === 'checkbox') {
      const box: LayoutElement = {
        kind: 'modified',
        id: `${path}boxframe`,
        modifier: { kind: 'frame', width: 20, height: 20, alignment: CENTER },
        child: {
          kind: 'modified',
          id: `${path}boxcolor`,
          modifier: {
            kind: 'foregroundStyle',
            color: on ? this.color('accentColor') : this.color('secondaryLabel'),
          },
          child: this.symbolImage(`${path}box`, on ? 'checkmark.square' : 'square'),
        },
      }
      return {
        kind: 'stack',
        id: path,
        axis: 'horizontal',
        spacing: 8,
        alignment: CENTER,
        children: [box, label],
        ...origin,
      }
    }

    return {
      kind: 'stack',
      id: path,
      axis: 'horizontal',
      spacing: 8,
      alignment: CENTER,
      children: [label, { kind: 'spacer', id: `${path}gap`, axis: 'horizontal', minLength: 8 }, track],
      ...origin,
    }
  }

  private textField(view: ViewValue, path: string, origin: object): LayoutElement {
    if (view.name === 'TextEditor') return {
      kind: 'modified', id: `${path}frame`,
      modifier: { kind: 'frame', minWidth: 44, maxWidth: Infinity, minHeight: 88, maxHeight: Infinity, alignment: CENTER },
      child: { kind: 'empty', id: `${path}inner` }, ...origin,
    }
    const bordered = this.styles.textField === 'roundedBorder'
    const m = CONTROL_PARTS.field
    const box: LayoutElement = {
      kind: 'modified', id: `${path}frame`,
      modifier: { kind: 'inputFrame', minHeight: bordered ? m.height : 22, paddingY: bordered ? m.insetY : 0 },
      child: { kind: 'empty', id: `${path}inner` }, ...origin,
    }
    if (!bordered) return box
    return { kind: 'modified', id: `${path}border`,
      modifier: { kind: 'border', color: this.color('separator'), width: this.separatorHeight, cornerRadius: m.radius }, child: box }
  }

  private slider(view: ViewValue, path: string, origin: object): LayoutElement {
    const state = this.controlState(view)
    const min = state.min ?? 0, max = state.max ?? 1, value = Number(state.value ?? 0)
    const ticks = state.step && max > min ? Math.floor((max - min) / state.step) : 0
    return { kind: 'slider', id: path, height: CONTROL_PARTS.slider.height,
      style: { fraction: max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0,
        trackHeight: CONTROL_PARTS.slider.track, thumbDiameter: CONTROL_PARTS.slider.thumb, thumbHeight: CONTROL_PARTS.slider.thumbHeight,
        tint: this.color('accentColor'), trackColor: this.color('tertiarySystemFill'), thumbColor: rgba(255, 255, 255),
        ...(ticks > 0 && ticks <= 20 ? { ticks: Array.from({ length: ticks + 1 }, (_, i) => i * state.step! / (max - min)) } : {}),
      }, ...origin }
  }

  private stepper(view: ViewValue, path: string, origin: object): LayoutElement {
    const title = stringArg(positional(view.args, 0))
    const label: LayoutElement =
      title !== null
        ? { kind: 'text', id: `${path}label`, text: title }
        : {
            kind: 'stack',
            id: `${path}label`,
            axis: 'horizontal',
            spacing: 6,
            alignment: CENTER,
            children: this.convertList(view.children, `${path}label`, 'horizontal'),
          }

    const bound = numberArg(bindingValue(labelled(view.args, 'value')) ?? undefined)
    const range = labelled(view.args, 'in')
    const lower = range?.kind === 'range' ? range.lower : -Infinity
    const upper = range?.kind === 'range' ? range.upper - (range.closed ? 0 : 1) : Infinity
    const side = (symbol: string, title: string, atLimit: boolean): LayoutElement => {
      let glyph = this.glyphButton(`${path}${symbol}`, symbol)
      const disabled = disabledBy(view) || atLimit
      if (atLimit || isDisabled(view)) glyph = {
        kind: 'modified', id: `${path}${symbol}dim`, modifier: { kind: 'opacity', value: 0.35 }, child: glyph,
      }
      return this.withHitTarget(glyph, `${path}/${symbol}`, 'button', title, view, disabled)
    }

    const control = this.background(
      {
        kind: 'modified',
        id: `${path}ctrlframe`,
        modifier: { kind: 'frame', width: CONTROL_PARTS.stepper.width, height: CONTROL_PARTS.stepper.height, alignment: CENTER },
        child: {
          kind: 'stack',
          id: `${path}ctrl`,
          axis: 'horizontal',
          spacing: 0,
          alignment: CENTER,
          children: [
            // Each half is its own target. A Stepper is one view with two presses,
            // so a single hit target over the whole control could only ever guess
            // which one the user meant - it was drawn with both halves and answered
            // to neither. The paths match the ones the resolver registered.
            side('minus', 'Decrement', bound !== null && bound <= lower),
            {
              kind: 'modified',
              id: `${path}divframe`,
              modifier: { kind: 'frame', width: this.separatorHeight, height: CONTROL_PARTS.stepper.separator, alignment: CENTER },
              child: { kind: 'fill', id: `${path}div`, fill: { kind: 'solid', color: this.color('separator') } },
            },
            side('plus', 'Increment', bound !== null && bound >= upper),
          ],
        },
      },
      `${path}ctrlbg`,
      this.color('tertiarySystemFill'),
      CONTROL_PARTS.stepper.radius,
    )

    return {
      kind: 'stack',
      id: path,
      axis: 'horizontal',
      spacing: 8,
      alignment: CENTER,
      children: [label, { kind: 'spacer', id: `${path}gap`, axis: 'horizontal', minLength: 8 }, control],
      ...origin,
    }
  }

  private glyphButton(id: string, symbol: string): LayoutElement {
    return {
      kind: 'modified',
      id: `${id}frame`,
      modifier: { kind: 'frame', width: (CONTROL_PARTS.stepper.width - this.separatorHeight) / 2, height: CONTROL_PARTS.stepper.height, alignment: CENTER },
      // Also through `symbolImage`. A `Stepper` built its minus and plus inline and so
      // drew the Unicode characters where the shape table has both.
      child: this.symbolImage(id, symbol),
    }
  }

  private progressView(view: ViewValue, path: string, origin: object): LayoutElement {
    const value = numberArg(labelled(view.args, 'value'))
    const total = numberArg(labelled(view.args, 'total')) ?? 1
    const title = stringArg(positional(view.args, 0))

    // `.progressViewStyle(.circular)` is a ring whatever the value, which is what iOS
    // draws: the determinate bar is the `.linear` style, and asking for the circular
    // one with a value in hand still gets a ring rather than the bar.
    if (value === null || this.styles.progressView === 'circular') {
      // Indeterminate: the activity indicator, eight spokes turning. This was a filled
      // grey circle, which is not an approximation of a spinner - it is a dot.
      return {
        kind: 'modified',
        id: `${path}frame`,
        modifier: { kind: 'frame', width: CONTROL_PARTS.progress.spinner, height: CONTROL_PARTS.progress.spinner, alignment: CENTER },
        child: {
          kind: 'modified',
          id: `${path}color`,
          modifier: { kind: 'foregroundStyle', color: this.color('secondaryLabel') },
          child: { kind: 'shape', id: path, shape: 'spinner', ...origin },
        },
      }
    }

    const fraction = total === 0 ? 0 : Math.max(0, Math.min(1, value / total))
    const bar: LayoutElement = {
      kind: 'modified',
      id: `${path}barframe`,
      modifier: { kind: 'frame', maxWidth: Number.POSITIVE_INFINITY, height: CONTROL_PARTS.progress.height, alignment: CENTER },
      child: {
        kind: 'zstack',
        id: `${path}bar`,
        alignment: { horizontal: 'leading', vertical: 'center' },
        children: [
          {
            kind: 'modified',
            id: `${path}trackround`,
            modifier: { kind: 'cornerRadius', radius: CONTROL_PARTS.progress.radius },
            child: { kind: 'fill', id: `${path}track`, fill: { kind: 'solid', color: this.color('systemFill') } },
          },
          {
            // A real width rather than a horizontal scale. Scaling drew the fill from
            // the middle of the track outwards, because CSS scales about the centre
            // and nothing set an origin, and it flattened the rounded cap at the end
            // of the bar into an ellipse on the way.
            kind: 'modified',
            id: `${path}fillframe`,
            modifier: { kind: 'relativeWidth', fraction },
            child: {
              kind: 'modified',
              id: `${path}fillround`,
              modifier: { kind: 'cornerRadius', radius: CONTROL_PARTS.progress.radius },
              child: { kind: 'fill', id: `${path}fill`, fill: { kind: 'solid', color: this.color('accentColor') } },
            },
          },
        ],
      },
      ...origin,
    }

    if (title === null) return bar
    return {
      kind: 'stack',
      id: `${path}stack`,
      axis: 'vertical',
      spacing: 3,
      alignment: { horizontal: 'leading', vertical: 'center' },
      children: [this.styledText(`${path}title`, title, 'body', 'label'), bar],
    }
  }

  private picker(view: ViewValue, path: string, origin: object): LayoutElement {
    const title = stringArg(positional(view.args, 0)) ?? argText(view, 'label') ?? ''
    const selection = bindingValue(labelled(view.args, 'selection'))
    // A `DatePicker` shows a *formatted* date, which is the whole point of the row.
    // `displayValue` on a Date gives `2025-06-15 15:06:40 +0000` - a plausible-looking
    // string no date picker on iOS has ever shown - and `displayedComponents:` says
    // which halves of it to draw.
    const date = view.name === 'DatePicker' ? asDate(selection ?? undefined) : null
    const selectedOption = view.name === 'Picker' ? view.children.find(child => boolArg(labelled(child.args, 'selected'))) : undefined
    // A Picker shows the chosen row's content, and nothing when no row's tag matches
    // its selection, as iOS 27 does: never the raw value, which isn't what iOS draws.
    const value = selectedOption ? textIn(selectedOption).join(' ') : date
      ? dateText(date.epochSeconds, datePickerStyleFor(view))
      : selection && view.name !== 'Picker'
        ? displayValue(selection)
        : ''

    // Only a real `Picker` has options to draw inline; `DatePicker`, `ColorPicker` and
    // `Menu` come through here too and have none.
    if (view.name === 'Picker') {
      const style = this.styles.picker
      if (style === 'segmented') return this.segmentedPicker(view, path, origin)
      if (style === 'inline' || style === 'wheel') {
        return this.inlinePicker(view, path, origin, style === 'wheel')
      }
    }

    return {
      kind: 'stack',
      id: path,
      axis: 'horizontal',
      spacing: 8,
      alignment: CENTER,
      children: [
        { kind: 'text', id: `${path}label`, text: title },
        { kind: 'spacer', id: `${path}gap`, axis: 'horizontal', minLength: 8 },
        {
          kind: 'modified',
          id: `${path}valuecolor`,
          modifier: { kind: 'foregroundStyle', color: this.color('secondaryLabel') },
          child: {
            kind: 'stack',
            id: `${path}value`,
            axis: 'horizontal',
            spacing: 4,
            alignment: CENTER,
            children: [
              { kind: 'text', id: `${path}valuetext`, text: value },
              this.symbolImage(`${path}chev`, 'chevron.up.chevron.down'),
            ],
          },
        },
      ],
      ...origin,
    }
  }

  /**
   * `.pickerStyle(.segmented)` - every option on screen, the chosen one on a pill.
   *
   * The options are the views the user wrote, and each gets the target the resolver
   * registered for it, so pressing a segment writes the binding exactly as choosing
   * from the popup does. A segmented control whose segments were not pressable would
   * be the same lie the popup was before the controls pass.
   */
  private segmentedPicker(view: ViewValue, path: string, origin: object): LayoutElement {
    const segments = view.children.map((child, index) => {
      const chosen = truthyBinding(labelled(child.args, 'selected'))
      const content: LayoutElement = {
        kind: 'modified',
        id: `${path}seg${index}f`,
        // 13pt, and semibold on the chosen one. `subheadline` at 15 regular was two
        // points large and made a three-segment control run wider than iOS draws it.
        modifier: {
          kind: 'font',
          font: { ...fontForToken('footnote', this.typeScale)!, weight: chosen ? 600 : 400 },
        },
        child: {
          kind: 'modified',
          id: `${path}seg${index}pad`,
          modifier: { kind: 'padding', insets: insets(CONTROL_PARTS.segmented.padY, CONTROL_PARTS.segmented.padX, CONTROL_PARTS.segmented.padY, CONTROL_PARTS.segmented.padX) },
          child: {
            kind: 'modified',
            id: `${path}seg${index}w`,
            modifier: {
              kind: 'frame',
              maxWidth: Number.POSITIVE_INFINITY,
              alignment: CENTER,
            },
            child: this.convert(child, `${path}seg${index}c`, 'horizontal'),
          },
        },
      }

      const pill = chosen ? this.background(content, `${path}seg${index}bg`,
        this.scheme === 'dark' ? rgba(105, 105, 111) : rgba(255, 255, 255),
        CONTROL_PARTS.segmented.selectedRadius, 'circular') : content

      return this.withHitTarget(
        pill,
        `${path}/seg-${index}`,
        'button',
        textIn(child).join(' '),
        child,
        disabledBy(view) || disabledBy(child),
      )
    })

    const row: LayoutElement = {
      kind: 'stack',
      id: `${path}segs`,
      axis: 'horizontal',
      spacing: 0,
      alignment: CENTER,
      children: segments,
    }

    return {
      ...this.background(
        { kind: 'modified', id: `${path}segpad`, modifier: { kind: 'padding', insets: uniformInsets(CONTROL_PARTS.segmented.inset) }, child: row },
        `${path}segtrack`,
        // `tertiarySystemFill`, which is the track iOS draws. `systemFill` is nearly
        // twice as dark and made the control look like a filled box.
        this.scheme === 'dark' ? rgba(49, 49, 54) : rgba(238, 238, 239),
        CONTROL_PARTS.segmented.radius, 'circular',
      ),
      ...origin,
    }
  }

  /**
   * `.pickerStyle(.inline)` and `.wheel` - the options as a column.
   *
   * `.inline` is exact: iOS lists the options in place and ticks the chosen one. The
   * wheel is not - a spinner has depth, momentum and a selection band, none of which
   * a static column has - so it is drawn as the same column with the chosen row
   * emphasised, and the matrix says so rather than leaving it to be discovered.
   */
  private inlinePicker(
    view: ViewValue,
    path: string,
    origin: object,
    wheel: boolean,
  ): LayoutElement {
    const rows = view.children.map((child, index) => {
      const chosen = truthyBinding(labelled(child.args, 'selected'))

      const label = this.convert(child, `${path}opt${index}c`, 'horizontal')
      const tick: LayoutElement = chosen
        ? {
            kind: 'modified',
            id: `${path}opt${index}tk`,
            modifier: { kind: 'foregroundStyle', color: this.color('accentColor') },
            child: this.symbolImage(`${path}opt${index}t`, 'checkmark'),
          }
        : { kind: 'empty', id: `${path}opt${index}t` }

      const row: LayoutElement = {
        kind: 'modified',
        id: `${path}opt${index}pad`,
        modifier: { kind: 'padding', insets: insets(11, 0, 11, 0) },
        child: {
          kind: 'stack',
          id: `${path}opt${index}`,
          axis: 'horizontal',
          spacing: 8,
          alignment: CENTER,
          children: wheel
            ? [
                {
                  kind: 'modified',
                  id: `${path}opt${index}w`,
                  modifier: { kind: 'frame', maxWidth: Number.POSITIVE_INFINITY, alignment: CENTER },
                  child: label,
                },
              ]
            : [
                label,
                { kind: 'spacer', id: `${path}opt${index}sp`, axis: 'horizontal', minLength: 8 },
                tick,
              ],
        },
      }

      // A wheel dims everything but the selection, which is the one thing about it a
      // static drawing can carry honestly.
      const shaded: LayoutElement =
        wheel && !chosen
          ? { kind: 'modified', id: `${path}opt${index}dim`, modifier: { kind: 'opacity', value: 0.45 }, child: row }
          : row

      return this.withHitTarget(
        shaded,
        `${path}/seg-${index}`,
        'button',
        textIn(child).join(' '),
        child,
        false,
      )
    })

    return {
      kind: 'stack',
      id: path,
      axis: 'vertical',
      spacing: 0,
      alignment: CENTER,
      children: rows,
      ...origin,
    }
  }

  /**
   * `AsyncImage` - the placeholder, always.
   *
   * A preview cannot fetch the image: there is no network in the worker, and adding
   * one would make the preview's output depend on something outside the project. What
   * it *can* do honestly is render exactly what the user wrote as `placeholder:`,
   * which is what a real device shows first anyway.
   */
  private asyncImage(view: ViewValue, path: string, origin: object): LayoutElement {
    const placeholder = view.modifiers.find((m) => m.name === 'placeholder')
    void placeholder

    const children = this.convertList(view.children, path, 'vertical')
    if (children.length > 0) {
      return {
        kind: 'zstack',
        id: path,
        alignment: CENTER,
        children,
        ...origin,
      }
    }

    return {
      kind: 'modified',
      id: `${path}bg`,
      modifier: {
        kind: 'background',
        content: {
          kind: 'fill',
          id: `${path}fill`,
          fill: { kind: 'solid', color: this.color('systemFill') },
        },
      },
      child: {
        kind: 'modified',
        id: `${path}round`,
        modifier: { kind: 'cornerRadius', radius: 6 },
        child: { kind: 'empty', id: path, ...origin },
      },
    }
  }

  /** `DisclosureGroup` - the label row with a chevron, and its content beneath. */
  /**
   * The panel a `Picker` or `Menu` shows when it is opened.
   *
   * One row per option, each pressable, with a tick beside the one currently chosen
   * - which is the only thing on screen reporting the value once the control itself
   * is covered. The rows are the views the user wrote inside the control; nothing
   * here is invented, which is the same rule the rest of the compositor follows.
   */
  private menuSurface(overlay: Overlay): LayoutElement {
    const rows = overlay.views.map((option, index) => {
      if (option.name === DATE_EDITOR || option.name === COLOUR_EDITOR) return this.convert(option, `ov-${index}`, 'vertical')
      // Embedded editors keep their own text/range event role and binding.
      if (['TextField', 'SecureField', 'Slider'].includes(option.name) && option.intent?.kind === 'write') return {
        kind: 'modified' as const, id: `ov-${index}-editor-pad`,
        modifier: { kind: 'padding' as const, insets: insets(12, 16, 12, 16) },
        child: this.convert(option, `ov-${index}`, 'horizontal'),
      }
      const selected = boolArg(labelled(option.args, 'selected'))

      // The hit target goes around the whole row rather than around the label, so
      // pressing anywhere on the row counts - including the empty space beside it.
      const content = this.convert({ ...option, intent: undefined }, `ov-${index}`, 'horizontal')

      const row: LayoutElement = {
        kind: 'modified',
        id: `ov-${index}-pad`,
        modifier: { kind: 'padding', insets: insets(11, 16, 11, 16) },
        child: {
          kind: 'stack',
          id: `ov-${index}-row`,
          axis: 'horizontal',
          spacing: 8,
          alignment: CENTER,
          children: [
            content,
            { kind: 'spacer', id: `ov-${index}-gap`, axis: 'horizontal', minLength: 8 },
            ...(selected
              ? [
                  {
                    kind: 'modified' as const,
                    id: `ov-${index}-tickcolor`,
                    modifier: { kind: 'foregroundStyle' as const, color: this.color('accentColor') },
                    child: this.symbolImage(`ov-${index}-tick`, 'checkmark'),
                  },
                ]
              : []),
          ],
        },
      }

      return option.path && option.intent
        ? this.withHitTarget(row, option.path, 'button', labelOf(option))
        : row
    })

    const separated: LayoutElement[] = []
    rows.forEach((row, index) => {
      if (index > 0) {
        separated.push({
          kind: 'modified',
          id: `ov-sep-${index}`,
          modifier: { kind: 'frame', height: this.separatorHeight, alignment: CENTER },
          child: {
            kind: 'fill',
            id: `ov-sepfill-${index}`,
            fill: { kind: 'solid', color: this.color('separator') },
          },
        })
      }
      separated.push(row)
    })

    return this.background(
      this.fill(
        {
          kind: 'stack',
          id: 'ov-stack',
          axis: 'vertical',
          spacing: 0,
          alignment: { horizontal: 'leading', vertical: 'center' },
          children: separated,
          debugName: MENU,
        },
        'ov-fill',
        CENTER,
        false,
      ),
      'ov-bg',
      this.color('secondarySystemGroupedBackground'),
      SURFACES.menu.radius,
    )
  }

  private disclosureGroup(view: ViewValue, path: string, origin: object): LayoutElement {
    const title = stringArg(positional(view.args, 0)) ?? ''
    // Stamped by the resolver, which owns the open/closed state. A group drawn
    // without one has not been through it, so it draws closed rather than guessing.
    const expanded = truthyBinding(labelled(view.args, 'isExpanded'))

    const row: LayoutElement = {
      kind: 'stack',
      id: `${path}row`,
      axis: 'horizontal',
      spacing: 8,
      alignment: CENTER,
      children: [
        { kind: 'text', id: `${path}title`, text: title },
        { kind: 'spacer', id: `${path}gap`, axis: 'horizontal', minLength: 8 },
        {
          kind: 'modified',
          id: `${path}chevcolor`,
          modifier: { kind: 'foregroundStyle', color: this.color('label') },
          // The chevron is the state: down when open, trailing when closed, which is
          // what iOS draws and the only thing on screen that says which it is.
          child: this.symbolImage(`${path}chev`, expanded ? 'chevron.down' : 'chevron.right'),
        },
      ],
    }

    if (this.listDepth > 0) return this.withHitTarget(row, `${path}/row`, 'button', title)
    return {
      kind: 'stack',
      id: path,
      axis: 'vertical',
      spacing: 8,
      alignment: { horizontal: 'leading', vertical: 'center' },
      children: [
        this.withHitTarget(row, `${path}/row`, 'button', title),
        ...this.convertList(view.children, path, 'vertical'),
      ],
      ...origin,
    }
  }

  /**
   * `ContentUnavailableView("No Results", systemImage: "magnifyingglass")`.
   *
   * The empty state, centred: a large symbol over a title over a description, all in
   * the secondary colour except the title. Drawn rather than placeholdered because it
   * is what a screen shows *before* it has anything to show, which makes it one of the
   * first things written and one of the first things looked at.
   *
   * `.search` is the stock spelling and carries its own text and symbol, so a screen
   * that writes it gets the same thing iOS gives it rather than an empty box.
   */
  private contentUnavailable(view: ViewValue, path: string, origin: object): LayoutElement {
    const written = stringArg(positional(view.args, 0))
    const symbolArg = stringArg(labelled(view.args, 'systemImage'))

    // `ContentUnavailableView.search` is a static member rather than a call, so it
    // arrives carrying nothing at all. No title and no symbol can only be that
    // spelling - the initialisers all take at least a label - and it stands for text
    // iOS supplies itself.
    const stock = written === null && symbolArg === null
    const title = written ?? (stock ? 'No Results' : '')
    const symbol = symbolArg ?? (stock ? 'magnifyingglass' : '')

    // `description:` takes a `Text`, not a string, so it arrives as a view.
    const describing = argViews(view, 'description')[0]
    const description = describing ? textIn(describing).join(' ') : ''

    const children: LayoutElement[] = []

    if (symbol) {
      children.push({
        kind: 'modified',
        id: `${path}iconf`,
        // 52pt, which is roughly where iOS lands it: large enough to be the thing you
        // see first, small enough not to become the subject.
        modifier: { kind: 'font', font: { ...bodyFont(this.typeScale), size: 52 * bodyFont(this.typeScale).size / 17 } },
        child: {
          kind: 'modified',
          id: `${path}iconc`,
          modifier: { kind: 'foregroundStyle', color: this.color('tertiaryLabel') },
          child: this.symbolImage(`${path}icon`, symbol),
        },
      })
    }

    if (title) children.push(this.styledText(`${path}title`, title, 'title2', 'label', 600))
    if (description) {
      children.push(this.styledText(`${path}desc`, description, 'body', 'secondaryLabel'))
    }

    return {
      kind: 'modified',
      id: `${path}fill`,
      modifier: {
        kind: 'frame',
        maxWidth: Number.POSITIVE_INFINITY,
        maxHeight: Number.POSITIVE_INFINITY,
        alignment: CENTER,
      },
      child: {
        kind: 'stack',
        id: path,
        axis: 'vertical',
        spacing: 8,
        alignment: CENTER,
        children,
        ...origin,
      },
    }
  }

  private gauge(view: ViewValue, path: string, origin: object): LayoutElement {
    const value = numberArg(bindingValue(labelled(view.args, 'value')) ?? undefined) ?? 0
    const range = labelled(view.args, 'in')
    const min = range?.kind === 'range' ? range.lower : 0
    const max = range?.kind === 'range' ? range.upper : 1
    const fraction = max === min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)))

    const style = this.styles.gauge ?? 'automatic'
    const label = this.convertList(view.children, `${path}-label`, 'horizontal')
    const current = this.convertList(argViews(view, 'currentValueLabel'), `${path}-value`, 'horizontal')
    const minimum = this.convertList(argViews(view, 'minimumValueLabel'), `${path}-minimum`, 'horizontal')
    const maximum = this.convertList(argViews(view, 'maximumValueLabel'), `${path}-maximum`, 'horizontal')
    const circular = style.toLowerCase().includes('circular')
    if (circular) {
      const size = 58, radius = 26, center = size / 2
      const capacity = style !== 'accessoryCircular'
      const start = capacity ? -90 : 135
      const sweep = capacity ? 360 : 270
      const point = (degrees: number) => {
        const radians = degrees * Math.PI / 180
        return `${center + radius * Math.cos(radians)} ${center + radius * Math.sin(radians)}`
      }
      const arc = (portion: number) => {
        const angle = sweep * portion
        // Two arcs retain a complete circle at 100%; one SVG arc cannot do that.
        return `M ${point(start)} A ${radius} ${radius} 0 ${angle / 2 > 180 ? 1 : 0} 1 ${point(start + angle / 2)} A ${radius} ${radius} 0 ${angle / 2 > 180 ? 1 : 0} 1 ${point(start + angle)}`
      }
      const ring = (id: string, portion: number, color: RGBA): LayoutElement => ({
        kind: 'path', id, d: arc(portion), fill: null, stroke: { color, width: 6 }, fillRule: 'nonzero',
      })
      const angle = (start + sweep * fraction) * Math.PI / 180
      const marker: LayoutElement = {
        kind: 'modified', id: `${path}-marker-position`, modifier: { kind: 'offset', x: radius * Math.cos(angle), y: radius * Math.sin(angle) },
        child: { kind: 'modified', id: `${path}-marker-size`, modifier: { kind: 'frame', width: 7, height: 7, alignment: CENTER },
          child: { kind: 'shape', id: `${path}-marker`, shape: 'circle', fill: { kind: 'solid', color: this.color('accentColor') }, stroke: { color: this.color('secondarySystemGroupedBackground'), width: 2.5 } } },
      }
      return {
        kind: 'modified', id: `${path}-size`, modifier: { kind: 'frame', width: size, height: size, alignment: CENTER },
        child: { kind: 'zstack', id: path, alignment: CENTER, ...origin, children: [
          ring(`${path}-track`, 1, capacity ? { ...this.color('accentColor'), a: 0.35 } : this.color('accentColor')),
          ...(capacity ? fraction > 0 ? [ring(`${path}-fill`, fraction, this.color('accentColor'))] : [] : [marker]),
          { kind: 'modified', id: `${path}-label-offset`, modifier: { kind: 'offset', x: 0, y: !capacity && !current.length ? 19 : 0 },
            child: { kind: 'modified', id: `${path}-center-font`, modifier: { kind: 'font', font: fontForToken(!capacity && !current.length ? 'caption2' : 'body', this.typeScale)! },
              child: { kind: 'stack', id: `${path}-center`, axis: 'vertical', spacing: 0, alignment: CENTER, children: current.length ? current : label } } },
          ...(!capacity && current.length ? [{ kind: 'modified' as const, id: `${path}-bottom-label`, modifier: { kind: 'offset' as const, x: 0, y: 19 },
            child: { kind: 'modified' as const, id: `${path}-bottom-font`, modifier: { kind: 'font' as const, font: fontForToken('caption2', this.typeScale)! },
              child: { kind: 'stack' as const, id: `${path}-bottom`, axis: 'vertical' as const, spacing: 0, alignment: CENTER, children: label } } }] : []),
        ] },
      }
    }

    const accessory = style.startsWith('accessory')
    const capacity = !accessory || style === 'accessoryLinearCapacity'
    const tint = this.color('accentColor')
    const height = accessory ? 6 : 16
    const bar: LayoutElement = { kind: 'modified', id: `${path}-barframe`,
      modifier: { kind: 'frame', height, maxWidth: Infinity, alignment: CENTER },
      child: { kind: 'zstack', id: `${path}-bar`, alignment: { horizontal: 'leading', vertical: 'center' }, children: [
        { kind: 'modified', id: `${path}-track-round`, modifier: { kind: 'cornerRadius', radius: 999 }, child: { kind: 'fill', id: `${path}-trackf`, fill: { kind: 'solid', color: capacity ? this.color('tertiarySystemFill') : tint } } },
        ...(capacity ? [{ kind: 'modified' as const, id: `${path}-fill-width`, modifier: { kind: 'relativeWidth' as const, fraction },
          child: { kind: 'modified' as const, id: `${path}-fill-round`, modifier: { kind: 'cornerRadius' as const, radius: 999 }, child: { kind: 'fill' as const, id: `${path}-fillf`, fill: { kind: 'solid' as const, color: tint } } } }] :
          [{ kind: 'slider' as const, id: `${path}-indicator`, height, style: { fraction, thumbDiameter: 10, thumbHeight: 10, trackHeight: 0, tint, trackColor: tint, thumbColor: this.color('label') } }]),
      ] } }
    const limits: LayoutElement = { kind: 'stack', id: `${path}-limits`, axis: 'horizontal', spacing: 8, alignment: CENTER,
      children: [...minimum, { kind: 'spacer', id: `${path}-space`, axis: 'horizontal', minLength: 0 }, ...current,
        { kind: 'spacer', id: `${path}-space2`, axis: 'horizontal', minLength: 0 }, ...maximum] }
    return { kind: 'stack', id: path, axis: 'vertical', spacing: 8, alignment: CENTER, ...origin, children: [
      ...label, bar, ...(current.length || minimum.length || maximum.length ? [limits] : []),
    ] }
  }

  /** Search geometry shared by the bottom capsule, toolbar, and drawer. */
  searchField(search: SearchField, placement: SearchPlacement): LayoutElement {
    return this.chromeContent(`${search.path}font`, () => this.searchFieldContent(search, placement))
  }

  private searchFieldContent({ text, prompt: placeholder, path }: SearchField, placement: SearchPlacement): LayoutElement {
    const row: LayoutElement = {
      kind: 'stack',
      id: `${path}row`,
      axis: 'horizontal',
      spacing: 6,
      alignment: CENTER,
      children: [
        {
          kind: 'modified',
          id: `${path}iconcolor`,
          modifier: { kind: 'foregroundStyle', color: this.color('secondaryLabel') },
          // Through `symbolImage`, so the name reaches the renderer and the drawn
          // magnifier is used. Built inline, it carried only the Unicode fallback.
          child: this.symbolImage(`${path}icon`, 'magnifyingglass'),
        },
        /*
          The hit target is the field, not the whole box.

          It used to wrap the padded box, and the renderer draws a text field as an
          `<input>` at `inset: 0` of whatever it is put on - so the input covered the
          magnifying glass, and the glass was never visible in any search bar the
          studio drew. Measured in the DOM: the input spanned all 316 points of the
          field and there was no `<svg>` anywhere near it.

          Scoping the target to the field leaves the icon painted beside it and starts
          the caret where iOS starts it. The cost is that the few points of grey under
          the glass no longer focus the field, which is a smaller lie than a search bar
          with no glass in it.
        */
        this.withHitTarget(
          {
            kind: 'modified',
            id: `${path}fieldframe`,
            modifier: { kind: 'frame', height: bodyFont(this.typeScale).lineHeight, maxWidth: Number.POSITIVE_INFINITY, alignment: CENTER },
            child: { kind: 'empty', id: `${path}field` },
          },
          path,
          'textField',
          placeholder || 'Search',
          undefined,
          false,
          { value: text, placeholder: placeholder || 'Search' },
        ),
      ],
    }

    const padded: LayoutElement = {
      kind: 'modified',
      id: `${path}pad`,
      modifier: { kind: 'padding', insets: insets(7, 14, 7, 14) },
      child: row,
    }

    if (placement === 'bottom') {
      const capsule = this.glassCapsule({ kind: 'modified', id: `${path}height`, modifier: { kind: 'frame', minHeight: SURFACES.search.capsuleHeight, alignment: CENTER }, child: padded }, `${path}surface`, `${path}outline`)
      // Centred on the tab bar's line, in the space a tab bar takes.
      const centring = (SURFACES.tab.height - SURFACES.search.capsuleHeight) / 2
      return {
        kind: 'modified', id: `${path}outer`,
        modifier: { kind: 'padding', insets: insets(centring, SURFACES.search.capsuleMargin, centring + SURFACES.tab.bottom, SURFACES.search.capsuleMargin) },
        child: capsule,
      }
    }

    const surface: LayoutElement = {
      kind: 'modified', id: `${path}surface`,
      modifier: { kind: 'background', content: { kind: 'fill', id: `${path}surface-fill`, fill: { kind: 'solid', color: this.color('tertiarySystemFill') } } },
      child: { kind: 'modified', id: `${path}height`, modifier: { kind: 'frame', minHeight: SURFACES.search.height, alignment: CENTER }, child: padded },
    }
    return {
      kind: 'modified', id: `${path}outer`,
      modifier: { kind: 'padding', insets: placement === 'toolbar' ? ZERO_INSETS : insets(4, SURFACES.search.margin, SURFACES.search.bottom, SURFACES.search.margin) },
      child: { kind: 'modified', id: `${path}round`, modifier: { kind: 'cornerRadius', radius: SURFACES.search.radius, style: 'circular' }, child: surface },
    }
  }

  /**
   * `Link` and `ShareLink`, in the accent colour, as the iOS 27 simulator draws them: the
   * label they were given, or their title. A share link with no label of its own is the
   * share icon and its title, "Share…" when it has none.
   */
  private link(view: ViewValue, path: string, origin: object): LayoutElement {
    const title = stringArg(positional(view.args, 0))
    const content = view.children.length > 0 ? view.children
      : view.name === 'ShareLink' ? [{ name: 'Label', args: [{ label: null, value: { kind: 'string', value: title ?? 'Share…' } }, { label: 'systemImage', value: { kind: 'string', value: 'square.and.arrow.up' } }], children: [], modifiers: [], action: null, span: view.span } satisfies ViewValue]
      : []
    const label: LayoutElement = content.length === 0
      ? { kind: 'text', id: path, text: title ?? '', ...origin }
      : { kind: 'stack', id: `${path}label`, axis: 'horizontal', spacing: 4, alignment: CENTER, children: content.map((child, index) => this.convert(child, `${path}l${index}`, 'horizontal')), ...origin }
    return {
      kind: 'modified',
      id: `${path}tint`,
      modifier: { kind: 'foregroundStyle', color: this.color('accentColor') },
      child: label,
    }
  }

  // --------------------------------------------------------------- modifiers

  private convertModifier(
    modifier: ModifierValue,
    id: string,
    view: ViewValue,
  ): LayoutModifier | null {
    const args = modifier.args

    switch (modifier.name) {
      case 'padding':
        return { kind: 'padding', insets: paddingInsets(args, this.appearance.metrics.padding) }

      case 'frame':
        return frameModifier(args)

      case 'background': {
        const content = this.backgroundContent(args, modifier, `${id}bg`)
        const hasView = args.some((arg) => (arg.label === null || arg.label === 'content') && asView(arg.value))
        // `.background(.red)` and `.background(Color.red)` are the ShapeStyle form, which
        // reaches into the safe area its view touches; a view given as the background,
        // `.background { Color.red }`, doesn't. Both measured in the iOS 27 simulator.
        const style = !hasView && !labelled(args, 'in') && args.some((arg) => arg.label === null)
        return content ? {
          kind: 'background',
          content,
          ...(hasView ? { alignment: alignmentFromToken(labelled(args, 'alignment')) ?? CENTER } : {}),
          ...(style ? { ignoresSafeAreaEdges: edgeSet(labelled(args, 'ignoresSafeAreaEdges')) } : {}),
        } : null
      }

      case 'overlay': {
        const content = this.backgroundContent(args, modifier, `${id}ov`)
        return content
          ? {
              kind: 'overlay',
              content,
              alignment: alignmentFromToken(labelled(args, 'alignment')) ?? CENTER,
            }
          : null
      }

      case 'font': {
        const font = resolveFontArg(args[0]?.value, this.typeScale)
        return font ? { kind: 'font', font } : null
      }

      case 'fontWeight':
        return { kind: 'fontTrait', weight: resolveWeightArg(args[0]?.value) ?? 700 }

      case 'fontDesign': {
        // `.default` is the one that has to reset rather than be ignored, or a design
        // set higher up would be impossible to turn off.
        const design = tokenName(args[0]?.value)
        const family =
          design === 'rounded' ? ROUNDED_FAMILY : design === 'monospaced' ? MONO_FAMILY : design === 'serif' ? SERIF_FAMILY : UI_FONT_FAMILY
        return { kind: 'fontTrait', family }
      }


      case 'bold':
        return args[0]?.value.kind === 'bool' && !args[0].value.value ? null : { kind: 'fontTrait', weight: 700 }

      case 'italic':
        return { kind: 'fontTrait', italic: args[0]?.value.kind !== 'bool' || args[0].value.value }

      case 'foregroundStyle':
      case 'foregroundColor': {
        const fill = resolveFillArg(args[0]?.value, this.scheme, this.styles.tint)
        return fill ? { kind: 'foregroundStyle', color: fill.kind === 'solid' ? fill.color : this.color('primary'), ...(fill.kind !== 'solid' ? { fill } : {}) } : null
      }

      case 'opacity': {
        const value = numberArg(args[0]?.value)
        return value === null ? null : { kind: 'opacity', value }
      }

      case 'cornerRadius': {
        const radius = numberArg(args[0]?.value)
        return radius === null ? null : { kind: 'cornerRadius', radius }
      }

      case 'clipShape': {
        const shape = shapeOf(args[0]?.value)
        return {
          kind: 'clip',
          shape: shape.kind,
          cornerRadius: shape.cornerRadius,
          style: shape.style,
        }
      }

      case 'clipped':
        return { kind: 'clip', shape: 'rectangle', cornerRadius: 0 }

      case 'border': {
        const color = resolveColorArg(args[0]?.value, this.scheme, this.styles.tint)
        const width = numberArg(positional(args, 1)) ?? numberArg(labelled(args, 'width')) ?? 1
        return color ? { kind: 'border', color, width } : null
      }

      case 'shadow': {
        const radius = numberArg(labelled(args, 'radius')) ?? numberArg(positional(args, 0)) ?? 4
        const color = resolveColorArg(labelled(args, 'color'), this.scheme, this.styles.tint) ?? rgba(0, 0, 0, 0.18)
        return {
          kind: 'shadow',
          color,
          radius,
          x: numberArg(labelled(args, 'x')) ?? 0,
          y: numberArg(labelled(args, 'y')) ?? 0,
        }
      }

      case 'offset': {
        // `.offset(dragOffset)` - a CGSize, which is how every drag writes it.
        const size = payloadOf<{ width: number; height: number }>(positional(args, 0), 'CGSize')
        return {
          kind: 'offset',
          x: numberArg(labelled(args, 'x')) ?? numberArg(positional(args, 0)) ?? size?.width ?? 0,
          y: numberArg(labelled(args, 'y')) ?? size?.height ?? 0,
        }
      }

      case 'fixedSize': {
        const horizontal = boolArg(labelled(args, 'horizontal'))
        const vertical = boolArg(labelled(args, 'vertical'))
        return args.length === 0
          ? { kind: 'fixedSize', horizontal: true, vertical: true }
          : { kind: 'fixedSize', horizontal: horizontal ?? false, vertical: vertical ?? false }
      }

      case 'scaleEffect': {
        const uniform = numberArg(positional(args, 0))
        const size = payloadOf<{ width: number; height: number }>(positional(args, 0), 'CGSize')
        return {
          kind: 'scale',
          anchor: transformAnchor(labelled(args, 'anchor')),
          x: uniform ?? size?.width ?? numberArg(labelled(args, 'x')) ?? 1,
          y: uniform ?? size?.height ?? numberArg(labelled(args, 'y')) ?? 1,
        }
      }

      case 'rotationEffect': {
        const degrees = angleDegrees(positional(args, 0) ?? labelled(args, 'angle'))
        return degrees === null ? null : { kind: 'rotate', degrees, anchor: transformAnchor(labelled(args, 'anchor')) }
      }

      case 'blur':
        return { kind: 'filter', filter: { blur: numberArg(labelled(args, 'radius')) ?? numberArg(positional(args, 0)) ?? 0 } }

      case 'saturation':
        return { kind: 'filter', filter: { saturation: numberArg(positional(args, 0)) ?? 1 } }

      case 'brightness':
        return { kind: 'filter', filter: { brightness: numberArg(positional(args, 0)) ?? 0 } }

      case 'contrast':
        return { kind: 'filter', filter: { contrast: numberArg(positional(args, 0)) ?? 1 } }

      case 'hueRotation': {
        // An `Angle`, not a number: `.hueRotation(.degrees(90))` is how it is written.
        const angle = angleDegrees(positional(args, 0) ?? labelled(args, 'angle'))
        return angle === null ? null : { kind: 'filter', filter: { hueRotate: angle } }
      }

      case 'colorMultiply': {
        const color = resolveColorArg(positional(args, 0), this.scheme, this.styles.tint)
        return color ? { kind: 'filter', filter: { multiply: color } } : null
      }

      case 'rotation3DEffect': {
        const degrees = angleDegrees(positional(args, 0) ?? labelled(args, 'angle'))
        if (degrees === null) return null
        const axis = labelled(args, 'axis')
        const vector = axisVector(axis)
        return { kind: 'rotate3D', degrees, ...vector, anchor: transformAnchor(labelled(args, 'anchor')), anchorZ: numberArg(labelled(args, 'anchorZ')) ?? 0, perspective: numberArg(labelled(args, 'perspective')) ?? 1 }
      }

      case 'blendMode': {
        const mode = tokenName(positional(args, 0))
        const css = mode ? BLEND_MODES.get(mode) : undefined
        // A mode CSS has no equivalent for is left to the unsupported path, which
        // warns - rather than silently picking the nearest one, which would draw
        // something plausible that the device will not.
        return css ? { kind: 'blendMode', mode: css } : { kind: 'unsupported', name: 'blendMode' }
      }

      case 'unredacted':
        // Turns the flag back off for a subtree inside a redacted one.
        return { kind: 'unredacted' }

      case 'redacted': {
        // `.redacted(reason: .placeholder)` is the only reason SwiftUI ships, and
        // `.unredacted()` is its own modifier rather than an argument here.
        return { kind: 'redacted' }
      }

      case 'grayscale':
        return { kind: 'filter', filter: { grayscale: numberArg(positional(args, 0)) ?? 0 } }

      case 'allowsHitTesting':
        return { kind: 'hitTestable', enabled: boolArg(positional(args, 0)) }

      case 'accessibilityLabel':
        return { kind: 'a11y', label: stringArg(positional(args, 0)) ?? '' }

      case 'accessibilityValue':
        return { kind: 'a11y', value: stringArg(positional(args, 0)) ?? '' }

      case 'accessibilityHint':
        return { kind: 'a11y', hint: stringArg(positional(args, 0)) ?? '' }

      case 'accessibilityHidden':
        return { kind: 'a11y', hidden: boolArg(positional(args, 0)) }

      case 'fill':
      case 'strokeBorder':
      case 'stroke':
      case 'trim':
        // Read directly off the shape or path they style, not applied as wrappers.
        return null

      case 'ignoresSafeArea':
      case 'edgesIgnoringSafeArea': {
        // `.ignoresSafeArea(.keyboard)` is about a keyboard the preview never shows, so
        // it changes nothing; it used to make the whole screen full-bleed.
        const regions = modifier.name === 'ignoresSafeArea' ? tokenName(positional(args, 0)) : null
        if (regions === 'keyboard') return null
        const edges = modifier.name === 'ignoresSafeArea' ? labelled(args, 'edges') : positional(args, 0)
        return { kind: 'ignoresSafeArea', edges: edgeSet(edges) }
      }

      case 'zIndex':
      case 'id':
      case 'listRowSeparator':
      case 'listRowInsets':
      case 'listRowSpacing':
      case 'listSectionSpacing':
      case 'scrollContentBackground':
      case 'scrollIndicators':
      case 'keyboardType':
      case 'submitLabel':
      case 'onSubmit':
      case 'focused':
      case 'presentationBackground':
      case 'presentationCornerRadius':
      case 'presentationDragIndicator':
      case 'interactiveDismissDisabled':
      case 'searchable':
      case 'onDelete':
      case 'onMove':
      case 'swipeActions':
      case 'toggleStyle':
      case 'pickerStyle':
      case 'labelStyle':
      case 'progressViewStyle':
      case 'gaugeStyle':
      case 'controlSize':
      case 'buttonBorderShape':
      case 'contextMenu':
      case 'badge':
        // Recognised, and either read elsewhere or deliberately inert. Recorded as
        // applied rather than as a coverage gap, because the code *is* honoured -
        // just not by a wrapper around this view.
        return null

      case 'monospaced':
        return { kind: 'font', font: monospacedFont(this.typeScale) }



      case 'position': {
        const point = payloadOf<{ x: number; y: number }>(positional(args, 0), 'CGPoint')
        return {
          kind: 'position',
          x: numberArg(labelled(args, 'x')) ?? numberArg(positional(args, 0)) ?? point?.x ?? 0,
          y: numberArg(labelled(args, 'y')) ?? numberArg(positional(args, 1)) ?? point?.y ?? 0,
        }
      }

      case 'layoutPriority': {
        const value = numberArg(positional(args, 0))
        return value === null ? null : { kind: 'layoutPriority', value }
      }

      case 'aspectRatio': {
        const ratio = numberArg(positional(args, 0))
        const mode = tokenName(labelled(args, 'contentMode')) ?? tokenName(positional(args, 1))
        return { kind: 'aspectRatio', ratio, mode: mode === 'fill' ? 'fill' : 'fit' }
      }

      case 'scaledToFit':
        return { kind: 'aspectRatio', ratio: null, mode: 'fit' }

      case 'scaledToFill':
        return { kind: 'aspectRatio', ratio: null, mode: 'fill' }

      case 'lineLimit': {
        // `.lineLimit(2...4)` gives a floor as well as a ceiling: at least two lines'
        // worth of room whatever the text is, so a list's rows stop changing height as
        // their content does.
        const first = positional(args, 0)
        if (first?.kind === 'range') {
          const upper = first.closed ? first.upper : first.upper - 1
          return {
            kind: 'textStyle',
            lineLimit: Math.max(1, upper),
            minimumLines: Math.max(1, first.lower),
          }
        }

        const limit = numberArg(first)
        return { kind: 'textStyle', lineLimit: limit === null ? null : Math.max(0, limit), minimumLines: boolArg(labelled(args, 'reservesSpace')) && limit !== null ? Math.max(0, limit) : 0 }
      }

      case 'allowsTightening': {
        const first = positional(args, 0)
        const on = first === undefined ? true : first.kind === 'bool' ? first.value : true
        return { kind: 'textStyle', allowsTightening: on }
      }

      case 'monospacedDigit':
        return { kind: 'textStyle', tabularNumbers: true }

      case 'multilineTextAlignment': {
        const name = tokenName(positional(args, 0))
        return {
          kind: 'textStyle',
          alignment: name === 'center' ? 'center' : name === 'trailing' ? 'trailing' : 'leading',
        }
      }

      case 'textCase': {
        const name = tokenName(positional(args, 0))
        return {
          kind: 'textStyle',
          textCase: name === 'uppercase' ? 'upper' : name === 'lowercase' ? 'lower' : null,
        }
      }

      // The text attributes. All inherited, because in SwiftUI they are View
      // modifiers rather than Text ones: `VStack { Text(...) }.underline()` underlines
      // what is inside it.
      case 'underline':
      case 'strikethrough': {
        // `.underline(isActive)` and `.underline(isActive, color:)` both lead with a
        // Bool. No argument means on, which is the form almost everyone writes.
        const first = positional(args, 0)
        const on = first === undefined ? true : first.kind === 'bool' ? first.value : true
        return modifier.name === 'underline'
          ? { kind: 'textStyle', underline: on, underlineColor: resolveColorArg(labelled(args, 'color'), this.scheme, this.styles.tint) }
          : { kind: 'textStyle', strikethrough: on, strikethroughColor: resolveColorArg(labelled(args, 'color'), this.scheme, this.styles.tint) }
      }

      case 'kerning':
      case 'tracking': {
        const value = numberArg(positional(args, 0))
        return value === null ? null : { kind: 'textStyle', tracking: value }
      }

      case 'baselineOffset': {
        const value = numberArg(positional(args, 0))
        return value === null ? null : { kind: 'textStyle', baselineOffset: value }
      }

      case 'lineSpacing': {
        const value = numberArg(positional(args, 0))
        return value === null ? null : { kind: 'textStyle', lineSpacing: Math.max(0, value) }
      }

      case 'minimumScaleFactor': {
        const value = numberArg(positional(args, 0))
        return value === null
          ? null
          : { kind: 'textStyle', minimumScale: Math.max(0.1, Math.min(1, value)) }
      }

      case 'truncationMode': {
        const mode = tokenName(positional(args, 0))
        return {
          kind: 'textStyle',
          truncation: mode === 'head' ? 'head' : mode === 'middle' ? 'middle' : 'tail',
        }
      }

      case 'alignmentGuide': {
        const guide = tokenName(positional(args, 0))
        const closure = modifier.closure
        if (!guide || !closure || !this.callGuide) return null

        const run = this.callGuide
        return { kind: 'alignmentGuide', guide, compute: (size: Size) => run(closure, size) }
      }

      case 'safeAreaInset': {
        const edge = tokenName(labelled(args, 'edge')) ?? 'bottom'
        // Evaluated by the host, because an inset is on screen from the first frame -
        // unlike a sheet's, whose closure must not run while it is down.
        const views = args
          .filter((a) => a.label === 'content')
          .map((a) => asView(a.value))
          .filter((v): v is ViewValue => v !== null)
        if (views.length === 0) return null

        return {
          kind: 'safeAreaInset',
          edge:
            edge === 'top' || edge === 'leading' || edge === 'trailing'
              ? edge
              : 'bottom',
          spacing: numberArg(labelled(args, 'spacing')) ?? 0,
          content: {
            kind: 'stack',
            id: `${id}inset`,
            axis: edge === 'leading' || edge === 'trailing' ? 'vertical' : 'horizontal',
            spacing: 0,
            alignment: CENTER,
            children: this.convertList(views, `${id}inset`, 'horizontal'),
          },
        }
      }

      case 'containerRelativeFrame': {
        const axisValue = positional(args, 0)
        const axes = axisValue?.kind === 'array' ? axisValue.elements.map(tokenName) : [tokenName(axisValue) ?? 'horizontal']
        const count = numberArg(labelled(args, 'count')) ?? 1
        return {
          kind: 'containerRelativeFrame',
          horizontal: axes.includes('horizontal'),
          vertical: axes.includes('vertical'),
          count: Math.max(1, Math.round(count)),
          span: Math.max(1, Math.round(numberArg(labelled(args, 'span')) ?? 1)),
          alignment: alignmentFromToken(labelled(args, 'alignment')) ?? CENTER,
          spacing: numberArg(labelled(args, 'spacing')) ?? 0,
        }
      }

      case 'animation': {
        const hint = animationHint(args[0]?.value)
        if (!hint) return null

        // `.animation(_:value:)` animates only when `value` changed, which the
        // resolver decided - it is the stage that remembers the last render. The
        // form without a `value:` animates its subtree unconditionally, as SwiftUI's
        // deprecated one does.
        const gated = args.some((a) => a.label === 'value')
        if (gated && !boolArg(labelled(args, 'armed'))) return { kind: 'transitionTiming', hint }

        return { kind: 'animate', hint }
      }

      case 'transition': {
        const spec = payloadOf<TransitionPayload>(args[0]?.value, TRANSITION_TYPE)
        if (!spec || spec.kind === 'identity') return null
        const edge = spec.edge
        return {
          kind: 'transition',
          spec: {
            kind: spec.kind,
            ...(edge === 'top' || edge === 'bottom' || edge === 'leading' || edge === 'trailing'
              ? { edge }
              : {}),
            duration: 0.3,
          },
        }
      }

      // The size category is already scoped to this subtree; re-seeding the body font
      // makes default text follow it. Only this modifier may do that: the inherited
      // styling modifiers below are stamped onto every descendant, so a font here
      // would override the fonts of every container in between.
      case 'dynamicTypeSize':
        return view.modifiers.some((m) => m.name === 'font') ? null : { kind: 'font', font: bodyFont(this.typeScale) }
      case 'environment': {
        if (asKeyPath(args[0]?.value)?.components[0] === 'dynamicTypeSize' && !view.modifiers.some((m) => m.name === 'font')) return { kind: 'font', font: bodyFont(this.typeScale) }
        // Keep inherited explicit foregrounds; only the default label follows appearance.
        const key = asKeyPath(args[0]?.value)?.components[0]
        if (key === 'colorScheme' && !view.modifiers.some((m) => m.name === 'foregroundStyle' || m.name === 'foregroundColor')) {
          return { kind: 'foregroundStyle', color: this.color('primary') }
        }
        return null
      }

      // Recognised and deliberately inert: these change behaviour the preview does
      // not model, and recording them keeps the inspector honest about what was
      // written rather than dropping it silently.
      case 'resizable':
      case 'listStyle':
      case 'listRowBackground':
      case 'buttonStyle':
      case 'imageScale':
      case 'tint':
      case 'accentColor':
      case 'textFieldStyle':
      case 'tabItem':
      case 'tag':
      case 'navigationTitle':
      case 'navigationBarTitleDisplayMode':
      case 'navigationDestination':
      case 'toolbar':
      case 'sheet':
      case 'fullScreenCover':
      case 'alert':
      case 'confirmationDialog':
      case 'presentationDetents':
      case 'onTapGesture':
      case 'onLongPressGesture':
      case 'gesture':
      case 'simultaneousGesture':
      case 'highPriorityGesture':
      case 'onAppear':
      case 'onDisappear':
      case 'task':
      case 'onChange':
      case 'disabled':
        return null

      default:
        void view
        // Recorded so the coverage warning and the layout agree about what was
        // ignored, rather than the modifier vanishing silently.
        return { kind: 'unsupported', name: modifier.name }
    }
  }

  /** `.background(Color.red)`, `.background(.regularMaterial)`, `.background { … }`. */
  private backgroundContent(
    args: readonly ViewArg[],
    modifier: ModifierValue,
    id: string,
  ): LayoutElement | null {
    const contents = args.filter((a) => a.label === 'content').flatMap((a) => {
      const view = asView(a.value)
      return view ? [view] : []
    })
    if (contents.length) return {
      kind: 'zstack', id, alignment: CENTER,
      children: contents.map((view, i) => this.convert(view, `${id}-${i}`, 'vertical')),
    }
    const value = args.find((a) => a.label === null)?.value
    const inShape = labelled(args, 'in')
    if (inShape) {
      const content = this.backgroundContent(args.filter((a) => a.label !== 'in'), modifier, `${id}fill`)
      const shape = shapeOf(inShape)
      return content ? { kind: 'modified', id, child: content, modifier: { kind: 'clip', shape: shape.kind, cornerRadius: shape.cornerRadius, style: shape.style } } : null
    }

    if (value) {
      // A material is not a colour: it is a translucent panel over a blurred
      // backdrop, and drawing it as flat grey is the approximation this refuses.
      const material = MATERIALS[tokenName(value) ?? '']
      if (material) {
        const panel: LayoutElement = {
          kind: 'modified',
          id: `${id}mat`,
          modifier: {
            kind: 'material',
            ...material,
            light: this.scheme === 'light',
          },
          child: { kind: 'empty', id: `${id}matbox` },
        }
        const opacity = value.kind === 'opaque' ? (value.payload as TokenPayload).opacity : undefined
        return opacity === undefined ? panel : { kind: 'modified', id: `${id}matAlpha`, modifier: { kind: 'opacity', value: opacity }, child: panel }
      }

      const fill = resolveFillArg(value, this.scheme, this.styles.tint)
      if (fill) return { kind: 'fill', id, fill }

      if (value.kind === 'opaque' && value.typeName === 'View') {
        return this.convert(value.payload as ViewValue, id, 'vertical')
      }
    }

    return null
  }

  // ----------------------------------------------------------------- helpers

  private color(name: string): RGBA {
    if (this.sheetSurface) {
      if (name === 'systemGroupedBackground') return rgba(0, 0, 0, 0)
      if (name === 'secondarySystemGroupedBackground') return this.scheme === 'light' ? rgba(0, 0, 0, 0.07) : rgba(255, 255, 255, 0.08)
    }
    return colorForName(name, this.scheme, this.styles.tint) ?? rgba(0, 0, 0)
  }

  private styledText(
    id: string,
    text: string,
    style: string,
    color: string,
    weight?: number,
  ): LayoutElement {
    const base: LayoutElement = { kind: 'text', id, text }
    const coloured: LayoutElement = {
      kind: 'modified',
      id: `${id}c`,
      modifier: { kind: 'foregroundStyle', color: this.color(color) },
      child: base,
    }
    const font = fontForToken(style, this.typeScale)!
    return {
      kind: 'modified',
      id: `${id}f`,
      modifier: { kind: 'font', font: weight ? { ...font, weight } : font },
      child: coloured,
    }
  }

  private background(
    child: LayoutElement,
    id: string,
    color: RGBA,
    radius = 0,
    cornerStyle: 'continuous' | 'circular' = 'continuous',
  ): LayoutElement {
    const fill: LayoutElement = { kind: 'fill', id: `${id}f`, fill: { kind: 'solid', color } }
    const backed: LayoutElement = {
      kind: 'modified',
      id,
      modifier: { kind: 'background', content: fill },
      child,
    }
    return radius > 0
      ? { kind: 'modified', id: `${id}r`, modifier: { kind: 'cornerRadius', radius, style: cornerStyle }, child: backed }
      : backed
  }
}

// -------------------------------------------------------------------- helpers

/**
 * Whether a view contributes its children to the enclosing container.
 *
 * `ForEach` always does, whatever modifiers it carries: the ones it takes describe
 * the collection rather than a box around it. The others do so only when unmodified,
 * because a modifier on a `Group` genuinely wraps the group.
 */
function isTransparent(view: ViewValue): boolean {
  if (view.name === 'ForEach') return true
  return TRANSPARENT_VIEWS.has(view.name) && view.modifiers.length === 0
}

function labelled(args: readonly ViewArg[], label: string): SwiftValue | undefined {
  return args.find((a) => a.label === label)?.value
}

function positional(args: readonly ViewArg[], index: number): SwiftValue | undefined {
  return args.filter((a) => a.label === null)[index]?.value
}

/** An argument of a named modifier on a view, for style modifiers read out of band. */
function modifierArg(view: ViewValue, name: string, index: number): SwiftValue | undefined {
  const modifier = view.modifiers.find((m) => m.name === name)
  return modifier ? positional(modifier.args, index) : undefined
}

function modifierNamedArg(view: ViewValue, name: string, label: string): SwiftValue | undefined {
  const modifier = view.modifiers.find((m) => m.name === name)
  return modifier ? labelled(modifier.args, label) : undefined
}

/** `.trim(from:to:)` written on a shape or path, rather than on the path value. */
function trimOf(view: ViewValue): { from: number; to: number } | null {
  const modifier = view.modifiers.find((m) => m.name === 'trim')
  if (!modifier) return null
  return {
    from: numberArg(labelled(modifier.args, 'from')) ?? 0,
    to: numberArg(labelled(modifier.args, 'to')) ?? 1,
  }
}

/**
 * Material opacities.
 *
 * Apple's materials differ in how much of the backdrop survives; these are the
 * translucencies that read closest at the blur radius used, rather than published
 * values - Apple does not publish them.
 */
const MATERIALS = IOS_27.materials

/** SwiftUI's default stack spacing is 8 points, not zero. */
function defaultSpacing(): number {
  return IOS_27.metrics.stackSpacing
}

/** `Text("a") + Text("b")` is not supported yet; the first argument is the content. */
function textOf(view: ViewValue): string {
  const first = positional(view.args, 0)
  if (first?.kind === 'string') return first.value

  // `Text(verbatim: "1 + 1")` - the initialiser that takes a string and promises not
  // to treat it as a localisation key. The content is the same string either way.
  if (!first) {
    const verbatim = labelled(view.args, 'verbatim')
    return verbatim?.kind === 'string' ? verbatim.value : ''
  }

  // `Text(date, style: .time)`. A Date reaching here as an unrecognised value drew an
  // empty string - a blank where the app shows a date, which is the failure mode this
  // whole pass exists to remove.
  const date = asDate(first)
  if (date) return dateText(date.epochSeconds, tokenName(labelled(view.args, 'style')))

  // `Text(total, format: .currency(code: "USD"))`. Dropping the format and describing
  // the number renders `1234.5` where the app shows `$1,234.50` - a plausible-looking
  // figure that is not the one the code asks for, which is worse than a placeholder.
  const format = labelled(view.args, 'format')
  if (format) return formatted(first, format)

  return displayValue(first)
}

/**
 * A value rendered through a `FormatStyle`.
 *
 * `Intl` does the work, so the grouping separators and currency symbols are the
 * platform's real ones rather than a transcription. An unrecognised style falls back
 * to the plain description: the number is still right, only its dressing is missing.
 */
function formatted(value: SwiftValue, format: SwiftValue): string {
  const name = tokenName(format) ?? ''
  const n = value.kind === 'int' || value.kind === 'double' ? value.value : Number.NaN
  if (Number.isNaN(n)) return displayValue(value)

  // `.currency(code:)` arrives as `currency:USD`, the same way `.system(size:)` does.
  const [style, detail] = name.split(':')

  switch (style) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: detail || 'USD',
      }).format(n)
    case 'percent':
      return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 }).format(n)
    case 'number':
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n)
    default:
      return displayValue(value)
  }
}

function displayValue(value: SwiftValue): string {
  switch (value.kind) {
    case 'string':
      return value.value
    case 'int':
      return String(value.value)
    case 'double':
      return Number.isInteger(value.value) ? `${value.value}.0` : String(value.value)
    case 'bool':
      return value.value ? 'true' : 'false'
    case 'opaque':
      // A `UUID` or a `URL` reads as its own text. Everything else opaque belongs to
      // the host and has no printable form.
      return (
        payloadOf<TokenPayload>(value, TOKEN_TYPE)?.name ?? foundationDescription(value) ?? ''
      )
    default:
      return ''
  }
}

/**
 * `Text(date, style:)`.
 *
 * The relative styles are computed once, at render, because the preview has no clock
 * to tick them with - stated in the coverage matrix rather than left to be noticed.
 * The absolute ones are the browser's locale formatting, so the separators and the
 * order are the platform's real ones.
 */
/**
 * Which halves of a date a `DatePicker` row shows.
 *
 * `displayedComponents:` is a set, and the two members that matter are `.date` and
 * `.hourAndMinute`. Omitted, SwiftUI shows both - which is why the default here is
 * neither of the single-part styles.
 */
function datePickerStyleFor(view: ViewValue): string | null {
  const components = labelled(view.args, 'displayedComponents')
  if (!components) return null

  const names =
    components.kind === 'array'
      ? components.elements.map((e) => tokenName(e) ?? '')
      : [tokenName(components) ?? '']

  const wantsDate = names.includes('date')
  const wantsTime = names.includes('hourAndMinute')
  if (wantsDate && !wantsTime) return 'date'
  if (wantsTime && !wantsDate) return 'time'
  return null
}

function dateText(epochSeconds: number, style: string | null): string {
  const date = new Date(epochSeconds * 1000)

  switch (style) {
    case 'time':
      return new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(date)
    case 'date':
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
    case 'relative':
    case 'offset': {
      const seconds = epochSeconds - Date.now() / 1000
      const [amount, unit] =
        Math.abs(seconds) < 3600
          ? [seconds / 60, 'minute' as const]
          : Math.abs(seconds) < 86_400
            ? [seconds / 3600, 'hour' as const]
            : [seconds / 86_400, 'day' as const]
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(
        Math.round(amount),
        unit,
      )
    }
    case 'timer': {
      const total = Math.max(0, Math.round(Math.abs(epochSeconds - Date.now() / 1000)))
      const minutes = Math.floor(total / 60)
      return `${minutes}:${String(total % 60).padStart(2, '0')}`
    }
    default:
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
  }
}

/**
 * The axes a `ViewThatFits` checks.
 *
 * Both when unspecified, which is SwiftUI's default and the only form most code uses.
 */
function fitAxes(value: SwiftValue | undefined): Axis[] {
  const name = tokenName(value)
  if (name === 'horizontal') return ['horizontal']
  if (name === 'vertical') return ['vertical']
  return ['horizontal', 'vertical']
}

/**
 * The key a `GeometryReader` reports its resolved size under.
 *
 * Its stamped path: stable across passes for the same reader, and distinct for two
 * readers produced by the same source line inside a `ForEach` - which a source span
 * alone would not be.
 */
function geometryKeyOf(view: ViewValue): string {
  return view.geometryKey ?? view.path ?? `geo-${view.span.start}`
}

function boolArg(value: SwiftValue | undefined): boolean {
  return value?.kind === 'bool' ? value.value : false
}

/** Reads through a binding, so a control shows the value it is bound to. */
function bindingValue(value: SwiftValue | undefined): SwiftValue | null {
  const projected = asProjection(value)
  if (projected) return projected.get()
  return value ?? null
}

function truthyBinding(value: SwiftValue | undefined): boolean {
  const resolved = bindingValue(value)
  return resolved !== null && truthy(resolved)
}

const EDGE_SET_NAMES: ReadonlySet<string> = new Set(['top', 'bottom', 'leading', 'trailing', 'horizontal', 'vertical', 'all'])

/** An `Edge.Set`: `.all` when none is given, one edge, `.horizontal`, `.vertical`, or a list. */
function edgeSet(value: SwiftValue | undefined): SafeAreaEdges {
  if (value === undefined) return { top: true, bottom: true, leading: true, trailing: true }
  const names = value.kind === 'array' ? value.elements.map(tokenName) : [tokenName(value)]
  const has = (edge: string, axis: string) => names.some((name) => name === edge || name === axis || name === 'all')
  return { top: has('top', 'vertical'), bottom: has('bottom', 'vertical'), leading: has('leading', 'horizontal'), trailing: has('trailing', 'horizontal') }
}

function tokenName(value: SwiftValue | undefined): string | null {
  return payloadOf<TokenPayload>(value, TOKEN_TYPE)?.name ?? null
}

function animationHint(value: SwiftValue | undefined): AnimationPayload | null {
  return payloadOf<AnimationPayload>(value, ANIMATION_TYPE)
}

/** `.degrees(30)` / `.radians(…)`, as `.rotationEffect` takes them. */
function angleDegrees(value: SwiftValue | undefined): number | null {
  const name = tokenName(value)
  if (name?.startsWith('degrees:')) return Number(name.split(':')[1])
  if (name?.startsWith('radians:')) return (Number(name.split(':')[1]) * 180) / Math.PI
  return numberArg(value)
}

function shapeOf(value: SwiftValue | undefined): { kind: ShapeKind; cornerRadius: number; style?: 'continuous' | 'circular' } {
  if (value?.kind === 'opaque' && value.typeName === TOKEN_TYPE) {
    const { name, args = [] } = value.payload as TokenPayload
    const style = args.some(argument => tokenName(argument) === 'continuous') ? 'continuous' : 'circular'
    if (name === 'rect') return { kind: args.length ? 'roundedRectangle' : 'rectangle', cornerRadius: numberArg(args[0]) ?? 0, style }
    if (name === 'circle' || name === 'capsule' || name === 'ellipse') return { kind: name, cornerRadius: 0, style }
  }
  if (value?.kind === 'opaque' && value.typeName === 'View') {
    const view = value.payload as ViewValue
    const shape = SHAPES[view.name]
    if (shape) {
      return {
        kind: shape,
        style: tokenName(labelled(view.args, 'style')) === 'continuous' ? 'continuous' : 'circular',
        cornerRadius: hasCornerRadii(view.args.map((a) => a.label)) ? largestCorner(view.args) : numberArg(labelled(view.args, 'cornerRadius')) ?? 0,
      }
    }
  }
  return { kind: 'rectangle', cornerRadius: 0 }
}

/** `GridItem` values, as `LazyVGrid(columns:)` takes them. */
function gridTracks(value: SwiftValue | undefined): GridTrack[] {
  if (value?.kind !== 'array') return [{ kind: 'flexible', size: null }]

  const tracks = value.elements.map((element): GridTrack => {
    if (element.kind === 'opaque' && element.typeName === 'GridItem') {
      const payload = element.payload as { kind: string; size: number | null; maximum?: number; spacing?: number; alignment?: string }
      const kind =
        payload.kind === 'fixed' ? 'fixed' : payload.kind === 'adaptive' ? 'adaptive' : 'flexible'
      const point = payload.alignment ? unitPoint(payload.alignment) : undefined
      return { kind, size: payload.size, maximum: payload.maximum, spacing: payload.spacing, ...(point ? { alignment: { horizontal: point.x === 0 ? 'leading' : point.x === 1 ? 'trailing' : 'center', vertical: point.y === 0 ? 'top' : point.y === 1 ? 'bottom' : 'center' } as Alignment } : {}) }
    }
    return { kind: 'flexible', size: null }
  })

  return tracks.length > 0 ? tracks : [{ kind: 'flexible', size: null }]
}

/** Full StrokeStyle values pass through layout to the shared SVG painter. */
function strokeStyle(view: ViewValue): StrokeStylePayload | undefined {
  const name = view.modifiers.some((m) => m.name === 'strokeBorder') ? 'strokeBorder' : 'stroke'
  const style = payloadOf<StrokeStylePayload>(
    modifierNamedArg(view, name, 'style') ?? modifierArg(view, name, 0),
    STROKE_STYLE_TYPE,
  )

  return style ?? undefined
}

function paddingInsets(args: readonly ViewArg[], defaultLength = IOS_27.metrics.padding): EdgeInsets {
  // `.padding()` with no arguments is the system default of 16.
  if (args.length === 0) return uniformInsets(defaultLength)

  // `.padding(EdgeInsets(top:leading:bottom:trailing:))` - four different lengths,
  // which is the one shape none of the shorthands can express.
  const explicit = payloadOf<EdgeInsetsPayload>(positional(args, 0), EDGE_INSETS_TYPE)
  if (explicit) return insets(explicit.top, explicit.leading, explicit.bottom, explicit.trailing)

  // `.padding(24)` - a bare number on all edges.
  const bare = numberArg(positional(args, 0))
  if (bare !== null && args.length === 1) return uniformInsets(bare)

  // `.padding(.horizontal, 24)` or `.padding([.horizontal, .top], 20)` - an edge set
  // plus a length. A list is a set too, and an empty one pads nothing.
  const edgeToken = positional(args, 0)
  const length = numberArg(positional(args, 1)) ?? numberArg(labelled(args, 'length')) ?? defaultLength
  if (edgeToken?.kind === 'array' || EDGE_SET_NAMES.has(tokenName(edgeToken) ?? '')) {
    const edges = edgeSet(edgeToken)
    return insets(edges.top ? length : 0, edges.leading ? length : 0, edges.bottom ? length : 0, edges.trailing ? length : 0)
  }
  if (tokenName(edgeToken) !== null) return uniformInsets(length)

  return uniformInsets(defaultLength)
}

function frameModifier(args: readonly ViewArg[]): LayoutModifier {
  const pick = (label: string): number | undefined => {
    const value = numberArg(labelled(args, label))
    return value === null ? undefined : value
  }

  return {
    kind: 'frame',
    ...(pick('width') !== undefined ? { width: pick('width')! } : {}),
    ...(pick('height') !== undefined ? { height: pick('height')! } : {}),
    ...(pick('idealWidth') !== undefined ? { idealWidth: pick('idealWidth')! } : {}),
    ...(pick('minWidth') !== undefined ? { minWidth: pick('minWidth')! } : {}),
    ...(pick('maxWidth') !== undefined ? { maxWidth: pick('maxWidth')! } : {}),
    ...(pick('idealHeight') !== undefined ? { idealHeight: pick('idealHeight')! } : {}),
    ...(pick('minHeight') !== undefined ? { minHeight: pick('minHeight')! } : {}),
    ...(pick('maxHeight') !== undefined ? { maxHeight: pick('maxHeight')! } : {}),
    alignment: alignmentFromToken(labelled(args, 'alignment')) ?? CENTER,
  }
}

function alignmentFromToken(value: SwiftValue | undefined): Alignment | null {
  const name = tokenName(value)
  if (!name) return null

  const map: Readonly<Record<string, Alignment>> = {
    topLeading: { horizontal: 'leading', vertical: 'top' },
    top: { horizontal: 'center', vertical: 'top' },
    topTrailing: { horizontal: 'trailing', vertical: 'top' },
    leading: { horizontal: 'leading', vertical: 'center' },
    center: CENTER,
    trailing: { horizontal: 'trailing', vertical: 'center' },
    bottomLeading: { horizontal: 'leading', vertical: 'bottom' },
    bottom: { horizontal: 'center', vertical: 'bottom' },
    bottomTrailing: { horizontal: 'trailing', vertical: 'bottom' },
  }
  return map[name] ?? null
}

/** A `VStack` takes a horizontal alignment; an `HStack` takes a vertical one. */
function stackAlignment(args: readonly ViewArg[], axis: Axis): Alignment {
  const name = tokenName(labelled(args, 'alignment'))
  if (!name) return CENTER

  if (axis === 'vertical') {
    const horizontal: HorizontalAlignment =
      name === 'leading' ? 'leading' : name === 'trailing' ? 'trailing' : 'center'
    return { horizontal, vertical: 'center' }
  }

  const vertical: VerticalAlignment =
    name === 'firstTextBaseline' || name === 'lastTextBaseline' ? name : name === 'top' ? 'top' : name === 'bottom' ? 'bottom' : 'center'
  return { horizontal: 'center', vertical }
}

function zstackAlignment(args: readonly ViewArg[]): Alignment {
  return alignmentFromToken(labelled(args, 'alignment')) ?? CENTER
}

/**
 * `Button("Add", systemImage: "plus")`, and `Menu` and `Toggle` written the same way:
 * shorthand for a `Label` as the control's label. Without it only the title was drawn.
 */
function titleAndIconLabel(view: ViewValue): ViewValue | null {
  if (!labelled(view.args, 'systemImage') || stringArg(positional(view.args, 0)) === null) return null
  return {
    name: 'Label',
    args: view.args.filter((arg) => arg.label === null || arg.label === 'systemImage'),
    children: [],
    modifiers: [],
    action: null,
    span: view.span,
  }
}

/**
 * The views a labelled argument produced.
 *
 * `Button { … } label: { Text("Save") }` hands its label over as an argument rather
 * than as a child, because the unlabelled trailing closure is already the action.
 */
function argViews(view: ViewValue, label: string): ViewValue[] {
  return view.args
    .filter((a) => a.label === label)
    .map((a) => asView(a.value))
    .filter((v): v is ViewValue => v !== null)
}

/** The words a labelled argument draws, from a string argument or from its views. */
function argText(view: ViewValue, label: string): string | null {
  const direct = stringArg(labelled(view.args, label))
  if (direct !== null) return direct

  const words = argViews(view, label).flatMap((v) => textIn(v))
  return words.length > 0 ? words.join(' ') : null
}

function labelOf(view: ViewValue): string {
  const first = positional(view.args, 0)
  if (first?.kind === 'string') return first.value

  // Framework chrome carries its label as a named argument, since it has no source
  // the user wrote to take a positional one from.
  const titled = labelled(view.args, 'title')
  if (titled?.kind === 'string') return titled.value

  const named = argText(view, 'label')
  if (named !== null) return named

  /*
    The words inside it, which is what a screen reader reads out.

    This used to take the first child that produced *any* label, and a child with
    no text of its own falls back to its own type name - so a `NavigationLink`
    wrapping a card whose first subview is an `Image` was announced as "Image".
    Reading the text instead gives "Cascade Ridge, North Cascades, 8.4 mi", which
    is both the useful answer and the one iOS gives for the same view.
  */
  const words = textIn(view)
  if (words.length > 0) return words.slice(0, 4).join(', ')

  return view.name
}

/**
 * Every string a view's subtree draws, in order.
 *
 * `Label` as well as `Text`: its title is an argument rather than a child, so a
 * subtree made only of labels would otherwise look wordless.
 */
function textIn(view: ViewValue): string[] {
  const out: string[] = []

  if (view.name === 'Text' || view.name === 'Label') {
    const value = stringArg(positional(view.args, 0))
    if (value) out.push(value)
  }
  for (const child of view.children) out.push(...textIn(child))

  return out
}

/** The hit-test role, which decides what the renderer builds for this control. */
function roleOf(view: ViewValue): HitRole {
  switch (view.name) {
    case 'Toggle':
      return 'toggle'
    case 'TextField':
    case 'SecureField':
    case 'TextEditor':
      return 'textField'
    case 'Slider':
      return 'slider'
    default:
      if (view.intent?.kind === 'gesture') return 'drag'
      return view.intent?.kind === 'run' && view.action === null && view.name !== 'Button'
        ? 'tapGesture'
        : 'button'
  }
}

/**
 * Whether this view's own hit target is inert.
 *
 * Both `.disabled(true)` and `.allowsHitTesting(false)` are checked here rather than
 * left to the environment, because a view's hit target is applied *outside* its
 * modifiers - so by the time the environment flag reaches the subtree, the target has
 * already been emitted. The environment still carries the flag, for the case where
 * the modifier is written on a container and the buttons are inside it.
 */
function isDisabled(view: ViewValue): boolean {
  return view.modifiers.some(modifier => modifier.name === 'disabled' &&
    (positional(modifier.args, 0) === undefined || truthy(positional(modifier.args, 0)!)))
}

function disabledBy(view: ViewValue): boolean {
  return isDisabled(view) || view.modifiers.some(modifier => modifier.name === 'allowsHitTesting' &&
    positional(modifier.args, 0) !== undefined && !truthy(positional(modifier.args, 0)!))
}

export type { RGBA }
export { ZERO_INSETS, resolveColorPayload, COLOR_TYPE, type ColorPayload, type Fill }
