import { rgba, type Fill, type RGBA, type ShapeKind } from '@studio/shared'
import type { SwiftValue } from '@studio/swift-runtime'
import { UNIMPLEMENTED_MODIFIERS, UNIMPLEMENTED_VIEWS } from '@studio/swift-sema'
import {
  CENTER,
  insets,
  uniformInsets,
  type Alignment,
  type Axis,
  type EdgeInsets,
  type HorizontalAlignment,
  type LayoutElement,
  type LayoutModifier,
  type VerticalAlignment,
} from '@studio/swiftui-layout'
import {
  BUTTON_FONT,
  numberArg,
  resolveColorArg,
  resolveFontArg,
  stringArg,
} from './style'
import {
  COLOR_TYPE,
  TOKEN_TYPE,
  type ColorPayload,
  type ModifierValue,
  type TokenPayload,
  type ViewArg,
  type ViewValue,
} from './view-value'
import { resolveColorPayload } from './style'

/**
 * Turns the evaluated view tree into layout elements.
 *
 * The two trees look similar but answer different questions. `ViewValue` records
 * *what the user wrote* — names, arguments, modifiers in source order.
 * `LayoutElement` records *how it sizes and paints*. Keeping them separate is what
 * lets the layout engine stay free of SwiftUI knowledge, and what makes modifier
 * nesting (rather than a flat list) expressible at all.
 */

export interface ConversionResult {
  readonly element: LayoutElement
  /** Handler id -> the view path it belongs to, for dispatching taps. */
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
const TRANSPARENT_VIEWS: ReadonlySet<string> = new Set(['Group', 'WindowGroup'])

export function viewsToLayout(
  views: readonly ViewValue[],
  rootAxis: Axis = 'vertical',
): ConversionResult {
  const hitTargets = new Map<string, string>()
  const converter = new Converter(hitTargets)
  const children = converter.convertList(views, 'v', rootAxis)

  const element: LayoutElement =
    children.length === 1
      ? children[0]!
      : {
          kind: 'stack',
          id: 'root-stack',
          axis: rootAxis,
          spacing: 0,
          alignment: CENTER,
          children,
        }

  return { element, hitTargets }
}

class Converter {
  constructor(private readonly hitTargets: Map<string, string>) {}

  convertList(views: readonly ViewValue[], prefix: string, axis: Axis): LayoutElement[] {
    const out: LayoutElement[] = []
    views.forEach((view, index) => {
      const path = `${prefix}-${index}`
      // A `Group` is not a container — it exists so a builder can exceed its child
      // limit, and its children belong to the enclosing stack.
      if (TRANSPARENT_VIEWS.has(view.name) && view.modifiers.length === 0) {
        out.push(...this.convertList(view.children, path, axis))
        return
      }
      out.push(this.convert(view, path, axis))
    })
    return out
  }

  convert(view: ViewValue, path: string, parentAxis: Axis): LayoutElement {
    let element = this.baseElement(view, path, parentAxis)

    // Modifiers wrap outward in source order, so `.padding().background()` nests as
    // background(padding(view)) and therefore covers the padding.
    for (const [index, modifier] of view.modifiers.entries()) {
      const converted = this.convertModifier(modifier, `${path}m${index}`)
      if (!converted) continue
      element = { kind: 'modified', id: `${path}m${index}`, modifier: converted, child: element }
    }

    // A Button's tap area covers everything its modifiers added, so the hit target
    // goes outermost — tapping the padding must count, exactly as on iOS.
    if (view.action) {
      const handlerId = `action-${path}`
      this.hitTargets.set(handlerId, path)
      element = {
        kind: 'modified',
        id: `${path}hit`,
        modifier: { kind: 'hitTarget', handlerId, label: labelOf(view) },
        child: element,
        ...(view.span ? { origin: view.span } : {}),
      }
    }

    return element
  }

  private baseElement(view: ViewValue, path: string, parentAxis: Axis): LayoutElement {
    const origin = view.span ? { origin: view.span } : {}

    switch (view.name) {
      case 'Text':
        return { kind: 'text', id: path, text: stringArg(view.args[0]?.value) ?? '', ...origin }

      case 'VStack':
      case 'HStack': {
        const axis: Axis = view.name === 'VStack' ? 'vertical' : 'horizontal'
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
          // A Spacer's axis is its *parent's* — the same view expands down in a
          // VStack and across in an HStack.
          axis: parentAxis,
          minLength: numberArg(labelled(view.args, 'minLength')) ?? 0,
          ...origin,
        }

      case 'Divider':
        return { kind: 'fill', id: path, fill: { kind: 'solid', color: rgba(60, 60, 67, 0.29) }, ...origin }

      case 'EmptyView':
        return { kind: 'empty', id: path, ...origin }

      case 'Button': {
        // The label is the first string argument; a label-closure Button renders its
        // children instead.
        const title = stringArg(view.args[0]?.value)
        const label: LayoutElement =
          title !== null
            ? { kind: 'text', id: `${path}label`, text: title, ...origin }
            : {
                kind: 'stack',
                id: `${path}label`,
                axis: 'horizontal',
                spacing: 4,
                alignment: CENTER,
                children: this.convertList(view.children, `${path}label`, 'horizontal'),
                ...origin,
              }

        // Buttons are tinted with the accent colour and use the body font unless the
        // surrounding environment says otherwise.
        return {
          kind: 'modified',
          id: `${path}style`,
          modifier: { kind: 'font', font: BUTTON_FONT },
          child: label,
          ...origin,
        }
      }

      default:
        break
    }

    const shape = SHAPES[view.name]
    if (shape) {
      return {
        kind: 'shape',
        id: path,
        shape,
        ...(numberArg(labelled(view.args, 'cornerRadius')) !== null
          ? { cornerRadius: numberArg(labelled(view.args, 'cornerRadius'))! }
          : {}),
        ...origin,
      }
    }

    // A real SwiftUI view the preview cannot draw yet renders as a labelled box
    // naming the feature, never as a blank space (FR-4.11).
    const phase = UNIMPLEMENTED_VIEWS.get(view.name)
    return {
      kind: 'placeholder',
      id: path,
      feature: view.name,
      reason: phase
        ? `Not drawn by the preview yet — arriving in Phase ${phase}.`
        : 'Not recognised by the preview.',
      ...origin,
    }
  }

  private convertModifier(modifier: ModifierValue, id: string): LayoutModifier | null {
    const args = modifier.args

    switch (modifier.name) {
      case 'padding':
        return { kind: 'padding', insets: paddingInsets(args) }

      case 'frame':
        return frameModifier(args)

      case 'background': {
        const content = this.backgroundContent(args, `${id}bg`)
        return content ? { kind: 'background', content } : null
      }

      case 'font': {
        const font = resolveFontArg(args[0]?.value)
        return font ? { kind: 'font', font } : null
      }

      case 'foregroundStyle':
      case 'foregroundColor':
      case 'tint': {
        const color = resolveColorArg(args[0]?.value)
        return color ? { kind: 'foregroundStyle', color } : null
      }

      case 'bold':
        return { kind: 'unsupported', name: 'bold' }

      case 'opacity': {
        const value = numberArg(args[0]?.value)
        return value === null ? null : { kind: 'opacity', value }
      }

      case 'cornerRadius': {
        const radius = numberArg(args[0]?.value)
        return radius === null ? null : { kind: 'cornerRadius', radius }
      }

      default:
        // Recorded so the coverage warning and the layout agree about what was
        // ignored, rather than the modifier vanishing silently.
        return UNIMPLEMENTED_MODIFIERS.has(modifier.name)
          ? { kind: 'unsupported', name: modifier.name }
          : { kind: 'unsupported', name: modifier.name }
    }
  }

  /** `.background(Color.red)` or `.background(RoundedRectangle(...))`. */
  private backgroundContent(args: readonly ViewArg[], id: string): LayoutElement | null {
    const value = args[0]?.value
    if (!value) return null

    const fill = fillFromValue(value)
    if (fill) return { kind: 'fill', id, fill }

    if (value.kind === 'opaque' && value.typeName === 'View') {
      return this.convert(value.payload as ViewValue, id, 'vertical')
    }
    return null
  }
}

// -------------------------------------------------------------------- helpers

function labelled(args: readonly ViewArg[], label: string): SwiftValue | undefined {
  return args.find((a) => a.label === label)?.value
}

function positional(args: readonly ViewArg[], index: number): SwiftValue | undefined {
  return args.filter((a) => a.label === null)[index]?.value
}

/** SwiftUI's default stack spacing is 8 points, not zero. */
function defaultSpacing(): number {
  return 8
}

function fillFromValue(value: SwiftValue): Fill | null {
  if (value.kind !== 'opaque') return null
  if (value.typeName === COLOR_TYPE) {
    return { kind: 'solid', color: resolveColorPayload(value.payload as ColorPayload) }
  }
  if (value.typeName === TOKEN_TYPE) {
    const color = resolveColorArg(value)
    return color ? { kind: 'solid', color } : null
  }
  return null
}

function paddingInsets(args: readonly ViewArg[]): EdgeInsets {
  // `.padding()` with no arguments is the system default of 16.
  if (args.length === 0) return uniformInsets(16)

  // `.padding(24)` — a bare number on all edges.
  const bare = numberArg(positional(args, 0))
  if (bare !== null && args.length === 1) return uniformInsets(bare)

  // `.padding(.horizontal, 24)` — an edge set plus a length.
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

function tokenName(value: SwiftValue | undefined): string | null {
  if (!value || value.kind !== 'opaque' || value.typeName !== TOKEN_TYPE) return null
  return (value.payload as TokenPayload).name
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

function labelOf(view: ViewValue): string {
  return stringArg(view.args[0]?.value) ?? view.name
}

export type { RGBA }
