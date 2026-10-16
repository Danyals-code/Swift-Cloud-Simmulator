import { beforeAll, describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit, prepareDesignEdit } from '@studio/swift-sema'
import type { AuthoringNode, DesignEditRequest } from '@studio/shared'
import { APP, XCODE, draw, edited, project, refusal, screen, typecheckInXcode, viewWritten } from './helpers/layer-project'

/**
 * Swap and Detach on a copy of a component (Wave 5b): read through the authoring model,
 * written through the edit planner, as the panel does, and every written result drawn.
 */

const SWAP = (component: string): DesignEditRequest['operation'] => ({ kind: 'instance-swap', component })
const DETACH: DesignEditRequest['operation'] = { kind: 'instance-detach' }

/** The project's body lines, inside a VStack on ContentView. */
const body = (lines: string) => `        VStack {\n${lines}\n        }`

const PILL = `struct Pill: View {
    var title: String
    var icon: String = "star"

    var body: some View {
        HStack {
            Image(systemName: icon)
            Text(title)
        }
    }
}
`
const TAG = `struct Tag: View {
    var title: String
    var count: Int
    var tint: Color = .blue

    var body: some View {
        Text("\\(title) \\(count)")
            .foregroundStyle(tint)
    }
}
`

beforeAll(async () => {
  await prepareDesignEdit({ operation: SWAP('Tag') } as DesignEditRequest)
})

/** What a copy reads for Swap and Detach. */
/** What the screen draws, as a designer sees it: each drawn thing's kind, place, words, image and paint, with no ids. */
const picture = (source: string) => {
  const result = draw(project(source))
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  return result.renderTree!.nodes.map(n => JSON.stringify({ kind: n.kind, frame: n.frame, z: n.z, opacity: n.opacity, background: n.background, text: n.text, image: n.image, shape: n.shape, border: n.border, cornerRadius: n.cornerRadius, clipShape: n.clipShape }))
}

/** Every result written, type-checked in Xcode at the end. */
const forms: string[] = []
const written = (source: string, view: string, operation: DesignEditRequest['operation']) => { const after = edited(source, view, operation); forms.push(after); return after }

const instanceOf = (source: string, view: string): NonNullable<AuthoringNode['instance']> => {
  const found = viewWritten(source, view).instance
  if (!found) throw new Error(`${view} has no instance settings`)
  return found
}

describe('Swap', () => {
  const source = screen(body('            Pill(title: "New", icon: "bolt")\n                .padding(4)\n            Tag(title: "Sale", count: 3)'), PILL + TAG)

  it('keeps each input the target has with the same type, gives a required one it lacks a sample, and keeps the modifiers', () => {
    const after = written(source, 'Pill(title: "New", icon: "bolt")\n                .padding(4)', SWAP('Tag'))
    expect(after).toContain('            Tag(title: "New", count: 0)\n                .padding(4)\n')
    // An input of the same name and another type gives way to a sample.
    const typed = source.replace('var count: Int', 'var count: Int\n    var icon: Int').replace('Tag(title: "Sale", count: 3)', 'Tag(title: "Sale", count: 3, icon: 1)')
    expect(written(typed, 'Pill(title: "New", icon: "bolt")\n                .padding(4)', SWAP('Tag'))).toContain('            Tag(title: "New", count: 0, icon: 0)\n')
    expect(draw(project(after)).diagnostics.filter(d => d.severity === 'error')).toEqual([])
  })

  it('lists every other component a copy can become, and the ones it can’t with the reason', () => {
    const more = `struct Card<Content: View>: View {
    let content: () -> Content

    var body: some View {
        content()
    }
}
struct Avatar: View {
    let name: String

    init(_ name: String) {
        self.name = name
    }

    var body: some View {
        Text(name)
    }
}
struct Header: View {
    var body: some View {
        Pill(title: "Inside")
    }
}
`
    const project = screen(body('            Pill(title: "New")\n            Tag(title: "Sale", count: 3)\n            Card { Text("Card") }\n            Avatar("Ana")\n            Header()'), PILL + TAG + more)
    expect(instanceOf(project, 'Pill(title: "New")').swap).toEqual([
      { component: 'Avatar', disabledReason: 'Avatar has an init of its own, so its inputs can’t be matched. Change it in Code.' },
      { component: 'Card', disabledReason: 'Card takes views of its own, so a copy can’t become it. Change it in Code.' },
      { component: 'Header' },
      { component: 'Tag' },
    ])
    expect(instanceOf(project, 'Pill(title: "Inside")').swap.find(s => s.component === 'Header')).toEqual({ component: 'Header', disabledReason: 'Header shows Header, so it can’t go inside it.' })
  })
})

describe('a screen (Wave 5b)', () => {
  it('is neither a component a copy can become nor a copy to swap or detach: a tab, a destination, one in the window', () => {
    const app = `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup {
            MainTabs()
        }
    }
}

struct MainTabs: View {
    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Home", systemImage: "house") }
            Tab("Profile", systemImage: "person") {
                ProfileView()
            }
        }
    }
}
struct HomeView: View {
    var body: some View {
        NavigationStack {
            VStack {
                Pill(title: "A")
                Tag(title: "Sale", count: 3)
                NavigationLink(destination: DetailView()) {
                    Text("Go")
                }
            }
        }
    }
}
struct ProfileView: View {
    var body: some View {
        VStack {
            Pill(title: "B")
        }
    }
}
struct DetailView: View {
    var body: some View {
        Text("D")
    }
}
${PILL}${TAG}`
    expect(instanceOf(app, 'Pill(title: "A")').swap).toEqual([{ component: 'Tag' }])
    expect(viewWritten(app, 'MainTabs()').instance).toBeUndefined()
    const reason = 'MainTabs is a screen, not a component, so it can’t be swapped or detached.'
    expect(refusal(app, 'MainTabs()', DETACH)).toBe(reason)
    expect(refusal(app, 'MainTabs()', SWAP('Tag'))).toBe(reason)
  })
})

describe('Detach', () => {
  const copy = 'Pill(title: "New", icon: "bolt")\n                .padding(4)'
  const source = screen(body(`            ${copy}\n            Pill(title: "Other")`), PILL)

  it('puts the Main’s body in place of the copy, with what the copy gives each input, keeps the modifiers on it, and draws the same', () => {
    const after = written(source, copy, DETACH)
    expect(after).toContain(`        VStack {
            HStack {
                Image(systemName: "bolt")
                Text("New")
            }
                .padding(4)
            Pill(title: "Other")
        }`)
    expect(after).toContain(PILL)
    expect(picture(after)).toEqual(picture(source))
    expect(instanceOf(source, copy).detachDisabledReason).toBeUndefined()
  })

  /** The Main the plan writes for Wave 5b, with a variant, an on/off input, a symbol and a colour. */
  const STYLED = `struct Pill: View {
    enum Style {
        case primary, secondary
    }

    var title: String
    var showsIcon: Bool = true
    var icon: String = "star"
    var tint: Color = .blue
    var style: Style = .primary

    var body: some View {
        HStack {
            if showsIcon {
                Image(systemName: icon)
            }
            Text(title)
        }
        .padding(8)
        .foregroundStyle(style == .primary ? Color.white : tint)
        .background(style == .primary ? tint : tint.opacity(0.12))
        .clipShape(Capsule())
    }
}
`
  const styled = (copy: string, members = '') => screen(body(`            ${copy}\n            Pill(title: "Other")`), STYLED).replace('struct ContentView: View {\n', `struct ContentView: View {\n${members}`)

  it('folds what becomes constant: an off input drops its view, and a variant keeps the side that applies, written in full', () => {
    const copy = 'Pill(title: "Draft", showsIcon: false, tint: .orange, style: .secondary)'
    const after = written(styled(copy), copy, DETACH)
    expect(after).toContain(`        VStack {
            HStack {
                Text("Draft")
            }
            .padding(8)
            .foregroundStyle(Color.orange)
            .background(Color.orange.opacity(0.12))
            .clipShape(Capsule())
            Pill(title: "Other")`)
    expect(picture(after)).toEqual(picture(styled(copy)))
  })

  it('puts each default in place of an input the copy leaves out, the views of an on input kept at their place', () => {
    const copy = 'Pill(title: "Go")'
    const source = screen(body(`            ${copy}`), STYLED)
    const after = written(source, copy, DETACH)
    expect(after).toContain(`        VStack {
            HStack {
                Image(systemName: "star")
                Text("Go")
            }
            .padding(8)
            .foregroundStyle(Color.white)
            .background(Color.blue)
            .clipShape(Capsule())
        }`)
    expect(picture(after)).toEqual(picture(source))
  })

  it('keeps a condition on a value of the screen, and parenthesises a value read inside an expression', () => {
    const copy = 'Pill(title: "Live", style: current)'
    const after = written(styled(copy, '    @State private var current = Pill.Style.secondary\n'), copy, DETACH)
    expect(after).toContain('.foregroundStyle(current == .primary ? Color.white : Color.blue)')
    expect(after).toContain('.background(current == .primary ? Color.blue : Color.blue.opacity(0.12))')
    expect(picture(after)).toEqual(picture(styled(copy, '    @State private var current = Pill.Style.secondary\n')))
    const caption = `struct Caption: View {
    var text: String

    var body: some View {
        Text(text.uppercased())
    }
}
`
    const named = 'Caption(text: first + " " + last)'
    const source = screen(body(`            ${named}`), caption).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    let first = "Ana"\n    let last = "Lima"\n')
    const detached = written(source, named, DETACH)
    expect(detached).toContain('            Text((first + " " + last).uppercased())\n')
    expect(picture(detached)).toEqual(picture(source))
  })

  it('wraps several root views in a Group, re-indented to the copy’s place, with the modifiers on the copy after it', () => {
    const two = `struct Credit: View {
    var name: String
    var role: String = "Design"

    var body: some View {
        Text(name)
            .bold()
        Text(role)
    }
}
`
    const copy = 'Credit(name: "Ana")\n                .padding(2)'
    const source = screen(body(`            ${copy}`), two)
    const after = written(source, copy, DETACH)
    expect(after).toContain(`        VStack {
            Group {
                Text("Ana")
                    .bold()
                Text("Design")
            }
                .padding(2)
        }`)
    expect(picture(after)).toEqual(picture(source))
  })

  it('writes a case in full where it is read as a value, and folds a condition on a case written with its type', () => {
    const choice = `struct Choice: View {
    enum Kind: Hashable {
        case small, large
    }

    var kind: Kind = .small

    var body: some View {
        if kind == Kind.large {
            Text("Large")
                .tag(kind)
        }
    }
}
`
    const copy = 'Choice(kind: .large)'
    const source = screen(body(`            ${copy}`), choice)
    const after = written(source, copy, DETACH)
    expect(after).toContain(`            Text("Large")
                .tag(Choice.Kind.large)
        }`)
    expect(picture(after)).toEqual(picture(source))
  })

  it('writes a case given to an input with no written type in full, when its type can be worked out, and says why not when it can’t (Wave 5b)', () => {
    const untyped = (start: string) => `struct Untyped: View {
    enum Style: Hashable {
        case a, b

        static let usual = Style.a
    }

    var title: String
    var style = ${start}

    var body: some View {
        Text(title).tag(style)
    }
}
`
    const copy = 'Untyped(title: "u", style: .b)'
    const source = screen(body(`            ${copy}`), untyped('Style.a'))
    const after = written(source, copy, DETACH)
    expect(after).toContain('            Text("u").tag(Untyped.Style.b)\n')
    expect(picture(after)).toEqual(picture(source))
    const unknown = screen(body(`            ${copy}`), untyped('Style.usual'))
    const reason = 'Detach can’t tell which type style is, to write .b in full. Change it in Code.'
    expect(refusal(unknown, copy, DETACH)).toBe(reason)
    expect(instanceOf(unknown, copy).detachDisabledReason).toBe(reason)
  })

  it('folds whether an optional input is set when the copy writes it out or leaves it nil, and says why not otherwise (Wave 5b)', () => {
    const optional = `struct Badge: View {
    var title: String
    var subtitle: String? = nil

    var body: some View {
        VStack {
            Text(title)
            Text(subtitle ?? "none")
            if subtitle != nil {
                Text("has subtitle")
            }
        }
    }
}
struct Caption: View {
    var note: String?

    var body: some View {
        Text(note?.uppercased() ?? "")
    }
}
`
    const given = 'Badge(title: "Sub", subtitle: "x")', left = 'Badge(title: "New")', named = 'Badge(title: "Ana", subtitle: name)', chained = 'Caption(note: "n")'
    const source = screen(body(`            ${given}\n            ${left}\n            ${named}\n            ${chained}`), optional).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    let name = "Ana"\n')
    const set = written(source, given, DETACH)
    expect(set).toContain(`            VStack {
                Text("Sub")
                Text("x")
                Text("has subtitle")
            }
            Badge(title: "New")`)
    expect(picture(set)).toEqual(picture(source))
    const unset = written(source, left, DETACH)
    expect(unset).toContain(`            VStack {
                Text("New")
                Text("none")
            }
            Badge(title: "Ana", subtitle: name)`)
    expect(picture(unset)).toEqual(picture(source))
    expect(refusal(source, named, DETACH)).toBe('Detach can fold whether subtitle is set only when this copy writes it out. Change it in Code.')
    expect(instanceOf(source, named).detachDisabledReason).toBe('Detach can fold whether subtitle is set only when this copy writes it out. Change it in Code.')
    expect(refusal(source, chained, DETACH)).toBe('Caption unwraps note, which Detach can’t write plainly. Change it in Code.')
  })

  describe('a Main in a file of its own (Wave 5b)', () => {
    const pill = (before: string, read: string) => `import SwiftUI\n${before}\nstruct Pill: View {\n    var title: String\n\n    var body: some View {\n        Text(title)\n            .padding(${read})\n    }\n}\n`
    /** Why the planner refuses to detach the copy of Pill in a project of App.swift and Pill.swift, also what the copy reads. */
    const refusedAcross = (pillFile: string) => {
      const files = [{ id: APP, text: screen(body('            Pill(title: "A")')) }, { id: 'Sources/Pill.swift', text: pillFile }]
      const target = buildAuthoringModel({ projectId: 'layer', revision: 1, files }).nodes.find(n => n.kind === 'component' && n.name === 'Pill')!
      const plan = planDesignEdit({ projectId: 'layer', baseRevision: 1, files, scope: target.owner, target: target.source, fingerprint: target.fingerprint, operation: DETACH })
      expect(target.instance?.detachDisabledReason).toBe(plan.ok ? undefined : plan.reason)
      return plan.ok ? undefined : plan.reason
    }

    it('refuses one that reads what is private to its file, or a module only its file imports', () => {
      expect(refusedAcross(pill('\nprivate let pillCorner: CGFloat = 8\n', 'pillCorner'))).toBe('Pill uses pillCorner, which only Pill.swift can see. Change it in Code.')
      expect(refusedAcross(pill('\nenum Theme {\n    fileprivate static let corner: CGFloat = 8\n}\n', 'Theme.corner'))).toBe('Pill uses Theme.corner, which only Pill.swift can see. Change it in Code.')
      expect(refusedAcross(pill('import MapKit\n\nenum Theme {\n    static let corner: CGFloat = 8\n}\n', 'Theme.corner'))).toBe('Pill’s file imports MapKit, which this copy’s file doesn’t. Change it in Code.')
      expect(refusedAcross(pill('\nenum Theme {\n    static let corner: CGFloat = 8\n}\n', 'Theme.corner'))).toBeUndefined()
    })

    it('detaches one that reads a private value of the file it shares with the copy', () => {
      const copy = 'Pill(title: "A")'
      const source = screen(body(`            ${copy}`), pill('\nprivate let pillCorner: CGFloat = 8\n', 'pillCorner').replace('import SwiftUI\n', ''))
      expect(written(source, copy, DETACH)).toContain('            Text("A")\n                .padding(pillCorner)\n')
    })
  })

  describe('refuses, with the reason, a Main whose views a copy can’t become', () => {
    const refused = (main: string, copy: string, members = '') => {
      const source = screen(body(`            ${copy}`), main).replace('struct ContentView: View {\n', `struct ContentView: View {\n${members}`)
      const reason = refusal(source, copy, DETACH)
      expect(instanceOf(source, copy).detachDisabledReason).toBe(reason)
      return reason
    }
    const main = (members: string, view = 'Text(title)', extra = '') => `struct Row: View {\n${members}\n\n    var body: some View {\n        ${view}\n    }\n${extra}}\n`

    it('state, a binding, the environment, or an observed model', () => {
      expect(refused(main('    var title: String\n    @State private var on = false'), 'Row(title: "A")')).toBe('Row keeps @State on, which plain views can’t keep. Change it in Code.')
      expect(refused(main('    var title: String\n    @Binding var on: Bool'), 'Row(title: "A", on: $on)', '    @State private var on = false\n')).toBe('Row keeps @Binding on, which plain views can’t keep. Change it in Code.')
      expect(refused(main('    var title: String\n    @Environment(\\.colorScheme) private var scheme'), 'Row(title: "A")')).toBe('Row keeps @Environment scheme, which plain views can’t keep. Change it in Code.')
      const model = '@Observable final class Store {\n    var name = "Ana"\n}\n'
      expect(refused(main('    var title: String\n    var store: Store') + model, 'Row(title: "A", store: store)', '    @State private var store = Store()\n')).toBe('Row watches store, a Store, which plain views can’t. Change it in Code.')
    })

    it('a method or helper the body calls, and an input it calls', () => {
      expect(refused(main('    var title: String', 'Text(shout(title))', '\n    func shout(_ text: String) -> String {\n        text.uppercased()\n    }\n'), 'Row(title: "A")')).toBe('Row’s body uses shout, a helper of its own. Change it in Code.')
      expect(refused(main('    var title: String', 'label', '\n    private var label: some View {\n        Text(title)\n    }\n'), 'Row(title: "A")')).toBe('Row’s body uses label, a helper of its own. Change it in Code.')
      expect(refused(main('    var title: String\n    var format: (String) -> String', 'Text(format(title))'), 'Row(title: "A", format: { $0 })')).toBe('Row calls its format input, so its copies can’t be detached. Change it in Code.')
    })

    it('a custom init, and generics', () => {
      expect(refused(main('    var title: String\n\n    init(title: String) {\n        self.title = title\n    }'), 'Row(title: "A")')).toBe('Row has an init of its own, so Detach can’t tell what each input holds. Change it in Code.')
      expect(refused('struct Row<Label: View>: View {\n    var label: Label\n\n    var body: some View {\n        label\n    }\n}\n', 'Row(label: Text("A"))')).toBe('Row takes views of its own, so its copies can’t be detached. Change it in Code.')
    })

    it('a shadowed name, in the Main or where the copy is', () => {
      expect(refused(main('    var title: String\n    var items: [String] = ["a"]', 'ForEach(items, id: \\.self) { title in\n            Text(title)\n        }'), 'Row(title: "A")')).toBe('Row’s body names a value title, as one of its inputs is named. Change it in Code.')
      expect(refused(main('    var title: String', 'Text(title).foregroundStyle(accent)') + 'let accent = Color.red\n', 'Row(title: "A")', '    let accent = Color.blue\n')).toBe('accent means something else where this copy is. Change it in Code.')
      expect(refused(main('    var title: String\n    var items: [String] = ["a"]', 'ForEach(items, id: \\.self) { name in\n            Text(title + name)\n        }'), 'Row(title: name)', '    let name = "Ana"\n')).toBe('name means something else inside Row. Change it in Code.')
    })
  })

  it('puts a closure the copy gives in place of the input it is passed as, at the indent it is read at', () => {
    const action = `struct Action: View {
    var title: String
    var action: () -> Void

    var body: some View {
        Button(title, action: action)
    }
}
`
    const copy = 'Action(title: "Save") {\n                saved = true\n            }'
    const source = screen(body(`            ${copy}`), action).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var saved = false\n')
    const after = written(source, copy, DETACH)
    expect(after).toContain(`            Button("Save", action: {
                saved = true
            })
        }`)
    expect(picture(after)).toEqual(picture(source))
  })

  it('keeps an if it can’t fold in a Group, and writes EmptyView when nothing is left', () => {
    const empty = `struct Notice: View {
    var title: String
    var shows: Bool = true

    var body: some View {
        if shows {
            if title.isEmpty {
                Text("Nothing yet")
            } else {
                Text(title)
            }
        }
    }
}
`
    const kept = 'Notice(title: "Saved")', gone = 'Notice(title: "Gone", shows: false)'
    const source = screen(body(`            ${kept}\n            ${gone}`), empty)
    const after = written(source, kept, DETACH)
    expect(after).toContain(`            Group {
                if "Saved".isEmpty {
                    Text("Nothing yet")
                } else {
                    Text("Saved")
                }
            }
            Notice(title: "Gone", shows: false)`)
    expect(picture(after)).toEqual(picture(source))
    const none = written(source, gone, DETACH)
    expect(none).toContain('            Notice(title: "Saved")\n            EmptyView()\n')
    expect(picture(none)).toEqual(picture(source))
  })
})

describe('Detach, where a literal reads differently', () => {
  it('writes a whole number given a Double as one where the text shows it, and text with markdown as verbatim', () => {
    const mains = `struct Score: View {
    var title: String
    var value: Double = 1

    var body: some View {
        Text("\\(title): \\(value)")
            .padding(value)
    }
}
struct Note: View {
    var text: String

    var body: some View {
        Text(text)
    }
}
`
    const score = 'Score(title: "Ana", value: 2)', marked = 'Note(text: "Use *care*")', plain = 'Note(text: "Plain")'
    const source = screen(body(`            ${score}\n            ${marked}\n            ${plain}`), mains)
    const scored = written(source, score, DETACH)
    expect(scored).toContain('            Text("\\("Ana"): \\(2.0)")\n                .padding(2)\n')
    expect(picture(scored)).toEqual(picture(source))
    expect(written(source, marked, DETACH)).toContain('            Text(verbatim: "Use *care*")\n')
    expect(written(source, plain, DETACH)).toContain('            Text("Plain")\n')
  })
})

describe('Detach, a root view read as an expression', () => {
  it('parenthesises a choice of views it can’t fold when the copy’s modifiers follow it', () => {
    const answer = `struct Answer: View {
    var on: Bool

    var body: some View {
        on ? Text("Yes") : Text("No")
    }
}
`
    const copy = 'Answer(on: agreed)\n                .foregroundStyle(.red)'
    const source = screen(body(`            ${copy}`), answer).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var agreed = true\n')
    const after = written(source, copy, DETACH)
    expect(after).toContain('            (agreed ? Text("Yes") : Text("No"))\n                .foregroundStyle(.red)\n')
    expect(picture(after)).toEqual(picture(source))
  })
})

describe('Swap, more', () => {
  it('keeps a closure after the call when it is still the last input, and holds a missing binding in .constant', () => {
    const mains = `struct Save: View {
    var title: String
    var action: () -> Void

    var body: some View {
        Button(title, action: action)
    }
}
struct Confirm: View {
    var title: String
    @Binding var isOn: Bool
    var action: () -> Void

    var body: some View {
        Toggle(title, isOn: $isOn)
            .onTapGesture(perform: action)
    }
}
`
    const copy = 'Save(title: "Done") {\n                saved = true\n            }'
    const source = screen(body(`            ${copy}\n            Confirm(title: "Sure", isOn: $saved) { }`), mains).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var saved = false\n')
    const after = written(source, copy, SWAP('Confirm'))
    expect(after).toContain('            Confirm(title: "Done", isOn: .constant(false)) {\n                saved = true\n            }\n')
    expect(draw(project(after)).diagnostics.filter(d => d.severity === 'error')).toEqual([])
  })
})

describe('Swap, by the types the inputs are (Wave 5b)', () => {
  /** A component with a nested Style, its cases `cases`, and the inputs `members`. */
  const styled = (name: string, cases: string, members: string) => `struct ${name}: View {
    enum Style {
        case ${cases}
    }

    var title: String
${members}

    var body: some View {
        Text(title)
    }
}
`
  it('drops an input whose type has the same name in another component, a type of its own', () => {
    const mains = styled('Badge', 'primary, secondary', '    var style: Style = .primary') + styled('Chip', 'primary, tertiary', '    var style: Style = .primary')
    const copy = 'Badge(title: "A", style: .secondary)'
    const source = screen(body(`            ${copy}\n            Chip(title: "B")`), mains)
    expect(written(source, copy, SWAP('Chip'))).toContain('            Chip(title: "A")\n')
  })

  it('keeps an input with no written type only when both types can be worked out and are the same', () => {
    const mains = styled('Badge', 'primary, secondary', '    var style = Style.primary\n    var count = 0\n    var tint = Color.red')
      + styled('Chip', 'primary, tertiary', '    var style = Style.primary\n    var count = 1\n    var tint: Color = .blue')
    const copy = 'Badge(title: "A", style: .secondary, count: 2, tint: .orange)'
    const source = screen(body(`            ${copy}\n            Chip(title: "B")`), mains)
    expect(written(source, copy, SWAP('Chip'))).toContain('            Chip(title: "A", count: 2, tint: .orange)\n')
  })

  it('keeps an input of one type both components read, and refuses a target that needs one it can’t be given', () => {
    const shared = 'enum Style {\n    case primary, secondary\n}\n'
    const plain = (name: string, members: string) => `struct ${name}: View {\n    var title: String\n${members}\n\n    var body: some View {\n        Text(title)\n    }\n}\n`
    const mains = shared + plain('Badge', '    var style: Style = .primary') + plain('Chip', '    var style: Style = .primary')
      + styled('Card', 'primary, tertiary', '    var style: Style')
    const copy = 'Badge(title: "A", style: .secondary)'
    const source = screen(body(`            ${copy}\n            Chip(title: "B")\n            Card(title: "C", style: .tertiary)`), mains)
    expect(written(source, copy, SWAP('Chip'))).toContain('            Chip(title: "A", style: .secondary)\n')
    expect(instanceOf(source, copy).swap.find(choice => choice.component === 'Card')).toEqual({ component: 'Card', disabledReason: 'Card needs a style this copy doesn’t have. Change it in Code.' })
  })
})

describe('a copy with comments in it', () => {
  it('is neither swapped nor detached, as the comments would be lost', () => {
    const copy = 'Pill(title: "New" /* launch */)'
    const source = screen(body(`            ${copy}\n            Tag(title: "Sale", count: 3)`), PILL + TAG)
    const reason = 'This copy has comments in it, which Swap and Detach would lose. Change it in Code.'
    expect(instanceOf(source, copy)).toEqual({ swap: [{ component: 'Tag', disabledReason: reason }], detachDisabledReason: reason })
    expect(refusal(source, copy, SWAP('Tag'))).toBe(reason)
    expect(refusal(source, copy, DETACH)).toBe(reason)
  })
})

describe.skipIf(!XCODE)('in Xcode 27', () => {
  it('type-checks every result Swap and Detach wrote', () => {
    expect(forms.length).toBeGreaterThan(8)
    typecheckInXcode([...forms, ...forms.map(form => `// target: iOS 17\n${form}`)])
  }, 300_000)
})
