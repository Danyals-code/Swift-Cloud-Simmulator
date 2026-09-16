import { describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult, RenderNode } from '@studio/shared'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * The container views that were drawn as labelled placeholders - defect register 9.6.
 *
 * None of these needed a new mechanism. They were placeholders because nobody had
 * written the drawing, and a placeholder in the middle of a screen is the difference
 * between a preview someone can work from and one they cannot. Each is checked by
 * what it *draws*, not by the absence of a warning: a view that stopped warning and
 * still drew nothing would pass the weaker test.
 */

const device = DEVICES['iphone-15']
let revision = 1

function run(source: string): CompileResult {
  resetPipelineState()
  return compile({
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  } satisfies CompileRequest)
}

function app(body: string, extra = ''): string {
  return [
    'import SwiftUI',
    '@main',
    'struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }',
    'struct ContentView: View {',
    body,
    '}',
    extra,
  ].join('\n')
}

const view = (expr: string, extra = ''): string => app(`    var body: some View { ${expr} }`, extra)

const nodes = (r: CompileResult): readonly RenderNode[] => r.renderTree?.nodes ?? []

const texts = (r: CompileResult): string[] =>
  nodes(r)
    .filter((n) => n.kind === 'text')
    .map((n) => n.text?.runs.map((x) => x.text).join('') ?? '')

const placeholders = (r: CompileResult): (string | undefined)[] =>
  nodes(r)
    .filter((n) => n.kind === 'placeholder')
    .map((n) => n.placeholder?.feature)

const warnings = (r: CompileResult): string[] =>
  r.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message)

function textNode(r: CompileResult, label: string): RenderNode {
  const found = nodes(r).find(
    (n) => n.kind === 'text' && n.text?.runs.map((x) => x.text).join('') === label,
  )
  expect(found, `expected to draw "${label}"`).toBeDefined()
  return found!
}

describe('GroupBox', () => {
  it('draws its title and its contents rather than a placeholder', () => {
    const result = run(view('GroupBox("Totals") { Text("42 items") }'))
    expect(placeholders(result)).toEqual([])
    expect(texts(result)).toContain('Totals')
    expect(texts(result)).toContain('42 items')
    expect(warnings(result)).toEqual([])
  })

  it('draws a card behind the contents', () => {
    const result = run(view('GroupBox("Totals") { Text("42 items") }'))
    const card = nodes(result).find((n) => n.cornerRadius === 12 && n.background)
    expect(card, 'expected a rounded panel behind the contents').toBeDefined()
  })

  it('works without a title', () => {
    const result = run(view('GroupBox { Text("bare") }'))
    expect(placeholders(result)).toEqual([])
    expect(texts(result)).toContain('bare')
  })

  it('takes the label: closure form', () => {
    const result = run(view('GroupBox { Text("body") } label: { Text("Titled") }'))
    expect(texts(result)).toContain('Titled')
    expect(texts(result)).toContain('body')
  })

  it('puts the title above the card', () => {
    const result = run(view('GroupBox("Totals") { Text("42 items") }'))
    expect(textNode(result, 'Totals').frame.y).toBeLessThan(textNode(result, '42 items').frame.y)
  })
})

describe('LabeledContent', () => {
  it('draws the label leading and the value trailing', () => {
    const result = run(view('LabeledContent("Total", value: "$12")'))
    expect(placeholders(result)).toEqual([])

    const label = textNode(result, 'Total')
    const value = textNode(result, '$12')
    expect(label.frame.x).toBeLessThan(value.frame.x)
  })

  it('draws the value in the secondary colour, so the pair reads as a setting', () => {
    const result = run(view('LabeledContent("Total", value: "$12")'))
    expect(textNode(result, '$12').text?.runs[0]?.color).not.toEqual(
      textNode(result, 'Total').text?.runs[0]?.color,
    )
  })

  it('takes the content form too', () => {
    const result = run(view('LabeledContent("Total") { Text("$12") }'))
    expect(texts(result)).toContain('Total')
    expect(texts(result)).toContain('$12')
  })
})

describe('ControlGroup', () => {
  it('draws its controls in a row', () => {
    const result = run(
      view('ControlGroup { Button("One") { } ; Button("Two") { } }'),
    )
    expect(placeholders(result)).toEqual([])

    const one = textNode(result, 'One')
    const two = textNode(result, 'Two')
    expect(one.frame.x).toBeLessThan(two.frame.x)
    expect(one.frame.y).toBeCloseTo(two.frame.y, 1)
  })

  it('keeps its buttons pressable', () => {
    const result = run(view('ControlGroup { Button("One") { } }'))
    expect(nodes(result).some((n) => n.hitTarget?.role === 'button')).toBe(true)
  })
})

describe('Section footers', () => {
  const list = (body: string) => view(`List { ${body} }`)

  it('draws the footer under the section', () => {
    const result = run(
      list('Section("Account") { Text("Row") } footer: { Text("Explains the rows.") }'),
    )
    expect(texts(result)).toContain('Explains the rows.')
    expect(textNode(result, 'Explains the rows.').frame.y).toBeGreaterThan(
      textNode(result, 'Row').frame.y,
    )
  })

  it('draws it in the secondary colour at caption size, not as a row', () => {
    const result = run(
      list('Section("Account") { Text("Row") } footer: { Text("Explains the rows.") }'),
    )
    const footer = textNode(result, 'Explains the rows.')
    const row = textNode(result, 'Row')
    expect(footer.text?.runs[0]?.font.size).toBeLessThan(row.text!.runs[0]!.font.size)
    expect(footer.text?.runs[0]?.color).not.toEqual(row.text?.runs[0]?.color)
  })

  it('leaves a section without one unchanged', () => {
    const result = run(list('Section("Account") { Text("Row") }'))
    expect(texts(result)).toContain('Row')
    expect(texts(result)).toContain('ACCOUNT')
  })

  it('keeps the header above and the footer below the same section', () => {
    const result = run(
      list('Section("Account") { Text("Row") } footer: { Text("Note.") }'),
    )
    expect(textNode(result, 'ACCOUNT').frame.y).toBeLessThan(textNode(result, 'Row').frame.y)
    expect(textNode(result, 'Row').frame.y).toBeLessThan(textNode(result, 'Note.').frame.y)
  })
})
