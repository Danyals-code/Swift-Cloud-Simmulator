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
  // each corner with its own radius
  'UnevenRoundedRectangle',
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
  // Liquid Glass, drawn as glass over what is behind it
  'glassEffect',
  // composition
  'modifier',
  // layout
  'frame', 'padding', 'offset', 'position', 'fixedSize', 'clipShape', 'clipped',
  'alignmentGuide', 'safeAreaInset', 'containerRelativeFrame', 'gridColumnAlignment',
  'layoutPriority', 'aspectRatio', 'scaledToFit', 'scaledToFill',
  // appearance
  'background', 'overlay', 'border', 'shadow', 'cornerRadius', 'opacity', 'mask',
  'foregroundStyle', 'foregroundColor', 'tint', 'resizable',
  // typography
  'font', 'bold', 'italic', 'fontWeight', 'fontDesign',
  'lineLimit', 'multilineTextAlignment', 'textCase',
  'underline', 'strikethrough', 'kerning', 'tracking', 'baselineOffset', 'lineSpacing',
  'minimumScaleFactor', 'truncationMode', 'allowsTightening', 'monospacedDigit',
  // transforms, filters and motion
  'scaleEffect', 'rotationEffect', 'rotation3DEffect', 'animation', 'transition',
  // numbers that roll and views that move between states (Wave 5a)
  'contentTransition', 'matchedGeometryEffect',
  // a symbol's filled, enclosed or slashed variant, and the order siblings overlap in (Wave 6a)
  'symbolVariant', 'zIndex',
  'blur', 'saturation', 'brightness', 'contrast', 'grayscale',
  'hueRotation', 'colorMultiply', 'blendMode', 'redacted', 'unredacted',
  // drawing styles
  'fill', 'stroke', 'trim',
  // accessibility
  'accessibilityLabel', 'accessibilityValue', 'accessibilityHint', 'accessibilityHidden',
  'allowsHitTesting',
  // navigation and presentation
  'navigationTitle', 'navigationBarTitleDisplayMode', 'navigationDestination', 'toolbar', 'toolbarBackground',
  'sheet', 'fullScreenCover', 'alert', 'confirmationDialog', 'presentationDetents',
  'presentationCornerRadius', 'presentationDragIndicator', 'presentationBackground', 'interactiveDismissDisabled',
  'popover', 'tabItem', 'tag', 'tabViewStyle', 'indexViewStyle',
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
  'listRowSeparator', 'listRowSeparatorTint', 'listRowInsets', 'scrollIndicators', 'swipeActions', 'scrollTargetBehavior',
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

/** What a `Chart` is drawn with: its marks, and the plots of a whole collection (iOS 18). */
export const CHART_MARKS: ReadonlySet<string> = new Set([
  'BarMark', 'LineMark', 'PointMark', 'AreaMark', 'RuleMark', 'RectangleMark', 'SectorMark',
  'Plot', 'BarPlot', 'LinePlot', 'PointPlot', 'AreaPlot', 'RulePlot', 'RectanglePlot', 'SectorPlot',
])

/**
 * What only a chart's mark takes, each giving back the mark: real Swift Charts on a mark,
 * and not a view modifier, so Xcode refuses one written on a view.
 */
export const CHART_MARK_MODIFIERS: ReadonlySet<string> = new Set([
  'annotation', 'interpolationMethod', 'symbol', 'symbolSize', 'lineStyle', 'alignsMarkStylesWithPlotArea',
])

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
  // charts, and what an axis is drawn with
  'Chart', ...CHART_MARKS, 'AxisMarks', 'AxisGridLine', 'AxisTick', 'AxisValueLabel',
  // Liquid Glass and the iOS 26 toolbar
  'GlassEffectContainer', 'ToolbarSpacer', 'DefaultToolbarItem',
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
  'AnyShape',
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
  'compositingGroup', 'drawingGroup', 'geometryGroup', 'visualEffect',
  // a width of the system font, which the preview's text measurement cannot stretch
  'fontWidth',

  // symbols and images
  'symbolRenderingMode', 'symbolEffect', 'interpolation',
  // motion
  'phaseAnimator', 'keyframeAnimator',
  // scrolling and lists
  'refreshable', 'scrollDismissesKeyboard', 'scrollPosition', 'scrollTransition',
  'scrollDisabled', 'listSectionSeparator',
  // presentation and chrome
  'navigationBarBackButtonHidden', 'statusBarHidden',
  'popoverTip',
  'searchScopes', 'searchSuggestions', 'onMove',
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
 * Where the modifier stack lists one of SwiftUI's modifiers, by what it changes: what the
 * view does, how it is laid out, or its text. Every name here is Apple's, whether or not
 * the preview draws it. One of Apple's named in none of these changes how the view looks,
 * and one the project declares is its own.
 */
export const MODIFIER_CATEGORIES: Readonly<Record<'behavior' | 'layout' | 'text', ReadonlySet<string>>> = {
  behavior: new Set([
    'task', 'onAppear', 'onDisappear', 'onChange', 'onReceive', 'onTapGesture', 'onLongPressGesture', 'onSubmit', 'onDelete', 'onMove',
    'gesture', 'simultaneousGesture', 'highPriorityGesture', 'sheet', 'fullScreenCover', 'alert', 'confirmationDialog', 'popover',
    'navigationDestination', 'navigationTitle', 'navigationBarTitleDisplayMode', 'toolbar', 'tabItem', 'tag', 'id', 'environment',
    'environmentObject', 'disabled', 'allowsHitTesting', 'animation', 'transition', 'searchable', 'contextMenu', 'accessibilityLabel',
    'accessibilityIdentifier', 'accessibilityValue', 'accessibilityHint', 'accessibilityHidden',
    'swipeActions', 'refreshable', 'contentShape', 'matchedGeometryEffect', 'phaseAnimator', 'keyframeAnimator', 'focused', 'onHover', 'draggable',
    'dropDestination', 'onInsert', 'fileImporter', 'fileExporter', 'popoverTip', 'searchScopes', 'searchSuggestions', 'scrollDismissesKeyboard',
    'scrollDisabled', 'navigationBarBackButtonHidden', 'accessibilityElement', 'accessibilityAddTraits', 'accessibilitySortPriority',
    'navigationBarTitle', 'navigationBarItems', 'navigationBarHidden', 'toolbarTitleMenu', 'actionSheet', 'tabViewCustomization',
    'textSelection', 'textContentType', 'autocapitalization', 'disableAutocorrection', 'writingToolsBehavior', 'findNavigator',
    'findDisabled', 'submitScope', 'searchCompletion', 'searchPresentationToolbarBehavior', 'keyboardShortcut',
    'onOpenURL', 'onContinueUserActivity', 'userActivity', 'handlesExternalEvents', 'onDrag', 'onDrop', 'onKeyPress',
    'onContinuousHover', 'focusable', 'focusEffectDisabled', 'focusedValue', 'focusedSceneValue', 'defaultFocus', 'sensoryFeedback',
    'help', 'deleteDisabled', 'moveDisabled', 'selectionDisabled', 'fileMover', 'photosPicker', 'quickLookPreview', 'widgetURL',
    'containerValue', 'defersSystemGestures', 'menuActionDismissBehavior', 'buttonRepeatBehavior', 'contentTransition', 'transaction',
    'matchedTransitionSource', 'navigationTransition', 'onGeometryChange', 'onScrollGeometryChange', 'onScrollPhaseChange',
    'onScrollVisibilityChange', 'onPreferenceChange', 'preference', 'transformPreference', 'anchorPreference', 'transformAnchorPreference',
    'accessibilityAction', 'accessibilityActions', 'accessibilityRemoveTraits', 'accessibilityInputLabels', 'accessibilityRepresentation',
    'accessibilityRotor', 'accessibilityRespondsToUserInteraction', 'accessibilityShowsLargeContentViewer', 'accessibilityChildren',
    'accessibilityFocused', 'accessibilityHeading', 'accessibilityAdjustableAction', 'accessibilityScrollAction',
    'accessibilityIgnoresInvertColors', 'accessibilityTextContentType', 'accessibilityLinkedGroup', 'accessibilityCustomContent',
    'accessibilityZoomAction', 'speechAlwaysIncludesPunctuation', 'speechSpellsOutCharacters', 'speechAdjustedPitch', 'speechAnnouncementsQueued',
    // what a chart does when it is scrolled, dragged or tapped
    'chartXSelection', 'chartYSelection', 'chartAngleSelection', 'chartScrollableAxes', 'chartScrollPosition', 'chartScrollTargetBehavior',
    'chartXVisibleDomain', 'chartYVisibleDomain', 'chartGesture',
  ]),
  layout: new Set([
    'offset', 'position', 'fixedSize', 'alignmentGuide', 'safeAreaInset', 'containerRelativeFrame', 'layoutPriority', 'aspectRatio',
    'scaledToFit', 'scaledToFill', 'ignoresSafeArea', 'zIndex', 'safeAreaPadding', 'gridCellColumns', 'coordinateSpace', 'geometryGroup',
    'scrollTargetBehavior', 'scrollPosition',
    'scenePadding', 'contentMargins', 'layoutValue', 'gridCellAnchor', 'gridCellUnsizedAxes', 'edgesIgnoringSafeArea',
    'flipsForRightToLeftLayoutDirection', 'scrollClipDisabled', 'scrollBounceBehavior', 'scrollTargetLayout', 'defaultScrollAnchor',
    'inspectorColumnWidth', 'navigationSplitViewColumnWidth',
  ]),
  text: new Set([
    'bold', 'italic', 'fontWeight', 'fontDesign', 'multilineTextAlignment', 'textCase', 'underline', 'strikethrough', 'kerning', 'tracking',
    'baselineOffset', 'lineSpacing', 'minimumScaleFactor', 'truncationMode', 'allowsTightening', 'monospacedDigit', 'fontWidth',
    'textScale', 'typesettingLanguage', 'textRenderer',
  ]),
}

/**
 * Real SwiftUI view modifiers that change how a view looks, in neither `SUPPORTED_MODIFIERS`
 * nor `UNIMPLEMENTED_MODIFIERS`: ones the checker has not been taught, which the preview
 * neither applies nor names. Here so that Design knows them for what they are, Apple's,
 * each returning `some View`, rather than a project's own whose type it cannot see; those
 * that change what a view does, its layout or its text are in `MODIFIER_CATEGORIES`.
 * Deprecated spellings are real too, and still build.
 */
export const OTHER_APPLE_MODIFIERS: ReadonlySet<string> = new Set([
  'containerShape', 'backgroundStyle', 'colorInvert', 'luminanceToAlpha', 'containerBackground', 'colorScheme', 'listItemTint',
  'symbolEffectsRemoved', 'hoverEffect', 'hoverEffectDisabled', 'privacySensitive', 'headerProminence', 'badgeProminence',
  'listSectionSeparatorTint', 'invalidatableContent', 'backgroundExtensionEffect', 'glassEffectID',
  'glassEffectUnion', 'glassEffectTransition', 'buttonSizing', 'labelsHidden', 'scrollIndicatorsFlash', 'scrollEdgeEffectStyle',
  'scrollEdgeEffectHidden', 'navigationViewStyle', 'navigationSubtitle', 'toolbarColorScheme', 'toolbarBackgroundVisibility',
  'toolbarVisibility', 'toolbarTitleDisplayMode', 'toolbarRole', 'persistentSystemOverlays', 'statusBar', 'tabViewBottomAccessory',
  'tabBarMinimizeBehavior', 'searchToolbarBehavior', 'presentationCompactAdaptation', 'presentationContentInteraction', 'presentationSizing', 'tableStyle',
  'formStyle', 'groupBoxStyle', 'disclosureGroupStyle', 'controlGroupStyle', 'navigationSplitViewStyle',
  'labeledContentStyle', 'textEditorStyle', 'menuIndicator', 'menuOrder', 'tipBackground', 'tipViewStyle', 'widgetAccentable',
  'backgroundPreferenceValue', 'overlayPreferenceValue',
  // how a chart draws its axes, scales, legend and plot area
  'chartXAxis', 'chartYAxis', 'chartXAxisLabel', 'chartYAxisLabel', 'chartXScale', 'chartYScale', 'chartLegend',
  'chartForegroundStyleScale', 'chartSymbolScale', 'chartLineStyleScale', 'chartPlotStyle', 'chartBackground', 'chartOverlay',
])

/**
 * The modifiers that keep a Text a Text, each by the iOS it does so from: the methods of
 * SwiftUI's own `extension Text` that return `Text`, in the iOS 27 SDK. Only these can be
 * written on a run of texts joined with `+`, and below iOS 16 a Text-only modifier still
 * applies after them, as the chain is still a Text.
 */
export const KEEPS_TEXT: Readonly<Record<string, number>> = {
  font: 13, fontWeight: 13, bold: 13, italic: 13, underline: 13, strikethrough: 13, kerning: 13, tracking: 13, baselineOffset: 13,
  foregroundColor: 13, monospacedDigit: 15, fontWidth: 16, fontDesign: 16.1, monospaced: 16.4, foregroundStyle: 17, textScale: 17,
  typesettingLanguage: 17,
}

/** Whether a modifier keeps a Text a Text at a deployment target (`KEEPS_TEXT`). */
export const keepsText = (name: string, target: number): boolean => (KEEPS_TEXT[name] ?? Number.POSITIVE_INFINITY) <= target

/** Calls only an Image takes, each giving back an Image. */
export const IMAGE_CALLS: ReadonlySet<string> = new Set(['resizable', 'renderingMode', 'interpolation', 'antialiased'])
/** Calls only a Shape takes, each giving back the shape it changes: once any other modifier is applied it is no longer a shape. */
export const SHAPE_CALLS: ReadonlySet<string> = new Set(['trim', 'inset', 'rotation', 'scale', 'offset', 'transform', 'size'])
/** A shape's own paint, which ends its shape calls. */
export const SHAPE_PAINTS: ReadonlySet<string> = new Set(['fill', 'stroke', 'strokeBorder'])
/** Calls only a ForEach takes, as the dynamic content it is. */
export const DYNAMIC_CALLS: ReadonlySet<string> = new Set(['onDelete', 'onMove', 'onInsert'])

/**
 * Calls only an Image, a Shape or a ForEach takes, each giving back its own type: real
 * SwiftUI, and anything may follow one, but a modifier written before it leaves it no
 * Image, Shape or ForEach to apply to. They stay where the view's own call put them. A
 * shape's `offset` is any view's too, so it is one of Apple's view modifiers.
 */
export const OWN_TYPE_CALLS: ReadonlySet<string> = new Set([...IMAGE_CALLS, ...SHAPE_CALLS, ...SHAPE_PAINTS, ...DYNAMIC_CALLS].filter(name => name !== 'offset'))

/**
 * Apple's view modifiers: the ones the preview applies, the ones it names and does not
 * apply, and the rest of SwiftUI's. Each takes any view and returns `some View`, so Design
 * can write a modifier before or after one without changing whether the code builds. A
 * name outside this set and `OWN_TYPE_CALLS` is the project's own, whose type Design
 * cannot see.
 */
export const APPLE_VIEW_MODIFIERS: ReadonlySet<string> = new Set(
  [...SUPPORTED_MODIFIERS, ...UNIMPLEMENTED_MODIFIERS, ...OTHER_APPLE_MODIFIERS, ...Object.values(MODIFIER_CATEGORIES).flatMap(names => [...names])].filter(name => !OWN_TYPE_CALLS.has(name)),
)

/**
 * A call SwiftUI declares on a view: a view modifier, or a call only the view's own type
 * takes. Whether the preview draws it is `SUPPORTED_MODIFIERS`'s to say.
 */
export const isAppleCall = (name: string): boolean => APPLE_VIEW_MODIFIERS.has(name) || OWN_TYPE_CALLS.has(name)

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
  ['indexViewStyle', new Set(['page'])],
  // A ScrollView that pages snaps by its size (Wave 4c); one aligned to its views scrolls freely.
  ['scrollTargetBehavior', new Set(['paging'])],
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
 * UIKit's system colours, which change with light and dark mode and have no `Color` of
 * their own: `Color(.systemGray6)`, `Color(.label)`.
 */
export const UIKIT_SEMANTIC_COLOR_NAMES: ReadonlySet<string> = new Set([
  'systemRed', 'systemOrange', 'systemYellow', 'systemGreen', 'systemMint', 'systemTeal', 'systemCyan',
  'systemBlue', 'systemIndigo', 'systemPurple', 'systemPink', 'systemBrown',
  'systemGray', 'systemGray2', 'systemGray3', 'systemGray4', 'systemGray5', 'systemGray6',
  'label', 'secondaryLabel', 'tertiaryLabel', 'quaternaryLabel', 'placeholderText', 'link',
  'separator', 'opaqueSeparator',
  'systemBackground', 'secondarySystemBackground', 'tertiarySystemBackground',
  'systemGroupedBackground', 'secondarySystemGroupedBackground', 'tertiarySystemGroupedBackground',
  'systemFill', 'secondarySystemFill', 'tertiarySystemFill', 'quaternarySystemFill',
])

/**
 * The colours `UIColor` has, which SwiftUI reaches through the bridge: `Color(.systemGray6)`,
 * `Color(uiColor: .label)`, `UIColor.darkGray`. Written as `Color.systemGray6` they don't
 * exist, and Xcode rejects them. UIKit's fixed colours are its own: `Color(.red)` is
 * `UIColor.red`, pure red, not `Color.red`.
 */
export const UIKIT_COLOR_NAMES: ReadonlySet<string> = new Set([
  ...UIKIT_SEMANTIC_COLOR_NAMES,
  'black', 'darkGray', 'lightGray', 'white', 'gray', 'red', 'green', 'blue', 'cyan', 'yellow',
  'magenta', 'orange', 'purple', 'brown', 'clear', 'tintColor',
])

/** Types nameable in the preview - as a value (`Color.red`) or an annotation (`: Int`). */
export const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'Int', 'Double', 'Float', 'String', 'Bool', 'Character',
  // Words with their own fonts and colours, which `Text` draws, and a symbol's variants (Wave 6a).
  'AttributedString', 'AttributeContainer', 'SymbolVariants',
  'Int8', 'Int16', 'Int32', 'Int64', 'UInt', 'UInt8', 'UInt16', 'UInt32', 'UInt64',
  'Array', 'Dictionary', 'Set', 'Optional', 'Range', 'ClosedRange',
  'Color', 'UIColor', 'Font', 'Alignment', 'HorizontalAlignment', 'VerticalAlignment',
  'Edge', 'EdgeInsets', 'Angle', 'UnitPoint', 'CGFloat', 'CGSize', 'CGPoint', 'CGRect',
  'Animation', 'AnyTransition', 'Axis', 'ContentMode', 'PresentationDetent', 'Visibility',
  // `let namespace: Namespace.ID`, a `@Namespace` handed to the view that matches with it (Wave 5a).
  'Namespace',
  'Material', 'StrokeStyle', 'GeometryProxy', 'ScrollViewProxy', 'Gradient', 'AnyShapeStyle', 'Glass',
  'RectangleCornerRadii',
  'ToolbarItemPlacement', 'ToolbarContent', 'Binding', 'NavigationPath', 'Alert', 'UUID', 'Date', 'URL', 'TimeInterval', 'IndexSet', 'Scanner', 'CharacterSet',
  'ObservableObject', 'AnyObject', 'Error', 'DynamicTypeSize', 'ColorScheme',
  'Task', 'MainActor', 'Duration', 'Sendable', 'Comparable', 'Equatable', 'Hashable',
  'ViewModifier', 'ButtonStyle', 'LabelStyle', 'ToggleStyle', 'Configuration',
  'Content', 'Body',
  'ButtonStyleConfiguration', 'Layout', 'PreferenceKey', 'Animatable',
  // A custom `Layout`'s own signatures. Its methods never run, and the checker says so where it is used.
  'ProposedViewSize', 'Subviews', 'LayoutSubviews', 'LayoutSubview', 'ViewDimensions',
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
  // A size that scales with the reader's text size, along the curve of the style it names.
  ['ScaledMetric', { supported: true }],
  ['GestureState', { supported: true }],
  // An id `.matchedGeometryEffect` names views by, one for each copy of the view (Wave 5a).
  ['Namespace', { supported: true }],
])

/**
 * The bars `.toolbar(.hidden, for: …)` hides in the preview, as iOS does (Wave 4b). The preview
 * draws the others still, and the checker says so.
 */
export const HIDDEN_BARS: readonly string[] = ['navigationBar', 'bottomBar', 'tabBar']

/** Attributes that are meaningful rather than property wrappers. */
export const KNOWN_ATTRIBUTES: ReadonlySet<string> = new Set([
  'main', 'ViewBuilder', 'ToolbarContentBuilder', 'escaping', 'autoclosure', 'available', 'discardableResult',
  'inlinable', 'frozen', 'objc', 'MainActor', 'Observable', 'Sendable', 'Previewable',
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

