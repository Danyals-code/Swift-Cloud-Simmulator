import { describe, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'
import { applyRepair, REPAIR_PROMPT, repairable, repairInput, repairProblems } from './repair'
import type { GeneratedApp } from './schema'
import { issueText, previewIssues, type PreviewIssue } from './validate'

const device = DEVICES['iphone-15']
const ENTRY = 'Sources/HeritageApp.swift'
const SHEET = 'Sources/Features/AddSiteView.swift'
const entry = String.raw`import SwiftUI
@main struct HeritageApp: App { var body: some Scene { WindowGroup { HomeView() } } }
struct HomeView: View {
    @State private var adding = false
    var body: some View {
        NavigationStack {
            List { Button("Add site") { adding = true } }
                .navigationTitle("Sites")
                .sheet(isPresented: $adding) { AddSiteView() }
        }
    }
}`
const broken = String.raw`import SwiftUI
struct AddSiteView: View {
    let regions = ["North": 2, "South": 1]
    var body: some View {
        Text("First region: \(regions.first?.key ?? "")")
    }
}`
const fixed = String.raw`import SwiftUI
struct AddSiteView: View {
    let regions = ["North": 2, "South": 1]
    var body: some View {
        Text("First region: \(regions.keys.sorted().first ?? "")")
    }
}`
const app = (sheet = broken): GeneratedApp => ({ name: 'HeritageApp', summary: 'Heritage sites.', pages: [{ title: 'Sites', file: ENTRY }], files: [{ path: ENTRY, code: entry }, { path: SHEET, code: sheet }] })

function check(draft: GeneratedApp): PreviewIssue[] {
  resetPipelineState()
  const result = compile({ files: draft.files.map(f => ({ id: f.path, text: f.code })), canvas: { width: device.width, height: device.height }, safeArea: device.safeArea, colorScheme: 'light', revision: 1, allPages: true })
  return previewIssues(result, draft.files)
}

describe('the preview check of a generated draft', () => {
  it('reports a sheet that fails to build, at its file and line, which the first screen alone never shows', () => {
    const issues = check(app())
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ severity: 'error', file: SHEET, line: 5 })
    expect(issueText(issues[0]!)).toBe("Features/AddSiteView.swift:5 · Swift runtime failure: Value of type 'Dictionary' has no member 'first' (opening the sheet “Sheet”)")
    expect(repairable(issues)).toBe(true)
  })

  it('passes once the sheet is fixed', () => {
    expect(check(app(fixed))).toEqual([])
  })
})

describe('a repair request', () => {
  const issues: PreviewIssue[] = [
    { severity: 'warning', message: 'Some views are not supported by this preview.' },
    { severity: 'error', file: SHEET, line: 5, message: "Value of type 'Dictionary' has no member 'first'" },
  ]

  it('sends the files, the errors first with their lines, and the brief the draft came from', () => {
    const input = repairInput(app(), issues, { provider: 'anthropic', model: 'claude-opus-5-5' }, [
      { id: '1', role: 'user', content: 'A guide to heritage sites.', createdAt: 1, provider: 'anthropic', model: 'claude-opus-5-5', kind: 'create' },
      { id: '2', role: 'assistant', content: 'Heritage sites.', createdAt: 2, provider: 'anthropic', model: 'claude-opus-5-5', kind: 'create', status: 'applied' },
    ])
    expect(input.prompt).toBe(REPAIR_PROMPT)
    expect(input.files.map(f => f.id)).toEqual([ENTRY, SHEET])
    expect(input.previewProblems[0]).toEqual({ severity: 'error', file: SHEET, message: "line 5: Value of type 'Dictionary' has no member 'first'" })
    expect(input.history.map(m => m.content)).toEqual(['A guide to heritage sites.', 'Heritage sites.'])
  })

  it('has nothing to repair when the draft only has notes', () => {
    expect(repairable(issues.slice(0, 1))).toBe(false)
    expect(repairProblems(issues).map(p => p.severity)).toEqual(['error', 'warning'])
  })
})

describe('applying a repair', () => {
  it('changes only the files it names, and the result passes the check', () => {
    const result = applyRepair(app(), { reply: 'Read the first region from sorted keys.', files: [{ path: SHEET, code: fixed }], deletedFiles: [] })
    expect(result.changed).toEqual([SHEET])
    expect(result.app.files.find(f => f.path === ENTRY)?.code).toBe(entry)
    expect(result.app.files.find(f => f.path === SHEET)?.code).toBe(fixed)
    expect(check(result.app)).toEqual([])
  })

  it('refuses a repair that leaves the draft without its entry point', () => {
    expect(() => applyRepair(app(), { reply: 'Removed it.', files: [], deletedFiles: [ENTRY] })).toThrow(/entry point|page/)
  })

  it('refuses a repair that is not a valid edit', () => {
    expect(() => applyRepair(app(), { reply: '', files: [], deletedFiles: [] })).toThrow()
  })
})
