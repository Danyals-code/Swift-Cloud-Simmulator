import { expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'

it('measures 100 source-edit/pipeline samples after five warmups on 2,000 lines and 100 records', () => {
  const records = Array.from({ length: 100 }, (_, i) => `Item(id: "${i}", title: "Record ${i}")`).join(',\n')
  const helper = (i: number) => `struct Helper${i}: View {
    var body: some View {
        VStack(spacing: 8) {
            Text("Helper ${i}")
                .font(.body)
                .foregroundStyle(Color.blue)
            Text("Detail")
                .padding(8)
        }
        .padding()
    }
}\n`
  const source = `import SwiftUI
struct Item: Identifiable { let id: String; var title: String }
@main struct BenchmarkApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    let items: [Item] = [${records}]
    var body: some View { VStack { Text("Title"); List(items) { item in Text(item.title) } } }
}
${Array.from({ length: 160 }, (_, i) => helper(i)).join('\n')}`
  expect(source.split('\n').length).toBeGreaterThanOrEqual(2000)
  const files = [{ id: 'Sources/App.swift', text: source }]
  const snapshot = buildAuthoringModel({ projectId: 'bench', revision: 1, files })
  const node = snapshot.nodes.find(n => n.owner === 'ContentView' && n.name === 'Text')!
  const samples: number[] = [], planSamples: number[] = [], heap: number[] = []
  resetPipelineState()
  for (let i = 0; i < 105; i++) {
    const start = performance.now()
    const plan = planDesignEdit({ projectId: 'bench', baseRevision: i, scope: node.owner, files, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'property', control: 'content', value: `Title ${i}` } })
    const planned = performance.now()
    if (!plan.ok) throw new Error(plan.reason)
    const result = compile({ projectId: 'bench', files: [{ ...files[0]!, text: plan.changes[0]!.after }], revision: i, canvas: { width: 393, height: 852 }, colorScheme: 'light' })
    const elapsed = performance.now() - start
    expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    if (i >= 5) { samples.push(elapsed); planSamples.push(planned - start) }
    if (i % 10 === 4) heap.push(process.memoryUsage().heapUsed)
  }
  const percentile = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!
  const report = { measurement: 'headless source planning and worker pipeline; excludes browser IPC, DOM, paint, and input latency', samples: samples.length, warmups: 5, lines: source.split('\n').length, records: 100, p95ms: percentile(samples), planP95ms: percentile(planSamples), rawMs: samples, heapSamplesBytes: heap, heapInterpretation: 'Uncontrolled-GC samples for investigation only; not evidence of browser leak freedom.' }
  console.log(JSON.stringify({ ...report, rawMs: undefined, heapSamplesBytes: undefined }))
  if (process.env.AUTHORING_RELEASE_METRICS) writeFileSync(process.env.AUTHORING_RELEASE_METRICS, JSON.stringify(report, null, 2))
  expect(report.p95ms).toBeLessThan(500)
}, 60_000)
