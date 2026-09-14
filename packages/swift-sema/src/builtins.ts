/**
 * The symbols the slice knows about.
 *
 * Split three ways, and the split is the whole point:
 *
 * - **Supported** — implemented, no diagnostic.
 * - **Known but unimplemented** — real SwiftUI, not built yet. Produces a precise
 *   "not implemented in the preview yet" warning naming the feature, which is both
 *   what FR-4.11 requires and what feeds the coverage telemetry that decides the
 *   Phase 6 build order.
 * - **Unknown** — not a symbol we recognise at all, and not declared in the project.
 *   Only this case is an error.
 *
 * The middle bucket is what stops the product lying. Without it, `NavigationStack`
 * would report as "unresolved identifier", which is both wrong and unhelpful — the
 * name is perfectly valid Swift, it is *this preview* that cannot draw it.
 */

/** Views the slice renders. Kept in sync with docs/06-VERTICAL-SLICE.md §3. */
export const SUPPORTED_VIEWS: ReadonlySet<string> = new Set([
  'VStack', 'HStack', 'ZStack', 'Spacer', 'Group',
  'Text', 'Button',
  'Rectangle', 'RoundedRectangle', 'Circle', 'Ellipse', 'Capsule',
  'EmptyView',
  'WindowGroup',
])

/** Modifiers the slice applies. */
export const SUPPORTED_MODIFIERS: ReadonlySet<string> = new Set([
  'frame', 'padding',
  'background', 'foregroundStyle', 'foregroundColor',
  'font', 'bold', 'italic', 'fontWeight',
  'opacity', 'cornerRadius',
  'onTapGesture',
])

/** Real SwiftUI views that the preview does not draw yet, with the phase that adds them. */
export const UNIMPLEMENTED_VIEWS: ReadonlyMap<string, number> = new Map([
  ['Image', 3], ['Label', 3], ['ProgressView', 3], ['Divider', 3],
  ['Toggle', 3], ['Slider', 3], ['Stepper', 3], ['TextField', 3], ['SecureField', 3],
  ['ScrollView', 3], ['ForEach', 3], ['GeometryReader', 3],
  ['LazyVStack', 6], ['LazyHStack', 6], ['LazyVGrid', 6], ['LazyHGrid', 6], ['Grid', 6],
  ['List', 6], ['Section', 6], ['Form', 6],
  ['NavigationStack', 6], ['NavigationLink', 6], ['NavigationSplitView', 6], ['TabView', 6],
  ['Picker', 6], ['DatePicker', 6], ['ColorPicker', 6], ['TextEditor', 4],
  ['Menu', 6], ['Link', 4], ['ShareLink', 6], ['Gauge', 6],
  ['AsyncImage', 6], ['Canvas', 6], ['TimelineView', 6], ['Chart', 6],
  ['ViewThatFits', 6], ['AnyView', 6], ['Path', 6],
])

/** Real SwiftUI modifiers the preview ignores for now. */
export const UNIMPLEMENTED_MODIFIERS: ReadonlyMap<string, number> = new Map([
  ['overlay', 3], ['shadow', 3], ['border', 3], ['clipShape', 3], ['clipped', 3],
  ['offset', 3], ['position', 3], ['fixedSize', 3], ['layoutPriority', 3],
  ['aspectRatio', 3], ['scaledToFit', 3], ['scaledToFill', 3],
  ['rotationEffect', 3], ['scaleEffect', 3],
  ['onAppear', 3], ['onDisappear', 3], ['disabled', 3], ['allowsHitTesting', 3],
  ['tint', 4], ['accentColor', 4], ['task', 4], ['onChange', 4],
  ['buttonStyle', 4], ['toggleStyle', 4], ['textFieldStyle', 4], ['listStyle', 6],
  ['blur', 6], ['saturation', 6], ['brightness', 6], ['contrast', 6], ['mask', 6],
  ['animation', 6], ['transition', 6], ['matchedGeometryEffect', 6],
  ['sheet', 6], ['fullScreenCover', 6], ['alert', 6], ['confirmationDialog', 6], ['popover', 6],
  ['navigationTitle', 6], ['navigationDestination', 6], ['toolbar', 6],
  ['searchable', 6], ['refreshable', 6], ['onDelete', 6], ['onMove', 6],
  ['safeAreaInset', 6], ['ignoresSafeArea', 6], ['alignmentGuide', 6],
  ['onLongPressGesture', 6], ['gesture', 6], ['simultaneousGesture', 6],
  ['accessibilityLabel', 4], ['accessibilityHint', 4], ['accessibilityValue', 4],
  ['environment', 3], ['environmentObject', 3], ['id', 3], ['tag', 6], ['zIndex', 6],
])

/** Types nameable in the slice — as a value (`Color.red`) or an annotation (`: Int`). */
export const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'Int', 'Double', 'Float', 'String', 'Bool', 'Character',
  'Array', 'Dictionary', 'Set', 'Optional', 'Range', 'ClosedRange',
  'Color', 'Font', 'Alignment', 'HorizontalAlignment', 'VerticalAlignment',
  'Edge', 'EdgeInsets', 'Angle', 'UnitPoint', 'CGFloat', 'CGSize', 'CGPoint', 'CGRect',
  'View', 'App', 'Scene', 'Identifiable', 'Equatable', 'Hashable', 'Comparable', 'Codable',
  'Void', 'Any', 'AnyObject', 'Never',
])

/** Free functions available in the slice. */
export const KNOWN_FUNCTIONS: ReadonlySet<string> = new Set([
  'print', 'min', 'max', 'abs', 'zip', 'stride',
])

/** Property wrappers, mapped to whether the slice implements them. */
export const PROPERTY_WRAPPERS: ReadonlyMap<string, { supported: boolean; phase: number }> = new Map([
  ['State', { supported: true, phase: 3 }],
  ['Binding', { supported: false, phase: 4 }],
  ['StateObject', { supported: false, phase: 4 }],
  ['ObservedObject', { supported: false, phase: 4 }],
  ['EnvironmentObject', { supported: false, phase: 4 }],
  ['Environment', { supported: false, phase: 4 }],
  ['Published', { supported: false, phase: 4 }],
  ['AppStorage', { supported: false, phase: 6 }],
  ['SceneStorage', { supported: false, phase: 6 }],
  ['FocusState', { supported: false, phase: 6 }],
  ['GestureState', { supported: false, phase: 6 }],
])

/** Attributes that are meaningful rather than property wrappers. */
export const KNOWN_ATTRIBUTES: ReadonlySet<string> = new Set([
  'main', 'ViewBuilder', 'escaping', 'autoclosure', 'available', 'discardableResult',
  'inlinable', 'frozen', 'objc', 'MainActor', 'Observable', 'Sendable',
])

export function isKnownGlobal(name: string): boolean {
  return (
    SUPPORTED_VIEWS.has(name) ||
    UNIMPLEMENTED_VIEWS.has(name) ||
    KNOWN_TYPES.has(name) ||
    KNOWN_FUNCTIONS.has(name)
  )
}

export function isKnownModifier(name: string): boolean {
  return SUPPORTED_MODIFIERS.has(name) || UNIMPLEMENTED_MODIFIERS.has(name)
}
