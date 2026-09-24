import { DEFAULT_DEPLOYMENT_TARGET, deploymentVersion, isAccentColorSetName } from '@studio/shared'
import type { AuthoringNode, FontTokenValue, PreviewColorAsset, ResourceOperation, ShadowTokenValue, SharedStyle, StyleKind, StyleProperty, SourceSpan, SourceFile, TokenDefinition } from '@studio/shared'
import { Parser, forEachChild, type Decl, type Expr, type ExtensionDecl, type Node, type VarDecl } from '@studio/swift-syntax'
import { AUTHORING_COLORS, SYSTEM_COLORS, AUTHORING_FONTS, swiftString } from './design-controls'
import { allDeclarations, applyPatches, callOf, hasComments, identifier, patch, raw, shadowsMember, type FeatureContext, type SourcePatch } from './authoring-context'

/**
 * Design tokens and the older shared styles they grew out of.
 *
 * A **token** is a static member of a framework type, written in one file,
 * `DesignSystem/Tokens.swift`, and read with dot syntax: `.foregroundStyle(.accent)`,
 * `.padding(.space16)`. The name in the studio is exactly the Swift member name. A
 * colour token's light and dark values live in the asset catalog, which is where Xcode
 * keeps them; the Swift member only names the colour set.
 *
 * A **legacy** style is a global `let` the studio used to write one file at a time. It
 * keeps working exactly as before, appears beside the tokens, and can be moved into
 * `Tokens.swift` in one step that rewrites every reference.
 */

export const TOKENS_FILE = 'Sources/DesignSystem/Tokens.swift'

const equal = (a: SourceSpan, b: SourceSpan) => a.file === b.file && a.start === b.start && a.end === b.end
const isStatic = (decl: VarDecl) => decl.modifiers.some(m => m.name === 'static')
const FONT_WEIGHTS = ['ultraLight', 'thin', 'light', 'regular', 'medium', 'semibold', 'bold', 'heavy', 'black']
/** Framework types a token extends, and the token kinds each can hold. */
const TOKEN_HOSTS: Readonly<Record<string, readonly StyleKind[]>> = { Color: ['color'], CGFloat: ['spacing', 'radius'], Double: ['spacing', 'radius'], Font: ['font'], ShadowToken: ['shadow'] }
/** Properties whose argument is a generic `ShapeStyle`, where `.name` needs the ShapeStyle twin. */
const SHAPE_STYLE_PROPERTIES = new Set(['foregroundStyle', 'background', 'fill', 'stroke', 'strokeBorder'])

interface Recipe {
  readonly style: SharedStyle
  readonly declaration: VarDecl
  /** The extended framework type, for a token. */
  readonly host?: string
  /** Xcode's `extension ShapeStyle where Self == Color` twin, so `.foregroundStyle(.name)` compiles. */
  readonly companion?: VarDecl
  /** The colour set a colour token reads with `Color("name")`. */
  readonly colorSet?: string
}

const cache = new WeakMap<FeatureContext, Recipe[]>()

/** These controls write only a small, typed Swift vocabulary, never arbitrary expressions. */
export function styleExpression(kind: StyleKind, value: string): string {
  if ((kind === 'spacing' || kind === 'radius') && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number(value) <= 1024) return String(Number(value))
  if (kind === 'font' && AUTHORING_FONTS.includes(value)) return `Font.${value}`
  if (kind === 'color') {
    if (SYSTEM_COLORS.includes(value)) return `Color(.${value})`
    if (value === 'accentColor') return 'Color.accentColor'
    if (AUTHORING_COLORS.includes(value)) return `Color.${value}`
    if (/^#[\da-fA-F]{6}(?:[\da-fA-F]{2})?$/.test(value)) return rgbExpression(value)
  }
  throw new Error(kind === 'color' ? 'Choose a system color or an RGB/RGBA hex color.' : kind === 'font' ? 'Choose a supported text style.' : kind === 'shadow' ? 'Choose a shadow token.' : `${kind === 'radius' ? 'Corner radius' : 'Spacing'} must be a number from 0 to 1024.`)
}
function rgbExpression(hex: string): string {
  const components = [1, 3, 5].map(i => String(Math.round(parseInt(hex.slice(i, i + 2), 16) / 255 * 1000) / 1000))
  return `Color(red: ${components[0]}, green: ${components[1]}, blue: ${components[2]}${hex.length === 9 ? ', opacity: ' + String(parseInt(hex.slice(7, 9), 16) / 255) : ''})`
}
function minimumFor(kind: StyleKind, value: string): number {
  return kind === 'color' && ['mint', 'teal', 'cyan', 'indigo', 'brown'].includes(value) ? 15 : kind === 'font' && ['title2', 'title3', 'caption2'].includes(value) ? 14 : 13
}
function checkedExpression(ctx: FeatureContext, kind: StyleKind, value: string): string {
  const minimum = minimumFor(kind, value)
  if (deploymentVersion(ctx.deploymentTarget) < minimum) throw new Error(`This needs iOS ${minimum}, which is newer than this project’s iOS version. Choose another style, or ask a developer to raise it.`)
  return styleExpression(kind, value)
}
function styleValue(text: string, type?: string): { kind: StyleKind; value: string } | undefined {
  if (type && ['Color', 'Font', 'SwiftUI.Color', 'SwiftUI.Font'].includes(type) && /^\.[A-Za-z0-9]+$/.test(text)) text = type + text
  const system = /^(?:SwiftUI\.)?Color\(\.(\w+)\)$/.exec(text.replace(/\s/g, ''))
  if (system && SYSTEM_COLORS.includes(system[1]!)) return { kind: 'color', value: system[1]! }
  const color = /^(?:SwiftUI\.)?Color\.([A-Za-z]+)$/.exec(text)
  if (color && [...AUTHORING_COLORS, 'accentColor'].includes(color[1]!)) return { kind: 'color', value: color[1]! }
  const font = /^(?:SwiftUI\.)?Font\.([A-Za-z0-9]+)$/.exec(text)
  if (font && AUTHORING_FONTS.includes(font[1]!)) return { kind: 'font', value: font[1]! }
  const rgb = /^(?:SwiftUI\.)?Color\(\s*red:\s*([\d.]+)\s*,\s*green:\s*([\d.]+)\s*,\s*blue:\s*([\d.]+)\s*\)$/.exec(text)
  if (rgb && rgb.slice(1).every(v => Number(v) >= 0 && Number(v) <= 1)) return { kind: 'color', value: '#' + rgb.slice(1).map(v => Math.round(Number(v) * 255).toString(16).padStart(2, '0')).join('') }
  // Untyped integer constants cannot be passed to CGFloat parameters in native Swift.
  if (type && ['CGFloat', 'Double'].includes(type) && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) && Number(text) <= 1024) return { kind: 'spacing', value: String(Number(text)) }
  return undefined
}

// ---------------------------------------------------------------- font and shadow recipes

const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
const FONT_LABELS: Readonly<Record<string, string>> = { largeTitle: 'Large title', title2: 'Title 2', title3: 'Title 3', caption2: 'Caption 2' }
export function describeFont(font: FontTokenValue): string {
  const base = font.style === 'custom' ? `${font.size ?? 17} pt` : FONT_LABELS[font.style] ?? cap(font.style)
  return [base, font.style !== 'custom' && font.size ? `${font.size} pt` : '', font.weight ? cap(font.weight) : ''].filter(Boolean).join(' · ')
}
function contextualName(expr: Expr | undefined, options: readonly string[], type?: string): string | undefined {
  if (expr?.kind !== 'memberAccess') return undefined
  if (expr.base && !(expr.base.kind === 'identifier' && type && expr.base.name === type) && !(expr.base.kind === 'memberAccess' && type && expr.base.member === type.split('.').at(-1))) return undefined
  return options.includes(expr.member) ? expr.member : undefined
}
const numeric = (ctx: FeatureContext, expr: Expr | undefined) => !!expr && ['integerLiteral', 'floatLiteral'].includes(expr.kind) && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw(ctx, expr.span))
const signed = (ctx: FeatureContext, expr: Expr | undefined) => !!expr && (numeric(ctx, expr) || expr.kind === 'unary' && expr.operator === '-' && numeric(ctx, expr.operand))

export function fontTokenValue(ctx: FeatureContext, expr: Expr): FontTokenValue | undefined {
  if (expr.kind === 'memberAccess' && (!expr.base || expr.base.kind === 'identifier' && expr.base.name === 'Font') && AUTHORING_FONTS.includes(expr.member)) return { style: expr.member }
  if (expr.kind !== 'call' || expr.callee.kind !== 'memberAccess' || expr.trailingClosure) return undefined
  const callee = expr.callee
  if (callee.member === 'weight' && callee.base && expr.args.length === 1 && expr.args[0]!.label === null) {
    const inner = fontTokenValue(ctx, callee.base), weight = contextualName(expr.args[0]!.value, FONT_WEIGHTS, 'Font.Weight')
    return inner && !inner.weight && inner.style !== 'custom' && weight ? { ...inner, weight } : undefined
  }
  if (callee.member !== 'system' || callee.base && !(callee.base.kind === 'identifier' && callee.base.name === 'Font')) return undefined
  const weightArgument = expr.args.find(a => a.label === 'weight')
  const weight = weightArgument ? contextualName(weightArgument.value, FONT_WEIGHTS, 'Font.Weight') : undefined
  if (weightArgument && !weight) return undefined
  const first = expr.args[0]
  if (first?.label === null) {
    const style = contextualName(first.value, AUTHORING_FONTS, 'Font.TextStyle')
    return style && expr.args.every(a => a === first || a === weightArgument) ? { style, ...(weight ? { weight } : {}) } : undefined
  }
  const size = expr.args.find(a => a.label === 'size')
  return size && numeric(ctx, size.value) && expr.args.every(a => a === size || a === weightArgument) ? { style: 'custom', size: Number(raw(ctx, size.value.span)), ...(weight ? { weight } : {}) } : undefined
}
export function fontExpression(font: FontTokenValue, deploymentTarget = DEFAULT_DEPLOYMENT_TARGET): string {
  if (font.size !== undefined || font.style === 'custom') {
    if (!Number.isFinite(font.size) || font.size! < 1 || font.size! > 1000) throw new Error('A text size must be from 1 to 1000 points.')
    return `Font.system(size: ${Number(font.size)}${font.weight ? `, weight: .${font.weight}` : ''})`
  }
  if (!AUTHORING_FONTS.includes(font.style)) throw new Error('Choose a supported text style.')
  if (font.weight && !FONT_WEIGHTS.includes(font.weight)) throw new Error('Choose a supported weight.')
  if (!font.weight) return `Font.system(.${font.style})`
  // `system(_:design:weight:)` is iOS 16; `.weight(_:)` spells the same font everywhere.
  return deploymentVersion(deploymentTarget) >= 16 ? `Font.system(.${font.style}, weight: .${font.weight})` : `Font.${font.style}.weight(.${font.weight})`
}

function colorAndOpacity(ctx: FeatureContext, expr: Expr): { color: string; opacity: number } | undefined {
  if (expr.kind === 'call' && expr.callee.kind === 'memberAccess' && expr.callee.member === 'opacity' && expr.callee.base && expr.args.length === 1 && numeric(ctx, expr.args[0]!.value)) {
    const inner = styleValue(raw(ctx, expr.callee.base.span), 'Color')
    const opacity = Number(raw(ctx, expr.args[0]!.value.span))
    return inner?.kind === 'color' && opacity <= 1 ? { color: inner.value, opacity } : undefined
  }
  const plain = styleValue(raw(ctx, expr.span), 'Color')
  return plain?.kind === 'color' ? { color: plain.value, opacity: 1 } : undefined
}
export function shadowTokenValue(ctx: FeatureContext, expr: Expr): ShadowTokenValue | undefined {
  if (expr.kind !== 'call' || expr.callee.kind !== 'identifier' || expr.callee.name !== 'ShadowToken' || expr.trailingClosure) return undefined
  if (expr.args.map(a => a.label).join(',') !== 'color,radius,x,y') return undefined
  const [color, radius, x, y] = expr.args.map(a => a.value)
  const tone = color && colorAndOpacity(ctx, color)
  if (!tone || !numeric(ctx, radius) || !signed(ctx, x) || !signed(ctx, y)) return undefined
  return { ...tone, radius: Number(raw(ctx, radius!.span)), x: Number(raw(ctx, x!.span)), y: Number(raw(ctx, y!.span)) }
}
export function describeShadow(shadow: ShadowTokenValue): string {
  return `${shadow.radius} blur · ${shadow.x}, ${shadow.y} · ${Math.round(shadow.opacity * 100)}%`
}
export function shadowExpression(shadow: ShadowTokenValue): string {
  const { radius, x, y, opacity } = shadow
  if (![radius, x, y, opacity].every(Number.isFinite) || radius < 0 || radius > 200 || Math.abs(x) > 200 || Math.abs(y) > 200 || opacity < 0 || opacity > 1) throw new Error('Use a blur of 0–200, offsets within ±200 and an opacity of 0–100%.')
  const color = AUTHORING_COLORS.includes(shadow.color) ? `.${shadow.color}` : /^#[\da-fA-F]{6}$/.test(shadow.color) ? rgbExpression(shadow.color) : null
  if (!color) throw new Error('Choose a system colour or a six-digit hex colour for the shadow.')
  const rounded = (n: number) => String(Math.round(n * 1000) / 1000)
  return `ShadowToken(color: ${color}${opacity < 1 ? `.opacity(${rounded(opacity)})` : ''}, radius: ${rounded(radius)}, x: ${rounded(x)}, y: ${rounded(y)})`
}

// ---------------------------------------------------------------- discovery

/** One pass over the program for every contextual `.name` and qualified `Type.name`. */
function memberUses(ctx: FeatureContext): Map<string, SourceSpan[]> {
  const uses = new Map<string, SourceSpan[]>()
  const add = (key: string, span: SourceSpan) => { const list = uses.get(key); if (list) list.push(span); else uses.set(key, [span]) }
  const visit = (n: Node) => {
    if (n.kind === 'memberAccess') {
      if (!n.base) add('.' + n.member, n.span)
      else if (n.base.kind === 'identifier') add(`${n.base.name}.${n.member}`, n.span)
    }
    forEachChild(n, visit)
  }
  ctx.ast.forEach(visit)
  return uses
}

function tokenRecipes(ctx: FeatureContext): Recipe[] {
  const extensions = ctx.ast.flatMap(file => file.declarations).filter((d): d is ExtensionDecl => d.kind === 'extensionDecl')
  const companions = new Map<string, VarDecl>()
  for (const extension of extensions) if (extension.name === 'ShapeStyle') for (const member of extension.members) if (member.kind === 'varDecl' && isStatic(member)) companions.set(member.name, member)
  const uses = memberUses(ctx)
  const result: Recipe[] = []
  for (const extension of extensions) {
    const kinds = TOKEN_HOSTS[extension.name]
    if (!kinds) continue
    for (const member of extension.members) {
      if (member.kind !== 'varDecl' || !isStatic(member) || member.accessor || !member.initializer || member.attributes.length || member.modifiers.some(m => ['private', 'fileprivate'].includes(m.name))) continue
      if (hasComments(ctx, member.initializer.span)) continue
      const initializer = member.initializer
      let style: Omit<SharedStyle, 'name' | 'source' | 'uses'> | undefined
      let colorSet: string | undefined
      if (extension.name === 'Color') {
        if (initializer.kind === 'call' && initializer.callee.kind === 'identifier' && initializer.callee.name === 'Color' && initializer.args.length === 1 && initializer.args[0]!.label === null && initializer.args[0]!.value.kind === 'stringLiteral' && initializer.args[0]!.value.segments.every(s => s.kind === 'text') && !initializer.trailingClosure) {
          colorSet = raw(ctx, initializer.args[0]!.value.span).slice(1, -1)
          const set = ctx.colors?.find(color => color.name === colorSet)
          style = { kind: 'color', value: set?.light ?? 'Missing colour set', ...(set ? { light: set.light, ...(set.dark ? { dark: set.dark } : {}) } : {}) }
        } else {
          const value = styleValue(raw(ctx, initializer.span), 'Color')
          if (value?.kind === 'color') style = value
        }
      } else if (extension.name === 'CGFloat' || extension.name === 'Double') {
        const type = member.typeAnnotation ? raw(ctx, member.typeAnnotation.span) : undefined
        if ((type === undefined ? initializer.kind === 'floatLiteral' : ['CGFloat', 'Double'].includes(type)) && numeric(ctx, initializer) && Number(raw(ctx, initializer.span)) <= 1024) style = { kind: member.name.startsWith('radius') ? 'radius' : 'spacing', value: String(Number(raw(ctx, initializer.span))) }
      } else if (extension.name === 'Font') {
        const font = fontTokenValue(ctx, initializer)
        if (font) style = { kind: 'font', value: describeFont(font), font }
      } else if (extension.name === 'ShadowToken') {
        const shadow = shadowTokenValue(ctx, initializer)
        if (shadow) style = { kind: 'shadow', value: describeShadow(shadow), shadow }
      }
      if (!style) continue
      const companion = style.kind === 'color' ? companions.get(member.name) : undefined
      const inside = (span: SourceSpan) => [member, companion].some(decl => decl && decl.span.file === span.file && decl.span.start <= span.start && decl.span.end >= span.end)
      const found = [...(uses.get('.' + member.name) ?? []), ...(uses.get(`${extension.name}.${member.name}`) ?? [])].filter(span => !inside(span))
      result.push({ style: { name: member.name, ...style, form: 'token', reference: '.' + member.name, source: initializer.span, uses: found }, declaration: member, host: extension.name, companion, colorSet })
    }
  }
  return result
}

function legacyRecipes(ctx: FeatureContext): Recipe[] {
  const result: Recipe[] = []
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
      if (allDeclarations(ctx).some(d => d.kind !== 'extensionDecl' && 'name' in d && d.name === framework)) continue
      const name = prefix + decl.name, uses: SourceSpan[] = []
      const visit = (n: Node) => { if ((n.kind === 'identifier' || n.kind === 'memberAccess') && raw(ctx, n.span) === name) uses.push(n.span); else forEachChild(n, visit) }
      ctx.ast.forEach(visit)
      result.push({ style: { name, ...value, form: 'legacy', reference: name, source: decl.initializer.span, uses }, declaration: decl })
    }
  }
  ctx.ast.forEach(file => collect(file.declarations))
  return result
}

function recipes(ctx: FeatureContext): Recipe[] {
  const existing = cache.get(ctx)
  if (existing) return existing
  const all = [...tokenRecipes(ctx), ...legacyRecipes(ctx)]
  const unique = all.filter(r => all.filter(other => other.style.name === r.style.name).length === 1)
  cache.set(ctx, unique)
  return unique
}

export const sharedStyles = (ctx: FeatureContext): readonly SharedStyle[] => recipes(ctx).map(r => r.style)

function propertyKind(name: string): StyleKind | undefined {
  if (['foregroundStyle', 'foregroundColor', 'background', 'tint', 'fill', 'stroke', 'strokeBorder', 'border', 'shadow.color'].includes(name)) return 'color'
  if (name === 'font') return 'font'
  if (['cornerRadius', 'clipShape.cornerRadius'].includes(name)) return 'radius'
  if (['spacing', 'padding', 'frame.width', 'frame.height', 'minLength'].includes(name)) return 'spacing'
  if (name === 'shadow') return 'shadow'
  return undefined
}
const typeFor = (kind: StyleKind) => kind === 'color' ? 'Color' : kind === 'font' ? 'Font' : kind === 'shadow' ? 'ShadowToken' : 'CGFloat'
/** A legacy `CGFloat` style predates radius tokens and serves either kind of field. */
const fits = (recipe: Recipe, kind: StyleKind) => recipe.style.kind === kind || recipe.style.form === 'legacy' && recipe.style.kind === 'spacing' && kind === 'radius'

export function styleProperties(ctx: FeatureContext, node: AuthoringNode): StyleProperty[] {
  return node.properties.flatMap(p => {
    const kind = propertyKind(p.name)
    if (!kind || !p.source || p.scope === 'inherited' || hasComments(ctx, p.source)) return []
    const literal = styleValue(p.expression, typeFor(kind))
    if (!['literal', 'token'].includes(p.valueKind) && !literal) return []
    const token = recipes(ctx).find(r => fits(r, kind) && p.declaration && (equal(r.declaration.nameSpan, p.declaration) || !!r.companion && equal(r.companion.nameSpan, p.declaration)))
    if (p.valueKind === 'token' && !token) return []
    return [{ property: p.id, label: p.name, kind, token: token?.style.name, value: token?.style.value ?? literal?.value }]
  })
}

// ---------------------------------------------------------------- naming

/** Members the framework already has, which a token name must never shadow. */
const FRAMEWORK_MEMBERS: Readonly<Record<StyleKind, readonly string[]>> = {
  color: [...AUTHORING_COLORS, 'accentColor', 'tint', 'systemBackground', 'label', 'init', 'opacity', 'gradient', 'mix', 'resolve', 'description'],
  font: [...AUTHORING_FONTS, 'system', 'custom', 'weight', 'bold', 'italic', 'monospaced', 'width', 'leading', 'init'],
  spacing: ['infinity', 'pi', 'zero', 'nan', 'signalingNaN', 'greatestFiniteMagnitude', 'leastNormalMagnitude', 'leastNonzeroMagnitude', 'ulpOfOne', 'init'],
  radius: ['infinity', 'pi', 'zero', 'nan', 'init'],
  shadow: ['init'],
}
/** SwiftUI's contextual names, which keep their meaning wherever `.name` is written. */
const CONTEXTUAL = new Set(['leading', 'trailing', 'center', 'top', 'bottom', 'all', 'horizontal', 'vertical', 'small', 'large', 'regular', 'medium', 'mini', 'extraLarge', 'automatic', 'default', 'plain', 'bordered', 'borderless', 'inset', 'grouped', 'sidebar', 'page', 'fill', 'fit', 'capsule', 'circle', 'rect', 'continuous', 'circular', 'hidden', 'visible', 'none', 'light', 'dark', 'regular', 'bold', 'semibold', 'heavy', 'thin', 'black', 'rounded', 'serif', 'monospaced', 'infinity', 'zero', 'identity', 'opacity', 'slide', 'scale', 'linear', 'easeIn', 'easeOut', 'easeInOut', 'spring', 'sheet', 'popover', 'navigation', 'inline', 'compact', 'background', 'foreground'])

export function suggestTokenName(kind: StyleKind, name: string): string {
  const base = name.replace(/[^A-Za-z0-9]/g, '') || 'token'
  if (kind === 'spacing') return base.startsWith('space') ? base : `space${cap(base.replace(/(?:Spacing|Space|Padding)$/, '')) || '16'}`
  if (kind === 'radius') return base.startsWith('radius') ? base : `radius${cap(base.replace(/(?:Radius|Corner)$/, '')) || 'Medium'}`
  if (kind === 'color') return ['primary', 'secondary', 'tertiary', 'quaternary', 'label'].includes(base) ? `text${cap(base)}` : `brand${cap(base)}`
  if (kind === 'font') return `${base}Text`
  return `${base}Shadow`
}

/** Rejects names Swift or the preview would misread, with a name that would work. */
export function tokenNameProblem(ctx: FeatureContext, kind: StyleKind, name: string, existing?: string): string | null {
  const suggestion = suggestTokenName(kind, name)
  if (!identifier(name) || !/^[a-z]/.test(name)) return `Use letters and numbers, starting with a lowercase letter. Try ${/^[a-z]/.test(suggestion) ? suggestion : suggestion.charAt(0).toLowerCase() + suggestion.slice(1)}.`
  if (kind === 'spacing' && !name.startsWith('space')) return `Spacing tokens start with “space”, so they never mix with corner radii. Try ${suggestion}.`
  if (kind === 'radius' && !name.startsWith('radius')) return `Corner radius tokens start with “radius”. Try ${suggestion}.`
  if (FRAMEWORK_MEMBERS[kind].includes(name) || CONTEXTUAL.has(name)) return `“${name}” is already part of SwiftUI. Try ${suggestion}.`
  // Its colour set would be the same folder as the app's own AccentColor in the export.
  if (kind === 'color' && isAccentColorSetName(name)) return `“${name}” is the name Xcode gives the app’s accent colour. Try ${suggestion}.`
  if (name !== existing && (recipes(ctx).some(r => r.style.name === name) || allDeclarations(ctx).some(d => 'name' in d && d.name === name))) return `“${name}” is already used in this app. Choose another name.`
  if (['Color', 'Font', 'CGFloat', 'Double', 'SwiftUI', 'Bundle', 'ShadowToken', 'View'].includes(name)) return `Choose a name that is not a type. Try ${suggestion}.`
  return null
}

// ---------------------------------------------------------------- writing Tokens.swift

const SECTIONS: Readonly<Record<StyleKind, { host: string; header: string }>> = {
  color: { host: 'Color', header: '// MARK: - Colors\n// Light and dark values live in Assets.xcassets, one colour set per token.' },
  spacing: { host: 'CGFloat', header: '// MARK: - Spacing' },
  radius: { host: 'CGFloat', header: '// MARK: - Corner radius' },
  font: { host: 'Font', header: '// MARK: - Text styles' },
  shadow: { host: 'ShadowToken', header: '// MARK: - Shadows' },
}
const SHADOW_SUPPORT = `struct ShadowToken {
    let color: Color
    let radius: CGFloat
    let x: CGFloat
    let y: CGFloat
}

extension View {
    func shadow(_ token: ShadowToken) -> some View {
        shadow(color: token.color, radius: token.radius, x: token.x, y: token.y)
    }
}`

/** A colour token that aliases a system colour keeps its adaptivity: no colour set, just `Color.primary`. */
const systemColor = (definition: TokenDefinition) => AUTHORING_COLORS.includes(definition.value) && !definition.dark

function memberLine(kind: StyleKind, name: string, definition: TokenDefinition, deploymentTarget?: string): string {
  if (kind === 'color') return `static let ${name} = ${systemColor(definition) ? styleExpression('color', definition.value) : `Color(${swiftString(name)})`}`
  if (kind === 'spacing' || kind === 'radius') return `static let ${name}: CGFloat = ${styleExpression(kind, definition.value)}`
  if (kind === 'font') return `static let ${name} = ${fontExpression(definition.font ?? { style: definition.value }, deploymentTarget)}`
  if (!definition.shadow) throw new Error('A shadow token needs a colour, blur and offset.')
  return `static let ${name} = ${shadowExpression(definition.shadow)}`
}

/**
 * Where a new member goes: the last block of its section, or a new block at the end.
 * `declaration` is what a new block is headed with - the ShapeStyle twin's constraint
 * belongs there, and an existing unconstrained `extension ShapeStyle` is never used.
 */
function insertMember(text: string, file: string, kind: StyleKind, host: string, line: string, blockHeader?: string, declaration = `extension ${host}`): string {
  const parsed = Parser.parse(text, file)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const blocks = parsed.sourceFile.declarations.filter((d): d is ExtensionDecl => d.kind === 'extensionDecl' && d.name === host)
    .filter(block => host !== 'CGFloat' || block.members.every(m => m.kind !== 'varDecl' || (kind === 'radius') === m.name.startsWith('radius')))
    .filter(block => declaration === `extension ${host}` || text.slice(block.span.start, text.indexOf('{', block.span.start)).replace(/\s+/g, ' ').trim() === declaration)
  const block = blocks.at(-1)
  if (block) {
    const close = text.lastIndexOf('}', block.span.end - 1)
    const lineStart = text.lastIndexOf('\n', close - 1) + 1
    // A closing brace on its own line takes the new member above it; one sharing a
    // line with the last member gets a line break first.
    const own = /^\s*$/.test(text.slice(lineStart, close))
    const at = own ? lineStart : close
    const prefix = own ? '' : eol
    return text.slice(0, at) + prefix + '    ' + line + eol + text.slice(at)
  }
  const separator = text.endsWith(eol + eol) ? '' : text.endsWith(eol) ? eol : eol + eol
  return text + separator + (blockHeader ? blockHeader + eol + eol : '') + `${declaration} {${eol}    ${line}${eol}}${eol}`
}

function tokensFile(ctx: FeatureContext): SourceFile | undefined {
  return ctx.files.find(file => file.id === TOKENS_FILE) ?? ctx.files.find(file => /(^|\/)DesignSystem\/Tokens\.swift$/.test(file.id))
}

/** Adds a token to `Tokens.swift`, creating the file on first use. */
function createToken(ctx: FeatureContext, kind: StyleKind, name: string, definition: TokenDefinition, replacing?: string): { patches: SourcePatch[]; created?: { id: string; text: string }[]; colors?: PreviewColorAsset[] } {
  const problem = tokenNameProblem(ctx, kind, name, replacing)
  if (problem) throw new Error(problem)
  let colors: PreviewColorAsset[] | undefined
  if (kind === 'color' && systemColor(definition)) checkedExpression(ctx, 'color', definition.value)
  else if (kind === 'color') {
    const light = hex(definition.value), dark = definition.dark ? hex(definition.dark) : undefined
    if (!light || definition.dark && !dark) throw new Error('Colour tokens need hex values such as #0A84FF for light and dark.')
    if (ctx.colors?.some(color => color.name.toLowerCase() === name.toLowerCase())) throw new Error(`The asset catalog already has a colour set named ${name}.`)
    colors = [...(ctx.colors ?? []), { name, light, ...(dark && dark !== light ? { dark } : {}) }]
  }
  const section = SECTIONS[kind]
  const line = memberLine(kind, name, definition, ctx.deploymentTarget)
  const existing = tokensFile(ctx)
  const needsShadowSupport = kind === 'shadow' && !allDeclarations(ctx).some(d => d.kind === 'structDecl' && d.name === 'ShadowToken')
  let text = existing?.text ?? 'import SwiftUI\n'
  const file = existing?.id ?? TOKENS_FILE
  if (needsShadowSupport) text += (text.endsWith('\n\n') ? '' : '\n') + section.header + '\n\n' + SHADOW_SUPPORT + '\n'
  text = insertMember(text, file, kind, section.host, line, needsShadowSupport ? undefined : section.header)
  // Xcode's own asset symbols pair every colour with this twin: `.foregroundStyle(.name)`
  // takes a generic ShapeStyle, and only the constrained extension makes `.name` legal there.
  if (kind === 'color') text = insertMember(text, file, kind, 'ShapeStyle', `static var ${name}: Color { ${systemColor(definition) ? styleExpression('color', definition.value) : `Color(${swiftString(name)})`} }`, undefined, 'extension ShapeStyle where Self == Color')
  return existing
    ? { patches: [{ file: existing.id, start: 0, end: existing.text.length, text }], ...(colors ? { colors } : {}) }
    : { patches: [], created: [{ id: file, text }], ...(colors ? { colors } : {}) }
}

const hex = (value: string): string | null => {
  const trimmed = value.trim().toUpperCase()
  if (/^#[0-9A-F]{3}$/.test(trimmed)) return '#' + [...trimmed.slice(1)].map(c => c + c).join('')
  return /^#[0-9A-F]{6}(?:[0-9A-F]{2})?$/.test(trimmed) ? (trimmed.length === 9 && trimmed.endsWith('FF') ? trimmed.slice(0, 7) : trimmed) : null
}

/** The reference a property writes: `.accent`, or `Color.accent` where `.accent` would not compile. */
function referenceFor(recipe: Recipe, property: string): string {
  if (recipe.style.form !== 'token') return recipe.style.name
  if (recipe.host === 'Color' && !recipe.companion && SHAPE_STYLE_PROPERTIES.has(property)) return `Color.${recipe.style.name}`
  return '.' + recipe.style.name
}

// ---------------------------------------------------------------- operations

export interface ResourceEdit { patches: SourcePatch[]; created?: { id: string; text: string }[]; colors?: PreviewColorAsset[]; removed?: string[] }

export function editResource(ctx: FeatureContext, node: AuthoringNode, op: ResourceOperation): ResourceEdit {
  if (op.kind === 'style-create-link') {
    const property = styleProperties(ctx, node).find(p => p.property === op.property && p.kind === op.style)
    const source = node.properties.find(p => p.id === op.property)
    if (!property || !source?.source || shadowsMember(ctx, node, op.name)) throw new Error('This property cannot use that token.')
    const created = editResource(ctx, node, { kind: 'style-create', name: op.name, style: op.style, value: op.value, token: op.token })
    // A new colour token always gets its ShapeStyle twin, so `.name` compiles in every field.
    return { ...created, patches: [...created.patches, patch(source.source, '.' + op.name)] }
  }
  if (op.kind === 'style-create') {
    if (allDeclarations(ctx).some(d => d.kind !== 'extensionDecl' && 'name' in d && ['Color', 'Font', 'CGFloat'].includes(d.name ?? ''))) throw new Error('A framework type is shadowed. Define this token in Swift.')
    return createToken(ctx, op.style, op.name, op.token ?? { value: op.value })
  }
  if (op.kind === 'style-edit') {
    const recipe = recipes(ctx).find(r => r.style.name === op.name)
    if (!recipe) throw new Error('This token is computed, ambiguous, or no longer editable.')
    const definition = op.token ?? { value: op.value }
    if (recipe.style.form === 'token') {
      if (recipe.style.kind === 'color' && recipe.host === 'Color') {
        // Between a system colour (adapts by itself) and a custom light/dark pair (a colour
        // set) the Swift spelling changes too; both halves of the token move together.
        const twin = recipe.companion?.accessor?.statements
        const twinExpression = twin?.length === 1 && twin[0]!.kind === 'exprStmt' ? twin[0]!.expression : undefined
        const toSystem = systemColor(definition), fromSet = recipe.colorSet !== undefined
        if (toSystem === fromSet) {
          const expression = toSystem ? checkedExpression(ctx, 'color', definition.value) : `Color(${swiftString(recipe.style.name)})`
          if (recipe.companion && !twinExpression) throw new Error(`The ShapeStyle spelling of ${recipe.style.name} is not a single colour. Edit it in Tokens.swift.`)
          const patches = [patch(recipe.style.source, expression), ...(twinExpression ? [patch(twinExpression.span, expression)] : [])]
          if (toSystem) {
            const used = usesColorSet(applyPatches(ctx, patches), recipe.colorSet!)
            return { patches, colors: (ctx.colors ?? []).filter(color => used || color.name !== recipe.colorSet) }
          }
          const light = hex(definition.value), dark = definition.dark ? hex(definition.dark) : undefined
          if (!light || definition.dark && !dark) throw new Error('Use hex values such as #0A84FF.')
          if (ctx.colors?.some(color => color.name.toLowerCase() === recipe.style.name.toLowerCase())) throw new Error(`The asset catalog already has a colour set named ${recipe.style.name}.`)
          return { patches, colors: [...(ctx.colors ?? []), { name: recipe.style.name, light, ...(dark && dark !== light ? { dark } : {}) }] }
        }
      }
      if (recipe.colorSet !== undefined) {
        const light = hex(definition.value), dark = definition.dark ? hex(definition.dark) : undefined
        if (!light || definition.dark && !dark) throw new Error('Use hex values such as #0A84FF.')
        const next = { name: recipe.colorSet, light, ...(dark && dark !== light ? { dark } : {}) }
        const current = ctx.colors?.find(color => color.name === recipe.colorSet)
        if (current && current.light === next.light && current.dark === next.dark) return { patches: [] }
        return { patches: [], colors: [...(ctx.colors ?? []).filter(color => color.name !== recipe.colorSet), next] }
      }
      const expression = recipe.style.kind === 'font' ? fontExpression(definition.font ?? { style: definition.value }, ctx.deploymentTarget)
        : recipe.style.kind === 'shadow' ? shadowExpression(definition.shadow ?? recipe.style.shadow!)
        : checkedExpression(ctx, recipe.style.kind, definition.value)
      if (raw(ctx, recipe.style.source) === expression) return { patches: [] }
      // The ShapeStyle twin repeats the colour; the two change together or not at all.
      const twin = recipe.companion?.accessor?.statements
      const twinExpression = twin?.length === 1 && twin[0]!.kind === 'exprStmt' ? twin[0]!.expression : undefined
      if (recipe.companion && (!twinExpression || raw(ctx, twinExpression.span) !== raw(ctx, recipe.style.source))) throw new Error(`The two spellings of ${recipe.style.name} in Tokens.swift differ. Edit them there.`)
      return { patches: [patch(recipe.style.source, expression), ...(twinExpression ? [patch(twinExpression.span, expression)] : [])] }
    }
    const expression = checkedExpression(ctx, recipe.style.kind, op.value)
    if (op.value === recipe.style.value || recipe.style.kind === 'spacing' && Number(op.value) === Number(recipe.style.value) || recipe.style.kind === 'color' && op.value.toLowerCase() === recipe.style.value.toLowerCase()) return { patches: [] }
    return { patches: [patch(recipe.style.source, expression)] }
  }
  if (op.kind === 'style-link' || op.kind === 'style-local') {
    const property = styleProperties(ctx, node).find(p => p.property === op.property)
    const source = node.properties.find(p => p.id === op.property)
    if (!property || !source?.source) throw new Error('This property is not an editable style value.')
    let value: string
    if (op.kind === 'style-link') {
      const recipe = recipes(ctx).find(r => r.style.name === op.name && fits(r, property.kind))
      if (!recipe || shadowsMember(ctx, node, recipe.style.name.split('.')[0]!)) throw new Error(property.kind === 'radius' ? 'Corner fields take corner radius tokens only.' : 'That token is not available here.')
      if (recipe.style.form === 'legacy') checkedExpression(ctx, recipe.style.kind, recipe.style.value)
      value = referenceFor(recipe, source.name)
    } else value = checkedExpression(ctx, property.kind, op.value)
    return { patches: raw(ctx, source.source) === value ? [] : [patch(source.source, value)] }
  }
  if (op.kind === 'style-migrate') return migrateStyle(ctx, op.name)
  if (op.kind === 'asset-use') {
    const call = callOf(ctx, node), argument = call?.args[0]
    if (node.name !== 'Image' || !argument || call?.args.length !== 1 || argument.label !== null && argument.label !== 'systemName' || argument.value.kind !== 'stringLiteral' || argument.value.segments.some(s => s.kind !== 'text') || hasComments(ctx, argument.span) || allDeclarations(ctx).some(d => 'name' in d && d.name === 'Image')) throw new Error('Select a literal Image("name") or Image(systemName:) view to choose its resource.')
    return { patches: [patch(argument.span, swiftString(op.name))] }
  }
  return { patches: assetReferences(ctx, op) }
}

/**
 * Moves a legacy global style into `Tokens.swift`, in one step.
 *
 * Every reference is rewritten to the qualified form - `Color.brand`, `CGFloat.spaceCard` -
 * which compiles wherever the plain name did, whatever the context. A spacing or radius
 * style takes its kind's prefix, because the two share `CGFloat` and the prefix is what
 * keeps corner fields from offering spacing.
 */
function migrateStyle(ctx: FeatureContext, name: string): ResourceEdit {
  const recipe = recipes(ctx).find(r => r.style.name === name)
  if (!recipe || recipe.style.form !== 'legacy' || name.includes('.')) throw new Error('Only a global style can be moved to Tokens.swift.')
  const radiusUses = recipe.style.kind === 'spacing' && recipe.style.uses.length > 0 && recipe.style.uses.every(use => ctx.nodes.some(node => node.properties.some(p => p.source && equal(p.source, use) && propertyKind(p.name) === 'radius')))
  const kind: StyleKind = radiusUses ? 'radius' : recipe.style.kind
  const tokenName = kind === 'spacing' || kind === 'radius' ? suggestTokenName(kind, name) : name
  const problem = tokenNameProblem(ctx, kind, tokenName, name)
  if (problem) throw new Error(problem)
  const definition: TokenDefinition = kind === 'color' ? { value: recipe.style.value.startsWith('#') ? recipe.style.value : AUTHORING_COLOR_HEX[recipe.style.value] ?? '#000000' } : kind === 'font' ? { value: recipe.style.value, font: { style: recipe.style.value } } : { value: recipe.style.value }
  if (kind === 'color' && !recipe.style.value.startsWith('#') && !AUTHORING_COLOR_HEX[recipe.style.value]) throw new Error('This colour cannot be moved to the asset catalog. Keep it as a Swift style.')
  const declarationFile = ctx.files.find(file => file.id === recipe.declaration.span.file)!
  // The declaration goes, from the start of its line through the line break after it.
  const text = declarationFile.text
  const lineStart = text.lastIndexOf('\n', recipe.declaration.span.start - 1) + 1
  const lineEnd = text.indexOf('\n', recipe.declaration.span.end)
  const removal = { file: declarationFile.id, start: /^\s*$/.test(text.slice(lineStart, recipe.declaration.span.start)) ? lineStart : recipe.declaration.span.start, end: lineEnd < 0 ? text.length : lineEnd + 1, text: '' }
  const qualified = `${typeFor(kind)}.${tokenName}`
  const references = recipe.style.uses.map(use => patch(use, qualified))
  const created = createToken(ctx, kind, tokenName, definition, name)
  // Tokens.swift is written whole; every other edit is a precise patch.
  const tokenPatch = created.patches.find(p => p.file === tokensFile(ctx)?.id)
  const otherPatches = [...references, removal].filter(p => !tokenPatch || p.file !== tokenPatch.file)
  if (tokenPatch && [...references, removal].some(p => p.file === tokenPatch.file)) throw new Error('This style is declared in Tokens.swift already. Edit it there.')
  const remaining = text.slice(0, removal.start) + text.slice(removal.end)
  const empty = !/\S/.test(remaining.replace(/^\s*import\s+\w+\s*$/gm, ''))
  return { patches: [...otherPatches, ...created.patches], created: created.created, colors: created.colors, ...(empty && declarationFile.id !== TOKENS_FILE ? { removed: [declarationFile.id] } : {}) }
}

/**
 * The system colours a legacy style can name, as the sRGB value a colour set holds: the
 * iOS 27 simulator's light values, so a colour doesn't change as it moves to
 * `Tokens.swift`. `Color.blue` used to move as #007AFF, the blue from before iOS 26.
 */
export const AUTHORING_COLOR_HEX: Readonly<Record<string, string>> = { black: '#000000', white: '#FFFFFF', gray: '#8E8E93', red: '#FF383C', orange: '#FF8D28', yellow: '#FFCC00', green: '#34C759', mint: '#00C8B3', teal: '#00C3D0', cyan: '#00C0E8', blue: '#0088FF', indigo: '#6155F5', purple: '#CB30E0', pink: '#FF2D55', brown: '#AC7F5E' }

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
export function validateResourceRemoval(files: readonly SourceFile[], removedNames: readonly string[], removedColors: readonly string[] = []): string | null {
  // A colour set is referenced by name, as `Color("accent")`, so a merge that drops
  // one leaves that call pointing at nothing. Same rule as a removed image.
  for (const name of removedColors) {
    const used = files.find(file => new RegExp(`Color\\(\\s*"${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(file.text))
    if (used) return `The reviewed choices remove the colour “${name}”, which ${used.id} still uses. Keep the colour, or change that reference first.`
  }
  if (!removedNames.length) return null
  const parsed = files.map(file => Parser.parse(file.text, file.id))
  if (parsed.some(p => p.diagnostics.some(d => d.severity === 'error'))) return 'The merged Swift has syntax errors, so removed image references cannot be verified. Keep the resources or open a separate copy.'
  const ctx: FeatureContext = { files, ast: parsed.map(p => p.sourceFile), nodes: [] }
  try { for (const from of removedNames) assetReferences(ctx, { kind: 'asset-references', from, to: null }); return null }
  catch (error) { return `The reviewed choices leave an unresolved image reference. ${error instanceof Error ? error.message : 'Keep its resource or change the source choice.'}` }
}

/** Unknown/dynamic names may still resolve to the set: retain it conservatively. */
function usesColorSet(files: readonly SourceFile[], name: string): boolean {
  let used = false
  const visit = (node: Node) => {
    if (node.kind === 'call' && (node.callee.kind === 'identifier' && node.callee.name === 'Color' || node.callee.kind === 'memberAccess' && node.callee.member === 'Color')) {
      const value = node.args.find(arg => arg.label === null)?.value
      if (value && (value.kind !== 'stringLiteral' || value.segments.some(s => s.kind !== 'text') || value.segments.map(s => s.kind === 'text' ? s.value : '').join('') === name)) used = true
    }
    forEachChild(node, visit)
  }
  for (const file of files) visit(Parser.parse(file.text, file.id).sourceFile)
  return used
}
