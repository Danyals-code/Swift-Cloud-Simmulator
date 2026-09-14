import { describe, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'
import type { RenderNode, RenderTree } from '@studio/shared'

/**
 * The view protocols Phase 8a unblocked.
 *
 * A custom `ViewModifier` is the payoff of the conformance merge: it is an ordinary
 * struct with an ordinary method, and what makes it a modifier is a protocol the
 * preview could not read three commits ago.
 */

const device = DEVICES['iphone-15']
let revision = 1

function run(source: string) {
  resetPipelineState()
  return compile({
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  })
}

function texts(tree: RenderTree | null): string[] {
  return (tree?.nodes ?? []).flatMap((n) => n.text?.runs.map((r) => r.text) ?? [])
}

function textNodes(tree: RenderTree | null): readonly RenderNode[] {
  return (tree?.nodes ?? []).filter((n) => n.text !== undefined)
}

const APP = `@main
struct DemoApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}
`

describe('custom ViewModifier', () => {
  it('applies a modifier written as a struct', () => {
    const result = run(`import SwiftUI
${APP}
struct Boxed: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(12)
            .background(Color.blue)
    }
}

struct ContentView: View {
    var body: some View {
        Text("hello").modifier(Boxed())
    }
}
`)
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(texts(result.renderTree)).toEqual(['hello'])

    // The padding has to reach the tree, or the modifier rendered the bare content:
    // a `Text` with no modifier is centred, one inside 12pt of padding on a blue
    // background is not the same box.
    const background = (result.renderTree?.nodes ?? []).filter((n) => n.background)
    expect(background.length, 'the modifier’s background never reached the tree').toBeGreaterThan(0)
    const [box] = background
    const [text] = textNodes(result.renderTree)
    expect(box!.frame.width).toBeGreaterThan(text!.frame.width)
  })

  it('reads the modifier’s own stored properties', () => {
    const result = run(`import SwiftUI
${APP}
struct Titled: ViewModifier {
    let title: String

    func body(content: Content) -> some View {
        VStack {
            Text(title)
            content
        }
    }
}

struct ContentView: View {
    var body: some View {
        Text("body").modifier(Titled(title: "heading"))
    }
}
`)
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(texts(result.renderTree)).toEqual(['heading', 'body'])
  })

  it('works through an extension that names it', () => {
    // The idiomatic wrapper: `extension View { func boxed() -> some View { … } }`.
    const result = run(`import SwiftUI
${APP}
struct Boxed: ViewModifier {
    func body(content: Content) -> some View {
        VStack {
            content
            Text("edge")
        }
    }
}

extension View {
    func boxed() -> some View {
        modifier(Boxed())
    }
}

struct ContentView: View {
    var body: some View {
        Text("inner").boxed()
    }
}
`)
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(texts(result.renderTree)).toEqual(['inner', 'edge'])
  })

  it('leaves a struct that is not a ViewModifier alone', () => {
    // Declining is the safe answer: SwiftUI's own `.modifier` must still work, and a
    // struct with no conformance is not one of ours to interpret.
    const result = run(`import SwiftUI
${APP}
struct NotAModifier {
    var value: Int
}

struct ContentView: View {
    var body: some View {
        Text("plain")
    }
}
`)
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(texts(result.renderTree)).toEqual(['plain'])
  })
})

describe('extension View', () => {
  it('names a reusable modifier chain', () => {
    // The dominant reuse pattern in real SwiftUI, and the receiver is a view rather
    // than a declared type — so the lookup starts from the protocol, not the value.
    const result = run(`import SwiftUI
${APP}
extension View {
    func cardStyle() -> some View {
        padding(16)
            .background(Color.white)
            .cornerRadius(12)
    }
}

struct ContentView: View {
    var body: some View {
        Text("card").cardStyle()
    }
}
`)
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(texts(result.renderTree)).toEqual(['card'])
    expect((result.renderTree?.nodes ?? []).some((n) => n.background)).toBe(true)
  })

  it('takes arguments', () => {
    const result = run(`import SwiftUI
${APP}
extension View {
    func labelled(_ text: String) -> some View {
        VStack {
            Text(text)
            self
        }
    }
}

struct ContentView: View {
    var body: some View {
        Text("under").labelled("over")
    }
}
`)
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(texts(result.renderTree)).toEqual(['over', 'under'])
  })

  it('chains with built-in modifiers on either side', () => {
    const result = run(`import SwiftUI
${APP}
extension View {
    func boxed() -> some View {
        padding(8)
    }
}

struct ContentView: View {
    var body: some View {
        Text("x")
            .font(.title)
            .boxed()
            .opacity(0.5)
    }
}
`)
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(texts(result.renderTree)).toEqual(['x'])
  })

  it('applies to a user-declared view, not just a built-in one', () => {
    const result = run(`import SwiftUI
${APP}
extension View {
    func boxed() -> some View {
        padding(8)
    }
}

struct Inner: View {
    var body: some View { Text("inner") }
}

struct ContentView: View {
    var body: some View {
        Inner().boxed()
    }
}
`)
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(texts(result.renderTree)).toEqual(['inner'])
  })
})

describe('the fallback stays narrow', () => {
  it('still reports a name that resolves nowhere', () => {
    // Offering every unresolved call to the host would turn a mistyped function name
    // into an unrecognised-but-harmless modifier — the code would look honoured and
    // would not be. The fallback applies only inside an extension of a type the
    // project did not declare, which is the one place `self` is a view.
    const result = run(`import SwiftUI
${APP}
struct ContentView: View {
    func helper() -> String { noSuchFunction() }

    var body: some View {
        Text(helper())
    }
}
`)
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true)
  })
})

describe('a contextual member reaching a host type', () => {
  it('resolves .blue against a Color property', () => {
    // `.blue` has no base, so it arrives as a bare token. Only the declared type says
    // what it meant — and a Color belongs to the host, so the interpreter has to ask.
    // Without this the token reaches the property intact and the first modifier called
    // on it fails three layers from where the mistake actually is.
    const result = run(`import SwiftUI
${APP}
struct Tinted: ViewModifier {
    var tint: Color

    func body(content: Content) -> some View {
        content.background(tint.opacity(0.2))
    }
}

struct ContentView: View {
    var body: some View {
        Text("x").modifier(Tinted(tint: .blue))
    }
}
`)
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect((result.renderTree?.nodes ?? []).some((n) => n.background)).toBe(true)
  })

  it('resolves .blue through a function parameter', () => {
    const result = run(`import SwiftUI
${APP}
extension View {
    func tinted(_ tint: Color) -> some View {
        background(tint.opacity(0.2))
    }
}

struct ContentView: View {
    var body: some View {
        Text("x").tinted(.orange)
    }
}
`)
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect((result.renderTree?.nodes ?? []).some((n) => n.background)).toBe(true)
  })
})
