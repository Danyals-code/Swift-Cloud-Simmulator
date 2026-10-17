import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { fontAsset, type Project } from '@studio/project-model'
import { createDefaultProject } from '@studio/project-model/templates'
import { exportArchive, exportProjectZip } from './index'

/**
 * Does an exported app find its own font (Wave 6f)? The Xcode project is built, its
 * merged Info.plist read, and the app run on a scratch iOS 27 simulator, where it prints
 * what `UIFont(name:)` finds and how tall SwiftUI draws a line of it, then quits:
 *
 *     XCODE_BUILD=1 CI=true npx vitest run packages/exporter/src/fonts-xcode.test.ts
 *
 * Geist Regular is SIL OFL 1.1. The device is made for the test and deleted after it.
 */
const enabled = process.env.XCODE_BUILD === '1'
const GEIST = new Uint8Array(readFileSync(new URL('../../../e2e/fixtures/Geist-Regular.ttf', import.meta.url)))

const HOME = `import SwiftUI
import UIKit

struct HomeScreen: View {
    var body: some View {
        VStack(spacing: 0) {
            Text("Geist")
                .font(.custom("Geist-Regular", size: 17, relativeTo: .body))
                .background(GeometryReader { proxy in
                    Color.clear.onAppear { report("text", "\\(proxy.size.height)") }
                })
            Text("Geist")
                .font(.custom("Geist", size: 17))
                .background(GeometryReader { proxy in
                    Color.clear.onAppear { report("family-text", "\\(proxy.size.height)") }
                })
        }
        .onAppear {
            let face = UIFont(name: "Geist-Regular", size: 17)
            report("postscript", face?.fontName ?? "nil")
            report("family", face?.familyName ?? "nil")
            report("metrics", "\\(face?.lineHeight ?? 0) \\(face?.ascender ?? 0) \\(face?.descender ?? 0) \\(face?.leading ?? 0)")
            report("by-family", UIFont(name: "Geist", size: 17)?.fontName ?? "nil")
            report("faces", UIFont.fontNames(forFamilyName: "Geist").joined(separator: ","))
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { exit(0) }
        }
    }
}

private func report(_ key: String, _ value: String) {
    print("FONT \\(key)=\\(value)")
    fflush(stdout)
}
`

const run = (command: string, args: readonly string[], timeout = 300_000) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout })

describe.skipIf(!enabled)('an exported app finds its font with UIFont(name:)', () => {
  it('bundles Geist, merges UIAppFonts into the generated Info.plist, and draws with it on iOS 27', () => {
    const base = createDefaultProject(0)
    const project: Project = {
      ...base, manifest: { ...base.manifest, name: 'Café & Co' }, fonts: [fontAsset('geist', GEIST)],
      files: base.files.map(file => file.id.endsWith('HomeScreen.swift') ? { ...file, text: HOME } : file),
    }
    const archive = exportArchive(project, { format: 'xcodeproj', now: new Date(2026, 9, 17) })
    expect(archive.issues).toEqual([])

    const root = mkdtempSync(join(tmpdir(), 'studio-fonts-'))
    let device = ''
    try {
      for (const [path, bytes] of Object.entries(unzipSync(archive.bytes))) {
        mkdirSync(join(root, path, '..'), { recursive: true })
        writeFileSync(join(root, path), bytes)
      }
      const build = run('xcodebuild', ['-project', join(root, 'Café & Co/Café & Co.xcodeproj'), '-scheme', 'Café & Co', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', join(root, 'DerivedData'), 'build'])
      expect(build).toContain('BUILD SUCCEEDED')
      expect(build.split('\n').filter(line => /warning: .*deprecated/.test(line))).toEqual([])

      const app = join(root, 'DerivedData/Build/Products/Debug-iphonesimulator/Café & Co.app')
      expect(existsSync(join(app, 'Geist-Regular.ttf'))).toBe(true)
      const plist = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', join(app, 'Info.plist')])) as Record<string, unknown>
      expect(plist.UIAppFonts).toEqual(['Geist-Regular.ttf'])
      // Merged, not replaced: what Xcode generates is still there.
      expect(plist).toMatchObject({ CFBundleIdentifier: 'com.example.Cafe-Co', UILaunchScreen: {}, UIApplicationSupportsIndirectInputEvents: true })
      expect(plist.UIApplicationSceneManifest).toBeTruthy()

      device = run('xcrun', ['simctl', 'create', '6f capture', 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro', 'com.apple.CoreSimulator.SimRuntime.iOS-27-0']).trim()
      run('xcrun', ['simctl', 'boot', device])
      run('xcrun', ['simctl', 'bootstatus', device, '-b'])
      run('xcrun', ['simctl', 'install', device, app])
      const output = run('xcrun', ['simctl', 'launch', '--console', '--terminate-running-process', device, 'com.example.Cafe-Co'], 120_000)
      const found = Object.fromEntries(output.split('\n').filter(line => line.startsWith('FONT ')).map(line => line.slice(5).split('=') as [string, string]))
      // The family name finds the face too, and a line is hhea's ascender less its descender
      // (1300 of 1000 units at 17 pt is 22.1), which SwiftUI rounds up to the 1/3 pt grid.
      expect(found).toEqual({
        postscript: 'Geist-Regular', family: 'Geist', faces: 'Geist-Regular', 'by-family': 'Geist-Regular',
        metrics: '22.1 17.085 -5.015000000000001 0.0', text: '22.333333333333332', 'family-text': '22.333333333333332',
      })
    } finally {
      if (device) {
        try { run('xcrun', ['simctl', 'shutdown', device]) } catch { /* already shut down */ }
        run('xcrun', ['simctl', 'delete', device])
      }
      rmSync(root, { recursive: true, force: true })
    }
  }, 600_000)

  it('the package README’s registration code builds against the package’s own resources', () => {
    const base = createDefaultProject(0)
    const project: Project = { ...base, manifest: { ...base.manifest, name: 'FontKit' }, fonts: [fontAsset('geist', GEIST)] }
    const entries = unzipSync(exportProjectZip(project, 'spm'))
    const readme = new TextDecoder().decode(entries['FontKit/README.md']!)
    const snippet = /```swift\nimport CoreText\n\n([\s\S]*?)```/.exec(readme)![1]!
    const root = mkdtempSync(join(tmpdir(), 'studio-fonts-spm-'))
    try {
      for (const [path, bytes] of Object.entries(unzipSync(exportProjectZip({ ...project, files: [...project.files, { id: 'Sources/FontRegistration.swift', text: `import CoreText\nimport Foundation\n\npublic func registerFonts() {\n${snippet}}\n` }] }, 'spm')))) {
        mkdirSync(join(root, path, '..'), { recursive: true })
        writeFileSync(join(root, path), bytes)
      }
      const build = execFileSync('xcodebuild', ['-scheme', 'FontKit', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', join(root, 'DerivedData'), 'build'], { cwd: join(root, 'FontKit'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 })
      expect(build).toContain('BUILD SUCCEEDED')
      expect(build.split('\n').filter(line => /warning: .*deprecated/.test(line))).toEqual([])
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 300_000)
})
