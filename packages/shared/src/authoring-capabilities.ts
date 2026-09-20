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

export const AUTHORING_CAPABILITIES: readonly AuthoringCapability[] = [
  capability('Text', 'view', [[null], ['verbatim']]),
  capability('Image', 'view', [[null], ['systemName']]),
  capability('Label', 'view', [[null, 'systemImage']], false, '14.0'),
  capability('LabeledContent', 'view', [[null, 'value']], false, '16.0'),
  capability('Link', 'view', [[null, 'destination']], false, '14.0'),
  capability('ProgressView', 'view', [[], ['value']], false, '14.0'),
  capability('GroupBox', 'view', [[], [null]], true, '14.0'),
  capability('Form', 'view', [[]], true),
  capability('LazyVGrid', 'view', [['columns']], true, '14.0'),
  capability('Slider', 'view', [['value']]),
  capability('Stepper', 'view', [[null, 'value']]),
  capability('DatePicker', 'view', [[null, 'selection']]),
  capability('ColorPicker', 'view', [[null, 'selection']], false, '14.0'),
  capability('TabView', 'view', [[]], true),
  capability('Capsule', 'view', [[]]),
  capability('Rectangle', 'view', [[]]), capability('Circle', 'view', [[]]),
  capability('RoundedRectangle', 'view', [['cornerRadius'], ['cornerRadius', 'style']]),
  capability('Spacer', 'view', [[], ['minLength']]), capability('Divider', 'view', [[]]),
  capability('HStack', 'view', [[], ['spacing'], ['alignment'], ['alignment', 'spacing']], true),
  capability('VStack', 'view', [[], ['spacing'], ['alignment'], ['alignment', 'spacing']], true),
  capability('ZStack', 'view', [[], ['alignment']], true), capability('Group', 'view', [[]], true),
  capability('ScrollView', 'view', [[], [null], [null, 'showsIndicators']], true),
  capability('List', 'view', [[], [null], [null, 'id']], true),
  capability('ForEach', 'view', [[null], [null, 'id']], true),
  capability('Section', 'view', [[], [null], ['header'], ['footer'], ['header', 'footer']], true),
  capability('Button', 'view', [[null]], false),
  capability('TextField', 'view', [[null, 'text']]), capability('Toggle', 'view', [[null, 'isOn']]),
  capability('Picker', 'view', [[null, 'selection']], true),
  capability('NavigationStack', 'view', [[]], true, '16.0'),
  capability('NavigationLink', 'view', [[null], [null, 'destination'], ['destination']], true),
  capability('WindowGroup', 'view', [[]], true, '14.0'),
  capability('padding', 'modifier', [[], [null], [null, null]]),
  capability('frame', 'modifier', [['alignment'], ['width'], ['height'], ['height', 'alignment'], ['width', 'alignment'], ['maxHeight'], ['maxHeight', 'alignment'], ['width', 'height'], ['width', 'height', 'alignment'], ['maxWidth'], ['maxWidth', 'alignment'], ['maxWidth', 'maxHeight'], ['maxWidth', 'maxHeight', 'alignment']]),
  capability('font', 'modifier', [[null]]), capability('foregroundColor', 'modifier', [[null]]),
  capability('buttonStyle', 'modifier', [[null]]),
  capability('buttonBorderShape', 'modifier', [[null]], false, '15.0'),
  capability('controlSize', 'modifier', [[null]], false, '15.0'),
  capability('tint', 'modifier', [[null]], false, '15.0'),
  capability('foregroundStyle', 'modifier', [[null]], false, '15.0'), capability('background', 'modifier', [[null], []], true),
  capability('fill', 'modifier', [[null]]),
  capability('overlay', 'modifier', [[null], []], true), capability('cornerRadius', 'modifier', [[null]]),
  capability('opacity', 'modifier', [[null]]), capability('bold', 'modifier', [[]]),
  capability('lineLimit', 'modifier', [[null]]), capability('multilineTextAlignment', 'modifier', [[null]]),
  capability('navigationTitle', 'modifier', [[null]], false, '14.0'), capability('listStyle', 'modifier', [[null]]),
  capability('accessibilityLabel', 'modifier', [[null]]), capability('accessibilityIdentifier', 'modifier', [[null]], false, '14.0'),
  capability('sheet', 'modifier', [['isPresented']], true), capability('tag', 'modifier', [[null]]),
  // The v1 modifier catalog: what the Add menu writes and every card can edit.
  capability('offset', 'modifier', [['x', 'y'], ['x'], ['y']]),
  capability('clipShape', 'modifier', [[null]]),
  capability('border', 'modifier', [[null], [null, 'width']]),
  capability('shadow', 'modifier', [[null], ['radius'], ['color', 'radius'], ['radius', 'x', 'y'], ['color', 'radius', 'x', 'y']]),
  capability('blur', 'modifier', [['radius']]),
  capability('italic', 'modifier', [[]]), capability('underline', 'modifier', [[]]), capability('strikethrough', 'modifier', [[]]),
  capability('tracking', 'modifier', [[null]], false, '16.0'), capability('lineSpacing', 'modifier', [[null]]),
  capability('rotationEffect', 'modifier', [[null]]), capability('scaleEffect', 'modifier', [[null]]),
  capability('disabled', 'modifier', [[null]]),
  capability('navigationBarTitleDisplayMode', 'modifier', [[null]], false, '14.0'),
]

export function authoringCapability(name: string, kind: AuthoringCapability['kind'], labels: readonly (string | null)[]): AuthoringCapability | undefined {
  return AUTHORING_CAPABILITIES.find(c => c.name === name && c.kind === kind && c.forms.some(f => f.length === labels.length && f.every((label, i) => label === labels[i])))
}
