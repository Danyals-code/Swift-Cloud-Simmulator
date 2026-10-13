import { describe, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { projectFromFiles, type Project } from '@studio/project-model'
import { describeProblem, previewCheck } from './problems'

/**
 * What the preview finds wrong with an AI answer (G2): the errors the answer brought,
 * never the ones the project already had, which used to block every AI edit.
 *
 * The preview runs here as the runtime's own compile, as the studio's worker runs it.
 */

const compileHere = async (project: Project) => {
  resetPipelineState()
  return compile({ files: project.files, canvas: { width: 402, height: 874 }, colorScheme: 'light', revision: 1, allPages: true })
}

/** A counter app, with `body` as its screen's contents and `extra` after the screen. */
const counter = (body: string, extra = '') => projectFromFiles([{ name: 'Sources/CounterApp.swift', text: `import SwiftUI

@main
struct CounterApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}

struct ContentView: View {
    @State private var count = 0

    var body: some View {
        VStack(spacing: 12) {
${body}
        }
    }
}
${extra}` }])!

/** An error that has nothing to do with the screen, as a designer might leave while typing. */
const LEFT_BROKEN = 'struct DraftView: View {\n    var body: some View { Text(draftTitle) }\n}\n'

describe('the problems an AI answer brings to the preview', () => {
  it('does not count an error the project already had', async () => {
    const before = counter('            Text("Count: \\(count)")', LEFT_BROKEN)
    const after = counter('            Text("Taps so far: \\(count)")', LEFT_BROKEN)
    // Checked on its own, the answer has the error the project had.
    expect(await previewCheck(compileHere, null)(after)).toEqual([expect.objectContaining({ message: "Cannot find 'draftTitle' in scope." })])

    expect(await previewCheck(compileHere, before)(after)).toEqual([])
  })

  it('knows an old error again when the answer changed only what it suggests', async () => {
    const before = counter('            Text("Count: \\(count)")', LEFT_BROKEN)
    // A new name close to the missing one: the old error now ends "Did you mean 'draftTitles'?".
    const after = counter('            Text("Count: \\(count)")', `${LEFT_BROKEN}\nlet draftTitles = ["Weekly plan"]\n`)
    expect(await previewCheck(compileHere, null)(after)).toEqual([expect.objectContaining({ message: expect.stringContaining("Did you mean 'draftTitles'?") })])

    expect(await previewCheck(compileHere, before)(after)).toEqual([])
  })

  it('counts an error the answer brought, with the file, line and code it is on', async () => {
    const before = counter('            Text("Count: \\(count)")')
    const after = counter('            Text("Count: \\(count)")\n            Text(tapsLabel)')

    expect(await previewCheck(compileHere, before)(after)).toEqual([
      { message: "Cannot find 'tapsLabel' in scope.", file: 'Sources/CounterApp.swift', line: 14, source: 'Text(tapsLabel)' },
    ])
  })

  it('does not count warnings, or views the preview cannot draw, which Xcode still builds', async () => {
    const after = counter('            Text("Count: \\(count)").glassEffect()\n            Image(systemName: "figure.run.circle.fill.badge.questionmark")\n            HeartRateMonitor()')
    const result = await compileHere(after)
    expect(result.diagnostics.filter(d => d.severity === 'warning').length).toBeGreaterThanOrEqual(3)
    expect(result.renderTree?.nodes.some(node => node.kind === 'placeholder')).toBe(true)

    expect(await previewCheck(compileHere, null)(after)).toEqual([])
  })

  it('counts what Xcode would reject, which the preview runs, as a problem that refuses nothing', async () => {
    const after = counter('            var total = 0\n            for step in 1...3 { total += step }\n            Text("Total: \\(total)")')

    expect(await previewCheck(compileHere, null)(after)).toEqual([{
      message: expect.stringContaining("Xcode rejects a 'for' loop in a view's body"),
      file: 'Sources/CounterApp.swift', line: 14, source: 'for step in 1...3 { total += step }', kind: 'xcode',
    }])
  })

  it('compiles the project as it was only when an answer has errors, and once for both answers', async () => {
    const before = counter('            Text("Count: \\(count)")')
    const compiled: Project[] = []
    const check = previewCheck(async project => { compiled.push(project); return compileHere(project) }, before)

    await check(counter('            Text("Taps: \\(count)")'))
    expect(compiled).not.toContain(before)
    await check(counter('            Text(firstTry)'))
    await check(counter('            Text(secondTry)'))

    expect(compiled.filter(project => project === before)).toHaveLength(1)
  })

  it('keeps a long error to what a second request can carry', async () => {
    const after = counter('            Text("Count: \\(count)").onAppear { fatalError(String(repeating: "overflow ", count: 60)) }')

    const [problem] = await previewCheck(compileHere, null)(after)

    expect(problem!.message).toContain('overflow overflow')
    expect(problem!.message.length).toBeLessThanOrEqual(400)
  })

  it('describes a problem for the participant, with where it is when the preview says', () => {
    expect(describeProblem({ message: "Cannot find 'tapsLabel' in scope.", file: 'Sources/Features/Counter/CounterView.swift', line: 14, source: 'Text(tapsLabel)' }))
      .toBe("Cannot find 'tapsLabel' in scope (Features/Counter/CounterView.swift, line 14).")
    expect(describeProblem({ message: 'The app has 5 pages, and 3 were asked for.' })).toBe('The app has 5 pages, and 3 were asked for.')
  })

  it.each([
    ['a second tab', 'TabView {\n                Text("First").tabItem { Label("First", systemImage: "house") }\n                SecondView().tabItem { Label("Second", systemImage: "star") }\n            }'],
    ['a pushed screen', 'NavigationStack {\n                NavigationLink("Open") { SecondView() }\n            }'],
  ])('counts a view that stops on %s, which the preview only draws as stopped', async (_case, root) => {
    const after = projectFromFiles([{ name: 'Sources/TwoScreensApp.swift', text: `import SwiftUI

@main
struct TwoScreensApp: App {
    var body: some Scene {
        WindowGroup {
            ${root}
        }
    }
}

struct SecondView: View {
    let values = [1]

    var body: some View {
        Text("Value \\(values[5])")
    }
}
` }])!

    expect(await previewCheck(compileHere, null)(after)).toEqual([expect.objectContaining({ message: expect.stringContaining('Index out of range'), file: 'Sources/TwoScreensApp.swift' })])
  })

  it('counts a screen that traps as it appears', async () => {
    const after = counter('            Text("Count: \\(count)").onAppear { let values = [1]; print(values[5]) }')

    expect(await previewCheck(compileHere, null)(after)).toEqual([expect.objectContaining({ message: expect.stringContaining('Index out of range') })])
  })
})
