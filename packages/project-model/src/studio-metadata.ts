import type { ComponentDescription, PreviewScenario } from '@studio/shared'
/** Authoring-only information. No production layout values or application state. */
export interface StudioMetadata {
  readonly schemaVersion: 1
  readonly labels: readonly { readonly owner: string; readonly fingerprint: string; readonly label: string }[]
  readonly canvas: readonly { readonly screen: string; readonly x: number; readonly y: number }[]
  readonly components: readonly ComponentDescription[]
  readonly scenarios: readonly PreviewScenario[]
}

export type MetadataRead =
  | { readonly status: 'missing' }
  | { readonly status: 'valid'; readonly metadata: StudioMetadata }
  | { readonly status: 'unsupported'; readonly version: number }
  | { readonly status: 'invalid'; readonly reason: string }

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
const string = (value: unknown): value is string => typeof value === 'string' && value.length <= 16_384
const scalar = (value: unknown) => value === null || typeof value === 'boolean' || string(value) || finite(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
function entries(value: unknown, accepts: (item: Record<string, unknown>) => boolean): boolean {
  return Array.isArray(value) && value.length <= 1000 && value.every(item => record(item) && accepts(item))
}

/** Fail closed without repairing, dropping, or rewriting an unknown metadata version. */
export function readStudioMetadata(value: unknown): MetadataRead {
  if (value === undefined) return { status: 'missing' }
  if (!record(value) || !Number.isInteger(value.schemaVersion)) return { status: 'invalid', reason: 'Studio metadata needs a schema version.' }
  if (value.schemaVersion !== 1) return { status: 'unsupported', version: Number(value.schemaVersion) }
  if (!entries(value.labels, v => string(v.owner) && string(v.fingerprint) && string(v.label)) ||
      !entries(value.canvas, v => string(v.screen) && finite(v.x) && finite(v.y)) ||
      !entries(value.components, v => string(v.owner) && (v.signature === undefined || string(v.signature)) && entries(v.properties, p => string(p.name) && string(p.label) && string(p.description) && (p.min === undefined || finite(p.min)) && (p.max === undefined || finite(p.max)) && (p.group === undefined || string(p.group)))) ||
      !entries(value.scenarios, v => string(v.name) && string(v.owner) && string(v.hook) && (v.inputs === undefined || entries(v.inputs, i => string(i.owner) && string(i.name) && string(i.signature) && (scalar(i.value) || entries(i.value, r => Object.keys(r).length <= 32 && Object.entries(r).every(([k, value]) => string(k) && scalar(value)))))))) {
    return { status: 'invalid', reason: 'Studio metadata contains invalid or oversized entries.' }
  }
  try { if (JSON.stringify(value).length > 2_000_000) return { status: 'invalid', reason: 'Studio metadata exceeds its 2 MB text limit.' } }
  catch { return { status: 'invalid', reason: 'Studio metadata must be serializable.' } }
  // All fields are validated above; retain unknown keys so a read/save does not destroy extensions.
  return { status: 'valid', metadata: value as unknown as StudioMetadata }
}

export function emptyStudioMetadata(): StudioMetadata {
  return { schemaVersion: 1, labels: [], canvas: [], components: [], scenarios: [] }
}
