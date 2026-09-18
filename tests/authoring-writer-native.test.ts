import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { projectFromFiles } from '@studio/project-model'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { nativeAuthoringProject } from './helpers/native-authoring-project'

it('exports the actual writer-produced card for independent native build and action checks', () => {
  let source = `import SwiftUI
@main struct WriterReferenceApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    @State private var count = 0
    var body: some View {
        VStack(spacing: 12) {
            Text("Card")
            Text("Count \\(count)").accessibilityIdentifier("count")
            Button("Increment") { count += 1 }.accessibilityIdentifier("increment")
        }
    }
}`
  const edits = [['Text', 'Designer card'], ['Font size', '24'], ['Padding', '16'], ['Background', 'blue'], ['Corner radius', '12'], ['Accessibility identifier', 'card-title']] as const
  for (const [index, [label, value]] of edits.entries()) {
    const files = [{ id: 'Sources/Writer.swift', text: source }]
    const node = buildAuthoringModel({ projectId: 'writer', revision: index, files }).nodes.find(n => n.name === 'Text')!
    const control = node.controls!.find(c => c.label === label)!
    const plan = planDesignEdit({ projectId: 'writer', baseRevision: index, scope: node.owner, files, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'property', control: control.id, value } })
    if (!plan.ok) throw new Error(plan.reason)
    source = plan.changes[0]!.after
  }
  resetPipelineState()
  const result = compile({ files: [{ id: 'Writer.swift', text: source }], canvas: { width: 393, height: 852 }, colorScheme: 'light', revision: 1 })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  expect(result.renderTree!.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? [])).toContain('Designer card')
  const initial = projectFromFiles([{ name: 'Writer.swift', text: source }])!
  const project = { ...initial, manifest: { ...initial.manifest, name: 'WriterReference', deploymentTarget: '27.0' } }
  const uiTests = `import XCTest
final class AuthoringUITests: XCTestCase {
    func testEditedCardAndPreservedAction() throws {
        let app = XCUIApplication()
        app.launch()
        let title = app.staticTexts["card-title"]
        XCTAssertTrue(title.waitForExistence(timeout: 15))
        XCTAssertEqual(title.label, "Designer card")
        XCTAssertEqual(app.staticTexts["count"].label, "Count 0")
        for index in 0..<5 {
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "writer-card-\\(index)"
            capture.lifetime = .keepAlways
            add(capture)
        }
        app.buttons["increment"].tap()
        XCTAssertEqual(app.staticTexts["count"].label, "Count 1")
    }
}`
  const bundle = nativeAuthoringProject(project, uiTests)
  const exported = [...bundle].find(([path]) => path.endsWith('/Writer.swift'))!
  expect(new TextDecoder().decode(exported[1])).toBe(source)
  const output = process.env.AUTHORING_WRITER_EXPORT_DIR
  if (output) {
    for (const [path, bytes] of bundle) { const file = join(output, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes) }
    writeFileSync(join(output, 'writer-manifest.json'), JSON.stringify({ sourceSHA256: createHash('sha256').update(source).digest('hex'), edits, project: 'WriterReference/WriterReference.xcodeproj', scheme: 'AuthoringVerification', nativeBuild: 'pending', nativeUI: 'pending' }, null, 2))
  }
})
