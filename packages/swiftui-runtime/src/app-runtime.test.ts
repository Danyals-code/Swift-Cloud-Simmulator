import { beforeEach, describe, expect, it } from 'vitest'
import { Parser } from '@studio/swift-syntax'
import { Checker } from '@studio/swift-sema'
import { AppRuntime, actionId } from './app-runtime'
import { flattenViews, renderArg, type ViewValue } from './view-value'

const FILE = 'App.swift'

function load(runtime: AppRuntime, source: string, key = source): void {
  const { sourceFile, diagnostics } = Parser.parse(source, FILE)
  expect(diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([])
  runtime.load([sourceFile], Checker.check([sourceFile]), key)
}

/** `depth:Name(args) .mod` per row — the same information the preview shows. */
function rows(views: readonly ViewValue[]): string[] {
  return flattenViews(views).map(({ view, depth }) => {
    const args =
      view.args.length > 0
        ? `(${view.args.map((a) => (a.label ? `${a.label}: ${renderArg(a.value)}` : renderArg(a.value))).join(', ')})`
        : ''
    const modifiers = view.modifiers.map((m) => `.${m.name}`).join(' ')
    return `${depth}:${view.name}${args}${modifiers ? ' ' + modifiers : ''}`
  })
}

/** The tree path of the first view whose name matches. */
function pathOf(views: readonly ViewValue[], name: string, occurrence = 0): string {
  const matches = flattenViews(views).filter((v) => v.view.name === name)
  const found = matches[occurrence]
  expect(found, `no ${name} at index ${occurrence}`).toBeDefined()
  return found!.path
}

const COUNTER = `import SwiftUI

@main
struct CounterApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var count = 0
    @State private var name = "World"

    var body: some View {
        VStack(spacing: 16) {
            Text("Hello, \\(name)!")
                .font(.largeTitle)
                .foregroundStyle(.primary)

            Text("Count: \\(count)")
                .font(.title2)
                .foregroundStyle(count < 0 ? Color.red : Color.primary)

            HStack(spacing: 12) {
                Button("Minus") {
                    count -= 1
                }
                .padding()
                .background(Color.red.opacity(0.15))

                Spacer()

                Button("Plus") {
                    count += 1
                }
                .padding()
                .background(Color.green.opacity(0.15))
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
        }
        .padding()
        .background(Color(white: 0.95))
    }
}
`

// ===========================================================================

describe('evaluating the reference app', () => {
  let runtime: AppRuntime

  beforeEach(() => {
    runtime = new AppRuntime()
    load(runtime, COUNTER)
  })

  it('produces the view tree with real, evaluated values', () => {
    // The whole point of Phase 2: `\(name)` is resolved, not shown as source.
    expect(rows(runtime.evaluate().views)).toEqual([
      '0:VStack(spacing: 16) .padding .background',
      '1:Text("Hello, World!") .font .foregroundStyle',
      '1:Text("Count: 0") .font .foregroundStyle',
      '1:HStack(spacing: 12) .frame .padding',
      '2:Button("Minus") .padding .background',
      '2:Spacer',
      '2:Button("Plus") .padding .background',
    ])
  })

  it('resolves the entry point through WindowGroup to the root view', () => {
    expect(runtime.evaluate().rootTypeName).toBe('ContentView')
  })

  it('evaluates modifier arguments, not just their names', () => {
    const views = runtime.evaluate().views
    const vstack = views[0]!
    const background = vstack.modifiers.find((m) => m.name === 'background')!
    expect(renderArg(background.args[0]!.value)).toBe('Color(white: 0.95)')
  })

  it('takes the correct branch of a ternary', () => {
    const before = runtime.evaluate().views
    const countText = flattenViews(before)[2]!.view
    expect(renderArg(countText.modifiers[1]!.args[0]!.value)).toBe('Color.primary')

    // Drive the count negative and the other branch should be taken.
    runtime.dispatch(actionId(pathOf(before, 'Button', 0)))
    const after = runtime.evaluate().views
    const negative = flattenViews(after)[2]!.view
    expect(renderArg(negative.args[0]!.value)).toBe('"Count: -1"')
    expect(renderArg(negative.modifiers[1]!.args[0]!.value)).toBe('Color.red')
  })

  it('reports no runtime failure', () => {
    expect(runtime.evaluate().failure).toBeNull()
  })
})

describe('running button actions', () => {
  let runtime: AppRuntime

  beforeEach(() => {
    runtime = new AppRuntime()
    load(runtime, COUNTER)
  })

  function countLabel(): string {
    const views = runtime.evaluate().views
    return renderArg(flattenViews(views)[2]!.view.args[0]!.value)
  }

  it('runs the real Swift closure and updates dependent views', () => {
    const plus = actionId(pathOf(runtime.evaluate().views, 'Button', 1))

    expect(countLabel()).toBe('"Count: 0"')
    runtime.dispatch(plus)
    expect(countLabel()).toBe('"Count: 1"')
    runtime.dispatch(plus)
    expect(countLabel()).toBe('"Count: 2"')
  })

  it('runs the other button independently', () => {
    const views = runtime.evaluate().views
    const minus = actionId(pathOf(views, 'Button', 0))
    const plus = actionId(pathOf(views, 'Button', 1))

    runtime.dispatch(plus)
    runtime.dispatch(plus)
    runtime.dispatch(minus)
    expect(countLabel()).toBe('"Count: 1"')
  })

  it('ignores an unknown handler', () => {
    expect(runtime.dispatch('action-nope')).toBe(false)
  })

  it('resets state without touching the source', () => {
    const plus = actionId(pathOf(runtime.evaluate().views, 'Button', 1))
    runtime.dispatch(plus)
    runtime.dispatch(plus)
    expect(countLabel()).toBe('"Count: 2"')

    runtime.reset()
    expect(countLabel()).toBe('"Count: 0"')
  })
})

describe('@State survives edits (FR-5.3)', () => {
  let runtime: AppRuntime

  beforeEach(() => {
    runtime = new AppRuntime()
    load(runtime, COUNTER)
  })

  function bump(times: number): void {
    const plus = actionId(pathOf(runtime.evaluate().views, 'Button', 1))
    for (let i = 0; i < times; i++) runtime.dispatch(plus)
  }

  function countLabel(): string {
    return renderArg(flattenViews(runtime.evaluate().views)[2]!.view.args[0]!.value)
  }

  it('keeps the counter when an unrelated part of the view changes', () => {
    // A preview that resets every counter on each keystroke is a screenshot, not a
    // preview. This is the behaviour that makes live editing usable.
    bump(3)
    expect(countLabel()).toBe('"Count: 3"')

    load(runtime, COUNTER.replace('spacing: 16', 'spacing: 40'), 'edited-spacing')
    expect(countLabel()).toBe('"Count: 3"')
  })

  it('keeps the counter when a different @State property changes its initial value', () => {
    bump(2)
    load(runtime, COUNTER.replace('"World"', '"Swift"'), 'edited-name')

    expect(countLabel()).toBe('"Count: 2"')
    expect(renderArg(flattenViews(runtime.evaluate().views)[1]!.view.args[0]!.value)).toBe(
      '"Hello, Swift!"',
    )
  })

  it('drops state for a property that no longer exists', () => {
    bump(5)
    const renamed = COUNTER.replaceAll('count', 'tally')
    load(runtime, renamed, 'renamed')
    expect(renderArg(flattenViews(runtime.evaluate().views)[2]!.view.args[0]!.value)).toBe(
      '"Count: 0"',
    )
  })

  it('does not rebuild when the program is unchanged', () => {
    bump(4)
    load(runtime, COUNTER) // same key
    expect(countLabel()).toBe('"Count: 4"')
  })
})

describe('view builder semantics', () => {
  function evaluateBody(body: string): string[] {
    const runtime = new AppRuntime()
    load(
      runtime,
      `@main struct A: App { var body: some Scene { WindowGroup { Root() } } }
       struct Root: View {
           @State private var flag = true
           var body: some View {
${body}
           }
       }`,
    )
    return rows(runtime.evaluate().views)
  }

  it('collects every expression in a block, not just the last', () => {
    expect(evaluateBody('VStack { Text("a"); Text("b"); Text("c") }')).toEqual([
      '0:VStack',
      '1:Text("a")',
      '1:Text("b")',
      '1:Text("c")',
    ])
  })

  it('takes only the live branch of an if', () => {
    expect(evaluateBody('VStack { if flag { Text("yes") } else { Text("no") } }')).toEqual([
      '0:VStack',
      '1:Text("yes")',
    ])
  })

  it('flattens a loop into one view per iteration', () => {
    expect(evaluateBody('VStack { for i in 0..<3 { Text("row \\(i)") } }')).toEqual([
      '0:VStack',
      '1:Text("row 0")',
      '1:Text("row 1")',
      '1:Text("row 2")',
    ])
  })

  it('expands a nested user view into its own body', () => {
    const runtime = new AppRuntime()
    load(
      runtime,
      `@main struct A: App { var body: some Scene { WindowGroup { Root() } } }
       struct Root: View { var body: some View { VStack { Badge() } } }
       struct Badge: View { var body: some View { Text("badge") } }`,
    )
    expect(rows(runtime.evaluate().views)).toEqual(['0:VStack', '1:Text("badge")'])
  })

  it('passes arguments to a nested user view', () => {
    const runtime = new AppRuntime()
    load(
      runtime,
      `@main struct A: App { var body: some Scene { WindowGroup { Root() } } }
       struct Root: View { var body: some View { VStack { Badge(title: "hi") } } }
       struct Badge: View {
           var title = ""
           var body: some View { Text(title) }
       }`,
    )
    expect(rows(runtime.evaluate().views)).toEqual(['0:VStack', '1:Text("hi")'])
  })
})

describe('runtime failures are reported, not thrown', () => {
  it('reports a trap from the view body with its source position', () => {
    const runtime = new AppRuntime()
    load(
      runtime,
      `@main struct A: App { var body: some Scene { WindowGroup { Root() } } }
       struct Root: View {
           var body: some View { Text("\\(1 / 0)") }
       }`,
    )

    const result = runtime.evaluate()
    expect(result.failure?.kind).toBe('trap')
    expect(result.failure?.message).toContain('Division by zero')
    expect(result.views).toEqual([])
  })

  it('survives a trap inside a button action', () => {
    // One bad tap must not tear down the whole preview.
    const runtime = new AppRuntime()
    load(
      runtime,
      `@main struct A: App { var body: some Scene { WindowGroup { Root() } } }
       struct Root: View {
           @State private var n = 0
           var body: some View {
               Button("Boom") { n = 1 / 0 }
           }
       }`,
    )

    const plus = actionId(pathOf(runtime.evaluate().views, 'Button'))
    expect(() => runtime.dispatch(plus)).not.toThrow()

    const after = runtime.evaluate()
    expect(after.failure).toBeNull()
    expect(rows(after.views)).toEqual(['0:Button("Boom")'])
  })

  it('reports an unbounded loop in the body instead of hanging', () => {
    const runtime = new AppRuntime()
    load(
      runtime,
      `@main struct A: App { var body: some Scene { WindowGroup { Root() } } }
       struct Root: View {
           var body: some View {
               VStack { for i in 0..<100000000 { Text("\\(i)") } }
           }
       }`,
    )

    const result = runtime.evaluate()
    expect(result.failure?.kind).toBe('budget')
    expect(result.failure?.message).toContain('too long')
  })
})

describe('print output reaches the console', () => {
  it('captures print from a button action', () => {
    const runtime = new AppRuntime()
    load(
      runtime,
      `@main struct A: App { var body: some Scene { WindowGroup { Root() } } }
       struct Root: View {
           @State private var n = 0
           var body: some View {
               Button("Log") { print("tapped \\(n)") }
           }
       }`,
    )

    runtime.evaluate()
    runtime.dispatch(actionId(pathOf(runtime.evaluate().views, 'Button')))
    expect(runtime.evaluate().logs.map((l) => l.message)).toContain('tapped 0')
  })
})
