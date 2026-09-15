import { deflateSync, inflateSync } from 'fflate'
import type { SourceFile } from '@studio/shared'
import type { Project, ProjectManifest } from './types'

/**
 * Share links that carry the whole project in the URL.
 *
 * The decision this rests on is the one recorded against the roadmap: **local-only
 * storage, no `/api/share`, no database, no accounts.** A link that needs a server is
 * a link that needs an owner, a retention policy and a bill; a link that carries its
 * own payload needs none of those and cannot rot.
 *
 * The cost is a length limit, and it is the honest kind: it is knowable in advance and
 * reported before the link is made rather than after it is pasted. `encodeProject`
 * returns null when a project will not fit, and the caller says so.
 *
 * The payload is *not* the `Project` object. Ids and timestamps belong to whoever
 * opens the link, not to whoever made it - carrying them would mean a shared project
 * claiming to have been created on someone else's clock, and two people opening the
 * same link would collide on the same id.
 */

/**
 * The practical ceiling for a URL.
 *
 * Browsers handle far more, but the limit that actually bites is somewhere else
 * entirely: chat clients, mail clients and issue trackers wrap or truncate long links,
 * and a link that arrives broken is worse than one that was never offered. 8 KB of
 * encoded payload keeps a substantial multi-file project inside what those survive.
 */
export const MAX_SHARE_LENGTH = 8192

/** Bumped only if the payload shape changes in a way an older reader would misread. */
const FORMAT_VERSION = 1

interface SharePayload {
  readonly v: number
  readonly n: string
  readonly b: string
  readonly d: string
  readonly t: string
  readonly f: readonly { readonly i: string; readonly t: string }[]
  /**
   * Groups that hold nothing, which no file's path can imply.
   *
   * Optional, and absent whenever there are none - which is almost always, so the
   * common link does not grow by a byte. An older reader ignores the key and loses
   * only the empty groups; that is a smaller loss than a version bump, which would
   * make every existing link stop opening.
   */
  readonly g?: readonly string[]
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded: string): Uint8Array | null {
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/**
 * Encodes a project for a URL fragment, or null when it will not fit.
 *
 * Level 9 rather than the exporter's 6: this runs once when a link is made, never in a
 * render path, and every byte saved here is a byte of link a chat client cannot break.
 */
export function encodeProject(project: Project): string | null {
  const payload: SharePayload = {
    v: FORMAT_VERSION,
    n: project.manifest.name,
    b: project.manifest.bundleId,
    d: project.manifest.deploymentTarget,
    t: project.manifest.device,
    f: project.files.map((file) => ({ i: file.id, t: file.text })),
    ...(project.folders?.length ? { g: [...project.folders] } : {}),
  }

  const json = new TextEncoder().encode(JSON.stringify(payload))
  const encoded = toBase64Url(deflateSync(json, { level: 9 }))
  return encoded.length > MAX_SHARE_LENGTH ? null : encoded
}

/**
 * Decodes a shared project, or null if the payload is not one.
 *
 * Every failure mode returns null rather than throwing: the input is a URL a stranger
 * pasted, so truncation, a stale format and outright nonsense are all ordinary. The
 * caller's job is to fall back to the local project, not to handle an exception.
 */
export function decodeProject(encoded: string, now: number): Project | null {
  const bytes = fromBase64Url(encoded)
  if (!bytes) return null

  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder().decode(inflateSync(bytes)))
  } catch {
    return null
  }

  if (!isSharePayload(payload)) return null

  const manifest: ProjectManifest = {
    name: payload.n,
    bundleId: payload.b,
    deploymentTarget: payload.d,
    device: payload.t as ProjectManifest['device'],
    colorScheme: 'light',
  }

  const files: SourceFile[] = payload.f.map((file) => ({ id: file.i, text: file.t }))
  const folders = (payload.g ?? []).filter((folder) => typeof folder === 'string')

  return {
    // The id and the timestamps are the opener's, not the sharer's: two people opening
    // the same link must not collide, and a project cannot have been created on
    // somebody else's clock.
    id: 'shared-project',
    manifest,
    files,
    ...(folders.length > 0 ? { folders } : {}),
    createdAt: now,
    updatedAt: now,
  }
}

function isSharePayload(value: unknown): value is SharePayload {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Partial<SharePayload>
  return (
    p.v === FORMAT_VERSION &&
    typeof p.n === 'string' &&
    typeof p.b === 'string' &&
    typeof p.d === 'string' &&
    typeof p.t === 'string' &&
    Array.isArray(p.f) &&
    p.f.length > 0 &&
    p.f.every((f) => typeof f?.i === 'string' && typeof f?.t === 'string') &&
    (p.g === undefined || Array.isArray(p.g))
  )
}

/** The fragment a share link carries, e.g. `#p=…`. */
export function shareFragment(encoded: string): string {
  return `#p=${encoded}`
}

/** Reads the payload out of a fragment, or null when there is none. */
export function payloadFromFragment(fragment: string): string | null {
  const match = /[#&]p=([A-Za-z0-9_-]+)/.exec(fragment)
  return match?.[1] ?? null
}

/** The whole link, for a given origin and path. */
export function shareLink(origin: string, path: string, encoded: string): string {
  return `${origin}${path}${shareFragment(encoded)}`
}
