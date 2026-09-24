import type { AuthoringNode, DesignEditRequest } from '@studio/shared'
import type { DesignEvent } from './eventLog'
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

/**
 * A design edit as the event log records it (G5): what kind of change, on what kind
 * of layer, and which control, library view or modifier it used.
 *
 * Built from the studio's own words only. A layer's name is the designer's unless it
 * is a built-in view, and so are the text, values and names an edit carries, so none
 * of them are read.
 */
export function designEvent(operation: DesignEditRequest['operation'], node?: AuthoringNode): DesignEvent {
  return { type: 'design', op: operation.kind, ...(node ? { layer: layerType(node) } : {}), ...details(operation, node) }
}

function layerType(node: AuthoringNode): string {
  return node.kind === 'view' || node.kind === 'collection' ? node.name : node.kind
}

function details(operation: DesignEditRequest['operation'], node: AuthoringNode | undefined): Partial<DesignEvent> {
  switch (operation.kind) {
    case 'property': return { control: controlFamily(operation.control) }
    case 'insert': {
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
