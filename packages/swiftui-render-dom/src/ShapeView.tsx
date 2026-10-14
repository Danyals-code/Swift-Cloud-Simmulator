import { useId } from 'react'
import { cssColor, cssFill, shapePath, type Fill, type InnerShadow, type ShapePayload, type ShapeTrim, type PathPayload } from '@studio/shared'

/** SVG preserves centered strokes, inset strokes, circles and true capsules. */
export function ShapeView({ shape, width, height }: { shape: ShapePayload; width: number; height: number }) {
  const inset = shape.stroke?.placement === 'inside' ? shape.stroke.width / 2 : 0
  return <VectorPathView path={{ d: shapePath(shape.shape, width, height, shape.cornerRadii ?? shape.cornerRadius, shape.cornerStyle, inset), fill: shape.fill, stroke: shape.stroke }} width={width} height={height} trim={shape.trim} />
}

/**
 * A trimmed stroke as SVG draws it: one dash, as long as the trim, starting where the
 * trim does. `pathLength="1"` makes the browser measure in fractions of the outline, so
 * the shape's size needn't be known here. A trimmed fill is drawn whole, and warned
 * about; so is a dashed stroke, whose own pattern this would replace.
 */
function trimmedStroke(path: PathPayload, trim: ShapeTrim | undefined) {
  if (!trim || !path.stroke || path.stroke.dash?.length) return {}
  return { pathLength: 1, strokeDasharray: `${trim.to - trim.from} 2`, strokeDashoffset: -trim.from }
}

/**
 * A gradient stroke's paint server, in the shape's own coordinates so it lines up
 * with the same gradient used as a fill. SVG has no conic gradient, so an angular
 * one answers null and is painted through a mask instead.
 */
function strokeGradient(id: string, fill: Fill, width: number, height: number) {
  if (fill.kind !== 'linearGradient' && fill.kind !== 'radialGradient') return null
  const stops = fill.stops.map((stop, i) => <stop key={i} offset={stop.location} stopColor={cssColor(stop.color)} />)
  return fill.kind === 'linearGradient'
    ? <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={fill.start.x * width} y1={fill.start.y * height} x2={fill.end.x * width} y2={fill.end.y * height}>{stops}</linearGradient>
    : <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={fill.center.x * width} cy={fill.center.y * height} r={fill.endRadius} fr={fill.startRadius}>{stops}</radialGradient>
}

/**
 * `.blue.shadow(.inner(radius: 4))`: the colour around the outline, blurred, moved and
 * kept only inside it, drawn over the fill. The blur's deviation is half the radius,
 * as CSS reads the radius of the drop shadows the preview draws.
 */
function innerShadowFilter(id: string, shadow: InnerShadow) {
  return <filter id={id} x="-50%" y="-50%" width="200%" height="200%">
    <feFlood floodColor={cssColor(shadow.color)} result="color" />
    <feComposite in="color" in2="SourceAlpha" operator="out" result="outside" />
    <feGaussianBlur in="outside" stdDeviation={shadow.radius / 2} />
    <feOffset dx={shadow.x} dy={shadow.y} result="shadow" />
    <feComposite in="shadow" in2="SourceAlpha" operator="in" result="inner" />
    <feMerge><feMergeNode in="SourceGraphic" /><feMergeNode in="inner" /></feMerge>
  </filter>
}

/** Paths and built-in shapes share gradient and stroke painting. */
export function VectorPathView({ path, width, height, trim }: { path: PathPayload; width: number; height: number; trim?: ShapeTrim }) {
  const id = `shape-${useId().replace(/:/g, '')}`
  if (width <= 0 || height <= 0) return null
  if (trim && trim.to <= trim.from) return null
  const fill = path.fill
  const gradient = fill?.kind === 'linearGradient' ? fill : null
  const stroke = path.stroke
  const strokePaint = stroke?.fill && stroke.fill.kind !== 'solid' ? stroke.fill : null
  const strokeServer = strokePaint ? strokeGradient(`${id}-stroke`, strokePaint, width, height) : null
  // An angular stroke is the conic gradient seen through the stroke's outline. The box
  // reaches past the shape by the stroke's width, and the centre is moved to match. It is
  // an SVG of its own, as big as that box and with nothing at a negative coordinate:
  // WebKit cuts a mask there.
  const masked = strokePaint && !strokeServer ? strokePaint : null
  const pad = stroke ? Math.max(1, stroke.width * 2) : 0
  const strokeProps = {
    strokeWidth: stroke?.width ?? 0, strokeDasharray: stroke?.dash?.join(' '), strokeDashoffset: stroke?.dashPhase,
    ...trimmedStroke(path, trim),
    strokeLinecap: stroke?.lineCap ?? 'butt', strokeLinejoin: stroke?.lineJoin ?? 'miter', strokeMiterlimit: stroke?.miterLimit ?? 10,
  } as const
  const paint = gradient ? `url(#${id})` : fill?.kind === 'solid' ? cssColor(fill.color) : 'none'
  // An inner shadow shades the fill alone, so the fill is drawn apart from the stroke.
  const inner = fill?.innerShadow
  return <><svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
    {inner ? <defs>{innerShadowFilter(`${id}-inner`, inner)}</defs> : null}
    {fill && fill.kind !== 'solid' && fill.kind !== 'linearGradient' ? <g filter={inner ? `url(#${id}-inner)` : undefined}>
      <defs><clipPath id={`${id}-clip`}><path d={path.d} clipRule={path.fillRule ?? 'nonzero'} /></clipPath></defs>
      <foreignObject width={width} height={height} clipPath={`url(#${id}-clip)`}><div style={{ width: '100%', height: '100%', background: cssFill(fill, {width, height}) }} /></foreignObject>
    </g> : null}
    {gradient ? <defs><linearGradient id={id} gradientUnits="userSpaceOnUse" x1={gradient.start.x * width} y1={gradient.start.y * height} x2={gradient.end.x * width} y2={gradient.end.y * height}>
      {gradient.stops.map((stop, i) => <stop key={i} offset={stop.location} stopColor={cssColor(stop.color)} />)}
    </linearGradient></defs> : null}
    {strokeServer ? <defs>{strokeServer}</defs> : null}
    {inner && paint !== 'none' ? <path d={path.d} fillRule={path.fillRule ?? 'nonzero'} fill={paint} filter={`url(#${id}-inner)`} /> : null}
    <path d={path.d} fillRule={path.fillRule ?? 'nonzero'}
      fill={inner ? 'none' : paint}
      stroke={stroke && !masked ? (strokeServer ? `url(#${id}-stroke)` : cssColor(stroke.color)) : 'none'}
      {...strokeProps} />
  </svg>
  {masked && masked.kind === 'angularGradient' ? <svg width={width + pad * 2} height={height + pad * 2} viewBox={`0 0 ${width + pad * 2} ${height + pad * 2}`} aria-hidden="true" style={{ position: 'absolute', left: -pad, top: -pad, display: 'block', overflow: 'visible' }}>
    <defs><mask id={`${id}-stroke`} maskUnits="userSpaceOnUse" x={0} y={0} width={width + pad * 2} height={height + pad * 2}>
      <path d={path.d} transform={`translate(${pad} ${pad})`} fill="none" stroke="white" {...strokeProps} />
    </mask></defs>
    <foreignObject x={0} y={0} width={width + pad * 2} height={height + pad * 2} mask={`url(#${id}-stroke)`}>
      <div style={{ width: '100%', height: '100%', background: cssFill({ ...masked, center: { x: (masked.center.x * width + pad) / (width + pad * 2), y: (masked.center.y * height + pad) / (height + pad * 2) } }) }} />
    </foreignObject>
  </svg> : null}
  </>
}
