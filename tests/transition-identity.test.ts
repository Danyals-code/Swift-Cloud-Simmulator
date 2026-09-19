import { beforeEach, describe, expect, it } from 'vitest'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import type { CompileResult, RenderNode } from '@studio/shared'
import { finishExit, reconcilePresence, type RenderGroups } from '../packages/swiftui-render-dom/src/transition-presence'

let revision = 1
beforeEach(() => { resetPipelineState(); revision = 1 })
const text = (node: RenderNode) => node.text?.runs.map(run => run.text).join('')
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
function groups(result: CompileResult): RenderGroups {
  const grouped = new Map<string, RenderNode[]>()
  for (const node of result.renderTree!.nodes) grouped.set(node.parent ?? '', [...(grouped.get(node.parent ?? '') ?? []), node])
  return grouped
}

describe('transition identities across conditional content', () => {
  it('retains an exiting view without confusing it with a shifted sibling and cancels on reentry', () => {
    const before = render('if shown { Text("Leaving").transition(.opacity) }; Text("Remaining").transition(.scale)')
    const leaving = before.renderTree!.nodes.find(node => text(node) === 'Leaving')!
    const remaining = before.renderTree!.nodes.find(node => text(node) === 'Remaining')!
    const after = toggle(before)
    expect(after.renderTree!.nodes.find(node => text(node) === 'Remaining')!.id).toBe(remaining.id)
    expect(after.renderTree!.nodes.some(node => node.id === leaving.id)).toBe(false)
    const oldGroups = groups(before), newGroups = groups(after)
    const present = reconcilePresence([], oldGroups.get('')!, oldGroups, false)
    const removed = reconcilePresence(present, newGroups.get('')!, newGroups, true)
    expect(removed.filter(entry => entry.exiting).map(entry => text(entry.node))).toEqual(['Leaving'])
    const exit = removed.find(entry => entry.exiting)!
    const restored = toggle(after), restoredGroups = groups(restored)
    expect(restored.renderTree!.nodes.find(node => text(node) === 'Leaving')!.id).toBe(leaving.id)
    const reentry = reconcilePresence(removed, restoredGroups.get('')!, restoredGroups, true)
    expect(reentry.filter(entry => entry.node.id === leaving.id)).toHaveLength(1)
    expect(reentry.some(entry => entry.exiting)).toBe(false)
    expect(finishExit(reentry, leaving.id, exit.exitToken!)).toEqual(reentry)
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
