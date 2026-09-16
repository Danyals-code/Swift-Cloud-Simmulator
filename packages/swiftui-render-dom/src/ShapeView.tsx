import { useId } from 'react'
import { cssColor, shapePath, type ShapePayload } from '@studio/shared'

/** SVG preserves centered strokes, inset strokes, circles and true capsules. */
export function ShapeView({ shape, width, height }: { shape: ShapePayload; width: number; height: number }) {
  const id = `shape-${useId().replace(/:/g, '')}`
  if (width <= 0 || height <= 0) return null
  const fill = shape.fill
  const gradient = fill?.kind === 'linearGradient' ? fill : null
  const inset = shape.stroke?.placement === 'inside' ? shape.stroke.width / 2 : 0
  return <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
    {gradient ? <defs><linearGradient id={id} x1={gradient.start.x} y1={gradient.start.y} x2={gradient.end.x} y2={gradient.end.y}>
      {gradient.stops.map((stop, i) => <stop key={i} offset={stop.location} stopColor={cssColor(stop.color)} />)}
    </linearGradient></defs> : null}
    <path d={shapePath(shape.shape, width, height, shape.cornerRadius, shape.cornerStyle, inset)}
      fill={gradient ? `url(#${id})` : fill?.kind === 'solid' ? cssColor(fill.color) : 'none'}
      stroke={shape.stroke ? cssColor(shape.stroke.color) : 'none'} strokeWidth={shape.stroke?.width ?? 0} />
  </svg>
}
