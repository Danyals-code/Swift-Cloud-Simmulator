import { describe, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { FREE_FUNCTIONS, STDLIB_MEMBERS } from '@studio/swift-sema'
import { DEVICES } from '@studio/sim-shell'
import { EDIT_SYSTEM_PROMPT } from './edit-prompt'
import { PREVIEW_INITIALIZERS, PREVIEW_STDLIB, PREVIEW_UNSUPPORTED } from './preview-stdlib'
import { SYSTEM_PROMPT } from './prompt'

const device = DEVICES['iphone-15']

/** The preview's errors for one expression, with the names the examples use in scope. */
function errorsFor(expression: string): string[] {
  resetPipelineState()
  const source = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct Item { let kind: String }
struct ContentView: View {
    var body: some View { Text(demo()) }
    func demo() -> String {
        let x = 1.25
        let items = [Item(kind: "a"), Item(kind: "b")]
        let pairs = [("a", 1), ("b", 2)]
        _ = x; _ = items; _ = pairs
        _ = ${expression}
        return "ok"
    }
}`
  const result = compile({ files: [{ id: 'Sources/App.swift', text: source }], canvas: { width: device.width, height: device.height }, safeArea: device.safeArea, colorScheme: 'light', revision: 1 })
  return result.diagnostics.filter(d => d.severity === 'error').map(d => d.message)
}

describe('the preview standard library the model is told about', () => {
  it('is in the generation and the edit prompts', () => {
    expect(SYSTEM_PROMPT).toContain(PREVIEW_STDLIB)
    expect(EDIT_SYSTEM_PROMPT).toContain(PREVIEW_STDLIB)
  })

  it('names every member and free function the editor table has, which the runtime is tested against', () => {
    for (const [type, members] of STDLIB_MEMBERS) {
      const line = PREVIEW_STDLIB.split('\n').find(text => text.startsWith('- ') && text.slice(2).split(':')[0]!.split(', ').includes(type))
      expect(line, type).toBeDefined()
      for (const member of members) expect(line!.split(': ')[1]!.split(', '), `${type}.${member.name}`).toContain(member.name)
    }
    for (const name of FREE_FUNCTIONS.keys()) expect(PREVIEW_STDLIB).toContain(name)
    expect(PREVIEW_STDLIB).toMatch(/- Set: .*\bsubtracting\b/)
  })

  it.each(PREVIEW_INITIALIZERS)('runs %s, which it offers as a way to make a value', expression => {
    expect(errorsFor(expression)).toEqual([])
  })

  it.each(PREVIEW_UNSUPPORTED)('does not run %s, which it names as an example to avoid', (_, probe) => {
    expect(errorsFor(probe).length).toBeGreaterThan(0)
  })
})
