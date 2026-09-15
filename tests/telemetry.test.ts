import { beforeEach, describe, expect, it } from 'vitest'
import type { CompileResult } from '@studio/shared'
import {
  clearCoverage,
  coverageRanking,
  isRecognised,
  recordCoverage,
  resetCoverageCache,
} from '../apps/web/lib/telemetry'

/**
 * Coverage telemetry.
 *
 * Two properties matter and neither is obvious from reading the module:
 *
 * 1. **It counts reaching for something, not typing near it.** A compile runs on
 *    nearly every keystroke, so counting compiles would rank features by how long
 *    someone spent editing beside them rather than by how often they wanted them.
 * 2. **It never leaves the browser.** There is no endpoint to assert against, so what
 *    is asserted instead is that the store is plain local state the user can clear.
 */

function result(features: { name: string; kind: 'view' | 'modifier' }[]): CompileResult {
  return {
    revision: 1,
    diagnostics: features.map((f) => ({
      span: { file: 'Sources/App.swift', start: 0, end: 1 },
      severity: 'warning' as const,
      code: f.kind === 'view' ? ('unsupported_swiftui_view' as const) : ('unsupported_swiftui_modifier' as const),
      message: `${f.name} is not drawn yet`,
      feature: f.name,
    })),
    renderTree: null,
    logs: [],
    timings: { parse: 0, check: 0, evaluate: 0, layout: 0, total: 0 },
  }
}

beforeEach(() => {
  resetCoverageCache()
  clearCoverage()
})

describe('coverage telemetry', () => {
  it('starts empty', () => {
    expect(coverageRanking()).toEqual([])
  })

  it('counts each unsupported feature the compiler reported', () => {
    recordCoverage(result([{ name: 'Chart', kind: 'view' }, { name: '.blur', kind: 'modifier' }]))

    const ranking = coverageRanking()
    expect(ranking.map((e) => e.feature).sort()).toEqual(['.blur', 'Chart'])
    expect(ranking.every((e) => e.count === 1)).toBe(true)
  })

  it('does not count the same set twice in a row', () => {
    // The keystroke problem: without this, holding a key down would make whatever is
    // on screen the most-wanted feature in the product.
    const same = result([{ name: 'Chart', kind: 'view' }])
    recordCoverage(same)
    recordCoverage(same)
    recordCoverage(same)

    expect(coverageRanking()[0]!.count).toBe(1)
  })

  it('counts again once the set has changed and come back', () => {
    recordCoverage(result([{ name: 'Chart', kind: 'view' }]))
    recordCoverage(result([]))
    recordCoverage(result([{ name: 'Chart', kind: 'view' }]))

    expect(coverageRanking()[0]!.count).toBe(2)
  })

  it('ranks by count, most wanted first', () => {
    recordCoverage(result([{ name: 'Chart', kind: 'view' }]))
    recordCoverage(result([{ name: 'Chart', kind: 'view' }, { name: 'Canvas', kind: 'view' }]))
    recordCoverage(result([{ name: 'Chart', kind: 'view' }]))

    const ranking = coverageRanking()
    expect(ranking[0]!.feature).toBe('Chart')
    expect(ranking[0]!.count).toBe(3)
    expect(ranking[1]!.feature).toBe('Canvas')
    expect(ranking[1]!.count).toBe(1)
  })

  it('counts a placeholder the checker never warned about', () => {
    // The two can diverge: a view nested where the checker did not walk still reaches
    // the screen as a placeholder, and that is exactly the case worth knowing about.
    const withPlaceholder: CompileResult = {
      ...result([]),
      renderTree: {
        canvas: { width: 100, height: 100 },
        revision: 1,
        nodes: [
          {
            id: 'p',
            kind: 'placeholder',
            frame: { x: 0, y: 0, width: 10, height: 10 },
            z: 1,
            opacity: 1,
            placeholder: { feature: 'TimelineView', reason: 'not yet' },
          },
        ],
      },
    }

    recordCoverage(withPlaceholder)
    expect(coverageRanking().map((e) => e.feature)).toEqual(['TimelineView'])
  })

  it('separates a known gap from a name nobody wrote down', () => {
    // The ranking's job is to surface what people reached for. A name already in the
    // coverage tables is a gap someone chose not to build; a name that is not in them
    // at all is the discovery, and the two must not read the same.
    recordCoverage(result([{ name: 'Chart', kind: 'view' }]))
    expect(coverageRanking()[0]!.recognised).toBe(true)
    expect(isRecognised('Chart', 'view')).toBe(true)
    expect(isRecognised('SomeoneElsesView', 'view')).toBe(false)
  })

  it('can be cleared by the user', () => {
    recordCoverage(result([{ name: 'Chart', kind: 'view' }]))
    expect(coverageRanking()).toHaveLength(1)

    clearCoverage()
    expect(coverageRanking()).toEqual([])
  })
})
