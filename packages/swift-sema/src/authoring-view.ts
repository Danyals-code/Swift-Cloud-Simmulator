import { AUTHORING_CAPABILITIES, isNonView, type AuthoringNode } from '@studio/shared'
import { GESTURE_TYPES, SUPPORTED_VIEWS } from './builtins'

const INTRODUCED: Readonly<Record<string, number>> = {
  LazyVStack: 14, LazyHStack: 14, LazyHGrid: 14, TextEditor: 14,
  DisclosureGroup: 14, ControlGroup: 15, TimelineView: 15, Canvas: 15, AsyncImage: 15,
  Grid: 16, GridRow: 16, ViewThatFits: 16, NavigationSplitView: 16, ShareLink: 16,
  Gauge: 16, ContentUnavailableView: 17,
}

/**
 * Real SwiftUI the preview draws as a labelled box, and the iOS that introduced each.
 * The box is laid out like the view, so its frame, padding and background are drawn
 * and stay editable; only the view itself is kept as written.
 */
const PLACEHOLDERS: Readonly<Record<string, number>> = {
  Chart: 16, Map: 14, PhotosPicker: 16, VideoPlayer: 14, Table: 16, MultiDatePicker: 16, OutlineGroup: 14,
  EditButton: 13, PasteButton: 16, RenameButton: 16, AnyShape: 16, MeshGradient: 18, SceneView: 13, EquatableView: 13,
}

export function authoringViewMinimum(node: AuthoringNode): number | undefined {
  if (node.properties.some(property => property.name === 'Source')) return undefined
  if (node.kind === 'opaque') return node.undrawn === 'unsupported' ? PLACEHOLDERS[node.name] : undefined
  if (node.kind === 'component') return node.definitionId ? 13 : undefined
  // The runtime's identifier registry also contains Scene, TabContent, toolbar
  // content and layout values. Those do not conform to SwiftUI.View.
  if (!['view', 'collection'].includes(node.kind) || !SUPPORTED_VIEWS.has(node.name) || isNonView(node) || GESTURE_TYPES.has(node.name)) return undefined
  const capability = AUTHORING_CAPABILITIES.find(entry => entry.kind === 'view' && entry.name === node.name)
  return capability ? Number.parseFloat(capability.minimumIOS) : INTRODUCED[node.name] ?? 13
}
