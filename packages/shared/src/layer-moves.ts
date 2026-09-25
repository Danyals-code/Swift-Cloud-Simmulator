import type { AuthoringNode } from './authoring'
import type { DropPosition } from './protocol'

export const LAYER_MOVE_CONTAINERS: ReadonlySet<string> = new Set(['VStack', 'HStack', 'ZStack', 'LazyVStack', 'LazyHStack', 'Group', 'ScrollView'])

/** A layer that the structural actions - move, copy, duplicate, wrap, hide, delete, add beside - take as a whole. */
export function isStructuralLayer(node: AuthoringNode): boolean {
  return ['view', 'component', 'collection'].includes(node.kind) && node.name !== 'WindowGroup' && !node.argument
}

/** Why a view written as an argument - `.overlay(Circle())` - cannot take them, naming the slot it fills. */
export function argumentLayerProblem(nodes: readonly AuthoringNode[], node: AuthoringNode): string | null {
  if (!node.argument) return null
  const slot = nodes.find(item => item.id === node.parentId)?.name.toLowerCase() ?? 'view'
  return `The ${slot} is part of the view it is attached to, so it can’t be moved, wrapped, copied, hidden or deleted on its own. Select that view instead.`
}

/** Each snapshot's nodes by id, made once: every view of a screen is asked about as it is read. */
const INDEXES = new WeakMap<readonly AuthoringNode[], ReadonlyMap<string, AuthoringNode>>()
function indexOf(nodes: readonly AuthoringNode[]): ReadonlyMap<string, AuthoringNode> {
  let index = INDEXES.get(nodes)
  if (!index) INDEXES.set(nodes, index = new Map(nodes.map(node => [node.id, node])))
  return index
}

/** Views that take taps of their own: making one tappable would put a tap inside a tap. */
const TAKES_TAPS: ReadonlySet<string> = new Set(['Button', 'NavigationLink', 'Link', 'ShareLink', 'Menu', 'Toggle', 'TextField', 'SecureField', 'TextEditor', 'Slider', 'Stepper', 'Picker', 'DatePicker', 'ColorPicker'])
/** Views that scroll, or hold screens: a tap on one would take every drag and tap inside it. */
const HOLDS_SCREENS: ReadonlySet<string> = new Set(['ScrollView', 'List', 'Form', 'TabView', 'NavigationStack', 'NavigationView', 'NavigationSplitView'])

/**
 * Why a view cannot be made tappable (D16), or null when it can: it takes taps of its own,
 * it scrolls, it is inside something tappable already, or it is the screen itself.
 */
export function tappableProblem(nodes: readonly AuthoringNode[], node: AuthoringNode): string | null {
  if (!isStructuralLayer(node)) return argumentLayerProblem(nodes, node) ?? 'Select a view on a screen.'
  if (TAKES_TAPS.has(node.name)) return 'It takes taps already. Set what it does under When tapped.'
  if (HOLDS_SCREENS.has(node.name)) return 'A view that scrolls can’t be tapped as a whole. Make a view inside it tappable.'
  const byId = indexOf(nodes)
  // The screen's content is the screen, under whatever holds only it: a NavigationStack, a ScrollView.
  let only = true
  for (let child = node, parent = byId.get(node.parentId ?? ''); parent; child = parent, parent = byId.get(parent.parentId ?? '')) {
    if (parent.kind === 'definition') return only ? 'The screen itself can’t be tapped. Make a view on it tappable.' : null
    if (parent.name === 'Button' || parent.name === 'NavigationLink') return 'It is inside something tappable already. Select that to set what a tap does.'
    // A repeat stands for many rows, however few are written.
    only &&= parent.kind !== 'collection' && parent.kind !== 'template' && parent.children.length === 1 && parent.children[0] === child.id
  }
  return null
}

/** The three ways a stack lays its views out: as a Column, a Row or an Overlap (D3). */
export type StackLayout = 'VStack' | 'HStack' | 'ZStack'

/** Each layout in Figma's words (D3). */
export const LAYOUT_WORDS: Readonly<Record<StackLayout, string>> = { VStack: 'Column', HStack: 'Row', ZStack: 'Overlap' }

/** Which way a stack lays its views out, a lazy one as its plain one does, or undefined for any other view. */
export function stackLayoutOf(name: string): StackLayout | undefined {
  return name === 'VStack' || name === 'LazyVStack' ? 'VStack' : name === 'HStack' || name === 'LazyHStack' ? 'HStack' : name === 'ZStack' ? 'ZStack' : undefined
}

/** What lays a layer out: its parent, past the conditions, repeats and groups that only pass their views on. */
export function layoutParentOf(nodes: readonly AuthoringNode[], node: AuthoringNode): AuthoringNode | undefined {
  const byId = new Map(nodes.map(item => [item.id, item]))
  let parent = byId.get(node.parentId ?? '')
  while (parent && (['branch', 'collection', 'template'].includes(parent.kind) || parent.name === 'Group' || parent.name === 'ForEach')) parent = byId.get(parent.parentId ?? '')
  return parent
}

/**
 * The stack a group of layers goes into so that nothing moves (D3): the way their parent
 * lays them out (a row in a row, an overlap in an overlap), and a column otherwise.
 */
export function groupLayoutOf(nodes: readonly AuthoringNode[], node: AuthoringNode): StackLayout {
  const parent = layoutParentOf(nodes, node)
  const scrollsAcross = parent?.name === 'ScrollView' && parent.controls?.some(control => control.id === 'scroll:axis' && control.value === 'horizontal')
  return (parent && stackLayoutOf(parent.name)) ?? (scrollsAcross ? 'HStack' : 'VStack')
}

/** Structural eligibility shared by the picker, drag targets, and source writer.
 * The writer additionally checks syntax, adjacency, and local bindings. */
export function layerMoveProblem(nodes: readonly AuthoringNode[], ids: readonly string[], destination: AuthoringNode): string | null {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const selected = ids.map(id => byId.get(id))
  const first = selected[0]
  if (!first || selected.some(node => !node || !isStructuralLayer(node) || node.parentId !== first.parentId || node.owner !== first.owner || node.source.file !== first.source.file)) return 'Select layers with the same parent.'
  if (!['view', 'collection'].includes(destination.kind) || !LAYER_MOVE_CONTAINERS.has(destination.name) || destination.owner !== first.owner || destination.source.file !== first.source.file) return 'Choose a layout container on this screen.'
  if (selected.some(node => node && destination.source.start >= node.source.start && destination.source.end <= node.source.end)) return 'A layer cannot be moved inside itself or its children.'
  if (layerScope(byId, first) !== layerScope(byId, destination)) return LEAVES_SCOPE
  if (byId.get(first.parentId ?? '')?.kind === 'definition') return 'The screen must keep its root layout.'
  const siblings = byId.get(first.parentId ?? '')?.children ?? []
  const positions = selected.map(node => siblings.indexOf(node!.id)).sort((a, b) => a - b)
  if (positions.some((position, index) => position < 0 || index > 0 && position !== positions[index - 1]! + 1)) return 'Select adjacent layers to keep their layout order predictable.'
  return null
}

const LEAVES_SCOPE = 'Move within the same screen or repeated row to preserve its values and conditions.'

/** What layers are drawn in, rather than layers: a screen or component, a repeated row, a condition or slot. */
const SCOPE_KINDS: ReadonlySet<string> = new Set(['definition', 'template', 'branch'])

/** The screen, repeated row or condition a layer is drawn in, which its values and conditions come from. */
function layerScope(byId: ReadonlyMap<string, AuthoringNode>, node: AuthoringNode): string | undefined {
  let parent = byId.get(node.parentId ?? '')
  while (parent && !SCOPE_KINDS.has(parent.kind)) parent = byId.get(parent.parentId ?? '')
  return parent?.id
}

/**
 * Why the canvas cannot drop `node` at the view starting at `target` (C5), or null.
 *
 * The canvas drops onto what it draws, which can be a view no layer stands for: one a
 * helper draws, where the view dropped is drawn once per call, or not at all on iOS.
 * A drop also keeps to the screen or component the view is in, whose every copy shares
 * its views, and to its repeated row or condition, as a move in Layers does.
 */
export function canvasDropProblem(nodes: readonly AuthoringNode[], node: AuthoringNode, target: { readonly file: string; readonly start: number }, position: DropPosition): string | null {
  const byId = new Map(nodes.map(item => [item.id, item]))
  const onto = nodes.find(item => item.source.file === target.file && item.source.start === target.start && !SCOPE_KINDS.has(item.kind))
  if (!onto) return 'Drop it on a layer of this screen. That spot is drawn by a helper in the Swift code, where a view could repeat or disappear.'
  if (onto.owner !== node.owner || onto.source.file !== node.source.file) return `Move it within ${node.owner}. A view moved into or out of a component would change every copy of it.`
  // Inside a list's rows is inside its row design; anywhere else is where the view dropped on is drawn.
  const rows = position === 'inside' && onto.kind === 'collection' ? nodes.find(item => item.parentId === onto.id && item.kind === 'template') : undefined
  return layerScope(byId, node) === (rows?.id ?? layerScope(byId, onto)) ? null : LEAVES_SCOPE
}
