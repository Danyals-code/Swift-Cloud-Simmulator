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
