/** Exact read forms; subset writers are specified separately in authoring-writers.ts. */
export interface AuthoringCapability {
  readonly id: string
  readonly name: string
  readonly kind: 'view' | 'modifier'
  /** Argument labels in source order. null is an unlabeled argument. */
  readonly forms: readonly (readonly (string | null)[])[]
  readonly content: boolean
  readonly minimumIOS: string
  readonly preview: 'subset'
  readonly editing: 'planned' | 'subset'
  readonly native: 'unverified'
  readonly fixture: string
  readonly writeRule: string
}

const EDITABLE = new Set(['Text', 'Image', 'RoundedRectangle', 'Spacer', 'HStack', 'VStack', 'ZStack', 'Button', 'TextField', 'Toggle', 'ScrollView', 'fill', 'padding', 'frame', 'font', 'foregroundColor', 'foregroundStyle', 'background', 'cornerRadius', 'opacity', 'lineLimit', 'multilineTextAlignment', 'navigationTitle', 'accessibilityLabel', 'accessibilityIdentifier', 'listStyle', 'buttonStyle', 'buttonBorderShape', 'controlSize', 'tint', 'NavigationLink', 'Label', 'LabeledContent', 'Link', 'GroupBox', 'Section', 'Stepper', 'DatePicker', 'ColorPicker', 'ProgressView', 'List', 'ForEach', 'Picker',
  'offset', 'clipShape', 'border', 'shadow', 'blur', 'bold', 'italic', 'underline', 'strikethrough', 'tracking', 'lineSpacing', 'rotationEffect', 'scaleEffect', 'disabled', 'navigationBarTitleDisplayMode'])

function capability(name: string, kind: 'view' | 'modifier', forms: AuthoringCapability['forms'], content = false, minimumIOS = '13.0'): AuthoringCapability {
  return { id: `${kind}.${name}`, name, kind, forms, content, minimumIOS, preview: 'subset', editing: EDITABLE.has(name) ? 'subset' : 'planned', native: 'unverified', fixture: 'authoring-core', writeRule: 'Only discovered design controls and operation capabilities authorize writes. See AUTHORING_WRITERS for exact boundaries; validate source ownership, target availability and the complete project revision before atomic commit.' }
}

/** All ordered subsets of optional labels, preserving Apple's overload order. */
function optionalForms(labels: readonly string[]): (string | null)[][] {
  return labels.reduce<(string | null)[][]>((forms, label) => [...forms, ...forms.map(form => [...form, label])], [[]])
}
export const AUTHORING_CAPABILITIES: readonly AuthoringCapability[] = [
  capability('Text', 'view', [[null], ['verbatim']]),
  capability('Image', 'view', [[null], ['systemName']]),
  capability('Label', 'view', [[null, 'systemImage']], false, '14.0'),
  capability('LabeledContent', 'view', [[null, 'value']], false, '16.0'),
  capability('Link', 'view', [[null, 'destination']], false, '14.0'),
  capability('ProgressView', 'view', [[], [null], ['value'], ['value', 'total'], [null, 'value'], [null, 'value', 'total']], true, '14.0'),
  capability('GroupBox', 'view', [[], [null]], true, '14.0'),
  capability('Form', 'view', [[]], true),
  capability('LazyVGrid', 'view', optionalForms(['alignment', 'spacing', 'pinnedViews']).map(f => ['columns', ...f]), true, '14.0'),
  capability('LazyHGrid', 'view', optionalForms(['alignment', 'spacing', 'pinnedViews']).map(f => ['rows', ...f]), true, '14.0'),
  capability('Slider', 'view', [['value'], ['value', 'in'], ['value', 'in', 'step']]),
  capability('Stepper', 'view', optionalForms(['in', 'step']).map(f => [null, 'value', ...f])),
  capability('DatePicker', 'view', [[null, 'selection'], [null, 'selection', 'displayedComponents'], [null, 'selection', 'in'], [null, 'selection', 'in', 'displayedComponents']]),
  capability('ColorPicker', 'view', [[null, 'selection'], [null, 'selection', 'supportsOpacity']], false, '14.0'),
  capability('SecureField', 'view', [[null, 'text']]),
  capability('TextEditor', 'view', [['text']], false, '14.0'),
  capability('Menu', 'view', [[], [null]], true, '14.0'),
  capability('DisclosureGroup', 'view', [[], [null], ['isExpanded'], [null, 'isExpanded']], true, '14.0'),
  capability('Grid', 'view', optionalForms(['alignment', 'horizontalSpacing', 'verticalSpacing']), true, '16.0'),
  capability('GridRow', 'view', [[], ['alignment']], true, '16.0'),
  capability('Gauge', 'view', [['value'], ['value', 'in']], true, '16.0'),
  capability('ContentUnavailableView', 'view', [[null, 'systemImage'], [null, 'systemImage', 'description']], false, '17.0'),
  capability('LinearGradient', 'view', ['colors', 'stops', 'gradient'].map(label => [label, 'startPoint', 'endPoint'])),
  capability('RadialGradient', 'view', ['colors', 'stops', 'gradient'].map(label => [label, 'center', 'startRadius', 'endRadius'])),
  capability('AngularGradient', 'view', ['colors', 'stops', 'gradient'].flatMap(label => [[label, 'center'], [label, 'center', 'angle'], [label, 'center', 'startAngle', 'endAngle']])),
  capability('TabView', 'view', [[]], true),
  capability('Capsule', 'view', [[]]),
  capability('Rectangle', 'view', [[]]), capability('Circle', 'view', [[]]),
  capability('RoundedRectangle', 'view', [['cornerRadius'], ['cornerRadius', 'style']]),
  capability('Spacer', 'view', [[], ['minLength']]), capability('Divider', 'view', [[]]),
  capability('HStack', 'view', [[], ['spacing'], ['alignment'], ['alignment', 'spacing']], true),
  capability('VStack', 'view', [[], ['spacing'], ['alignment'], ['alignment', 'spacing']], true),
  capability('LazyVStack', 'view', [[], ['spacing'], ['alignment'], ['alignment', 'spacing']], true, '14.0'),
  capability('LazyHStack', 'view', [[], ['spacing'], ['alignment'], ['alignment', 'spacing']], true, '14.0'),
  capability('ZStack', 'view', [[], ['alignment']], true), capability('Group', 'view', [[]], true),
  capability('ScrollView', 'view', [[], [null], ['showsIndicators'], [null, 'showsIndicators']], true),
  capability('List', 'view', [[], [null], [null, 'id']], true),
  capability('ForEach', 'view', [[null], [null, 'id']], true),
  capability('Section', 'view', [[], [null], ['header'], ['footer'], ['header', 'footer']], true),
  capability('Button', 'view', [[], [null], ['role'], [null, 'role']], false),
  capability('TextField', 'view', [[null, 'text']]),
  { ...capability('TextField', 'view', [[null, 'text', 'axis']], false, '16.0'), id: 'view.TextField.axis' },
  capability('Toggle', 'view', [[null, 'isOn']]),
  capability('Picker', 'view', [[null, 'selection']], true),
  capability('NavigationStack', 'view', [[]], true, '16.0'),
  capability('NavigationLink', 'view', [[null], [null, 'destination'], ['destination']], true),
  capability('WindowGroup', 'view', [[]], true, '14.0'),
  capability('padding', 'modifier', [[], [null], [null, null]]),
  capability('frame', 'modifier', [...optionalForms(['width', 'height', 'alignment']), ...optionalForms(['minWidth', 'idealWidth', 'maxWidth', 'minHeight', 'idealHeight', 'maxHeight', 'alignment'])]),
  capability('font', 'modifier', [[null]]), capability('foregroundColor', 'modifier', [[null]]),
  capability('buttonStyle', 'modifier', [[null]]),
  capability('buttonBorderShape', 'modifier', [[null]], false, '15.0'),
  capability('controlSize', 'modifier', [[null]], false, '15.0'),
  capability('tint', 'modifier', [[null]], false, '15.0'),
  capability('foregroundStyle', 'modifier', [[null]], false, '15.0'), capability('background', 'modifier', [[null], []], true),
  capability('fill', 'modifier', [[null]]),
  capability('overlay', 'modifier', [[null], []], true), capability('cornerRadius', 'modifier', [[null]]),
  capability('opacity', 'modifier', [[null]]), capability('bold', 'modifier', [[]]),
  capability('lineLimit', 'modifier', [[null]]),
  { ...capability('lineLimit', 'modifier', [[null, 'reservesSpace']], false, '16.0'), id: 'modifier.lineLimit.reservesSpace' }, capability('multilineTextAlignment', 'modifier', [[null]]),
  capability('navigationTitle', 'modifier', [[null]], false, '14.0'), capability('listStyle', 'modifier', [[null]]),
  capability('accessibilityLabel', 'modifier', [[null]]), capability('accessibilityIdentifier', 'modifier', [[null]], false, '14.0'),
  capability('sheet', 'modifier', [['isPresented']], true), capability('tag', 'modifier', [[null]]),
  capability('rotation3DEffect', 'modifier', optionalForms(['anchor', 'anchorZ', 'perspective']).map(f => [null, 'axis', ...f])),
  capability('fixedSize', 'modifier', [[], ['horizontal', 'vertical']]),
  capability('resizable', 'modifier', [[]]), capability('scaledToFit', 'modifier', [[]]), capability('scaledToFill', 'modifier', [[]]),
  capability('clipped', 'modifier', [[]]), capability('aspectRatio', 'modifier', [['contentMode'], [null, 'contentMode']]),
  capability('position', 'modifier', [['x', 'y']]),
  capability('saturation', 'modifier', [[null]], false, '13.0'),
  capability('brightness', 'modifier', [[null]], false, '13.0'),
  capability('contrast', 'modifier', [[null]], false, '13.0'),
  capability('grayscale', 'modifier', [[null]], false, '13.0'),
  capability('hueRotation', 'modifier', [[null]], false, '13.0'),
  capability('colorMultiply', 'modifier', [[null]], false, '13.0'),
  capability('blendMode', 'modifier', [[null]], false, '13.0'),
  capability('layoutPriority', 'modifier', [[null]], false, '13.0'),
  capability('fontWeight', 'modifier', [[null]], false, '13.0'),
  capability('fontDesign', 'modifier', [[null]], false, '16.0'),
  capability('kerning', 'modifier', [[null]], false, '16.0'),
  capability('baselineOffset', 'modifier', [[null]], false, '16.0'),
  capability('textCase', 'modifier', [[null]], false, '13.0'),
  capability('minimumScaleFactor', 'modifier', [[null]], false, '13.0'),
  capability('truncationMode', 'modifier', [[null]], false, '13.0'),
  capability('allowsTightening', 'modifier', [[null]], false, '13.0'),
  capability('allowsHitTesting', 'modifier', [[null]], false, '13.0'),
  capability('accessibilityHidden', 'modifier', [[null]], false, '13.0'),
  capability('accessibilityValue', 'modifier', [[null]], false, '13.0'),
  capability('accessibilityHint', 'modifier', [[null]], false, '13.0'),
  capability('toggleStyle', 'modifier', [[null]], false, '13.0'),
  capability('pickerStyle', 'modifier', [[null]], false, '13.0'),
  capability('labelStyle', 'modifier', [[null]], false, '14.0'),
  capability('progressViewStyle', 'modifier', [[null]], false, '14.0'),
  capability('gaugeStyle', 'modifier', [[null]], false, '16.0'),
  capability('textFieldStyle', 'modifier', [[null]], false, '13.0'),
  capability('imageScale', 'modifier', [[null]], false, '13.0'),
  capability('scrollIndicators', 'modifier', [[null]], false, '16.0'),
  capability('scrollContentBackground', 'modifier', [[null]], false, '16.0'),
  capability('listRowSeparator', 'modifier', [[null]], false, '15.0'),
  capability('listRowSpacing', 'modifier', [[null]], false, '17.0'),
  capability('listSectionSpacing', 'modifier', [[null]], false, '17.0'),
  // The v1 modifier catalog: what the Add menu writes and every card can edit.
  capability('offset', 'modifier', [['x', 'y'], ['x'], ['y']]),
  capability('clipShape', 'modifier', [[null]]),
  capability('stroke', 'modifier', [[], [null], ['lineWidth'], [null, 'lineWidth'], ['style'], [null, 'style']]),
  capability('strokeBorder', 'modifier', optionalForms(['antialiased']).flatMap(f => [f, [null, ...f], ['lineWidth', ...f], [null, 'lineWidth', ...f], ['style', ...f], [null, 'style', ...f]])),
  capability('border', 'modifier', [[null], [null, 'width']]),
  capability('shadow', 'modifier', [[null], ['radius'], ['color', 'radius'], ['radius', 'x', 'y'], ['color', 'radius', 'x', 'y']]),
  capability('blur', 'modifier', [['radius']]),
  capability('italic', 'modifier', [[]]), capability('underline', 'modifier', [[], [null], ['color'], [null, 'color']]), capability('strikethrough', 'modifier', [[], [null], ['color'], [null, 'color']]),
  capability('tracking', 'modifier', [[null]], false, '16.0'), capability('lineSpacing', 'modifier', [[null]]),
  capability('rotationEffect', 'modifier', [[null], [null, 'anchor']]), capability('scaleEffect', 'modifier', [[null], [null, 'anchor'], ['x', 'y'], ['x', 'y', 'anchor']]),
  capability('disabled', 'modifier', [[null]]),
  capability('navigationBarTitleDisplayMode', 'modifier', [[null]], false, '14.0'),
]

export function authoringCapability(name: string, kind: AuthoringCapability['kind'], labels: readonly (string | null)[]): AuthoringCapability | undefined {
  return AUTHORING_CAPABILITIES.find(c => c.name === name && c.kind === kind && c.forms.some(f => f.length === labels.length && f.every((label, i) => label === labels[i])))
}
