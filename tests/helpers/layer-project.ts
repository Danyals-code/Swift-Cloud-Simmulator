import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { compile } from '@studio/swiftui-runtime'
import type { AuthoringNode, CompileRequest, CompileResult, DesignEditPlan, DesignEditRequest, LayerChange, LayerProperties, SourceFile } from '@studio/shared'

/**
 * A one-screen project for the layer tests, read and changed the way the panel does:
 * through the authoring model and the edit planner, never through the layer module.
 */

export const APP = 'Sources/App.swift'

export const screen = (body: string, declarations = '') => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    var body: some View {
${body}
    }
}
${declarations}`

export const project = (text: string): SourceFile[] => [{ id: APP, text }]
export const text = (files: readonly SourceFile[]) => files.find(file => file.id === APP)!.text

/** The `index`th view called `name`, as the panel receives it. */
export function node(files: readonly SourceFile[], name: string, index = 0, deploymentTarget?: string): AuthoringNode {
  const found = buildAuthoringModel({ projectId: 'layer', revision: 1, files: [...files], deploymentTarget }).nodes.filter(n => n.name === name && n.kind !== 'definition' && n.kind !== 'branch')[index]
  if (!found) throw new Error(`No view called ${name} at ${index}`)
  return found
}

export function layerOf(files: readonly SourceFile[], name: string, index = 0, deploymentTarget?: string): LayerProperties {
  const layer = node(files, name, index, deploymentTarget).layer
  if (!layer) throw new Error(`${name} has no layer`)
  return layer
}

export function planLayer(files: readonly SourceFile[], name: string, changes: readonly LayerChange[], index = 0, deploymentTarget?: string): DesignEditPlan {
  const target = node(files, name, index, deploymentTarget)
  return planDesignEdit({ projectId: 'layer', baseRevision: 1, files: [...files], scope: target.owner, target: target.source, fingerprint: target.fingerprint, deploymentTarget, operation: { kind: 'layer-set', changes } })
}

/** The project after a layer change; throws with the planner's reason when it refuses. */
export function setLayer(files: readonly SourceFile[], name: string, changes: readonly LayerChange[], index = 0, deploymentTarget?: string): SourceFile[] {
  const plan = planLayer(files, name, changes, index, deploymentTarget)
  if (!plan.ok) throw new Error(plan.reason)
  return files.map(file => ({ ...file, text: plan.changes.find(change => change.file === file.id)?.after ?? file.text }))
}

/** The Swift a node was read from. */
export const writtenAs = (source: string, node: Pick<AuthoringNode, 'source'>) => source.slice(node.source.start, node.source.end)

/** The view of a one-screen project written exactly as `view`, as the panel receives it: none of the definitions or slots around views. */
export function viewWritten(source: string, view: string, deploymentTarget?: string): AuthoringNode {
  const found = buildAuthoringModel({ projectId: 'layer', revision: 1, files: project(source), deploymentTarget }).nodes.find(n => n.kind !== 'definition' && n.kind !== 'branch' && writtenAs(source, n) === view)
  if (!found) throw new Error(`No view written as ${view}`)
  return found
}

/**
 * What the planner makes of one request on the view of a one-screen project written as
 * `view`: the screen's file after it, or the reason it was refused.
 */
export function editWritten(source: string, view: string, operation: DesignEditRequest['operation'], deploymentTarget?: string): { text: string } | { refused: string } {
  const target = viewWritten(source, view, deploymentTarget)
  const plan = planDesignEdit({ projectId: 'layer', baseRevision: 1, files: project(source), scope: target.owner, target: target.source, fingerprint: target.fingerprint, deploymentTarget, operation })
  return plan.ok ? { text: plan.changes.find(change => change.file === APP)?.after ?? source } : { refused: plan.reason }
}

/** The preview's compile of a project, drawn on an iPhone's canvas with no safe area; `options` adds to the request. */
export function draw(files: readonly SourceFile[], options: Partial<CompileRequest> = {}): CompileResult {
  return compile({ files: [...files], revision: 1, canvas: { width: 393, height: 852 }, colorScheme: 'light', safeArea: { top: 0, bottom: 0, leading: 0, trailing: 0 }, ...options })
}

/** The written view, as a body line: what `screen` put there after the change. */
export function bodyOf(files: readonly SourceFile[]): string {
  const source = text(files)
  const start = source.indexOf('    var body: some View {\n', source.indexOf('struct ContentView')) + '    var body: some View {\n'.length
  return source.slice(start, source.indexOf('\n    }\n}\n', start))
}

export const XCODE = process.env.XCODE_BUILD === '1'

/**
 * Type-checks each source in Xcode 27's iOS simulator SDK, deployment target iOS 27
 * unless one says otherwise with a `// target: iOS 17` line. Opt-in, as
 * `tests/xcode-build.test.ts` is: `XCODE_BUILD=1 npx vitest run tests/layer-…`.
 */
export function typecheckInXcode(sources: readonly string[]): void {
  const root = mkdtempSync(join(tmpdir(), 'studio-layer-'))
  try {
    const sdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], { encoding: 'utf8' }).trim()
    for (const [index, source] of sources.entries()) {
      const target = /^\/\/ target: iOS (\d+(?:\.\d+)?)$/m.exec(source)?.[1] ?? '27.0'
      const file = join(root, `Layer${index}.swift`)
      // An app's own entry point is iOS 14's; below it the views are checked on their own.
      writeFileSync(file, Number(target) < 14 ? source.replace(/@main\nstruct DemoApp: App \{[\s\S]*?\n\}\n/, '') : source)
      try {
        execFileSync('xcrun', ['--sdk', 'iphonesimulator', 'swiftc', '-typecheck', '-parse-as-library', '-warnings-as-errors', '-sdk', sdk, '-target', `arm64-apple-ios${target}-simulator`, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (error) {
        const output = (error as { stderr?: string }).stderr ?? String(error)
        throw new Error(`Xcode refused form ${index}:\n${source}\n${output}`)
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}
