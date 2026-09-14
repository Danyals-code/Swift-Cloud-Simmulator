import { beforeEach, describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult, RenderNode, RenderTree } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * Lifecycle — `.onAppear`, `.onDisappear`, `.task` and `.onChange(of:)`.
 *
 * The hard part is not running the callback; it is running it *once*. A preview
 * re-evaluates the whole tree on every keystroke and every tap, so a naive
 * implementation fires `.onAppear` continuously and any counter it increments runs
 * away. Most of these tests are about that.
 */

const device = DEVICES['iphone-15']
let revision = 1

function app(body: string, extra = ''): string {
  return `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
${body}
}

${extra}`
}

function run(source: string): CompileResult {
  resetPipelineState()
  const request: CompileRequest = {
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  }
  const result = compile(request)
  expect(result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([])
  return result
}

function texts(tree: RenderTree | null): string[] {
  return (tree?.nodes ?? []).flatMap((n) => n.text?.runs.map((r) => r.text) ?? [])
}

function control(tree: RenderTree | null, label: string): RenderNode {
  const found = (tree?.nodes ?? []).find((n) => n.hitTarget && n.a11y?.label === label)
  expect(found, `no control labelled "${label}"`).toBeDefined()
  return found!
}

function tap(tree: RenderTree | null, label: string): CompileResult {
  const target = control(tree, label)
  applyEvent({ kind: 'tap', handlerId: target.hitTarget!.handlerId, location: { x: 0, y: 0 } })
  return rerender(revision++)
}

beforeEach(() => {
  resetPipelineState()
})

describe('.onAppear', () => {
  it('runs before the first frame is shown', () => {
    // The callback usually sets the state the view draws from, so the pass that
    // discovered it is not the pass worth showing.
    const result = run(
      app(`    @State private var greeting = "…"

    var body: some View {
        Text(greeting)
            .onAppear {
                greeting = "loaded"
            }
    }`),
    )
    expect(texts(result.renderTree)).toContain('loaded')
    expect(texts(result.renderTree)).not.toContain('…')
  })

  it('runs once, not on every re-render', () => {
    // The runaway-counter test. Without tracking what has already appeared, this
    // number climbs with every tap.
    const source = app(`    @State private var appearances = 0
    @State private var taps = 0

    var body: some View {
        VStack {
            Text("appeared \\(appearances), tapped \\(taps)")
            Button("Tap") {
                taps += 1
            }
        }
        .onAppear {
            appearances += 1
        }
    }`)

    let result = run(source)
    expect(texts(result.renderTree)).toContain('appeared 1, tapped 0')

    result = tap(result.renderTree, 'Tap')
    expect(texts(result.renderTree)).toContain('appeared 1, tapped 1')

    result = tap(result.renderTree, 'Tap')
    expect(texts(result.renderTree)).toContain('appeared 1, tapped 2')
  })

  it('runs again for a view that left the tree and came back', () => {
    const source = app(`    @State private var showing = true
    @State private var appearances = 0

    var body: some View {
        VStack {
            if showing {
                Text("panel")
                    .onAppear {
                        appearances += 1
                    }
            }
            Text("count \\(appearances)")
            Button("Toggle") {
                showing = !showing
            }
        }
    }`)

    let result = run(source)
    expect(texts(result.renderTree)).toContain('count 1')

    result = tap(result.renderTree, 'Toggle')
    expect(texts(result.renderTree)).not.toContain('panel')

    result = tap(result.renderTree, 'Toggle')
    expect(texts(result.renderTree)).toContain('count 2')
  })

  it('treats .task the same way', () => {
    const result = run(
      app(`    @State private var state = "idle"

    var body: some View {
        Text(state)
            .task {
                state = "fetched"
            }
    }`),
    )
    expect(texts(result.renderTree)).toContain('fetched')
  })
})

describe('.onDisappear', () => {
  it('runs when the view leaves the tree', () => {
    const source = app(`    @State private var showing = true
    @State private var log = "—"

    var body: some View {
        VStack {
            if showing {
                Text("panel")
                    .onDisappear {
                        log = "gone"
                    }
            }
            Text(log)
            Button("Hide") {
                showing = false
            }
        }
    }`)

    let result = run(source)
    expect(texts(result.renderTree)).toContain('—')

    result = tap(result.renderTree, 'Hide')
    expect(texts(result.renderTree)).toContain('gone')
  })
})

describe('.onChange(of:)', () => {
  it('runs when the watched value changes', () => {
    const source = app(`    @State private var count = 0
    @State private var changes = 0

    var body: some View {
        VStack {
            Text("count \\(count), changes \\(changes)")
            Button("Bump") {
                count += 1
            }
        }
        .onChange(of: count) { newValue in
            changes += 1
        }
    }`)

    let result = run(source)
    // Not on appear: SwiftUI does not fire `.onChange` for the initial value.
    expect(texts(result.renderTree)).toContain('count 0, changes 0')

    result = tap(result.renderTree, 'Bump')
    expect(texts(result.renderTree)).toContain('count 1, changes 1')

    result = tap(result.renderTree, 'Bump')
    expect(texts(result.renderTree)).toContain('count 2, changes 2')
  })

  it('does not run when an unrelated value changes', () => {
    const source = app(`    @State private var watched = 0
    @State private var other = 0
    @State private var changes = 0

    var body: some View {
        VStack {
            Text("changes \\(changes), other \\(other)")
            Button("Other") {
                other += 1
            }
        }
        .onChange(of: watched) { newValue in
            changes += 1
        }
    }`)

    let result = run(source)
    result = tap(result.renderTree, 'Other')
    expect(texts(result.renderTree)).toContain('changes 0, other 1')
  })
})
