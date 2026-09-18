import { expect, it } from 'vitest'
import { calibrateImages, compareCaptures, compareMeasurements, regionDifference } from './authoring-evidence.mjs'

const evidence = {
  sourceSHA256: 'fixture-a', profile: 'ios-27', device: 'iphone-15', appearance: 'light', textSize: 'large', scenario: 'after-increment', displayScale: 3,
  nodes: { label: { x: 10, y: 20, width: 30, height: 20, lineCount: 1 } },
  state: { title: 'Count 1', count: 1, boundValue: 'Product A' },
}
const contract = { approved: true, geometryTolerancePoints: 1, regions: [{ name: 'label', x: 0, y: 0, width: 2, height: 2, channelDelta: 0, maxDifferentPixelRatio: 0 }] }
const image = () => ({ width: 2, height: 2, data: new Uint8Array(16).fill(255) })

it.each([
  ['spacing', () => ({ ...evidence, nodes: { label: { ...evidence.nodes.label, x: 12 } } })],
  ['text', () => ({ ...evidence, state: { ...evidence.state, title: 'Wrong' } })],
  ['binding', () => ({ ...evidence, state: { ...evidence.state, boundValue: 'Product B' } })],
  ['action', () => ({ ...evidence, state: { ...evidence.state, count: 0 } })],
  ['wrong source', () => ({ ...evidence, sourceSHA256: 'fixture-b' })],
  ['line wrapping', () => ({ ...evidence, nodes: { label: { ...evidence.nodes.label, lineCount: 2 } } })],
])('detects an intentional %s regression', (_name, mutate) => {
  expect(compareMeasurements(evidence, mutate(), contract).length).toBeGreaterThan(0)
})

it('refuses uncalibrated thresholds, missing nodes and widened geometry tolerances', () => {
  expect(compareMeasurements(evidence, evidence, null)).toHaveLength(1)
  expect(compareMeasurements(evidence, { ...evidence, nodes: {} }, contract)).toContain('Missing node: label')
  expect(compareMeasurements(evidence, evidence, { ...contract, geometryTolerancePoints: 2 })).toHaveLength(1)
})

it('detects a broken image region even when state and geometry agree', () => {
  const reference = image(), actual = image()
  actual.data[0] = 0
  expect(compareCaptures(evidence, evidence, contract, { reference, actual })).toEqual(['Image region differs: label'])
  expect(compareCaptures(evidence, evidence, contract, { reference, actual: reference })).toEqual([])
})

it('measures repeat noise without automatically approving thresholds', () => {
  const repeated = Array.from({ length: 5 }, image)
  repeated[3].data[0] = 252
  const result = calibrateImages(repeated, contract.regions)
  expect(result).toMatchObject({ approved: false, repeatCaptures: 5, regions: [{ maxChannelDelta: 3, maxDifferentPixelRatio: .25 }] })
  expect(() => calibrateImages(repeated.slice(1), contract.regions)).toThrow('five')
})

it('rejects invalid regions and mismatched image dimensions', () => {
  expect(() => regionDifference(image(), image(), { x: -1, y: 0, width: 1, height: 1 })).toThrow('region')
  expect(() => regionDifference(image(), { ...image(), width: 3 }, contract.regions[0])).toThrow('dimensions')
})
