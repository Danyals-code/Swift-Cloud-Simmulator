import { beforeEach, describe, expect, it } from 'vitest'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import type { CompileResult, RenderNode } from '@studio/shared'

let revision = 1
beforeEach(() => { resetPipelineState(); revision = 1 })
const text = (node: RenderNode) => node.text?.runs.map(run => run.text).join('')
/** What the DOM keys a node by, its `data-node-key` (Wave 5a). */
const keyOf = (node: RenderNode) => node.key ?? node.id
const drawn = (result: CompileResult, words: string) => result.renderTree!.nodes.find(node => text(node) === words)!
function render(body: string, extra = '') {
  const result = compile({
    projectId: 'transition-identity', revision: revision++, canvas: { width: 393, height: 852 }, colorScheme: 'light',
    files: [{ id: 'Sources/App.swift', text: `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
  @State private var shown = true
  var body: some View { VStack { ${body}; Button("Change") { shown.toggle() } }.animation(.easeInOut(duration: 1), value: shown) }
}
${extra}` }],
  })
  expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
  return result
}
function toggle(result: CompileResult) {
  const button = result.renderTree!.nodes.find(node => node.hitTarget && node.a11y?.label === 'Change')!
  expect(applyEvent({ kind: 'tap', handlerId: button.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
  return rerender(revision++)
}

describe('transition identities across conditional content', () => {
  it('keeps a leaving view apart from a shifted sibling, under the animation that removes it, and gives it its key back', () => {
    const before = render('if shown { Text("Leaving").transition(.opacity) }; Text("Remaining").transition(.scale)')
    const leaving = drawn(before, 'Leaving'), remaining = drawn(before, 'Remaining')
    const after = toggle(before)
    expect(drawn(after, 'Remaining').id).toBe(remaining.id)
    expect(keyOf(drawn(after, 'Remaining'))).toBe(keyOf(remaining))
    // Nothing drawn now has its key, so the DOM keeps it for its exit, timed by the
    // `.animation(_:value:)` around it, which the tree says (Wave 5a).
    expect(after.renderTree!.nodes.map(keyOf)).not.toContain(keyOf(leaving))
    const under = after.renderTree!.animated?.under ?? []
    expect(under.map(scope => scope.animation)).toEqual([{ curve: 'easeInOut', duration: 1 }])
    expect(keyOf(leaving).startsWith(under[0]!.key)).toBe(true)
    const restored = toggle(after)
    expect(drawn(restored, 'Leaving').id).toBe(leaving.id)
    expect(keyOf(drawn(restored, 'Leaving'))).toBe(keyOf(leaving))
    // A transition's place in its list is in its id only: keys follow the branches, and no two are one.
    for (const result of [before, after, restored]) {
      const keys = result.renderTree!.nodes.map(keyOf)
      expect(new Set(keys).size).toBe(keys.length)
      expect(keys.filter(key => key.includes('transition-'))).toEqual([])
    }
  })

  it('keeps repeated component sources distinct when an earlier conditional disappears', () => {
    const before = render('if shown { Text("Leaving").transition(.opacity) }; Badge(); Badge()', 'struct Badge: View { var body: some View { Text("Badge").transition(.scale) } }')
    const badges = (result: CompileResult) => result.renderTree!.nodes.filter(node => text(node) === 'Badge').map(node => node.id)
    expect(badges(before)).toHaveLength(2)
    expect(new Set(badges(before)).size).toBe(2)
    expect(badges(toggle(before))).toEqual(badges(before))
  })

  it('keeps ForEach row keys authoritative for identical transition source sites', () => {
    const before = render('ForEach(["one", "two"], id: \\.self) { item in Text(item).transition(.opacity) }')
    const rows = before.renderTree!.nodes.filter(node => ['one', 'two'].includes(text(node) ?? ''))
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map(node => node.id)).size).toBe(2)
    expect(rows.map(node => node.id)).toEqual(expect.arrayContaining([expect.stringMatching(/-one$/), expect.stringMatching(/-two$/)]))
    const after = toggle(before)
    expect(after.renderTree!.nodes.filter(node => ['one', 'two'].includes(text(node) ?? '')).map(node => node.id)).toEqual(rows.map(node => node.id))
  })
})
