/**
 * The symbols the preview knows about.
 *
 * Split three ways, and the split is the whole point:
 *
 * - **Supported** - implemented, no diagnostic.
 * - **Known but unimplemented** - real SwiftUI, not built yet. Produces a precise
 *   "not implemented in the preview yet" warning naming the feature, which is both
 *   what FR-4.11 requires and what feeds the coverage telemetry that decides the
 *   build order.
 * - **Unknown** - not a symbol we recognise at all, and not declared in the project.
 *   Only this case is an error.
 *
 * The middle bucket is what stops the product lying. Without it, `Chart` would report
 * as "unresolved identifier", which is both wrong and unhelpful - the name is
 * perfectly valid Swift, it is *this preview* that cannot draw it.
 *
 * Kept in sync with docs/05-SWIFTUI-COVERAGE.md, which is the public version of this
 * same table. A name may only move up a bucket in the same change that makes it true.
 */

/** Views the preview renders. */
export const SUPPORTED_VIEWS: ReadonlySet<string> = new Set([
  // layout
  'VStack', 'HStack', 'ZStack', 'Spacer', 'Group', 'Divider',
  'LazyVStack', 'LazyHStack', 'LazyVGrid', 'LazyHGrid',
  'Grid', 'GridRow', 'ViewThatFits', 'GeometryReader',
  'ScrollView', 'ForEach',
  // content
  'Text', 'Image', 'Label', 'Link',
  // controls
  'Button', 'Toggle', 'TextField', 'SecureField', 'Slider', 'Stepper', 'ProgressView', 'Picker',
  // collections and navigation
  'List', 'Section', 'Form',
  'NavigationStack', 'NavigationView', 'NavigationLink', 'TabView',
  'DisclosureGroup', 'AnyView',
  // controls drawn plainly
  'DatePicker', 'ColorPicker', 'TextEditor', 'Menu', 'ShareLink', 'Gauge', 'AsyncImage',
  // shapes and drawing
  'Rectangle', 'RoundedRectangle', 'Circle', 'Ellipse', 'Capsule', 'Path', 'Canvas',
  // styles
  'LinearGradient', 'RadialGradient', 'AngularGradient', 'GridItem',
  // gestures
  'DragGesture', 'LongPressGesture', 'TapGesture', 'SpatialTapGesture',
  'MagnificationGesture', 'MagnifyGesture', 'RotationGesture', 'RotateGesture',
  // structure
  'EmptyView', 'WindowGroup', 'ToolbarItem', 'ToolbarItemGroup',
])

/** Modifiers the preview applies. */
export const SUPPORTED_MODIFIERS: ReadonlySet<string> = new Set([
  // composition
  'modifier',
  // layout
  'frame', 'padding', 'offset', 'position', 'fixedSize', 'clipShape', 'clipped',
  'layoutPriority', 'aspectRatio', 'scaledToFit', 'scaledToFill',
  // appearance
  'background', 'overlay', 'border', 'shadow', 'cornerRadius', 'opacity',
  'foregroundStyle', 'foregroundColor', 'tint', 'resizable',
  // typography
  'font', 'bold', 'italic', 'fontWeight', 'fontDesign',
  'lineLimit', 'multilineTextAlignment', 'textCase',
  // transforms, filters and motion
  'scaleEffect', 'rotationEffect', 'animation', 'transition',
  'blur', 'saturation', 'brightness', 'contrast', 'grayscale',
  // drawing styles
  'fill', 'stroke', 'trim',
  // accessibility
  'accessibilityLabel', 'accessibilityValue', 'accessibilityHint', 'accessibilityHidden',
  'allowsHitTesting',
  // navigation and presentation
  'navigationTitle', 'navigationBarTitleDisplayMode', 'navigationDestination', 'toolbar',
  'sheet', 'fullScreenCover', 'alert', 'confirmationDialog', 'presentationDetents',
  'tabItem', 'tag',
  // lists
  'listStyle', 'listRowBackground',
  // interaction
  'onTapGesture', 'onLongPressGesture', 'disabled', 'buttonStyle', 'textFieldStyle',
  'gesture', 'simultaneousGesture', 'highPriorityGesture',
  // lifecycle
  'onAppear', 'onDisappear', 'task', 'onChange',
  // lists and forms
  'searchable', 'onDelete', 'onMove', 'swipeActions', 'contextMenu', 'badge',
  'listRowSeparator', 'listRowInsets', 'scrollIndicators',
  // text entry
  'keyboardType', 'submitLabel', 'onSubmit', 'focused',
  // styles that are recognised and drawn plainly
  'toggleStyle', 'pickerStyle', 'labelStyle', 'monospaced', 'placeholder',
  // device edges
  'ignoresSafeArea', 'safeAreaInset', 'id', 'zIndex',
  // Environment injection.
  'environment', 'environmentObject',
  // The deprecated spelling of `.tint`, and a `Color` property of the same name.
  'accentColor',
])

/** Real SwiftUI views that the preview does not draw yet, with the phase that adds them. */
export const UNIMPLEMENTED_VIEWS: ReadonlyMap<string, number> = new Map([
  ['NavigationSplitView', 7],

  ['TimelineView', 7], ['Chart', 7],
  ['Table', 7], ['OutlineGroup', 7],
])

/** Real SwiftUI modifiers the preview ignores for now. */
export const UNIMPLEMENTED_MODIFIERS: ReadonlyMap<string, number> = new Map([
  ['mask', 7], ['popover', 7], ['refreshable', 7], ['alignmentGuide', 7],
  ['kerning', 7], ['minimumScaleFactor', 7],
  ['scrollDismissesKeyboard', 7], ['scrollTargetBehavior', 7],
  ['symbolRenderingMode', 7], ['imageScale', 7], ['interpolation', 7],
  ['matchedGeometryEffect', 7], ['phaseAnimator', 7], ['keyframeAnimator', 7],
  ['kerning', 7],
  ['monospaced', 7], ['minimumScaleFactor', 7],
  ['scrollDismissesKeyboard', 7], ['scrollTargetBehavior', 7],
  ['symbolRenderingMode', 7], ['imageScale', 7], ['interpolation', 7],
])

/** Types nameable in the preview - as a value (`Color.red`) or an annotation (`: Int`). */
export const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'Int', 'Double', 'Float', 'String', 'Bool', 'Character',
  'Array', 'Dictionary', 'Set', 'Optional', 'Range', 'ClosedRange',
  'Color', 'Font', 'Alignment', 'HorizontalAlignment', 'VerticalAlignment',
  'Edge', 'EdgeInsets', 'Angle', 'UnitPoint', 'CGFloat', 'CGSize', 'CGPoint', 'CGRect',
  'Animation', 'AnyTransition', 'Axis', 'ContentMode', 'PresentationDetent',
  'ToolbarItemPlacement', 'Binding', 'UUID', 'Date',
  'ObservableObject', 'AnyObject', 'Error', 'DynamicTypeSize', 'ColorScheme',
  'Task', 'MainActor', 'Duration', 'Sendable', 'Comparable', 'Equatable', 'Hashable',
  'ViewModifier', 'ButtonStyle', 'LabelStyle', 'ToggleStyle', 'Configuration',
  'Content', 'Body',
  'ButtonStyleConfiguration', 'Layout', 'PreferenceKey', 'Animatable',
  'Codable', 'Decodable', 'Encodable', 'CaseIterable', 'CustomStringConvertible',
  'LayoutDirection', 'UserInterfaceSizeClass', 'Locale',
  'View', 'App', 'Scene', 'Identifiable', 'Equatable', 'Hashable', 'Comparable', 'Codable',
  'Void', 'Any', 'AnyObject', 'Never',
])

/** Free functions available in the preview. */
export const KNOWN_FUNCTIONS: ReadonlySet<string> = new Set([
  'print', 'min', 'max', 'abs', 'zip', 'stride', 'withAnimation',
])

/** Property wrappers, mapped to whether the preview implements them. */
export const PROPERTY_WRAPPERS: ReadonlyMap<string, { supported: boolean; phase: number }> = new Map([
  ['State', { supported: true, phase: 3 }],
  ['Binding', { supported: true, phase: 6 }],
  ['StateObject', { supported: true, phase: 7 }],
  ['ObservedObject', { supported: true, phase: 7 }],
  ['EnvironmentObject', { supported: true, phase: 7 }],
  ['Environment', { supported: true, phase: 7 }],
  // A stored property on a class, which is a reference - so a change is visible
  // everywhere holding it, with or without the wrapper.
  ['Published', { supported: true, phase: 7 }],
  ['AppStorage', { supported: false, phase: 7 }],
  ['SceneStorage', { supported: false, phase: 7 }],
  ['FocusState', { supported: false, phase: 7 }],
  ['GestureState', { supported: true, phase: 7 }],
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
