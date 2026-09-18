import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectFromFiles } from '@studio/project-model'
import { parsePlist } from '@studio/exporter'
import { AUTHORING_CAPABILITIES } from '@studio/shared'
import { nativeAuthoringProject } from './helpers/native-authoring-project'

it('packages the exact reference source with an independent native UI-test target', () => {
  const source = readFileSync(new URL('./fixtures/authoring-core.swift', import.meta.url), 'utf8')
  const uiTests = readFileSync(new URL('./fixtures/AuthoringUITests.swift', import.meta.url), 'utf8')
  const initial = projectFromFiles([{ name: 'Authoring.swift', text: source }], 0)!
  const project = { ...initial, manifest: { ...initial.manifest, name: 'AuthoringReference', bundleId: 'com.studio.authoring.reference', deploymentTarget: '27.0' } }
  const bundle = nativeAuthoringProject(project, uiTests)
  expect(new TextDecoder().decode(bundle.get('AuthoringReference/AuthoringReference/Authoring.swift'))).toBe(source)
  const pbx = parsePlist(new TextDecoder().decode(bundle.get('AuthoringReference/AuthoringReference.xcodeproj/project.pbxproj')))
  expect(JSON.stringify(pbx)).toContain('com.apple.product-type.bundle.ui-testing')
  expect(JSON.stringify(pbx)).toContain('TEST_TARGET_NAME')
  expect(bundle.has('AuthoringReference/AuthoringReference.xcodeproj/xcshareddata/xcschemes/AuthoringVerification.xcscheme')).toBe(true)
  const output = process.env.AUTHORING_EXPORT_DIR
  if (output) {
    for (const [path, bytes] of bundle) { const target = join(output, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes) }
    writeFileSync(join(output, 'manifest.json'), JSON.stringify({ sourceSHA256: createHash('sha256').update(source).digest('hex'), fixture: 'authoring-core', project: 'AuthoringReference/AuthoringReference.xcodeproj', scheme: 'AuthoringVerification', capabilities: AUTHORING_CAPABILITIES, files: [...bundle].map(([path, bytes]) => ({ path, sha256: createHash('sha256').update(bytes).digest('hex') })) }, null, 2))
  }
})
