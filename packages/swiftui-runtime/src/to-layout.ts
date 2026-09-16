import {
  MONO_FAMILY,
  rgba,
  ROUNDED_FAMILY,
  UI_FONT_FAMILY,
  type Fill,
  type RGBA,
  type ShapeKind,
  type Size,
} from '@studio/shared'
import {
  asDate,
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
  type TextRunSpec,
  type VerticalAlignment,
} from '@studio/swiftui-layout'
import {
  ALERT,
  BACK_BUTTON,
  DIALOG,
  MENU,
  NAV_BAR,
  TAB_BAR,
  TAB_ITEM,
  type Overlay,
  type ResolvedUI,
} from './presentation'
import { applyTrim, asCanvasContext, asPath, toSVGPath } from './paths'
import { resolveSymbol } from './sf-symbols'
import {
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
  /** True when the content extends under the device's edges. */
  readonly ignoresSafeArea: boolean
  readonly navigationBar: { readonly element: LayoutElement; readonly height: number } | null
  readonly tabBar: LayoutElement | null
  readonly overlay: {
    readonly element: LayoutElement
    readonly kind: Overlay['kind']
    readonly detent: number
    readonly dismissId: string | null
  } | null
  readonly hitTargets: ReadonlyMap<string, string>
}

const SHAPES: Readonly<Record<string, ShapeKind>> = {
  Rectangle: 'rectangle',
  RoundedRectangle: 'roundedRectangle',
  Circle: 'circle',
  Ellipse: 'ellipse',
  Capsule: 'capsule',
}

/** Views that contribute their children to the enclosing stack rather than nesting. */
const TRANSPARENT_VIEWS: ReadonlySet<string> = new Set([
  'Group',
  'WindowGroup',
  'ForEach',
  'NavigationStack',
  'NavigationView',
  'TabView',
  'AnyView',
])

/** iOS metrics the chrome is built from. Points, at the default Dynamic Type size. */
export const NAV_BAR_HEIGHT = 44
export const LARGE_TITLE_HEIGHT = 52
export const TAB_BAR_HEIGHT = 49
const ROW_MIN_HEIGHT = 44
const ROW_INSET = 16
const SEPARATOR_HEIGHT = 0.5
const SWITCH = { width: 51, height: 31, knob: 27 }
/** Must match the runtime's swipe width, or the action would not line up. */
const SWIPE_WIDTH = 88

export interface ConversionOptions {
  readonly colorScheme?: ColorScheme
  /** Dynamic Type multiplier applied to every resolved text style. */
  readonly typeScale?: number
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
  const converter = new Converter(hitTargets, options.colorScheme ?? 'light', options.typeScale ?? 1)
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
  const background = screenBackground(ui.content, scheme) ?? systemBackground(scheme)
  const converter = new Converter(hitTargets, scheme, options.typeScale ?? 1, safeArea, background)
  converter.useGuideRunner(options.callGuide ?? null)

  const body = converter.convertList(ui.content, 'v', 'vertical')

  // A search field belongs above the content, not inside it, which is where iOS puts
  // it and what stops it scrolling away with the list.
  const content = ui.search
    ? {
        kind: 'stack' as const,
        id: 'root-search',
        axis: 'vertical' as const,
        spacing: 0,
        alignment: CENTER,
        children: [
          converter.searchField(ui.search.text, ui.search.prompt, ui.search.path),
          joinRoot(body, 'vertical'),
        ],
      }
    : joinRoot(body, 'vertical')

  const navigationBar = ui.navigationBar
    ? {
        element: converter.navigationBar(ui.navigationBar),
        height: NAV_BAR_HEIGHT + (ui.navigationBar.large ? LARGE_TITLE_HEIGHT : 0),
      }
    : null

  const tabBar = ui.tabBar ? converter.tabBar(ui.tabBar) : null

  const overlay = ui.overlay
    ? {
        element: converter.overlay(ui.overlay),
        kind: ui.overlay.kind,
        detent: ui.overlay.detent,
        dismissId: ui.overlay.dismissId,
      }
    : null

  return {
    content,
    background,
    ignoresSafeArea: ui.ignoresSafeArea,
    navigationBar,
    tabBar,
    overlay,
    hitTargets,
  }
}

/**
 * The colour the screen is, decided by what the content is.
 *
 * Two rules, in order. A root view with its own `.background(…)` means it: writing
 * `.background(Color(.systemGroupedBackground))` on the outermost view is how most
 * people set a screen colour, and until now that painted the content's frame and
 * left the navigation bar above it a different colour. Otherwise a grouped `List`
 * or `Form` implies `systemGroupedBackground`, which is what iOS puts behind one.
 *
 * The walk skips wrappers that contribute nothing of their own - a
 * `NavigationStack` around a `List` is still a list screen. Returns null when
 * nothing says otherwise, so the caller can apply the plain system background.
 */
function screenBackground(views: readonly ViewValue[], scheme: ColorScheme): RGBA | null {
  for (const view of views) {
    if (TRANSPARENT_VIEWS.has(view.name)) {
      const inner = screenBackground(view.children, scheme)
      if (inner) return inner
      continue
    }

    const explicit = resolveFillArg(modifierArg(view, 'background', 0), scheme)
    // Only a flat colour. A gradient or a material behind the content does not
    // extend under the bar on iOS either, so matching it would be inventing.
    if (explicit?.kind === 'solid' && explicit.color.a > 0.95) return explicit.color

    if (view.name === 'List' || view.name === 'Form') {
      const style = tokenName(modifierArg(view, 'listStyle', 0)) ?? 'insetGrouped'
      if (style !== 'plain' && style !== 'sidebar') {
        return colorForName('systemGroupedBackground', scheme)
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
  readonly toggle?: string
  readonly picker?: string
  readonly label?: string
  readonly progressView?: string
  readonly gauge?: string
  readonly controlSize?: string
  readonly buttonBorderShape?: string
}

const STYLE_MODIFIERS: readonly (readonly [string, keyof ControlStyles])[] = [
  ['toggleStyle', 'toggle'],
  ['pickerStyle', 'picker'],
  ['labelStyle', 'label'],
  ['progressViewStyle', 'progressView'],
  ['gaugeStyle', 'gauge'],
  ['controlSize', 'controlSize'],
  ['buttonBorderShape', 'buttonBorderShape'],
]

function withStyles(outer: ControlStyles, view: ViewValue): ControlStyles {
  let next = outer
  for (const [modifier, key] of STYLE_MODIFIERS) {
    const name = tokenName(modifierArg(view, modifier, 0))
    if (name !== null) next = { ...next, [key]: name }
  }
  return next
}

/** How much a `.controlSize` scales a control's padding and text. */
function controlScale(size: string | undefined): number {
  switch (size) {
    case 'mini':
      return 0.75
    case 'small':
      return 0.85
    case 'large':
      return 1.2
    default:
      return 1
  }
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
  return vector.x === 0 && vector.y === 0 && vector.z === 0 ? fallback : vector
}

/** A `Section`'s three parts, or a run of rows written outside any section. */
interface Section {
  readonly header: LayoutElement | null
  readonly footer: LayoutElement | null
  readonly rows: LayoutElement[]
}

class Converter {
  constructor(
    private readonly hitTargets: Map<string, string>,
    private readonly scheme: ColorScheme,
    private readonly typeScale: number,
    private readonly safeArea: EdgeInsets = ZERO_INSETS,
    /** The screen's own background, which the navigation bar has to match. */
    private readonly screenBackground: RGBA = { r: 255, g: 255, b: 255, a: 1 },
  ) {}

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

  private symbolImage(id: string, name: string): LayoutElement {
    const symbol = resolveSymbol(name)
    return {
      kind: 'image',
      id,
      glyph: symbol.glyph,
      resizable: false,
      approximated: symbol.approximated,
      symbol: name,
    }
  }

  /** The navigation bar: a translucent strip with a title and its bar buttons. */
  navigationBar(bar: ResolvedUI['navigationBar'] & object): LayoutElement {
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
            ...bar.leading.map((item, i) => this.convert(item, `navbar-l${i}`, 'horizontal')),
            { kind: 'spacer', id: 'navbar-gap-l', axis: 'horizontal', minLength: 0 },
            ...bar.trailing.map((item, i) => this.convert(item, `navbar-t${i}`, 'horizontal')),
          ],
        },
        // A large-title bar has no inline title; emitting an empty text node would
        // put an invisible, un-hoverable row in the inspector for no reason.
        ...(bar.large
          ? []
          : [this.styledText('navbar-title', bar.title, 'headline', 'label')]),
      ],
    }

    const strip: LayoutElement = {
      kind: 'modified',
      id: 'navbar-pad',
      modifier: { kind: 'padding', insets: insets(0, ROW_INSET, 0, ROW_INSET) },
      child: inline,
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
              modifier: { kind: 'frame', height: NAV_BAR_HEIGHT, alignment: CENTER },
              child: strip,
            },
            {
              kind: 'modified',
              id: 'navbar-large-pad',
              modifier: { kind: 'padding', insets: insets(0, ROW_INSET, 8, ROW_INSET) },
              child: this.styledText('navbar-large-title', bar.title, 'largeTitle', 'label', 700),
            },
          ],
        }
      : {
          kind: 'modified',
          id: 'navbar-strip',
          modifier: { kind: 'frame', height: NAV_BAR_HEIGHT, alignment: CENTER },
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
  private tabLabel(view: ViewValue, path: string): LayoutElement {
    const title = stringArg(positional(view.args, 0))
    const systemImage = stringArg(labelled(view.args, 'systemImage'))

    const children: LayoutElement[] = []
    if (systemImage) {
      children.push({
        kind: 'modified',
        id: `${path}iconfont`,
        modifier: { kind: 'font', font: fontForToken('title3', this.typeScale)! },
        child: this.symbolImage(`${path}icon`, systemImage),
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

  /** The tab bar: evenly divided items, the selected one tinted. */
  tabBar(bar: NonNullable<ResolvedUI['tabBar']>): LayoutElement {
    const items = bar.items.map((item, index) => {
      const selected = boolArg(labelled(item.args, 'selected'))
      const tint = selected ? this.color('accentColor') : this.color('secondaryLabel')

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
          modifier: { kind: 'font', font: fontForToken('caption2', this.typeScale)! },
          child: content,
        },
      }

      const expanded: LayoutElement = {
        kind: 'modified',
        id: `tab-${index}-frame`,
        modifier: { kind: 'frame', maxWidth: Number.POSITIVE_INFINITY, alignment: CENTER },
        child: tinted,
      }

      return item.path ? this.withHitTarget(expanded, item.path, 'button', labelOf(item)) : expanded
    })

    const row: LayoutElement = {
      kind: 'modified',
      id: 'tabbar-height',
      modifier: { kind: 'frame', height: TAB_BAR_HEIGHT, alignment: CENTER },
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

    // The hairline iOS draws where the bar meets the content. Unlike a navigation
    // bar's, this one is always present: content scrolls underneath a tab bar, so
    // there is no "at the top" state in which it disappears.
    const withSeparator: LayoutElement = {
      kind: 'stack',
      id: 'tabbar-sep-stack',
      axis: 'vertical',
      spacing: 0,
      alignment: CENTER,
      children: [
        {
          kind: 'modified',
          id: 'tabbar-sep',
          modifier: { kind: 'frame', height: SEPARATOR_HEIGHT, alignment: CENTER },
          child: {
            kind: 'fill',
            id: 'tabbar-sepl',
            fill: { kind: 'solid', color: this.color('separator') },
          },
        },
        row,
      ],
    }

    // The bar's background covers the home-indicator area; its items do not.
    return this.background(
      this.fill(withSeparator, 'tabbar-fill', { horizontal: 'center', vertical: 'top' }),
      'tabbar-bg',
      this.color('systemBackground'),
    )
  }

  /** A sheet, cover, alert, dialog or menu, laid out as its own little screen. */
  overlay(overlay: Overlay): LayoutElement {
    const body = overlay.views.map((v, i) => this.convert(v, `ov-${i}`, 'vertical'))

    if (overlay.kind === 'menu') return this.menuSurface(overlay)

    if (overlay.kind === 'alert' || overlay.kind === 'dialog') {
      const title = this.styledText('ov-title', overlay.title, 'headline', 'label', 600)
      const message = overlay.message
        ? [this.styledText('ov-message', overlay.message, 'footnote', 'secondaryLabel')]
        : []

      // An alert hugs its content vertically and fills the width it is given, which
      // is why only the horizontal axis is filled here.
      return this.background(
        this.fill(
          {
            kind: 'modified',
            id: 'ov-pad',
            modifier: { kind: 'padding', insets: uniformInsets(16) },
            child: {
              kind: 'stack',
              id: 'ov-stack',
              axis: 'vertical',
              spacing: 10,
              alignment: CENTER,
              children: [
                ...(overlay.title ? [title] : []),
                ...message,
                ...body,
              ],
              debugName: overlay.kind === 'alert' ? ALERT : DIALOG,
            },
          },
          'ov-fill',
          CENTER,
          false,
        ),
        'ov-bg',
        this.color('secondarySystemGroupedBackground'),
        14,
      )
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
        ...(overlay.kind === 'sheet'
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
      overlay.kind === 'sheet' ? 12 : 0,
    )
  }

  // ----------------------------------------------------------------- content

  convertList(views: readonly ViewValue[], prefix: string, axis: Axis): LayoutElement[] {
    const out: LayoutElement[] = []
    views.forEach((view, index) => {
      const path = view.path ?? `${prefix}-${index}`
      // A `Group` is not a container - it exists so a builder can exceed its child
      // limit, and its children belong to the enclosing stack. `ForEach` is the same:
      // its rows are siblings of whatever surrounds it, never a nested stack.
      //
      // A `ForEach` stays transparent even when it carries modifiers, because the
      // modifiers it carries - `.onDelete`, `.onMove` - describe the *collection*
      // rather than a box around it. Treating it as opaque made an entire list
      // collapse into one unrecognised view.
      if (isTransparent(view)) {
        out.push(...this.convertList(view.children, path, axis))
        return
      }
      out.push(this.convert(view, path, axis))
    })
    return out
  }

  convert(view: ViewValue, fallbackPath: string, parentAxis: Axis): LayoutElement {
    const path = view.path ?? fallbackPath
    const outer = this.styles
    this.styles = withStyles(outer, view)
    try {
      return this.convertInner(view, path, parentAxis)
    } finally {
      this.styles = outer
    }
  }

  private convertInner(view: ViewValue, path: string, parentAxis: Axis): LayoutElement {
    let element = this.baseElement(view, path, parentAxis)

    // Modifiers wrap outward in source order, so `.padding().background()` nests as
    // background(padding(view)) and therefore covers the padding.
    for (const [index, modifier] of view.modifiers.entries()) {
      const converted = this.convertModifier(modifier, `${path}m${index}`, view)
      if (!converted) continue
      element = { kind: 'modified', id: `${path}m${index}`, modifier: converted, child: element }
    }

    // The tap area covers everything the modifiers added, so the hit target goes
    // outermost - tapping a button's padding must count, exactly as on iOS.
    if (view.intent) {
      element = this.withHitTarget(element, path, roleOf(view), labelOf(view), view, disabledBy(view))
    }

    return element
  }

  private withHitTarget(
    element: LayoutElement,
    path: string,
    role: HitRole,
    label: string,
    view?: ViewValue,
    disabled = false,
    override?: { value?: string; placeholder?: string; min?: number; max?: number },
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
      },
      child: element,
      ...(view?.span ? { origin: view.span } : {}),
    }
  }

  /** Values a real DOM control needs: a text field's contents, a slider's range. */
  private controlState(view: ViewValue): {
    value?: string
    placeholder?: string
    min?: number
    max?: number
  } {
    switch (view.name) {
      case 'TextField':
      case 'SecureField': {
        const bound = bindingValue(labelled(view.args, 'text'))
        return {
          value: bound?.kind === 'string' ? bound.value : '',
          placeholder: stringArg(positional(view.args, 0)) ?? '',
        }
      }
      case 'Slider': {
        const bound = bindingValue(labelled(view.args, 'value'))
        const range = labelled(view.args, 'in')
        return {
          value: String(numberArg(bound ?? undefined) ?? 0),
          min: range?.kind === 'range' ? range.lower : 0,
          max: range?.kind === 'range' ? range.upper : 1,
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
          spacing: numberArg(labelled(view.args, 'spacing')) ?? defaultSpacing(),
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
          minLength: numberArg(labelled(view.args, 'minLength')) ?? 0,
          ...origin,
        }

      case 'Divider':
        return this.divider(path, parentAxis, origin)

      case 'EmptyView':
        return { kind: 'empty', id: path, ...origin }

      case 'Path': {
        const payload = asPath(positional(view.args, 0))
        if (!payload) return { kind: 'empty', id: path, ...origin }

        const fill = resolveFillArg(modifierArg(view, 'fill', 0), this.scheme)
        const strokeColor = resolveColorArg(modifierArg(view, 'stroke', 0), this.scheme)
        const strokeWidth =
          numberArg(modifierNamedArg(view, 'stroke', 'lineWidth')) ??
          numberArg(modifierArg(view, 'stroke', 1)) ??
          strokeStyleWidth(view) ??
          1

        const trimmed = trimOf(view) ?? payload.trim
        return {
          kind: 'path',
          id: path,
          d: toSVGPath(applyTrim({ commands: payload.commands, trim: trimmed })),
          fill: fill ?? null,
          stroke: strokeColor ? { color: strokeColor, width: strokeWidth } : null,
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
            const fill = resolveFillArg(drawing.fill ?? undefined, this.scheme)
            const stroke = resolveColorArg(drawing.stroke ?? undefined, this.scheme)
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
        const fill = resolveFillArg(positional(view.args, 0), this.scheme)
        return fill
          ? { kind: 'fill', id: path, fill, ...origin }
          : { kind: 'empty', id: path, ...origin }
      }

      case 'ScrollView':
        return this.scrollView(view, path, origin)

      case 'List':
        return this.list(view, path, origin)

      case 'Section':
        // A bare `Section` outside a `List` is just its content, which is what
        // SwiftUI does with one too.
        return {
          kind: 'stack',
          id: path,
          axis: 'vertical',
          spacing: 0,
          alignment: { horizontal: 'leading', vertical: 'center' },
          children: this.convertList(view.children, path, 'vertical'),
          ...origin,
        }

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
      case 'Menu':
        return this.picker(view, path, origin)

      case 'Link':
      case 'ShareLink':
        return this.link(view, path, origin)

      case 'AsyncImage':
        return this.asyncImage(view, path, origin)

      case 'DatePicker':
      case 'ColorPicker':
        return this.picker(view, path, origin)

      case 'TextEditor':
        return this.textField({ ...view, name: 'TextField' }, path, origin)

      case 'DisclosureGroup':
        return this.disclosureGroup(view, path, origin)

      case 'GroupBox':
        return this.groupBox(view, path, origin)

      case 'LabeledContent':
        return this.labeledContent(view, path, origin)

      case 'ControlGroup':
        return this.controlGroup(view, path, origin)

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

    const shape = SHAPES[view.name]
    if (shape) {
      const radius = numberArg(labelled(view.args, 'cornerRadius'))
      const fill = resolveFillArg(modifierArg(view, 'fill', 0), this.scheme)
      const strokeColor = resolveColorArg(modifierArg(view, 'stroke', 0), this.scheme)
      const strokeWidth =
        numberArg(modifierNamedArg(view, 'stroke', 'lineWidth')) ??
        numberArg(modifierArg(view, 'stroke', 1)) ??
        strokeStyleWidth(view) ??
        1

      return {
        kind: 'shape',
        id: path,
        shape,
        ...(radius !== null ? { cornerRadius: radius } : {}),
        ...(fill ? { fill } : {}),
        ...(strokeColor ? { stroke: { color: strokeColor, width: strokeWidth } } : {}),
        ...origin,
      }
    }

    // A real SwiftUI view the preview cannot draw yet renders as a labelled box
    // naming the feature, never as a blank space (FR-4.11).
    return {
      kind: 'placeholder',
      id: path,
      feature: view.name,
      reason: UNIMPLEMENTED_VIEWS.has(view.name)
        ? 'Real SwiftUI that the preview does not draw. It exports to Xcode unchanged.'
        : 'Not recognised by the preview.',
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
    let font: { family?: string; size?: number; weight?: number; italic?: boolean } | undefined
    let color: RGBA | undefined
    let underline: boolean | undefined
    let strikethrough: boolean | undefined
    let tracking: number | undefined
    let baselineOffset: number | undefined

    const face = (patch: { family?: string; size?: number; weight?: number; italic?: boolean }) => {
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
          face({ weight: 700 })
          break
        case 'italic':
          face({ italic: true })
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
                  : UI_FONT_FAMILY,
          })
          break
        }
        case 'foregroundColor':
        case 'foregroundStyle': {
          const resolved = resolveColorArg(first, this.scheme)
          if (resolved) color = resolved
          break
        }
        case 'underline':
          underline = first === undefined ? true : first.kind === 'bool' ? first.value : true
          break
        case 'strikethrough':
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
      ...(underline !== undefined ? { underline } : {}),
      ...(strikethrough !== undefined ? { strikethrough } : {}),
      ...(tracking !== undefined ? { tracking } : {}),
      ...(baselineOffset !== undefined ? { baselineOffset } : {}),
    }
  }

  /**
   * `GroupBox { … }` - a titled card.
   *
   * iOS draws it as secondary-background panel with a 12pt radius and the label
   * above it in the body font, which is what this builds. It was one of the
   * placeholders that failed the fourteen-snippet measure, and it is a container
   * rather than a control: nothing about it needed a new mechanism, only the drawing.
   */
  private groupBox(view: ViewValue, path: string, origin: object): LayoutElement {
    const title = stringArg(positional(view.args, 0)) ?? argText(view, 'label')

    const content: LayoutElement = {
      kind: 'stack',
      id: `${path}body`,
      axis: 'vertical',
      spacing: 8,
      alignment: { horizontal: 'leading', vertical: 'center' },
      children: this.convertList(view.children, `${path}c`, 'vertical'),
    }

    const padded: LayoutElement = {
      kind: 'modified',
      id: `${path}pad`,
      modifier: { kind: 'padding', insets: uniformInsets(14) },
      child: {
        kind: 'modified',
        id: `${path}wide`,
        modifier: {
          kind: 'frame',
          maxWidth: Number.POSITIVE_INFINITY,
          alignment: { horizontal: 'leading', vertical: 'center' },
        },
        child: content,
      },
    }

    const card = this.background(
      padded,
      `${path}bg`,
      this.color('secondarySystemGroupedBackground'),
      12,
    )

    if (!title) return { ...card, ...origin }

    return {
      kind: 'stack',
      id: path,
      axis: 'vertical',
      spacing: 8,
      alignment: { horizontal: 'leading', vertical: 'center' },
      children: [this.styledText(`${path}t`, title, 'body', 'label', 600), card],
      ...origin,
    }
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

  private divider(path: string, parentAxis: Axis, origin: object): LayoutElement {
    const line: LayoutElement = {
      kind: 'fill',
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
          ? { kind: 'frame', height: SEPARATOR_HEIGHT, alignment: CENTER }
          : { kind: 'frame', width: SEPARATOR_HEIGHT, alignment: CENTER },
      child: line,
    }
  }

  private scrollView(view: ViewValue, path: string, origin: object): LayoutElement {
    const axisToken = tokenName(positional(view.args, 0))
    const axis: Axis = axisToken === 'horizontal' ? 'horizontal' : 'vertical'
    const indicators = boolArg(labelled(view.args, 'showsIndicators')) ?? true

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
    const style = tokenName(modifierArg(view, 'listStyle', 0)) ?? (view.name === 'Form' ? 'insetGrouped' : 'insetGrouped')
    const grouped = style !== 'plain' && style !== 'sidebar'

    const sections = this.listSections(view, path)
    const blocks: LayoutElement[] = []

    sections.forEach((section, index) => {
      if (section.header) {
        blocks.push({
          kind: 'modified',
          id: `${path}s${index}h`,
          modifier: {
            kind: 'padding',
            insets: insets(index === 0 ? 8 : 24, grouped ? ROW_INSET + 16 : ROW_INSET, 6, ROW_INSET),
          },
          child: {
            kind: 'modified',
            id: `${path}s${index}hf`,
            modifier: { kind: 'frame', maxWidth: Number.POSITIVE_INFINITY, alignment: { horizontal: 'leading', vertical: 'center' } },
            child: section.header,
          },
        })
      }

      const rows: LayoutElement[] = []
      section.rows.forEach((row, rowIndex) => {
        rows.push(row)
        if (rowIndex < section.rows.length - 1) {
          rows.push({
            kind: 'modified',
            id: `${path}s${index}r${rowIndex}sep`,
            modifier: { kind: 'padding', insets: insets(0, ROW_INSET, 0, 0) },
            child: {
              kind: 'modified',
              id: `${path}s${index}r${rowIndex}sepf`,
              modifier: { kind: 'frame', height: SEPARATOR_HEIGHT, alignment: CENTER },
              child: {
                kind: 'fill',
                id: `${path}s${index}r${rowIndex}sepl`,
                fill: { kind: 'solid', color: this.color('separator') },
              },
            },
          })
        }
      })

      const group: LayoutElement = {
        kind: 'stack',
        id: `${path}s${index}`,
        axis: 'vertical',
        spacing: 0,
        alignment: CENTER,
        children: rows,
      }

      const card = this.background(
        group,
        `${path}s${index}bg`,
        this.color(grouped ? 'secondarySystemGroupedBackground' : 'systemBackground'),
        grouped ? 10 : 0,
      )

      blocks.push(
        grouped
          ? {
              kind: 'modified',
              id: `${path}s${index}inset`,
              modifier: { kind: 'padding', insets: insets(0, ROW_INSET, 0, ROW_INSET) },
              child: card,
            }
          : card,
      )

      if (section.footer) {
        blocks.push({
          kind: 'modified',
          id: `${path}s${index}f`,
          modifier: {
            kind: 'padding',
            insets: insets(6, grouped ? ROW_INSET + 16 : ROW_INSET, 0, ROW_INSET),
          },
          child: {
            kind: 'modified',
            id: `${path}s${index}ff`,
            modifier: {
              kind: 'frame',
              maxWidth: Number.POSITIVE_INFINITY,
              alignment: { horizontal: 'leading', vertical: 'center' },
            },
            child: section.footer,
          },
        })
      }
    })

    const column: LayoutElement = {
      kind: 'stack',
      id: `${path}rows`,
      axis: 'vertical',
      spacing: 0,
      alignment: CENTER,
      children: [
        ...blocks,
        { kind: 'modified', id: `${path}tail`, modifier: { kind: 'frame', height: 24, alignment: CENTER }, child: { kind: 'empty', id: `${path}tailx` } },
      ],
      ...origin,
    }

    return this.background(
      { kind: 'scroll', id: path, axis: 'vertical', showsIndicators: true, content: column, ...origin },
      `${path}bg`,
      this.color(grouped ? 'systemGroupedBackground' : 'systemBackground'),
    )
  }

  /** Splits a list's children into sections, wrapping each child as a row. */
  private listSections(view: ViewValue, path: string): Section[] {
    const sections: Section[] = []
    let current: Section = { header: null, footer: null, rows: [] }

    const flatten = (views: readonly ViewValue[]): ViewValue[] =>
      views.flatMap((v) => (v.name === 'ForEach' ? flatten(v.children) : [v]))

    for (const child of flatten(view.children)) {
      if (child.name === 'Section') {
        if (current.rows.length > 0 || current.header) sections.push(current)
        const id = child.path ?? path
        const title = stringArg(positional(child.args, 0)) ?? argText(child, 'header')
        const footer = argText(child, 'footer')
        current = {
          header: title
            ? this.styledText(`${id}hdr`, title.toUpperCase(), 'caption', 'secondaryLabel')
            : null,
          // Sentence case and left aligned under the card, which is how iOS draws the
          // explanatory line under a group of settings.
          footer: footer ? this.styledText(`${id}ftr`, footer, 'caption', 'secondaryLabel') : null,
          rows: flatten(child.children).map((row) => this.listRow(row, path)),
        }
        sections.push(current)
        current = { header: null, footer: null, rows: [] }
        continue
      }
      current.rows.push(this.listRow(child, path))
    }

    if (current.rows.length > 0 || current.header) sections.push(current)
    return sections
  }

  /**
   * Hoists a hit target out so it wraps the whole row rather than the row's label.
   *
   * A `NavigationLink` arrives already wrapped in its own hit target, sized to the
   * text inside it - about 22pt of a 44pt row. Everything below the words was
   * therefore dead: tapping the lower half of a list row did nothing, which is not
   * how any list on iOS behaves. Re-applying the same target around the padded,
   * 44pt-tall row makes the whole row the control, as it should be.
   */
  private hoistHitTarget(
    content: LayoutElement,
    wrap: (inner: LayoutElement) => LayoutElement,
  ): LayoutElement {
    if (content.kind === 'modified' && content.modifier.kind === 'hitTarget') {
      return { ...content, child: wrap(content.child) }
    }
    return wrap(content)
  }

  /** One list row: system insets, a 44pt floor, and any row background applied. */
  private listRow(view: ViewValue, fallback: string): LayoutElement {
    const path = view.path ?? fallback
    const raw = view.swipe
      ? this.swipeableRow(view, this.convert(view, path, 'horizontal'), path)
      : this.convert(view, path, 'horizontal')

    return this.hoistHitTarget(raw, (content) => this.sizedRow(view, path, content))
  }

  /** The row box: insets, a 44pt floor, and any `.listRowBackground`. */
  private sizedRow(view: ViewValue, path: string, content: LayoutElement): LayoutElement {
    const padded: LayoutElement = {
      kind: 'modified',
      id: `${path}rowpad`,
      modifier: { kind: 'padding', insets: insets(11, ROW_INSET, 11, ROW_INSET) },
      child: content,
    }

    const sized: LayoutElement = {
      kind: 'modified',
      id: `${path}rowsize`,
      modifier: {
        kind: 'frame',
        maxWidth: Number.POSITIVE_INFINITY,
        minHeight: ROW_MIN_HEIGHT,
        alignment: { horizontal: 'leading', vertical: 'center' },
      },
      child: padded,
    }

    const rowBackground = resolveFillArg(modifierArg(view, 'listRowBackground', 0), this.scheme)
    return rowBackground
      ? {
          kind: 'modified',
          id: `${path}rowbg`,
          modifier: { kind: 'background', content: { kind: 'fill', id: `${path}rowbgf`, fill: rowBackground } },
          child: sized,
        }
      : sized
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
      rowSpacing: numberArg(labelled(view.args, 'verticalSpacing')) ?? defaultSpacing(),
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
      trackSpacing: tracks[0]?.kind === 'adaptive' ? spacing : spacing,
      alignment: CENTER,
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
      // An asset image: we have no bitmap for it, so a labelled box is the honest
      // answer rather than a grey rectangle pretending to be the artwork.
      return {
        kind: 'placeholder',
        id: path,
        feature: `Image("${assetName}")`,
        reason: 'Asset images are not bundled with the preview.',
        ...origin,
      }
    }

    const symbol = resolveSymbol(systemName ?? '')
    return {
      kind: 'image',
      id: path,
      glyph: symbol.glyph,
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
        resizable: false,
        approximated: symbol.approximated,
        ...(systemImage ? { symbol: systemImage } : {}),
      })
    }
    if (title !== null && wantsTitle) children.push({ kind: 'text', id: `${path}title`, text: title })
    if (wantsTitle || !symbol) children.push(...this.convertList(view.children, path, 'horizontal'))

    return {
      kind: 'stack',
      id: path,
      axis: 'horizontal',
      spacing: 6,
      alignment: CENTER,
      children,
      ...origin,
    }
  }

  private button(view: ViewValue, path: string, origin: object): LayoutElement {
    const title = stringArg(positional(view.args, 0))
    // `Button { save() } label: { … }` puts the content in a labelled argument,
    // because the unlabelled trailing closure is already the action.
    const content = view.children.length > 0 ? view.children : argViews(view, 'label')
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

    const styled: LayoutElement = {
      kind: 'modified',
      id: `${path}style`,
      modifier: { kind: 'font', font: bodyFont(this.typeScale) },
      child: label,
      ...origin,
    }

    return this.applyButtonStyle(view, styled, path)
  }

  /** `.bordered` and `.borderedProminent` are shape-and-fill, not just a tint. */
  private applyButtonStyle(view: ViewValue, label: LayoutElement, path: string): LayoutElement {
    const style = tokenName(modifierArg(view, 'buttonStyle', 0))
    if (style !== 'bordered' && style !== 'borderedProminent') return label

    const prominent = style === 'borderedProminent'
    const tint = resolveColorArg(modifierArg(view, 'tint', 0), this.scheme) ?? this.color('accentColor')

    // `.controlSize` scales the padding, which is what makes a `.small` button small:
    // the label's font is the environment's and is not touched here.
    const scale = controlScale(this.styles.controlSize)
    const padV = Math.round(7 * scale)
    const padH = Math.round(14 * scale)

    // `.buttonBorderShape` changes only the corner. A capsule is half the button's
    // height, which the layout does not know yet, so the radius is large enough to
    // round any control-height box and is clamped by the renderer.
    const radius =
      this.styles.buttonBorderShape === 'capsule'
        ? 999
        : this.styles.buttonBorderShape === 'circle'
          ? 999
          : 8

    const tinted: LayoutElement = {
      kind: 'modified',
      id: `${path}btncolor`,
      modifier: {
        kind: 'foregroundStyle',
        color: prominent ? rgba(255, 255, 255) : tint,
      },
      child: label,
    }

    const padded: LayoutElement = {
      kind: 'modified',
      id: `${path}btnpad`,
      modifier: { kind: 'padding', insets: insets(padV, padH, padV, padH) },
      child: tinted,
    }

    // Through the helper, which puts the radius *outside* the background. Written
    // inside-out here until now, and a corner radius only reaches a fill through the
    // inherited environment - so a bordered button has been drawing square corners
    // since the style was added, which no test asserted either way.
    return this.background(
      padded,
      `${path}btn`,
      prominent ? tint : { ...tint, a: tint.a * 0.15 },
      radius,
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
    // Outside one, a `NavigationLink` is however its label looks and nothing more,
    // which is the whole reason people wrap cards in them.
    if (this.listDepth === 0) {
      return {
        kind: 'stack',
        id: path,
        axis: 'horizontal',
        spacing: 0,
        alignment: CENTER,
        children: [label],
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
        label,
        { kind: 'spacer', id: `${path}gap`, axis: 'horizontal', minLength: 8 },
        {
          kind: 'modified',
          id: `${path}chevcolor`,
          modifier: { kind: 'foregroundStyle', color: this.color('tertiaryLabel') },
          child: {
            kind: 'modified',
            id: `${path}chevfont`,
            modifier: { kind: 'font', font: fontForToken('footnote', this.typeScale)! },
            child: this.symbolImage(`${path}chev`, 'chevron.right'),
          },
        },
      ],
      ...origin,
    }
  }

  private backButton(view: ViewValue, path: string, origin: object): LayoutElement {
    const title = stringArg(labelled(view.args, 'title')) ?? 'Back'

    return {
      kind: 'modified',
      id: `${path}tint`,
      modifier: { kind: 'foregroundStyle', color: this.color('accentColor') },
      child: {
        kind: 'stack',
        id: path,
        axis: 'horizontal',
        spacing: 4,
        alignment: CENTER,
        children: [
          this.symbolImage(`${path}chev`, 'chevron.left'),
          { kind: 'text', id: `${path}title`, text: title },
        ],
        ...origin,
      },
    }
  }

  private toggle(view: ViewValue, path: string, origin: object): LayoutElement {
    const on = truthyBinding(labelled(view.args, 'isOn'))
    const title = stringArg(positional(view.args, 0))
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
            children: this.convertList(view.children, `${path}label`, 'horizontal'),
          }

    const knob: LayoutElement = {
      kind: 'modified',
      id: `${path}knobframe`,
      modifier: { kind: 'frame', width: SWITCH.knob, height: SWITCH.knob, alignment: CENTER },
      child: { kind: 'shape', id: `${path}knob`, shape: 'circle' },
    }

    const track: LayoutElement = {
      kind: 'modified',
      id: `${path}switchframe`,
      modifier: { kind: 'frame', width: SWITCH.width, height: SWITCH.height, alignment: CENTER },
      child: {
        kind: 'zstack',
        id: `${path}switch`,
        alignment: { horizontal: on ? 'trailing' : 'leading', vertical: 'center' },
        children: [
          {
            kind: 'modified',
            id: `${path}trackround`,
            modifier: { kind: 'cornerRadius', radius: SWITCH.height / 2 },
            child: {
              kind: 'fill',
              id: `${path}track`,
              fill: {
                kind: 'solid',
                color: on ? this.color('green') : this.color('systemFill'),
              },
            },
          },
          {
            kind: 'modified',
            id: `${path}knobpad`,
            modifier: { kind: 'padding', insets: insets(0, 2, 0, 2) },
            child: {
              kind: 'modified',
              id: `${path}knobcolor`,
              modifier: { kind: 'foregroundStyle', color: rgba(255, 255, 255) },
              child: knob,
            },
          },
        ],
      },
    }

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
                ? { ...this.color('accentColor'), a: 0.18 }
                : this.color('systemFill'),
            },
          },
        },
        child: {
          kind: 'modified',
          id: `${path}btnradius`,
          modifier: { kind: 'cornerRadius', radius: 8 },
          child: {
            kind: 'modified',
            id: `${path}btnpad`,
            modifier: { kind: 'padding', insets: insets(7, 14, 7, 14) },
            child: tinted,
          },
        },
        ...origin,
      }
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
    const style = tokenName(modifierArg(view, 'textFieldStyle', 0))
    const bordered = style === 'roundedBorder'

    // The text itself is drawn by a real `<input>` in the renderer - a caret and an
    // IME cannot be faked - so the layout reserves the box and paints only the frame.
    const box: LayoutElement = {
      kind: 'modified',
      id: `${path}frame`,
      modifier: { kind: 'frame', maxWidth: Number.POSITIVE_INFINITY, height: 36, alignment: CENTER },
      child: { kind: 'empty', id: `${path}inner` },
      ...origin,
    }

    if (!bordered) return box

    return {
      kind: 'modified',
      id: `${path}border`,
      modifier: {
        kind: 'border',
        color: this.color('separator'),
        width: 1,
        cornerRadius: 6,
      },
      child: box,
    }
  }

  private slider(view: ViewValue, path: string, origin: object): LayoutElement {
    void view
    return {
      kind: 'modified',
      id: `${path}frame`,
      modifier: { kind: 'frame', maxWidth: Number.POSITIVE_INFINITY, height: 30, alignment: CENTER },
      child: { kind: 'empty', id: `${path}inner` },
      ...origin,
    }
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

    const control = this.background(
      {
        kind: 'modified',
        id: `${path}ctrlframe`,
        modifier: { kind: 'frame', width: 94, height: 32, alignment: CENTER },
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
            this.withHitTarget(
              this.glyphButton(`${path}minus`, 'minus'),
              `${path}/minus`,
              'button',
              'Decrement',
            ),
            {
              kind: 'modified',
              id: `${path}divframe`,
              modifier: { kind: 'frame', width: SEPARATOR_HEIGHT, height: 20, alignment: CENTER },
              child: { kind: 'fill', id: `${path}div`, fill: { kind: 'solid', color: this.color('separator') } },
            },
            this.withHitTarget(
              this.glyphButton(`${path}plus`, 'plus'),
              `${path}/plus`,
              'button',
              'Increment',
            ),
          ],
        },
      },
      `${path}ctrlbg`,
      this.color('systemFill'),
      8,
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
    const glyph = resolveSymbol(symbol)
    return {
      kind: 'modified',
      id: `${id}frame`,
      modifier: { kind: 'frame', width: 46, height: 32, alignment: CENTER },
      child: {
        kind: 'image',
        id,
        glyph: glyph.glyph,
        resizable: false,
        approximated: true,
      },
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
      // Indeterminate: iOS draws a spinner. A dotted ring is the closest honest
      // static approximation, and the renderer spins it.
      return {
        kind: 'modified',
        id: `${path}frame`,
        modifier: { kind: 'frame', width: 20, height: 20, alignment: CENTER },
        child: {
          kind: 'modified',
          id: `${path}color`,
          modifier: { kind: 'foregroundStyle', color: this.color('secondaryLabel') },
          child: { kind: 'shape', id: path, shape: 'circle', ...origin },
        },
      }
    }

    const fraction = total === 0 ? 0 : Math.max(0, Math.min(1, value / total))
    const bar: LayoutElement = {
      kind: 'modified',
      id: `${path}barframe`,
      modifier: { kind: 'frame', maxWidth: Number.POSITIVE_INFINITY, height: 4, alignment: CENTER },
      child: {
        kind: 'zstack',
        id: `${path}bar`,
        alignment: { horizontal: 'leading', vertical: 'center' },
        children: [
          {
            kind: 'modified',
            id: `${path}trackround`,
            modifier: { kind: 'cornerRadius', radius: 2 },
            child: { kind: 'fill', id: `${path}track`, fill: { kind: 'solid', color: this.color('systemFill') } },
          },
          {
            kind: 'modified',
            id: `${path}fillframe`,
            modifier: {
              kind: 'frame',
              maxWidth: fraction <= 0 ? 0 : Number.POSITIVE_INFINITY,
              alignment: { horizontal: 'leading', vertical: 'center' },
            },
            child: {
              kind: 'modified',
              id: `${path}fillscale`,
              modifier: { kind: 'scale', x: fraction, y: 1 },
              child: {
                kind: 'modified',
                id: `${path}fillround`,
                modifier: { kind: 'cornerRadius', radius: 2 },
                child: { kind: 'fill', id: `${path}fill`, fill: { kind: 'solid', color: this.color('accentColor') } },
              },
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
      spacing: 6,
      alignment: { horizontal: 'leading', vertical: 'center' },
      children: [this.styledText(`${path}title`, title, 'footnote', 'secondaryLabel'), bar],
    }
  }

  private picker(view: ViewValue, path: string, origin: object): LayoutElement {
    const title = stringArg(positional(view.args, 0)) ?? argText(view, 'label') ?? ''
    const selection = bindingValue(labelled(view.args, 'selection'))
    const value = selection ? displayValue(selection) : ''

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
        modifier: { kind: 'font', font: fontForToken('subheadline', this.typeScale)! },
        child: {
          kind: 'modified',
          id: `${path}seg${index}pad`,
          modifier: { kind: 'padding', insets: insets(6, 12, 6, 12) },
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

      const pill: LayoutElement = chosen
        ? this.background(content, `${path}seg${index}bg`, this.color('systemBackground'), 7)
        : content

      return this.withHitTarget(
        pill,
        `${path}/seg-${index}`,
        'button',
        textIn(child).join(' '),
        child,
        false,
      )
    })

    const row: LayoutElement = {
      kind: 'stack',
      id: `${path}segs`,
      axis: 'horizontal',
      spacing: 2,
      alignment: CENTER,
      children: segments,
    }

    return {
      ...this.background(
        { kind: 'modified', id: `${path}segpad`, modifier: { kind: 'padding', insets: uniformInsets(2) }, child: row },
        `${path}segtrack`,
        this.color('systemFill'),
        9,
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
          modifier: { kind: 'frame', height: SEPARATOR_HEIGHT, alignment: CENTER },
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
      14,
    )
  }

  private disclosureGroup(view: ViewValue, path: string, origin: object): LayoutElement {
    const title = stringArg(positional(view.args, 0)) ?? ''
    // Stamped by the resolver, which owns the open/closed state. A group drawn
    // without one has not been through it, so it draws closed rather than guessing.
    const expanded = boolArg(labelled(view.args, 'isExpanded'))

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
          modifier: { kind: 'foregroundStyle', color: this.color('tertiaryLabel') },
          // The chevron is the state: down when open, trailing when closed, which is
          // what iOS draws and the only thing on screen that says which it is.
          child: this.symbolImage(`${path}chev`, expanded ? 'chevron.down' : 'chevron.right'),
        },
      ],
    }

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

  /** `Gauge` - a labelled bar, which is the accessible form of every gauge style. */
  private gauge(view: ViewValue, path: string, origin: object): LayoutElement {
    const value = numberArg(bindingValue(labelled(view.args, 'value')) ?? undefined) ?? 0
    const range = labelled(view.args, 'in')
    const min = range?.kind === 'range' ? range.lower : 0
    const max = range?.kind === 'range' ? range.upper : 1
    const fraction = max === min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)))

    // A gauge is a progress view with a range, so the drawing is shared and only the
    // style name differs: every `accessoryCircular` spelling is a ring, and the rest
    // are the bar. Translated here rather than duplicating the two drawings.
    const gaugeStyle = this.styles.gauge ?? ''
    const outer = this.styles
    this.styles = {
      ...outer,
      progressView: gaugeStyle.toLowerCase().includes('circular') ? 'circular' : 'linear',
    }

    try {
      return this.progressView(
        {
          ...view,
          name: 'ProgressView',
          args: [
            { label: 'value', value: { kind: 'double', value: fraction } },
            { label: 'total', value: { kind: 'double', value: 1 } },
          ],
        },
        path,
        origin,
      )
    } finally {
      this.styles = outer
    }
  }

  /** The search field `.searchable` adds above a list. */
  searchField(text: string, placeholder: string, path: string): LayoutElement {
    const glyph = resolveSymbol('magnifyingglass')

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
          child: {
            kind: 'image',
            id: `${path}icon`,
            glyph: glyph.glyph,
            resizable: false,
            approximated: true,
          },
        },
        {
          kind: 'modified',
          id: `${path}fieldframe`,
          modifier: { kind: 'frame', maxWidth: Number.POSITIVE_INFINITY, alignment: CENTER },
          child: { kind: 'empty', id: `${path}field` },
        },
      ],
    }

    const padded: LayoutElement = {
      kind: 'modified',
      id: `${path}pad`,
      modifier: { kind: 'padding', insets: insets(7, 8, 7, 8) },
      child: row,
    }

    const styled = this.background(padded, `${path}bg`, this.color('systemFill'), 10)

    return {
      kind: 'modified',
      id: `${path}outer`,
      modifier: { kind: 'padding', insets: insets(8, ROW_INSET, 8, ROW_INSET) },
      child: this.withHitTarget(styled, path, 'textField', placeholder || 'Search', undefined, false, {
        value: text,
        placeholder: placeholder || 'Search',
      }),
    }
  }

  private link(view: ViewValue, path: string, origin: object): LayoutElement {
    const title = stringArg(positional(view.args, 0)) ?? ''
    return {
      kind: 'modified',
      id: `${path}tint`,
      modifier: { kind: 'foregroundStyle', color: this.color('accentColor') },
      child: { kind: 'text', id: path, text: title, ...origin },
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
        return { kind: 'padding', insets: paddingInsets(args) }

      case 'frame':
        return frameModifier(args)

      case 'background': {
        const content = this.backgroundContent(args, modifier, `${id}bg`)
        return content ? { kind: 'background', content } : null
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
          design === 'rounded' ? ROUNDED_FAMILY : design === 'monospaced' ? MONO_FAMILY : UI_FONT_FAMILY
        return { kind: 'fontTrait', family }
      }


      case 'bold':
        return { kind: 'fontTrait', weight: 700 }

      case 'italic':
        return { kind: 'fontTrait', italic: true }

      case 'foregroundStyle':
      case 'foregroundColor':
      case 'tint': {
        const color = resolveColorArg(args[0]?.value, this.scheme)
        return color ? { kind: 'foregroundStyle', color } : null
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
        }
      }

      case 'clipped':
        return { kind: 'clip', shape: 'rectangle', cornerRadius: 0 }

      case 'border': {
        const color = resolveColorArg(args[0]?.value, this.scheme)
        const width = numberArg(positional(args, 1)) ?? numberArg(labelled(args, 'width')) ?? 1
        return color ? { kind: 'border', color, width } : null
      }

      case 'shadow': {
        const radius = numberArg(labelled(args, 'radius')) ?? numberArg(positional(args, 0)) ?? 4
        const color = resolveColorArg(labelled(args, 'color'), this.scheme) ?? rgba(0, 0, 0, 0.18)
        return {
          kind: 'shadow',
          color,
          radius,
          x: numberArg(labelled(args, 'x')) ?? 0,
          y: numberArg(labelled(args, 'y')) ?? 0,
        }
      }

      case 'offset':
        return {
          kind: 'offset',
          x: numberArg(labelled(args, 'x')) ?? numberArg(positional(args, 0)) ?? 0,
          y: numberArg(labelled(args, 'y')) ?? 0,
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
        return {
          kind: 'scale',
          x: uniform ?? numberArg(labelled(args, 'x')) ?? 1,
          y: uniform ?? numberArg(labelled(args, 'y')) ?? 1,
        }
      }

      case 'rotationEffect': {
        const degrees = angleDegrees(positional(args, 0) ?? labelled(args, 'angle'))
        return degrees === null ? null : { kind: 'rotate', degrees }
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
        const color = resolveColorArg(positional(args, 0), this.scheme)
        return color ? { kind: 'filter', filter: { multiply: color } } : null
      }

      case 'rotation3DEffect': {
        const degrees = angleDegrees(positional(args, 0) ?? labelled(args, 'angle'))
        if (degrees === null) return null
        const axis = labelled(args, 'axis')
        const vector = axisVector(axis)
        return { kind: 'rotate3D', degrees, ...vector }
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
      case 'stroke':
      case 'trim':
        // Read directly off the shape or path they style, not applied as wrappers.
        return null

      case 'ignoresSafeArea':
        // Read by the pipeline, which owns the device's edges. `.safeAreaInset` was
        // grouped here and is not: nothing read it, and it was in the unimplemented
        // list at the same time - so it both warned and was claimed to be handled.
        return null

      case 'zIndex':
      case 'id':
      case 'listRowSeparator':
      case 'listRowInsets':
      case 'scrollIndicators':
      case 'keyboardType':
      case 'submitLabel':
      case 'onSubmit':
      case 'focused':
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
      case 'placeholder':
      case 'contextMenu':
      case 'badge':
        // Recognised, and either read elsewhere or deliberately inert. Recorded as
        // applied rather than as a coverage gap, because the code *is* honoured -
        // just not by a wrapper around this view.
        return null

      case 'monospaced':
        return { kind: 'font', font: monospacedFont(this.typeScale) }



      case 'position':
        return {
          kind: 'position',
          x: numberArg(labelled(args, 'x')) ?? numberArg(positional(args, 0)) ?? 0,
          y: numberArg(labelled(args, 'y')) ?? numberArg(positional(args, 1)) ?? 0,
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
        const limit = numberArg(positional(args, 0))
        return { kind: 'textStyle', lineLimit: limit === null ? null : Math.max(0, limit) }
      }

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
          ? { kind: 'textStyle', underline: on }
          : { kind: 'textStyle', strikethrough: on }
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
        const axes = tokenName(positional(args, 0)) ?? 'horizontal'
        const count = numberArg(labelled(args, 'count')) ?? 1
        return {
          kind: 'containerRelativeFrame',
          horizontal: axes !== 'vertical',
          vertical: axes !== 'horizontal',
          count: Math.max(1, Math.round(count)),
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
        if (gated && !boolArg(labelled(args, 'armed'))) return null

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

      // Recognised and deliberately inert: these change behaviour the preview does
      // not model, and recording them keeps the inspector honest about what was
      // written rather than dropping it silently.
      case 'resizable':
      case 'listStyle':
      case 'listRowBackground':
      case 'buttonStyle':
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
    const value = args.find((a) => a.label === null)?.value

    if (value) {
      // A material is not a colour: it is a translucent panel over a blurred
      // backdrop, and drawing it as flat grey is the approximation this refuses.
      const material = MATERIALS[tokenName(value) ?? '']
      if (material) {
        return {
          kind: 'modified',
          id: `${id}mat`,
          modifier: {
            kind: 'material',
            opacity: material,
            blur: 20,
            light: this.scheme === 'light',
          },
          child: { kind: 'empty', id: `${id}matbox` },
        }
      }

      const fill = resolveFillArg(value, this.scheme)
      if (fill) return { kind: 'fill', id, fill }

      if (value.kind === 'opaque' && value.typeName === 'View') {
        return this.convert(value.payload as ViewValue, id, 'vertical')
      }
    }

    // A trailing-closure background: `.background { RoundedRectangle(…) }`. The
    // resolver leaves it unevaluated, so there is nothing to draw unless it did.
    void modifier
    return null
  }

  // ----------------------------------------------------------------- helpers

  private color(name: string): RGBA {
    return colorForName(name, this.scheme) ?? rgba(0, 0, 0)
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
  ): LayoutElement {
    const fill: LayoutElement = { kind: 'fill', id: `${id}f`, fill: { kind: 'solid', color } }
    const backed: LayoutElement = {
      kind: 'modified',
      id,
      modifier: { kind: 'background', content: fill },
      child,
    }
    return radius > 0
      ? { kind: 'modified', id: `${id}r`, modifier: { kind: 'cornerRadius', radius }, child: backed }
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
const MATERIALS: Readonly<Record<string, number>> = {
  ultraThinMaterial: 0.55,
  thinMaterial: 0.65,
  regularMaterial: 0.76,
  thickMaterial: 0.85,
  ultraThickMaterial: 0.92,
  bar: 0.8,
}

/** SwiftUI's default stack spacing is 8 points, not zero. */
function defaultSpacing(): number {
  return 8
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

function shapeOf(value: SwiftValue | undefined): { kind: ShapeKind; cornerRadius: number } {
  if (value?.kind === 'opaque' && value.typeName === 'View') {
    const view = value.payload as ViewValue
    const shape = SHAPES[view.name]
    if (shape) {
      return {
        kind: shape,
        cornerRadius: numberArg(labelled(view.args, 'cornerRadius')) ?? 0,
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
      const payload = element.payload as { kind: string; size: number | null }
      const kind =
        payload.kind === 'fixed' ? 'fixed' : payload.kind === 'adaptive' ? 'adaptive' : 'flexible'
      return { kind, size: payload.size }
    }
    return { kind: 'flexible', size: null }
  })

  return tracks.length > 0 ? tracks : [{ kind: 'flexible', size: null }]
}

/**
 * The width of a `.stroke(style: StrokeStyle(lineWidth:))`.
 *
 * The dash pattern the same value may carry is not drawn: the render tree has no
 * field for it, and adding one is a render change rather than a value one. Recorded
 * in the coverage matrix rather than dropped silently.
 */
function strokeStyleWidth(view: ViewValue): number | null {
  const style = payloadOf<StrokeStylePayload>(
    modifierNamedArg(view, 'stroke', 'style') ?? modifierArg(view, 'stroke', 0),
    STROKE_STYLE_TYPE,
  )

  return style ? style.lineWidth : null
}

function paddingInsets(args: readonly ViewArg[]): EdgeInsets {
  // `.padding()` with no arguments is the system default of 16.
  if (args.length === 0) return uniformInsets(16)

  // `.padding(EdgeInsets(top:leading:bottom:trailing:))` - four different lengths,
  // which is the one shape none of the shorthands can express.
  const explicit = payloadOf<EdgeInsetsPayload>(positional(args, 0), EDGE_INSETS_TYPE)
  if (explicit) return insets(explicit.top, explicit.leading, explicit.bottom, explicit.trailing)

  // `.padding(24)` - a bare number on all edges.
  const bare = numberArg(positional(args, 0))
  if (bare !== null && args.length === 1) return uniformInsets(bare)

  // `.padding(.horizontal, 24)` - an edge set plus a length.
  const edgeToken = positional(args, 0)
  const length = numberArg(positional(args, 1)) ?? numberArg(labelled(args, 'length')) ?? 16

  if (edgeToken?.kind === 'opaque' && edgeToken.typeName === TOKEN_TYPE) {
    const edge = (edgeToken.payload as TokenPayload).name
    switch (edge) {
      case 'horizontal':
        return insets(0, length, 0, length)
      case 'vertical':
        return insets(length, 0, length, 0)
      case 'top':
        return insets(length, 0, 0, 0)
      case 'bottom':
        return insets(0, 0, length, 0)
      case 'leading':
        return insets(0, length, 0, 0)
      case 'trailing':
        return insets(0, 0, 0, length)
      case 'all':
        return uniformInsets(length)
      default:
        return uniformInsets(length)
    }
  }

  return uniformInsets(16)
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
    ...(pick('minWidth') !== undefined ? { minWidth: pick('minWidth')! } : {}),
    ...(pick('maxWidth') !== undefined ? { maxWidth: pick('maxWidth')! } : {}),
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
    name === 'top' ? 'top' : name === 'bottom' ? 'bottom' : 'center'
  return { horizontal: 'center', vertical }
}

function zstackAlignment(args: readonly ViewArg[]): Alignment {
  return alignmentFromToken(labelled(args, 'alignment')) ?? CENTER
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
function disabledBy(view: ViewValue): boolean {
  const disabled = view.modifiers.find((m) => m.name === 'disabled')
  if (disabled) {
    const value = positional(disabled.args, 0)
    if (value === undefined || truthy(value)) return true
  }

  const hitTestable = view.modifiers.find((m) => m.name === 'allowsHitTesting')
  if (hitTestable) {
    const value = positional(hitTestable.args, 0)
    if (value !== undefined && !truthy(value)) return true
  }

  return false
}

export type { RGBA }
export { ZERO_INSETS, resolveColorPayload, COLOR_TYPE, type ColorPayload, type Fill }
