import { AUTHORING_CAPABILITIES, type AuthoringNode } from '@studio/shared'
import { GESTURE_TYPES, SUPPORTED_VIEWS } from './builtins'

// The runtime's identifier registry also contains Scene, TabContent, toolbar
// content and layout values. Those do not conform to SwiftUI.View.
const NON_VIEWS = new Set(['WindowGroup', 'Tab', 'ToolbarItem', 'ToolbarItemGroup', 'GridItem'])
const INTRODUCED: Readonly<Record<string, number>> = {
  LazyVStack: 14, LazyHStack: 14, LazyHGrid: 14, TextEditor: 14,
  DisclosureGroup: 14, ControlGroup: 15, TimelineView: 15, Canvas: 15, AsyncImage: 15,
  Grid: 16, GridRow: 16, ViewThatFits: 16, NavigationSplitView: 16, ShareLink: 16,
  Gauge: 16, ContentUnavailableView: 17,
}

export function authoringViewMinimum(node: AuthoringNode): number | undefined {
  if (node.properties.some(property => property.name === 'Source')) return undefined
  if (node.kind === 'component') return node.definitionId ? 13 : undefined
  if (!['view', 'collection'].includes(node.kind) || !SUPPORTED_VIEWS.has(node.name) || NON_VIEWS.has(node.name) || GESTURE_TYPES.has(node.name)) return undefined
  const capability = AUTHORING_CAPABILITIES.find(entry => entry.kind === 'view' && entry.name === node.name)
  return capability ? Number.parseFloat(capability.minimumIOS) : INTRODUCED[node.name] ?? 13
}
