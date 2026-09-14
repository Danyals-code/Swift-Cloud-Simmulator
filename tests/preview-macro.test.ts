import { describe, expect, it } from 'vitest'
import type { CompileRequest, RenderTree } from '@studio/shared'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * `#Preview` — Phase 10c.
 *
 * The reason this matters more than it looks: before it, `#` was an unexpected
 * character, and the three *blocking* errors that followed meant a file containing a
 * preview block did not render at all. Modern SwiftUI almost always contains one, so
 * pasting real code into the studio produced a blank screen and a parse error about a
 * character rather than about anything the user wrote.
 */

const device = DEVICES['iphone-15']
let revision = 1

function run(source: string) {
  resetPipelineState()
  const request: CompileRequest = {
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  }
  return compile(request)
}

function texts(tree: RenderTree | null): string[] {
  return (tree?.nodes ?? []).flatMap((n) => n.text?.runs.map((r) => r.text) ?? [])
}

function errors(result: ReturnType<typeof run>): string[] {
  return result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)
}

const APP = `@main
struct DemoApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}
`

describe('a project that has one', () => {
  it('parses without complaining about a character', () => {
    const result = run(`import SwiftUI
${APP}
struct ContentView: View {
    var body: some View { Text("hello") }
}

#Preview {
    ContentView()
}
`)
    expect(errors(result)).toEqual([])
    expect(texts(result.renderTree)).toEqual(['hello'])
  })

  it('accepts a named preview', () => {
    const result = run(`import SwiftUI
${APP}
struct ContentView: View {
    var body: some View { Text("hello") }
}

#Preview("Dark mode") {
    ContentView()
}
`)
    expect(errors(result)).toEqual([])
  })

  it('keeps rendering the @main app, not the preview', () => {
    // When both exist the app wins: that is what the device is simulating, and a
    // preview block is a second opinion about one screen rather than the program.
    const result = run(`import SwiftUI
@main
struct DemoApp: App {
    var body: some Scene { WindowGroup { Text("the app") } }
}

#Preview {
    Text("the preview")
}
`)
    expect(errors(result)).toEqual([])
    expect(texts(result.renderTree)).toEqual(['the app'])
  })

  it('does not trip over a macro it knows nothing about', () => {
    const result = run(`import SwiftUI
${APP}
struct ContentView: View {
    var body: some View { Text("hello") }
}

#SomeFutureMacro(42)
`)
    expect(errors(result)).toEqual([])
    expect(texts(result.renderTree)).toEqual(['hello'])
  })
})

describe('a project that has only a preview', () => {
  it('renders it rather than reporting no entry point', () => {
    // A view plus its preview, with no App struct, is an ordinary thing to paste in
    // and is exactly what Xcode itself renders.
    const result = run(`import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack {
            Text("no app struct")
            Text("and yet")
        }
    }
}

#Preview {
    ContentView()
}
`)
    expect(errors(result)).toEqual([])
    expect(texts(result.renderTree)).toEqual(['no app struct', 'and yet'])
  })

  it('runs the preview body itself, not just a view it names', () => {
    const result = run(`import SwiftUI

#Preview {
    VStack {
        Text("built")
        Text("inline")
    }
}
`)
    expect(errors(result)).toEqual([])
    expect(texts(result.renderTree)).toEqual(['built', 'inline'])
  })

  it('keeps state working inside a preview', () => {
    const result = run(`import SwiftUI

struct Counter: View {
    @State private var count = 3
    var body: some View { Text("count \\(count)") }
}

#Preview {
    Counter()
}
`)
    expect(errors(result)).toEqual([])
    expect(texts(result.renderTree)).toEqual(['count 3'])
  })

  it('takes the first preview when there are several', () => {
    // Xcode shows them side by side; a simulated phone has one screen. First is the
    // choice that needs no interface, and the others still parse and still export.
    const result = run(`import SwiftUI

#Preview("Light") {
    Text("first")
}

#Preview("Dark") {
    Text("second")
}
`)
    expect(errors(result)).toEqual([])
    expect(texts(result.renderTree)).toEqual(['first'])
  })

  it('still reports a project with neither', () => {
    // The check has to stay capable of firing, or accepting previews would have
    // quietly turned it off.
    const result = run(`import SwiftUI

struct ContentView: View {
    var body: some View { Text("orphan") }
}
`)
    expect(errors(result).join(' ')).toContain('no entry point')
  })
})

describe('fontDesign', () => {
  it('changes the face a rounded design asks for', () => {
    const result = run(`import SwiftUI
${APP}
struct ContentView: View {
    var body: some View {
        Text("rounded").fontDesign(.rounded)
    }
}
`)
    expect(errors(result)).toEqual([])
    const run0 = (result.renderTree?.nodes ?? []).find((n) => n.text)?.text?.runs[0]
    expect(run0?.font.family).toContain('ui-rounded')
  })

  it('survives a .font below it', () => {
    // In SwiftUI the design is inherited separately from the size, so setting one must
    // not reset the other — which is what a naive implementation does.
    const result = run(`import SwiftUI
${APP}
struct ContentView: View {
    var body: some View {
        VStack {
            Text("inner")
                .font(.largeTitle)
        }
        .fontDesign(.rounded)
    }
}
`)
    expect(errors(result)).toEqual([])
    const run0 = (result.renderTree?.nodes ?? []).find((n) => n.text)?.text?.runs[0]
    expect(run0?.font.family).toContain('ui-rounded')
    expect(run0?.font.size).toBeGreaterThan(20)
  })

  it('no longer reports itself as unimplemented', () => {
    const result = run(`import SwiftUI
${APP}
struct ContentView: View {
    var body: some View { Text("x").fontDesign(.monospaced) }
}
`)
    expect(result.diagnostics.filter((d) => d.code === 'unsupported_swiftui_modifier')).toEqual([])
  })
})
