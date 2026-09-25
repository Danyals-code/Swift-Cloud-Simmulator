import { DEFAULT_DEPLOYMENT_TARGET, authoringCapability, deploymentVersion, type AuthoringModifier, type AuthoringNode, type ModifierCatalogEntry, type ModifierCategory, type ModifierOperation, type SourceSpan } from '@studio/shared'
import { Parser, afterOffMarkers, hasHumanComment, offMarker, offMarkerText, offMarkersIn, withoutOffMarkers, type CallExpr, type Expr } from '@studio/swift-syntax'
import { roundedCorners, viewCallChain } from './design-controls'
import { NEW_BORDER, borderOf, borderSource, cornersOf, type Corners } from './authoring-border'
import { authoringViewMinimum } from './authoring-view'
import { SUPPORTED_MODIFIERS } from './builtins'

/**
 * The modifier stack: everything written after a view is created, in source order.
 *
 * The stack *is* the code. Each entry is one `.modifier(…)` in the chain, and the
 * order on screen is the order in the file, because in SwiftUI the order changes the
 * result. A modifier can be switched off without deleting it: it is commented out in
 * place with its exact text inside a versioned marker, and switching it on writes that
 * text back byte for byte.
 */

interface CatalogEntry {
  readonly name: string
  readonly label: string
  readonly category: ModifierCategory
  /** Where a new one goes: after the last modifier in the same or an earlier slot. */
  readonly slot: number
  readonly description: string
  /** `indent` is the indentation of the view's modifiers when each is on a line of its own, and null on one line. */
  readonly source: (options: { target: number; shadowToken?: string; corners: Corners; indent: string | null }) => string
  readonly minimumIOS?: number
  readonly only?: readonly string[]
  readonly hidden?: boolean
}

const CATALOG: readonly CatalogEntry[] = [
  { name: 'font', label: 'Font', category: 'text', slot: 1, description: 'Text style and size', source: () => '.font(.body)' },
  { name: 'foregroundStyle', label: 'Text color', category: 'text', slot: 1, description: 'Color of text and symbols', minimumIOS: 15, source: () => '.foregroundStyle(Color.primary)' },
  { name: 'foregroundColor', label: 'Text color', category: 'text', slot: 1, description: 'Color of text and symbols', hidden: true, source: () => '.foregroundColor(Color.primary)' },
  { name: 'bold', label: 'Bold', category: 'text', slot: 1, description: 'Heavier text', source: () => '.bold()' },
  { name: 'italic', label: 'Italic', category: 'text', slot: 1, description: 'Slanted text', source: () => '.italic()' },
  { name: 'underline', label: 'Underline', category: 'text', slot: 1, description: 'A line under the text', source: () => '.underline()' },
  { name: 'strikethrough', label: 'Strikethrough', category: 'text', slot: 1, description: 'A line through the text', source: () => '.strikethrough()' },
  { name: 'multilineTextAlignment', label: 'Text alignment', category: 'text', slot: 1, description: 'Left, center or right', source: () => '.multilineTextAlignment(.center)' },
  { name: 'lineLimit', label: 'Max lines', category: 'text', slot: 1, description: 'Cut long text after some lines', source: () => '.lineLimit(3)' },
  { name: 'tracking', label: 'Letter spacing', category: 'text', slot: 1, description: 'Space between letters', minimumIOS: 16, source: () => '.tracking(1)' },
  { name: 'lineSpacing', label: 'Line spacing', category: 'text', slot: 1, description: 'Space between lines', source: () => '.lineSpacing(4)' },
  // Width and Height sizing say Hug, Fill or Fixed (D2); these two were a second way to say it,
  // and read as the same thing. A frame or fixedSize already in the code keeps its card.
  { name: 'frameFlexible', label: 'Flexible size', category: 'layout', slot: 3, description: 'Flexible size', minimumIOS: 13, hidden: true, source: () => '.frame(minWidth: 0, idealWidth: 160, maxWidth: .infinity, minHeight: 0, idealHeight: 80, maxHeight: .infinity)' },
  { name: 'fixedSize', label: 'Ideal size', category: 'layout', slot: 3, description: 'Ideal size', minimumIOS: 13, hidden: true, source: () => '.fixedSize(horizontal: true, vertical: true)' },
  { name: 'aspectRatio', label: 'Aspect ratio', category: 'layout', slot: 3, description: 'Aspect ratio', minimumIOS: 13, source: () => '.aspectRatio(1, contentMode: .fit)' },
  { name: 'clipped', label: 'Clip to bounds', category: 'appearance', slot: 5, description: 'Clip to bounds', minimumIOS: 13, source: () => '.clipped()' },
  { name: 'rotation3DEffect', label: '3D rotation', category: 'layout', slot: 8, description: '3D rotation', minimumIOS: 13, source: () => '.rotation3DEffect(.degrees(30), axis: (x: 0, y: 1, z: 0), anchor: .center, anchorZ: 0, perspective: 1)' },
  { name: 'saturation', label: 'Saturation', category: 'appearance', slot: 9, description: 'Saturation', minimumIOS: 13, source: () => '.saturation(1)' },
  { name: 'brightness', label: 'Brightness', category: 'appearance', slot: 9, description: 'Brightness', minimumIOS: 13, source: () => '.brightness(0)' },
  { name: 'contrast', label: 'Contrast', category: 'appearance', slot: 9, description: 'Contrast', minimumIOS: 13, source: () => '.contrast(1)' },
  { name: 'grayscale', label: 'Grayscale', category: 'appearance', slot: 9, description: 'Grayscale', minimumIOS: 13, source: () => '.grayscale(0.5)' },
  { name: 'colorMultiply', label: 'Multiply color', category: 'appearance', slot: 9, description: 'Multiply color', minimumIOS: 13, source: () => '.colorMultiply(Color.white)' },
  { name: 'hueRotation', label: 'Hue rotation', category: 'appearance', slot: 9, description: 'Hue rotation', minimumIOS: 13, source: () => '.hueRotation(.degrees(30))' },
  { name: 'blendMode', label: 'Blend mode', category: 'appearance', slot: 9, description: 'Blend mode', minimumIOS: 13, source: () => '.blendMode(.normal)' },
  { name: 'layoutPriority', label: 'Layout priority', category: 'layout', slot: 3, description: 'Layout priority', minimumIOS: 13, source: () => '.layoutPriority(1)' },
  { name: 'fontWeight', label: 'Font weight', category: 'text', slot: 1, description: 'Font weight', minimumIOS: 13, source: () => '.fontWeight(.semibold)' },
  { name: 'fontDesign', label: 'Font design', category: 'text', slot: 1, description: 'Font design', minimumIOS: 16, source: () => '.fontDesign(.default)' },
  { name: 'kerning', label: 'Kerning', category: 'text', slot: 1, description: 'Kerning', minimumIOS: 16, source: () => '.kerning(1)' },
  { name: 'baselineOffset', label: 'Baseline offset', category: 'text', slot: 1, description: 'Baseline offset', minimumIOS: 16, source: () => '.baselineOffset(2)' },
  { name: 'textCase', label: 'Text case', category: 'text', slot: 1, description: 'Text case', minimumIOS: 13, source: () => '.textCase(.uppercase)' },
  { name: 'minimumScaleFactor', label: 'Minimum text scale', category: 'text', slot: 1, description: 'Minimum text scale', minimumIOS: 13, source: () => '.minimumScaleFactor(0.5)' },
  { name: 'truncationMode', label: 'Truncation', category: 'text', slot: 1, description: 'Truncation', minimumIOS: 13, source: () => '.truncationMode(.tail)' },
  { name: 'allowsTightening', label: 'Tighten text', category: 'text', slot: 1, description: 'Tighten text', minimumIOS: 13, source: () => '.allowsTightening(true)' },
  { name: 'allowsHitTesting', label: 'Allow interaction', category: 'behavior', slot: 10, description: 'Allow interaction', minimumIOS: 13, source: () => '.allowsHitTesting(true)' },
  { name: 'accessibilityHidden', label: 'Hide from accessibility', category: 'behavior', slot: 10, description: 'Hide from accessibility', minimumIOS: 13, source: () => '.accessibilityHidden(true)' },
  { name: 'accessibilityValue', label: 'Accessibility value', category: 'behavior', slot: 10, description: 'Accessibility value', minimumIOS: 13, source: () => '.accessibilityValue("Value")' },
  { name: 'accessibilityHint', label: 'Accessibility hint', category: 'behavior', slot: 10, description: 'Accessibility hint', minimumIOS: 13, source: () => '.accessibilityHint("Hint")' },
  { name: 'toggleStyle', label: 'Toggle style', category: 'appearance', slot: 10, description: 'Toggle style', minimumIOS: 13, only: ['Toggle'], source: () => '.toggleStyle(.switch)' },
  { name: 'pickerStyle', label: 'Picker style', category: 'appearance', slot: 10, description: 'Picker style', minimumIOS: 14, only: ['Picker'], source: () => '.pickerStyle(.menu)' },
  { name: 'progressViewStyle', label: 'Progress style', category: 'appearance', slot: 10, description: 'Progress style', minimumIOS: 14, only: ['ProgressView'], source: () => '.progressViewStyle(.linear)' },
  { name: 'gaugeStyle', label: 'Gauge style', category: 'appearance', slot: 10, description: 'Gauge style', minimumIOS: 16, only: ['Gauge'], source: () => '.gaugeStyle(.linearCapacity)' },
  { name: 'labelStyle', label: 'Label style', category: 'appearance', slot: 10, description: 'Label style', minimumIOS: 14, only: ['Label'], source: () => '.labelStyle(.titleAndIcon)' },
  { name: 'textFieldStyle', label: 'Input style', category: 'appearance', slot: 10, description: 'Input style', minimumIOS: 13, only: ['TextField', 'SecureField'], source: () => '.textFieldStyle(.roundedBorder)' },
  { name: 'listStyle', label: 'List style', category: 'appearance', slot: 10, description: 'List style', minimumIOS: 14, only: ['List', 'Form'], source: () => '.listStyle(.insetGrouped)' },
  { name: 'scrollIndicators', label: 'Scroll indicators', category: 'appearance', slot: 10, description: 'Scroll indicators', minimumIOS: 16, only: ['ScrollView', 'List', 'Form'], source: () => '.scrollIndicators(.visible)' },
  { name: 'scrollContentBackground', label: 'Scroll background', category: 'appearance', slot: 10, description: 'Scroll background', minimumIOS: 16, only: ['ScrollView', 'List', 'Form'], source: () => '.scrollContentBackground(.hidden)' },
  { name: 'imageScale', label: 'Symbol size', category: 'appearance', slot: 10, description: 'Symbol size', minimumIOS: 13, only: ['Image', 'Label'], source: () => '.imageScale(.large)' },
  { name: 'listRowSeparator', label: 'Row separator', category: 'appearance', slot: 10, description: 'Row separator', minimumIOS: 15, source: () => '.listRowSeparator(.hidden)' },
  { name: 'listRowSpacing', label: 'Row spacing', category: 'appearance', slot: 10, description: 'Row spacing', minimumIOS: 17, only: ['List', 'Form'], source: () => '.listRowSpacing(8)' },
  { name: 'listSectionSpacing', label: 'Section spacing', category: 'appearance', slot: 10, description: 'Section spacing', minimumIOS: 17, only: ['List', 'Form'], source: () => '.listSectionSpacing(24)' },
  { name: 'padding', label: 'Padding', category: 'layout', slot: 2, description: 'Space around it', source: () => '.padding(16)' },
  { name: 'frame', label: 'Size', category: 'layout', slot: 3, description: 'Width and height', source: () => '.frame(width: 100, height: 100)' },
  { name: 'background', label: 'Background', category: 'appearance', slot: 4, description: 'A color behind it', source: () => '.background(Color.blue)' },
  { name: 'clipShape', label: 'Corner radius', category: 'appearance', slot: 5, description: 'Round the corners', source: ({ target }) => roundedCorners(12, target) },
  { name: 'cornerRadius', label: 'Corner radius', category: 'appearance', slot: 5, description: 'Round the corners', hidden: true, source: () => '.cornerRadius(8)' },
  // The overlay closure is iOS 15's; before it the border is the overlay's argument.
  { name: 'border', label: 'Border', category: 'appearance', slot: 6, description: 'An outline that follows the corners', source: ({ corners, indent, target }) => borderSource(NEW_BORDER, corners, target >= 15 && indent !== null ? { indent } : 'argument') },
  { name: 'shadow', label: 'Shadow', category: 'appearance', slot: 7, description: 'A drop shadow', source: ({ shadowToken }) => shadowToken ? `.shadow(.${shadowToken})` : '.shadow(color: Color.black.opacity(0.15), radius: 8, x: 0, y: 4)' },
  { name: 'offset', label: 'Offset', category: 'layout', slot: 8, description: 'Nudge it without moving others', source: () => '.offset(x: 0, y: 0)' },
  { name: 'rotationEffect', label: 'Rotation', category: 'layout', slot: 8, description: 'Turn it', source: () => '.rotationEffect(.degrees(15))' },
  { name: 'scaleEffect', label: 'Scale', category: 'layout', slot: 8, description: 'Grow or shrink it', source: () => '.scaleEffect(1.1)' },
  { name: 'opacity', label: 'Opacity', category: 'appearance', slot: 9, description: 'See-through', source: () => '.opacity(1)' },
  { name: 'blur', label: 'Blur', category: 'appearance', slot: 9, description: 'Soften it', source: () => '.blur(radius: 4)' },
  { name: 'buttonStyle', label: 'Button style', category: 'appearance', slot: 10, description: 'Filled, bordered or plain', minimumIOS: 15, only: ['Button'], source: () => '.buttonStyle(.borderedProminent)' },
  { name: 'buttonBorderShape', label: 'Button shape', category: 'appearance', slot: 10, description: 'Capsule or rounded', minimumIOS: 15, only: ['Button'], source: () => '.buttonBorderShape(.capsule)' },
  { name: 'controlSize', label: 'Control size', category: 'appearance', slot: 10, description: 'Small to large', minimumIOS: 15, source: () => '.controlSize(.regular)' },
  { name: 'tint', label: 'Accent color', category: 'appearance', slot: 10, description: 'Color of buttons and controls inside', minimumIOS: 15, source: () => '.tint(Color.blue)' },
  { name: 'disabled', label: 'Disabled', category: 'behavior', slot: 10, description: 'Cannot be tapped', source: () => '.disabled(true)' },
  { name: 'accessibilityLabel', label: 'Accessibility label', category: 'behavior', slot: 10, description: 'What VoiceOver reads', source: () => '.accessibilityLabel("Label")' },
  { name: 'navigationTitle', label: 'Screen title', category: 'behavior', slot: 10, description: 'The title in the navigation bar', minimumIOS: 14, source: () => '.navigationTitle("Title")' },
  { name: 'navigationBarTitleDisplayMode', label: 'Title size', category: 'behavior', slot: 10, description: 'Large or inline title', minimumIOS: 14, source: () => '.navigationBarTitleDisplayMode(.inline)' },
]
const BEHAVIOR = new Set(['task', 'onAppear', 'onDisappear', 'onChange', 'onReceive', 'onTapGesture', 'onLongPressGesture', 'onSubmit', 'onDelete', 'onMove', 'gesture', 'simultaneousGesture', 'highPriorityGesture', 'sheet', 'fullScreenCover', 'alert', 'confirmationDialog', 'popover', 'navigationDestination', 'navigationTitle', 'navigationBarTitleDisplayMode', 'toolbar', 'tabItem', 'tag', 'id', 'environment', 'environmentObject', 'disabled', 'allowsHitTesting', 'animation', 'transition', 'searchable', 'contextMenu', 'accessibilityLabel', 'accessibilityIdentifier', 'accessibilityValue', 'accessibilityHint', 'accessibilityHidden'])
const LAYOUT = new Set(['offset', 'position', 'fixedSize', 'alignmentGuide', 'safeAreaInset', 'containerRelativeFrame', 'layoutPriority', 'aspectRatio', 'scaledToFit', 'scaledToFill', 'ignoresSafeArea'])
const TEXT = new Set(['bold', 'italic', 'fontWeight', 'fontDesign', 'multilineTextAlignment', 'textCase', 'underline', 'strikethrough', 'kerning', 'tracking', 'baselineOffset', 'lineSpacing', 'minimumScaleFactor', 'truncationMode', 'allowsTightening', 'monospacedDigit'])
const LABELS: Readonly<Record<string, string>> = { task: 'Task', onAppear: 'When shown', onDisappear: 'When hidden', onChange: 'When value changes', onTapGesture: 'When tapped', onLongPressGesture: 'When held', resizable: 'Resize image', scaledToFit: 'Fit', scaledToFill: 'Fill', fill: 'Shape fill', sheet: 'Opens a sheet', fullScreenCover: 'Opens full screen', navigationDestination: 'Push destination', popover: 'Opens a popover', alert: 'Alert', toolbar: 'Toolbar', overlay: 'Overlay', tabItem: 'Tab bar item' }
const friendly = (name: string) => CATALOG.find(c => c.name === name)?.label ?? LABELS[name] ?? name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase())
const nameOf = (call: CallExpr) => call.callee.kind === 'memberAccess' ? call.callee.member : 'unknown'
/** The shapes SwiftUI fills in with the foreground colour when nothing else paints them. */
const SHAPES = new Set(['Rectangle', 'RoundedRectangle', 'UnevenRoundedRectangle', 'Circle', 'Ellipse', 'Capsule', 'Path'])
const slotOf = (name: string) => CATALOG.find(c => c.name === name)?.slot ?? (TEXT.has(name) ? 1 : LAYOUT.has(name) ? 8 : BEHAVIOR.has(name) ? 10 : 99)

function category(name: string): ModifierCategory {
  return CATALOG.find(c => c.name === name)?.category ?? (BEHAVIOR.has(name) ? 'behavior' : LAYOUT.has(name) ? 'layout' : TEXT.has(name) ? 'text' : SUPPORTED_MODIFIERS.has(name) ? 'appearance' : 'custom')
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
/** Where a call's own text begins: its dot, after any comments or line breaks before it. */
function dotOf(call: CallExpr, text: string): number {
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

/** The UI receives all source occurrences, including ones it cannot change. */
export function modifierModel(node: AuthoringNode, expr: Expr, text: string, deploymentTarget = DEFAULT_DEPLOYMENT_TARGET, allowEdits = true): { modifiers: AuthoringModifier[]; modifierCatalog: ModifierCatalogEntry[] } {
  const parsed = segmentsOf(expr, text)
  if (!parsed) return { modifiers: [], modifierCatalog: [] }
  const { segments } = parsed
  const version = deploymentVersion(deploymentTarget)
  const minimumViewVersion = authoringViewMinimum(node)
  const editable = allowEdits && minimumViewVersion !== undefined && Number.isFinite(version) && version >= minimumViewVersion
  // Only comments a person wrote pin the chain; the studio's own off markers never do.
  const commented = hasHumanComment(text.slice(parsed.base.span.end, parsed.end), node.source.file) || /^[^\S\r\n]*(?:\/\/|\/\*)/.test(withoutOffMarkers(text.slice(parsed.end)))
  const corners = cornersOf(viewCallChain(expr)?.modifiers ?? [], text)
  // A shape with no fill or stroke left is filled in with the foreground colour, as SwiftUI draws it (D8).
  const paints = segments.filter(segment => segment.call && ['fill', 'stroke', 'strokeBorder'].includes(nameOf(segment.call)))
  const onlyStroke = (segment: Segment) => parsed.base.callee.kind === 'identifier' && SHAPES.has(parsed.base.callee.name) && paints.length === 1 && paints[0] === segment && nameOf(segment.call!) !== 'fill'
  // A border is written as an overlay, but is a setting like any other (D8).
  const borders = segments.map(segment => segment.call && borderOf(segment.call, corners, text))
  const movable = segments.map((segment, index) => editable && !commented && (segment.off !== undefined || !!segment.call && (structural(segment.call) || !!borders[index])))
  let callIndex = -1
  const modifiers: AuthoringModifier[] = segments.map((segment, index) => {
    const source: SourceSpan = { file: node.source.file, start: segment.start, end: segment.end }
    const capabilitiesOf = (reason?: string) => ({ remove: movable[index]!, duplicate: movable[index]!, moveUp: movable[index]! && index > 0 && movable[index - 1]!, moveDown: movable[index]! && index < segments.length - 1 && movable[index + 1]!, toggle: editable && !commented, reason })
    if (segment.off !== undefined) {
      const off = offCall(segment.off)
      const name = !off ? 'unknown' : borderOf(off.call, corners, off.text) ? 'border' : nameOf(off.call)
      return { id: JSON.stringify([source.file, source.start, source.end, 'off', segment.off]), name, label: friendly(name), category: category(name), summary: 'Off', expression: segment.off.trim(), source, controls: [], propertyIds: [], enabled: false, capabilities: { edit: false, ...capabilitiesOf(!editable ? 'Resolve source diagnostics or edit this view in Code.' : commented ? 'Comments in this modifier chain need to stay attached. Reorder in Code.' : undefined) } }
    }
    const call = segment.call!
    callIndex++
    const name = borders[index] ? 'border' : nameOf(call), start = call.callee.kind === 'memberAccess' && call.callee.base ? call.callee.base.span.end : call.span.start
    const expression = text.slice(start, call.span.end).trim()
    const controls = (node.controls ?? []).filter(control => {
      if (control.id.startsWith(`modifier:${callIndex}:`)) return true
      if (!control.id.startsWith('fill:') || name !== 'frame') return false
      const axis = control.id.slice(5), upper = axis[0]!.toUpperCase() + axis.slice(1)
      return call.args.some(a => [axis, `min${upper}`, `max${upper}`].includes(a.label ?? ''))
    })
    const known = !!authoringCapability(name, 'modifier', call.args.map(a => a.label))
    const reason = !editable ? 'Resolve source diagnostics or edit this view in Code.' : commented ? 'Comments in this modifier chain need to stay attached. Change values here or reorder in Code.' : !movable[index] ? category(name) === 'behavior' ? 'This behavior stays in its source position.' : !known ? 'This modifier is preserved; its structure is edited in Code.' : 'This modifier has type or content requirements. Change its structure in Code.' : undefined
    const propertyIds = node.properties.filter(p => p.source && p.source.start >= start && p.source.end <= call.span.end).map(p => p.id)
    const linked = node.properties.find(p => p.source && p.source.start >= start && p.source.end <= call.span.end && p.valueKind === 'token')
    const summary = controls.filter(c => !c.id.startsWith('fill:')).map(c => c.value || 'Default').join(' · ') || (linked ? linked.expression : category(name) === 'custom' ? 'Custom modifier' : call.trailingClosure ? category(name) === 'behavior' ? 'Configured action' : 'View content' : call.args.length ? 'Linked or advanced value' : 'On')
    const { reason: _unused, ...caps } = capabilitiesOf(reason)
    void _unused
    const fillsIn = onlyStroke(segment)
    return { id: JSON.stringify([source.file, call.span.start, call.span.end, expression]), name, label: friendly(name), category: category(name), summary, expression, source: { ...call.span, start }, controls, propertyIds, enabled: true, capabilities: { edit: editable && controls.length > 0, ...caps, ...(fillsIn ? { toggle: false } : {}), reason: fillsIn ? 'Switched off, this stroke would leave the shape filled in. Change it in Code.' : reason } }
  })
  const unknown = segments.some(segment => segment.call && !SUPPORTED_MODIFIERS.has(nameOf(segment.call)))
  const available = editable && !unknown
  return { modifiers, modifierCatalog: CATALOG.filter(entry => !entry.only || entry.only.includes(node.name)).map(entry => {
    const minimum = Math.max(entry.minimumIOS ?? 13, Number.parseFloat(authoringCapability(entry.name, 'modifier', [null])?.minimumIOS ?? '13'))
    const supported = available && version >= minimum
    return { name: entry.name, label: entry.label, category: entry.category, description: entry.description, ...(entry.hidden ? { hidden: true } : {}), available: supported, reason: supported ? undefined : unknown ? 'This view has a custom modifier. Add styling in Code until its return type is known.' : available ? `Needs iOS ${minimum} or newer. Change the deployment target to use it.` : node.name === 'Tab' && node.kind !== 'component' ? 'Select the view inside this tab to style its content.' : 'This view cannot be changed until its source is resolved.' }
  }) }
}

/** Move whole segments; never reconstruct an existing modifier or its arguments. */
export function editModifier(node: AuthoringNode, expr: Expr, text: string, operation: ModifierOperation, deploymentTarget?: string, options: { shadowToken?: string } = {}): string {
  const parsed = segmentsOf(expr, text)
  if (!parsed) throw new Error('Select a view with an editable modifier chain.')
  const model = modifierModel(node, expr, text, deploymentTarget)
  const { segments } = parsed
  const slices = segments.map(s => text.slice(s.start, s.end))
  const chainStart = segments[0]?.start ?? expr.span.end
  const rebuild = (parts: readonly string[]) => text.slice(0, parsed.base.span.end) + text.slice(parsed.base.span.end, chainStart) + parts.join('') + text.slice(parsed.end)
  if (operation.kind === 'modifier-add') {
    const entry = CATALOG.find(c => c.name === operation.name)
    if (!entry || !model.modifierCatalog.find(c => c.name === entry.name)?.available) throw new Error('This modifier cannot be added to the selected view.')
    let index: number
    if (operation.before !== undefined) {
      index = model.modifiers.findIndex(m => m.id === operation.before)
      if (index < 0) throw new Error('The modifier insertion point changed. Select the view again.')
    } else index = placement(model.modifiers, entry.slot)
    // Inserting before a type-specific operation can make otherwise valid Swift invalid.
    if (index < segments.length && model.modifiers.slice(index).some(m => !m.capabilities.remove)) {
      if (operation.before !== undefined) throw new Error('Add this modifier after the pinned entries to preserve their type and behavior requirements.')
      index = segments.length
    }
    const at = index < segments.length ? segments[index]!.start : parsed.end
    const lastPrefix = slices.at(-1)?.match(/^\s*/)?.[0] ?? ''
    const prefix = /\r?\n/.test(lastPrefix) ? lastPrefix : ''
    const corners = cornersOf(viewCallChain(expr)?.modifiers ?? [], text)
    return text.slice(0, at) + prefix + entry.source({ target: deploymentVersion(deploymentTarget), shadowToken: options.shadowToken, corners, indent: prefix ? prefix.replace(/^\r?\n/, '') : null }) + text.slice(at)
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
  if (model.modifiers.slice(Math.min(index, destination), Math.max(index, destination) + 1).some(m => !m.capabilities.remove)) throw new Error('This move would cross a pinned modifier. Preserve its source position.')
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
