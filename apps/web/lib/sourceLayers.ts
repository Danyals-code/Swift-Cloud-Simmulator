import { reconcileAuthoringSelection, type AuthoringNode, type AuthoringSelection, type AuthoringSnapshot, type HiddenViewInfo, type SourceFile, type SourceSpan, type ViewLayer } from '@studio/shared'

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
  VStack: 'Vertical Stack', LazyVStack: 'Lazy Vertical Stack', HStack: 'Horizontal Stack', LazyHStack: 'Lazy Horizontal Stack', ZStack: 'ZStack',
  ForEach: 'Repeat', ScrollView: 'Scroll', NavigationStack: 'Navigation', NavigationView: 'Navigation',
  NavigationSplitView: 'Split navigation', NavigationLink: 'Link', TabView: 'Tabs',
  TextField: 'Text field', SecureField: 'Password field', DatePicker: 'Date picker', ColorPicker: 'Color picker',
  ProgressView: 'Progress', AsyncImage: 'Remote image', GroupBox: 'Card', GridRow: 'Grid row',
  LazyVGrid: 'Column grid', LazyHGrid: 'Row grid', RoundedRectangle: 'Rounded rectangle',
}

/** Friendly labels are presentation only; the Swift identity stays intact. */
export function sourceLayerType(node: Pick<AuthoringNode, 'name' | 'kind'> & Partial<Pick<AuthoringNode, 'properties' | 'controls'>>): string {
  if (node.name === 'Image' && (node.properties?.some(property => property.name === 'systemName') || node.controls?.some(control => control.id === 'image' && control.label === 'System symbol'))) return 'Symbols'
  if (node.kind === 'template') return 'Row design'
  if (node.kind === 'component') return 'Component'
  return VIEW_NAMES[node.name] ?? node.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ').map((word, index) => index ? word.toLowerCase() : word).join(' ')
}

export function sourceLayerLabel(node: AuthoringNode): string {
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
  const candidates = snapshot.nodes.filter(node => node.source.file === hidden.file && (hidden.container === null
    ? node.kind === 'definition' && node.source.start <= hidden.offset && node.source.end >= hidden.offset
    : node.kind !== 'definition' && node.kind !== 'template' && node.source.start === hidden.container))
  if (candidates.length !== 1) return undefined
  const owner = candidates[0]!
  const template = snapshot.nodes.find(node => node.kind === 'template' && node.parentId === owner.id && node.source.start <= hidden.offset && node.source.end >= hidden.offset)
  return template?.id ?? owner.id
}

/** A branch can be absent from the current preview while remaining selectable. */
export function sourceLayerNotShown(snapshot: AuthoringSnapshot, node: AuthoringNode, visibleRuntimeIds?: ReadonlySet<string>): boolean {
  if (!Object.keys(snapshot.runtimeToSource).length) return false
  if (node.kind !== 'branch') {
    const ancestors = sourceLayerAncestors(new Map(snapshot.nodes.map(item => [item.id, item])), node.id)
    const branch = ancestors.map(id => snapshot.nodes.find(item => item.id === id)).find(item => item?.kind === 'branch')
    return !!branch && !node.runtimeIds.some(id => !visibleRuntimeIds || visibleRuntimeIds.has(id)) && sourceLayerNotShown(snapshot, branch, visibleRuntimeIds)
  }
  const nodes = new Map(snapshot.nodes.map(item => [item.id, item]))
  const shown = (item: AuthoringNode): boolean => item.runtimeIds.some(id => !visibleRuntimeIds || visibleRuntimeIds.has(id)) || item.children.some(id => {
    const child = nodes.get(id)
    // Otherwise is an alternative to this condition, not evidence its then-content is shown.
    return !!child && !(item.id === node.id && node.name === 'Condition' && child.name === 'Otherwise') && shown(child)
  })
  return !shown(node)
}

const STRUCTURAL_VIEWS = new Set(['ForEach', 'Group', 'NavigationStack', 'NavigationView', 'NavigationSplitView', 'WindowGroup', 'Window', 'ToolbarItem', 'ToolbarItemGroup', 'ViewThatFits', 'EmptyView'])

const friendlyComponentName = (name: string) => name.replace(/View$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\b[A-Z]\w*/g, (word, offset: number) => offset ? word.toLowerCase() : word)

/** These rows represent visible design elements, never source-control scaffolding. */
export function sourceLayerIsVisual(node: AuthoringNode): boolean {
  if (node.kind === 'component') return true
  if (!['view', 'collection', 'opaque'].includes(node.kind)) return false
  if (node.name === 'Section') return node.controls?.some(control => control.id === 'title') === true
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
}

const SEPARATE_PAGES = new Set(['Sheet', 'Full screen cover', 'Destination'])
const SECONDARY_CONTENT = new Set(['Background', 'Overlay', 'Toolbar', 'Sheet', 'Full screen cover', 'Destination', 'Safe area inset', 'Header', 'Footer'])

/** Hidden comments belong to the current phone's source scope, including empty containers. */
export function sourceLayerHiddenInScope(snapshot: AuthoringSnapshot, hidden: HiddenViewInfo, scope: readonly AuthoringNode[]): boolean {
  if (!scope.length) return true
  const nodes = new Map(snapshot.nodes.map(node => [node.id, node]))
  const contains = (node: AuthoringNode) => node.source.file === hidden.file && node.source.start <= hidden.offset && node.source.end >= hidden.offset
  const paths = scope.map(node => [node, ...sourceLayerAncestors(nodes, node.id).map(id => nodes.get(id)!)])
  const bounds = paths.map(path => path.find(node => node.kind === 'branch' && SEPARATE_PAGES.has(node.name)) ?? path.find(node => node.kind === 'definition') ?? path[0]!)
  if (!bounds.some(contains)) return false
  // A main screen declaration can also contain inline destinations and sheets.
  // Their hidden views remain with that separate screen, not its parent phone.
  return snapshot.nodes.filter(node => node.kind === 'branch' && SEPARATE_PAGES.has(node.name) && contains(node))
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
    if (!child || seen.has(childId) || child.kind === 'branch' && SECONDARY_CONTENT.has(child.name)) return []
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

/** Project Swift structure into visual views while retaining original source identities. */
export function sourceLayerRows(snapshot: AuthoringSnapshot, navigation: SourceLayerNavigation, selected: string | undefined, query: string, runtime?: SourceLayerRuntimeContext) {
  const nodes = new Map(snapshot.nodes.map(n => [n.id, n]))
  const runtimeIds = runtime?.visibleRuntimeIds ? new Set(runtime.visibleRuntimeIds) : runtime?.runtimeLayers ? new Set<string>() : undefined
  const pageRoots: string[] = []
  const discoverPage = (layers: readonly ViewLayer[], mappedParent = false) => {
    for (const layer of layers) {
      runtimeIds?.add(layer.id)
      const sourceId = snapshot.runtimeToSource[layer.id]
      // Runtime navigation chrome borrows its container's source location for
      // code reveal; a back button must not resurrect that previous screen.
      const synthetic = layer.type.startsWith('_') && nodes.get(sourceId ?? '')?.name !== layer.type
      const mapped = layer.page || synthetic ? undefined : sourceId
      if (!mappedParent && mapped) pageRoots.push(mapped)
      discoverPage(layer.children, mappedParent || !!mapped)
    }
  }
  if (runtime?.runtimeLayers) discoverPage(runtime.runtimeLayers)
  const pageContexts = runtime?.runtimeLayers ? new Set(snapshot.nodes.filter(node => node.runtimeIds.some(id => runtimeIds?.has(id))).flatMap(node => [node.id, ...sourceLayerAncestors(nodes, node.id)])) : undefined
  const ancestors = sourceLayerAncestors(nodes, selected)
  const selectionNode = selected ? nodes.get(selected) : undefined
  const selectedContext = selectionNode && (['definition', 'template'].includes(selectionNode.kind) || selectionNode.kind === 'branch' && SEPARATE_PAGES.has(selectionNode.name)) && (!pageContexts || pageContexts.has(selectionNode.id)) && navigation.dismissedEntry !== selected ? selectionNode : undefined
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
    if (!node || seen.has(id) || node.kind === 'branch' && SEPARATE_PAGES.has(node.name)) return []
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
  const childIds = new Map<string, readonly string[]>()
  const parentIds = new Map<string, string>()
  const collect = (id: string, parentId?: string, seen = new Set<string>()) => {
    if (seen.has(id) || childIds.has(id)) return
    const node = nodes.get(id)
    if (!node) return
    const children = flatten(node.children)
    childIds.set(id, children)
    if (parentId) parentIds.set(id, parentId)
    children.forEach(child => collect(child, id, new Set([...seen, id])))
  }
  roots.forEach(id => collect(id))
  const allRows = [...childIds.keys()].map(id => ({ node: nodes.get(id)! }))
  const selectedView = sourceLayerVisibleId(snapshot, selected, allRows)
  const revealed = new Set<string>()
  if (navigation.dismissed !== selected) {
    let parentId = selectedView && parentIds.get(selectedView)
    while (parentId && !revealed.has(parentId)) { revealed.add(parentId); parentId = parentIds.get(parentId) }
  }
  const needle = query.trim().toLowerCase()
  const matches = new Map<string, boolean>()
  const match = (id: string): boolean => {
    if (matches.has(id)) return matches.get(id)!
    const node = nodes.get(id)!
    const found = `${sourceLayerLabel(node)} ${sourceLayerType(node)} ${node.name}`.toLowerCase().includes(needle) || (childIds.get(id) ?? []).some(match)
    matches.set(id, found)
    return found
  }
  const rows: SourceLayerRow[] = []
  const visit = (id: string, depth: number) => {
    const node = nodes.get(id)
    if (!node || needle && !match(id)) return
    const children = childIds.get(id) ?? []
    const expanded = !!children.length && (!!needle || revealed.has(id) || !navigation.closed.has(id) && (depth === 0 && !shared.has(id) || navigation.opened?.has(id) === true))
    rows.push({ node, depth, expanded, shared: shared.has(id), parentId: parentIds.get(id), children })
    if (expanded) children.forEach(child => visit(child, depth + 1))
  }
  roots.forEach(id => visit(id, 0))
  return { rows, screens, entry, scope: (entry ? [entry] : pageRoots.map(id => nodes.get(id)!)) }
}
