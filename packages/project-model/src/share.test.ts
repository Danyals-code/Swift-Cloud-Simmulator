import { deflateSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  createProjectFromTemplate,
  decodeProject,
  encodeProject,
  MAX_SHARE_LENGTH,
  payloadFromFragment,
  shareFragment,
  shareLink,
  TEMPLATES,
} from './index'
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
   * The threshold used to be half the budget, which was the right number while
   * every template was one small file. `Trailhead` is eight files and uses about
   * three quarters of it - legitimately, because showing a project with structure
   * is the entire point of it - so the rule is stated as headroom rather than as a
   * fraction that happened to fit.
   *
   * 20% of 8 KB is roughly 1,600 characters of encoded payload, which is a few
   * hundred lines of Swift once deflated: enough to work on a shared copy before
   * the studio starts declining to make a link. Past that the failure is reported
   * rather than silent - `encodeProject` returns null and the Share button says so -
   * so this gate is about the experience being decent, not about avoiding a
   * broken link.
   */
  const HEADROOM = 0.2

  it('keeps every template shareable, with room left to edit it', () => {
    for (const template of TEMPLATES) {
      const encoded = encodeProject(createProjectFromTemplate(template, 0))!
      const used = Math.round((encoded.length / MAX_SHARE_LENGTH) * 100)

      expect(
        encoded.length,
        `${template.name} uses ${used}% of the share budget (${encoded.length} chars)`,
      ).toBeLessThan(MAX_SHARE_LENGTH * (1 - HEADROOM))
    }
  })

  it('keeps a single-file template well inside it', () => {
    // The original rule, kept for the templates it was written for: one file
    // teaching one idea has no business using half a share link.
    for (const template of TEMPLATES.filter((t) => t.files.length === 1)) {
      const encoded = encodeProject(createProjectFromTemplate(template, 0))!
      expect(encoded.length, `${template.name} is ${encoded.length} chars`).toBeLessThan(
        MAX_SHARE_LENGTH / 2,
      )
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
