import { readStudioMetadata, type StudioMetadata } from './studio-metadata'
import { deflateSync, Inflate } from 'fflate'
import { newProjectId } from './open'
import { isPreviewTarget, normalizePreviewTarget, type PreviewTarget, type SourceFile } from '@studio/shared'
import { DEFAULT_DEVICE, DEVICES } from '@studio/sim-shell'
import type { Project, ProjectManifest } from './types'
import { validateColors, type ColorAsset } from './colors'
import { normalizeFileName, normalizeFolderPath, normalizeProjectName } from './types'

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
const MAX_SHARE_BYTES = 2 * 1024 * 1024

/** Bumped only if the payload shape changes in a way an older reader would misread. */
const FORMAT_VERSION = 1

/**
 * The most files a link may claim to carry.
 *
 * The length limit already bounds the payload, but it bounds it *compressed*: a few
 * hundred bytes of repeated filenames inflate into tens of thousands of entries, and
 * every one of them becomes a file in the exported archive. A ceiling here costs
 * nothing - the largest template is eight files - and removes the question.
 */
const MAX_SHARE_FILES = 256

interface SharePayload {
  readonly s?: StudioMetadata
  readonly p?: PreviewTarget
  /**
   * The appearance the project was shared in.
   *
   * Only ever written when it is dark, so the common link does not grow, and an
   * older reader that ignores the key opens in light exactly as it did before.
   */
  readonly m?: 'dark'
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
  /** Colour sets, when the project has colour tokens. A handful of hex strings each. */
  readonly c?: readonly ColorAsset[]
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
  // URL fragments are not a binary transport. Never create a link with missing images.
  if (project.assets?.length) return null
  const payload: SharePayload = {
    v: FORMAT_VERSION,
    ...(project.studio ? { s: project.studio } : {}),
    ...(project.manifest.colorScheme === 'dark' ? { m: 'dark' as const } : {}),
    p: normalizePreviewTarget(project.manifest.previewTarget),
    n: project.manifest.name,
    b: project.manifest.bundleId,
    d: project.manifest.deploymentTarget,
    t: project.manifest.device,
    f: project.files.map((file) => ({ i: file.id, t: file.text })),
    ...(project.folders?.length ? { g: [...project.folders] } : {}),
    ...(project.colors?.length ? { c: project.colors.map(color => ({ ...color })) } : {}),
  }

  const json = new TextEncoder().encode(JSON.stringify(payload))
  if (json.length > MAX_SHARE_BYTES) return null
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
  if (encoded.length > MAX_SHARE_LENGTH) return null
  const bytes = fromBase64Url(encoded)
  if (!bytes) return null

  let payload: unknown
  try {
    const chunks: Uint8Array[] = []
    let total = 0
    const inflater = new Inflate((chunk) => {
      total += chunk.length
      if (total > MAX_SHARE_BYTES) throw new Error('Shared project is too large.')
      chunks.push(chunk)
    })
    // Small compressed chunks bound each allocation before the callback checks it.
    for (let offset = 0; offset < bytes.length; offset += 256) {
      inflater.push(bytes.subarray(offset, offset + 256), offset + 256 >= bytes.length)
    }
    const expanded = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { expanded.set(chunk, offset); offset += chunk.length }
    payload = JSON.parse(new TextDecoder().decode(expanded))
  } catch {
    return null
  }

  if (!isSharePayload(payload)) return null
  if (!isSafePayload(payload)) return null
  if (payload.s !== undefined && readStudioMetadata(payload.s).status !== 'valid') return null
  if (payload.c !== undefined) { try { validateColors(payload.c) } catch { return null } }

  const manifest: ProjectManifest = {
    name: payload.n,
    bundleId: payload.b,
    deploymentTarget: payload.d,
    // Validated rather than cast. The cast was the whole of 8.3: it made a claim the
    // payload had not earned, and every reader downstream then believed it.
    device: payload.t in DEVICES ? (payload.t as ProjectManifest['device']) : DEFAULT_DEVICE,
    colorScheme: payload.m === 'dark' ? 'dark' : 'light',
    previewTarget: normalizePreviewTarget(payload.p),
  }

  const files: SourceFile[] = payload.f.map((file) => ({ id: file.i, text: file.t }))
  const folders = (payload.g ?? []).filter((folder) => typeof folder === 'string')

  return {
    // The id and the timestamps are the opener's, not the sharer's: two people opening
    // the same link must not collide, and a project cannot have been created on
    // somebody else's clock.
    id: newProjectId(),
    manifest,
    files,
    ...(payload.s ? { studio: payload.s } : {}),
    ...(payload.c?.length ? { colors: payload.c } : {}),
    ...(folders.length > 0 ? { folders } : {}),
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Whether every *value* in a decoded payload is one this project may hold.
 *
 * `isSharePayload` checks types; this checks meanings, and the difference was a
 * hole. A share link is a stranger's bytes - anyone can write one, and the studio
 * opens it on sight - and two of its fields become paths inside the exported zip.
 * A file id of `Sources/../../../evil.swift` produced the archive entry
 * `MyApp/MyApp/../../../evil.swift`, and a project name of `../../evil` escaped in
 * every entry at once, from a link 136 bytes long.
 *
 * The rule is idempotence against the normalisers the rest of the app already uses:
 * a value is safe exactly when normalising it changes nothing. That is stricter than
 * writing a second set of rules here, and it cannot drift from the first set, which
 * is what a second set would eventually do.
 *
 * Anything checked here rejects the whole link rather than being repaired. A payload
 * is machine-generated from a project that was already valid, so one that fails was
 * corrupted or tampered with - and quietly opening a *different* project from the one
 * the link names is its own small lie.
 *
 * The device is deliberately *not* checked here, and the line is worth stating. A bad
 * name or file id can put a file outside the archive, and a bad bundle identifier or
 * deployment target produces an export Xcode will not build - both are reasons to
 * refuse the link. A device is a preview setting: getting it wrong costs a frame size
 * and nothing else, and Phase 3.7 already decided such a link opens on the default
 * rather than not at all. Throwing away someone's code over the size of the phone it
 * is drawn in would be the wrong trade.
 */
function isSafePayload(payload: SharePayload): boolean {
  if (normalizeProjectName(payload.n) !== payload.n) return false

  // Apple's own character set for a bundle identifier. Not a security boundary - the
  // pbxproj writer quotes and escapes what it writes, so an odd one is contained
  // rather than injected - but a link carrying one that cannot build is still broken.
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,154}$/.test(payload.b)) return false
  if (!/^\d{1,2}(\.\d{1,2}){0,2}$/.test(payload.d)) return false

  if (payload.f.length > MAX_SHARE_FILES) return false
  if (!payload.f.every((file) => normalizeFileName(file.i) === file.i)) return false

  const folders = payload.g ?? []
  return folders.every(
    (folder) => typeof folder === 'string' && normalizeFolderPath(folder) === folder,
  )
}

function isSharePayload(value: unknown): value is SharePayload {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Partial<SharePayload>
  return (
    p.v === FORMAT_VERSION &&
    (p.p === undefined || isPreviewTarget(p.p)) &&
    typeof p.n === 'string' &&
    typeof p.b === 'string' &&
    typeof p.d === 'string' &&
    typeof p.t === 'string' &&
    Array.isArray(p.f) &&
    p.f.length > 0 &&
    p.f.every((f) => typeof f?.i === 'string' && typeof f?.t === 'string') &&
    (p.g === undefined || Array.isArray(p.g)) &&
    (p.c === undefined || Array.isArray(p.c))
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
