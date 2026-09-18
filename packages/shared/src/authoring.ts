import type { SharedStyle, StyleProperty } from './design-resources'
import type { CollectionSettings, ComponentSettings, BehaviorSettings, StateInput } from './authoring-features'
import type { Diagnostic } from './diagnostics'
import type { SourceFile } from './protocol'
import type { SourceSpan } from './source'
import type { ViewLayer } from './view-layer'
import type { DesignControl } from './design-edit'

export type PropertyValueKind = 'literal' | 'token' | 'data-binding' | 'component-argument' | 'inherited' | 'computed' | 'unsupported'

/** Source expressions, never evaluated values or executable closures. */
export interface AuthoringProperty {
  readonly id: string
  readonly name: string
  readonly expression: string
  readonly valueKind: PropertyValueKind
  readonly source?: SourceSpan
  readonly declaration?: SourceSpan
  readonly ownerId: string
  readonly scope: 'instance' | 'definition' | 'template' | 'inherited'
  readonly capability?: string
  readonly writable: boolean
  readonly reason: string
}

export interface AuthoringNode {
  readonly styles?: readonly StyleProperty[]
  /** Unique only within this snapshot. Reconcile anchors before reusing a selection. */
  readonly id: string
  readonly kind: 'definition' | 'view' | 'component' | 'collection' | 'template' | 'branch' | 'opaque'
  readonly name: string
  readonly owner: string
  readonly source: SourceSpan
  readonly parentId?: string
  readonly definitionId?: string
  readonly fingerprint: string
  readonly properties: readonly AuthoringProperty[]
  readonly children: readonly string[]
  readonly runtimeIds: readonly string[]
  readonly controls?: readonly DesignControl[]
  readonly collection?: CollectionSettings
  readonly component?: ComponentSettings
  readonly behavior?: BehaviorSettings
  readonly fields?: readonly string[]
  readonly extraction?: { readonly allowed: boolean; readonly reason: string }
}

export interface AuthoringSnapshot {
  readonly styles?: readonly SharedStyle[]
  readonly schemaVersion: 1
  readonly projectId: string
  readonly revision: number
  readonly nodes: readonly AuthoringNode[]
  readonly roots: readonly string[]
  readonly inputs?: readonly StateInput[]
  readonly diagnostics: readonly Diagnostic[]
  readonly runtimeToSource: Readonly<Record<string, string>>
}

/** Runtime repetition maps to one source node; unresolved spans stay unresolved. */
export function bindAuthoringRuntime(snapshot: AuthoringSnapshot, layers: readonly ViewLayer[], revision = snapshot.revision): AuthoringSnapshot {
  const sites = new Map<string, AuthoringNode[]>()
  for (const node of snapshot.nodes) {
    if (node.kind === 'definition' || node.kind === 'branch' || node.kind === 'template') continue
    const key = JSON.stringify([node.source.file, node.source.start])
    sites.set(key, [...(sites.get(key) ?? []), node])
  }
  const runtimeToSource: Record<string, string> = Object.create(null)
  const runtimeIds = new Map<string, string[]>()
  const visit = (items: readonly ViewLayer[]): void => {
    for (const item of items) {
      const candidates = item.source ? sites.get(JSON.stringify([item.source.file, item.source.start])) ?? [] : []
      const matching = candidates.filter(n => n.name === item.type)
      const node = matching.length === 1 ? matching[0] : candidates.length === 1 ? candidates[0] : undefined
      if (node) {
        runtimeToSource[item.id] = node.id
        runtimeIds.set(node.id, [...(runtimeIds.get(node.id) ?? []), item.id])
      }
      visit(item.children)
    }
  }
  visit(layers)
  return { ...snapshot, revision, runtimeToSource, nodes: snapshot.nodes.map(n => ({ ...n, runtimeIds: runtimeIds.get(n.id) ?? [] })) }
}

export interface AuthoringSelection {
  readonly snapshot: AuthoringSnapshot
  readonly nodeId: string
  readonly files: readonly SourceFile[]
  readonly runtimeId?: string
}

/** No positional fallback: deleting one of two similar nodes must not select its neighbor. */
export function reconcileAuthoringSelection(selection: AuthoringSelection, next: AuthoringSnapshot, files: readonly SourceFile[]): AuthoringNode | null {
  if (selection.snapshot.projectId !== next.projectId || next.revision < selection.snapshot.revision) return null
  const old = selection.snapshot.nodes.find(n => n.id === selection.nodeId)
  if (!old) return null
  if (selection.snapshot === next) return old
  const comparable = (n: AuthoringNode) => n.owner === old.owner && n.name === old.name && n.kind === old.kind
  const previous = selection.snapshot.nodes.filter(n => comparable(n) && n.fingerprint === old.fingerprint)
  const candidates = next.nodes.filter(comparable)
  const exact = candidates.filter(n => n.fingerprint === old.fingerprint)
  if (previous.length === 1 && exact.length === 1) return exact[0]!
  if (previous.length === 1 && exact.length > 1) return null
  if (previous.length > 1 && previous.length !== exact.length) return null

  const before = selection.files.find(f => f.id === old.source.file)?.text
  const after = files.find(f => f.id === old.source.file)?.text
  if (before === undefined || after === undefined) return null
  if (before === after) return candidates.find(n => n.source.file === old.source.file && n.source.start === old.source.start && n.fingerprint === old.fingerprint) ?? null
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++
  const oldEnd = before.length - suffix
  const delta = after.length - before.length
  let start = old.source.start
  let end = old.source.end
  if (oldEnd <= start) { start += delta; end += delta }
  else if (prefix >= end) { /* edit after this node */ }
  else if (prefix > start && oldEnd < end) end += delta
  else return null
  const located = candidates.filter(n => n.source.file === old.source.file && n.source.start === start && n.source.end === end)
  return located.length === 1 ? located[0]! : null
}
