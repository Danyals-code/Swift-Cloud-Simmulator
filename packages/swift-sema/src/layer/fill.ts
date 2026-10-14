import type { ColorValue, FillValue, LayerChange, LayerFill, UnitPoint } from '@studio/shared'
import type { Argument, CallExpr, Expr } from '@studio/swift-syntax'
import { SLOT } from '../authoring-modifiers'
import { MATERIALS, materialThickness } from '../design-advanced-controls'
import { insertCalls, insertionIndex, replaceRun, runHasComment, type Patch } from './chain-edit'
import { HIERARCHICAL, colorSource, readColor, sameColor, type ColorSlot } from './color'
import { SHAPE_CALLS, isShapeView, runAt, type ChainSlots } from './slots'
import { cardRefusal, commented, type LayerContext } from './context'
import { amount, numberOf, sourceOf } from './values'

/**
 * Fill: what paints the layer, as one colour, gradient, material or Liquid Glass.
 *
 * A view's fill is its first background, or its glass. A shape's is its own `.fill`, or
 * the foreground style that fills it in when it has no stroke: a background behind a
 * shape is another layer. Switching the kind rewrites only the background's style, so a
 * shape it is drawn `in:` stays as written for the Corners section.
 */

const GLASS = 'Glass needs iOS 26. Use a Material, or raise the deployment target.'
const MATERIAL = 'Materials need iOS 15. Raise the deployment target to use one.'
const SHAPE_GLASS = 'A shape can’t be filled with Liquid Glass. Use a Material, or put the glass on the view behind it.'

type SiteKind = 'background' | 'glassEffect' | 'fill' | 'foregroundStyle' | 'foregroundColor'
/** The call that paints the layer, and which kind of call it is. */
interface Site { readonly index: number; readonly call: CallExpr; readonly kind: SiteKind }
/** A fill as read, whether a token is in it, and each colour's text as written, for writing back unchanged. */
interface Read { readonly fill: FillValue; readonly token: boolean; readonly colors: readonly string[]; readonly material?: 'member' }

/** The call that paints the layer: null when none does, and `both` when a background and glass each paint it. */
function siteOf(slots: ChainSlots): Site | null | 'both' {
  const first = (names: readonly string[]) => slots.names.findIndex(name => names.includes(name))
  const site = (index: number): Site | null => index < 0 ? null : { index, call: slots.modifiers[index]!, kind: slots.names[index] as SiteKind }
  if (isShapeView(slots)) {
    const fill = first(['fill'])
    if (fill >= 0) return site(fill)
    // Over a stroke the foreground colours the stroke, and the shape has no fill.
    if (slots.names.some(name => name === 'stroke' || name === 'strokeBorder')) return null
    return site(first(['foregroundStyle', 'foregroundColor']))
  }
  const background = first(['background']), glass = first(['glassEffect'])
  if (background >= 0 && glass >= 0) return 'both'
  return site(background >= 0 ? background : glass)
}

// ---------------------------------------------------------------- points and angles

const POINTS: Readonly<Record<string, UnitPoint>> = {
  topLeading: { x: 0, y: 0 }, top: { x: 0.5, y: 0 }, topTrailing: { x: 1, y: 0 },
  leading: { x: 0, y: 0.5 }, center: { x: 0.5, y: 0.5 }, trailing: { x: 1, y: 0.5 },
  bottomLeading: { x: 0, y: 1 }, bottom: { x: 0.5, y: 1 }, bottomTrailing: { x: 1, y: 1 },
}
/** Where a linear gradient starts at each 45 degrees, clockwise from the top; it ends opposite. */
const COMPASS = ['top', 'topTrailing', 'trailing', 'bottomTrailing', 'bottom', 'bottomLeading', 'leading', 'topLeading'] as const

function pointOf(value: Expr, ctx: LayerContext): UnitPoint | undefined {
  if (value.kind === 'memberAccess' && (!value.base || value.base.kind === 'identifier' && value.base.name === 'UnitPoint')) return POINTS[value.member]
  if (value.kind !== 'call' || value.trailingClosure || value.callee.kind !== 'identifier' || value.callee.name !== 'UnitPoint' || value.args.map(arg => arg.label).join() !== 'x,y') return undefined
  const [x, y] = value.args.map(arg => numberOf(arg.value, ctx))
  return x === undefined || y === undefined ? undefined : { x, y }
}

const writePoint = (point: UnitPoint) => {
  const name = Object.entries(POINTS).find(([, known]) => known.x === point.x && known.y === point.y)?.[0]
  return name ? `.${name}` : `UnitPoint(x: ${amount(point.x)}, y: ${amount(point.y)})`
}

/**
 * A linear gradient's angle, clockwise from the top as Figma measures it: 0 runs top to
 * bottom and 90 trailing to leading. Undefined for start and end points that are not
 * opposite each other on the layer's edge, which an angle cannot say.
 */
function angleOf(start: UnitPoint, end: UnitPoint): number | undefined {
  if (Math.abs(start.x + end.x - 1) > 1e-6 || Math.abs(start.y + end.y - 1) > 1e-6) return undefined
  const dx = start.x - 0.5, dy = start.y - 0.5
  if (Math.abs(Math.max(Math.abs(dx), Math.abs(dy)) - 0.5) > 1e-6) return undefined
  const degrees = Math.atan2(dx, -dy) * 180 / Math.PI
  return Math.round((degrees + 360) % 360 * 1e6) / 1e6
}

/** The start and end points for an angle: named every 45 degrees, otherwise where the angle meets the layer's edge. */
function pointsFor(angle: number): [string, string] {
  const turned = (angle % 360 + 360) % 360, step = turned / 45
  if (Math.abs(step - Math.round(step)) < 1e-6) {
    const index = Math.round(step) % 8
    return [`.${COMPASS[index]}`, `.${COMPASS[(index + 4) % 8]}`]
  }
  const radians = turned * Math.PI / 180, dx = Math.sin(radians), dy = -Math.cos(radians)
  const reach = 0.5 / Math.max(Math.abs(dx), Math.abs(dy))
  return [writePoint({ x: 0.5 + dx * reach, y: 0.5 + dy * reach }), writePoint({ x: 0.5 - dx * reach, y: 0.5 - dy * reach })]
}

// ---------------------------------------------------------------- reading

type Stops = { readonly stops: { readonly color: ColorValue; readonly location: number }[]; readonly token: boolean; readonly colors: string[] }

/** `colors: [...]`, `stops: [...]` or a `Gradient` of either, as stops; undefined for anything worked out in Swift. */
function stopsOf(arg: Argument, ctx: LayerContext): Stops | undefined {
  const value = arg.value
  if ((arg.label === 'gradient' || arg.label === null) && value.kind === 'call' && !value.trailingClosure && value.callee.kind === 'identifier' && value.callee.name === 'Gradient' && value.args.length === 1) return stopsOf(value.args[0]!, ctx)
  if (value.kind !== 'arrayLiteral' || !value.elements.length || arg.label !== 'colors' && arg.label !== 'stops') return undefined
  const result: Stops = { stops: [], token: false, colors: [] }
  for (const [index, element] of value.elements.entries()) {
    let colorExpr = element, location = value.elements.length > 1 ? index / (value.elements.length - 1) : 0
    if (arg.label === 'stops') {
      const stop = element.kind === 'call' && !element.trailingClosure && element.args.map(a => a.label).join() === 'color,location' ? element : undefined
      const callee = stop && sourceOf(ctx, stop.callee).replace(/\s/g, '')
      if (!stop || !['Gradient.Stop', '.init', 'Gradient.Stop.init'].includes(callee!)) return undefined
      const at = numberOf(stop.args[1]!.value, ctx)
      if (at === undefined) return undefined
      colorExpr = stop.args[0]!.value
      location = at
    }
    const color = readColor(colorExpr, ctx)
    if (color.state === 'code') return undefined
    result.stops.push({ color: color.value, location })
    result.colors.push(sourceOf(ctx, colorExpr))
    if (color.state === 'token') (result as { token: boolean }).token = true
  }
  return result
}

type GradientType = Extract<FillValue, { kind: 'gradient' }>['type']
/** The gradient views, and the ShapeStyle functions that make the same gradients from iOS 15. */
const GRADIENT_VIEWS: Readonly<Record<string, GradientType>> = { LinearGradient: 'linear', RadialGradient: 'radial', AngularGradient: 'angular' }
const GRADIENT_STYLES: Readonly<Record<string, GradientType>> = { linearGradient: 'linear', radialGradient: 'radial', conicGradient: 'angular' }

/** A gradient, undefined for one worked out in Swift, or null for a value that is no gradient. */
function gradientOf(value: Expr, ctx: LayerContext): Read | undefined | null {
  if (value.kind === 'memberAccess' && value.member === 'gradient' && value.base) {
    const color = readColor(value.base, ctx)
    if (color.state === 'code') return undefined
    return { fill: { kind: 'gradient', type: 'linear', stops: [{ color: color.value, location: 0 }], angle: 0, automatic: true }, token: color.state === 'token', colors: [sourceOf(ctx, value.base)] }
  }
  if (value.kind !== 'call' || value.trailingClosure) return null
  const callee = value.callee
  const type = callee.kind === 'identifier' ? GRADIENT_VIEWS[callee.name] : callee.kind === 'memberAccess' && !callee.base ? GRADIENT_STYLES[callee.member] : undefined
  if (!type) return null
  const [source, ...rest] = value.args
  const stops = source && stopsOf(source, ctx)
  if (!stops) return undefined
  const labels = rest.map(arg => arg.label).join()
  const arg = (label: string) => rest.find(a => a.label === label)!.value
  const base = { kind: 'gradient' as const, stops: stops.stops }
  let fill: FillValue
  if (type === 'linear') {
    const start = labels === 'startPoint,endPoint' ? pointOf(arg('startPoint'), ctx) : undefined
    const end = start && pointOf(arg('endPoint'), ctx)
    const angle = end && angleOf(start, end)
    if (angle === undefined) return undefined
    fill = { ...base, type, angle }
  } else if (type === 'radial') {
    const center = labels === 'center,startRadius,endRadius' ? pointOf(arg('center'), ctx) : undefined
    const startRadius = center && numberOf(arg('startRadius'), ctx), endRadius = center && numberOf(arg('endRadius'), ctx)
    if (!center || startRadius === undefined || endRadius === undefined) return undefined
    fill = { ...base, type, center, startRadius, endRadius }
  } else {
    const center = labels === 'center' ? pointOf(arg('center'), ctx) : undefined
    if (!center) return undefined
    fill = { ...base, type, center }
  }
  return { fill, token: stops.token, colors: stops.colors }
}

/** `.regular`, `.clear.interactive()` or `Glass.regular.tint(.blue)`, as a glass fill. */
function glassOf(call: CallExpr, ctx: LayerContext): Read | undefined {
  const [first, ...rest] = call.args
  const value = first?.label === null ? first.value : undefined
  if ((value ? rest : call.args).some(arg => arg.label !== 'in')) return undefined
  if (!value) return { fill: { kind: 'glass', variant: 'regular' }, token: false, colors: [] }
  let expr: Expr = value, tint: ColorValue | undefined, interactive: boolean | undefined, token = false
  const colors: string[] = []
  while (expr.kind === 'call' && !expr.trailingClosure && expr.callee.kind === 'memberAccess' && expr.callee.base) {
    const member = expr.callee.member, args = expr.args
    if (member === 'tint' && tint === undefined && args.length === 1 && args[0]!.label === null) {
      const color = readColor(args[0]!.value, ctx)
      if (color.state === 'code') return undefined
      tint = color.value; token = color.state === 'token'; colors.push(sourceOf(ctx, args[0]!.value))
    } else if (member === 'interactive' && interactive === undefined && (!args.length || args.length === 1 && args[0]!.label === null && args[0]!.value.kind === 'booleanLiteral')) {
      interactive = args.length ? (args[0]!.value as { value: boolean }).value : true
    } else return undefined
    expr = expr.callee.base
  }
  const variant = expr.kind === 'memberAccess' && (!expr.base || expr.base.kind === 'identifier' && expr.base.name === 'Glass') ? expr.member : ''
  if (variant !== 'regular' && variant !== 'clear') return undefined
  return { fill: { kind: 'glass', variant, ...(tint ? { tint } : {}), ...(interactive ? { interactive } : {}) }, token, colors }
}

/** A ShapeStyle as a fill: a material, a gradient or a colour. */
function styleOf(value: Expr, ctx: LayerContext): Read | undefined {
  const material = materialThickness(value) as Extract<FillValue, { kind: 'material' }>['thickness'] | undefined
  if (material) return { fill: { kind: 'material', thickness: material }, token: false, colors: [], ...(value.kind === 'memberAccess' && value.base ? { material: 'member' as const } : {}) }
  const gradient = gradientOf(value, ctx)
  if (gradient !== null) return gradient
  const color = readColor(value, ctx)
  if (color.state === 'code') return undefined
  return { fill: { kind: 'color', color: color.value }, token: color.state === 'token', colors: [sourceOf(ctx, value)] }
}

/** The labels each kind of call may have beside its style, all kept as written. */
const BESIDE: Readonly<Record<Exclude<SiteKind, 'glassEffect'>, readonly string[]>> = {
  background: ['in', 'ignoresSafeAreaEdges', 'fillStyle'], fill: ['style'], foregroundStyle: [], foregroundColor: [],
}

function readSite(slots: ChainSlots, site: Site, ctx: LayerContext): Read | string {
  const call = site.call
  if (runHasComment(slots, runAt(slots, site.index), ctx.text)) return commented('fill')
  if (call.trailingClosure) return 'This fill is a view written in Swift. Change it in Code.'
  if (site.kind === 'glassEffect') return glassOf(call, ctx) ?? 'This glass is worked out in Swift. Change it in Code.'
  const [first, ...rest] = call.args
  if (!first || first.label !== null || rest.some(arg => !BESIDE[site.kind as keyof typeof BESIDE].includes(arg.label ?? ''))) return 'This fill is written in a way the panel can’t show. Change it in Code.'
  return styleOf(first.value, ctx) ?? 'This fill is worked out in Swift. Change it in Code.'
}

/** The kinds this layer cannot be filled with here, and why. */
function unavailableKinds(slots: ChainSlots, ctx: LayerContext): LayerFill['unavailable'] {
  const card = cardRefusal(ctx)
  if (card) return { color: card, gradient: card, material: card, glass: card }
  return {
    ...(isShapeView(slots) ? { glass: SHAPE_GLASS } : ctx.target < 26 ? { glass: GLASS } : {}),
    ...(ctx.target < 15 ? { material: MATERIAL } : {}),
  }
}

export function readFill(slots: ChainSlots, ctx: LayerContext): LayerFill {
  const unavailable = unavailableKinds(slots, ctx)
  const extra = unavailable && Object.keys(unavailable).length ? { unavailable } : {}
  const site = siteOf(slots)
  if (!site) return { value: null, state: 'absent', ...extra }
  if (site === 'both') {
    const from = slots.names.flatMap((name, index) => name === 'background' || name === 'glassEffect' ? [ctx.ids[index]!] : [])
    return { value: null, state: 'code', from, disabledReason: 'This view has a background and Liquid Glass. Change them in Code.', ...extra }
  }
  const from = [ctx.ids[site.index]!]
  const read = readSite(slots, site, ctx)
  if (typeof read === 'string') return { value: null, state: 'code', from, disabledReason: read, ...extra }
  return { value: read.fill, state: read.token ? 'token' : 'literal', from, ...extra }
}

// ---------------------------------------------------------------- comparing

const near = (a: number | undefined, b: number | undefined, fallback: number) => Math.abs((a ?? fallback) - (b ?? fallback)) < 1e-6
const samePoint = (a: UnitPoint | undefined, b: UnitPoint | undefined) => near(a?.x, b?.x, 0.5) && near(a?.y, b?.y, 0.5)

/** Whether two fills paint the same, however each was spelled. */
export function sameFill(a: FillValue, b: FillValue): boolean {
  if (a.kind === 'color' && b.kind === 'color') return sameColor(a.color, b.color)
  if (a.kind === 'material' && b.kind === 'material') return a.thickness === b.thickness
  if (a.kind === 'glass' && b.kind === 'glass') return a.variant === b.variant && !a.interactive === !b.interactive && (a.tint && b.tint ? sameColor(a.tint, b.tint) : !a.tint && !b.tint)
  if (a.kind !== 'gradient' || b.kind !== 'gradient') return false
  return a.type === b.type && !a.automatic === !b.automatic && a.stops.length === b.stops.length
    && a.stops.every((stop, index) => sameColor(stop.color, b.stops[index]!.color) && near(stop.location, b.stops[index]!.location, 0))
    && (a.type !== 'linear' || near(a.angle, b.angle, 0)) && (a.type === 'linear' || samePoint(a.center, b.center))
    && (a.type !== 'radial' || near(a.startRadius, b.startRadius, 0) && near(a.endRadius, b.endRadius, 100))
}

// ---------------------------------------------------------------- writing

/** A colour as written before when it has not changed, so a stop or tint left alone keeps its spelling. */
function colorText(color: ColorValue, index: number, slot: ColorSlot, ctx: LayerContext, previous: { fill: FillValue; colors: readonly string[] } | undefined): string {
  const before = previous?.fill.kind === 'gradient' ? previous.fill.stops[index]?.color : previous?.fill.kind === 'glass' ? previous.fill.tint : previous?.fill.kind === 'color' ? previous.fill.color : undefined
  return before && previous!.colors[index] && sameColor(before, color) ? previous!.colors[index]! : colorSource(color, slot, ctx)
}

function gradientSource(fill: Extract<FillValue, { kind: 'gradient' }>, ctx: LayerContext, previous: Read | undefined): string {
  if (!['linear', 'radial', 'angular'].includes(fill.type)) throw new Error('A gradient is linear, radial or angular.')
  const kept = previous?.fill.kind === 'gradient' && !previous.fill.automatic === !fill.automatic ? previous : undefined
  const stops = fill.stops
  if (fill.automatic && stops.length === 1) {
    if (ctx.target < 16) throw new Error('A color’s own gradient needs iOS 16. Add a second stop, or raise the deployment target.')
    const color = stops[0]!.color
    if ('name' in color && HIERARCHICAL.has(color.name)) throw new Error('Choose a color for its own gradient.')
    return `${colorText(color, 0, 'ShapeStyle', ctx, kept)}.gradient`
  }
  if (stops.length < 2) throw new Error('A gradient needs two or more stops.')
  if (stops.some(stop => !(stop.location >= 0 && stop.location <= 1))) throw new Error('A stop’s location is between 0 and 100%.')
  const colors = stops.map((stop, index) => colorText(stop.color, index, 'Color', ctx, kept))
  // Evenly spaced stops are what `colors:` means, which is how most gradients are written.
  const even = stops.every((stop, index) => Math.abs(stop.location - index / (stops.length - 1)) < 1e-6)
  const list = even ? `colors: [${colors.join(', ')}]` : `stops: [${stops.map((stop, index) => `Gradient.Stop(color: ${colors[index]}, location: ${amount(stop.location)})`).join(', ')}]`
  const center = writePoint(fill.center ?? POINTS.center!)
  if (fill.type === 'radial') {
    const startRadius = fill.startRadius ?? 0, endRadius = fill.endRadius ?? 100
    if (!(startRadius >= 0 && endRadius >= 0)) throw new Error('A radius is 0 or more.')
    return `RadialGradient(${list}, center: ${center}, startRadius: ${amount(startRadius)}, endRadius: ${amount(endRadius)})`
  }
  if (fill.type === 'angular') return `AngularGradient(${list}, center: ${center})`
  const angle = fill.angle ?? 0
  if (!Number.isFinite(angle)) throw new Error('An angle is a number of degrees.')
  const [start, end] = pointsFor(angle)
  return `LinearGradient(${list}, startPoint: ${start}, endPoint: ${end})`
}

/** The Swift for a colour, gradient or material in `slot`. */
function styleSource(fill: Exclude<FillValue, { kind: 'glass' }>, slot: ColorSlot, ctx: LayerContext, previous: Read | undefined): string {
  if (fill.kind === 'color') return colorText(fill.color, 0, slot, ctx, previous?.fill.kind === 'color' ? previous : undefined)
  if (fill.kind === 'gradient') return gradientSource(fill, ctx, previous)
  if (!MATERIALS.includes(fill.thickness)) throw new Error('A material is ultra thin, thin, regular, thick or ultra thick.')
  if (slot !== 'ShapeStyle' || ctx.target < 15) throw new Error(MATERIAL)
  return previous?.material ? `Material.${fill.thickness}` : `.${fill.thickness}Material`
}

function glassSource(fill: Extract<FillValue, { kind: 'glass' }>, ctx: LayerContext, previous: Read | undefined): string {
  if (fill.variant !== 'regular' && fill.variant !== 'clear') throw new Error('Glass is regular or clear.')
  const tint = fill.tint ? `.tint(${colorText(fill.tint, 0, 'Color', ctx, previous?.fill.kind === 'glass' ? previous : undefined)})` : ''
  return `.${fill.variant}${tint}${fill.interactive ? '.interactive()' : ''}`
}

/** A fill where the layer has none: a shape's `.fill`, a background, or glass. */
function insertFill(slots: ChainSlots, fill: FillValue, ctx: LayerContext): Patch {
  if (ctx.locked) throw new Error(ctx.locked)
  const slot: ColorSlot = ctx.target >= 15 ? 'ShapeStyle' : 'Color'
  if (isShapeView(slots)) {
    let index = 0
    while (index < slots.names.length && SHAPE_CALLS.has(slots.names[index]!)) index++
    if (ctx.target < 17 && slots.names.slice(index).some(name => name === 'stroke' || name === 'strokeBorder')) throw new Error('A shape with a stroke takes a fill from iOS 17. Raise the deployment target, or change it in Code.')
    return insertCalls(slots, index, [`.fill(${styleSource(fill as Exclude<FillValue, { kind: 'glass' }>, slot, ctx, undefined)})`], ctx.text)
  }
  const call = fill.kind === 'glass' ? `.glassEffect(${glassSource(fill, ctx, undefined)}, in: .rect)` : `.background(${styleSource(fill, slot, ctx, undefined)})`
  return insertCalls(slots, insertionIndex(slots, SLOT.fill), [call], ctx.text)
}

/** One fill change as patches to the chain; throws the reason when the panel cannot make it. */
export function writeFill(slots: ChainSlots, change: Extract<LayerChange, { section: 'fill' }>, ctx: LayerContext): Patch[] {
  const next = change.fill
  const card = cardRefusal(ctx)
  if (card) throw new Error(card)
  const current = readFill(slots, ctx)
  if (current.state === 'code') throw new Error(current.disabledReason)
  if (next === null ? current.value === null : current.value !== null && sameFill(current.value, next)) return []
  const unavailable = next && current.unavailable?.[next.kind]
  if (unavailable) throw new Error(unavailable)
  const site = siteOf(slots) as Site | null
  if (!site) return next ? [insertFill(slots, next, ctx)] : []
  const run = runAt(slots, site.index), call = site.call
  if (!next) return [replaceRun(slots, run, [], ctx.text)]
  const previous = readSite(slots, site, ctx) as Read
  const style = call.args[0]?.label === null ? call.args[0] : undefined
  const shape = call.args.find(arg => arg.label === 'in')
  const shapeText = shape && sourceOf(ctx, shape.value)
  const inStyle = (text: string): Patch => ({ start: style!.value.span.start, end: style!.value.span.end, text })
  if (site.kind === 'glassEffect') {
    if (next.kind === 'glass') {
      const glass = glassSource(next, ctx, previous)
      const args = [...(style || glass !== '.regular' ? [glass] : []), ...(shapeText ? [`in: ${shapeText}`] : [])]
      return [replaceRun(slots, run, [`.glassEffect(${args.join(', ')})`], ctx.text)]
    }
    if (ctx.target < 15) throw new Error(MATERIAL)
    // Glass with no shape of its own is a capsule, which the background keeps.
    const kept = shapeText ?? (ctx.target >= 17 ? '.capsule' : 'Capsule()')
    return [replaceRun(slots, run, [`.background(${styleSource(next, 'ShapeStyle', ctx, undefined)}, in: ${kept})`], ctx.text)]
  }
  if (next.kind === 'glass') {
    if (call.args.some(arg => arg !== style && arg !== shape)) throw new Error('This background sets more than a shape, which Liquid Glass can’t take. Change it in Code.')
    return [replaceRun(slots, run, [`.glassEffect(${glassSource(next, ctx, undefined)}, in: ${shapeText ?? '.rect'})`], ctx.text)]
  }
  if (site.kind === 'foregroundColor') {
    if (next.kind === 'color') return [inStyle(styleSource(next, 'Color', ctx, previous))]
    if (ctx.target < 15) throw new Error('A gradient fills a shape’s foreground color from iOS 15. Raise the deployment target, or change it in Code.')
    return [replaceRun(slots, run, [`.foregroundStyle(${styleSource(next, 'ShapeStyle', ctx, undefined)})`], ctx.text)]
  }
  const slot: ColorSlot = site.kind === 'foregroundStyle' || ctx.target >= 15 ? 'ShapeStyle' : 'Color'
  return [inStyle(styleSource(next, slot, ctx, previous))]
}
