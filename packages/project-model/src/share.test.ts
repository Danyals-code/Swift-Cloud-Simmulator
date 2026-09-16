import { deflateSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  decodeProject,
  encodeProject,
  MAX_SHARE_LENGTH,
  payloadFromFragment,
  shareFragment,
  shareLink,
  type TemplateKind,
} from './index'
import { createProjectFromTemplate, TEMPLATES } from './templates'
import type { Project } from './types'

/**
 * Share links - Phase 9c.
 *
 * Half of these are about malformed input, and that is the right proportion: the
 * payload arrives from a URL a stranger pasted, so truncation, a stale format and
 * outright nonsense are the ordinary cases rather than the exotic ones. Every one of
 * them has to produce null and let the caller fall back, not throw into a render.
 */

const project = createProjectFromTemplate(TEMPLATES[0]!, 1_000)

describe('round trip', () => {
  it.each(TEMPLATES)('carries $name back byte for byte', (template) => {
    const original = createProjectFromTemplate(template, 1_000)
    const encoded = encodeProject(original)
    expect(encoded, `${template.name} does not fit in a link`).not.toBeNull()

    const decoded = decodeProject(encoded!, 2_000)!
    expect(decoded.files.map((f) => f.text)).toEqual(original.files.map((f) => f.text))
    expect(decoded.files.map((f) => f.id)).toEqual(original.files.map((f) => f.id))
  })

  it('carries the manifest the sharer chose', () => {
    const decoded = decodeProject(encodeProject(project)!, 2_000)!
    expect(decoded.manifest.name).toBe(project.manifest.name)
    expect(decoded.manifest.bundleId).toBe(project.manifest.bundleId)
    expect(decoded.manifest.deploymentTarget).toBe(project.manifest.deploymentTarget)
    expect(decoded.manifest.device).toBe(project.manifest.device)
  })

  it('gives the opener their own timestamps, not the sharer’s', () => {
    // A project cannot have been created on somebody else's clock, and two people
    // opening the same link must not collide on an id.
    const decoded = decodeProject(encodeProject(project)!, 9_999)!
    expect(decoded.createdAt).toBe(9_999)
    expect(decoded.updatedAt).toBe(9_999)
  })

  it('survives a multi-file project', () => {
    const many: Project = {
      ...project,
      files: [
        { id: 'Sources/App.swift', text: project.files[0]!.text },
        { id: 'Sources/Models.swift', text: 'struct Item { let id: Int }\n' },
        { id: 'Sources/Views.swift', text: 'struct Row: View { var body: some View { Text("r") } }\n' },
      ],
    }
    const decoded = decodeProject(encodeProject(many)!, 2_000)!
    expect(decoded.files).toEqual(many.files)
  })

  it('survives text a URL would otherwise mangle', () => {
    // `#`, `&`, `+`, `/` and `=` are all meaningful in a URL, and all appear in
    // ordinary Swift. base64url plus a fragment is what keeps them out of the way.
    const tricky: Project = {
      ...project,
      files: [
        {
          id: 'Sources/App.swift',
          text: 'let s = "a+b/c=d&e#f"\nlet emoji = "🎉"\nlet quote = "he said \\"hi\\""\n',
        },
      ],
    }
    const decoded = decodeProject(encodeProject(tricky)!, 2_000)!
    expect(decoded.files[0]!.text).toBe(tricky.files[0]!.text)
  })
})

describe('the length limit', () => {
  /**
   * Every template has to be shareable, with room left to edit it.
   *
   * "Room to edit it" is a different number for the two kinds, and conflating them is
   * what made this rule bite the wrong thing. You edit a one-file template by writing
   * more of it, so headroom there means *doubling* room; you edit an eight-file app by
   * changing a screen, so headroom there means one screen's worth. Holding both to the
   * same fraction did not protect anybody - it just capped app templates at a size
   * that made them worse, and every character trimmed to get under it was trimmed out
   * of the explanation rather than out of the code.
   *
   * The hard limit is the same for both and is not negotiable: past `MAX_SHARE_LENGTH`
   * there is no link at all. Everything below it is about the experience being decent,
   * and the failure is reported rather than silent - `encodeProject` returns null and
   * the Share button says "Too big to link".
   */
  const HEADROOM: Readonly<Record<TemplateKind, number>> = {
    // A few hundred lines of Swift once deflated, which is more than the whole file.
    feature: 0.5,
    // One screen of an eight-file project, measured against the four that exist.
    app: 0.08,
  }

  it.each(TEMPLATES)('keeps $name shareable, with room left to edit it', (template) => {
    const encoded = encodeProject(createProjectFromTemplate(template, 0))!
    const used = Math.round((encoded.length / MAX_SHARE_LENGTH) * 100)
    const ceiling = MAX_SHARE_LENGTH * (1 - HEADROOM[template.kind])

    expect(
      encoded.length,
      `${template.name} uses ${used}% of the share budget (${encoded.length} chars), ` +
        `and a ${template.kind} template may use ${Math.round((1 - HEADROOM[template.kind]) * 100)}%`,
    ).toBeLessThan(ceiling)
  })

  it('never lets any template past the hard limit', () => {
    // The one that is not a matter of taste: past this there is no link.
    for (const template of TEMPLATES) {
      expect(encodeProject(createProjectFromTemplate(template, 0))).not.toBeNull()
    }
  })

  it('declines a project that will not fit, rather than making a broken link', () => {
    // The failure the limit exists to prevent is a link that arrives truncated, which
    // the sharer cannot see and the recipient cannot diagnose.
    const huge: Project = {
      ...project,
      files: [{ id: 'Sources/App.swift', text: randomish(400_000) }],
    }
    expect(encodeProject(huge)).toBeNull()
  })

  it('compresses repetitive Swift well enough to be worth it', () => {
    const repetitive: Project = {
      ...project,
      files: [{ id: 'Sources/App.swift', text: 'Text("hello world")\n'.repeat(400) }],
    }
    const encoded = encodeProject(repetitive)!
    expect(encoded.length).toBeLessThan(1_000)
  })
})

describe('malformed payloads', () => {
  it.each([
    ['empty', ''],
    ['not base64url', '!!!!'],
    ['base64url of nothing', 'AAAA'],
    ['truncated', encodeProject(project)!.slice(0, 40)],
    ['a valid deflate of the wrong shape', encodeJson({ hello: 'world' })],
    ['a payload from a future format', encodeJson({ v: 99, n: 'x', b: 'x', d: 'x', t: 'x', f: [] })],
    ['a payload with no files', encodeJson({ v: 1, n: 'x', b: 'x', d: 'x', t: 'x', f: [] })],
    ['a payload whose files are not files', encodeJson({ v: 1, n: 'x', b: 'x', d: 'x', t: 'x', f: [1, 2] })],
  ])('returns null for %s', (_name, payload) => {
    expect(decodeProject(payload, 0)).toBeNull()
  })
})

/**
 * A share link is a stranger's bytes: anyone can write one and the studio opens it
 * on sight. Two of its fields became paths inside the exported archive, so the
 * fixtures below are written the way an attacker would rather than the way a bug
 * would - and every one of them was a working escape before Phase 8.
 */
describe('a payload that would escape the archive', () => {
  const payload = (over: Record<string, unknown>): string =>
    encodeJson({
      v: 1,
      n: 'MyApp',
      b: 'com.example.myapp',
      d: '17.0',
      t: 'iphone-15',
      f: [{ i: 'Sources/App.swift', t: 'import SwiftUI\n' }],
      ...over,
    })

  it.each([
    ['a file id climbing out', { f: [{ i: 'Sources/../../../evil.swift', t: 'x' }] }],
    ['a file id with a bare ..', { f: [{ i: '../evil.swift', t: 'x' }] }],
    ['an absolute file id', { f: [{ i: '/etc/passwd', t: 'x' }] }],
    ['a Windows file id', { f: [{ i: 'C:\\Windows\\evil.swift', t: 'x' }] }],
    ['a backslash traversal', { f: [{ i: '..\\..\\evil.swift', t: 'x' }] }],
    ['a doubled separator', { f: [{ i: 'Sources/a//b.swift', t: 'x' }] }],
    ['an empty file id', { f: [{ i: '', t: 'x' }] }],
    ['a file id outside Sources', { f: [{ i: 'elsewhere/App.swift', t: 'x' }] }],
    ['a project name climbing out', { n: '../../evil' }],
    ['a project name with a separator', { n: 'a/b' }],
    ['a project name that is only dots', { n: '..' }],
    ['an empty project name', { n: '' }],
    ['a project name with a control character', { n: 'My\u0000App' }],
    ['a folder climbing out', { g: ['../../evil'] }],
    ['a folder outside Sources', { g: ['elsewhere'] }],
  ])('returns null for %s', (_name, over) => {
    expect(decodeProject(payload(over), 0)).toBeNull()
  })

  it('still opens the ordinary payload those are variations of', () => {
    const decoded = decodeProject(payload({}), 0)
    expect(decoded?.files.map((f) => f.id)).toEqual(['Sources/App.swift'])
    expect(decoded?.manifest.name).toBe('MyApp')
  })

  it('refuses a payload that would build an unbuildable project', () => {
    // Neither can escape the archive - the pbxproj writer quotes and escapes what it
    // writes - but a link that opens into a project Xcode refuses is still broken,
    // and the export being right is the promise the whole product rests on.
    expect(decodeProject(payload({ b: 'com.a";\n\t\tEVIL = "yes' }), 0)).toBeNull()
    expect(decodeProject(payload({ d: '17.0"; EVIL' }), 0)).toBeNull()
  })

  it('caps how many files a link may claim to carry', () => {
    // The length limit bounds the payload *compressed*, and repeated names compress
    // to almost nothing: 4000 of them fit in a link well under the limit.
    const many = Array.from({ length: 4000 }, (_, i) => ({ i: `Sources/F${i}.swift`, t: '' }))
    expect(decodeProject(payload({ f: many }), 0)).toBeNull()
  })

  it('opens a link whose device this build does not have, on the default', () => {
    // Phase 3.7's promise, kept deliberately: a device is a preview setting, and
    // throwing away someone's code over the size of the phone would be the wrong
    // trade. Everything that reaches a *path* is refused instead.
    const decoded = decodeProject(payload({ t: 'nope' }), 0)
    expect(decoded).not.toBeNull()
    expect(decoded?.manifest.device).toBe('iphone-15')
  })
})

describe('fragments', () => {
  it('round-trips through a fragment', () => {
    const encoded = encodeProject(project)!
    expect(payloadFromFragment(shareFragment(encoded))).toBe(encoded)
  })

  it('finds the payload in a link with other parameters', () => {
    const encoded = encodeProject(project)!
    expect(payloadFromFragment(`#theme=dark&p=${encoded}`)).toBe(encoded)
  })

  it('returns null when the fragment carries no project', () => {
    expect(payloadFromFragment('')).toBeNull()
    expect(payloadFromFragment('#')).toBeNull()
    expect(payloadFromFragment('#theme=dark')).toBeNull()
  })

  it('builds a link against an origin', () => {
    const encoded = encodeProject(project)!
    const link = shareLink('https://studio.example', '/', encoded)
    expect(link.startsWith('https://studio.example/#p=')).toBe(true)
    expect(payloadFromFragment(link)).toBe(encoded)
  })
})

/** Text that does not compress away, so the size limit is actually exercised. */
function randomish(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789 \n'
  let seed = 12345
  let out = ''
  while (out.length < length) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    out += alphabet[seed % alphabet.length]
  }
  return out
}

function encodeJson(value: unknown): string {
  // Mirrors `encodeProject`'s wire format so these exercise the decoder rather than
  // the base64 step.
  const bytes = deflateSync(new TextEncoder().encode(JSON.stringify(value)), { level: 9 })
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
