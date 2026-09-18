import { expect, it } from 'vitest'
import { deflateSync, zipSync } from 'fflate'
import { decodeProject, encodeProject } from '@studio/project-model'
import { createDefaultProject } from '@studio/project-model/templates'
import { readProjectArchive } from '@studio/exporter'

it('rejects excessive share payloads before parsing expanded JSON', () => {
  const source = createDefaultProject()
  const text = 'x'.repeat(3 * 1024 * 1024)
  expect(encodeProject({ ...source, files: [{ id: 'App.swift', text }] })).toBeNull()
  const encoded = Buffer.from(deflateSync(new TextEncoder().encode(JSON.stringify({ v: 1, n: 'App', b: 'com.example.app', d: '17.0', t: 'iphone16', f: [{ i: 'App.swift', t: text }] })))).toString('base64url')
  expect(encoded.length).toBeLessThan(8192)
  expect(decodeProject(encoded, 0)).toBeNull()
  expect(decodeProject('a'.repeat(8193), 0)).toBeNull()
})

it('stops expanding Swift when declared sizes lie', () => {
  const archive = zipSync({ 'App/App.swift': new Uint8Array(9 * 1024 * 1024).fill(65) })
  // The local file header's uncompressed size is not a trustworthy allocation limit.
  new DataView(archive.buffer).setUint32(22, 1, true)
  const result = readProjectArchive(archive)
  expect(result.files).toEqual([])
  expect(result.problem).toContain('more Swift')
})

it('does not inflate unrelated assets', () => {
  const archive = zipSync({ 'App/large.bin': new Uint8Array(12 * 1024 * 1024), 'App/App.swift': new TextEncoder().encode('import SwiftUI') })
  expect(readProjectArchive(archive)).toEqual({ files: [{ name: 'App.swift', text: 'import SwiftUI' }], problem: null })
})

it('rejects incomplete Swift entries instead of returning a partial project', () => {
  const archive = zipSync({ 'App/A.swift': new TextEncoder().encode('Text("A")'), 'App/B.swift': new Uint8Array(2048).fill(66) }, { level: 0 })
  expect(readProjectArchive(archive.subarray(0, 500)).problem).not.toBeNull()
})
