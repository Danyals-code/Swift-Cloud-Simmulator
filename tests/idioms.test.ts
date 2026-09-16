import { describe, expect, it } from 'vitest'
import type { CompileRequest } from '@studio/shared'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * Swift that people write, run against the pipeline that has to run it.
 *
 * Every case below was found by sitting down and writing the code a real app is made
 * of - a `@ViewBuilder` helper, a switch over an enum with a payload, a tally built
 * with `reduce(into:)` - rather than by reading the coverage matrix and probing what
 * it already claimed. All seven failed, three of them *silently*: the screen was
 * empty or the number was wrong and the Problems pane said nothing.
 *
 * That is the argument for writing the app rather than auditing the list, and these
 * tests exist so the same seven cannot come back.
 */

const device = DEVICES['iphone-15']

/** Compiles a whole program and returns every string it draws. */
function drawn(source: string): string[] {
  const request: CompileRequest = {
    files: [{ id: 'Sources/P.swift', text: `${source}\n` }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: 1,
  }
  resetPipelineState()
  const result = compile(request)

  expect(
    result.diagnostics.map((d) => `${d.severity}: ${d.message}`),
    'the fixture must compile cleanly',
  ).toEqual([])

  const nodes = result.renderTree?.nodes ?? []
  expect(
    nodes.filter((n) => n.kind === 'placeholder').map((n) => n.placeholder?.feature),
    'nothing may be drawn as a placeholder',
  ).toEqual([])

  return nodes.flatMap((n) => (n.text?.runs ?? []).map((r) => r.text))
}

function app(body: string, extra = ''): string {
  return `import SwiftUI

${extra}

@main
struct P: App {
    var body: some Scene {
        WindowGroup { V() }
    }
}

struct V: View {
    var body: some View {
${body}
    }
}`
}

describe('@ViewBuilder helpers', () => {
  /**
   * Splitting a long body into helpers is the first thing anybody does to a real
   * view, and every one of these drew *nothing at all* - no diagnostic, no
   * placeholder, an empty screen. A single-expression helper worked, which is why it
   * went unnoticed: the implicit return covers one expression and a builder body
   * almost never is one.
   */
  it('draws a helper that produces two views', () => {
    expect(
      drawn(
        app(`        pick()
    }

    @ViewBuilder func pick() -> some View {
        Text("a")
        Text("b")`),
      ),
    ).toEqual(['a', 'b'])
  })

  it('draws the branch a conditional helper took', () => {
    expect(
      drawn(
        app(`        pick(true)
    }

    @ViewBuilder func pick(_ on: Bool) -> some View {
        if on {
            Text("yes")
        } else {
            Text("no")
        }`),
      ),
    ).toEqual(['yes'])
  })

  it('draws the case a switching helper took', () => {
    expect(
      drawn(
        app(
          `        pick(.two)
    }

    @ViewBuilder func pick(_ step: Step) -> some View {
        switch step {
        case .one:
            Text("one")
        case .two:
            Text("two")
        }`,
          'enum Step { case one, two }',
        ),
      ),
    ).toEqual(['two'])
  })

  it('draws a @ViewBuilder computed property', () => {
    expect(
      drawn(
        app(`        pick
    }

    @ViewBuilder var pick: some View {
        if true {
            Text("yes")
        } else {
            Text("no")
        }`),
      ),
    ).toEqual(['yes'])
  })

  it('places a helper’s views among its siblings rather than after them', () => {
    expect(
      drawn(
        app(`        VStack {
            Text("before")
            pick()
            Text("after")
        }
    }

    @ViewBuilder func pick() -> some View {
        Text("a")
        Text("b")`),
      ),
    ).toEqual(['before', 'a', 'b', 'after'])
  })

  it('leaves an ordinary function alone', () => {
    // The flag is the attribute, not the return type: a plain function still runs its
    // statements and returns what it returns.
    expect(
      drawn(
        app(`        Text(name())
    }

    func name() -> String {
        let first = "x"
        return first + "y"`),
      ),
    ).toEqual(['xy'])
  })
})

describe('a contextual enum case with a payload', () => {
  const LOAD = `enum Load {
    case idle
    case done(String)
    case failed(code: Int, message: String)
}`

  /**
   * `describe(.done("hi"))` matched the `.done` branch and bound nothing, so the
   * failure read "Cannot find 's' in scope" - a message about the user's variable
   * rather than about the payload that was dropped on the way in. Writing
   * `Load.done("hi")` worked, which is the spelling nobody uses.
   */
  it('carries its payload into the switch', () => {
    expect(
      drawn(
        app(
          `        VStack {
            Text(describe(.done("hi")))
            Text(describe(.idle))
            Text(describe(.failed(code: 4, message: "bad")))
        }`,
          `${LOAD}

func describe(_ load: Load) -> String {
    switch load {
    case .idle:
        return "idle"
    case .done(let text):
        return text
    case .failed(let code, let message):
        return "\\(code) \\(message)"
    }
}`,
        ),
      ),
    ).toEqual(['hi', 'idle', '4 bad'])
  })

  it('carries it into a @State declared with one', () => {
    expect(
      drawn(
        app(
          `        Text(label)
    }

    @State private var load: Load = .done("stateful")

    var label: String {
        switch load {
        case .done(let text):
            return text
        default:
            return "-"
        }`,
          LOAD,
        ),
      ),
    ).toEqual(['stateful'])
  })

  it('still resolves a case with no payload', () => {
    expect(
      drawn(
        app(
          `        Text(go(.b))
    }

    func go(_ tab: Tab) -> String {
        switch tab {
        case .a: return "A"
        case .b: return "B"
        }`,
          'enum Tab { case a, b }',
        ),
      ),
    ).toEqual(['B'])
  })

  it('leaves the host’s own contextual members alone', () => {
    // `.percent`, `.degrees` and friends are the host's, and it has to keep winning.
    expect(drawn(app(`        Text(0.25, format: .percent).font(.system(size: 20))`))).toEqual(['25%'])
  })
})

describe('Group and AnyView', () => {
  /**
   * A `Group` is not a container: SwiftUI applies its modifiers to each child. Here a
   * modified group matched nothing in the layout's switch and drew a placeholder - so
   * `Group { … }.font(.caption)`, which is the main reason `Group` exists, drew a
   * grey box.
   */
  it('draws a Group carrying a modifier', () => {
    expect(
      drawn(
        app(`        Group {
            Text("a")
            Text("b")
        }
        .font(.caption)`),
      ),
    ).toEqual(['a', 'b'])
  })

  it('draws an erased view', () => {
    // `AnyView`'s content arrives as an argument rather than as a trailing closure,
    // and the layout flattens this view by walking its *children* - so an erased view
    // drew nothing.
    expect(drawn(app(`        AnyView(Text("erased"))`))).toEqual(['erased'])
  })

  it('draws an erased container, and what a function returns as AnyView', () => {
    expect(
      drawn(
        app(
          `        VStack {
            AnyView(VStack { Text("a"); Text("b") })
            made()
        }
    }

    func made() -> AnyView {
        return AnyView(Text("made"))`,
        ),
      ),
    ).toEqual(['a', 'b', 'made'])
  })
})

describe('building a collection up', () => {
  /**
   * `reduce(into:)` is a different function wearing the same name: its closure takes
   * the accumulator `inout` and returns nothing. Reading the closure's *result* - what
   * the plain form does - failed with "'acc' is a 'let' constant", which names the
   * symptom and not the cause.
   */
  it('reduces into an array', () => {
    expect(
      drawn(
        app(
          `        Text("\\([1, 2, 3].reduce(into: [Int]()) { out, n in out.append(n * 2) }.count)")`,
        ),
      ),
    ).toEqual(['3'])
  })

  it('reduces into a dictionary, tallying as it goes', () => {
    expect(
      drawn(
        app(
          `        Text("\\([1, 1, 2].reduce(into: [Int: Int]()) { counts, n in counts[n, default: 0] += 1 }[1] ?? 0)")`,
        ),
      ),
    ).toEqual(['2'])
  })

  it('tallies through a plain subscript default', () => {
    expect(
      drawn(
        app(`        Text(go())
    }

    func go() -> String {
        var counts = [String: Int]()
        counts["a", default: 0] += 1
        counts["a", default: 0] += 1
        return "\\(counts["a"] ?? 0)"`),
      ),
    ).toEqual(['2'])
  })

  it('groups a list into sections', () => {
    expect(
      drawn(
        app(
          `        VStack {
            ForEach(Kind.allCases) { kind in
                Text("\\(kind.rawValue): \\(groups[kind]?.count ?? 0)")
            }
        }
    }

    var items = [Row(kind: .a), Row(kind: .b), Row(kind: .a)]

    var groups: [Kind: [Row]] {
        return Dictionary(grouping: items, by: { $0.kind })`,
          `enum Kind: String, CaseIterable, Identifiable {
    case a, b
    var id: Self { self }
}

struct Row: Identifiable {
    let id = UUID()
    var kind: Kind
}`,
        ),
      ),
    ).toEqual(['a: 2', 'b: 1'])
  })

  it('still refuses to write through a let', () => {
    // The constancy check has to survive all of the above: `reduce(into:)` makes the
    // accumulator writable, and nothing else.
    const request: CompileRequest = {
      files: [
        {
          id: 'Sources/P.swift',
          text: `${app(`        Text(go())
    }

    func go() -> String {
        let counts = [String: Int]()
        counts["a", default: 0] += 1
        return "\\(counts.count)"`)}\n`,
        },
      ],
      canvas: { width: device.width, height: device.height },
      safeArea: device.safeArea,
      colorScheme: 'light',
      revision: 1,
    }
    resetPipelineState()

    expect(compile(request).diagnostics.map((d) => d.message).join(' ')).toContain(
      "is a 'let' constant",
    )
  })
})
