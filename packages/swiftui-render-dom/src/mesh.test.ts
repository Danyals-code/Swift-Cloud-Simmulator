import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { MeshFill } from '@studio/shared'
import { MESH_SIZE, meshPixels } from './mesh'

// Native: docs/parity/native/iphone18pro-controls/measurements-6d.json, `mesh`: the fixture's
// 3 x 3 mesh with its middle point at (0.8, 0.3), sampled on a 9 x 9 grid of its frame.
const native = JSON.parse(readFileSync(new URL('../../../docs/parity/native/iphone18pro-controls/measurements-6d.json', import.meta.url), 'utf8')).mesh

const colour = (r: number, g: number, b: number) => ({ r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255), a: 1 })
const mesh = (smooth: boolean): MeshFill => ({
  kind: 'mesh', width: 3, height: 3, smooth,
  points: [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [0.8, 0.3], [1, 0.5], [0, 1], [0.5, 1], [1, 1]],
  colors: [
    colour(1, 0, 0), colour(0.5, 0, 0.5), colour(0, 0, 1),
    colour(1, 0.5, 0), colour(1, 1, 1), colour(0, 0.5, 1),
    colour(1, 1, 0), colour(0, 1, 0), colour(0, 1, 1),
  ],
})

/** How far, per channel, the painted grid is from what iOS 27 draws: the mean and the worst sample. */
function distance(pixels: Uint8ClampedArray, samples: number[][][]) {
  let total = 0, worst = 0, count = 0
  for (let j = 0; j <= 8; j++) for (let i = 0; i <= 8; i++) {
    const x = Math.min(MESH_SIZE - 1, Math.floor(i / 8 * MESH_SIZE)), y = Math.min(MESH_SIZE - 1, Math.floor(j / 8 * MESH_SIZE))
    const at = (y * MESH_SIZE + x) * 4
    const off = Math.max(...samples[j]![i]!.map((value, k) => Math.abs(value - pixels[at + k]!)))
    total += off; worst = Math.max(worst, off); count++
  }
  return { mean: total / count, worst }
}

describe('painting a MeshGradient', () => {
  it('meets each corner colour where its point is, opaque everywhere', () => {
    const pixels = meshPixels(mesh(true))
    expect(Array.from(pixels.slice(0, 4))).toEqual([255, 0, 0, 255])
    const last = (MESH_SIZE * MESH_SIZE - 1) * 4
    expect(Array.from(pixels.slice(last, last + 4))).toEqual([0, 255, 255, 255])
    for (let at = 3; at < pixels.length; at += 4) expect(pixels[at]).toBe(255)
  })

  it('draws smoothsColors as iOS 27 does: a cubic along the grid, flat at its edges', () => {
    // The top row runs red, purple, blue; a quarter of the way into its first patch iOS
    // draws red 241, as a cubic with no slope at the edge gives, where a straight line gives 223.
    const pixels = meshPixels(mesh(true))
    expect(native.samples.smooth[0][1][0]).toBe(241)
    expect(Math.abs(pixels[MESH_SIZE / 8 * 4]! - 241)).toBeLessThanOrEqual(4)
    const { mean, worst } = distance(pixels, native.samples.smooth)
    expect(mean).toBeLessThan(14)
    expect(worst).toBeLessThan(80)
  })

  it('draws a mesh that doesn’t smooth its colours as straight blends in each patch', () => {
    const { mean, worst } = distance(meshPixels(mesh(false)), native.samples.linear)
    expect(mean).toBeLessThan(10)
    expect(worst).toBeLessThan(40)
  })
})
