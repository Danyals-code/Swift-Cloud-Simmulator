import { CONTENT_SLOT_NAMES, CONTEXT_MENU_PREVIEW, LAYOUT_WORDS, MODIFIER_SLOTS, helperPlaces, isHelperCall, isHelperDefinition, nameInWords, reconcileAuthoringSelection, type AuthoringNode, type AuthoringSelection, type AuthoringSnapshot, type HiddenViewInfo, type SourceFile, type SourceSpan, type ViewLayer } from '@studio/shared'
import { PAGE_SLOTS } from './pageKinds'

export interface SourceLayerNavigation {
  readonly snapshot: AuthoringSnapshot
  readonly files: readonly SourceFile[]
  readonly entered?: string
  readonly pageId?: string
  readonly opened?: ReadonlySet<string>
  readonly closed: ReadonlySet<string>
  readonly dismissed?: string
  readonly dismissedEntry?: string
  readonly selection?: AuthoringSelection
}

/** IDs are local to one snapshot; rebase tree navigation just like selection. */
export function rebaseSourceLayers(state: SourceLayerNavigation, snapshot: AuthoringSnapshot, files: readonly SourceFile[], selection?: AuthoringSelection): SourceLayerNavigation {
  if (state.snapshot === snapshot) return state.selection === selection ? state : { ...state, selection, dismissed: undefined, dismissedEntry: undefined }
  const resolve = (id: string | undefined) => id ? reconcileAuthoringSelection({ snapshot: state.snapshot, nodeId: id, files: state.files }, snapshot, files)?.id : undefined
  return { snapshot, files, pageId: state.pageId, entered: resolve(state.entered), closed: new Set([...state.closed].map(resolve).filter((id): id is string => !!id)), opened: new Set([...(state.opened ?? [])].map(resolve).filter((id): id is string => !!id)), selection, dismissed: state.selection === selection ? resolve(state.dismissed) : undefined, dismissedEntry: state.selection === selection ? resolve(state.dismissedEntry) : undefined }
}

const VIEW_NAMES: Readonly<Record<string, string>> = {
  VStack: LAYOUT_WORDS.VStack, LazyVStack: `Lazy ${LAYOUT_WORDS.VStack}`, HStack: LAYOUT_WORDS.HStack, LazyHStack: `Lazy ${LAYOUT_WORDS.HStack}`, ZStack: LAYOUT_WORDS.ZStack,
  ForEach: 'Repeat', ScrollView: 'Scroll', NavigationStack: 'Navigation', NavigationView: 'Navigation',
  NavigationSplitView: 'Split navigation', NavigationLink: 'Link', TabView: 'Tabs',
  TextField: 'Text field', SecureField: 'Password field', DatePicker: 'Date picker', ColorPicker: 'Color picker',
  ProgressView: 'Progress', AsyncImage: 'Remote image', GroupBox: 'Card', GridRow: 'Grid row',
  LazyVGrid: 'Column grid', LazyHGrid: 'Row grid', RoundedRectangle: 'Rounded rectangle',
}

/** Friendly labels are presentation only; the Swift identity stays intact. A helper is a group of views (Wave 3a). */
export function sourceLayerType(node: Pick<AuthoringNode, 'name' | 'kind'> & Partial<Pick<AuthoringNode, 'properties' | 'controls' | 'helper'>>): string {
  if (node.name === 'Image' && (node.properties?.some(property => property.name === 'systemName') || node.controls?.some(control => control.id === 'image' && control.label === 'System symbol'))) return 'Symbols'
  if (node.kind === 'template') return 'Row design'
  if (isHelperCall(node) || isHelperDefinition(node)) return 'Group'
  if (node.kind === 'component') return 'Component'
  return VIEW_NAMES[node.name] ?? nameInWords(node.name)
}

export function sourceLayerLabel(node: AuthoringNode): string {
  // A helper is called by its Swift name, which is how Code finds it.
  if (isHelperDefinition(node) || isHelperCall(node)) return node.name
  if (node.kind === 'definition') return node.owner.split('.').map(friendlyComponentName).join(' / ')
  if (node.kind === 'branch' && node.properties[0]) {
    if (node.name === 'When' || node.name === 'Condition') return `When ${node.properties.map(property => property.expression).join(' and ')}`
    if (node.name === 'Switch') return `Match ${node.properties[0].expression}`
  }
  if (node.kind === 'component') {
    const tabItem = [...(node.modifiers ?? [])].reverse().find(modifier => modifier.name === 'tabItem')
    // Display only a plain literal label; computed Swift remains the component's own name.
    const literal = tabItem?.expression.match(/^\.tabItem\s*\{\s*(?:Label|Text)\s*\(\s*("(?:[^"\\]|\\.)*")\s*[,)]/)?.[1]
    if (literal) { try { const title: unknown = JSON.parse(literal); if (typeof title === 'string') return title } catch { /* Swift interpolation and non-JSON escapes are not display labels. */ } }
  }
  if (node.name === 'NavigationLink') {
    const expression = node.properties.find(property => property.name === 'argument 1')?.expression
    if (expression?.startsWith('"')) { try { const title: unknown = JSON.parse(expression); if (typeof title === 'string') return title } catch { /* Preserve computed titles as their view type. */ } }
  }
  return node.controls?.find(c => c.id === 'content' || c.id === 'title')?.value || (node.kind === 'component' ? friendlyComponentName(node.name) : sourceLayerType(node))
}

/** What a change inside a helper reaches (Wave 3a), said where its views are edited on their own. */
export function sourceLayerHelperReach(helper: Pick<AuthoringNode, 'places'>): string {
  const places = helper.places ?? 0
  return `${helperPlaces(places)}.${places > 1 ? ' Changes affect each of them.' : places ? ' Changes show there.' : ''}`
}

/** Each layer's name by its id, where the name is more than its type: the words a text draws. */
export function sourceLayerNames(layers: readonly ViewLayer[]): ReadonlyMap<string, string> {
  const names = new Map<string, string>()
  const visit = (items: readonly ViewLayer[]) => { for (const layer of items) { if (layer.name !== layer.type) names.set(layer.id, layer.name); visit(layer.children) } }
  visit(layers)
  return names
}

/** Views whose layer on the canvas is named by the words they draw. */
const DRAWS_WORDS: ReadonlySet<string> = new Set(['Text', 'Label', 'Button', 'Link', 'NavigationLink', 'Toggle'])

/** The longest a row's drawn words run before they are cut at a space. */
const DRAWN_LENGTH = 36

/**
 * What a view bound to data draws, as its row reads (Wave 3a): `Text(item.title)` reads
 * "Milk", the first place it is drawn on the phone, rather than "Text", or the place `at`
 * says. `names` holds the phone's layers' names by id. Words a view is written with are
 * its label already.
 */
export function sourceLayerDrawn(node: AuthoringNode, names: ReadonlyMap<string, string>, at = 0): string | undefined {
  // A control's words are its own when they are its title, `Button(item.title)`; a label of views is views of its own.
  const titled = node.name === 'Text' || node.properties.some(property => property.name === 'argument 1')
  if (!DRAWS_WORDS.has(node.name) || !titled || sourceLayerLabel(node) !== sourceLayerType(node)) return undefined
  const words = [node.runtimeIds[at], ...node.runtimeIds].map(id => id && names.get(id)?.replace(/\s+/g, ' ').trim()).find(Boolean)
  if (!words || words.length <= DRAWN_LENGTH) return words
  const cut = words.lastIndexOf(' ', DRAWN_LENGTH - 1)
  return `${words.slice(0, cut > DRAWN_LENGTH / 2 ? cut : DRAWN_LENGTH - 1).trimEnd()}…`
}

export function sourceLayerAncestors(nodes: ReadonlyMap<string, AuthoringNode>, selected?: string): readonly string[] {
  const ancestors: string[] = []
  let node = selected ? nodes.get(selected) : undefined
  while (node?.parentId && !ancestors.includes(node.parentId)) {
    ancestors.push(node.parentId)
    node = nodes.get(node.parentId)
  }
  return ancestors
}

/** Hidden comments have no AST node. Attach each restore control to its actual owner. */
export function sourceLayerHiddenOwner(snapshot: AuthoringSnapshot, hidden: HiddenViewInfo): string | undefined {
  const around = snapshot.nodes.filter(node => node.source.file === hidden.file && (hidden.container === null
    ? node.kind === 'definition' && node.source.start <= hidden.offset && node.source.end >= hidden.offset
    : node.kind !== 'definition' && node.kind !== 'template' && node.source.start === hidden.container))
  // A helper is written inside its view's braces: a view hidden at its top level is the helper's.
  const helper = hidden.container === null ? around.filter(isHelperDefinition) : []
  const candidates = helper.length ? helper : around
  if (candidates.length !== 1) return undefined
  const owner = candidates[0]!
  const template = snapshot.nodes.find(node => node.kind === 'template' && node.parentId === owner.id && node.source.start <= hidden.offset && node.source.end >= hidden.offset)
  return template?.id ?? owner.id
}

/** The view a span is written in, such as a warning's or a colour's use: the smallest layer around it. */
export function sourceLayerAround(snapshot: AuthoringSnapshot | undefined, span: SourceSpan): AuthoringNode | undefined {
  return smallestAround(snapshot, span, false)
}

/** The screen or component a span is written in. */
export function sourceDefinitionAround(snapshot: AuthoringSnapshot | undefined, span: SourceSpan): AuthoringNode | undefined {
  return smallestAround(snapshot, span, true)
}

function smallestAround(snapshot: AuthoringSnapshot | undefined, span: SourceSpan, definition: boolean): AuthoringNode | undefined {
  // A helper is part of the view it is written in, which is the screen or component around it.
  return snapshot?.nodes
    .filter(node => (node.kind === 'definition') === definition && !isHelperDefinition(node) && node.source.file === span.file && node.source.start <= span.start && node.source.end >= span.end)
    .sort((a, b) => (a.source.end - a.source.start) - (b.source.end - b.source.start))[0]
}

/**
 * The slots the canvas draws open only while they, or a view in them, are selected (Wave 4a): a
 * row's swipe actions, and a view's context menu and the preview above it. Each is a layer of
 * its own, listed whether it is drawn or not, so it can be selected and Add puts a view into it.
 */
const OPENED_SLOTS: ReadonlySet<string> = new Set([MODIFIER_SLOTS.swipeActions!, MODIFIER_SLOTS.contextMenu!, CONTEXT_MENU_PREVIEW])

/** A slot the Design canvas draws open while it is selected (Wave 4a): a row's Swipe actions, a Context menu, or the Preview it lifts. */
export function sourceLayerOpens(node: Pick<AuthoringNode, 'kind' | 'name'>): boolean {
  return node.kind === 'branch' && OPENED_SLOTS.has(node.name)
}

/**
 * Whether selecting `node` draws something open on the canvas (Wave 4a): it is an opened slot,
 * or a view in one. Only then does leaving it need the page redrawn, to close it again.
 */
export function sourceLayerRevealing(snapshot: AuthoringSnapshot, node: AuthoringNode): boolean {
  if (sourceLayerOpens(node)) return true
  const nodes = new Map(snapshot.nodes.map(item => [item.id, item]))
  return sourceLayerAncestors(nodes, node.id).some(id => { const ancestor = nodes.get(id); return !!ancestor && sourceLayerOpens(ancestor) })
}

/**
 * The slot a selection is, which Add puts a view into as its last (Wave 4a): a Toolbar, an
 * alert's Actions, Swipe actions, a Header. A page's slot, such as a Sheet, is a screen of its
 * own, where Add goes into its content as on any screen.
 */
export function sourceLayerSlot(node: AuthoringNode | undefined): AuthoringNode | undefined {
  return node?.kind === 'branch' && !PAGE_SLOTS.has(node.name) && CONTENT_SLOT_NAMES.has(node.name) ? node : undefined
}

/** A branch can be absent from the current preview while remaining selectable. */
export function sourceLayerNotShown(snapshot: AuthoringSnapshot, node: AuthoringNode, visibleRuntimeIds?: ReadonlySet<string>): boolean {
  if (!Object.keys(snapshot.runtimeToSource).length || sourceLayerOpens(node)) return false
  const nodes = new Map(snapshot.nodes.map(item => [item.id, item]))
  /** Whether a layer, or the helper it calls, which is drawn in its place, is drawn. */
  const drawn = (item: AuthoringNode, seen: ReadonlySet<string> = new Set()): boolean => item.runtimeIds.some(id => !visibleRuntimeIds || visibleRuntimeIds.has(id))
    || !!item.definitionId && !seen.has(item.definitionId) && isHelperCall(item) && within(nodes.get(item.definitionId), new Set([...seen, item.definitionId]))
  const within = (item: AuthoringNode | undefined, seen: ReadonlySet<string>): boolean => !!item && item.children.some(id => {
    const child = nodes.get(id)
    return !!child && (drawn(child, seen) || within(child, seen))
  })
  if (node.kind !== 'branch') {
    const ancestors = sourceLayerAncestors(nodes, node.id)
    const branch = ancestors.map(id => nodes.get(id)).find(item => item?.kind === 'branch')
    return !!branch && !drawn(node) && sourceLayerNotShown(snapshot, branch, visibleRuntimeIds)
  }
  const shown = (item: AuthoringNode): boolean => drawn(item) || item.children.some(id => {
    const child = nodes.get(id)
    // Otherwise is an alternative to this condition, not evidence its then-content is shown.
    return !!child && !(item.id === node.id && node.name === 'Condition' && child.name === 'Otherwise') && shown(child)
  })
  return !shown(node)
}

const STRUCTURAL_VIEWS = new Set(['ForEach', 'Group', 'NavigationStack', 'NavigationView', 'NavigationSplitView', 'WindowGroup', 'Window', 'ToolbarItem', 'ToolbarItemGroup', 'ViewThatFits', 'EmptyView'])

/** A component's name as Layers shows it: `BookRowView` is "Book row". */
export const friendlyComponentName = (name: string) => name.replace(/View$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\b[A-Z]\w*/g, (word, offset: number) => offset ? word.toLowerCase() : word)

/** These rows represent visible design elements, never source-control scaffolding. */
export function sourceLayerIsVisual(node: AuthoringNode): boolean {
  if (node.kind === 'component' || sourceLayerOpens(node)) return true
  if (!['view', 'collection', 'opaque'].includes(node.kind)) return false
  // Every Section offers a Header to fill in (Wave 4a); one with words in it is titled.
  if (node.name === 'Section') return node.controls?.some(control => control.id === 'title' && !!control.value) === true
  if (STRUCTURAL_VIEWS.has(node.name)) return false
  // A titled link is itself visible. A link with a label builder contributes its label views.
  if (node.name === 'NavigationLink') return node.children.length === 0 || node.controls?.some(control => control.id === 'title') === true || node.properties.some(property => property.name === 'argument 1')
  return node.kind !== 'opaque' || /^[A-Z][A-Za-z0-9_]*$/.test(node.name)
}

export interface SourceLayerRuntimeContext {
  /** The selected phone can narrow conditional visibility within reused components. */
  readonly runtimeLayers?: readonly ViewLayer[]
  readonly pageSource?: SourceSpan
  readonly visibleRuntimeIds?: ReadonlySet<string>
}

export interface SourceLayerRow {
  readonly shared?: boolean
  readonly node: AuthoringNode
  readonly depth: number
  readonly expanded: boolean
  /** Presentation ancestry; source parents remain untouched for edits. */
  readonly parentId?: string
  readonly children: readonly string[]
  /**
   * Unique among the rows: a helper's views are listed under each place it is called,
   * so one node can have several rows, told apart by the rows above them.
   */
  readonly key: string
  /** For a call of a helper, how many places its views are drawn in (`AuthoringNode.places`): they change in all of them. */
  readonly places?: number
  /** For a helper nothing calls (Wave 3a): listed under its view, as not used, so its views can still be reached. */
  readonly unused?: true
  /** For a view bound to data, the words it draws on the phone, which name its row. */
  readonly label?: string
}

/** Hidden comments belong to the current phone's source scope, including empty containers. */
export function sourceLayerHiddenInScope(snapshot: AuthoringSnapshot, hidden: HiddenViewInfo, scope: readonly AuthoringNode[]): boolean {
  if (!scope.length) return true
  const nodes = new Map(snapshot.nodes.map(node => [node.id, node]))
  const contains = (node: AuthoringNode) => node.source.file === hidden.file && node.source.start <= hidden.offset && node.source.end >= hidden.offset
  const paths = scope.map(node => [node, ...sourceLayerAncestors(nodes, node.id).map(id => nodes.get(id)!)])
  const bounds = paths.map(path => path.find(node => node.kind === 'branch' && PAGE_SLOTS.has(node.name)) ?? path.find(node => node.kind === 'definition') ?? path[0]!)
  if (!bounds.some(contains)) return false
  // A main screen declaration can also contain inline destinations and sheets.
  // Their hidden views remain with that separate screen, not its parent phone.
  return snapshot.nodes.filter(node => node.kind === 'branch' && PAGE_SLOTS.has(node.name) && contains(node))
    .every(slot => paths.some(path => path.some(node => node.id === slot.id)))
}

/** A hidden view wrapper represents its one visible label/content view, not its destination. */
export function sourceLayerPrimaryViewId(snapshot: AuthoringSnapshot, id: string | undefined, rows: readonly Pick<SourceLayerRow, 'node'>[]): string | undefined {
  if (!id) return undefined
  const visible = new Set(rows.map(row => row.node.id))
  if (visible.has(id)) return id
  const nodes = new Map(snapshot.nodes.map(node => [node.id, node]))
  const wrapper = nodes.get(id)
  if (!wrapper || !['view', 'collection'].includes(wrapper.kind) || sourceLayerIsVisual(wrapper)) return undefined
  const primary = (node: AuthoringNode, seen = new Set<string>()): string[] => node.children.flatMap(childId => {
    const child = nodes.get(childId)
    if (!child || seen.has(childId) || child.kind === 'branch' && CONTENT_SLOT_NAMES.has(child.name)) return []
    return sourceLayerIsVisual(child) ? [childId] : primary(child, new Set([...seen, childId]))
  })
  const children = [...new Set(primary(wrapper))]
  return children.length === 1 && visible.has(children[0]!) ? children[0] : undefined
}

/** Resolve hidden source context or collapsed content without guessing between instances. */
export function sourceLayerVisibleId(snapshot: AuthoringSnapshot, id: string | undefined, rows: readonly Pick<SourceLayerRow, 'node'>[]): string | undefined {
  if (!id) return undefined
  const primary = sourceLayerPrimaryViewId(snapshot, id, rows)
  if (primary) return primary
  const nodes = new Map(snapshot.nodes.map(node => [node.id, node]))
  const visible = new Set(rows.map(row => row.node.id))
  const path = [id, ...sourceLayerAncestors(nodes, id)]
  for (const ancestor of path) if (visible.has(ancestor)) return ancestor
  const definition = path.map(item => nodes.get(item)).find(node => node?.kind === 'definition')
  if (definition) {
    const instances = rows.filter(row => row.node.definitionId === definition.id)
    if (instances.length === 1) return instances[0]!.node.id
  }
  const descendants = rows.filter(row => sourceLayerAncestors(nodes, row.node.id).includes(id))
  const top = descendants.filter(row => !descendants.some(other => other.node.id !== row.node.id && sourceLayerAncestors(nodes, row.node.id).includes(other.node.id)))
  return top.length === 1 ? top[0]!.node.id : undefined
}

/** A hidden view, and the row it is listed under: none puts it at the top of the tree. */
export interface SourceLayerHiddenRow {
  readonly view: HiddenViewInfo
  readonly owner?: string
}

/**
 * Project Swift structure into visual views while retaining original source identities.
 *
 * Hidden views have no node of their own. Each one is listed under the row that
 * holds it, and that row and its parents stay open, unless the designer closed
 * them, so a hidden view is never drawn under a row whose other children are not.
 */
export function sourceLayerRows(snapshot: AuthoringSnapshot, navigation: SourceLayerNavigation, selected: string | undefined, query: string, runtime?: SourceLayerRuntimeContext, hidden: readonly HiddenViewInfo[] = []) {
  const nodes = new Map(snapshot.nodes.map(n => [n.id, n]))
  const runtimeIds = runtime?.visibleRuntimeIds ? new Set(runtime.visibleRuntimeIds) : runtime?.runtimeLayers ? new Set<string>() : undefined
  const pageRoots: string[] = []
  const names = sourceLayerNames(runtime?.runtimeLayers ?? [])
  const layerParents = new Map<string, string>()
  const discoverPage = (layers: readonly ViewLayer[], mappedParent = false, parent?: string) => {
    for (const layer of layers) {
      runtimeIds?.add(layer.id)
      if (parent) layerParents.set(layer.id, parent)
      const sourceId = snapshot.runtimeToSource[layer.id]
      // Runtime navigation chrome borrows its container's source location for
      // code reveal; a back button must not resurrect that previous screen.
      const synthetic = layer.type.startsWith('_') && nodes.get(sourceId ?? '')?.name !== layer.type
      const mapped = layer.page || synthetic ? undefined : sourceId
      if (!mappedParent && mapped) pageRoots.push(mapped)
      discoverPage(layer.children, mappedParent || !!mapped, layer.id)
    }
  }
  if (runtime?.runtimeLayers) discoverPage(runtime.runtimeLayers)
  const pageContexts = runtime?.runtimeLayers ? new Set(snapshot.nodes.filter(node => node.runtimeIds.some(id => runtimeIds?.has(id))).flatMap(node => [node.id, ...sourceLayerAncestors(nodes, node.id)])) : undefined
  const ancestors = sourceLayerAncestors(nodes, selected)
  const selectionNode = selected ? nodes.get(selected) : undefined
  const selectedContext = selectionNode && (['definition', 'template'].includes(selectionNode.kind) || selectionNode.kind === 'branch' && PAGE_SLOTS.has(selectionNode.name)) && (!pageContexts || pageContexts.has(selectionNode.id)) && navigation.dismissedEntry !== selected ? selectionNode : undefined
  const entry = selectedContext ?? (navigation.entered && (!pageContexts || pageContexts.has(navigation.entered)) && (!selected || selected === navigation.entered || ancestors.includes(navigation.entered)) ? nodes.get(navigation.entered) : undefined)
  const appRoots = snapshot.roots.filter(id => nodes.get(id)?.children.some(child => nodes.get(child)?.name === 'WindowGroup'))
  const screens = new Set<string>()
  const discover = (id: string) => { const node = nodes.get(id); if (node?.definitionId) screens.add(node.definitionId); else node?.children.forEach(discover) }
  appRoots.forEach(discover)
  if (!screens.size) {
    const referenced = new Set(snapshot.nodes.flatMap(node => node.definitionId ? [node.definitionId] : []))
    snapshot.roots.filter(id => !appRoots.includes(id) && !referenced.has(id)).forEach(id => screens.add(id))
  }
  const shared = new Set<string>()
  const flatten = (ids: readonly string[], seen = new Set<string>()): string[] => ids.flatMap(id => {
    const node = nodes.get(id)
    if (!node || seen.has(id) || node.kind === 'branch' && PAGE_SLOTS.has(node.name)) return []
    if (node.kind === 'branch' && sourceLayerNotShown(snapshot, node, runtimeIds)) return node.name === 'Condition' ? flatten(node.children.filter(child => nodes.get(child)?.name === 'Otherwise'), new Set([...seen, id])) : []
    if (sourceLayerIsVisual(node)) return [id]
    const children = flatten(node.children, new Set([...seen, id]))
    if (node.kind === 'template' && children.length) {
      // A ForEach owns one shared design, even when it renders many records.
      // Multiple top-level elements still belong to a single repeated row.
      const rows = children.length === 1 ? children : [id]
      rows.forEach(child => shared.add(child))
      return rows
    }
    return children
  })
  // RootView → MainTabs is app wiring, not a pair of extra design layers.
  const screenContent = (id: string, seen = new Set<string>()): string[] => {
    if (seen.has(id)) return []
    const node = nodes.get(id)
    if (!node) return []
    const content = flatten(node.kind === 'definition' ? node.children : [id])
    const single = content.length === 1 ? nodes.get(content[0]!) : undefined
    if (single?.definitionId && !seen.has(single.definitionId) && single.definitionId !== id && !flatten(single.children).length) return screenContent(single.definitionId, new Set([...seen, id]))
    return content
  }
  const rootCandidates = [...new Set(entry ? flatten(entry.kind === 'definition' || !sourceLayerIsVisual(entry) ? entry.children : [entry.id]) : pageRoots.length ? flatten(pageRoots) : runtime?.runtimeLayers ? [] : [...screens].flatMap(id => screenContent(id)))]
  // Runtime chrome can expose a toolbar view both beside content and inside its
  // source owner. Keep one source-owned row rather than duplicating that region.
  const roots = rootCandidates.filter(id => !sourceLayerAncestors(nodes, id).some(parent => rootCandidates.includes(parent)))
  // A helper's views are listed in a group under each place it is called (Wave 3a).
  const calls = new Map<string, AuthoringNode[]>()
  for (const node of snapshot.nodes) if (node.definitionId && isHelperCall(node)) calls.set(node.definitionId, [...(calls.get(node.definitionId) ?? []), node])
  const helperOf = (node: AuthoringNode) => node.definitionId && calls.has(node.definitionId) ? nodes.get(node.definitionId) : undefined
  // One nothing calls is listed after the views of the view it is written in, as not used.
  const owners = new Set((entry ? entry.kind === 'definition' && !isHelperDefinition(entry) ? [entry] : [] : roots.map(id => nodes.get(id)!)).map(node => node.owner))
  const unused = snapshot.nodes.filter(node => isHelperDefinition(node) && !calls.has(node.id) && owners.has(node.owner)).map(node => node.id)
  const childIds = new Map<string, readonly string[]>()
  const parentIds = new Map<string, string>()
  const collect = (id: string, parentId?: string, seen = new Set<string>()) => {
    if (seen.has(id) || childIds.has(id)) return
    const node = nodes.get(id)
    if (!node) return
    const children = flatten([...helperOf(node)?.children ?? [], ...node.children])
    childIds.set(id, children)
    if (parentId) parentIds.set(id, parentId)
    children.forEach(child => collect(child, id, new Set([...seen, id])))
  }
  roots.forEach(id => collect(id))
  unused.forEach(id => collect(id))
  const allRows = [...childIds.keys()].map(id => ({ node: nodes.get(id)! }))
  const selectedView = sourceLayerVisibleId(snapshot, selected, allRows)
  const revealed = new Set<string>()
  /** Opens the rows above a row, and every call of a helper it is in, which each list it. */
  const reveal = (id: string, seen: Set<string>) => {
    for (let parentId = parentIds.get(id); parentId && !revealed.has(parentId); parentId = parentIds.get(parentId)) revealed.add(parentId)
    for (const ancestor of sourceLayerAncestors(nodes, id)) for (const call of calls.get(ancestor) ?? []) {
      if (seen.has(call.id) || !childIds.has(call.id)) continue
      seen.add(call.id)
      revealed.add(call.id)
      reveal(call.id, seen)
    }
  }
  if (navigation.dismissed !== selected && selectedView) reveal(selectedView, new Set())
  const needle = query.trim().toLowerCase()
  const matches = new Map<string, boolean>()
  const match = (id: string): boolean => {
    if (matches.has(id)) return matches.get(id)!
    const node = nodes.get(id)!
    const found = `${sourceLayerDrawn(node, names) ?? sourceLayerLabel(node)} ${sourceLayerType(node)} ${node.name}`.toLowerCase().includes(needle) || (childIds.get(id) ?? []).some(match)
    matches.set(id, found)
    return found
  }
  const scope = entry ? [entry] : pageRoots.map(id => nodes.get(id)!)
  const shownHidden = hidden.filter(view => entry ? view.file === entry.source.file && view.offset >= entry.source.start && view.offset <= entry.source.end : sourceLayerHiddenInScope(snapshot, view, scope))
  const hiddenOwners = shownHidden.map(view => {
    let owner = nodes.get(sourceLayerHiddenOwner(snapshot, view) ?? '')
    // A helper called from one place is listed there; from several, its views have no one row.
    while (owner && !sourceLayerIsVisual(owner)) owner = nodes.get(owner.parentId ?? '') ?? (calls.get(owner.id)?.length === 1 ? calls.get(owner.id)![0] : undefined)
    return owner?.id
  })
  const holdingHidden = new Set(hiddenOwners.flatMap(id => id ? [id, ...sourceLayerAncestors(nodes, id)] : []))
  const rows: SourceLayerRow[] = []
  /** Where a view inside a helper is drawn for `call`: in what that call draws, or as the helper's calls come, in their order. */
  const drawnFor = (node: AuthoringNode, call: AuthoringNode | undefined): number => {
    if (!call) return 0
    const inside = (id: string): boolean => call.runtimeIds.includes(id) || layerParents.has(id) && inside(layerParents.get(id)!)
    const at = node.runtimeIds.findIndex(inside)
    if (at >= 0) return at
    const sites = calls.get(call.definitionId ?? '') ?? []
    return node.runtimeIds.length === sites.length ? sites.indexOf(call) : 0
  }
  /** `call` is the place a helper's views are listed under, and the views there read what it draws. */
  const visit = (id: string, depth: number, parentId?: string, parentKey = '', call?: AuthoringNode) => {
    const node = nodes.get(id)
    if (!node || needle && !match(id)) return
    const children = childIds.get(id) ?? []
    const notUsed = depth === 0 && unused.includes(id)
    const expanded = !!children.length && (!!needle || revealed.has(id) || !navigation.closed.has(id) && (depth === 0 && !shared.has(id) && !notUsed || navigation.opened?.has(id) === true || holdingHidden.has(id)))
    const helper = helperOf(node)
    const label = sourceLayerDrawn(node, names, drawnFor(node, call))
    const key = `${parentKey}/${id}`
    rows.push({ node, depth, expanded, shared: shared.has(id), parentId: parentId ?? parentIds.get(id), children, key, ...(helper ? { places: helper.places ?? 0 } : {}), ...(notUsed ? { unused: true as const } : {}), ...(label ? { label } : {}) })
    if (expanded) children.forEach(child => visit(child, depth + 1, id, key, helper ? node : call))
  }
  roots.forEach(id => visit(id, 0))
  unused.forEach(id => visit(id, 0))
  const hiddenRows: SourceLayerHiddenRow[] = shownHidden.map((view, index) => {
    const owner = sourceLayerVisibleId(snapshot, hiddenOwners[index], rows)
    return owner ? { view, owner } : { view }
  })
  return { rows, screens, entry, scope, hidden: hiddenRows }
}
