import type { AuthoringNode, AuthoringSnapshot } from '@studio/shared'
import { sourceLayerIsVisual } from './sourceLayers'

const CONTENT_SLOTS = new Set(['Background', 'Overlay', 'Toolbar', 'Sheet', 'Full screen cover', 'Destination', 'Safe area inset', 'Header', 'Footer'])
const NAVIGATION = new Set(['NavigationStack', 'NavigationView', 'NavigationSplitView', 'NavigationLink'])

/** The source tree keeps ownership; the designer tree only changes its presentation. */
export function authoringSettingsContext(snapshot: AuthoringSnapshot | undefined, selected: AuthoringNode) {
  const nodes = new Map(snapshot?.nodes.map(node => [node.id, node]) ?? [[selected.id, selected]])
  const ancestors: AuthoringNode[] = []
  let parent = selected.parentId ? nodes.get(selected.parentId) : undefined
  while (parent && !ancestors.some(node => node.id === parent!.id)) {
    ancestors.unshift(parent)
    parent = parent.parentId ? nodes.get(parent.parentId) : undefined
  }
  const wrappers: AuthoringNode[] = []
  const collect = (node: AuthoringNode) => {
    for (const id of node.children) {
      const child = nodes.get(id)
      if (!child || sourceLayerIsVisual(child)) continue
      wrappers.push(child)
      collect(child)
    }
  }
  collect(selected)
  // App root forwarding is hidden by Layers, but its exact call-site settings still apply.
  // A shared definition never chooses one of several callers on the user's behalf.
  const forwarded: AuthoringNode[] = []
  const calls = new Map<string, AuthoringNode[]>()
  for (const node of nodes.values()) if (node.definitionId) calls.set(node.definitionId, [...(calls.get(node.definitionId) ?? []), node])
  const visualChildren = (node: AuthoringNode): AuthoringNode[] => node.children.flatMap(id => {
    const child = nodes.get(id)
    return !child ? [] : sourceLayerIsVisual(child) ? [child] : visualChildren(child)
  })
  let definition = selected.kind === 'definition' ? selected : [...ancestors].reverse().find(node => node.kind === 'definition')
  const seen = new Set<string>()
  while (definition && !seen.has(definition.id)) {
    seen.add(definition.id)
    const references = calls.get(definition.id) ?? []
    if (references.length !== 1) break
    const call = references[0]!
    const path: AuthoringNode[] = []
    let owner = call.parentId ? nodes.get(call.parentId) : undefined
    while (owner && owner.kind !== 'definition' && !path.some(node => node.id === owner!.id)) {
      path.push(owner)
      owner = owner.parentId ? nodes.get(owner.parentId) : undefined
    }
    if (!owner || owner.kind !== 'definition') break
    const content = visualChildren(owner)
    if (content.length !== 1 || content[0]!.id !== call.id || visualChildren(call).length) break
    forwarded.unshift(...path.reverse(), call)
    definition = owner
  }
  const context = [...forwarded, ...ancestors.filter(node => !sourceLayerIsVisual(node) && node.kind !== 'definition'), ...wrappers]
  const unique = (items: AuthoringNode[]) => items.filter((node, index) => items.findIndex(other => other.id === node.id) === index)
  const collections = unique([...(selected.kind === 'collection' ? [selected] : []), ...wrappers.filter(node => node.kind === 'collection')])
  const repeatedBy = [...ancestors].reverse().find(node => node.kind === 'collection')
  const list = [...ancestors, selected].reverse().find(node => node.name === 'List')
  const conditions = unique(context.filter(node => node.kind === 'branch' && ['Condition', 'When', 'Switch', 'Otherwise'].includes(node.name) || node.kind === 'branch' && node.name.startsWith('Case ')))
  const navigation = unique([...(NAVIGATION.has(selected.name) ? [selected] : []), ...context.filter(node => NAVIGATION.has(node.name))])
  const slots = unique(context.filter(node => node.kind === 'branch' && CONTENT_SLOTS.has(node.name)))
  const surrounding = unique(context.filter(node => node.kind !== 'branch' && node.kind !== 'template' && (!!node.modifiers?.length || (node.kind === 'component' ? node.properties.length > 0 || node.controls?.some(control => !/^(add:|fill:)/.test(control.id)) : !!node.controls?.length))))
  return { nodes, ancestors, wrappers, forwarded, collections, repeatedBy, list, conditions, navigation, slots, surrounding }
}

/** Choose useful editable content without making a settings action stop on a Swift wrapper. */
/**
 * Whether `node` is a Repeat over a range of numbers, as the library writes it:
 * `ForEach(0..<3, id: \.self)`. Its rows can become records (D13); a Repeat over data
 * has records of its own already.
 */
export function repeatsOverRange(node: AuthoringNode): boolean {
  const data = node.name === 'ForEach' ? node.properties.find(property => property.name === 'argument 1')?.expression.trim() : undefined
  return !!data && /^-?\d+\s*\.\.[.<]\s*-?\d+$/.test(data)
}

export function settingsVisualChildren(snapshot: AuthoringSnapshot | undefined, parent: AuthoringNode): AuthoringNode[] {
  const nodes = new Map(snapshot?.nodes.map(node => [node.id, node]) ?? [])
  const children: AuthoringNode[] = []
  const visit = (node: AuthoringNode) => {
    for (const id of node.children) {
      const child = nodes.get(id)
      // A row's label/content is separate from its destination, toolbar or decoration.
      // Selecting that slot explicitly starts at its own children, so they stay accessible.
      if (!child || child.kind === 'branch' && CONTENT_SLOTS.has(child.name)) continue
      if (sourceLayerIsVisual(child)) children.push(child)
      else visit(child)
    }
  }
  visit(parent)
  return children
}

export function settingsContextLabel(node: AuthoringNode): string {
  if (node.kind === 'component') return 'App container'
  if (node.kind === 'collection') return 'Repeated content'
  if (node.name === 'NavigationLink') return 'Row navigation'
  if (NAVIGATION.has(node.name)) return 'Screen navigation'
  if (node.name === 'Section') return 'List section'
  if (node.name === 'Group') return 'Content group'
  if (node.name === 'ToolbarItem' || node.name === 'ToolbarItemGroup') return 'Toolbar placement'
  return node.name
}
