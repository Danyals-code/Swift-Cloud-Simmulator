import { beforeEach, describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult, RenderNode } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { symbolShapes } from '@studio/swiftui-render-dom'
import { DEVICES } from '@studio/sim-shell'

/**
 * Controls that were drawn and could not be operated.
 *
 * Every one of these rendered correctly before Phase 9 of the defect register and
 * answered to nothing: a Stepper with two halves and no way to press either, a
 * DisclosureGroup permanently open, a Picker that wrote its own value back over
 * itself. A preview that looks interactive and is not is a worse lie than one that
 * looks static, because the user blames their code.
 *
 * The tests press things the way a person does - find a control by its accessible
 * name, tap it, look at what the screen says afterwards.
 */

const device = DEVICES['iphone-15']
let revision = 1

function run(body: string): CompileResult {
  resetPipelineState()
  const source = [
    'import SwiftUI',
    '@main',
    'struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }',
    'struct ContentView: View {',
    body,
    '}',
  ].join('\n')

  const result = compile({
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  } satisfies CompileRequest)

  expect(result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([])
  return result
}

const nodes = (r: CompileResult): readonly RenderNode[] => r.renderTree?.nodes ?? []
const texts = (r: CompileResult): string[] =>
  nodes(r).flatMap((n) => n.text?.runs.map((x) => x.text) ?? [])
const controls = (r: CompileResult): (string | undefined)[] =>
  nodes(r).filter((n) => n.hitTarget).map((n) => n.a11y?.label)
const symbols = (r: CompileResult): string[] =>
  nodes(r).flatMap((n) => (n.image?.symbol ? [n.image.symbol] : []))

/** Presses the control with this accessible name, as a person would find it. */
function tap(r: CompileResult, label: string): CompileResult {
  const target = nodes(r).find((n) => n.hitTarget && n.a11y?.label === label)
  expect(target, `no control named "${label}"; the screen has ${JSON.stringify(controls(r))}`)
    .toBeDefined()
  expect(applyEvent({ kind: 'tap', handlerId: target!.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
  return rerender(revision++)
}

beforeEach(() => {
  resetPipelineState()
})

describe('Stepper', () => {
  const stepper = (extra: string): string =>
    [
      '    @State private var n = 0',
      '    var body: some View {',
      `        Stepper("Count: \\(n)", value: $n${extra})`,
      '    }',
    ].join('\n')

  it('offers each half separately', () => {
    // One target over the whole control could only ever guess which half was meant.
    expect(controls(run(stepper('')))).toEqual(['Decrement', 'Increment'])
  })

  it('counts up and down', () => {
    let r = run(stepper(''))
    expect(texts(r)).toContain('Count: 0')
    r = tap(r, 'Increment')
    expect(texts(r)).toContain('Count: 1')
    r = tap(r, 'Increment')
    expect(texts(r)).toContain('Count: 2')
    r = tap(r, 'Decrement')
    expect(texts(r)).toContain('Count: 1')
  })

  it('counts by the step it was given', () => {
    let r = run(stepper(', step: 5'))
    r = tap(r, 'Increment')
    expect(texts(r)).toContain('Count: 5')
  })

  it('stops at the bounds rather than counting past them', () => {
    // A control that leaves its own range shows a number the app could never show.
    let r = run(stepper(', in: 0...2'))
    r = tap(r, 'Decrement')
    expect(texts(r)).toContain('Count: 0')

    r = tap(r, 'Increment')
    r = tap(r, 'Increment')
    r = tap(r, 'Increment')
    expect(texts(r)).toContain('Count: 2')
  })
})

describe('DisclosureGroup', () => {
  const group = [
    '    var body: some View {',
    '        DisclosureGroup("More") { Text("hidden") }',
    '    }',
  ].join('\n')

  it('starts closed, with its content not drawn', () => {
    const r = run(group)
    expect(texts(r)).toEqual(['More'])
    expect(symbols(r)).toContain('chevron.right')
  })

  it('opens and closes again', () => {
    let r = run(group)
    r = tap(r, 'More')
    expect(texts(r)).toContain('hidden')
    expect(symbols(r)).toContain('chevron.down')

    r = tap(r, 'More')
    expect(texts(r)).not.toContain('hidden')
    expect(symbols(r)).toContain('chevron.right')
  })

  it('reads a binding where the user gave one, rather than its own record', () => {
    const bound = [
      '    @State private var showing = true',
      '    var body: some View {',
      '        VStack {',
      '            Text("showing: \\(showing)")',
      '            DisclosureGroup("More", isExpanded: $showing) { Text("hidden") }',
      '        }',
      '    }',
    ].join('\n')

    let r = run(bound)
    expect(texts(r)).toContain('hidden')
    r = tap(r, 'More')
    expect(texts(r)).toContain('showing: false')
    expect(texts(r)).not.toContain('hidden')
  })
})

describe('Picker', () => {
  const picker = [
    '    @State private var choice = "b"',
    '    var body: some View {',
    '        VStack {',
    '            Text("Chosen: \\(choice)")',
    '            Picker("Letter", selection: $choice) {',
    '                Text("Alpha").tag("a")',
    '                Text("Beta").tag("b")',
    '                Text("Gamma").tag("c")',
    '            }',
    '        }',
    '    }',
  ].join('\n')

  it('shows no options until it is opened', () => {
    const r = run(picker)
    expect(texts(r)).not.toContain('Alpha')
    expect(controls(r)).toEqual(['Letter'])
  })

  it('opens onto the options the user wrote', () => {
    const r = tap(run(picker), 'Letter')
    expect(texts(r)).toContain('Alpha')
    expect(texts(r)).toContain('Gamma')
    expect(controls(r)).toEqual(['Letter', 'Dismiss', 'Alpha', 'Beta', 'Gamma'])
  })

  it('ticks the option currently chosen, and only that one', () => {
    // Once the list covers the control, the tick is the only thing on screen that
    // says what the value is.
    const r = tap(run(picker), 'Letter')
    expect(symbols(r).filter((s) => s === 'checkmark')).toHaveLength(1)
  })

  it('writes the selection and closes in one press', () => {
    let r = tap(run(picker), 'Letter')
    r = tap(r, 'Gamma')
    expect(texts(r)).toContain('Chosen: c')
    expect(texts(r)).not.toContain('Alpha')
  })

  it('leaves the value alone when dismissed without choosing', () => {
    let r = tap(run(picker), 'Letter')
    r = tap(r, 'Dismiss')
    expect(texts(r)).toContain('Chosen: b')
    expect(texts(r)).not.toContain('Alpha')
  })
})

describe('Menu', () => {
  const menu = [
    '    @State private var log = "none"',
    '    var body: some View {',
    '        VStack {',
    '            Text("Last: \\(log)")',
    '            Menu("Options") {',
    '                Button("First") { log = "first" }',
    '                Button("Second") { log = "second" }',
    '            }',
    '        }',
    '    }',
  ].join('\n')

  it('opens onto its buttons', () => {
    const r = tap(run(menu), 'Options')
    expect(texts(r)).toContain('First')
    expect(texts(r)).toContain('Second')
  })

  it('runs the button that was pressed, and closes', () => {
    let r = tap(run(menu), 'Options')
    r = tap(r, 'Second')
    expect(texts(r)).toContain('Last: second')
    expect(texts(r)).not.toContain('First')
  })

  it('does nothing when dismissed', () => {
    let r = tap(run(menu), 'Options')
    r = tap(r, 'Dismiss')
    expect(texts(r)).toContain('Last: none')
  })
})

describe('the dimmed area behind a presentation', () => {
  const sheet = [
    '    @State private var showing = true',
    '    var body: some View {',
    '        Text("Behind")',
    '            .sheet(isPresented: $showing) { Text("Inside") }',
    '    }',
  ].join('\n')

  it('dismisses what it sits behind when tapped', () => {
    // The coverage matrix offers this as *the* way to close a sheet in a preview,
    // and it did nothing: the dim layer is a fill with a hit target on it, and the
    // render conversion attached hit targets only to the invisible `hit` boxes, so
    // this one was dropped on the way out.
    let r = run(sheet)
    expect(texts(r)).toContain('Inside')

    r = tap(r, 'Dismiss')
    expect(texts(r)).not.toContain('Inside')
    expect(texts(r)).toContain('Behind')
  })
})

describe('SF Symbols', () => {
  it('draws `gear`, not only `gearshape`', () => {
    // One alias short of the whole common set. `gear` is the name people type.
    expect(symbolShapes('gear')).not.toBeNull()
    expect(symbolShapes('gear')).toEqual(symbolShapes('gearshape'))
  })
})
