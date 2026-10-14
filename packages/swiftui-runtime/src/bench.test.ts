import { cpus, loadavg } from 'node:os'
import { GCProfiler, getHeapStatistics } from 'node:v8'
import { describe, expect, it } from 'vitest'
import { applyEvent, compile, rerender } from './pipeline'
import type { CompileRequest, CompileTimings, Diagnostic } from '@studio/shared'
import { Checker, buildAuthoringModel, lintStrictness } from '@studio/swift-sema'
import { Parser, type SourceFileNode, type Token } from '@studio/swift-syntax'

/**
 * NFR-1 performance budgets, measured through the whole worker-side pipeline.
 *
 * Asserting ceilings rather than targets, and taking the best of several runs: CI
 * machines are noisy enough that a single cold sample would make these flaky, and a
 * flaky performance test gets disabled, which is worse than not having one.
 */

/** `String.raw` so the Swift interpolation reads as it would in a real file. */
const UNIT = String.raw`
struct View%N%: View {
    @State private var count = 0
    var body: some View {
        VStack(spacing: 8) {
            Text("Item \(count)")
                .font(.headline)
                .foregroundStyle(count > 0 ? Color.green : Color.red)
            Button("Tap") { count += 1 }
                .padding()
        }
        .padding()
    }
}
`

function project(copies: number): string {
  return (
    'import SwiftUI\n@main struct A: App { var body: some Scene { WindowGroup { View0() } } }\n' +
    Array.from({ length: copies }, (_, i) => UNIT.replaceAll('%N%', String(i))).join('\n')
  )
}

function request(text: string): CompileRequest {
  return {
    files: [{ id: 'Sources/App.swift', text }],
    canvas: { width: 393, height: 852 },
    safeArea: { top: 59, leading: 0, bottom: 34, trailing: 0 },
    colorScheme: 'light',
    revision: 1,
  }
}

/** The best of `runs` timed compiles, after three to warm up, and what that run spent in each stage. */
function bestOf(runs: number, text: string): { ms: number; timings: CompileTimings } {
  const req = request(text)
  for (let i = 0; i < 3; i++) compile(req) // warm up

  let best = Infinity
  let timings: CompileTimings | undefined
  for (let i = 0; i < runs; i++) {
    const started = performance.now()
    const result = compile(req)
    const ms = performance.now() - started
    if (ms < best) [best, timings] = [ms, result.timings]
  }
  return { ms: best, timings: timings! }
}

/** The quickest of three runs of `work`, in milliseconds. */
function quickest(work: () => void): number {
  let best = Infinity
  for (let i = 0; i < 3; i++) {
    const started = performance.now()
    work()
    best = Math.min(best, performance.now() - started)
  }
  return best
}

/**
 * What a project over budget says beside its number. A CI runner shows only an assertion's
 * message to anyone without admin rights, so the message says where the time went and on
 * what: each stage of the best run, the parts of its check timed apart as the pipeline runs
 * them, how fast a few more compiles run and the garbage they collect, and the runtime.
 * Worked out only over budget, so a run inside it does what it always did.
 */
function overBudget(name: string, text: string, best: { ms: number; timings: CompileTimings }, budget: number): string | undefined {
  if (best.ms < budget) return undefined
  const ms = (value: number) => `${value.toFixed(1)} ms`
  const { parse, check, evaluate, layout, total } = best.timings
  const req = request(text)
  let parts: string
  try {
    const parsed = req.files.map(file => Parser.parse(file.text, file.id))
    const files: SourceFileNode[] = parsed.map(result => result.sourceFile)
    const tokens = new Map<string, readonly Token[]>(parsed.map((result, index) => [req.files[index]!.id, result.tokens]))
    const model = Checker.check(files)
    const diagnostics: Diagnostic[] = [...parsed.flatMap(result => result.diagnostics), ...model.diagnostics]
    parts = `checker ${ms(quickest(() => Checker.check(files)))}, strictness ${ms(quickest(() => lintStrictness(files, model)))}, authoring model ${ms(quickest(() => buildAuthoringModel({ files: req.files, parsed: files, tokens, diagnostics, projectId: '', revision: req.revision })))}`
  } catch (error) {
    parts = `not timed apart: ${error instanceof Error ? error.message : String(error)}`
  }
  // Ten more compiles, with the engine further along in optimising the code: a best far
  // under the budget says the runner was still compiling the pipeline when it was timed.
  // The stages leave out collecting garbage, which is counted over the same compiles.
  const more = 10
  let warmer: string
  try {
    const profiler = new GCProfiler()
    profiler.start()
    let fastest = Infinity, all = 0
    for (let i = 0; i < more; i++) {
      const started = performance.now()
      compile(req)
      const took = performance.now() - started
      fastest = Math.min(fastest, took)
      all += took
    }
    const { statistics } = profiler.stop()
    const kinds = new Map<string, number>()
    for (const collection of statistics) kinds.set(collection.gcType, (kinds.get(collection.gcType) ?? 0) + 1)
    const cost = statistics.reduce((sum, collection) => sum + collection.cost, 0) / 1000 / more
    warmer = `${more} more compiles took ${ms(fastest)} at best and ${ms(all / more)} on average, ${ms(cost)} a compile collecting garbage (${[...kinds].map(([kind, count]) => `${kind} ${count}`).join(', ') || 'none'}).`
  } catch (error) {
    warmer = `More compiles not measured: ${error instanceof Error ? error.message : String(error)}.`
  }
  const cpu = cpus()
  const runtime = `Node ${process.version} on ${process.platform} ${process.arch}, ${cpu[0]?.model.trim() ?? 'unknown CPU'} x ${cpu.length}, load ${loadavg().map(load => load.toFixed(2)).join(' ')}, heap limit ${Math.round(getHeapStatistics().heap_size_limit / 2 ** 20)} MB`
  return `${name} took ${ms(best.ms)} against ${budget}. Best run: parse ${ms(parse)}, check ${ms(check)} (${parts}), evaluate ${ms(evaluate)}, layout ${ms(layout)}, total ${ms(total)}. ${warmer} ${runtime}`
}

describe('pipeline performance', () => {
  it('compiles and lays out a 500-line project inside the 120 ms budget', () => {
    const text = project(36)
    expect(text.split('\n').length).toBeGreaterThan(500)

    const best = bestOf(5, text)
    console.log(`    500-line project, full pipeline: ${best.ms.toFixed(2)} ms`)
    expect(best.ms, overBudget('The 500-line project', text, best, 120)).toBeLessThan(120)
  })

  it('stays inside budget on a 2000-line project', () => {
    const text = project(144)
    expect(text.split('\n').length).toBeGreaterThan(2000)

    const best = bestOf(5, text)
    console.log(`   2000-line project, full pipeline: ${best.ms.toFixed(2)} ms`)
    expect(best.ms, overBudget('The 2000-line project', text, best, 120)).toBeLessThan(120)
  })

  /**
   * The page gallery's cost, which is the one thing about it worth measuring.
   *
   * Six tabs drawn at once is six compositions and six layouts where there was one,
   * and nothing else: every tab's body was already evaluated by the same pass. So
   * the ceiling is the same 120 ms, and what the ratio has to show is that the extra
   * work is layout-shaped - a few times one screen - rather than a second pipeline
   * per page.
   */
  it('draws six pages at once inside the same 120 ms budget', () => {
    const tabs = Array.from(
      { length: 6 },
      (_, i) => `            View${i}().tabItem { Label("Tab ${i}", systemImage: "star") }`,
    ).join('\n')
    const text =
      'import SwiftUI\n@main struct A: App { var body: some Scene { WindowGroup { Root() } } }\n' +
      `struct Root: View { var body: some View { TabView {\n${tabs}\n} } }\n` +
      Array.from({ length: 6 }, (_, i) => UNIT.replaceAll('%N%', String(i))).join('\n')

    const one = { ...request(text), allPages: false }
    const all = { ...request(text), allPages: true }
    expect(compile(all).diagnostics).toEqual([])
    expect(compile(all).pages).toHaveLength(6)

    const bestOfRequest = (req: CompileRequest) => {
      for (let i = 0; i < 3; i++) compile(req)
      let best = Infinity
      for (let i = 0; i < 5; i++) {
        const started = performance.now()
        compile(req)
        best = Math.min(best, performance.now() - started)
      }
      return best
    }

    const single = bestOfRequest(one)
    const gallery = bestOfRequest(all)
    console.log(`    six-page gallery: ${gallery.toFixed(2)} ms against ${single.toFixed(2)} ms for one page`)
    expect(gallery).toBeLessThan(120)
    // Well under one full pipeline per page, which is what makes it worth doing
    // this way rather than compiling each page on its own.
    expect(gallery).toBeLessThan(single * 6)
  })

  it('reports zero diagnostics on the synthetic corpus', () => {
    // A performance corpus quietly full of errors measures the error path, not the
    // real one.
    expect(compile(request(project(36))).diagnostics).toEqual([])
  })
})

describe('interaction latency (NFR-1)', () => {
  /**
   * Tap to repaint must stay under 32 ms - roughly two frames. Above that, a button
   * stops feeling like it responded to the press.
   */
  it('dispatches a tap and re-renders within 32 ms', () => {
    const reference = `import SwiftUI
@main struct A: App { var body: some Scene { WindowGroup { Root() } } }
struct Root: View {
    @State private var count = 0
    var body: some View {
        VStack(spacing: 16) {
            Text("Count: \\(count)")
            HStack {
                Button("Minus") { count -= 1 }.padding()
                Spacer()
                Button("Plus") { count += 1 }.padding()
            }
            .frame(maxWidth: .infinity)
        }
        .padding()
    }
}`
    const first = compile(request(reference))
    expect(first.diagnostics).toEqual([])

    // The Plus button is the second action in the tree.
    const handlers = (first.renderTree?.nodes ?? [])
      .filter((n) => n.hitTarget)
      .map((n) => n.hitTarget!.handlerId)
    expect(handlers.length).toBe(2)

    let revision = 100
    const tap = () => {
      applyEvent({ kind: 'tap', handlerId: handlers[1]!, location: { x: 0, y: 0 } })
      return rerender(++revision)
    }

    for (let i = 0; i < 5; i++) tap() // warm up

    let best = Infinity
    for (let i = 0; i < 10; i++) {
      const started = performance.now()
      tap()
      best = Math.min(best, performance.now() - started)
    }

    console.log(`    tap to repaint: ${best.toFixed(2)} ms`)
    expect(best).toBeLessThan(32)
  })

  it('keeps the layout cache effective on a wide tree', () => {
    // 200 sibling rows: enough that a non-memoised measure pass would show up.
    const rows = Array.from({ length: 200 }, (_, i) => `            Text("Row ${i}")`).join('\n')
    const source = `import SwiftUI
@main struct A: App { var body: some Scene { WindowGroup { Root() } } }
struct Root: View {
    var body: some View {
        VStack(spacing: 2) {
${rows}
        }
    }
}`
    const ms = bestOf(5, source).ms
    console.log(`    200-row stack, full pipeline: ${ms.toFixed(2)} ms`)
    expect(ms).toBeLessThan(120)

    const result = compile(request(source))
    expect(result.renderTree?.nodes.length).toBeGreaterThan(200)
  })
})
