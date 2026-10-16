import { AUTHORING_CAPABILITIES, authoringCapabilityById, isNonView, type AuthoringNode } from '@studio/shared'
import { GESTURE_TYPES, SUPPORTED_VIEWS } from './builtins'

const INTRODUCED: Readonly<Record<string, number>> = {
  LazyVStack: 14, LazyHStack: 14, LazyHGrid: 14, TextEditor: 14, ScrollViewReader: 14,
  DisclosureGroup: 14, ControlGroup: 15, TimelineView: 15, Canvas: 15, AsyncImage: 15,
  Grid: 16, GridRow: 16, ViewThatFits: 16, NavigationSplitView: 16, ShareLink: 16,
  Gauge: 16, UnevenRoundedRectangle: 16, ContentUnavailableView: 17, PhaseAnimator: 17, KeyframeAnimator: 17,
  TabSection: 18, MeshGradient: 18,
}

/**
 * Real SwiftUI the preview draws as a labelled box, and the iOS that introduced each.
 * The box is laid out like the view, so its frame, padding and background are drawn
 * and stay editable; only the view itself is kept as written.
 */
const PLACEHOLDERS: Readonly<Record<string, number>> = {
  Chart: 16, Map: 14, PhotosPicker: 16, VideoPlayer: 14, Table: 16, MultiDatePicker: 16, OutlineGroup: 14,
  EditButton: 13, PasteButton: 16, RenameButton: 16, AnyShape: 16, SceneView: 13, EquatableView: 13,
}

/**
 * Whether a call of `name` is one of SwiftUI's own views (Wave 4c): one the preview draws, or a
 * colour written as a view, `Color.blue` or `Color(…)`, which is a view as much as a shape is
 * though `SUPPORTED_VIEWS` keeps Color among the preview's colours.
 */
export const isSwiftUIView = (name: string): boolean => SUPPORTED_VIEWS.has(name) || name === 'Color'
/** Whether a layer is a colour written as a view (Wave 4c), whose colour is its Fill. */
export const isColorView = (node: Pick<AuthoringNode, 'kind' | 'name'>): boolean => node.kind === 'view' && node.name === 'Color'

export function authoringViewMinimum(node: AuthoringNode): number | undefined {
  if (node.properties.some(property => property.name === 'Source')) return undefined
  if (node.kind === 'opaque') return node.undrawn === 'unsupported' ? PLACEHOLDERS[node.name] : undefined
  if (node.kind === 'component') return node.definitionId ? 13 : undefined
  // The runtime's identifier registry also contains Scene, TabContent, toolbar
  // content and layout values. Those do not conform to SwiftUI.View.
  if (!['view', 'collection'].includes(node.kind) || !isSwiftUIView(node.name) || isNonView(node) || GESTURE_TYPES.has(node.name)) return undefined
  // The form written decides where it has one of its own (Wave 4c): `GroupBox("Title")` is iOS 15's, `GroupBox { }` iOS 14's.
  const form = node.properties.find(property => property.capability?.startsWith('view.'))?.capability
  const capability = (form && authoringCapabilityById(form)) || AUTHORING_CAPABILITIES.find(entry => entry.kind === 'view' && entry.name === node.name)
  return capability ? Number.parseFloat(capability.minimumIOS) : INTRODUCED[node.name] ?? 13
}
