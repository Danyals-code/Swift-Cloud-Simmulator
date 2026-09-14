import { describe, expect, it } from 'vitest'
import { Parser } from '@studio/swift-syntax'
import { Checker } from '@studio/swift-sema'
import { AppRuntime, actionId } from './app-runtime'
import { flattenViews, renderArg, type ViewValue } from './view-value'
import { IdentityPath, StateStore, fingerprint } from './identity'
import { int, str, type SwiftValue } from '@studio/swift-runtime'

const FILE = 'App.swift'

function load(runtime: AppRuntime, source: string, key = source): void {
  const { sourceFile, diagnostics } = Parser.parse(source, FILE)
  expect(diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([])
  runtime.load([sourceFile], Checker.check([sourceFile]), key)
}

/** Every `Text` in the rendered tree, in order. */
function labels(views: readonly ViewValue[]): string[] {
  return flattenViews(views)
    .filter(({ view }) => view.name === 'Text')
    .map(({ view }) => renderArg(view.args[0]!.value).replace(/^"|"$/g, ''))
}

function buttonPaths(views: readonly ViewValue[]): string[] {
  return flattenViews(views)
    .filter(({ view }) => view.action !== null)
    .map(({ path }) => path)
}

// ===========================================================================

describe('IdentityPath', () => {
  it('nests identities as it descends', () => {
    const path = new IdentityPath()
    const outer = path.push('Outer')
    const inner = path.push('Inner')

    expect(inner.startsWith(outer)).toBe(true)
    path.pop()
    expect(path.current).toBe(outer)
  })

  it('distinguishes same-typed siblings by ordinal', () => {
    const path = new IdentityPath()
    const first = path.push('Row')
    path.pop()
    const second = path.push('Row')
    path.pop()

    expect(first).not.toBe(second)
    expect(second).toContain('[1]')
  })

  it('restarts sibling counting inside each parent', () => {
    // Two `Row`s under different parents must not collide.
    const path = new IdentityPath()
    path.push('A')
    const underA = path.push('Row')
    path.pop()
    path.pop()

    path.push('B')
    const underB = path.push('Row')
    path.pop()
    path.pop()

    expect(underA).not.toBe(underB)
    expect(underA.endsWith('Row')).toBe(true)
    expect(underB.endsWith('Row')).toBe(true)
  })
})

describe('StateStore', () => {
  const FP = fingerprint({ kind: 'integerLiteral', value: 0 })

  it('returns the initial value the first time', () => {
    const store = new StateStore()
    expect(store.resolve('#/V', 'count', int(0), FP)).toEqual(int(0))
  })

  it('returns the stored value afterwards', () => {
    const store = new StateStore()
    store.resolve('#/V', 'count', int(0), FP)
    store.store('#/V', 'count', int(7), FP)
    expect(store.resolve('#/V', 'count', int(0), FP)).toEqual(int(7))
  })

  it('discards a stored value when the initialiser changed', () => {
    const store = new StateStore()
    store.store('#/V', 'count', int(7), FP)

    const edited = fingerprint({ kind: 'integerLiteral', value: 10 })
    expect(store.resolve('#/V', 'count', int(10), edited)).toEqual(int(10))
  })

  it('keeps separate boxes per identity', () => {
    const store = new StateStore()
    store.store('#/A', 'n', int(1), FP)
    store.store('#/B', 'n', int(2), FP)

    expect(store.resolve('#/A', 'n', int(0), FP)).toEqual(int(1))
    expect(store.resolve('#/B', 'n', int(0), FP)).toEqual(int(2))
  })

  it('drops boxes for views that left the tree', () => {
    // SwiftUI destroys state when a view is removed, and gives it fresh state if it
    // returns. Keeping the box would resurrect a stale value.
    const store = new StateStore()
    store.beginPass()
    store.resolve('#/Kept', 'n', int(1), FP)
    store.resolve('#/Gone', 'n', int(2), FP)
    store.endPass()
    expect(store.size).toBe(2)

    store.beginPass()
    store.resolve('#/Kept', 'n', int(0), FP)
    store.endPass()

    expect(store.size).toBe(1)
    expect(store.resolve('#/Gone', 'n', int(99), FP)).toEqual(int(99))
  })
})

describe('fingerprint', () => {
  it('ignores spans, which shift on every edit above a declaration', () => {
    const a = { kind: 'integerLiteral', value: 0, span: { file: 'x', start: 10, end: 11 } }
    const b = { kind: 'integerLiteral', value: 0, span: { file: 'x', start: 900, end: 901 } }
    expect(fingerprint(a)).toBe(fingerprint(b))
  })

  it('distinguishes different literal values', () => {
    expect(fingerprint({ kind: 'integerLiteral', value: 0 })).not.toBe(
      fingerprint({ kind: 'integerLiteral', value: 10 }),
    )
  })

  it('distinguishes different structures', () => {
    expect(fingerprint({ kind: 'integerLiteral', value: 0 })).not.toBe(
      fingerprint({ kind: 'stringLiteral', value: 0 }),
    )
  })
})

describe('independent state per view instance', () => {
  /**
   * Two sibling counters, each with their own `@State`.
   *
   * This is the capability identity-keyed boxes exist for, and precisely what Phase
   * 2's single-root-instance model could not express: there, both counters shared one
   * struct and moved together.
   */
  const TWO_COUNTERS = `import SwiftUI
@main struct A: App { var body: some Scene { WindowGroup { Root() } } }
struct Root: View {
    var body: some View {
        VStack {
            Counter()
            Counter()
        }
    }
}
struct Counter: View {
    @State private var n = 0
    var body: some View {
        VStack {
            Text("n = \\(n)")
            Button("Bump") { n += 1 }
        }
    }
}`

  it('gives each instance its own box', () => {
    const runtime = new AppRuntime()
    load(runtime, TWO_COUNTERS)

    expect(labels(runtime.evaluate().views)).toEqual(['n = 0', 'n = 0'])

    const buttons = buttonPaths(runtime.evaluate().views)
    expect(buttons).toHaveLength(2)

    // Bump only the first.
    runtime.dispatch(actionId(buttons[0]!))
    expect(labels(runtime.evaluate().views)).toEqual(['n = 1', 'n = 0'])

    // Then the second, twice.
    const after = buttonPaths(runtime.evaluate().views)
    runtime.dispatch(actionId(after[1]!))
    runtime.dispatch(actionId(after[1]!))
    expect(labels(runtime.evaluate().views)).toEqual(['n = 1', 'n = 2'])
  })

  it('keeps both values stable across repeated renders', () => {
    const runtime = new AppRuntime()
    load(runtime, TWO_COUNTERS)

    const buttons = buttonPaths(runtime.evaluate().views)
    runtime.dispatch(actionId(buttons[0]!))

    for (let i = 0; i < 5; i++) {
      expect(labels(runtime.evaluate().views)).toEqual(['n = 1', 'n = 0'])
    }
  })
})

describe('state lifetime follows the tree', () => {
  const TOGGLE = `import SwiftUI
@main struct A: App { var body: some Scene { WindowGroup { Root() } } }
struct Root: View {
    @State private var showing = true
    var body: some View {
        VStack {
            Button("Toggle") { showing = !showing }
            if showing {
                Counter()
            }
        }
    }
}
struct Counter: View {
    @State private var n = 5
    var body: some View {
        VStack {
            Text("n = \\(n)")
            Button("Bump") { n += 1 }
        }
    }
}`

  it('destroys state when a view leaves the tree and restores the initial value when it returns', () => {
    const runtime = new AppRuntime()
    load(runtime, TOGGLE)

    const first = runtime.evaluate()
    expect(labels(first.views)).toEqual(['n = 5'])

    // Bump the counter to 7.
    const buttons = buttonPaths(first.views)
    runtime.dispatch(actionId(buttons[1]!))
    runtime.dispatch(actionId(buttons[1]!))
    expect(labels(runtime.evaluate().views)).toEqual(['n = 7'])

    // Hide it.
    runtime.dispatch(actionId(buttonPaths(runtime.evaluate().views)[0]!))
    expect(labels(runtime.evaluate().views)).toEqual([])

    // Bring it back: SwiftUI gives a re-inserted view fresh state, not the old value.
    runtime.dispatch(actionId(buttonPaths(runtime.evaluate().views)[0]!))
    expect(labels(runtime.evaluate().views)).toEqual(['n = 5'])
  })
})

describe('state across edits (FR-5.3)', () => {
  const COUNTER = (spacing: number, initial: number) => `import SwiftUI
@main struct A: App { var body: some Scene { WindowGroup { Root() } } }
struct Root: View {
    @State private var n = ${initial}
    var body: some View {
        VStack(spacing: ${spacing}) {
            Text("n = \\(n)")
            Button("Bump") { n += 1 }
        }
    }
}`

  function bump(runtime: AppRuntime, times: number): void {
    for (let i = 0; i < times; i++) {
      runtime.dispatch(actionId(buttonPaths(runtime.evaluate().views)[0]!))
    }
  }

  it('survives an edit elsewhere in the view', () => {
    const runtime = new AppRuntime()
    load(runtime, COUNTER(8, 0), 'a')
    bump(runtime, 3)
    expect(labels(runtime.evaluate().views)).toEqual(['n = 3'])

    load(runtime, COUNTER(40, 0), 'b')
    expect(labels(runtime.evaluate().views)).toEqual(['n = 3'])
  })

  it('resets when the initialiser itself is edited', () => {
    // Editing `= 0` to `= 10` is a request to see 10. Keeping 3 reads as the preview
    // being stuck.
    const runtime = new AppRuntime()
    load(runtime, COUNTER(8, 0), 'a')
    bump(runtime, 3)

    load(runtime, COUNTER(8, 10), 'b')
    expect(labels(runtime.evaluate().views)).toEqual(['n = 10'])
  })

  it('drops everything on reset', () => {
    const runtime = new AppRuntime()
    load(runtime, COUNTER(8, 0))
    bump(runtime, 4)
    expect(labels(runtime.evaluate().views)).toEqual(['n = 4'])

    runtime.reset()
    expect(labels(runtime.evaluate().views)).toEqual(['n = 0'])
  })
})

describe('state of non-primitive types', () => {
  it('preserves a string across renders', () => {
    const runtime = new AppRuntime()
    load(
      runtime,
      `import SwiftUI
@main struct A: App { var body: some Scene { WindowGroup { Root() } } }
struct Root: View {
    @State private var name = "World"
    var body: some View {
        VStack {
            Text("Hi \\(name)")
            Button("Change") { name = "Swift" }
        }
    }
}`,
    )

    expect(labels(runtime.evaluate().views)).toEqual(['Hi World'])
    runtime.dispatch(actionId(buttonPaths(runtime.evaluate().views)[0]!))
    expect(labels(runtime.evaluate().views)).toEqual(['Hi Swift'])
  })

  it('preserves an array across renders', () => {
    const runtime = new AppRuntime()
    load(
      runtime,
      `import SwiftUI
@main struct A: App { var body: some Scene { WindowGroup { Root() } } }
struct Root: View {
    @State private var items = [1, 2]
    var body: some View {
        VStack {
            Text("count \\(items.count)")
            Button("Add") { items.append(3) }
        }
    }
}`,
    )

    expect(labels(runtime.evaluate().views)).toEqual(['count 2'])
    runtime.dispatch(actionId(buttonPaths(runtime.evaluate().views)[0]!))
    expect(labels(runtime.evaluate().views)).toEqual(['count 3'])
  })
})

/** Keeps the imports honest about what a SwiftValue is. */
describe('value helpers', () => {
  it('round-trips through the store unchanged', () => {
    const store = new StateStore()
    const value: SwiftValue = str('hello')
    store.store('#/V', 'text', value, 'fp')
    expect(store.resolve('#/V', 'text', str('other'), 'fp')).toBe(value)
  })
})
