import { describe, expect, it } from 'vitest'
import type { CompileRequest } from '@studio/shared'
import { TEMPLATES } from '@studio/project-model/templates'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * Every template compiles inside the 120 ms interaction budget.
 *
 * Timed in the performance project, after the functional tests and with nothing
 * running beside it. Timed while other test files ran on CI's runner, Trailhead read
 * 122 to 156 ms and failed 5 of 14 runs, where it takes about 60 ms alone on a Mac.
 * The 2,000-line project in `bench.test.ts` costs more and passes the same limit here.
 */

const device = DEVICES['iphone-15']

function requestFor(files: readonly { id: string; text: string }[]): CompileRequest {
  return {
    files: files.map((file) => ({ id: file.id, text: file.text })),
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: 1,
  }
}

describe.each(TEMPLATES)('template: $name', (template) => {
  it('stays inside the interaction budget', () => {
    const request = requestFor(template.files)
    resetPipelineState()
    for (let i = 0; i < 3; i++) compile(request)

    let best = Infinity
    for (let i = 0; i < 5; i++) {
      const started = performance.now()
      compile(request)
      best = Math.min(best, performance.now() - started)
    }
    expect(best).toBeLessThan(120)
  })
})
