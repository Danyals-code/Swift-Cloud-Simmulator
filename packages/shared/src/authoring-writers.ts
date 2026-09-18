/** Writer boundaries. Native verification remains independent of implementation. */
export const AUTHORING_WRITERS = [
  { id: 'content', accepts: 'Plain string arguments of Text/verbatim, Image/systemName, Button, TextField and Toggle', preserves: 'Bindings, interpolation and action closures are read-only.', minimumIOS: '13.0' },
  { id: 'layout', accepts: 'HStack/VStack/ZStack constructors; literal spacing, known alignment cases, and ScrollView axis/indicator arguments', preserves: 'Axis conversion is available when no axis-specific alignment is declared; spacing prevents conversion to Overlay.', minimumIOS: '13.0' },
  { id: 'typography', accepts: 'Known Font presets and literal .system(size:weight:design:) arguments; local system font insertion', preserves: 'Existing font expressions, dynamic text and inherited declarations.', minimumIOS: '13.0' },
  { id: 'color', accepts: 'Known Color cases in foregroundColor/foregroundStyle/background/fill; local color insertion', preserves: 'Tokens, computed styles, gradients and view-builder backgrounds. Newer colors require iOS 15.', minimumIOS: '13.0' },
  { id: 'spacing', accepts: 'Literal padding, padding(edge,length), default padding(), Spacer minLength', preserves: 'Each modifier occurrence and its position; negative or computed spacing remains source-owned.', minimumIOS: '13.0' },
  { id: 'size', accepts: 'Literal fixed frame dimensions; Content/Fill/Fixed conversion of one uncommented literal axis constraint', preserves: 'Other arguments and ordered modifiers; computed, min/max ranges and repeated constraints are not converted. Fixed starts at 100 points.', minimumIOS: '13.0' },
  { id: 'appearance', accepts: 'Literal opacity, cornerRadius, RoundedRectangle radius, integer lineLimit and known multilineTextAlignment', preserves: 'Unsupported overloads and computed expressions.', minimumIOS: '13.0' },
  { id: 'accessibility', accepts: 'Literal accessibilityLabel and accessibilityIdentifier; local insertion', preserves: 'Computed accessibility expressions. Identifiers require iOS 14 in the frozen manifest.', minimumIOS: '13.0' },
  { id: 'navigationTitle', accepts: 'Existing literal navigationTitle', preserves: 'Navigation structure and computed titles.', minimumIOS: '14.0' },
  { id: 'structure', accepts: 'Insert, remove, move, reparent, hide and restore source statements using existing syntax helpers', preserves: 'View-builder boundaries, action closures and whole modifier chains.', minimumIOS: '13.0' },
] as const
