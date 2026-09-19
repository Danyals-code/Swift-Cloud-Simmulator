import type { AuthoringNode, ResourceOperation, SharedStyle, StyleKind, StyleProperty, SourceSpan, SourceFile } from '@studio/shared'
import { Parser, forEachChild, type Decl, type Node, type VarDecl } from '@studio/swift-syntax'
import { AUTHORING_COLORS, AUTHORING_FONTS, swiftString } from './design-controls'
import { allDeclarations, callOf, hasComments, identifier, patch, raw, shadowsMember, type FeatureContext, type SourcePatch } from './authoring-context'

const equal = (a: SourceSpan, b: SourceSpan) => a.file === b.file && a.start === b.start && a.end === b.end
const cache = new WeakMap<FeatureContext, { style: SharedStyle; declaration: VarDecl }[]>()
/** These controls write only a small, typed Swift vocabulary, never arbitrary expressions. */
export function styleExpression(kind: StyleKind, value: string): string {
  if (kind === 'spacing' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number(value) <= 1024) return String(Number(value))
  if (kind === 'font' && AUTHORING_FONTS.includes(value)) return `Font.${value}`
  if (kind === 'color') {
    if (AUTHORING_COLORS.includes(value)) return `Color.${value}`
    if (/^#[\da-fA-F]{6}$/.test(value)) {
      const components = [1, 3, 5].map(i => String(parseInt(value.slice(i, i + 2), 16) / 255))
      return `Color(red: ${components[0]}, green: ${components[1]}, blue: ${components[2]})`
    }
  }
  throw new Error(kind === 'color' ? 'Choose a system color or a six-digit hex color.' : kind === 'font' ? 'Choose a supported text style.' : 'Spacing must be a number from 0 to 1024.')
}
function checkedExpression(ctx: FeatureContext, kind: StyleKind, value: string): string {
  const minimum = kind === 'color' && ['mint', 'teal', 'cyan', 'indigo', 'brown'].includes(value) ? 15 : kind === 'font' && ['title2', 'title3', 'caption2'].includes(value) ? 14 : 13
  if (Number.parseFloat(ctx.deploymentTarget ?? '17.0') < minimum) throw new Error(`This style requires iOS ${minimum}. Choose a style available at the app's deployment target.`)
  return styleExpression(kind, value)
}
function styleValue(text: string, type?: string): { kind: StyleKind; value: string } | undefined {
  if (type && ['Color', 'Font', 'SwiftUI.Color', 'SwiftUI.Font'].includes(type) && /^\.[A-Za-z0-9]+$/.test(text)) text = type + text
  const color = /^(?:SwiftUI\.)?Color\.([A-Za-z]+)$/.exec(text)
  if (color && AUTHORING_COLORS.includes(color[1]!)) return { kind: 'color', value: color[1]! }
  const font = /^(?:SwiftUI\.)?Font\.([A-Za-z0-9]+)$/.exec(text)
  if (font && AUTHORING_FONTS.includes(font[1]!)) return { kind: 'font', value: font[1]! }
  const rgb = /^Color\(red: ([\d.]+), green: ([\d.]+), blue: ([\d.]+)\)$/.exec(text)
  if (rgb && rgb.slice(1).every(v => Number(v) >= 0 && Number(v) <= 1)) return { kind: 'color', value: '#' + rgb.slice(1).map(v => Math.round(Number(v) * 255).toString(16).padStart(2, '0')).join('') }
  // Untyped integer constants cannot be passed to CGFloat parameters in native Swift.
  if (type && ['CGFloat', 'Double'].includes(type) && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) && Number(text) <= 1024) return { kind: 'spacing', value: String(Number(text)) }
  return undefined
}
function recipes(ctx: FeatureContext) {
  const existing = cache.get(ctx)
  if (existing) return existing
  const result: { style: SharedStyle; declaration: VarDecl }[] = []
  function collect(decls: readonly Decl[], prefix = '') {
    for (const decl of decls) {
      if (decl.kind === 'structDecl' || decl.kind === 'enumDecl') {
        if (!prefix && allDeclarations(ctx).filter(d => 'name' in d && d.name === decl.name).length === 1) collect(decl.members, `${decl.name}.`)
      }
      if (decl.kind !== 'varDecl' || !decl.isLet || decl.accessor || !decl.initializer || decl.attributes.length || prefix && !decl.modifiers.some(m => m.name === 'static') || decl.modifiers.some(m => ['private', 'fileprivate'].includes(m.name))) continue
      if (!prefix && allDeclarations(ctx).filter(d => 'name' in d && d.name === decl.name).length !== 1) continue
      const value = styleValue(raw(ctx, decl.initializer.span), decl.typeAnnotation ? raw(ctx, decl.typeAnnotation.span) : undefined)
      if (!value || hasComments(ctx, decl.initializer.span)) continue
      const framework = value.kind === 'color' ? 'Color' : value.kind === 'font' ? 'Font' : 'CGFloat'
      if (allDeclarations(ctx).some(d => 'name' in d && d.name === framework)) continue
      const name = prefix + decl.name, uses: SourceSpan[] = []
      const visit = (n: Node) => { if ((n.kind === 'identifier' || n.kind === 'memberAccess') && raw(ctx, n.span) === name) uses.push(n.span); else forEachChild(n, visit) }
      ctx.ast.forEach(visit)
      result.push({ style: { name, ...value, source: decl.initializer.span, uses }, declaration: decl })
    }
  }
  ctx.ast.forEach(file => collect(file.declarations))
  const unique = result.filter(r => result.filter(other => other.style.name === r.style.name).length === 1)
  cache.set(ctx, unique)
  return unique
}
export const sharedStyles = (ctx: FeatureContext): readonly SharedStyle[] => recipes(ctx).map(r => r.style)
function propertyKind(name: string): StyleKind | undefined {
  if (['foregroundStyle', 'foregroundColor', 'background', 'tint'].includes(name)) return 'color'
  if (name === 'font') return 'font'
  if (['spacing', 'padding', 'padding.argument 2', 'frame.width', 'frame.height', 'cornerRadius'].includes(name)) return 'spacing'
  return undefined
}
export function styleProperties(ctx: FeatureContext, node: AuthoringNode): StyleProperty[] {
  return node.properties.flatMap(p => {
    const kind = propertyKind(p.name)
    if (!kind || !p.source || p.scope === 'inherited' || !['literal', 'token'].includes(p.valueKind) && !styleValue(p.expression) || hasComments(ctx, p.source)) return []
    const token = recipes(ctx).find(r => r.style.kind === kind && p.declaration && equal(r.declaration.nameSpan, p.declaration))
    if (p.valueKind === 'token' && !token) return []
    return [{ property: p.id, label: p.name, kind, token: token?.style.name, value: token?.style.value ?? styleValue(p.expression)?.value }]
  })
}
export function editResource(ctx: FeatureContext, node: AuthoringNode, op: ResourceOperation): { patches: SourcePatch[]; created?: { id: string; text: string }[] } {
  if (op.kind === 'style-create-link') {
    const property = styleProperties(ctx, node).find(p => p.property === op.property && p.kind === op.style)
    const source = node.properties.find(p => p.id === op.property)?.source
    if (!property || !source || shadowsMember(ctx, node, op.name)) throw new Error('This property cannot use that shared style.')
    const created = editResource(ctx, node, { kind: 'style-create', name: op.name, style: op.style, value: op.value })
    return { ...created, patches: [patch(source, op.name)] }
  }
  if (op.kind === 'style-create') {
    if (!identifier(op.name) || ['_', 'Color', 'Font', 'CGFloat', 'Double', 'SwiftUI', 'Bundle'].includes(op.name) || allDeclarations(ctx).some(d => 'name' in d && d.name === op.name)) throw new Error('Choose a unique Swift identifier that does not shadow a framework type.')
    if (allDeclarations(ctx).some(d => 'name' in d && ['Color', 'Font', 'CGFloat'].includes(d.name ?? ''))) throw new Error('A framework type is shadowed. Define this style in Swift.')
    const value = checkedExpression(ctx, op.style, op.value)
    const id = `Sources/Styles/${op.name}.swift`
    if (ctx.files.some(f => f.id.toLowerCase() === id.toLowerCase())) throw new Error('A style source file already uses this name.')
    return { patches: [], created: [{ id, text: `import SwiftUI\n\nlet ${op.name}: ${op.style === 'color' ? 'Color' : op.style === 'font' ? 'Font' : 'CGFloat'} = ${value}\n` }] }
  }
  if (op.kind === 'style-edit') {
    const recipe = recipes(ctx).find(r => r.style.name === op.name)
    if (!recipe) throw new Error('This shared style is computed, ambiguous, or no longer editable.')
    const expression = checkedExpression(ctx, recipe.style.kind, op.value)
    if (op.value === recipe.style.value || recipe.style.kind === 'spacing' && Number(op.value) === Number(recipe.style.value) || recipe.style.kind === 'color' && op.value.toLowerCase() === recipe.style.value.toLowerCase()) return { patches: [] }
    return { patches: [patch(recipe.style.source, expression)] }
  }
  if (op.kind === 'style-link' || op.kind === 'style-local') {
    const property = styleProperties(ctx, node).find(p => p.property === op.property)
    const source = node.properties.find(p => p.id === op.property)?.source
    if (!property || !source) throw new Error('This property is not an editable style value.')
    let value: string
    if (op.kind === 'style-link') {
      const token = sharedStyles(ctx).find(t => t.name === op.name && t.kind === property.kind)
      if (!token || shadowsMember(ctx, node, token.name.split('.')[0]!)) throw new Error('That shared style is not available in this source scope.')
      checkedExpression(ctx, token.kind, token.value)
      value = token.name
    } else value = checkedExpression(ctx, property.kind, op.value)
    return { patches: raw(ctx, source) === value ? [] : [patch(source, value)] }
  }
  if (op.kind === 'asset-use') {
    const call = callOf(ctx, node), argument = call?.args[0]
    if (node.name !== 'Image' || !argument || call?.args.length !== 1 || argument.label !== null && argument.label !== 'systemName' || argument.value.kind !== 'stringLiteral' || argument.value.segments.some(s => s.kind !== 'text') || hasComments(ctx, argument.span) || allDeclarations(ctx).some(d => 'name' in d && d.name === 'Image')) throw new Error('Select a literal Image("name") or Image(systemName:) view to choose its resource.')
    return { patches: [patch(argument.span, swiftString(op.name))] }
  }
  return { patches: assetReferences(ctx, op) }
}
function assetReferences(ctx: FeatureContext, op: Extract<ResourceOperation, { kind: 'asset-references' }>): SourcePatch[] {
  const patches: SourcePatch[] = []
  if (allDeclarations(ctx).some(d => 'name' in d && ['Image', 'Label'].includes(d.name ?? ''))) throw new Error('An image type is shadowed. Resolve image references in Swift before changing this resource.')
  const visit = (n: Node) => {
    if (n.kind === 'call') {
      const name = raw(ctx, n.callee.span)
      if (['Image', 'SwiftUI.Image', 'Label', 'SwiftUI.Label'].includes(name)) {
        const argument = name.endsWith('Label') ? n.args.find(a => a.label === 'image') : n.args.find(a => a.label === null || a.label === 'decorative')
        if (argument) {
          const expression = argument.value
          if (expression.kind !== 'stringLiteral' || expression.segments.some(s => s.kind !== 'text')) throw new Error('Dynamic image names require a Swift reference review before renaming or deleting a resource.')
          const value = expression.segments.map(s => s.kind === 'text' ? s.value : '').join('')
          if (value === op.from) {
            const bundle = n.args.find(a => a.label === 'bundle')
            if (bundle && !['nil', '.main', 'Bundle.main', '.module', 'Bundle.module'].includes(raw(ctx, bundle.value.span))) throw new Error('This image uses a custom bundle. Resolve its resource reference in Swift before renaming or deleting it.')
            if (op.to === null) throw new Error('This image is used by Swift. Select a replacement before deleting it.')
            if (hasComments(ctx, expression.span)) throw new Error('Edit this image reference in Swift to preserve its comments.')
            patches.push(patch(expression.span, swiftString(op.to)))
          }
        }
      }
    }
    forEachChild(n, visit)
  }
  ctx.ast.forEach(visit)
  return patches
}


/** Candidate imports are checked without touching the running preview or its state. */
export function validateResourceRemoval(files: readonly SourceFile[], removedNames: readonly string[]): string | null {
  if (!removedNames.length) return null
  const parsed = files.map(file => Parser.parse(file.text, file.id))
  if (parsed.some(p => p.diagnostics.some(d => d.severity === 'error'))) return 'The merged Swift has syntax errors, so removed image references cannot be verified. Keep the resources or open a separate copy.'
  const ctx: FeatureContext = { files, ast: parsed.map(p => p.sourceFile), nodes: [] }
  try { for (const from of removedNames) assetReferences(ctx, { kind: 'asset-references', from, to: null }); return null }
  catch (error) { return `The reviewed choices leave an unresolved image reference. ${error instanceof Error ? error.message : 'Keep its resource or change the source choice.'}` }
}
