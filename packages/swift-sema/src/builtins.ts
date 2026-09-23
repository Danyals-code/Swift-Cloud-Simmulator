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

/** Names with at least one render path. Overload limitations are checked separately. */
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
  'NavigationStack', 'NavigationView', 'NavigationLink', 'TabView', 'Tab',
  'DisclosureGroup', 'AnyView', 'GroupBox', 'LabeledContent', 'ControlGroup',
  'NavigationSplitView', 'TimelineView', 'TabSection',
  // content handed one value: a proxy, a first phase, an initial value
  'ScrollViewReader', 'PhaseAnimator', 'KeyframeAnimator',
  // controls drawn plainly
  'DatePicker', 'ColorPicker', 'TextEditor', 'Menu', 'ShareLink', 'Gauge', 'AsyncImage',
  'ContentUnavailableView',
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
  'alignmentGuide', 'safeAreaInset', 'containerRelativeFrame',
  'layoutPriority', 'aspectRatio', 'scaledToFit', 'scaledToFill',
  // appearance
  'background', 'overlay', 'border', 'shadow', 'cornerRadius', 'opacity',
  'foregroundStyle', 'foregroundColor', 'tint', 'resizable',
  // typography
  'font', 'bold', 'italic', 'fontWeight', 'fontDesign',
  'lineLimit', 'multilineTextAlignment', 'textCase',
  'underline', 'strikethrough', 'kerning', 'tracking', 'baselineOffset', 'lineSpacing',
  'minimumScaleFactor', 'truncationMode', 'allowsTightening', 'monospacedDigit',
  // transforms, filters and motion
  'scaleEffect', 'rotationEffect', 'rotation3DEffect', 'animation', 'transition',
  'blur', 'saturation', 'brightness', 'contrast', 'grayscale',
  'hueRotation', 'colorMultiply', 'blendMode', 'redacted', 'unredacted',
  // drawing styles
  'fill', 'stroke', 'trim',
  // accessibility
  'accessibilityLabel', 'accessibilityValue', 'accessibilityHint', 'accessibilityHidden',
  'allowsHitTesting',
  // navigation and presentation
  'navigationTitle', 'navigationBarTitleDisplayMode', 'navigationDestination', 'toolbar',
  'sheet', 'fullScreenCover', 'alert', 'confirmationDialog', 'presentationDetents',
  'presentationCornerRadius', 'presentationDragIndicator', 'presentationBackground', 'interactiveDismissDisabled',
  'popover', 'tabItem', 'tag', 'tabViewStyle',
  // lists
  'listStyle', 'listRowBackground', 'listRowSpacing', 'listSectionSpacing', 'scrollContentBackground',
  // interaction
  'onTapGesture', 'onLongPressGesture', 'disabled', 'buttonStyle', 'textFieldStyle', 'imageScale',
  'gesture', 'simultaneousGesture', 'highPriorityGesture',
  // lifecycle
  'onAppear', 'onDisappear', 'task', 'onChange',
  // lists and forms
  'searchable', 'onDelete', 'contextMenu', 'badge', 'presentationBackgroundInteraction', 'inspector',
  'keyboardType', 'submitLabel', 'onSubmit', 'textInputAutocapitalization', 'autocorrectionDisabled',
  'listRowSeparator', 'listRowInsets', 'scrollIndicators',
  // control styles, each of which changes what is drawn
  'toggleStyle', 'pickerStyle', 'labelStyle', 'progressViewStyle', 'gaugeStyle',
  'controlSize', 'buttonBorderShape', 'monospaced',
  // device edges
  'ignoresSafeArea', 'id',
  // Environment injection.
  'environment', 'environmentObject', 'dynamicTypeSize', 'strokeBorder',
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
  ['overlay', new Set(['alignment', 'content'])],
  ['background', new Set(['alignment', 'ignoresSafeAreaEdges', 'in', 'fillStyle', 'content'])],
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
  'EquatableView',
  // data-driven
  'Table', 'TableColumn', 'OutlineGroup', 'MultiDatePicker',
  // charts
  'Chart', 'BarMark', 'LineMark', 'PointMark', 'AreaMark', 'RuleMark',
  // platform surfaces a browser has no analogue for
  'Map', 'Marker', 'Annotation', 'VideoPlayer', 'SceneView', 'PhotosPicker',
  // scenes other than the one WindowGroup the preview shows
  'Settings', 'MenuBarExtra', 'DocumentGroup',
  // iOS 16 and 17, which the deployment target is - every one of these was a typo as
  // far as the checker was concerned, and a typo is blocking, so one of them anywhere
  // in a file blanked the whole preview. `ContentUnavailableView` is the one that
  // found this: an empty-state view is written on the way to a first screen, not after
  // it.
  'EditButton', 'PasteButton', 'RenameButton',
  'UnevenRoundedRectangle', 'AnyShape',
  // iOS 18
  'MeshGradient',
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
  'safeAreaPadding', 'gridCellColumns', 'coordinateSpace',
  // painting and effects
  'mask', 'compositingGroup', 'drawingGroup', 'geometryGroup', 'visualEffect', 'zIndex',

  // symbols and images
  'symbolRenderingMode', 'symbolVariant', 'symbolEffect', 'interpolation',
  // motion
  'matchedGeometryEffect', 'phaseAnimator', 'keyframeAnimator',
  // scrolling and lists
  'refreshable', 'scrollDismissesKeyboard', 'scrollTargetBehavior', 'scrollPosition',
  'scrollDisabled', 'listSectionSeparator',
  // presentation and chrome
  'navigationBarBackButtonHidden', 'toolbarBackground', 'statusBarHidden',
  'popoverTip',
  'searchScopes', 'searchSuggestions', 'onMove', 'swipeActions',
  'fileImporter', 'fileExporter',
  // controls
  'menuStyle', 'datePickerStyle',
  // text entry
  'focused',
  // environment set on the view rather than by the preview's own controls
  'preferredColorScheme',
  // accessibility beyond label, value, hint and hidden
  'accessibilityElement', 'accessibilityAddTraits', 'accessibilityIdentifier',
  'accessibilitySortPriority',
  // interaction with no analogue in the preview
  'onHover', 'draggable', 'dropDestination', 'contentShape',
])

/**
 * SwiftUI blend modes the preview can draw, mapped to the CSS mode that means the same.
 *
 * Here rather than in the renderer because the *checker* needs it too: `.blendMode` is
 * a supported modifier, so a mode outside this set would otherwise be accepted and
 * silently ignored - which is the failure the whole unimplemented-modifier machinery
 * exists to prevent, arriving one level down at the argument instead of the name.
 *
 * `.plusLighter`, `.plusDarker` and the `sourceAtop` / `destinationOver` family are
 * absent because CSS has no equivalent. Drawing them as the nearest mode would put
 * something plausible on screen that the device will not draw.
 */
export const BLEND_MODES: ReadonlyMap<string, string> = new Map([
  ['normal', 'normal'],
  ['multiply', 'multiply'],
  ['screen', 'screen'],
  ['overlay', 'overlay'],
  ['darken', 'darken'],
  ['lighten', 'lighten'],
  ['colorDodge', 'color-dodge'],
  ['colorBurn', 'color-burn'],
  ['softLight', 'soft-light'],
  ['hardLight', 'hard-light'],
  ['difference', 'difference'],
  ['exclusion', 'exclusion'],
  ['hue', 'hue'],
  ['saturation', 'saturation'],
  ['color', 'color'],
  ['luminosity', 'luminosity'],
])

/**
 * The style tokens each style modifier actually applies.
 *
 * A supported modifier can still receive an unsupported token, for example
 * `.toggleStyle(.neon)`. Silently falling through would leave the Problems pane
 * clean while applying no style. That is precisely the failure
 * `UNIMPLEMENTED_MODIFIERS` exists to prevent, arriving one level down at the
 * argument, and `BLEND_MODES` above is the same observation handled for one modifier
 * and not for the rest.
 *
 * A set per modifier rather than a list of the ones that *fail*, because the failing
 * set grows every WWDC and the working set does not. Anything absent warns.
 *
 * Aliases are members here too: `.automatic` is not drawn differently from the
 * default for most of these, but it is a real spelling that means "the default", so
 * warning on it would be warning on correct code that behaves correctly.
 *
 * The rule for membership, applied token by token against the converter: it takes a
 * branch of its own, or it is a spelling of the default. `.pickerStyle(.navigationLink)`
 * falls through to a drawing that is not what it means, so it warns.
 */
export const STYLE_TOKENS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['buttonStyle', new Set(['automatic', 'plain', 'borderless', 'bordered', 'borderedProminent', 'glass', 'glassProminent'])],
  ['tabViewStyle', new Set(['automatic', 'page'])],
  ['pickerStyle', new Set(['automatic', 'menu', 'segmented', 'inline', 'wheel'])],
  ['toggleStyle', new Set(['automatic', 'switch', 'button', 'checkbox'])],
  ['labelStyle', new Set(['automatic', 'titleAndIcon', 'titleOnly', 'iconOnly'])],
  ['progressViewStyle', new Set(['automatic', 'linear', 'circular'])],
  [
    'gaugeStyle',
    new Set([
      'automatic',
      'linearCapacity',
      'accessoryLinear',
      'accessoryLinearCapacity',
      'accessoryCircular',
      'accessoryCircularCapacity',
      'circular',
      'linear',
    ]),
  ],
  ['listStyle', new Set(['automatic', 'plain', 'inset', 'grouped', 'insetGrouped', 'sidebar'])],
  ['controlSize', new Set(['mini', 'small', 'regular', 'large'])],
  ['buttonBorderShape', new Set(['automatic', 'capsule', 'circle', 'roundedRectangle'])],
  ['textFieldStyle', new Set(['automatic', 'plain', 'roundedBorder'])],
])

/**
 * The colour names the preview draws, as `Color.name`, `Color(.name)` or `UIColor.name`.
 *
 * Any other name draws clear, so the checker warns on it. The runtime's palette holds
 * exactly these (a test keeps the two equal): the SwiftUI colours, UIKit's names for
 * them, and the semantic colours, all as the iOS 27 simulator draws them.
 */
export const KNOWN_COLOR_NAMES: ReadonlySet<string> = new Set([
  'red', 'orange', 'yellow', 'green', 'mint', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'brown',
  'gray', 'black', 'white', 'clear', 'primary', 'secondary', 'tertiary', 'quaternary', 'quinary',
  'accentColor', 'accent', 'tint',
  'systemRed', 'systemOrange', 'systemYellow', 'systemGreen', 'systemMint', 'systemTeal', 'systemCyan',
  'systemBlue', 'systemIndigo', 'systemPurple', 'systemPink', 'systemBrown',
  'systemGray', 'systemGray2', 'systemGray3', 'systemGray4', 'systemGray5', 'systemGray6',
  'label', 'secondaryLabel', 'tertiaryLabel', 'quaternaryLabel', 'placeholderText', 'link',
  'separator', 'opaqueSeparator',
  'systemBackground', 'secondarySystemBackground', 'tertiarySystemBackground',
  'systemGroupedBackground', 'secondarySystemGroupedBackground', 'tertiarySystemGroupedBackground',
  'systemFill', 'secondarySystemFill', 'tertiarySystemFill', 'quaternarySystemFill',
])

/** The colours `Color` itself has: `Color.red`, and `.red` wherever a colour is expected. */
export const SWIFTUI_COLOR_NAMES: ReadonlySet<string> = new Set([
  'red', 'orange', 'yellow', 'green', 'mint', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'brown',
  'gray', 'black', 'white', 'clear', 'primary', 'secondary', 'accentColor',
])

/**
 * The colours `UIColor` has, which SwiftUI reaches through the bridge: `Color(.systemGray6)`,
 * `Color(uiColor: .label)`, `UIColor.darkGray`. Written as `Color.systemGray6` they don't
 * exist, and Xcode rejects them. UIKit's fixed colours are its own: `Color(.red)` is
 * `UIColor.red`, pure red, not `Color.red`.
 */
export const UIKIT_COLOR_NAMES: ReadonlySet<string> = new Set([
  'systemRed', 'systemOrange', 'systemYellow', 'systemGreen', 'systemMint', 'systemTeal', 'systemCyan',
  'systemBlue', 'systemIndigo', 'systemPurple', 'systemPink', 'systemBrown',
  'systemGray', 'systemGray2', 'systemGray3', 'systemGray4', 'systemGray5', 'systemGray6',
  'label', 'secondaryLabel', 'tertiaryLabel', 'quaternaryLabel', 'placeholderText', 'link',
  'separator', 'opaqueSeparator',
  'systemBackground', 'secondarySystemBackground', 'tertiarySystemBackground',
  'systemGroupedBackground', 'secondarySystemGroupedBackground', 'tertiarySystemGroupedBackground',
  'systemFill', 'secondarySystemFill', 'tertiarySystemFill', 'quaternarySystemFill',
  'black', 'darkGray', 'lightGray', 'white', 'gray', 'red', 'green', 'blue', 'cyan', 'yellow',
  'magenta', 'orange', 'purple', 'brown', 'clear', 'tintColor',
])

/** Types nameable in the preview - as a value (`Color.red`) or an annotation (`: Int`). */
export const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'Int', 'Double', 'Float', 'String', 'Bool', 'Character',
  'Array', 'Dictionary', 'Set', 'Optional', 'Range', 'ClosedRange',
  'Color', 'UIColor', 'Font', 'Alignment', 'HorizontalAlignment', 'VerticalAlignment',
  'Edge', 'EdgeInsets', 'Angle', 'UnitPoint', 'CGFloat', 'CGSize', 'CGPoint', 'CGRect',
  'Animation', 'AnyTransition', 'Axis', 'ContentMode', 'PresentationDetent',
  'Material', 'StrokeStyle', 'GeometryProxy', 'ScrollViewProxy', 'Gradient', 'AnyShapeStyle',
  'ToolbarItemPlacement', 'Binding', 'UUID', 'Date', 'URL', 'TimeInterval', 'IndexSet',
  'ObservableObject', 'AnyObject', 'Error', 'DynamicTypeSize', 'ColorScheme',
  'Task', 'MainActor', 'Duration', 'Sendable', 'Comparable', 'Equatable', 'Hashable',
  'ViewModifier', 'ButtonStyle', 'LabelStyle', 'ToggleStyle', 'Configuration',
  'Content', 'Body',
  'ButtonStyleConfiguration', 'Layout', 'PreferenceKey', 'Animatable',
  'Codable', 'Decodable', 'Encodable', 'CaseIterable', 'CustomStringConvertible',
  'LayoutDirection', 'UserInterfaceSizeClass', 'Locale',
  'View', 'App', 'Scene', 'Identifiable', 'Equatable', 'Hashable', 'Comparable', 'Codable',
  'Void', 'Any', 'AnyObject', 'Never',
  // Foundation around dates: a timer never fires in the preview, and the checker says so.
  'Timer', 'Calendar',
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

/**
 * Property wrappers, mapped to whether the preview implements them.
 *
 * A set of names and a flag, with no phase numbers: the ones this carried all said 7,
 * and kept saying it after Phase 10 shipped - the same defect the view and modifier
 * lists had, in the one table the sweep that found it did not reach.
 */
export const PROPERTY_WRAPPERS: ReadonlyMap<string, { supported: boolean }> = new Map([
  ['State', { supported: true }],
  ['Binding', { supported: true }],
  ['StateObject', { supported: true }],
  ['ObservedObject', { supported: true }],
  // `$model.name` projects through the reference an `@Observable` class already is.
  ['Bindable', { supported: true }],
  ['EnvironmentObject', { supported: true }],
  ['Environment', { supported: true }],
  // A stored property on a class, which is a reference - so a change is visible
  // everywhere holding it, with or without the wrapper.
  ['Published', { supported: true }],
  // Keyed by the string they name rather than by the view, so the value outlives the
  // view that wrote it and two views naming one key see one value.
  ['AppStorage', { supported: true }],
  ['SceneStorage', { supported: true }],
  // Storage the code reads and writes. Nothing focuses a field from outside the
  // program, because the preview has no keyboard - see the coverage matrix.
  ['FocusState', { supported: true }],
  ['GestureState', { supported: true }],
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

/**
 * The style types written before iOS 15, each the style its token names now:
 * `.buttonStyle(PlainButtonStyle())` is `.buttonStyle(.plain)`.
 */
export const LEGACY_STYLE_TOKENS: ReadonlyMap<string, string> = new Map([
  ['DefaultButtonStyle', 'automatic'], ['PlainButtonStyle', 'plain'], ['BorderlessButtonStyle', 'borderless'],
  ['BorderedButtonStyle', 'bordered'], ['BorderedProminentButtonStyle', 'borderedProminent'],
  ['DefaultListStyle', 'automatic'], ['PlainListStyle', 'plain'], ['GroupedListStyle', 'grouped'],
  ['InsetListStyle', 'inset'], ['InsetGroupedListStyle', 'insetGrouped'], ['SidebarListStyle', 'sidebar'],
  ['DefaultPickerStyle', 'automatic'], ['SegmentedPickerStyle', 'segmented'], ['MenuPickerStyle', 'menu'],
  ['InlinePickerStyle', 'inline'], ['WheelPickerStyle', 'wheel'], ['NavigationLinkPickerStyle', 'navigationLink'],
  ['DefaultDatePickerStyle', 'automatic'], ['CompactDatePickerStyle', 'compact'], ['GraphicalDatePickerStyle', 'graphical'], ['WheelDatePickerStyle', 'wheel'],
  ['DefaultToggleStyle', 'automatic'], ['SwitchToggleStyle', 'switch'], ['ButtonToggleStyle', 'button'],
  ['DefaultTextFieldStyle', 'automatic'], ['PlainTextFieldStyle', 'plain'], ['RoundedBorderTextFieldStyle', 'roundedBorder'],
  ['DefaultTabViewStyle', 'automatic'], ['PageTabViewStyle', 'page'],
  ['DefaultProgressViewStyle', 'automatic'], ['LinearProgressViewStyle', 'linear'], ['CircularProgressViewStyle', 'circular'],
  ['DefaultLabelStyle', 'automatic'], ['IconOnlyLabelStyle', 'iconOnly'], ['TitleOnlyLabelStyle', 'titleOnly'], ['TitleAndIconLabelStyle', 'titleAndIcon'],
  ['StackNavigationViewStyle', 'stack'], ['DoubleColumnNavigationViewStyle', 'columns'],
])

/** What a `KeyframeAnimator`'s `keyframes:` closure is written with. The preview never runs it. */
export const KEYFRAME_TYPES: ReadonlySet<string> = new Set([
  'KeyframeTrack', 'LinearKeyframe', 'CubicKeyframe', 'SpringKeyframe', 'MoveKeyframe', 'KeyframeTimeline',
])

export function isKnownGlobal(name: string): boolean {
  return (
    SUPPORTED_VIEWS.has(name) ||
    UNIMPLEMENTED_VIEWS.has(name) ||
    KNOWN_TYPES.has(name) ||
    KNOWN_FUNCTIONS.has(name) ||
    LEGACY_STYLE_TOKENS.has(name) ||
    KEYFRAME_TYPES.has(name)
  )
}

export function isKnownModifier(name: string): boolean {
  return SUPPORTED_MODIFIERS.has(name) || UNIMPLEMENTED_MODIFIERS.has(name)
}
