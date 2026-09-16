import { expect, it } from 'vitest'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectFromFiles } from '@studio/project-model'
import { buildExportBundle } from '@studio/exporter'

it('exports the same comparison source in an iOS 27 Xcode project', () => {
  const source = readFileSync(new URL('./fixtures/ios27-screens.swift', import.meta.url), 'utf8')
  const project = projectFromFiles([{ name: 'ScreenComparison.swift', text: source }], 0)!
  const bundle = buildExportBundle({ ...project, manifest: { ...project.manifest, deploymentTarget: '27.0' } })
  const files = [...bundle].map(([path, bytes]) => [path, new TextDecoder().decode(bytes)] as const)
  expect(files.find(([path]) => path.endsWith('/ScreenComparison.swift'))?.[1]).toBe(source)
  expect(files.find(([path]) => path.endsWith('/project.pbxproj'))?.[1]).toContain('IPHONEOS_DEPLOYMENT_TARGET = 27.0')
  if (process.env.WRITE_IOS27_EXPORT) {
    for (const [path, bytes] of bundle) {
      const target = join(process.env.WRITE_IOS27_EXPORT, path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, bytes)
    }
  }
})
