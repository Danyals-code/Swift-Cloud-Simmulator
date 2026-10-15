import { describe, expect, it } from 'vitest'
import { modifierArgumentProblem, structuralEditProblem } from './structural-check'

/**
 * The last check before a structural change is kept (C11).
 *
 * Fed by hand: every change the studio writes today is right, so these pairs are the
 * wrong results the old bugs produced - and would produce again - next to right ones.
 */

const FILE = 'Sources/ContentView.swift'
const screen = (content: string, members = '') => `import SwiftUI

struct ContentView: View {
${members}    var body: some View {
        VStack {
${content}
        }
    }
}

#Preview {
    ContentView()
}
`
const at = (text: string, needle: string) => {
  const start = text.indexOf(needle)
  expect(start, needle).toBeGreaterThan(-1)
  return start
}
const span = (text: string, needle: string) => ({ start: at(text, needle), end: at(text, needle) + needle.length })

const LOST = 'This change would also remove other parts of the file, such as a hidden view or a note. Nothing was changed.'

describe('changes that do what they say', () => {
  it('accepts an insert that only adds the new view', () => {
    const before = screen('            Text("A")')
    const after = screen('            Text("A")\n            Text("New")')
    expect(structuralEditProblem({ file: FILE, before, after, kind: 'insert', view: span(before, 'VStack'), adds: 'Text("New")', landed: at(after, 'Text("New")') })).toBeNull()
  })

  it('accepts an insert into a view whose own modifiers take closures, such as .toolbar and .sheet', () => {
    const chained = (content: string) => screen(`            List {\n${content}\n            }\n            .toolbar {\n                Button("Add") { }\n            }\n            .sheet(isPresented: .constant(false)) {\n                Text("Sheet")\n            }`)
    const before = chained('                Text("A")')
    const after = chained('                Text("A")\n                Text("New")')
    expect(structuralEditProblem({ file: FILE, before, after, kind: 'insert', view: span(before, 'List'), adds: 'Text("New")', landed: at(after, 'Text("New")') })).toBeNull()
  })

  it('accepts a move that re-indents a note and a text written over several lines inside the view', () => {
    const stack = (indent: string) => `${indent}HStack {\n${indent}    Text("""\n${indent}        Two lines\n${indent}        """)\n${indent}    /* A note\n${indent}       over two lines */\n${indent}}`
    const before = screen(`            Group {\n${stack('                ')}\n            }\n            Text("B")`)
    const after = screen(`            Group {\n            }\n            Text("B")\n${stack('            ')}`)
    expect(structuralEditProblem({ file: FILE, before, after, kind: 'moveTo', view: span(before, 'HStack'), toward: at(before, 'Text("B")'), landed: at(after, '            HStack') + 12 })).toBeNull()
  })

  it('accepts an unwrap that takes away the container, once, and keeps its views and their note', () => {
    const before = screen('            HStack(spacing: 8) {\n                Text("A")\n                // A note\n                Text("B")\n            }')
    const after = screen('            Text("A")\n            // A note\n            Text("B")')
    expect(structuralEditProblem({ file: FILE, before, after, kind: 'unwrap', view: span(before, 'HStack'), removes: 'HStack(spacing: 8) { }', landed: at(after, 'Text("A")') })).toBeNull()
  })

  it('accepts a delete that takes only the view, with its switched-off modifier', () => {
    const before = screen('            Text("A")\n                /*studio-off:1 ".padding()"*/\n            Text("B")')
    const after = screen('            Text("B")')
    expect(structuralEditProblem({ file: FILE, before, after, kind: 'delete', view: span(before, 'Text("A")') })).toBeNull()
  })
})

describe('changes that do something else', () => {
  it('refuses an insert that loses a hidden view', () => {
    const before = screen('            // hidden by Swift Web Studio\n            // Text("Secret")\n            // end hidden view')
    const after = screen('            Text("New")')
    expect(structuralEditProblem({ file: FILE, before, after, kind: 'insert', view: span(before, 'VStack'), adds: 'Text("New")', landed: at(after, 'Text("New")') })).toBe(LOST)
  })

  it('refuses a delete that takes more than the selected view', () => {
    const before = screen('            Text("Card")\n                .overlay(RoundedRectangle(cornerRadius: 12))\n            Text("Other")')
    const after = screen('            Text("Other")')
    expect(structuralEditProblem({ file: FILE, before, after, kind: 'delete', view: span(before, 'RoundedRectangle(cornerRadius: 12)') })).toBe(LOST)
  })

  it('refuses an unwrap that takes a view or a second container with it, or adds anything', () => {
    const before = screen('            HStack {\n                Text("A")\n                Text("B")\n            }\n            Text("C")')
    const unwrap = (after: string) => structuralEditProblem({ file: FILE, before, after, kind: 'unwrap', view: span(before, 'HStack'), removes: 'HStack { }', landed: at(after, 'Text("A")') })
    expect(unwrap(screen('            Text("A")\n            Text("C")'))).toBe(LOST)
    expect(unwrap(screen('            Text("A")\n            Text("B")\n            Text("C")').replace('        VStack {\n', '        '))).toBe(LOST)
    expect(unwrap(screen('            Text("A")\n            Text("B")\n            Text("C")\n            Divider()'))).toBe('This change would add more than it was meant to. Nothing was changed.')
  })

  it('refuses a move that lands the view somewhere other than where it was sent', () => {
    const before = screen('            Text("Title")')
    const after = screen('').replace('#Preview {\n', '#Preview {\n            Text("Title")\n')
    expect(structuralEditProblem({ file: FILE, before, after, kind: 'moveTo', view: span(before, 'Text("Title")'), toward: at(before, 'VStack'), landed: at(after, 'Text("Title")') }))
      .toBe('This change would put the view somewhere other than where it was dropped. Nothing was changed.')
  })

  it('refuses a move that leaves the view’s switched-off modifier on its neighbour', () => {
    const before = screen('            Text("A")\n                .bold()\n                /*studio-off:1 ".padding()"*/\n            Text("B")')
    const after = screen('            Text("B")\n                /*studio-off:1 ".padding()"*/\n            Text("A")\n                .bold()')
    expect(structuralEditProblem({ file: FILE, before, after, kind: 'move', view: span(before, 'Text("A")\n                .bold()'), landed: at(after, 'Text("A")') })).toBe(LOST)
  })

  it('refuses a move that lands the view in the wrong container', () => {
    const before = screen('            Text("A")\n            HStack {\n                Text("Inner")\n            }\n            Text("B")')
    const after = screen('            HStack {\n                Text("Inner")\n                Text("A")\n            }\n            Text("B")')
    expect(structuralEditProblem({ file: FILE, before, after, kind: 'moveTo', view: span(before, 'Text("A")'), toward: at(before, 'Text("B")'), landed: at(after, 'Text("A")') }))
      .toBe('This change would put the view somewhere other than where it was dropped. Nothing was changed.')
  })

  it('refuses a change that gives a helper, which holds one view, a second one', () => {
    const helper = (content: string) => `    var header: some View {\n${content}\n    }\n`
    const before = screen('            header\n            Text("Body")', helper('        Text("Header")'))
    const after = screen('            header', helper('        Text("Header")\n        Text("Body")'))
    expect(structuralEditProblem({ file: FILE, before, after, kind: 'moveTo', view: span(before, 'Text("Body")'), toward: at(before, 'Text("Header")'), landed: at(after, 'Text("Body")') }))
      .toBe('`header` can hold only one view, so this change would stop the app from building. Nothing was changed.')
  })

  it('refuses a change that leaves a view with nothing to show', () => {
    const card = (content: string) => `\nstruct Card: View {\n    var body: some View {\n${content}\n    }\n}\n`
    const before = screen('            Card()\n            Text("Other")') + card('        Text("Card")')
    const after = screen('            Card()\n            Text("Other")\n            Text("Card")') + card('')
    expect(structuralEditProblem({ file: FILE, before, after, kind: 'moveTo', view: span(before, 'Text("Card")'), toward: at(before, 'Text("Other")'), landed: at(after, '            Text("Card")') + 12 }))
      .toBe('This change would leave `Card` with nothing to show. Nothing was changed.')
  })

  it('refuses a feature’s rewrite that gives a helper a second view', () => {
    const helper = (content: string) => `    var header: some View {\n${content}\n    }\n`
    const before = screen('            header', helper('        Text("Header")'))
    const after = screen('            header', helper('        Text("Header")\n        Badge(title: "New")'))
    expect(structuralEditProblem({ file: FILE, before, after, kind: 'restructure', view: span(before, 'header') }))
      .toBe('`header` can hold only one view, so this change would stop the app from building. Nothing was changed.')
  })

  it('leaves the rest of a feature’s rewrite to the feature', () => {
    const before = screen('            Text("A")')
    const after = screen('            Group {\n                if items.isEmpty {\n                    Text("Nothing here")\n                } else {\n                    Text("A")\n                }\n            }')
    expect(structuralEditProblem({ file: FILE, before, after, kind: 'restructure', view: span(before, 'Text("A")') })).toBeNull()
  })

  it('does not blame a change for a helper that already held two views', () => {
    const helper = `    var header: some View {\n        Text("One")\n        Text("Two")\n    }\n`
    const before = screen('            Text("A")', helper)
    const after = screen('            Text("A")\n            Text("New")', helper)
    expect(structuralEditProblem({ file: FILE, before, after, kind: 'insert', view: span(before, 'VStack'), adds: 'Text("New")', landed: at(after, 'Text("New")') })).toBeNull()
  })
})

/**
 * Padding and frame arguments a writer put together (doc 18, Fix first 1). The planner's
 * other checks parse and resolve names; neither knows `.padding(.space16, 24)` has no
 * overload, so these are the shapes Xcode refused, next to the ones it builds.
 */
describe('padding, frame and border arguments a change writes', () => {
  const TOKENS = '\nenum Layout {\n    static let padding: CGFloat = 30\n    static let sides: Edge.Set = .horizontal\n}\n\nextension CGFloat {\n    static let space16: CGFloat = 16\n}\n\nextension Edge.Set {\n    static let sides: Edge.Set = [.leading, .trailing]\n}\n'
  const view = (modifiers: string) => screen(`            Text("A")${modifiers}`) + TOKENS
  const problem = (before: string, after: string) => modifierArgumentProblem({ file: FILE, before: view(before), after: view(after) })
  const refusal = (call: string) => `This change would write \`${call}\`, which would stop the app from building. Nothing was changed.`

  it.each([
    ['.padding(Layout.padding)', '.padding(Layout.padding, 30)'],
    ['.padding(.space16)', '.padding(.space16, 24)'],
    ['.padding(16)', '.padding(16, .top)'],
    ['.padding(16)', '.padding(16, 8)'],
    ['.padding(16)', '.padding(top: 16)'],
    ['.padding(.space16)', '.padding(CGFloat.space16, 24)'],
    ['.frame(width: 100)', '.frame(width: 100, maxWidth: .infinity)'],
    ['.frame(width: 100)', '.frame(height: 40, width: 100)'],
    ['.frame(width: 100)', '.frame(100)'],
    ['.border(.red)', '.border(.red, 2, .blue)'],
    ['.border(.red)', '.border(width: 2)'],
    ['.border(.red)', '.border(.red, lineWidth: 2)'],
  ])('refuses %s written as %s', (before, after) => {
    expect(problem(before, after)).toBe(refusal(after))
  })

  it.each([
    ['', '.padding()'],
    ['.padding(.horizontal)', '.padding(.horizontal, 12)'],
    ['.padding(.horizontal)', '.padding(.horizontal, .space16)'],
    ['.padding(Layout.sides)', '.padding(Layout.sides, 8)'],
    ['.padding(.sides)', '.padding(.sides, 8)'],
    ['.padding(.horizontal)', '.padding(.horizontal, CGFloat.space16)'],
    ['.padding([.top, .leading])', '.padding([.top, .leading], 8)'],
    ['.padding(Layout.padding)', '.padding(30)'],
    ['', '.padding(EdgeInsets(top: 1, leading: 2, bottom: 3, trailing: 4))'],
    ['', '.frame(maxWidth: .infinity, alignment: .leading)'],
    ['', '.frame(minWidth: 10, maxWidth: 200, minHeight: 44)'],
    ['', '.frame(width: 100, height: 40, alignment: .top)'],
    ['', '.border(.red)'],
    ['', '.border(Color.gray, width: 2)'],
  ])('accepts %s written as %s', (before, after) => {
    expect(problem(before, after)).toBeNull()
  })

  it('leaves a call the change did not write to the person who wrote it', () => {
    expect(problem('.padding(.space16, 24)', '.padding(.space16, 24)\n                .bold()')).toBeNull()
  })

  it('accepts a project\'s own overload of the name, as Swift does', () => {
    const own = '\nextension View {\n    func frame(size: CGFloat) -> some View { frame(width: size, height: size) }\n    func padding(_ edges: Edge.Set, _ length: CGFloat, extra: Bool = false) -> some View { padding(edges, length) }\n    func border(_ color: Color, radius: CGFloat) -> some View { overlay(RoundedRectangle(cornerRadius: radius).stroke(color)) }\n}\n'
    const withOwn = (before: string, after: string) => modifierArgumentProblem({ file: FILE, before: view(before) + own, after: view(after) + own })
    expect(withOwn('', '.frame(size: 40)')).toBeNull()
    expect(withOwn('', '.padding(.top, 8, extra: true)')).toBeNull()
    expect(withOwn('', '.border(.red, radius: 8)')).toBeNull()
    expect(withOwn('', '.frame(side: 40)')).toBe(refusal('.frame(side: 40)'))
  })

  it('leaves alone padding and frame calls that are not the view modifiers', () => {
    expect(problem('', '\n                .onAppear { _ = "a".padding(toLength: 3, withPad: " ", startingAt: 0) }')).toBeNull()
    expect(problem('', '\n                .background(GeometryReader { proxy in Color.clear.onAppear { _ = proxy.frame(in: .global) } })')).toBeNull()
  })
})
