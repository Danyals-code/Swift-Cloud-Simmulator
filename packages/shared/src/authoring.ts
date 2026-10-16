import type { AuthoringModifier, ModifierCatalogEntry } from './authoring-modifiers'
import type { SharedStyle, StyleProperty } from './design-resources'
import type { AppNavigationModel, CollectionSettings, ComponentSettings, BehaviorSettings, NavigationSettings, ScreenBars, StateInput, VariantProperty, ViewVisibility } from './authoring-features'
import type { Diagnostic } from './diagnostics'
import type { SourceFile } from './protocol'
import type { SourceSpan } from './source'
import type { ViewLayer } from './view-layer'
import type { DesignControl } from './design-edit'
import type { LayerProperties } from './layer'

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
  /** Set on a value read from a helper's parameter (Wave 3a): each place that calls the helper gives it. */
  readonly helperArgument?: true
}

/**
 * What a copy of a component can become instead (Wave 5b): each other component, with why
 * not where it can't, and why it can't become the plain views it shows, absent when it can.
 */
export interface InstanceSettings {
  readonly swap: readonly { readonly component: string; readonly disabledReason?: string }[]
  readonly detachDisabledReason?: string
}

export interface AuthoringNode {
  readonly modifiers?: readonly AuthoringModifier[]
  readonly modifierCatalog?: readonly ModifierCatalogEntry[]
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
  /**
   * The variant properties of the Main this is, or is a view inside (Wave 5b): empty when it has
   * none yet, and absent for anything not in a Main.
   */
  readonly variants?: readonly VariantProperty[]
  /** On a copy of a component (Wave 5b): the components it can become, and whether it can become the plain views it shows. */
  readonly instance?: InstanceSettings
  readonly behavior?: BehaviorSettings
  readonly navigation?: NavigationSettings
  /** On a screen's definition (Wave 4b): its title, toolbar items and search field, for the Bars section of Screen settings. */
  readonly bars?: ScreenBars
  /**
   * Set on the one view a `.sheet`, `.popover` or `.fullScreenCover` closure shows (Wave 4b),
   * which carries its Sheet settings: how it is presented, a popover as a sheet as an iPhone shows it.
   */
  readonly presented?: 'sheet' | 'cover'
  readonly fields?: readonly string[]
  readonly extraction?: { readonly allowed: boolean; readonly reason: string }
  /**
   * Set on a view written as an argument - `.overlay(Circle())`, `Section(header: Text("A"))` -
   * rather than as a statement of its own. It is part of the view that takes it, so it
   * cannot be moved, copied, hidden or deleted on its own.
   */
  readonly argument?: true
  /**
   * Set on a view the preview draws as a labelled box (D12): real SwiftUI it has no drawing
   * for yet, or a name it does not know, which only an Apple framework or the project can declare.
   */
  readonly undrawn?: 'unsupported' | 'unknown'
  /** The view as a layer: its layout, fill, corners, stroke, text and effects, read from its modifiers. */
  readonly layer?: LayerProperties
  /**
   * Where the preview draws the view from, when that is not where its source starts: a
   * joined text in parentheses, `(A + B).font(.title)`, is drawn from its sum (Wave 3a).
   */
  readonly drawnFrom?: SourceSpan
  /**
   * Set on a helper's own node and on each call of it (Wave 3a): a computed `some View` or
   * a function that returns one, whose views are read once where it is declared.
   */
  readonly helper?: true
  /** On a helper's own node, how many places its views are drawn from, through the helpers that call it too. */
  readonly places?: number
  /**
   * Set on a run of texts joined with `+` (Wave 3a): part of one Text, it keeps only what
   * keeps a Text a Text.
   */
  readonly textRun?: true
  /** When the view is shown (Wave 5a): always, or while an `if` around it holds; Shown when reads and sets it. */
  readonly visibility?: ViewVisibility
}

/** A helper's own node (Wave 3a), which its views hang from: a definition the authoring model marks as one. */
export function isHelperDefinition(node: Pick<AuthoringNode, 'kind' | 'helper'>): boolean {
  return node.kind === 'definition' && !!node.helper
}

/** A call of a helper (Wave 3a), which points at its views as a component's copy points at its Main. */
export function isHelperCall(node: Pick<AuthoringNode, 'kind' | 'helper'>): boolean {
  return node.kind === 'component' && !!node.helper
}

/** Where a helper's views are drawn, in the words every place that says so uses: `Used in 2 places`. */
export function helperPlaces(places: number): string {
  return places > 1 ? `Used in ${places} places` : places ? 'Used in 1 place' : 'Not used anywhere yet'
}

/** The app's accent, as the hex its colour set holds in light and dark. */
export interface AppAccent {
  readonly light: string
  readonly dark: string
}

export interface AuthoringSnapshot {
  readonly styles?: readonly SharedStyle[]
  readonly schemaVersion: 1
  readonly projectId: string
  readonly revision: number
  readonly nodes: readonly AuthoringNode[]
  readonly roots: readonly string[]
  readonly inputs?: readonly StateInput[]
  /** The app's own navigation: its style, and the tabs when it has them. */
  readonly navigation?: AppNavigationModel
  /** The tint written at the app's root, which the export writes into AccentColor. */
  readonly accent?: AppAccent
  readonly diagnostics: readonly Diagnostic[]
  readonly runtimeToSource: Readonly<Record<string, string>>
}

/** Runtime repetition maps to one source node; unresolved spans stay unresolved. */
export function bindAuthoringRuntime(snapshot: AuthoringSnapshot, layers: readonly ViewLayer[], revision = snapshot.revision): AuthoringSnapshot {
  const sites = new Map<string, AuthoringNode[]>()
  for (const node of snapshot.nodes) {
    if (node.kind === 'definition' || node.kind === 'branch' || node.kind === 'template') continue
    const drawn = node.drawnFrom ?? node.source
    const key = JSON.stringify([drawn.file, drawn.start])
    sites.set(key, [...(sites.get(key) ?? []), node])
  }
  /**
   * Of views written at one place, the one a layer is: the smallest whose source reaches as
   * far as the layer's, as a joined text and its first run start together (Wave 3a).
   */
  const narrowest = (nodes: readonly AuthoringNode[], layer: ViewLayer): AuthoringNode | undefined => {
    const end = layer.source?.end ?? 0
    const reaching = nodes.filter(node => (node.drawnFrom ?? node.source).end >= end)
    const size = (node: AuthoringNode) => (node.drawnFrom ?? node.source).end - (node.drawnFrom ?? node.source).start
    const smallest = reaching.reduce<AuthoringNode | undefined>((best, node) => !best || size(node) < size(best) ? node : best, undefined)
    return smallest && reaching.filter(node => size(node) === size(smallest)).length === 1 ? smallest : undefined
  }
  const runtimeToSource: Record<string, string> = Object.create(null)
  const runtimeIds = new Map<string, string[]>()
  const visit = (items: readonly ViewLayer[], inheritedComponents: ReadonlySet<string> = new Set()): void => {
    for (const item of items) {
      const candidates = item.source ? sites.get(JSON.stringify([item.source.file, item.source.start])) ?? [] : []
      const matching = candidates.filter(n => n.name === item.type)
      const node = matching.length === 1 ? matching[0] : matching.length > 1 ? narrowest(matching, item) : candidates.length === 1 ? candidates[0] : undefined
      if (node) {
        runtimeToSource[item.id] = node.id
        runtimeIds.set(node.id, [...(runtimeIds.get(node.id) ?? []), item.id])
      }
      const components = new Set(inheritedComponents)
      for (const component of item.componentSources ?? []) {
        const sitesAtCall = sites.get(JSON.stringify([component.source.file, component.source.start])) ?? []
        const matches = sitesAtCall.filter(candidate => candidate.kind === 'component' && candidate.name === component.name)
        const owner = matches.length === 1 ? matches[0] : undefined
        // One root per rendered instance is sufficient; descendants share its painted area.
        if (owner && !components.has(owner.id)) {
          if (!(runtimeIds.get(owner.id) ?? []).includes(item.id)) runtimeIds.set(owner.id, [...(runtimeIds.get(owner.id) ?? []), item.id])
          components.add(owner.id)
        }
      }
      visit(item.children, components)
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
  const before = selection.files.find(f => f.id === old.source.file)?.text
  const after = files.find(f => f.id === old.source.file)?.text
  if (before === undefined || after === undefined) return previous.length === 1 && exact.length === 1 ? exact[0]! : null
  if (before === after) return candidates.find(n => n.source.file === old.source.file && n.source.start === old.source.start && n.fingerprint === old.fingerprint) ?? null
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++
  const oldEnd = before.length - suffix
  const delta = after.length - before.length
  // A change wholly inside this node proves its identity even when its old
  // fingerprint was shared by a sibling. In particular, editing a row must keep
  // its template open. Never use this for a replacement or deletion of the node.
  if (prefix > old.source.start && oldEnd < old.source.end) {
    const enclosing = candidates.filter(n => n.source.file === old.source.file && n.source.start === old.source.start && n.source.end === old.source.end + delta)
    if (enclosing.length === 1) return enclosing[0]!
  }
  if (previous.length === 1 && exact.length === 1) return exact[0]!
  if (previous.length === 1 && exact.length > 1) return null
  if (previous.length > 1 && previous.length !== exact.length) return null
  let start = old.source.start
  let end = old.source.end
  if (oldEnd <= start) { start += delta; end += delta }
  else if (prefix >= end) { /* edit after this node */ }
  else if (prefix > start && oldEnd < end) end += delta
  else return null
  const located = candidates.filter(n => n.source.file === old.source.file && n.source.start === start && n.source.end === end)
  return located.length === 1 ? located[0]! : null
}
