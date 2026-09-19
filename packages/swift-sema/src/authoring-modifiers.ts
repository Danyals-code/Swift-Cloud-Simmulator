import { authoringCapability, type AuthoringModifier, type AuthoringNode, type ModifierCatalogEntry, type ModifierCategory, type ModifierOperation } from '@studio/shared'
import type { CallExpr, Expr } from '@studio/swift-syntax'
import { viewCallChain } from './design-controls'
import { SUPPORTED_MODIFIERS } from './builtins'

const CATALOG: readonly { name: string; label: string; category: ModifierCategory; source: string }[] = [
  { name: 'padding', label: 'Padding', category: 'layout', source: '.padding(16)' },
  { name: 'frame', label: 'Size', category: 'layout', source: '.frame(width: 100, height: 100)' },
  { name: 'font', label: 'Font', category: 'text', source: '.font(.system(size: 17))' },
  { name: 'foregroundColor', label: 'Text color', category: 'text', source: '.foregroundColor(Color.primary)' },
  { name: 'background', label: 'Background', category: 'appearance', source: '.background(Color.blue)' },
  { name: 'cornerRadius', label: 'Corner radius', category: 'appearance', source: '.cornerRadius(8)' },
  { name: 'opacity', label: 'Opacity', category: 'appearance', source: '.opacity(1)' },
  { name: 'lineLimit', label: 'Max lines', category: 'text', source: '.lineLimit(3)' },
  { name: 'buttonStyle', label: 'Button style', category: 'appearance', source: '.buttonStyle(.borderedProminent)' },
  { name: 'buttonBorderShape', label: 'Button shape', category: 'appearance', source: '.buttonBorderShape(.capsule)' },
  { name: 'controlSize', label: 'Control size', category: 'appearance', source: '.controlSize(.regular)' },
  { name: 'tint', label: 'Accent color', category: 'appearance', source: '.tint(Color.blue)' },
]
const BEHAVIOR = new Set(['task', 'onAppear', 'onDisappear', 'onChange', 'onReceive', 'onTapGesture', 'onLongPressGesture', 'onSubmit', 'onDelete', 'onMove', 'gesture', 'simultaneousGesture', 'highPriorityGesture', 'sheet', 'fullScreenCover', 'alert', 'confirmationDialog', 'popover', 'navigationDestination', 'navigationTitle', 'navigationBarTitleDisplayMode', 'toolbar', 'tabItem', 'tag', 'id', 'environment', 'environmentObject', 'disabled', 'allowsHitTesting', 'animation', 'transition', 'searchable', 'contextMenu', 'accessibilityLabel', 'accessibilityIdentifier', 'accessibilityValue', 'accessibilityHint', 'accessibilityHidden'])
const LAYOUT = new Set(['offset', 'position', 'fixedSize', 'alignmentGuide', 'safeAreaInset', 'containerRelativeFrame', 'layoutPriority', 'aspectRatio', 'scaledToFit', 'scaledToFill', 'ignoresSafeArea'])
const TEXT = new Set(['bold', 'italic', 'fontWeight', 'fontDesign', 'multilineTextAlignment', 'textCase', 'underline', 'strikethrough', 'kerning', 'tracking', 'baselineOffset', 'lineSpacing', 'minimumScaleFactor', 'truncationMode', 'allowsTightening', 'monospacedDigit'])
const LABELS: Readonly<Record<string, string>> = { task: 'Task', onAppear: 'When shown', onDisappear: 'When hidden', onChange: 'When value changes', onTapGesture: 'When tapped', onLongPressGesture: 'When held', resizable: 'Resize image', scaledToFit: 'Fit', scaledToFill: 'Fill', foregroundStyle: 'Foreground style', fill: 'Shape fill' }
const friendly = (name: string) => CATALOG.find(c => c.name === name)?.label ?? LABELS[name] ?? name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase())
const nameOf = (call: CallExpr) => call.callee.kind === 'memberAccess' ? call.callee.member : 'unknown'

function category(name: string): ModifierCategory {
  return CATALOG.find(c => c.name === name)?.category ?? (BEHAVIOR.has(name) ? 'behavior' : LAYOUT.has(name) ? 'layout' : TEXT.has(name) ? 'text' : SUPPORTED_MODIFIERS.has(name) ? 'appearance' : 'custom')
}
function suffixStart(call: CallExpr): number {
  return call.callee.kind === 'memberAccess' && call.callee.base ? call.callee.base.span.end : call.span.start
}
function pure(expr: Expr): boolean {
  return ['integerLiteral', 'floatLiteral', 'booleanLiteral', 'nilLiteral', 'identifier'].includes(expr.kind)
    || expr.kind === 'memberAccess' && (!expr.base || pure(expr.base))
    || expr.kind === 'unary' && ['+', '-'].includes(expr.operator) && pure(expr.operand)
    || expr.kind === 'call' && expr.callee.kind === 'memberAccess' && !expr.callee.base && expr.callee.member === 'system' && expr.args.every(a => pure(a.value)) && !expr.trailingClosure
}
/** Reordering is limited to known general View modifiers. Image/Shape operations stay pinned. */
function structural(call: CallExpr, text: string): boolean {
  const name = nameOf(call)
  if (!CATALOG.some(c => c.name === name) || !authoringCapability(name, 'modifier', call.args.map(a => a.label)) || call.trailingClosure || !call.args.every(a => pure(a.value))) return false
  // A view-producing background overload carries content ownership, unlike a color.
  if (name === 'background') return call.args.length === 1 && /^(?:(?:SwiftUI\.)?Color)?\.(?:primary|secondary|black|white|gray|red|orange|yellow|green|mint|teal|cyan|blue|indigo|purple|pink|brown|clear)$/.test(text.slice(call.args[0]!.value.span.start, call.args[0]!.value.span.end))
  return true
}
function eligible(node: AuthoringNode): boolean { return ['view', 'collection', 'component'].includes(node.kind) && node.name !== 'WindowGroup' && !node.properties.some(p => p.name === 'Source') }

/** The UI receives all source occurrences, including ones it cannot change. */
export function modifierModel(node: AuthoringNode, expr: Expr, text: string, deploymentTarget = '17.0', allowEdits = true): { modifiers: AuthoringModifier[]; modifierCatalog: ModifierCatalogEntry[] } {
  const chain = viewCallChain(expr)
  if (!chain) return { modifiers: [], modifierCatalog: [] }
  const calls = chain.modifiers
  const version = Number.parseFloat(deploymentTarget)
  const editable = allowEdits && eligible(node) && Number.isFinite(version) && version >= 13
  const commented = /\/\/|\/\*/.test(text.slice(chain.base.span.end, expr.span.end)) || /^[^\S\r\n]*(?:\/\/|\/\*)/.test(text.slice(expr.span.end))
  const movable = calls.map(call => editable && !commented && structural(call, text))
  const modifiers: AuthoringModifier[] = calls.map((call, index) => {
    const name = nameOf(call), start = suffixStart(call)
    const source = { ...call.span, start }
    const expression = text.slice(start, call.span.end).trim()
    const controls = (node.controls ?? []).filter(control => {
      if (control.id.startsWith(`modifier:${index}:`)) return true
      if (!control.id.startsWith('fill:') || name !== 'frame') return false
      const axis = control.id.slice(5), upper = axis[0]!.toUpperCase() + axis.slice(1)
      return call.args.some(a => [axis, `min${upper}`, `max${upper}`].includes(a.label ?? ''))
    })
    const known = !!authoringCapability(name, 'modifier', call.args.map(a => a.label))
    const reason = !editable ? 'Resolve source diagnostics or edit this view in Code.' : commented ? 'Comments in this modifier chain need to stay attached. Change values here or reorder in Code.' : !movable[index] ? category(name) === 'behavior' ? 'This behavior stays in its source position.' : !known ? 'This modifier is preserved; its structure is edited in Code.' : 'This modifier has type or content requirements. Change its structure in Code.' : undefined
    const linked = node.properties.find(p => p.source && p.source.start >= start && p.source.end <= call.span.end && p.valueKind === 'token')
    const summary = controls.filter(c => !c.id.startsWith('fill:')).map(c => c.value || 'Default').join(' · ') || (linked ? linked.expression : category(name) === 'custom' ? 'Custom modifier' : call.trailingClosure ? category(name) === 'behavior' ? 'Configured action' : 'View content' : call.args.length ? 'Linked or advanced value' : 'Default')
    return { id: JSON.stringify([source.file, source.start, source.end, expression]), name, label: friendly(name), category: category(name), summary, expression, source, controls, propertyIds: node.properties.filter(p => p.source && p.source.start >= start && p.source.end <= call.span.end).map(p => p.id), capabilities: { edit: editable && controls.length > 0, remove: movable[index]!, duplicate: movable[index]!, moveUp: movable[index]! && index > 0 && movable[index - 1]!, moveDown: movable[index]! && index < calls.length - 1 && movable[index + 1]!, reason } }
  })
  const unknown = calls.some(c => !SUPPORTED_MODIFIERS.has(nameOf(c)))
  const available = editable && !unknown
  return { modifiers, modifierCatalog: CATALOG.filter(entry => !['buttonStyle', 'buttonBorderShape', 'controlSize'].includes(entry.name) || node.name === 'Button').map(entry => {
    const supported = available && version >= Number.parseFloat(authoringCapability(entry.name, 'modifier', [null])?.minimumIOS ?? '13') && (entry.name !== 'buttonStyle' || version >= 15)
    return { name: entry.name, label: entry.label, category: entry.category, available: supported, reason: supported ? undefined : unknown ? 'This view has a custom modifier. Add styling in Code until its return type is known.' : available ? 'This style requires a newer iOS deployment target.' : 'This view cannot be changed until its source is resolved.' }
  }) }
}

/** Move complete suffix slices; never reconstruct an existing modifier or its arguments. */
export function editModifier(node: AuthoringNode, expr: Expr, text: string, operation: ModifierOperation, deploymentTarget?: string): string {
  const chain = viewCallChain(expr)
  if (!chain) throw new Error('Select a view with an editable modifier chain.')
  const model = modifierModel(node, expr, text, deploymentTarget)
  const calls = chain.modifiers
  const suffixes = calls.map(c => text.slice(suffixStart(c), c.span.end))
  if (operation.kind === 'modifier-add') {
    const entry = CATALOG.find(c => c.name === operation.name)
    if (!entry || !model.modifierCatalog.find(c => c.name === entry.name)?.available) throw new Error('This modifier cannot be added to the selected view.')
    const index = operation.before === undefined ? calls.length : model.modifiers.findIndex(m => m.id === operation.before)
    if (index < 0) throw new Error('The modifier insertion point changed. Select the view again.')
    // Inserting before a type-specific operation can make otherwise valid Swift invalid.
    if (index < calls.length && model.modifiers.slice(index).some(m => !m.capabilities.remove)) throw new Error('Add this modifier after the pinned entries to preserve their type and behavior requirements.')
    const at = index < calls.length ? suffixStart(calls[index]!) : expr.span.end
    const lastPrefix = suffixes.at(-1)?.match(/^\s*/)?.[0] ?? ''
    const prefix = /\r?\n/.test(lastPrefix) ? lastPrefix : ''
    return text.slice(0, at) + prefix + entry.source + text.slice(at)
  }
  const index = model.modifiers.findIndex(m => m.id === operation.modifier)
  if (index < 0) throw new Error('The modifier identity changed. Select the view again.')
  const current = model.modifiers[index]!
  if (operation.kind === 'modifier-remove') {
    if (!current.capabilities.remove) throw new Error(current.capabilities.reason ?? 'This modifier cannot be removed safely.')
    return text.slice(0, current.source.start) + text.slice(current.source.end)
  }
  if (operation.kind === 'modifier-duplicate') {
    if (!current.capabilities.duplicate) throw new Error(current.capabilities.reason ?? 'This modifier cannot be duplicated safely.')
    return text.slice(0, current.source.end) + suffixes[index]! + text.slice(current.source.end)
  }
  const destination = operation.toIndex
  if (!Number.isInteger(destination) || destination < 0 || destination >= calls.length) throw new Error('Choose a valid modifier position.')
  if (destination === index) return text
  if (model.modifiers.slice(Math.min(index, destination), Math.max(index, destination) + 1).some(m => !m.capabilities.remove)) throw new Error('This move would cross a pinned modifier. Preserve its source position.')
  const moved = suffixes.splice(index, 1)[0]!
  suffixes.splice(destination, 0, moved)
  return text.slice(0, chain.base.span.end) + suffixes.join('') + text.slice(expr.span.end)
}
