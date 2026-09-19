import { reconcileAuthoringSelection, type AuthoringNode, type AuthoringSelection, type AuthoringSnapshot, type HiddenViewInfo, type SourceFile } from '@studio/shared'

export interface SourceLayerNavigation {
  readonly snapshot: AuthoringSnapshot
  readonly files: readonly SourceFile[]
  readonly entered?: string
  readonly closed: ReadonlySet<string>
  readonly dismissed?: string
  readonly selection?: AuthoringSelection
  readonly componentsOpen?: boolean
}

/** IDs are local to one snapshot; rebase tree navigation just like selection. */
export function rebaseSourceLayers(state: SourceLayerNavigation, snapshot: AuthoringSnapshot, files: readonly SourceFile[], selection?: AuthoringSelection): SourceLayerNavigation {
  if (state.snapshot === snapshot) return state.selection === selection ? state : { ...state, selection, dismissed: undefined }
  const resolve = (id: string | undefined) => id ? reconcileAuthoringSelection({ snapshot: state.snapshot, nodeId: id, files: state.files }, snapshot, files)?.id : undefined
  return { snapshot, files, entered: resolve(state.entered), closed: new Set([...state.closed].map(resolve).filter((id): id is string => !!id)), selection, componentsOpen: state.snapshot.projectId === snapshot.projectId && state.componentsOpen, dismissed: state.selection === selection ? resolve(state.dismissed) : undefined }
}

const VIEW_NAMES: Readonly<Record<string, string>> = {
  VStack: 'Column', LazyVStack: 'Lazy column', HStack: 'Row', LazyHStack: 'Lazy row', ZStack: 'Stack',
  ForEach: 'Repeat', ScrollView: 'Scroll', NavigationStack: 'Navigation', NavigationView: 'Navigation',
  NavigationSplitView: 'Split navigation', NavigationLink: 'Navigation link', TabView: 'Tabs',
  TextField: 'Text field', SecureField: 'Password field', DatePicker: 'Date picker', ColorPicker: 'Color picker',
  ProgressView: 'Progress', AsyncImage: 'Remote image', GroupBox: 'Group box', GridRow: 'Grid row',
  LazyVGrid: 'Column grid', LazyHGrid: 'Row grid', RoundedRectangle: 'Rounded rectangle',
}

/** Friendly labels are presentation only; the Swift identity stays intact. */
export function sourceLayerType(node: Pick<AuthoringNode, 'name' | 'kind'>): string {
  if (node.kind === 'template') return 'Row design'
  if (node.kind === 'component') return 'Component'
  return VIEW_NAMES[node.name] ?? node.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ').map((word, index) => index ? word.toLowerCase() : word).join(' ')
}

export function sourceLayerLabel(node: AuthoringNode): string {
  if (node.kind === 'definition') return node.owner
  if (node.kind === 'branch' && node.properties[0]) {
    if (node.name === 'When' || node.name === 'Condition') return `When ${node.properties.map(property => property.expression).join(' and ')}`
    if (node.name === 'Switch') return `Match ${node.properties[0].expression}`
  }
  return node.controls?.find(c => c.id === 'content' || c.id === 'title')?.value || (node.kind === 'component' ? node.name : sourceLayerType(node))
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
export function sourceLayerNotShown(snapshot: AuthoringSnapshot, node: AuthoringNode): boolean {
  if (node.kind !== 'branch' || !Object.keys(snapshot.runtimeToSource).length) return false
  const nodes = new Map(snapshot.nodes.map(item => [item.id, item]))
  const shown = (item: AuthoringNode): boolean => item.runtimeIds.length > 0 || item.children.some(id => {
    const child = nodes.get(id)
    // Otherwise is an alternative to this condition, not evidence its then-content is shown.
    return !!child && !(item.id === node.id && node.name === 'Condition' && child.name === 'Otherwise') && shown(child)
  })
  return !shown(node)
}

export function sourceLayerRows(snapshot: AuthoringSnapshot, navigation: SourceLayerNavigation, selected: string | undefined, query: string) {
  const nodes = new Map(snapshot.nodes.map(n => [n.id, n]))
  const ancestors = sourceLayerAncestors(nodes, selected)
  const entry = navigation.entered && (!selected || selected === navigation.entered || ancestors.includes(navigation.entered)) ? nodes.get(navigation.entered) : undefined
  const appRoots = snapshot.roots.filter(id => nodes.get(id)?.children.some(child => nodes.get(child)?.name === 'WindowGroup'))
  const screens = new Set<string>()
  const discover = (id: string) => { const node = nodes.get(id); if (node?.definitionId) screens.add(node.definitionId); else node?.children.forEach(discover) }
  appRoots.forEach(discover)
  const roots = snapshot.roots.filter(id => !appRoots.includes(id))
  if (!screens.size) {
    const referenced = new Set(snapshot.nodes.flatMap(node => node.definitionId ? [node.definitionId] : []))
    roots.filter(id => !referenced.has(id)).forEach(id => screens.add(id))
  }
  const components = roots.filter(id => !screens.has(id))
  const needle = query.trim().toLowerCase()
  const componentsExpanded = !!needle || !!navigation.componentsOpen || navigation.dismissed !== selected && components.some(id => id === selected || ancestors.includes(id))
  const shownRoots = entry ? [entry.id] : [...roots.filter(id => screens.has(id)), ...(componentsExpanded ? components : [])]
  const revealed = new Set(navigation.dismissed === selected ? [] : ancestors)
  const matches = new Map<string, boolean>()
  const match = (node: AuthoringNode): boolean => {
    if (matches.has(node.id)) return matches.get(node.id)!
    const found = `${sourceLayerLabel(node)} ${sourceLayerType(node)} ${node.name} ${node.owner}`.toLowerCase().includes(needle) || node.children.some(id => { const child = nodes.get(id); return !!child && match(child) })
    matches.set(node.id, found)
    return found
  }
  const rows: { node: AuthoringNode; depth: number; expanded: boolean; component: boolean }[] = []
  const visit = (id: string, depth: number, component: boolean) => {
    const node = nodes.get(id)
    if (!node || needle && !match(node)) return
    const expanded = !!node.children.length && (!!needle || revealed.has(id) || !navigation.closed.has(id))
    rows.push({ node, depth, expanded, component })
    if (expanded) node.children.forEach(child => visit(child, depth + 1, component))
  }
  shownRoots.forEach(id => visit(id, 0, !entry && components.includes(id)))
  return { rows, screens, entry, components, componentsExpanded }
}
