import type { RGBA } from './render-tree'

/**
 * `MeshGradient(width:height:points:colors:smoothsColors:)` (iOS 18), as a fill (Wave 6d).
 *
 * A grid of `width` by `height` vertices, row by row: where each sits in unit space and
 * its colour. The renderer paints it into a small canvas stretched over the view, so the
 * worker carries only the grid. Its own module, so a type is all the render tree adds.
 */
export interface MeshFill {
  readonly kind: 'mesh'
  readonly width: number
  readonly height: number
  readonly points: readonly (readonly [number, number])[]
  readonly colors: readonly RGBA[]
  /** `smoothsColors:`, true by default: colours follow a cubic across the grid rather than a straight line in each patch. */
  readonly smooth: boolean
}
