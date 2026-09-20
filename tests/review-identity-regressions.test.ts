import { expect, it } from 'vitest'
import type { CompileResult } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'

const texts = (result: CompileResult) => result.renderTree?.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? []) ?? []
function preview(body: string) {
  resetPipelineState()
  let revision = 1
  let result = compile({ projectId: 'identity-regression', revision, canvas: { width: 393, height: 852 }, colorScheme: 'light', files: [{ id: 'Sources/App.swift', text: `import SwiftUI
    @main struct DemoApp: App { var body: some Scene { WindowGroup { Root() } } }
    struct Root: View {
      @State var showing = true
      var body: some View { VStack { Button("Switch") { showing.toggle() }; ${body} } }
    }
    struct Counter: View {
      let label: String
      @State var count = 0
      var body: some View { Button("\\(label) \\(count)") { count += 1 } }
    }` }] })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  return {
    texts: () => texts(result),
    tap(label: string) {
      const target = result.renderTree!.nodes.find(n => n.hitTarget && n.a11y?.label === label)
      expect(target, `missing ${label}`).toBeDefined()
      applyEvent({ kind: 'tap', handlerId: target!.hitTarget!.handlerId, location: { x: 0, y: 0 } })
      result = rerender(++revision)
      expect(result.logs.filter(log => log.level === 'error')).toEqual([])
    },
  }
}

it('keeps a permanent sibling independent when a preceding conditional view disappears', () => {
  const app = preview('if showing { Counter(label: "First") }; Counter(label: "Second")')
  app.tap('First 0'); app.tap('First 1'); app.tap('Second 0'); app.tap('Switch')
  expect(app.texts()).toContain('Second 1')
  app.tap('Switch')
  expect(app.texts()).toEqual(expect.arrayContaining(['First 0', 'Second 1']))
})

it('resets same-type state when changing conditional branches', () => {
  const app = preview('if showing { Counter(label: "First") } else { Counter(label: "Other") }')
  app.tap('First 0'); app.tap('Switch')
  expect(app.texts()).toContain('Other 0')
  app.tap('Switch')
  expect(app.texts()).toContain('First 0')
})

it('distinguishes conditional slots inside separate same-type containers', () => {
  const app = preview('VStack { if showing { Counter(label: "First") } }; VStack { if true { Counter(label: "Second") } }')
  app.tap('First 0'); app.tap('First 1'); app.tap('Second 0'); app.tap('Switch')
  expect(app.texts()).toContain('Second 1')
})

it('keeps a sibling outside a switch independent of its selected case', () => {
  const app = preview('switch showing { case true: Counter(label: "First"); default: Text("Hidden") }; Counter(label: "Second")')
  app.tap('First 0'); app.tap('Second 0'); app.tap('Switch')
  expect(app.texts()).toEqual(expect.arrayContaining(['Hidden', 'Second 1']))
})
