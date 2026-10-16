import { DEFAULT_DEPLOYMENT_TARGET, DOTS_BACKGROUND, authoringCapability, deploymentVersion, isNonView, needsNewerIOS, type AuthoringModifier, type AuthoringNode, type ModifierCatalogEntry, type ModifierCategory, type ModifierOperation, type SourceSpan } from '@studio/shared'
import { Parser, afterOffMarkers, commentFollows, hasHumanComment, offMarker, offMarkerText, offMarkersIn, type CallExpr, type Expr, DIRECTIVE_LINE } from '@studio/swift-syntax'
import { roundedCorners, viewCallChain } from './design-controls'
import { NEW_BORDER, borderOf, borderSource, cornersOf, type Corners } from './authoring-border'
import { authoringViewMinimum } from './authoring-view'
import { indentAt } from './authoring-context'
import { APPLE_VIEW_MODIFIERS, KEEPS_TEXT, MODIFIER_CATEGORIES, SUPPORTED_MODIFIERS, isAppleCall } from './builtins'
import { modifierPrefix } from './layer/chain-edit'
import { runRefusal } from './layer/context'
import { chainSlots } from './layer/slots'

/**
 * The modifier stack: everything written after a view is created, in source order.
 *
 * The stack *is* the code. Each entry is one `.modifier(…)` in the chain, and the
 * order on screen is the order in the file, because in SwiftUI the order changes the
 * result. A modifier can be switched off without deleting it: it is commented out in
 * place with its exact text inside a versioned marker, and switching it on writes that
 * text back byte for byte.
 */

/**
 * Where each kind of modifier sits in a chain, in the order a SwiftUI developer writes
 * them: a new one goes after the last of the same or an earlier slot. Margin and the
 * outer frame are paddings and frames after the surface, so no modifier name has them.
 */
export const SLOT = { text: 1, padding: 2, size: 3, fill: 4, clip: 5, stroke: 6, shadow: 7, margin: 7.5, outerFrame: 7.6, offset: 8, effects: 9, behaviour: 10 } as const

interface CatalogEntry {
  readonly name: string
  readonly label: string
  readonly category: ModifierCategory
  /** Where a new one goes: after the last modifier in the same or an earlier slot. */
  readonly slot: number
  readonly description: string
  /**
   * `indent` is the indentation of the view's modifiers when each is on a line of its own, and
   * null on one line; `line` is the indentation of the line the view starts on, and `unit` one
   * level of it.
   */
  readonly source: (options: { target: number; shadowToken?: string; corners: Corners; indent: string | null; line: string; unit: string }) => string
  readonly minimumIOS?: number
  readonly only?: readonly string[]
  /** Offered on rows of a list alone (Wave 4a): views in a List, a Form or a Section. */
  readonly row?: true
  /** Offered on a tab's view as well as on a row (Wave 4c). */
  readonly tab?: true
  /** Written straight after the view's call (Wave 4c): a shape's own modifier, which gives a shape the calls after it still take. */
  readonly first?: true
  /** Offered on the view a sheet shows alone (Wave 4b), or on a full-screen cover's too. */
  readonly presented?: 'sheet' | 'cover'
  readonly hidden?: boolean
}

const CATALOG: readonly CatalogEntry[] = [
  { name: 'font', label: 'Font', category: 'text', slot: SLOT.text, description: 'Text style and size', source: () => '.font(.body)' },
  { name: 'foregroundStyle', label: 'Text color', category: 'text', slot: SLOT.text, description: 'Color of text and symbols', minimumIOS: 15, source: () => '.foregroundStyle(Color.primary)' },
  { name: 'foregroundColor', label: 'Text color', category: 'text', slot: SLOT.text, description: 'Color of text and symbols', hidden: true, source: () => '.foregroundColor(Color.primary)' },
  { name: 'bold', label: 'Bold', category: 'text', slot: SLOT.text, description: 'Heavier text', source: () => '.bold()' },
  { name: 'italic', label: 'Italic', category: 'text', slot: SLOT.text, description: 'Slanted text', source: () => '.italic()' },
  { name: 'underline', label: 'Underline', category: 'text', slot: SLOT.text, description: 'A line under the text', source: () => '.underline()' },
  { name: 'strikethrough', label: 'Strikethrough', category: 'text', slot: SLOT.text, description: 'A line through the text', source: () => '.strikethrough()' },
  { name: 'multilineTextAlignment', label: 'Text alignment', category: 'text', slot: SLOT.text, description: 'Left, center or right', source: () => '.multilineTextAlignment(.center)' },
  { name: 'lineLimit', label: 'Max lines', category: 'text', slot: SLOT.text, description: 'Cut long text after some lines', source: () => '.lineLimit(3)' },
  { name: 'tracking', label: 'Letter spacing', category: 'text', slot: SLOT.text, description: 'Space between letters', minimumIOS: 16, source: () => '.tracking(1)' },
  { name: 'lineSpacing', label: 'Line spacing', category: 'text', slot: SLOT.text, description: 'Space between lines', source: () => '.lineSpacing(4)' },
  // Width and Height sizing say Hug, Fill or Fixed (D2); these two were a second way to say it,
  // and read as the same thing. A frame or fixedSize already in the code keeps its card.
  { name: 'frameFlexible', label: 'Flexible size', category: 'layout', slot: SLOT.size, description: 'Grows to fill the space', minimumIOS: 13, hidden: true, source: () => '.frame(minWidth: 0, idealWidth: 160, maxWidth: .infinity, minHeight: 0, idealHeight: 80, maxHeight: .infinity)' },
  { name: 'fixedSize', label: 'Ideal size', category: 'layout', slot: SLOT.size, description: 'Only as big as its content', minimumIOS: 13, hidden: true, source: () => '.fixedSize(horizontal: true, vertical: true)' },
  { name: 'aspectRatio', label: 'Aspect ratio', category: 'layout', slot: SLOT.size, description: 'Keep width and height in proportion', minimumIOS: 13, source: () => '.aspectRatio(1, contentMode: .fit)' },
  { name: 'clipped', label: 'Clip to bounds', category: 'appearance', slot: SLOT.clip, description: 'Hide what spills outside it', minimumIOS: 13, source: () => '.clipped()' },
  { name: 'rotation3DEffect', label: '3D rotation', category: 'layout', slot: SLOT.offset, description: 'Tilt it in depth', minimumIOS: 13, source: () => '.rotation3DEffect(.degrees(30), axis: (x: 0, y: 1, z: 0), anchor: .center, anchorZ: 0, perspective: 1)' },
  { name: 'saturation', label: 'Saturation', category: 'appearance', slot: SLOT.effects, description: 'How vivid its colors are', minimumIOS: 13, source: () => '.saturation(1)' },
  { name: 'brightness', label: 'Brightness', category: 'appearance', slot: SLOT.effects, description: 'Lighten or darken it', minimumIOS: 13, source: () => '.brightness(0)' },
  { name: 'contrast', label: 'Contrast', category: 'appearance', slot: SLOT.effects, description: 'Gap between lights and darks', minimumIOS: 13, source: () => '.contrast(1)' },
  { name: 'grayscale', label: 'Grayscale', category: 'appearance', slot: SLOT.effects, description: 'Drain its color', minimumIOS: 13, source: () => '.grayscale(0.5)' },
  { name: 'colorMultiply', label: 'Multiply color', category: 'appearance', slot: SLOT.effects, description: 'Tint it by mixing in a color', minimumIOS: 13, source: () => '.colorMultiply(Color.white)' },
  { name: 'hueRotation', label: 'Hue rotation', category: 'appearance', slot: SLOT.effects, description: 'Shift all its colors', minimumIOS: 13, source: () => '.hueRotation(.degrees(30))' },
  { name: 'blendMode', label: 'Blend mode', category: 'appearance', slot: SLOT.effects, description: 'How it mixes with what is behind', minimumIOS: 13, source: () => '.blendMode(.normal)' },
  { name: 'layoutPriority', label: 'Layout priority', category: 'layout', slot: SLOT.size, description: 'Gets space first in a stack', minimumIOS: 13, source: () => '.layoutPriority(1)' },
  { name: 'fontWeight', label: 'Font weight', category: 'text', slot: SLOT.text, description: 'Thin to heavy', minimumIOS: 13, source: () => '.fontWeight(.semibold)' },
  { name: 'fontDesign', label: 'Font design', category: 'text', slot: SLOT.text, description: 'Rounded, serif or monospaced', minimumIOS: 16, source: () => '.fontDesign(.default)' },
  { name: 'kerning', label: 'Kerning', category: 'text', slot: SLOT.text, description: 'Space between letter pairs', minimumIOS: 16, source: () => '.kerning(1)' },
  { name: 'baselineOffset', label: 'Baseline offset', category: 'text', slot: SLOT.text, description: 'Raise or lower the text', minimumIOS: 16, source: () => '.baselineOffset(2)' },
  { name: 'textCase', label: 'Text case', category: 'text', slot: SLOT.text, description: 'Uppercase or lowercase', minimumIOS: 13, source: () => '.textCase(.uppercase)' },
  { name: 'minimumScaleFactor', label: 'Minimum text scale', category: 'text', slot: SLOT.text, description: 'How far text shrinks to fit', minimumIOS: 13, source: () => '.minimumScaleFactor(0.5)' },
  { name: 'truncationMode', label: 'Truncation', category: 'text', slot: SLOT.text, description: 'Cut long text at the start, middle or end', minimumIOS: 13, source: () => '.truncationMode(.tail)' },
  { name: 'allowsTightening', label: 'Tighten text', category: 'text', slot: SLOT.text, description: 'Squeeze letters closer to fit', minimumIOS: 13, source: () => '.allowsTightening(true)' },
  { name: 'allowsHitTesting', label: 'Allow interaction', category: 'behavior', slot: SLOT.behaviour, description: 'Whether taps reach it', minimumIOS: 13, source: () => '.allowsHitTesting(true)' },
  { name: 'accessibilityHidden', label: 'Hide from accessibility', category: 'behavior', slot: SLOT.behaviour, description: 'VoiceOver skips it', minimumIOS: 13, source: () => '.accessibilityHidden(true)' },
  { name: 'accessibilityValue', label: 'Accessibility value', category: 'behavior', slot: SLOT.behaviour, description: 'The value VoiceOver reads', minimumIOS: 13, source: () => '.accessibilityValue("Value")' },
  { name: 'accessibilityHint', label: 'Accessibility hint', category: 'behavior', slot: SLOT.behaviour, description: 'What VoiceOver says a tap does', minimumIOS: 13, source: () => '.accessibilityHint("Hint")' },
  { name: 'toggleStyle', label: 'Toggle style', category: 'appearance', slot: SLOT.behaviour, description: 'Switch or button', minimumIOS: 13, only: ['Toggle'], source: () => '.toggleStyle(.switch)' },
  { name: 'pickerStyle', label: 'Picker style', category: 'appearance', slot: SLOT.behaviour, description: 'Menu, wheel or segmented', minimumIOS: 14, only: ['Picker'], source: () => '.pickerStyle(.menu)' },
  { name: 'progressViewStyle', label: 'Progress style', category: 'appearance', slot: SLOT.behaviour, description: 'Bar or spinner', minimumIOS: 14, only: ['ProgressView'], source: () => '.progressViewStyle(.linear)' },
  { name: 'gaugeStyle', label: 'Gauge style', category: 'appearance', slot: SLOT.behaviour, description: 'Bar or ring', minimumIOS: 16, only: ['Gauge'], source: () => '.gaugeStyle(.linearCapacity)' },
  { name: 'labelStyle', label: 'Label style', category: 'appearance', slot: SLOT.behaviour, description: 'Title, icon or both', minimumIOS: 14, only: ['Label'], source: () => '.labelStyle(.titleAndIcon)' },
  { name: 'textFieldStyle', label: 'Input style', category: 'appearance', slot: SLOT.behaviour, description: 'Rounded border or plain', minimumIOS: 13, only: ['TextField', 'SecureField'], source: () => '.textFieldStyle(.roundedBorder)' },
  { name: 'listStyle', label: 'List style', category: 'appearance', slot: SLOT.behaviour, description: 'Inset, grouped or plain', minimumIOS: 14, only: ['List', 'Form'], source: () => '.listStyle(.insetGrouped)' },
  { name: 'scrollIndicators', label: 'Scroll indicators', category: 'appearance', slot: SLOT.behaviour, description: 'Show or hide the scroll bars', minimumIOS: 16, only: ['ScrollView', 'List', 'Form'], source: () => '.scrollIndicators(.visible)' },
  { name: 'scrollContentBackground', label: 'Scroll background', category: 'appearance', slot: SLOT.behaviour, description: 'Show or hide the list background', minimumIOS: 16, only: ['ScrollView', 'List', 'Form'], source: () => '.scrollContentBackground(.hidden)' },
  { name: 'imageScale', label: 'Symbol size', category: 'appearance', slot: SLOT.behaviour, description: 'Small, medium or large', minimumIOS: 13, only: ['Image', 'Label'], source: () => '.imageScale(.large)' },
  { name: 'listRowBackground', label: 'Row background', category: 'appearance', slot: SLOT.behaviour, description: 'A color behind the row', row: true, source: () => '.listRowBackground(Color.yellow)' },
  { name: 'listRowInsets', label: 'Row insets', category: 'layout', slot: SLOT.behaviour, description: 'Space around the row’s content', row: true, source: () => '.listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))' },
  { name: 'listRowSeparatorTint', label: 'Separator color', category: 'appearance', slot: SLOT.behaviour, description: 'Color of the line under a row', minimumIOS: 15, row: true, source: () => '.listRowSeparatorTint(Color.red)' },
  { name: 'listRowSeparator', label: 'Row separator', category: 'appearance', slot: SLOT.behaviour, description: 'Show or hide the line under a row', minimumIOS: 15, row: true, source: () => '.listRowSeparator(.hidden)' },
  // Their buttons go in a slot of their own, each on a line, which Add with the slot selected adds to (Wave 4a).
  { name: 'swipeActions', label: 'Swipe actions', category: 'behavior', slot: SLOT.behaviour, description: 'Buttons a swipe across the row shows', minimumIOS: 15, row: true, source: options => closureSource('swipeActions', 'Button("Delete", systemImage: "trash", role: .destructive) { }', options) },
  { name: 'contextMenu', label: 'Context menu', category: 'behavior', slot: SLOT.behaviour, description: 'Buttons a long press shows', source: options => closureSource('contextMenu', 'Button("Copy") { }', options) },
  // A row's or a tab's count (Wave 4c), and a bar pinned to the foot of a view, whose views go in a slot of their own.
  { name: 'badge', label: 'Badge', category: 'appearance', slot: SLOT.behaviour, description: 'A count beside a row or on a tab', minimumIOS: 15, row: true, tab: true, source: () => '.badge(3)' },
  { name: 'safeAreaInset', label: 'Inset bar', category: 'layout', slot: SLOT.behaviour, description: 'A bar pinned to its bottom edge', minimumIOS: 15, source: options => closureSource('safeAreaInset(edge: .bottom)', 'Text("Bar")', options) },
  { name: 'trim', label: 'Trim', category: 'appearance', slot: 0, description: 'Draw part of its outline', only: ['Rectangle', 'RoundedRectangle', 'UnevenRoundedRectangle', 'Circle', 'Ellipse', 'Capsule'], first: true, source: () => '.trim(from: 0, to: 0.75)' },
  // A sheet's settings, on the view it shows, which has a field for each too (Wave 4b).
  { name: 'presentationDetents', label: 'Sheet height', category: 'appearance', slot: SLOT.behaviour, description: 'Medium, large or a fixed height', minimumIOS: 16, presented: 'sheet', source: () => '.presentationDetents([.medium])' },
  { name: 'presentationDragIndicator', label: 'Grabber', category: 'appearance', slot: SLOT.behaviour, description: 'The bar at the top of a sheet', minimumIOS: 16, presented: 'sheet', source: () => '.presentationDragIndicator(.visible)' },
  { name: 'presentationBackground', label: 'Sheet background', category: 'appearance', slot: SLOT.behaviour, description: 'A color or a material behind it', minimumIOS: 16.4, presented: 'cover', source: () => '.presentationBackground(.thinMaterial)' },
  { name: 'presentationCornerRadius', label: 'Sheet corner radius', category: 'appearance', slot: SLOT.behaviour, description: 'Round the sheet’s corners', minimumIOS: 16.4, presented: 'sheet', source: () => '.presentationCornerRadius(24)' },
  { name: 'interactiveDismissDisabled', label: 'Keep open on swipe', category: 'behavior', slot: SLOT.behaviour, description: 'A swipe down doesn’t close the sheet', minimumIOS: 15, presented: 'sheet', source: () => '.interactiveDismissDisabled()' },
  // A carousel: a TabView's pages swiped through, with their Page dots and Dots background as fields (Wave 4c).
  { name: 'tabViewStyle', label: 'Page style', category: 'appearance', slot: SLOT.behaviour, description: 'Swipe between its views, with dots', minimumIOS: 14, only: ['TabView'], source: () => '.tabViewStyle(.page)' },
  { name: 'indexViewStyle', label: 'Dots background', category: 'appearance', slot: SLOT.behaviour, description: 'A backing behind a carousel’s dots', minimumIOS: 14, only: ['TabView'], source: () => DOTS_BACKGROUND },
  { name: 'listRowSpacing', label: 'Row spacing', category: 'appearance', slot: SLOT.behaviour, description: 'Space between rows', minimumIOS: 17, only: ['List', 'Form'], source: () => '.listRowSpacing(8)' },
  { name: 'listSectionSpacing', label: 'Section spacing', category: 'appearance', slot: SLOT.behaviour, description: 'Space between sections', minimumIOS: 17, only: ['List', 'Form'], source: () => '.listSectionSpacing(24)' },
  { name: 'padding', label: 'Padding', category: 'layout', slot: SLOT.padding, description: 'Space around it', source: () => '.padding(16)' },
  { name: 'frame', label: 'Size', category: 'layout', slot: SLOT.size, description: 'Width and height', source: () => '.frame(width: 100, height: 100)' },
  { name: 'background', label: 'Background', category: 'appearance', slot: SLOT.fill, description: 'A color behind it', source: () => '.background(Color.blue)' },
  { name: 'clipShape', label: 'Corner radius', category: 'appearance', slot: SLOT.clip, description: 'Round the corners', source: ({ target }) => roundedCorners(12, target) },
  { name: 'cornerRadius', label: 'Corner radius', category: 'appearance', slot: SLOT.clip, description: 'Round the corners', hidden: true, source: () => '.cornerRadius(8)' },
  // The overlay closure is iOS 15's; before it the border is the overlay's argument.
  { name: 'border', label: 'Border', category: 'appearance', slot: SLOT.stroke, description: 'An outline that follows the corners', source: ({ corners, indent, target }) => borderSource(NEW_BORDER, corners, target >= 15 && indent !== null ? { indent } : 'argument') },
  { name: 'shadow', label: 'Shadow', category: 'appearance', slot: SLOT.shadow, description: 'A drop shadow', source: ({ shadowToken }) => shadowToken ? `.shadow(.${shadowToken})` : '.shadow(color: Color.black.opacity(0.15), radius: 8, x: 0, y: 4)' },
  { name: 'offset', label: 'Offset', category: 'layout', slot: SLOT.offset, description: 'Nudge it without moving others', source: () => '.offset(x: 0, y: 0)' },
  { name: 'position', label: 'Position', category: 'layout', slot: SLOT.offset, description: 'Place its center at a point', source: () => '.position(x: 100, y: 100)' },
  // Under the status bar and the home indicator, which its Safe area field sets edge by edge (Wave 4c).
  { name: 'ignoresSafeArea', label: 'Safe area', category: 'layout', slot: SLOT.behaviour, description: 'Reach under the status bar and home indicator', minimumIOS: 14, source: () => '.ignoresSafeArea()' },
  { name: 'rotationEffect', label: 'Rotation', category: 'layout', slot: SLOT.offset, description: 'Turn it', source: () => '.rotationEffect(.degrees(15))' },
  { name: 'scaleEffect', label: 'Scale', category: 'layout', slot: SLOT.offset, description: 'Grow or shrink it', source: () => '.scaleEffect(1.1)' },
  { name: 'opacity', label: 'Opacity', category: 'appearance', slot: SLOT.effects, description: 'See-through', source: () => '.opacity(1)' },
  { name: 'blur', label: 'Blur', category: 'appearance', slot: SLOT.effects, description: 'Soften it', source: () => '.blur(radius: 4)' },
  { name: 'buttonStyle', label: 'Button style', category: 'appearance', slot: SLOT.behaviour, description: 'Filled, bordered or plain', minimumIOS: 15, only: ['Button'], source: () => '.buttonStyle(.borderedProminent)' },
  { name: 'buttonBorderShape', label: 'Button shape', category: 'appearance', slot: SLOT.behaviour, description: 'Capsule or rounded', minimumIOS: 15, only: ['Button'], source: () => '.buttonBorderShape(.capsule)' },
  { name: 'controlSize', label: 'Control size', category: 'appearance', slot: SLOT.behaviour, description: 'Small to large', minimumIOS: 15, source: () => '.controlSize(.regular)' },
  { name: 'tint', label: 'Accent color', category: 'appearance', slot: SLOT.behaviour, description: 'Color of buttons and controls inside', minimumIOS: 15, source: () => '.tint(Color.blue)' },
  { name: 'disabled', label: 'Disabled', category: 'behavior', slot: SLOT.behaviour, description: 'Cannot be tapped', source: () => '.disabled(true)' },
  { name: 'accessibilityLabel', label: 'Accessibility label', category: 'behavior', slot: SLOT.behaviour, description: 'What VoiceOver reads', source: () => '.accessibilityLabel("Label")' },
  { name: 'navigationTitle', label: 'Screen title', category: 'behavior', slot: SLOT.behaviour, description: 'The title in the navigation bar', minimumIOS: 14, source: () => '.navigationTitle("Title")' },
  { name: 'navigationBarTitleDisplayMode', label: 'Title size', category: 'behavior', slot: SLOT.behaviour, description: 'Large or inline title', minimumIOS: 14, source: () => '.navigationBarTitleDisplayMode(.inline)' },
]
/** A modifier whose closure holds `view`, written over lines of its own at the chain's indentation, or the view's. */
function closureSource(name: string, view: string, { indent, line, unit }: { indent: string | null; line: string; unit: string }): string {
  const at = indent ?? line
  return `.${name} {\n${at}${unit}${view}\n${at}}`
}
/**
 * Each entry by its name, the first of a name as `find` would give it, and the iOS it needs,
 * its own or its capability's. Every view read looks these up, so they are worked out once.
 */
const CATALOG_BY_NAME: ReadonlyMap<string, CatalogEntry> = new Map([...CATALOG].reverse().map(entry => [entry.name, entry]))
const CATALOG_MINIMUM: ReadonlyMap<CatalogEntry, number> = new Map(CATALOG.map(entry => [entry, Math.max(entry.minimumIOS ?? 13, Number.parseFloat(authoringCapability(entry.name, 'modifier', [null])?.minimumIOS ?? '13'))]))
/** What a modifier SwiftUI has, and the preview does not draw, says on its card. */
const NOT_DRAWN = 'Not drawn in the preview'
const LABELS: Readonly<Record<string, string>> = { task: 'Task', onAppear: 'When shown', onDisappear: 'When hidden', onChange: 'When value changes', onTapGesture: 'When tapped', onLongPressGesture: 'When held', resizable: 'Resize image', scaledToFit: 'Fit', scaledToFill: 'Fill', fill: 'Shape fill', sheet: 'Opens a sheet', fullScreenCover: 'Opens full screen', navigationDestination: 'Push destination', popover: 'Opens a popover', alert: 'Alert', toolbar: 'Toolbar', overlay: 'Overlay', tabItem: 'Tab bar item' }
const friendly = (name: string) => CATALOG_BY_NAME.get(name)?.label ?? LABELS[name] ?? name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase())
const nameOf = (call: CallExpr) => call.callee.kind === 'memberAccess' ? call.callee.member : 'unknown'
/** The shapes SwiftUI fills in with the foreground colour when nothing else paints them. */
const SHAPES = new Set(['Rectangle', 'RoundedRectangle', 'UnevenRoundedRectangle', 'Circle', 'Ellipse', 'Capsule', 'Path'])
/** Paints the catalogue does not add, in the slots of the fill and border they are. */
const PAINT_SLOTS: Readonly<Record<string, number>> = { fill: SLOT.fill, glassEffect: SLOT.fill, stroke: SLOT.stroke, strokeBorder: SLOT.stroke }
/** Where a modifier usually sits in a chain, from text styles to behaviour; 99 for one the studio does not place. */
export function slotOf(name: string): number {
  return CATALOG_BY_NAME.get(name)?.slot ?? PAINT_SLOTS[name] ?? (MODIFIER_CATEGORIES.text.has(name) ? SLOT.text : MODIFIER_CATEGORIES.layout.has(name) ? SLOT.offset : MODIFIER_CATEGORIES.behavior.has(name) ? SLOT.behaviour : 99)
}

/** Where a modifier is listed: Apple's in what it does, whether or not the preview draws it, and a project's own as custom. */
function category(name: string): ModifierCategory {
  const listed = (['behavior', 'layout', 'text'] as const).find(group => MODIFIER_CATEGORIES[group].has(name))
  return CATALOG_BY_NAME.get(name)?.category ?? listed ?? (isAppleCall(name) ? 'appearance' : 'custom')
}

// ---------------------------------------------------------------- the off marker
// The format - `/*studio-off:1 "…"*/` - lives in swift-syntax's off-markers.ts, because the edits need it too.


// ---------------------------------------------------------------- chain segments

/**
 * One entry of the chain: a modifier call, or a switched-off one.
 *
 * `start` includes the whitespace before it, so moving a segment moves it the way it
 * was written - which, with no switched-off entries, is exactly the previous
 * behaviour of moving each call's suffix slice.
 */
interface Segment {
  readonly start: number
  readonly textStart: number
  readonly end: number
  readonly call?: CallExpr
  /** The original text of a switched-off modifier. */
  readonly off?: string
}

function segmentsOf(expr: Expr, text: string): { base: CallExpr; segments: Segment[]; end: number } | null {
  const chain = viewCallChain(expr)
  if (!chain) return null
  const segments: Segment[] = []
  const markersIn = (from: number, to: number) => {
    const found: Segment[] = []
    const region = text.slice(from, to)
    for (const match of offMarkersIn(region)) {
      const textStart = from + match.index!
      const original = offMarkerText(match[0])
      if (original === undefined) continue
      const previousEnd = found.at(-1)?.end ?? from
      found.push({ start: previousEnd, textStart, end: textStart + match[0].length, off: original })
    }
    return found
  }
  let cursor = chain.base.span.end
  for (const call of chain.modifiers) {
    const callStart = call.callee.kind === 'memberAccess' && call.callee.base ? call.callee.base.span.end : call.span.start
    const markers = markersIn(callStart, dotOf(call, text))
    segments.push(...markers)
    segments.push({ start: markers.at(-1)?.end ?? cursor, textStart: dotOf(call, text), end: call.span.end, call })
    cursor = call.span.end
  }
  // Switched-off entries after the last call: whitespace and markers only.
  let end = expr.span.end
  const after = afterOffMarkers(text, end)
  if (after > end) {
    segments.push(...markersIn(end, after))
    end = after
  }
  return { base: chain.base, segments, end }
}
/**
 * What `modifier-remove` takes out for `call`, one of `expr`'s modifiers (Wave 4b): from where
 * the code before it ends to its own end, a switched-off modifier before it staying. Undefined
 * where a note or a `#if` in the chain holds its modifiers where they are.
 */
export function modifierSegment(expr: Expr, text: string, call: CallExpr): { start: number; end: number } | undefined {
  const parsed = segmentsOf(expr, text), segment = parsed?.segments.find(s => s.call === call)
  if (!parsed || !segment) return undefined
  const { commented, conditional } = heldInPlace(parsed, text, expr.span.file)
  return commented || conditional ? undefined : { start: segment.start, end: segment.end }
}

/** Where a call's own text begins: its dot, after any comments or line breaks before it. */
export function dotOf(call: CallExpr, text: string): number {
  if (call.callee.kind !== 'memberAccess') return call.span.start
  const dot = text.lastIndexOf('.', call.callee.memberSpan.start)
  return dot >= 0 && dot >= (call.callee.base?.span.end ?? 0) ? dot : call.callee.memberSpan.start
}

function pure(expr: Expr, depth = 0): boolean {
  if (depth > 6) return false
  return ['integerLiteral', 'floatLiteral', 'booleanLiteral', 'nilLiteral', 'identifier', 'stringLiteral'].includes(expr.kind) && (expr.kind !== 'stringLiteral' || expr.segments.every(s => s.kind === 'text'))
    || expr.kind === 'memberAccess' && (!expr.base || pure(expr.base, depth + 1))
    || expr.kind === 'tuple' && expr.elements.every(e => pure(e, depth + 1))
    || expr.kind === 'arrayLiteral' && expr.elements.every(e => pure(e, depth + 1))
    || expr.kind === 'unary' && ['+', '-'].includes(expr.operator) && pure(expr.operand, depth + 1)
    // `.rect(cornerRadius: 12)`, `.degrees(15)`, `Color.black.opacity(0.15)`, `Color(red:green:blue:)`:
    // plain values built from plain values, with no closure to capture anything.
    || expr.kind === 'call' && !expr.trailingClosure && (expr.callee.kind === 'identifier' || expr.callee.kind === 'memberAccess' && (!expr.callee.base || pure(expr.callee.base, depth + 1))) && expr.args.every(a => pure(a.value, depth + 1))
}
/** The motion modifiers a card takes out (Wave 5a). */
const MOTION_CARDS: ReadonlySet<string> = new Set(['transition', 'animation'])
/** Reordering is limited to known general View modifiers. Image/Shape operations stay pinned. */
function structural(call: CallExpr): boolean {
  const name = nameOf(call)
  if (!CATALOG.some(c => c.name === name) || !authoringCapability(name, 'modifier', call.args.map(a => a.label)) || call.trailingClosure || !call.args.every(a => pure(a.value))) return false
  // A view-producing background overload carries content ownership, unlike a color.
  if (name === 'background') {
    const value = call.args.length === 1 ? call.args[0]!.value : undefined
    return !!value && (value.kind === 'memberAccess' || value.kind === 'call' && value.callee.kind === 'identifier' && ['Color', 'LinearGradient', 'RadialGradient', 'AngularGradient'].includes(value.callee.name) || value.kind === 'call' && value.callee.kind === 'memberAccess' && value.callee.member === 'opacity')
  }
  return true
}

/** A switched-off modifier parsed on its own, with the text its spans are in. */
function offCall(original: string): { call: CallExpr; text: string } | undefined {
  const text = `let __off = Color.clear${original}`
  const parsed = Parser.parse(text, '__off.swift')
  const declaration = parsed.sourceFile.declarations[0]
  if (parsed.diagnostics.some(d => d.severity === 'error') || declaration?.kind !== 'varDecl' || declaration.initializer?.kind !== 'call') return undefined
  return { call: declaration.initializer, text }
}

/** What keeps every entry of a chain where it is written. */
function heldInPlace(parsed: { base: CallExpr; end: number }, text: string, file: string): { commented: boolean; conditional: boolean } {
  return {
    // Only comments a person wrote pin the chain; the studio's own off markers never do.
    commented: hasHumanComment(text.slice(parsed.base.span.end, parsed.end), file) || commentFollows(text, parsed.end),
    // A `#if` line goes with the modifier after it, so moving, removing or switching off any of
    // them would change which builds apply which, or leave a clause unclosed.
    conditional: DIRECTIVE_LINE.test(text.slice(parsed.base.span.end, parsed.end)),
  }
}

/**
 * The UI receives all source occurrences, including ones it cannot change. `allowEdits` is
 * false while the view's source has a problem to resolve first, and a run of joined text
 * (`node.textRun`) takes only what keeps it a Text (`KEEPS_TEXT`).
 */
export function modifierModel(node: AuthoringNode, expr: Expr, text: string, { deploymentTarget = DEFAULT_DEPLOYMENT_TARGET, allowEdits = true, row = false, tab = false, presented }: { deploymentTarget?: string; allowEdits?: boolean; row?: boolean; tab?: boolean; presented?: 'sheet' | 'cover' } = {}): { modifiers: AuthoringModifier[]; modifierCatalog: readonly ModifierCatalogEntry[] } {
  const run = !!node.textRun
  const parsed = segmentsOf(expr, text)
  if (!parsed) return { modifiers: [], modifierCatalog: [] }
  const { segments } = parsed
  const version = deploymentVersion(deploymentTarget)
  const minimumViewVersion = authoringViewMinimum(node)
  const editable = allowEdits && minimumViewVersion !== undefined && Number.isFinite(version) && version >= minimumViewVersion
  // Why nothing in the chain can change, named as what is in the way: a diagnostic only when there is one.
  const locked = !allowEdits ? 'Resolve source diagnostics or edit this view in Code.'
    : minimumViewVersion !== undefined && version < minimumViewVersion ? `${node.name} needs iOS ${minimumViewVersion} or newer. Change the deployment target to edit it here.`
      : 'This view is kept exactly as written, so its modifiers are changed in Code.'
  const { commented, conditional } = heldInPlace(parsed, text, node.source.file)
  const pinned = commented || conditional
  const pinnedReason = conditional ? 'A #if in this modifier chain decides which builds apply these modifiers. Change their order in Code.' : undefined
  const corners = cornersOf(viewCallChain(expr), text)
  // A shape with no fill or stroke left is filled in with the foreground colour, as SwiftUI draws it (D8).
  const paints = segments.filter(segment => segment.call && ['fill', 'stroke', 'strokeBorder'].includes(nameOf(segment.call)))
  const onlyStroke = (segment: Segment) => parsed.base.callee.kind === 'identifier' && SHAPES.has(parsed.base.callee.name) && paints.length === 1 && paints[0] === segment && nameOf(segment.call!) !== 'fill'
  // A border is written as an overlay, but is a setting like any other (D8).
  const borders = segments.map(segment => segment.call && borderOf(segment.call, corners, text))
  const movable = segments.map((segment, index) => editable && !pinned && (segment.off !== undefined || !!segment.call && (structural(segment.call) || !!borders[index])))
  // A view's transition and the animation of a value come out from their cards, and stay where they are written otherwise (Wave 5a).
  const removable = (segment: Segment) => editable && !pinned && !!segment.call && MOTION_CARDS.has(nameOf(segment.call)) && !!authoringCapability(nameOf(segment.call), 'modifier', segment.call.args.map(a => a.label))
  // A shape's own modifier stays straight after the shape, and nothing moves past it (Wave 4c).
  const stays = segments.map(segment => !!segment.call && !!CATALOG_BY_NAME.get(nameOf(segment.call))?.first)
  let callIndex = -1
  const modifiers: AuthoringModifier[] = segments.map((segment, index) => {
    const source: SourceSpan = { file: node.source.file, start: segment.start, end: segment.end }
    const capabilitiesOf = (reason?: string) => ({ remove: movable[index]! || removable(segment), duplicate: movable[index]!, moveUp: movable[index]! && index > 0 && movable[index - 1]! && !stays[index] && !stays[index - 1], moveDown: movable[index]! && index < segments.length - 1 && movable[index + 1]! && !stays[index] && !stays[index + 1], toggle: editable && !pinned, reason })
    if (segment.off !== undefined) {
      const off = offCall(segment.off)
      const name = !off ? 'unknown' : borderOf(off.call, corners, off.text) ? 'border' : nameOf(off.call)
      return { id: JSON.stringify([source.file, source.start, source.end, 'off', segment.off]), name, label: friendly(name), category: category(name), summary: 'Off', expression: segment.off.trim(), source, controls: [], propertyIds: [], enabled: false, capabilities: { edit: false, ...capabilitiesOf(!editable ? locked : pinnedReason ?? (commented ? 'Comments in this modifier chain need to stay attached. Reorder in Code.' : undefined)) } }
    }
    const call = segment.call!
    callIndex++
    const name = borders[index] ? 'border' : nameOf(call), start = call.callee.kind === 'memberAccess' && call.callee.base ? call.callee.base.span.end : call.span.start
    const expression = text.slice(start, call.span.end).trim()
    const own = `modifier:${callIndex}:`
    const controls = (node.controls ?? []).filter(control => {
      if (control.id.startsWith(own)) return true
      if (!control.id.startsWith('fill:') || name !== 'frame') return false
      const axis = control.id.slice(5), upper = axis[0]!.toUpperCase() + axis.slice(1)
      return call.args.some(a => [axis, `min${upper}`, `max${upper}`].includes(a.label ?? ''))
    })
    const known = !!authoringCapability(name, 'modifier', call.args.map(a => a.label))
    const reason = !editable ? locked : pinnedReason ?? (commented ? 'Comments in this modifier chain need to stay attached. Change values here or reorder in Code.' : !movable[index] ? category(name) === 'behavior' ? 'This behavior stays in its source position.' : !known ? 'This modifier is preserved; its structure is edited in Code.' : 'This modifier has type or content requirements. Change its structure in Code.' : undefined)
    const propertyIds = node.properties.filter(p => p.source && p.source.start >= start && p.source.end <= call.span.end).map(p => p.id)
    const linked = node.properties.find(p => p.source && p.source.start >= start && p.source.end <= call.span.end && p.valueKind === 'token')
    const drawn = SUPPORTED_MODIFIERS.has(name) || !isAppleCall(name)
    const summary = controls.filter(c => !c.id.startsWith('fill:')).map(c => c.value || 'Default').join(' · ') || (linked ? linked.expression : !drawn ? NOT_DRAWN : category(name) === 'custom' ? 'Custom modifier' : call.trailingClosure ? category(name) === 'behavior' ? 'Configured action' : 'View content' : call.args.length ? 'Linked or advanced value' : 'On')
    const { remove, duplicate, moveUp, moveDown, toggle } = capabilitiesOf(reason)
    const fillsIn = onlyStroke(segment)
    // Written out in full, in the order the keys always had: a spread between keys sends
    // every key after it down V8's slow path, once for every modifier of every view.
    const capabilities = { edit: editable && controls.length > 0, remove, duplicate, moveUp, moveDown, toggle: fillsIn ? false : toggle, reason: fillsIn ? 'Switched off, this stroke would leave the shape filled in. Change it in Code.' : reason }
    const id = JSON.stringify([source.file, call.span.start, call.span.end, expression]), label = friendly(name), shown = category(name), at = { ...call.span, start }
    return drawn ? { id, name, label, category: shown, summary, expression, source: at, controls, propertyIds, enabled: true, capabilities }
      : { id, name, label, category: shown, summary, expression, source: at, controls, propertyIds, enabled: true, drawn: false as const, capabilities }
  })
  // A project's own modifier may return anything, so nothing is added beside it; Apple's return `some View`.
  const unknown = segments.some(segment => segment.call && !isAppleCall(nameOf(segment.call)))
  const available = editable && !unknown
  // What is no view takes no view's modifier (Wave 4b).
  return { modifiers, modifierCatalog: isNonView(node) ? [] : catalogOf({ name: OFFERED_TO.has(node.name) ? node.name : '', run, row, tab, presented, available, unknown, version, allowEdits, locked }) }
}

/** What holds rows: a view in one is a row of a list (Wave 4a). */
const ROW_HOLDERS: ReadonlySet<string> = new Set(['List', 'Form', 'Section'])
/**
 * Whether a view is a row of a list (Wave 4a): a view of a List, a Form or a Section, or of
 * the row template of a List's data or of a ForEach in one of them. A Section holds rows.
 */
export function isRow(node: AuthoringNode, byId: (id: string | undefined) => AuthoringNode | undefined): boolean {
  const parent = byId(node.parentId)
  if (node.name === 'Section') return false
  if (parent?.kind !== 'template') return parent?.kind === 'view' && ROW_HOLDERS.has(parent.name)
  const data = byId(parent.parentId)
  return data?.name === 'List' || data?.name === 'ForEach' && ROW_HOLDERS.has(byId(data.parentId)?.name ?? '')
}

/**
 * Whether a view is a tab's (Wave 4c): one of a TabView's views, unless `pages` says that
 * TabView's views are swiped through (`pagesThrough`), which have no tab to badge.
 */
export function isTab(node: AuthoringNode, byId: (id: string | undefined) => AuthoringNode | undefined, pages: (tabView: AuthoringNode) => boolean): boolean {
  const parent = byId(node.parentId)
  return parent?.kind === 'view' && parent.name === 'TabView' && !pages(parent)
}

/** What decides the modifiers a view is offered, and why one is not. */
interface CatalogFacts {
  /** The view's name when an entry is `only` for it; any other view is offered what one named '' is. */
  readonly name: string
  readonly run: boolean
  /** A row of a list, which is offered the row settings. */
  readonly row: boolean
  /** A tab's view, which is offered a badge as a row is (Wave 4c). */
  readonly tab: boolean
  /** How the view is presented, when it is the one a sheet or a cover shows, which is offered their settings. */
  readonly presented: 'sheet' | 'cover' | undefined
  readonly available: boolean
  readonly unknown: boolean
  readonly version: number
  readonly allowEdits: boolean
  readonly locked: string
}
const OFFERED_TO: ReadonlySet<string> = new Set(CATALOG.flatMap(entry => entry.only ?? []))
/**
 * The catalogs built so far, by the facts they follow from: views alike share one list, as
 * building one for each view of a large project was much of the time reading it took.
 * Bounded, as the names in it come from projects.
 */
const catalogs = new Map<string, readonly ModifierCatalogEntry[]>()

function catalogOf(facts: CatalogFacts): readonly ModifierCatalogEntry[] {
  const { name, run, row, tab, presented, available, unknown, version, allowEdits, locked } = facts
  const key = [name, run, row, tab, presented, available, unknown, version, allowEdits, locked].join('|')
  const built = catalogs.get(key)
  if (built) return built
  const catalog = CATALOG.filter(entry => (!entry.only || entry.only.includes(name)) && (!entry.row || row || entry.tab && tab) && (!entry.presented || presented && (presented === 'sheet' || entry.presented === 'cover'))).map(entry => {
    const minimum = Math.max(CATALOG_MINIMUM.get(entry)!, run ? KEEPS_TEXT[entry.name] ?? 13 : 13)
    const styleOnly = !run || entry.name in KEEPS_TEXT
    const supported = available && styleOnly && version >= minimum
    const reason = !styleOnly ? runRefusal(`Put the joined text in parentheses in Code to give all of it ${entry.label.toLowerCase()}.`) : unknown ? 'This view has a custom modifier. Add styling in Code until its return type is known.' : available ? needsNewerIOS(minimum, 'use') : !allowEdits ? 'This view cannot be changed until its source is resolved.' : locked
    return { name: entry.name, label: entry.label, category: entry.category, description: entry.description, ...(entry.hidden ? { hidden: true } : {}), available: supported, reason: supported ? undefined : reason }
  })
  if (catalogs.size >= 256) catalogs.clear()
  catalogs.set(key, catalog)
  return catalog
}

/** Move whole segments; never reconstruct an existing modifier or its arguments. */
export function editModifier(node: AuthoringNode, expr: Expr, text: string, operation: ModifierOperation, deploymentTarget?: string, options: { shadowToken?: string; row?: boolean; tab?: boolean; presented?: 'sheet' | 'cover' } = {}): string {
  const parsed = segmentsOf(expr, text)
  if (!parsed) throw new Error('Select a view with an editable modifier chain.')
  const model = modifierModel(node, expr, text, { deploymentTarget, row: options.row, tab: options.tab, presented: options.presented })
  const { segments } = parsed
  const slices = segments.map(s => text.slice(s.start, s.end))
  const chainStart = segments[0]?.start ?? expr.span.end
  const rebuild = (parts: readonly string[]) => text.slice(0, parsed.base.span.end) + text.slice(parsed.base.span.end, chainStart) + parts.join('') + text.slice(parsed.end)
  if (operation.kind === 'modifier-add') {
    const entry = CATALOG.find(c => c.name === operation.name), offered = entry && model.modifierCatalog.find(c => c.name === entry.name)
    // A row's setting off a row says what it needs, and one the view is offered says why not (Wave 4a).
    if (entry?.row && !options.row && !(entry.tab && options.tab)) throw new Error(`${entry.label} can only be added to a row of a List, a Form or a Section${entry.tab ? ', or to a tab' : ''}.`)
    if (entry?.presented && !options.presented) throw new Error(`${entry.label} can only be added to the view a sheet shows.`)
    if (!entry || !offered?.available) throw new Error(offered?.reason ?? 'This modifier cannot be added to the selected view.')
    let index: number
    // A shape's own modifier goes straight after the shape, wherever it was dropped.
    if (entry.first) index = 0
    else if (operation.before !== undefined) {
      index = model.modifiers.findIndex(m => m.id === operation.before)
      if (index < 0) throw new Error('The modifier insertion point changed. Select the view again.')
    } else index = placement(model.modifiers, entry.slot)
    // Inserting before a call only the view's own type takes, or one the project declares, can make
    // otherwise valid Swift invalid, and a comment or `#if` keeps every entry where it is. Any of
    // Apple's view modifiers returns `some View`, so a new one can go before it.
    const held = Object.values(heldInPlace(parsed, text, node.source.file)).some(Boolean)
    const pinned = (modifier: AuthoringModifier) => !modifier.capabilities.remove && (held || !APPLE_VIEW_MODIFIERS.has(modifier.name))
    // A shape's own modifier gives a shape, which every call after it takes as it took the shape.
    if (index < segments.length && !entry.first && model.modifiers.slice(index).some(pinned)) {
      if (operation.before !== undefined) throw new Error('Add this modifier after the pinned entries to preserve their type and behavior requirements.')
      index = segments.length
    }
    const at = index < segments.length ? segments[index]!.start : parsed.end
    // On a line of its own where the chain has its modifiers on lines of their own, and under a block's closing brace.
    const slots = chainSlots(expr, text)
    const prefix = slots ? modifierPrefix(slots, text) : ''
    const corners = cornersOf(viewCallChain(expr), text)
    const { indent: line, unit } = indentAt(text, expr.span.start)
    return text.slice(0, at) + prefix + entry.source({ target: deploymentVersion(deploymentTarget), shadowToken: options.shadowToken, corners, indent: prefix ? prefix.replace(/^\r?\n/, '') : null, line, unit }) + text.slice(at)
  }
  const index = model.modifiers.findIndex(m => m.id === operation.modifier)
  if (index < 0) throw new Error('The modifier identity changed. Select the view again.')
  const current = model.modifiers[index]!, segment = segments[index]!
  if (operation.kind === 'modifier-toggle') {
    if (!current.capabilities.toggle) throw new Error(current.capabilities.reason ?? 'This modifier cannot be switched off here.')
    if (operation.enabled === (current.enabled !== false)) return text
    if (operation.enabled) return text.slice(0, segment.textStart) + segment.off! + text.slice(segment.end)
    return text.slice(0, segment.textStart) + offMarker(text.slice(segment.textStart, segment.end)) + text.slice(segment.end)
  }
  if (operation.kind === 'modifier-remove') {
    if (!current.capabilities.remove) throw new Error(current.capabilities.reason ?? 'This modifier cannot be removed safely.')
    return text.slice(0, segment.start) + text.slice(segment.end)
  }
  if (operation.kind === 'modifier-duplicate') {
    if (!current.capabilities.duplicate) throw new Error(current.capabilities.reason ?? 'This modifier cannot be duplicated safely.')
    return text.slice(0, segment.end) + slices[index]! + text.slice(segment.end)
  }
  const destination = operation.toIndex
  if (!Number.isInteger(destination) || destination < 0 || destination >= segments.length) throw new Error('Choose a valid modifier position.')
  if (destination === index) return text
  if (model.modifiers.slice(Math.min(index, destination), Math.max(index, destination) + 1).some(m => !m.capabilities.remove || CATALOG_BY_NAME.get(m.name)?.first)) throw new Error('This move would cross a pinned modifier. Preserve its source position.')
  const moved = slices.splice(index, 1)[0]!
  slices.splice(destination, 0, moved)
  return rebuild(slices)
}

/**
 * Where a new modifier lands when the designer does not say.
 *
 * After the last modifier in the same or an earlier slot - text styles first, then
 * padding, size, background, corners, border, shadow, movement, effects, behaviour -
 * so padding added after a background still colours the padded box. Existing
 * modifiers never move; with anything unrecognised in the stack it goes last.
 */
function placement(modifiers: readonly AuthoringModifier[], slot: number): number {
  if (modifiers.some(m => m.category === 'custom')) return modifiers.length
  let index = 0
  for (const [i, modifier] of modifiers.entries()) if (slotOf(modifier.name) <= slot) index = i + 1
  return index
}
