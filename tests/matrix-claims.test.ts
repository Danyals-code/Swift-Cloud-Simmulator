import { describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult, RenderNode } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * The rows the coverage matrix marked done that were not - defect register 10.1.
 *
 * The matrix calls itself the public contract, and a row that claims something the
 * preview does not do is worse than a missing row: it is the reason someone stops
 * looking for the bug in the tool and starts looking for it in their own code.
 *
 * `Text` concatenation, `Date` and number formatting and key paths were corrected in
 * earlier passes and are covered where they were built. These are the four that were
 * left waiting on `URL` and on the data-flow work: each is now checked by what it
 * *draws* rather than by the absence of a diagnostic, because "marked done and not
 * done" is exactly the failure a silence-based test cannot catch.
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

const diagnostics = (r: CompileResult): string[] => r.diagnostics.map((d) => d.message)

describe('.navigationDestination for a built-in type', () => {
  const source = app(
    [
      '    var body: some View {',
      '        NavigationStack {',
      '            List {',
      '                NavigationLink("Kyoto", value: "Kyoto")',
      '                NavigationLink("Lisbon", value: "Lisbon")',
      '            }',
      '            .navigationDestination(for: String.self) { city in',
      '                Text("Detail for \\(city)")',
      '            }',
      '        }',
      '    }',
    ].join('\n'),
  )

  it('pushes the destination the value resolves to', () => {
    resetPipelineState()
    const first = compile(request(source))
    expect(diagnostics(first)).toEqual([])
    expect(texts(first)).toContain('Kyoto')

    const link = nodes(first).find((n) => n.hitTarget && n.a11y?.label === 'Kyoto')
    expect(link, 'expected the row to be a link').toBeDefined()
    applyEvent({ kind: 'tap', handlerId: link!.hitTarget!.handlerId, location: { x: 0, y: 0 } })

    expect(texts(rerender(revision++))).toContain('Detail for Kyoto')
  })
})

describe('Link and AsyncImage, which needed a URL to be constructible at all', () => {
  it('a Link draws its title', () => {
    const result = run(
      view('Link("Docs", destination: URL(string: "https://example.com")!)'),
    )
    expect(diagnostics(result)).toEqual([])
    expect(texts(result)).toContain('Docs')
  })

  it('AsyncImage draws its placeholder, which the matrix has always claimed', () => {
    // It drew a grey box. The placeholder arrives as a labelled closure argument and
    // the code looked for a *modifier* of that name, so it never found one - and the
    // content closure was being run with nothing to pass where an `Image` belongs.
    const result = run(
      view(
        'AsyncImage(url: URL(string: "https://example.com/a.png")) { image in image } placeholder: { Text("loading") }',
      ),
    )
    expect(diagnostics(result)).toEqual([])
    expect(texts(result)).toContain('loading')
  })

  it('AsyncImage without a placeholder still draws a box rather than nothing', () => {
    const result = run(view('AsyncImage(url: URL(string: "https://example.com/a.png"))'))
    expect(diagnostics(result)).toEqual([])
    expect(nodes(result).some((n) => n.id !== 'screen' && n.background)).toBe(true)
  })
})

describe('GeometryReader as its own coordinate space', () => {
  it('reports a frame in its own space, not the screen’s', () => {
    const result = run(
      app(
        [
          '    var body: some View {',
          '        VStack {',
          '            Spacer()',
          '            GeometryReader { proxy in',
          '                Text("local \\(Int(proxy.frame(in: .local).minY))")',
          '            }',
          '            .frame(height: 100)',
          '        }',
          '    }',
        ].join('\n'),
      ),
    )
    expect(diagnostics(result)).toEqual([])
    // Its own space starts at zero however far down the screen the reader sits.
    expect(texts(result)).toContain('local 0')
  })
})
