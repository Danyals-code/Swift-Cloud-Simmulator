import { useEffect, useRef } from 'react'
import type { MeshFill } from '@studio/shared'

/** The side of the canvas a mesh is painted on, in pixels, before it is stretched over its view. */
export const MESH_SIZE = 64

/**
 * One coordinate of a line of `count` values at `s`, from 0 to `count - 1`: straight between
 * neighbours, or a cubic Hermite whose slope is the centred difference inside the line and
 * zero at its ends, which is the curve `smoothsColors` draws in the iOS 27 simulator.
 */
function lineValue(at: (index: number) => number, count: number, s: number, curved: boolean): number {
  const i = Math.min(count - 2, Math.floor(s)), t = s - i, p0 = at(i), p1 = at(i + 1)
  if (!curved) return p0 + (p1 - p0) * t
  const m0 = i > 0 ? (p1 - at(i - 1)) / 2 : 0, m1 = i + 2 < count ? (at(i + 2) - p0) / 2 : 0
  const t2 = t * t, t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (3 * t2 - 2 * t3) * p1 + (t3 - t2) * m1
}

/**
 * A `MeshGradient` as RGBA pixels, `MESH_SIZE` square (Wave 6d).
 *
 * Each patch is bilinear in place, and its colours bilinear, or with `smooth` a cubic across
 * the whole grid. The grid is walked finely enough that every pixel of a patch is reached and
 * each sample is written where it lands; anything a moved point leaves uncovered is clear.
 */
export function meshPixels(mesh: MeshFill): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, points, colors, smooth } = mesh
  const pixels = new Uint8ClampedArray(MESH_SIZE * MESH_SIZE * 4)
  const gridValue = (at: (i: number, j: number) => number, s: number, t: number, curved: boolean) =>
    lineValue(j => lineValue(i => at(i, j), width, s, curved), height, t, curved)
  const steps = MESH_SIZE * 3
  for (let b = 0; b <= steps; b++) {
    for (let a = 0; a <= steps; a++) {
      const s = a / steps * (width - 1), t = b / steps * (height - 1)
      const x = Math.floor(gridValue((i, j) => points[j * width + i]![0], s, t, false) * MESH_SIZE)
      const y = Math.floor(gridValue((i, j) => points[j * width + i]![1], s, t, false) * MESH_SIZE)
      if (x < 0 || y < 0 || x > MESH_SIZE || y > MESH_SIZE) continue
      const at = (Math.min(y, MESH_SIZE - 1) * MESH_SIZE + Math.min(x, MESH_SIZE - 1)) * 4
      pixels[at] = gridValue((i, j) => colors[j * width + i]!.r, s, t, smooth)
      pixels[at + 1] = gridValue((i, j) => colors[j * width + i]!.g, s, t, smooth)
      pixels[at + 2] = gridValue((i, j) => colors[j * width + i]!.b, s, t, smooth)
      pixels[at + 3] = gridValue((i, j) => colors[j * width + i]!.a, s, t, smooth) * 255
    }
  }
  return pixels
}

/** A mesh painted over the view it fills, stretched to its frame as SwiftUI stretches it. */
export function MeshCanvas({ mesh }: { mesh: MeshFill }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  // Painted again only when the grid changes, not each time the tree is drawn.
  const grid = JSON.stringify(mesh)
  useEffect(() => {
    canvas.current?.getContext('2d')?.putImageData(new ImageData(meshPixels(JSON.parse(grid) as MeshFill), MESH_SIZE), 0, 0)
  }, [grid])
  return <canvas ref={canvas} data-mesh="" width={MESH_SIZE} height={MESH_SIZE} aria-hidden="true"
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: 'inherit', display: 'block' }} />
}
