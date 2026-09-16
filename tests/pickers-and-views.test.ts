import { describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult, RenderNode } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * The two controls that were drawn and could not open (defect register 9.1), and the
 * views of 9.6 that needed drawing rather than deciding.
 *
 * `DatePicker` and `ColorPicker` were the two the earlier controls pass left, because
 * neither can be a list of the options the user wrote - what made the other four
 * cheap. They share the menu's *mechanism* - open, choose, close - and none of its
 * content: a calendar and a palette.
 *
 * `Table` is here for a different reason. It is listed as unimplemented, and it
 * stopped the whole preview instead of drawing the labelled box that listing
 * promises.
 */

const device = DEVICES['iphone-15']
let revision = 1

function request(source: string): CompileRequest {
  return {
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  }
}

function run(source: string): CompileResult {
  resetPipelineState()
  return compile(request(source))
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
    .map((n) => n.text!.runs.map((x) => x.text).join(''))

const warnings = (r: CompileResult): string[] =>
  r.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message)

const errors = (r: CompileResult): string[] =>
  r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)

function press(r: CompileResult, label: string): CompileResult {
  const target = nodes(r).find((n) => n.hitTarget && n.a11y?.label === label)
  expect(target, `no control called "${label}"`).toBeDefined()
  applyEvent({ kind: 'tap', handlerId: target!.hitTarget!.handlerId, location: { x: 0, y: 0 } })
  return rerender(revision++)
}

describe('DatePicker', () => {
  // A fixed instant, so the calendar under test is always the same month.
  const source = app(
    [
      '    @State private var when = Date(timeIntervalSince1970: 1750000000)',
      '    var body: some View { VStack { Text("at \\(when.timeIntervalSince1970)") ; DatePicker("When", selection: $when) } }',
    ].join('\n'),
  )

  it('shows a formatted date rather than a description of one', () => {
    // It showed `2025-06-15 15:06:40 +0000`, which is plausible-looking and is not a
    // string any date picker on iOS has ever drawn.
    const drawn = texts(run(source))
    expect(drawn.some((t) => t.includes('2025') && !t.includes('+0000'))).toBe(true)
  })

  it('honours displayedComponents', () => {
    const dateOnly = texts(
      run(view('DatePicker("When", selection: .constant(Date()), displayedComponents: [.date])')),
    )
    expect(dateOnly.some((t) => /\d{4}/.test(t) && !/:\d\d/.test(t))).toBe(true)
  })

  it('opens onto a calendar', () => {
    resetPipelineState()
    const opened = press(compile(request(source)), 'When')
    expect(texts(opened)).toContain('June 2025')
    // Weekday initials and the days themselves.
    expect(texts(opened)).toContain('1')
    expect(texts(opened)).toContain('30')
  })

  it('writes the binding when a day is chosen, keeping the time of day', () => {
    resetPipelineState()
    const opened = press(compile(request(source)), 'When')
    const chosen = press(opened, '20')

    const before = texts(run(source)).find((t) => t.startsWith('at '))!
    const after = texts(chosen).find((t) => t.startsWith('at '))!
    expect(after).not.toBe(before)

    // Five days on from the 15th, to the second: the time of day is untouched.
    const seconds = (label: string) => Number(label.slice(3))
    expect(seconds(after) - seconds(before)).toBe(5 * 86_400)
  })

  it('closes when a day is chosen', () => {
    resetPipelineState()
    const opened = press(compile(request(source)), 'When')
    expect(texts(press(opened, '20'))).not.toContain('June 2025')
  })

  it('pages to another month without moving the value', () => {
    resetPipelineState()
    const opened = press(compile(request(source)), 'When')
    const paged = press(opened, '›')

    expect(texts(paged)).toContain('July 2025')
    // Still open - an arrow is a press *within* the editor, not a choice made from it.
    expect(texts(paged).some((t) => t === '1')).toBe(true)

    const before = texts(run(source)).find((t) => t.startsWith('at '))!
    expect(texts(paged).find((t) => t.startsWith('at '))).toBe(before)
  })
})

describe('ColorPicker', () => {
  const source = app(
    [
      '    @State private var tint = Color.blue',
      '    var body: some View { ColorPicker("Tint", selection: $tint) }',
    ].join('\n'),
  )

  it('opens onto a palette of the colours SwiftUI names', () => {
    // Named colours rather than a continuous surface: a preview that let you land on
    // a colour the exported Swift cannot say would be worse than one that offers the
    // colours it can.
    resetPipelineState()
    const opened = press(compile(request(source)), 'Tint')
    expect(nodes(opened).filter((n) => n.shape?.shape === 'circle').length).toBeGreaterThan(8)
  })

  it('writes the binding when a swatch is chosen', () => {
    const swatched = app(
      [
        '    @State private var tint = Color.blue',
        '    var body: some View { VStack { Rectangle().fill(tint).frame(width: 10, height: 10) ; ColorPicker("Tint", selection: $tint) } }',
      ].join('\n'),
    )
    resetPipelineState()
    const before = compile(request(swatched))
    const blue = nodes(before).find((n) => n.shape?.shape === 'rectangle')?.shape?.fill

    const opened = press(before, 'Tint')
    const target = nodes(opened).filter((n) => n.hitTarget).at(-1)!
    applyEvent({ kind: 'tap', handlerId: target.hitTarget!.handlerId, location: { x: 0, y: 0 } })
    const after = rerender(revision++)

    expect(nodes(after).find((n) => n.shape?.shape === 'rectangle')?.shape?.fill).not.toEqual(blue)
  })
})

describe('the views that only needed drawing', () => {
  it('NavigationSplitView collapses to a stack, which is what a phone does', () => {
    const result = run(
      view('NavigationSplitView { Text("sidebar") } detail: { Text("detail") }'),
    )
    expect(warnings(result)).toEqual([])
    expect(texts(result)).toContain('sidebar')
  })

  it('TimelineView draws its content once', () => {
    const result = run(
      view('TimelineView(.periodic(from: .now, by: 1)) { _ in Text("tick") }'),
    )
    expect(warnings(result)).toEqual([])
    expect(texts(result)).toContain('tick')
  })

  it('.popover no longer claims to be unapplied', () => {
    // It has been drawing all along - as a sheet, which is what iOS does at this
    // width - while warning that it was not applied.
    resetPipelineState()
    const source = app(
      [
        '    @State private var showing = false',
        '    var body: some View {',
        '        Button("open") { showing = true }',
        '            .popover(isPresented: $showing) { Text("inside") }',
        '    }',
      ].join('\n'),
    )
    const first = compile(request(source))
    expect(warnings(first)).toEqual([])
    expect(texts(press(first, 'open'))).toContain('inside')
  })

  it('.tabViewStyle(.page) draws dots rather than a labelled bar', () => {
    const result = run(
      view('TabView { Text("one").tabItem { Text("One") } ; Text("two").tabItem { Text("Two") } }.tabViewStyle(.page)'),
    )
    expect(warnings(result)).toEqual([])
    expect(texts(result)).toContain('one')
    // The tab items' labels are not drawn - a page view has no labels.
    expect(texts(result)).not.toContain('One')
    expect(nodes(result).filter((n) => n.shape?.shape === 'circle').length).toBe(2)
  })

  it('a page dot is the way through to its page', () => {
    resetPipelineState()
    const source = view(
      'TabView { Text("one") ; Text("two") }.tabViewStyle(.page)',
    )
    const first = compile(request(source))
    expect(texts(first)).toContain('one')
    expect(texts(press(first, 'Page 2'))).toContain('two')
  })
})

describe('a view the preview does not draw stops at its own box', () => {
  it('Table draws a placeholder rather than stopping the screen', () => {
    // `TableColumn("Name") { row in … }` had its closure run with nothing to pass, so
    // `row` was nil and reading a property of it trapped - and a view listed as
    // unimplemented took the whole preview down instead of drawing its labelled box.
    const result = run(
      view('VStack { Text("above") ; Table(rows) { TableColumn("Name") { r in Text(r.name) } } }', 'struct Row: Identifiable { let id: Int\n let name: String }\nlet rows = [Row(id: 1, name: "a")]'),
    )
    expect(errors(result)).toEqual([])
    expect(texts(result)).toContain('above')
    expect(nodes(result).some((n) => n.placeholder?.feature === 'Table')).toBe(true)
  })
})
