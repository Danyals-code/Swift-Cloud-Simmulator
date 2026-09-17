import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { compile, applyEvent, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'
import type { RenderNode, RenderTree } from '@studio/shared'

const nativeRoot = new URL('../docs/parity/native/iphone18pro-light/', import.meta.url)
const measurements = JSON.parse(readFileSync(new URL('measurements.json', nativeRoot), 'utf8')).measured
const fixture = readFileSync(new URL('./fixtures/ios27-screens.swift', import.meta.url), 'utf8')
function world(tree: RenderTree, n: RenderNode) {
  let x = n.frame.x, y = n.frame.y, parent = n.parent
  while (parent) { const p = tree.nodes.find(n => n.id === parent)!; x += p.frame.x; y += p.frame.y; parent = p.parent }
  return { ...n.frame, x, y }
}

describe('supplied native phone reference', () => {
  it('keeps the original captures and fixture provenance intact', () => {
    const manifest = JSON.parse(readFileSync(new URL('measurements.json', nativeRoot), 'utf8'))
    expect(createHash('sha256').update(fixture).digest('hex')).toBe(manifest.fixtureSha256)
    for (const capture of manifest.captures) {
      const png = readFileSync(new URL(capture.file, nativeRoot))
      expect(createHash('sha256').update(png).digest('hex')).toBe(capture.sha256)
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1206, 2622])
    }
  })
  it('matches measured structural bounds and keeps presentations interactive', () => {
    resetPipelineState()
    const d = DEVICES['iphone-18-pro']
    let r = compile({ files: [{ id: 'App.swift', text: fixture }], canvas: d, safeArea: d.safeArea, displayScale: 3, colorScheme: 'light', dynamicTypeSize: 'large', revision: 1 })
    const reports: Record<string, unknown> = {}
    const nodes = () => r.renderTree!.nodes
    const dump = (name: string) => { reports[name] = nodes().filter(n => n.clip || n.material || n.hitTarget || n.id.endsWith('bgf') || n.id.endsWith('sepl') || n.text).map(n => ({ id: n.id, frame: world(r.renderTree!, n), text: n.text?.runs.map(x => x.text).join(''), lines: n.text?.lines?.length, font: n.text?.runs[0]?.font, label: n.a11y?.label })) }
    const tap = (label: string) => {
      const n = nodes().find(n => n.hitTarget && n.a11y?.label === label)!
      expect(n, label).toBeDefined()
      applyEvent({ kind: 'tap', handlerId: n.hitTarget!.handlerId, location: { x: 1, y: 1 } })
      r = rerender(r.revision + 1)
      expect(r.diagnostics).toEqual([])
    }
    expect(r.diagnostics).toEqual([])
    dump('library')
    const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1)
    const card = (suffix: string) => nodes().find(n => n.id.endsWith(suffix))!
    near(world(r.renderTree!, card('s0bgf')).y, measurements.libraryFirstCardTop)
    near(world(r.renderTree!, card('s1bgf')).y, measurements.librarySecondCardTop)
    expect(world(r.renderTree!, card('s0bgf')).x).toBe(measurements.listOuterInset)
    const longRow = nodes().find(n => n.text?.runs.some(r => r.text.startsWith('A longer row')))!
    expect(longRow.text!.lines).toHaveLength(measurements.nativeLongRowLines)
    const separator = nodes().find(n => n.id.endsWith('r0sepl'))!
    expect(separator.frame.height).toBe(1)
    const bar = nodes().find(n => n.id === 'tabbar-surface-material')!
    expect(world(r.renderTree!, bar)).toEqual({ x: 107, y: 791, width: 188, height: 62 })
    const search = nodes().find(n => n.id.endsWith('surface-fill'))!
    expect(world(r.renderTree!, search)).toEqual({ x: 16, y: 168, width: 370, height: 44 })
    const books = ['Book 1', 'Book 2'].map(value => nodes().find(n => n.text?.runs.some(r => r.text === value))!)
    expect(world(r.renderTree!, books[1]!).y - world(r.renderTree!, books[0]!).y).toBe(52)
    tap('A quiet place'); dump('details')
    tap('Show alert'); dump('alert')
    const panel = nodes().find(n => n.id === 'ov-bg-material')!
    expect(panel.frame).toEqual({ x: measurements.alertApprox.x, y: measurements.alertApprox.y, width: measurements.alertApprox.width, height: measurements.alertApprox.height })
    const pills = nodes().filter(n => /^ov-btn\d-pillf$/.test(n.id))
    expect(pills).toHaveLength(2)
    expect(pills[0]!.frame.width).toBe(140)
    expect(pills[1]!.frame.x - pills[0]!.frame.x - pills[0]!.frame.width).toBe(8)
    tap('Cancel')
    expect(nodes().some(n => n.id === 'overlay-dim')).toBe(false)
    tap('Library')
    tap('Compose'); dump('sheet')
    expect(nodes().find(n => n.id === 'overlay-surface')!.frame).toEqual({ x: 8, y: 412, width: 386, height: 454 })
    tap('Done'); tap('Settings'); dump('settings')
    near(world(r.renderTree!, card('s0bgf')).y, measurements.settingsFirstCardTop)
    near(world(r.renderTree!, card('s1bgf')).y, measurements.settingsSecondCardTop)
    const toggleTrack = nodes().find(n => n.id.endsWith('track'))!
    expect(toggleTrack.frame).toMatchObject({ width: measurements.switchApprox.width, height: measurements.switchApprox.height })
    const option = nodes().find(n => n.text?.runs.some(r => r.text === 'Options'))!
    expect(option.text!.runs[0]!.color).toEqual({ r: 203, g: 48, b: 224, a: 1 })
    tap('Options'); tap('Rename')
    expect(nodes().some(n => n.hitTarget?.value === 'Renamed')).toBe(true)
    if (process.env.DUMP_NATIVE_GEOMETRY) writeFileSync('/tmp/ios27-geometry.json', JSON.stringify(reports, null, 2))
  })
})
