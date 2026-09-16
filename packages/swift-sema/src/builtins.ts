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
  'DisclosureGroup', 'AnyView', 'GroupBox', 'LabeledContent', 'ControlGroup',
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
  'underline', 'strikethrough', 'kerning', 'tracking', 'baselineOffset', 'lineSpacing',
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
  'ignoresSafeArea', 'id',
  // Environment injection.
  'environment', 'environmentObject',
  // The deprecated spelling of `.tint`, and a `Color` property of the same name.
  'accentColor',
])

/**
 * Names that make something a gesture rather than a view.
 *
 * They sit in `SUPPORTED_VIEWS` because that set is really "identifiers the preview
 * knows", but a chain rooted at one of them is a gesture builder - `.onChanged`,
 * `.updating` - not a modifier chain, so the coverage check must not treat its
 * members as modifiers.
 */
export const GESTURE_TYPES: ReadonlySet<string> = new Set([
  'DragGesture', 'LongPressGesture', 'TapGesture', 'SpatialTapGesture',
  'MagnificationGesture', 'MagnifyGesture', 'RotationGesture', 'RotateGesture',
])

/** Members that appear on a view-rooted chain without being modifiers. */
export const NON_MODIFIER_MEMBERS: ReadonlySet<string> = new Set([
  // Gesture builders, in case one is reached through a view root.
  'onChanged', 'onEnded', 'updating', 'sequenced', 'exclusively', 'simultaneously',
  // `Path` and `AnyTransition` builders.
  'move', 'addLine', 'addCurve', 'addQuadCurve', 'addArc', 'addRect', 'addEllipse',
  'addRoundedRect', 'addPath', 'closeSubpath', 'combined', 'asymmetric',
  // Reached on a shape or a style rather than on the view.
  'opacity', 'init',
])

/**
 * Modifiers whose argument labels are known *completely*.
 *
 * Only these are label-checked, and the bar for adding one is that the whole set can
 * be written down with confidence. A label the preview silently ignores is a value
 * the user typed and never sees applied - `.frame(wdith: 10)` lays out at the
 * intrinsic width and says nothing - but a warning on a label that does exist would
 * be worse, so the table stays small rather than guessing at the large signatures.
 */
export const MODIFIER_LABELS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    'frame',
    new Set([
      'width', 'height', 'alignment',
      'minWidth', 'idealWidth', 'maxWidth',
      'minHeight', 'idealHeight', 'maxHeight',
      'depth', 'minDepth', 'idealDepth', 'maxDepth', 'alignment3D',
    ]),
  ],
  ['offset', new Set(['x', 'y'])],
  ['position', new Set(['x', 'y'])],
  ['shadow', new Set(['color', 'radius', 'x', 'y'])],
  ['blur', new Set(['radius', 'opaque'])],
  ['fixedSize', new Set(['horizontal', 'vertical'])],
  ['scaleEffect', new Set(['x', 'y', 'anchor'])],
  ['rotationEffect', new Set(['anchor'])],
  ['aspectRatio', new Set(['contentMode'])],
  ['border', new Set(['width'])],
  ['cornerRadius', new Set(['antialiased'])],
  ['overlay', new Set(['alignment'])],
  ['background', new Set(['alignment', 'ignoresSafeAreaEdges'])],
])

/** A chain rooted at one of these is a modifier chain the coverage check can judge. */
export function isViewRoot(name: string): boolean {
  return (SUPPORTED_VIEWS.has(name) || UNIMPLEMENTED_VIEWS.has(name)) && !GESTURE_TYPES.has(name)
}

/**
 * Real SwiftUI views the preview does not draw.
 *
 * Membership is what turns `GroupBox { … }` from a red "cannot find in scope" that
 * blanks the whole preview into a labelled placeholder inside an otherwise working
 * screen - which is what FR-4.11 promises and what makes the rest of the file still
 * worth looking at. A name missing from here is treated as a typo, so the list has
 * to cover the real framework rather than only the parts already drawn.
 *
 * A set, not a map: the phases it used to carry all said 7, and kept saying it after
 * Phase 10 shipped.
 */
export const UNIMPLEMENTED_VIEWS: ReadonlySet<string> = new Set([
  // containers
  'ScrollViewReader', 'NavigationSplitView', 'EquatableView',
  // data-driven
  'Table', 'TableColumn', 'OutlineGroup', 'MultiDatePicker',
  // time and charts
  'TimelineView', 'Chart', 'BarMark', 'LineMark', 'PointMark', 'AreaMark', 'RuleMark',
  // platform surfaces a browser has no analogue for
  'Map', 'Marker', 'Annotation', 'VideoPlayer', 'SceneView',
  // scenes other than the one WindowGroup the preview shows
  'Settings', 'MenuBarExtra', 'DocumentGroup',
])

/**
 * Real SwiftUI modifiers the preview recognises by name and does not apply.
 *
 * A set rather than a map: the phase numbers this used to carry all said 7, which
 * stopped being a promise the moment Phase 10 shipped, and the coverage matrix marks
 * every one of these with a dash precisely because a phase number is a commitment.
 * Membership here says one true thing - the name is real SwiftUI, and nothing it
 * asks for happens in the preview.
 *
 * `monospaced` was in this list *and* in the supported one, so a modifier the
 * preview does apply warned on every compile. Anything added here must not be there.
 */
export const UNIMPLEMENTED_MODIFIERS: ReadonlySet<string> = new Set([
  // layout
  'alignmentGuide', 'containerRelativeFrame', 'safeAreaInset', 'coordinateSpace',
  // painting and effects
  'mask', 'blendMode', 'colorMultiply', 'hueRotation', 'rotation3DEffect',
  'compositingGroup', 'drawingGroup', 'geometryGroup', 'redacted', 'visualEffect',
  'zIndex',
  // typography
  'minimumScaleFactor', 'truncationMode', 'allowsTightening', 'monospacedDigit',
  // symbols and images
  'symbolRenderingMode', 'symbolVariant', 'imageScale', 'interpolation',
  // motion
  'matchedGeometryEffect', 'phaseAnimator', 'keyframeAnimator',
  // scrolling and lists
  'refreshable', 'scrollDismissesKeyboard', 'scrollTargetBehavior', 'scrollPosition',
  'scrollDisabled', 'scrollContentBackground', 'listSectionSeparator', 'listRowSpacing',
  // presentation and chrome
  'popover', 'navigationBarBackButtonHidden', 'toolbarBackground', 'statusBarHidden',
  'tabViewStyle',
  // controls
  'controlSize', 'buttonBorderShape', 'progressViewStyle', 'gaugeStyle', 'menuStyle',
  'datePickerStyle', 'strokeBorder',
  // text entry
  'textInputAutocapitalization', 'autocorrectionDisabled',
  // environment set on the view rather than by the preview's own controls
  'dynamicTypeSize', 'preferredColorScheme',
  // accessibility beyond label, value, hint and hidden
  'accessibilityElement', 'accessibilityAddTraits', 'accessibilityIdentifier',
  'accessibilitySortPriority',
  // interaction with no analogue in the preview
  'onHover', 'draggable', 'dropDestination', 'contentShape',
])

/** Types nameable in the preview - as a value (`Color.red`) or an annotation (`: Int`). */
export const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'Int', 'Double', 'Float', 'String', 'Bool', 'Character',
  'Array', 'Dictionary', 'Set', 'Optional', 'Range', 'ClosedRange',
  'Color', 'Font', 'Alignment', 'HorizontalAlignment', 'VerticalAlignment',
  'Edge', 'EdgeInsets', 'Angle', 'UnitPoint', 'CGFloat', 'CGSize', 'CGPoint', 'CGRect',
  'Animation', 'AnyTransition', 'Axis', 'ContentMode', 'PresentationDetent',
  'Material', 'StrokeStyle', 'GeometryProxy', 'Gradient', 'AnyShapeStyle',
  'ToolbarItemPlacement', 'Binding', 'UUID', 'Date', 'URL', 'TimeInterval',
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

/**
 * Free functions available in the preview.
 *
 * Membership means the *runtime* implements it, not that the name exists in Swift.
 * `zip` and `stride` sat here for three phases with nothing behind them, so the
 * checker stayed quiet and the interpreter then reported "cannot find zip in scope" -
 * the same shape of lie as a view listed as supported and drawn as nothing.
 */
export const KNOWN_FUNCTIONS: ReadonlySet<string> = new Set([
  'print', 'min', 'max', 'abs', 'zip', 'stride', 'withAnimation',
  // maths, which `import Foundation` brings in
  'sqrt', 'pow', 'round', 'floor', 'ceil',
  // diagnostics and reflection
  'type', 'fatalError', 'assert', 'assertionFailure', 'precondition', 'preconditionFailure',
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

/**
 * Built-in value types whose members the checker has no list of.
 *
 * `extension String { var shout: String { uppercased() } }` calls a member of the
 * receiver with no receiver written, and the standard library's member list is not
 * something this checker holds - so inside one of these, an unresolved name is an
 * unknown rather than an error. `View` is deliberately absent: an extension on it is
 * already handled, and more narrowly, by the modifier rule.
 */
export const EXTENSIBLE_BUILTIN_TYPES: ReadonlySet<string> = new Set([
  'Int', 'Double', 'Float', 'CGFloat', 'Bool', 'String', 'Character',
  'Array', 'Dictionary', 'Set', 'Date', 'UUID', 'URL', 'Color', 'Font',
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
