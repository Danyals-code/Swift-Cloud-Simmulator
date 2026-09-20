import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { exportProjectZip } from '@studio/exporter'
import { TEMPLATES, createProjectFromTemplate } from '@studio/project-model/templates'

/**
 * Does the exported project actually build in Xcode?
 *
 * The browser interprets a SwiftUI subset, so it accepts Swift that Xcode refuses -
 * `Section(_:content:footer:)`, which SwiftUI has no overload for, sat in five
 * starters for months and compiled here every time. This is the only check that
 * catches that class of defect, and it needs a Mac with Xcode, so it is opt-in:
 *
 *     XCODE_BUILD=1 npx vitest run tests/xcode-build.test.ts
 *     XCODE_BUILD=1 XCODE_TEMPLATES=folio,inbox npx vitest run tests/xcode-build.test.ts
 *
 * About 15 seconds per template, so the whole corpus is a coffee rather than a CI
 * step. Run it whenever a template's Swift changes.
 */

const enabled = process.env.XCODE_BUILD === '1'
const only = (process.env.XCODE_TEMPLATES ?? '').split(',').filter(Boolean)
const templates = TEMPLATES.filter(template => !only.length || only.includes(template.id))

describe.skipIf(!enabled)('every template builds with xcodebuild', () => {
  it.each(templates.map(template => [template.id] as const))('%s', id => {
    const template = TEMPLATES.find(item => item.id === id)!
    const root = mkdtempSync(join(tmpdir(), `studio-xcode-${id}-`))
    try {
      let project = ''
      for (const [path, bytes] of Object.entries(unzipSync(exportProjectZip(createProjectFromTemplate(template), 'xcodeproj')))) {
        const full = join(root, path)
        mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true })
        writeFileSync(full, bytes)
        if (path.endsWith('.pbxproj')) project = join(root, path.slice(0, path.indexOf('.xcodeproj') + '.xcodeproj'.length))
      }
      expect(project, 'exported an Xcode project').not.toBe('')
      const scheme = project.slice(project.lastIndexOf('/') + 1, -'.xcodeproj'.length)
      const output = execFileSync('xcodebuild', [
        '-project', project, '-scheme', scheme,
        '-destination', 'generic/platform=iOS Simulator',
        '-derivedDataPath', join(root, 'DerivedData'), 'build',
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 })
      expect(output).toContain('BUILD SUCCEEDED')
    } catch (error) {
      const output = `${(error as { stdout?: string }).stdout ?? ''}${(error as { stderr?: string }).stderr ?? ''}`
      const errors = output.split('\n').filter(line => line.includes('error:')).slice(0, 8).join('\n')
      throw new Error(`${id} does not build in Xcode:\n${errors || (error as Error).message}`)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 300_000)
})
