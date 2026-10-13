import { useId } from 'react'
import { cssColor, cssFill, shapePath, type ShapePayload, type ShapeTrim, type PathPayload } from '@studio/shared'

/** SVG preserves centered strokes, inset strokes, circles and true capsules. */
export function ShapeView({ shape, width, height }: { shape: ShapePayload; width: number; height: number }) {
  const inset = shape.stroke?.placement === 'inside' ? shape.stroke.width / 2 : 0
  return <VectorPathView path={{ d: shapePath(shape.shape, width, height, shape.cornerRadius, shape.cornerStyle, inset), fill: shape.fill, stroke: shape.stroke }} width={width} height={height} trim={shape.trim} />
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

/** Paths and built-in shapes share gradient and stroke painting. */
export function VectorPathView({ path, width, height, trim }: { path: PathPayload; width: number; height: number; trim?: ShapeTrim }) {
  const id = `shape-${useId().replace(/:/g, '')}`
  if (width <= 0 || height <= 0) return null
  if (trim && trim.to <= trim.from) return null
  const fill = path.fill
  const gradient = fill?.kind === 'linearGradient' ? fill : null
  return <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
    {fill && fill.kind !== 'solid' && fill.kind !== 'linearGradient' ? <>
      <defs><clipPath id={`${id}-clip`}><path d={path.d} clipRule={path.fillRule ?? 'nonzero'} /></clipPath></defs>
      <foreignObject width={width} height={height} clipPath={`url(#${id}-clip)`}><div style={{ width: '100%', height: '100%', background: cssFill(fill, {width, height}) }} /></foreignObject>
    </> : null}
    {gradient ? <defs><linearGradient id={id} gradientUnits="userSpaceOnUse" x1={gradient.start.x * width} y1={gradient.start.y * height} x2={gradient.end.x * width} y2={gradient.end.y * height}>
      {gradient.stops.map((stop, i) => <stop key={i} offset={stop.location} stopColor={cssColor(stop.color)} />)}
    </linearGradient></defs> : null}
    <path d={path.d} fillRule={path.fillRule ?? 'nonzero'}
      fill={gradient ? `url(#${id})` : fill?.kind === 'solid' ? cssColor(fill.color) : 'none'}
      stroke={path.stroke ? cssColor(path.stroke.color) : 'none'} strokeWidth={path.stroke?.width ?? 0} strokeDasharray={path.stroke?.dash?.join(' ')} strokeDashoffset={path.stroke?.dashPhase}
      {...trimmedStroke(path, trim)}
      strokeLinecap={path.stroke?.lineCap ?? 'butt'} strokeLinejoin={path.stroke?.lineJoin ?? 'miter'} strokeMiterlimit={path.stroke?.miterLimit ?? 10} />
  </svg>
}
