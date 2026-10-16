import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import type { AuthoringNode } from '@studio/shared'
import { XCODE, draw, edited, project, refusal, screen, typecheckInXcode, viewWritten } from './helpers/layer-project'

/**
 * Shown when (Wave 5a): a view shown only while a value holds, read from the `if` around
 * it, and written back as one. Read and written through the authoring model and the edit
 * planner, as the panel does.
 */

/** A screen with `members` and `body`, as `screen` writes it, with the members in ContentView. */
const withState = (members: string, body: string, declarations = '') => screen(body, declarations).replace('struct ContentView: View {\n', `struct ContentView: View {\n${members}\n`)

const visibilityOf = (source: string, view: string): NonNullable<AuthoringNode['visibility']> => {
  const found = viewWritten(source, view).visibility
  if (!found) throw new Error(`${view} has no visibility`)
  return found
}

describe('Shown when: reading', () => {
  it('reads a view that is the only view of an if on a Bool as shown while it is on', () => {
    const source = withState('    @State private var showDetails = false', `        VStack {
            if showDetails {
                Text("Check-in opens 24 hours before departure.")
            }
            Text("Always here")
        }`)
    const visibility = visibilityOf(source, 'Text("Check-in opens 24 hours before departure.")')
    expect(visibility).toMatchObject({ when: { input: 'showDetails', is: true }, condition: 'showDetails', editable: true, label: 'Show details is on', hiddenWhile: 'Show details is off' })
    expect(visibility.options).toEqual([
      { when: { input: 'showDetails', is: true }, label: 'When Show details is on' },
      { when: { input: 'showDetails', is: false }, label: 'When Show details is off' },
    ])
    const always = visibilityOf(source, 'Text("Always here")')
    expect(always.when).toBeUndefined()
    expect(always.condition).toBeUndefined()
    expect(always.editable).toBe(true)
  })
})

describe('Shown when: each condition Design writes', () => {
  const declarations = `
enum Phase {
    case idle, loading
}

@Observable final class Store {
    var isLoading = false
}
`
  const members = `    @State private var showDetails = false
    @State private var phase = Phase.idle
    @State private var items: [String] = ["A"]
    @State private var selection: String? = nil
    @State private var store = Store()`
  const shown = (condition: string) => visibilityOf(withState(members, `        VStack {
            if ${condition} {
                Text("Shown")
            }
        }`, declarations), 'Text("Shown")')

  it.each([
    ['!showDetails', { input: 'showDetails', is: false }, 'Show details is off'],
    ['phase == .loading', { input: 'phase', is: 'loading' }, 'Phase is Loading'],
    ['items.isEmpty', { input: 'items', is: 'empty' }, 'Items is empty'],
    ['!items.isEmpty', { input: 'items', is: 'items' }, 'Items has items'],
    ['selection != nil', { input: 'selection', is: 'some' }, 'Selection is set'],
    ['selection == nil', { input: 'selection', is: 'none' }, 'Selection isn’t set'],
    ['store.isLoading', { input: 'store.isLoading', is: true }, 'Loading is on'],
  ])('reads if %s', (condition, when, label) => {
    expect(shown(condition)).toMatchObject({ when, condition, editable: true, label })
  })

  it('reads if case .loading = phase as the case it matches, and writes another choice plainly', () => {
    expect(shown('case .loading = phase')).toMatchObject({ when: { input: 'phase', is: 'loading' }, condition: 'case .loading = phase', editable: true, label: 'Phase is Loading', shows: [expect.objectContaining({ name: 'phase', value: 'loading' })] })
    const source = withState(members, '        VStack {\n            if case .loading = phase {\n                Text("Shown")\n            }\n        }', declarations)
    expect(edited(source, 'Text("Shown")', { kind: 'visibility', when: { input: 'phase', is: 'idle' } })).toBe(source.replace('if case .loading = phase {', 'if phase == .idle {'))
  })

  it('says why a view shown for every case but one is read only, with what shows it', () => {
    expect(shown('phase != .idle')).toMatchObject({ condition: 'phase != .idle', editable: false, problem: 'This view shows for every case but one, and Shown when offers each case on its own. Change it in Code.', shows: [expect.objectContaining({ name: 'phase', value: 'loading' })] })
  })

  it('reads a condition in brackets as what is in them, writes it plainly, and gives its else the other side', () => {
    expect(shown('(showDetails)')).toMatchObject({ condition: 'showDetails', when: { input: 'showDetails', is: true }, editable: true })
    const source = withState(members, '        VStack {\n            if (showDetails) {\n                Text("Shown")\n            } else {\n                Text("Other")\n            }\n        }', declarations)
    expect(visibilityOf(source, 'Text("Other")')).toMatchObject({ condition: '!showDetails', shows: [expect.objectContaining({ name: 'showDetails', value: false })] })
    const alone = withState(members, '        VStack {\n            if (showDetails) {\n                Text("Shown")\n            }\n        }', declarations)
    expect(edited(alone, 'Text("Shown")', { kind: 'visibility', when: { input: 'showDetails', is: false } })).toBe(alone.replace('if (showDetails) {', 'if !showDetails {'))
  })

  it('offers each value of the screen with its other side, and a case for each case', () => {
    expect(shown('showDetails').options.map(option => option.label)).toEqual([
      'When Show details is on', 'When Show details is off',
      'When Phase is Idle', 'When Phase is Loading',
      'When Items is empty', 'When Items has items',
      'When Selection is set', 'When Selection isn’t set',
      'When Loading is on', 'When Loading is off',
    ])
  })

  it('tells a value of the screen and one of its model with the same name apart', () => {
    const source = withState('    @State private var items: [String] = []\n    @State private var store = Store()', `        VStack {
            Text("Shown")
            Text("Always")
        }`, '\n@Observable final class Store {\n    var items: [String] = []\n}\n')
    expect(visibilityOf(source, 'Text("Shown")').options.map(option => option.label)).toEqual(['When Items is empty', 'When Items has items', 'When Store items is empty', 'When Store items has items'])
  })

  it.each([
    ['showDetails && !items.isEmpty', 'This condition reads more than one value, so only Code changes it.'],
    ['showDetails, phase == .idle', 'This condition reads more than one value, so only Code changes it.'],
    ['let picked = selection', 'This view uses the value it is shown by. Change its condition in Code.'],
    ['Calendar.current.isDateInWeekend(.now)', 'Calendar.current.isDateInWeekend(.now) is worked out when the app runs, not read from a value the screen or its model stores, so the preview can’t set it. Change it in Code.'],
  ])('reads if %s as written, and says why only Code changes it', (condition, problem) => {
    const visibility = shown(condition)
    expect(visibility).toMatchObject({ condition, editable: false, problem })
    expect(visibility.when).toBeUndefined()
  })
})

describe('Shown when: where it can be set', () => {
  it('reads a view that shares its if, or one with an else, as written', () => {
    const source = withState('    @State private var on = true', `        VStack {
            if on {
                Text("One")
                Text("Two")
            } else {
                Text("Off")
            }
        }`)
    expect(visibilityOf(source, 'Text("One")')).toMatchObject({ condition: 'on', editable: false, problem: 'This view shares its condition with another view. Change it in Code.' })
    expect(visibilityOf(source, 'Text("Off")')).toMatchObject({ condition: '!on', editable: false, problem: 'This view is shown when the condition above it is false. Change it in Code.', shows: [{ name: 'on', value: false }] })
  })

  it('reads a view in an else if, and in the else after it, as written, with what draws it', () => {
    const source = withState('    @State private var a = false\n    @State private var b = false\n    @State private var other = false', `        VStack {
            if a {
                Text("A")
            } else if b {
                Text("ElseIf")
            } else {
                Text("Neither")
            }
        }`)
    const elseIf = 'This view is in an else if, shown only while the condition above it is false. Change it in Code.'
    expect(visibilityOf(source, 'Text("ElseIf")')).toMatchObject({ condition: '!a && b', editable: false, problem: elseIf, shows: [expect.objectContaining({ name: 'b', value: true }), expect.objectContaining({ name: 'a', value: false })] })
    expect(visibilityOf(source, 'Text("ElseIf")').when).toBeUndefined()
    expect(visibilityOf(source, 'Text("Neither")')).toMatchObject({ condition: '!a && !b', editable: false, problem: 'This view is shown when the conditions above it are false. Change it in Code.', shows: [expect.objectContaining({ name: 'b', value: false }), expect.objectContaining({ name: 'a', value: false })] })
    expect(refusal(source, 'Text("ElseIf")', { kind: 'visibility', when: null })).toBe(elseIf)
    expect(refusal(source, 'Text("ElseIf")', { kind: 'visibility', when: { input: 'other', is: true } })).toBe(elseIf)
  })

  it('sends a view inside one an else shows to Code, as that view’s condition is changed there', () => {
    const source = withState('    @State private var show = false', `        VStack {
            if show {
                Text("On")
            } else {
                HStack {
                    Text("Inside")
                }
            }
        }`)
    expect(visibilityOf(source, 'Text("Inside")')).toMatchObject({ condition: '!show', editable: false, problem: 'This view is in the HStack shown when !show. Change it in Code.', shows: [expect.objectContaining({ name: 'show', value: false })] })
  })

  it('reads an if and its else in a view builder helper, and draws the screen', () => {
    const source = withState('    @State private var show = true', `        VStack {
            badge
        }`).replace('    var body: some View {', '    @ViewBuilder private var badge: some View {\n        if show {\n            Text("On")\n        } else {\n            Image(systemName: "star")\n        }\n    }\n\n    var body: some View {')
    expect(() => draw(project(source))).not.toThrow()
    expect(visibilityOf(source, 'Text("On")')).toMatchObject({ condition: 'show', editable: false, shows: [expect.objectContaining({ name: 'show', value: true })] })
    expect(visibilityOf(source, 'Image(systemName: "star")')).toMatchObject({ condition: '!show', editable: false, shows: [expect.objectContaining({ name: 'show', value: false })] })
  })

  it('refuses the screen’s only view, and gives none to a view written as an argument or a toolbar item', () => {
    const source = withState('    @State private var on = true', `        VStack {
            Text("A").overlay(Text("Badge"))
        }
        .toolbar {
            ToolbarItem {
                Button("Edit") { }
            }
        }`)
    const nodes = buildAuthoringModel({ projectId: 'p', revision: 1, files: project(source) }).nodes
    const root = nodes.find(n => n.name === 'VStack')!, item = nodes.find(n => n.name === 'ToolbarItem')!
    expect(root.visibility).toMatchObject({ editable: false, problem: 'This is the screen’s only view, so it is always shown. Put it in a stack first, or choose a view inside it.' })
    expect(item.visibility).toBeUndefined()
    expect(viewWritten(source, 'Text("Badge")').visibility).toBeUndefined()
    expect(visibilityOf(source, 'Button("Edit") { }')).toMatchObject({ editable: true })
  })

  it('gives what draws a view in nested ifs: its condition and the ones around it', () => {
    const source = withState('    @State private var signedIn = false\n    @State private var showDetails = false', `        VStack {
            if signedIn {
                VStack {
                    if showDetails {
                        Text("Details")
                    }
                }
            }
        }`)
    expect(visibilityOf(source, 'Text("Details")').shows).toEqual([
      expect.objectContaining({ name: 'showDetails', value: true }),
      expect.objectContaining({ name: 'signedIn', value: true }),
    ])
  })

  it('reads a view inside a view an if shows by that if, read only, and never writes a second if', () => {
    const source = withState('    @State private var show = false\n    @State private var other = false', `        VStack {
            if show {
                VStack {
                    Text("Nested")
                    Text("Sibling")
                }
            }
            Text("Always")
        }`)
    const nested = visibilityOf(source, 'Text("Nested")')
    expect(nested).toMatchObject({ condition: 'show', editable: false, problem: 'This view is in the VStack shown when show. Set it there.', hiddenWhile: 'Show is off', shows: [expect.objectContaining({ name: 'show', value: true })] })
    expect(nested.when).toBeUndefined()
    expect(refusal(source, 'Text("Nested")', { kind: 'visibility', when: { input: 'other', is: true } })).toBe('This view is in the VStack shown when show. Set it there.')
  })

  it('names a new switch free on its screen', () => {
    const source = withState('    @State private var isShown = false', `        VStack {
            Text("A")
        }`)
    expect(visibilityOf(source, 'Text("A")').newName).toBe('isShown2')
    expect(visibilityOf(withState('', '        VStack {\n            Text("A")\n        }'), 'Text("A")').newName).toBe('isShown')
  })
})

describe('Shown when: hidden in the preview', () => {
  const drawnIn = (start: boolean) => {
    const source = withState(`    @State private var showDetails = ${start}`, `        VStack {
            if showDetails {
                Text("Details")
            } else {
                Text("Summary")
            }
            Text("Always here")
        }`)
    const nodes = draw(project(source)).authoring!.nodes
    return Object.fromEntries(['Details', 'Summary', 'Always here'].map(words => [words, nodes.find(n => n.name === 'Text' && n.properties[0]?.expression === `"${words}"`)!.runtimeIds.length > 0]))
  }

  it('leaves a view its condition hides undrawn, while the view around it is drawn', () => {
    expect(drawnIn(false)).toEqual({ Details: false, Summary: true, 'Always here': true })
    expect(drawnIn(true)).toEqual({ Details: true, Summary: false, 'Always here': true })
  })

  it('keeps the condition of a view hidden by an if at the top of a drawn screen, and what shows it', () => {
    const source = withState('    @State private var showDetails = false', `        if showDetails {
            Text("Details")
        }
        Text("Always here")`)
    const details = draw(project(source)).authoring!.nodes.find(n => n.name === 'Text' && n.properties[0]?.expression === '"Details"')!
    expect(details.runtimeIds).toEqual([])
    expect(details.visibility).toMatchObject({ when: { input: 'showDetails', is: true }, condition: 'showDetails', shows: [expect.objectContaining({ name: 'showDetails', value: true })] })
    expect(details.visibility).not.toHaveProperty('hidden')
  })
})

describe('Shown when: writing', () => {
  const details = 'Text("Check-in opens 24 hours before departure.")'
  const before = withState('    @State private var showDetails = false', `        VStack {
            ${details}
            Text("Always here")
        }`)

  it('wraps a view in an if, one step further in', () => {
    expect(edited(before, details, { kind: 'visibility', when: { input: 'showDetails', is: true } })).toBe(withState('    @State private var showDetails = false', `        VStack {
            if showDetails {
                ${details}
            }
            Text("Always here")
        }`))
  })

  it('makes a new switch that starts as the designer picks, and shows the view by it', () => {
    const source = withState('', `        VStack {
            ${details}
            Text("Always here")
        }`)
    expect(edited(source, details, { kind: 'visibility', when: { input: 'showsText', is: true }, create: { name: 'showsText', value: true } })).toBe(withState('', `        VStack {
            if showsText {
                ${details}
            }
            Text("Always here")
        }`).replace('\n\n    var body', '\n\n    @State private var showsText = true\n    var body'))
  })

  it('declares a new switch with the screen’s other values, keeping the blank line before the body', () => {
    const spaced = withState('    @State private var showDetails = false\n', `        VStack {
            ${details}
            Text("Always here")
        }`)
    expect(edited(spaced, details, { kind: 'visibility', when: { input: 'showsNote', is: true }, create: { name: 'showsNote', value: true } })).toContain(`struct ContentView: View {
    @State private var showDetails = false
    @State private var showsNote = true

    var body: some View {
        VStack {
            if showsNote {`)
  })

  const shown = withState('    @State private var showDetails = false\n    @State private var items: [String] = []', `        VStack {
            if showDetails {
                ${details}
            }
            Text("Always here")
        }`)

  it('rewrites the condition of the if a view is the only view of', () => {
    expect(edited(shown, details, { kind: 'visibility', when: { input: 'items', is: 'empty' } })).toBe(shown.replace('if showDetails {', 'if items.isEmpty {'))
    expect(edited(shown, details, { kind: 'visibility', when: { input: 'showDetails', is: false } })).toBe(shown.replace('if showDetails {', 'if !showDetails {'))
  })

  it('takes the if away when it is always shown', () => {
    expect(edited(shown, details, { kind: 'visibility', when: null })).toBe(withState('    @State private var showDetails = false\n    @State private var items: [String] = []', `        VStack {
            ${details}
            Text("Always here")
        }`))
  })

  it('moves a view written over several lines in and out whole, with its comments and switched-off modifiers', () => {
    const chain = `Text("Title")
                // The heading
                .font(.title)
                .padding()`
    const source = withState('    @State private var on = true', `        VStack {
            ${chain}
            Text("Always here")
        }`)
    const wrapped = edited(source, chain, { kind: 'visibility', when: { input: 'on', is: true } })
    expect(wrapped).toBe(withState('    @State private var on = true', `        VStack {
            if on {
                Text("Title")
                    // The heading
                    .font(.title)
                    .padding()
            }
            Text("Always here")
        }`))
    const inner = chain.replaceAll('\n                ', '\n                    ')
    expect(edited(wrapped, inner, { kind: 'visibility', when: null })).toBe(source)
  })

  it('writes on the line a view shares with another', () => {
    const source = withState('    @State private var on = true', `        HStack {
            Text("A"); Text("B")
        }`)
    expect(edited(source, 'Text("B")', { kind: 'visibility', when: { input: 'on', is: false } })).toBe(source.replace('Text("A"); Text("B")', 'Text("A"); if !on { Text("B") }'))
  })

  it('makes a helper a view builder when its view is shown by a condition', () => {
    const source = withState('    @State private var on = true', `        VStack {
            header
            Text("Body")
        }`).replace('    var body: some View {', '    private var header: some View {\n        Text("Header")\n    }\n\n    var body: some View {')
    expect(edited(source, 'Text("Header")', { kind: 'visibility', when: { input: 'on', is: true } })).toBe(source.replace('    private var header: some View {\n        Text("Header")\n', '    @ViewBuilder\n    private var header: some View {\n        if on {\n            Text("Header")\n        }\n'))
  })

  it.each([
    ['an if with an else', `if on {\n                Text("On")\n            } else {\n                Text("Off")\n            }`, 'Text("On")', 'This view is shown when'],
    ['an if shared with another view', `if on {\n                Text("On")\n                Text("Too")\n            }`, 'Text("On")', 'This view shares its condition with another view. Change it in Code.'],
    ['a note beside the view', `if on {\n                // Shown on launch\n                Text("On")\n            }`, 'Text("On")', 'This if holds a note or a hidden view beside the view, which only Code keeps. Change it in Code.'],
  ])('refuses to unwrap %s', (_, written, view, problem) => {
    const source = withState('    @State private var on = true', `        VStack {
            ${written}
            Text("Always here")
        }`)
    const target = view === 'Text("On")' && written.includes('else') ? 'Text("Off")' : view
    expect(refusal(source, target, { kind: 'visibility', when: null })).toContain(problem)
  })

  it('makes a new switch for a view in a helper written before the body', () => {
    const source = withState('', `        VStack {
            header
            Text("Body")
        }`).replace('    var body: some View {', '    private var header: some View {\n        Text("Header")\n    }\n\n    var body: some View {')
    expect(edited(source, 'Text("Header")', { kind: 'visibility', when: { input: 'isShown', is: true }, create: { name: 'isShown', value: false } })).toBe(source
      .replace('    private var header: some View {\n        Text("Header")\n', '    @ViewBuilder\n    private var header: some View {\n        if isShown {\n            Text("Header")\n        }\n')
      .replace('\n\n    var body: some View {', '\n\n    @State private var isShown = false\n    var body: some View {'))
  })

  it('reads a view in a switch as written', () => {
    const source = withState('    @State private var phase = Phase.idle', `        VStack {
            switch phase {
            case .idle:
                Text("Idle")
            default:
                Text("Busy")
            }
        }`, '\nenum Phase {\n    case idle, loading\n}\n')
    expect(visibilityOf(source, 'Text("Idle")')).toMatchObject({ condition: 'phase is .idle', editable: false })
    expect(visibilityOf(source, 'Text("Busy")')).toMatchObject({ condition: 'phase is none of the cases above', editable: false })
  })

  it('keeps the view selected where it lands', () => {
    const source = withState('', `        VStack {
            ${details}
        }`).replace('VStack {', 'VStack {\n            Text("First")')
    for (const operation of [{ kind: 'visibility' as const, when: { input: 'showsText', is: false }, create: { name: 'showsText', value: true } }]) {
      const target = viewWritten(source, details)
      const plan = planDesignEdit({ projectId: 'layer', baseRevision: 1, files: project(source), scope: target.owner, target: target.source, fingerprint: target.fingerprint, operation })
      if (!plan.ok) throw new Error(plan.reason)
      const after = plan.changes[0]!.after
      expect(plan.selection?.offset).toBe(after.indexOf(details))
      const back = viewWritten(after, details)
      const unwrapped = planDesignEdit({ projectId: 'layer', baseRevision: 1, files: project(after), scope: back.owner, target: back.source, fingerprint: back.fingerprint, operation: { kind: 'visibility', when: null } })
      if (!unwrapped.ok) throw new Error(unwrapped.reason)
      expect(unwrapped.selection?.offset).toBe(unwrapped.changes[0]!.after.indexOf(details))
    }
  })

  it('refuses a view written as an argument', () => {
    const source = withState('    @State private var on = true', `        VStack {
            Text("A").overlay(Text("Badge"))
        }`)
    expect(refusal(source, 'Text("Badge")', { kind: 'visibility', when: { input: 'on', is: true } })).toBeDefined()
  })

  describe.skipIf(!XCODE)('in Xcode 27', () => {
    it('type-checks each form Shown when writes', () => {
      const declarations = 'enum Phase {\n    case idle, loading\n}\n'
      const members = '    @State private var on = true\n    @State private var phase = Phase.idle\n    @State private var items: [String] = []\n    @State private var selection: String? = nil'
      const body = (view: string) => withState(members, `        VStack {\n            ${view}\n            Text("Always here")\n        }`, declarations)
      const forms = [
        edited(body(details), details, { kind: 'visibility', when: { input: 'on', is: true } }),
        edited(body(details), details, { kind: 'visibility', when: { input: 'phase', is: 'loading' } }),
        edited(body(details), details, { kind: 'visibility', when: { input: 'items', is: 'items' } }),
        edited(body(details), details, { kind: 'visibility', when: { input: 'selection', is: 'none' } }),
        edited(body(details), details, { kind: 'visibility', when: { input: 'shows', is: false }, create: { name: 'shows', value: true } }),
        edited(withState(members, '        VStack {\n            header\n        }', declarations).replace('    var body: some View {', '    private var header: some View {\n        Text("Header")\n    }\n\n    var body: some View {'), 'Text("Header")', { kind: 'visibility', when: { input: 'on', is: true } }),
        edited(body(`if case .loading = phase {\n                ${details}\n            }`), details, { kind: 'visibility', when: { input: 'phase', is: 'idle' } }),
        edited(body(`if (on) {\n                ${details}\n            }`), details, { kind: 'visibility', when: { input: 'on', is: false } }),
      ]
      typecheckInXcode([...forms, ...forms.map(form => `// target: iOS 13\n${form}`)])
    }, 300_000)
  })
})
