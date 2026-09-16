import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { RenderTree } from '@studio/shared'
import { compile, applyEvent, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

const fixture = readFileSync(new URL('./fixtures/ios27-screens.swift', import.meta.url), 'utf8')

/** These are browser geometry baselines, NOT native iOS measurements. */
function landmarks(tree: RenderTree) {
  return tree.nodes.filter(n => n.id === 'screen' || n.clip || n.material || n.chromeRole || n.hitTarget ||
    n.text && !/^Book (?:[2-9]|1\d|20)$/.test(n.text.runs.map(r => r.text).join(''))).map(n => ({
    id: n.id, parent: n.parent, frame: Object.fromEntries(Object.entries(n.frame).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
    corner: n.cornerRadius, clip: n.clip, background: n.background, material: n.material, chrome: n.chromeRole,
    text: n.text?.runs.map(r => ({ text: r.text, font: r.font, color: r.color })),
    lines: n.text?.lines?.length, control: n.hitTarget?.role, enabled: n.hitTarget?.enabled, inert: n.inert,
  }))
}

describe('ios-27 provisional geometry regression gate', () => {
  for (const [device, scheme, type] of [
    ['iphone-se-3', 'light', 'large'], ['iphone-se-3', 'dark', 'large'],
    ['iphone-15', 'light', 'large'], ['iphone-15', 'dark', 'large'],
    ['iphone-18-pro', 'light', 'large'],
    ['ipad-11', 'light', 'large'], ['ipad-11', 'dark', 'large'],
    ['iphone-15', 'light', 'accessibility3'],
  ] as const) {
    it(`${device} ${scheme} ${type}`, () => {
      resetPipelineState()
      const d = DEVICES[device]
      let result = compile({ files: [{ id: 'App.swift', text: fixture }], canvas: d, safeArea: d.safeArea, colorScheme: scheme, dynamicTypeSize: type, displayScale: d.scale, revision: 1 })
      expect(result.diagnostics).toEqual([])
      const screens: Record<string, ReturnType<typeof landmarks>> = { library: landmarks(result.renderTree!) }
      const tap = (name: string) => {
        const target = result.renderTree!.nodes.find(n => n.hitTarget && n.a11y?.label === name)!
        expect(target, name).toBeDefined()
        applyEvent({ kind: 'tap', handlerId: target.hitTarget!.handlerId, location: { x: 1, y: 1 } })
        result = rerender(result.revision + 1)
        expect(result.diagnostics).toEqual([])
      }
      tap('Compose')
      screens.sheet = landmarks(result.renderTree!)
      tap('Done')
      tap('Settings')
      screens.settings = landmarks(result.renderTree!)
      tap('Options')
      expect(result.renderTree!.nodes.find(n => n.id === 'overlay-menu')?.anchorId).toBeTruthy()
      screens.menu = landmarks(result.renderTree!)
      expect(screens).toMatchSnapshot()
    })
  }
})
