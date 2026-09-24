import type { AuthoringNode, DesignEditRequest, HiddenViewInfo } from '@studio/shared'
import type { DesignEvent, StudioChange } from './eventLog'
import { VIEW_CATALOG } from './viewCatalog'

/**
 * The first word of every control id the planner makes: `add:font`, `modifier:2:0`,
 * `component:title`. What follows it can be the designer's own name for a property,
 * so only the family is kept, and an id outside these is `other`.
 */
const CONTROL_FAMILIES: ReadonlySet<string> = new Set([
  'add', 'alignment', 'color', 'component', 'content', 'date', 'empty', 'fill', 'gauge', 'grid', 'gridrow',
  'image', 'layout', 'modifier', 'progress', 'range', 'scroll', 'shape', 'spacer', 'spacing', 'title', 'value',
])

/** Families whose second word is the studio's as well: what `add:` adds, which side `fill:` sizes. */
const NAMED_FAMILIES: ReadonlySet<string> = new Set(['add', 'fill'])

/** The views the Add View library offers, by their Swift names. */
const LIBRARY_VIEWS: ReadonlySet<string> = new Set(VIEW_CATALOG.map(entry => entry.swiftName ?? entry.name))

/** Edits of the whole project, which land on no layer: its tokens and the app's navigation. */
const PROJECT_WIDE: ReadonlySet<DesignEditRequest['operation']['kind']> = new Set([
  'style-create', 'style-edit', 'style-migrate', 'navigation-style', 'tab-add', 'tab-update', 'tab-remove', 'tab-move',
])

/**
 * A design edit as the event log records it (G5): what kind of change, on what kind
 * of layer, and which control, library view or modifier it used.
 *
 * Built from the studio's own words only. A layer's name is the designer's unless it
 * is a built-in view, and so are the text, values and names an edit carries, so none
 * of them are read. `target` is the layer the edit lands on, or the hidden view that
 * Show brings back.
 */
export function designEvent(operation: DesignEditRequest['operation'], target?: AuthoringNode | HiddenViewInfo): DesignEvent {
  const { node, hidden }: { node?: AuthoringNode; hidden?: HiddenViewInfo } = !target ? {} : 'kind' in target ? { node: target } : { hidden: target }
  const layer = PROJECT_WIDE.has(operation.kind) ? undefined : node ? layerType(node) : hidden ? libraryView(hidden.type) : undefined
  return { type: 'design', op: operation.kind, ...(layer ? { layer } : {}), ...details(operation, node) }
}

/** A copy or a paste the studio refused (C7), logged as a refused edit is: on what kind of layer, and nothing it says. */
export function refusedClipboard(op: 'copy' | 'paste', target?: AuthoringNode): DesignEvent {
  return { type: 'design', op, ...(target ? { layer: layerType(target) } : {}), refused: true }
}

/** A change to the studio's own records rather than to the Swift: screens, states, layer names, images. */
export function studioChange(op: StudioChange): DesignEvent {
  return { type: 'design', op }
}

function layerType(node: AuthoringNode): string {
  return node.kind === 'view' || node.kind === 'collection' ? node.name : node.kind
}

/** A hidden view's type, when it is one the library offers; it could be the designer's own view's name. */
function libraryView(type: string): string {
  return LIBRARY_VIEWS.has(type) ? type : 'other'
}

function details(operation: DesignEditRequest['operation'], node: AuthoringNode | undefined): Partial<DesignEvent> {
  switch (operation.kind) {
    case 'property': return { control: controlFamily(operation.control) }
    case 'insert':
    case 'paste': {
      const view = /^\s*([A-Z]\w*)/.exec(operation.snippet)?.[1]
      return view && LIBRARY_VIEWS.has(view) ? { view } : {}
    }
    case 'modifier-add': return offered(node, operation.name)
    case 'modifier-remove':
    case 'modifier-duplicate':
    case 'modifier-move':
    case 'modifier-toggle': return offered(node, node?.modifiers?.find(modifier => modifier.id === operation.modifier)?.name)
    default: return {}
  }
}

function controlFamily(id: string): string {
  const [family = '', detail = ''] = id.split(':')
  if (!CONTROL_FAMILIES.has(family)) return 'other'
  return NAMED_FAMILIES.has(family) && /^[A-Za-z]+$/.test(detail) ? `${family}:${detail}` : family
}

/** A modifier by name, when it is one the studio offers on this layer. */
function offered(node: AuthoringNode | undefined, name: string | undefined): Partial<DesignEvent> {
  return name && node?.modifierCatalog?.some(entry => entry.name === name) ? { modifier: name } : {}
}
