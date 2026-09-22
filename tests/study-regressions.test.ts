import { beforeEach, describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult } from '@studio/shared'
import { compile, fontForToken, resetPipelineState, setFontMetrics } from '@studio/swiftui-runtime'

/**
 * Regressions named after the study-build plan's items (feasibility-revised.md), so
 * each fix can be traced back to the defect it closes.
 */

beforeEach(() => { resetPipelineState(); setFontMetrics([]) })

function run(body: string, options: Partial<CompileRequest> = {}): CompileResult {
  const source = `import SwiftUI
@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
 var body: some View { ${body} }
}`
  const result = compile({ files: [{ id: 'App.swift', text: source }], canvas: { width: 402, height: 874 }, colorScheme: 'light', revision: 1, ...options })
  expect(result.diagnostics).toEqual([])
  expect(result.renderTree).not.toBeNull()
  return result
}

const fontOf = (r: CompileResult, value: string) =>
  r.renderTree!.nodes.find(n => n.text?.runs.some(run => run.text === value))!.text!.runs[0]!.font

describe('E1: styling modifiers do not replace inherited fonts', () => {
  const caption = fontForToken('caption', 'large')!.size
  const footnote = fontForToken('footnote', 'large')!.size

  it('keeps a container font under .buttonStyle', () => {
    const r = run('VStack { Text("Caption text"); Button("Tap") {} }.font(.caption).buttonStyle(.plain)')
    expect(fontOf(r, 'Caption text').size).toBe(caption)
    expect(fontOf(r, 'Tap').size).toBe(caption)
  })

  it('keeps a container font under .listStyle', () => {
    const r = run('List { Text("Row text") }.font(.caption).listStyle(.plain)')
    expect(fontOf(r, 'Row text').size).toBe(caption)
  })

  it('draws a custom Section footer in the footnote style under .listStyle', () => {
    const r = run('List { Section { Text("Row") } footer: { Text("Footer note") } }.listStyle(.insetGrouped)')
    expect(fontOf(r, 'Footer note').size).toBe(footnote)
  })

  it('keeps the control-size font of a styled button', () => {
    const r = run('Button("Small") {}.buttonStyle(.bordered).controlSize(.small)')
    expect(fontOf(r, 'Small').size).toBe(15)
  })

  it('still rescales default text under .dynamicTypeSize', () => {
    const r = run('VStack { Text("Scaled").dynamicTypeSize(.accessibility3); Text("Default") }')
    expect(fontOf(r, 'Scaled').size).toBe(fontForToken('body', 'accessibility3')!.size)
    expect(fontOf(r, 'Default').size).toBe(fontForToken('body', 'large')!.size)
  })
})

describe('A6: a long print run keeps its start and end', () => {
  const messages = (r: CompileResult) => r.logs.map(log => log.message)

  it('keeps the first and last thousand lines of a print loop, and says how many it left out', () => {
    const r = run('Text("x").onAppear { for i in 0..<5000 { print(i) } }')
    const lines = messages(r)
    expect(lines).toHaveLength(2001)
    expect(lines.slice(0, 3)).toEqual(['0', '1', '2'])
    expect(lines[999]).toBe('999')
    expect(lines[1000]).toBe('3,000 lines not shown')
    expect(lines[1001]).toBe('4000')
    expect(lines[2000]).toBe('4999')
    expect(r.logs[1000]!.level).toBe('log')
  })

  it('keeps an error from the middle of the run, where it happened', () => {
    const r = run(`VStack {
      Text("a").onAppear { for i in 0..<1500 { print("a\\(i)") }; let empty: [Int] = []; print(empty[1]) }
      Text("b").onAppear { for i in 0..<1500 { print("b\\(i)") } }
    }`)
    const lines = messages(r)
    expect(lines.slice(998, 1004)).toEqual(['a998', 'a999', '500 lines not shown', lines[1001], '500 lines not shown', 'b500'])
    expect(r.logs[1001]!.level).toBe('error')
    expect(lines[1001]).toContain('Index out of range')
    expect(lines.at(-1)).toBe('b1499')
    expect(lines).toHaveLength(2003)
  })

  it('keeps only the first hundred errors from the middle, so repeated failures cannot undo the cap', () => {
    const r = run(`ForEach(0..<60, id: \\.self) { row in
      ForEach(0..<50, id: \\.self) { column in
        Text("x").onAppear { let empty: [Int] = []; print(empty[row * 50 + column]) }
      }
    }`)
    const lines = messages(r)
    expect(r.logs.filter(log => log.level === 'error')).toHaveLength(2100)
    expect(lines).toHaveLength(2101)
    expect(lines[1100]).toBe('900 lines not shown')
  })

  it('shortens one enormous line, and says by how much', () => {
    const r = run('Text("x").onAppear { print(String(repeating: "x", count: 100_000)) }')
    expect(messages(r)).toEqual([`${'x'.repeat(2000)} … 98,000 more characters`])
  })
})
