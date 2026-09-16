import { describe, expect, it } from 'vitest'
import type { ResolvedFont } from '@studio/shared'
import { FontMetricsTable, measureRuns, type MeasuredFont } from './metrics'

/**
 * Measurement properties that cannot be seen against the estimated table.
 *
 * The built-in estimates give every digit the same advance, because a geometric UI
 * sans does - so `.monospacedDigit` is a no-op against them and a test written at the
 * pipeline level would pass whether or not the code did anything. Here the table is
 * built with digits of deliberately different widths, which is what a *measured* font
 * hands back in the browser and the only condition under which the modifier means
 * anything.
 */

const FAMILY = 'Test'

/** A face whose digits differ, which the estimated table's never do. */
const UNEVEN: MeasuredFont = {
  family: FAMILY,
  weight: 400,
  advances: { '0': 0.9, '1': 0.3, '2': 0.6, ' ': 0.25 },
  fallback: 0.5,
  ascent: 0.78,
  descent: 0.22,
}

const font: ResolvedFont = {
  family: FAMILY,
  size: 100,
  weight: 400,
  italic: false,
  lineHeight: 121,
}

const table = new FontMetricsTable([UNEVEN])

const width = (text: string, tabular = false): number =>
  measureRuns(
    [{ text, font, ...(tabular ? { tabularNumbers: true } : {}) }],
    font,
    Number.POSITIVE_INFINITY,
    table,
  ).width

describe('.monospacedDigit', () => {
  it('is not a no-op: the face really does have uneven digits', () => {
    expect(width('111')).not.toBeCloseTo(width('000'), 3)
  })

  it('gives every digit the widest ones advance', () => {
    expect(width('111', true)).toBeCloseTo(width('000', true), 3)
    // The widest digit is `0` at 0.9em, so three of them is 270 points.
    expect(width('111', true)).toBeCloseTo(270, 3)
  })

  it('leaves everything that is not a digit alone', () => {
    // One space at 0.25em between two digits that are now 0.9em each.
    expect(width('1 1', true)).toBeCloseTo(0.9 * 100 + 0.25 * 100 + 0.9 * 100, 3)
  })
})
