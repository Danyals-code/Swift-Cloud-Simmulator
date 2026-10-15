import { modifierModel } from './authoring-modifiers'
import { layerContext, layerProject, readLayer } from './layer'
import { borderOf, cornersOf } from './authoring-border'
import { enrichAuthoring } from './authoring-features'
import type { ComponentDescription, PreviewColorAsset } from '@studio/shared'
import {
  MODIFIER_SLOTS, PRESENTATION_PARTS, VIEW_PARTS, authoringCapability,
  type AuthoringNode, type AuthoringProperty, type AuthoringSnapshot,
  type Diagnostic, type PropertyValueKind, type SourceFile, type SourceSpan,
} from '@studio/shared'
import { Lexer, Parser, forEachChild, isSyntaxError, type Block, type CallExpr, type ClosureExpr, type Decl, type Expr, type Node, type SourceFileNode, type StructDecl, type Token, type VarDecl } from '@studio/swift-syntax'
import { SUPPORTED_VIEWS, UNIMPLEMENTED_VIEWS } from './builtins'
import { containerContent, helperCall, helperContent, helperReach, setByEveryInit, viewHelpers, writtenParameters, type MutableNode, type ViewHelper } from './authoring-helpers'
import { joinedText } from './authoring-runs'
import { colorOpacityParts, designControlRecipes, markViewBase, viewCallChain, AUTHORING_COLORS, AUTHORING_FONTS } from './design-controls'
import { TOKEN_HOSTS } from './layer/tokens'

/** What a name in scope reads: its kind of value, where it is declared, and whether a helper's call gives it. */
interface Binding { kind: PropertyValueKind; source: SourceSpan; helper?: true }
type Scope = ReadonlyMap<string, Binding>

const READ_ONLY = 'Read-only in this version. Use the source to change this property.'

// Reading view-builder content does not grant a writer for the container overload.
const CONTENT_VIEWS = new Set(['VStack', 'HStack', 'ZStack', 'LazyVStack', 'LazyHStack', 'LazyVGrid', 'LazyHGrid', 'Grid', 'GridRow', 'ViewThatFits', 'GeometryReader', 'ScrollView', 'ForEach', 'List', 'Section', 'Form', 'NavigationStack', 'NavigationView', 'NavigationSplitView', 'NavigationLink', 'TabView', 'Tab', 'Group', 'GroupBox', 'DisclosureGroup', 'ControlGroup', 'AnyView', 'WindowGroup', 'ToolbarItem', 'ToolbarItemGroup', 'Picker'])

function callName(expr: Expr): string | null {
  if (expr.kind === 'identifier') return expr.name
  if (expr.kind === 'memberAccess' && (!expr.base || expr.base.kind === 'identifier' && expr.base.name === 'SwiftUI')) return expr.member
  return null
}

/** The closure of SwiftUI's older alert, `.alert(isPresented:) { Alert(…) }`: one that returns an `Alert` rather than the alert's actions. */
function olderAlert(modifier: CallExpr): ClosureExpr | undefined {
  const closure = modifier.trailingClosure ?? modifier.args.find(arg => arg.label === 'content')?.value
  const [only, more] = closure?.kind === 'closure' ? closure.body.statements : []
  const value = more ? undefined : only?.kind === 'exprStmt' ? only.expression : only?.kind === 'returnStmt' ? only.value : undefined
  return value?.kind === 'call' && callName(value.callee) === 'Alert' && closure?.kind === 'closure' ? closure : undefined
}

function referencePath(expr: Expr): string[] | null {
  if (expr.kind === 'identifier') return [expr.name]
  if (expr.kind === 'selfExpr') return ['self']
  if (expr.kind === 'memberAccess' && expr.base) {
    const base = referencePath(expr.base)
    return base ? [...base, expr.member] : null
  }
  return null
}

/** A conservative classification: a runtime value never authorizes a source edit. */
function classify(expr: Expr, scope: Scope, tokens: ReadonlyMap<string, readonly VarDecl[]>, declaredNames: ReadonlySet<string>, contextual: ReadonlyMap<string, readonly VarDecl[]> = new Map()): { kind: PropertyValueKind; declaration?: SourceSpan; helper?: true } {
  if (['integerLiteral', 'floatLiteral', 'booleanLiteral', 'nilLiteral'].includes(expr.kind)) return { kind: 'literal' }
  // `.accent`, `.space16`: a token read with dot syntax. Xcode spells a colour twice -
  // on Color and on ShapeStyle - and the stored member is the token.
  if (expr.kind === 'memberAccess' && !expr.base) {
    const candidates = contextual.get(expr.member) ?? []
    const stored = candidates.filter(declaration => !declaration.accessor)
    const chosen = stored.length === 1 ? stored[0] : candidates.length === 1 ? candidates[0] : undefined
    if (chosen) return { kind: chosen.accessor ? 'computed' : 'token', declaration: chosen.nameSpan }
  }
  if (expr.kind === 'stringLiteral') return { kind: expr.segments.every(s => s.kind === 'text') ? 'literal' : 'computed' }
  if (expr.kind === 'unary' && ['+', '-'].includes(expr.operator) && ['integerLiteral', 'floatLiteral'].includes(expr.operand.kind)) return { kind: 'literal' }
  if (expr.kind === 'errorExpr') return { kind: 'unsupported' }
  const path = referencePath(expr)
  if (path) {
    const root = path[0] === 'self' ? path[1] : path[0]
    const binding = root ? scope.get(root) ?? scope.get(root.replace(/^\$/, '')) : undefined
    if (binding) return { kind: root?.startsWith('$') ? 'data-binding' : binding.kind, declaration: binding.source, ...binding.helper ? { helper: true as const } : {} }
    const declarations = tokens.get(path.join('.')) ?? []
    if (declarations.length === 1) {
      const declaration = declarations[0]!
      return { kind: declaration.accessor ? 'computed' : 'token', declaration: declaration.nameSpan }
    }
    const qualified = path[0] === 'SwiftUI' ? path.slice(1) : path
    const type = qualified[0], member = qualified[1]
    if (qualified.length === 2 && member && (path[0] === 'SwiftUI' || type && !declaredNames.has(type)) && (type === 'Color' && AUTHORING_COLORS.includes(member) || type === 'Font' && AUTHORING_FONTS.includes(member))) return { kind: 'literal' }
    // Unknown identifiers may be macros, unavailable declarations or ambiguous names.
    return { kind: 'unsupported' }
  }
  return { kind: 'computed' }
}

/**
 * A token as a fingerprint writes it, `JSON.stringify([kind, text])`. A kind is a plain word,
 * and most texts have nothing JSON escapes, so those are written without it.
 */
const asWritten = (token: Token): string => plain(token.text) ? `["${token.kind}","${token.text}"]` : JSON.stringify([token.kind, token.text])
/** Whether JSON writes a text as it is: with no quote, backslash, control character or surrogate in it. */
function plain(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x20 || code === 0x22 || code === 0x5c || code >= 0xd800 && code <= 0xdfff) return false
  }
  return true
}

/** The index of the first token starting at or after `offset`, by halves. */
function firstToken(tokens: readonly Token[], offset: number): number {
  let low = 0, high = tokens.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (tokens[middle]!.span.start < offset) low = middle + 1
    else high = middle
  }
  return low
}

export interface AuthoringInput {
  readonly files: readonly SourceFile[]
  readonly projectId: string
  readonly revision: number
  readonly deploymentTarget?: string
  readonly componentDescriptions?: readonly ComponentDescription[]
  readonly parsed?: readonly SourceFileNode[]
  /** Each file's tokens as `Lexer.tokenize` gives them, where they are at hand: parsing lexes every file. */
  readonly tokens?: ReadonlyMap<string, readonly Token[]>
  readonly diagnostics?: readonly Diagnostic[]
  readonly colors?: readonly PreviewColorAsset[]
}

export function buildAuthoringModel(input: AuthoringInput): AuthoringSnapshot {
  const diagnostics: Diagnostic[] = [...(input.diagnostics ?? [])]
  const parsed = input.parsed ?? input.files.map(file => {
    const result = Parser.parse(file.text, file.id)
    diagnostics.push(...result.diagnostics)
    return result.sourceFile
  })
  const texts = new Map(input.files.map(f => [f.id, f.text]))
  const source = (span: SourceSpan) => texts.get(span.file)?.slice(span.start, span.end) ?? ''
  const layers = layerProject(parsed, input.deploymentTarget, input.files)
  const nodes: MutableNode[] = []
  const byId = new Map<string, MutableNode>()
  /** What `inTemplate` found for each layer. */
  const templated = new Map<MutableNode, boolean>()
  const roots: string[] = []
  const declaredNames = new Set<string>()
  const definitions = new Map<string, { decl: StructDecl; node: MutableNode }[]>()
  /** Each View struct by its owner name; null where two share one, whose helpers are then not told apart. */
  const views = new Map<string, StructDecl | null>()
  const previews: { body: Block; node: MutableNode }[] = []
  const tokens = new Map<string, VarDecl[]>()
  const contextual = new Map<string, VarDecl[]>()
  /**
   * Each file lexed once, with its tokens written as a fingerprint writes them, joined, and
   * where each one's writing starts in that, so a run of them is one slice of it.
   */
  const lexed = new Map<string, { readonly tokens: readonly Token[]; readonly written: string; readonly at: readonly number[] }>()
  /**
   * The kind and text of each token in a view's source, lexed on its own. A span from a
   * token's start or a token's end to a token's end lexes as that run of its file's tokens,
   * as lexing reads no further back than where it starts; lexing each view's own text again
   * lexed it once more for every view around it.
   */
  const fingerprint = (span: SourceSpan) => {
    const text = texts.get(span.file)
    let file = lexed.get(span.file)
    if (text !== undefined && !file) {
      const tokens = input.tokens?.get(span.file) ?? Lexer.tokenize(text, span.file).tokens
      const pieces = tokens.map(asWritten), at = [0]
      for (const piece of pieces) at.push(at.at(-1)! + piece.length + 1)
      lexed.set(span.file, file = { tokens, written: pieces.join(','), at })
    }
    if (file) {
      const first = firstToken(file.tokens, span.start), end = firstToken(file.tokens, span.end)
      const starts = file.tokens[first]?.span.start === span.start || file.tokens[first - 1]?.span.end === span.start
      if (first < end && starts && file.tokens[end - 1]!.span.end === span.end) return `[${file.written.slice(file.at[first], file.at[end]! - 1)}]`
    }
    return JSON.stringify(Lexer.tokenize(source(span), span.file).tokens.filter(t => t.kind !== 'endOfFile').map(t => [t.kind, t.text]))
  }

  function add(kind: AuthoringNode['kind'], name: string, span: SourceSpan, owner: string, parent?: MutableNode): MutableNode {
    // An `else if` is the whole of its "Otherwise" branch, so the two share a span. With
    // one id the inner "Condition" was its own parent, and walking up from it never ended.
    let id = JSON.stringify([span.file, span.start, span.end, kind])
    if (byId.has(id)) id = JSON.stringify([span.file, span.start, span.end, kind, name])
    const node: MutableNode = { id, kind, name, source: span, owner, parentId: parent?.id, fingerprint: fingerprint(span), children: [], properties: [], runtimeIds: [] }
    nodes.push(node)
    // A layer met again under the same id changes the walk up from what is below it.
    if (byId.has(id)) templated.clear()
    byId.set(id, node)
    if (parent) parent.children.push(id)
    else roots.push(id)
    return node
  }

  function index(decl: Decl, prefix = ''): void {
    // A typealias, function or value can shadow a standard-library type name too.
    if ('name' in decl && typeof decl.name === 'string' && decl.kind !== 'extensionDecl') declaredNames.add(decl.name)
    if (decl.kind === 'structDecl' || decl.kind === 'enumDecl') {
      const name = prefix + decl.name
      if (decl.kind === 'structDecl' && decl.inherits.some(t => ['View', 'App', 'SwiftUI.View', 'SwiftUI.App'].includes(t.name))) {
        const node = add('definition', decl.name, decl.span, name)
        definitions.set(decl.name, [...(definitions.get(decl.name) ?? []), { decl, node }])
        if (!decl.inherits.some(t => t.name === 'App' || t.name === 'SwiftUI.App')) views.set(name, views.has(name) ? null : decl)
      }
      for (const member of decl.members) index(member, `${name}.`)
    } else if (decl.kind === 'macroDecl' && decl.name === 'Preview' && decl.body) {
      previews.push({ body: decl.body, node: add('definition', '#Preview', decl.span, '#Preview') })
    } else if (decl.kind === 'varDecl' && (!prefix || decl.modifiers.some(m => m.name === 'static'))) {
      const key = prefix + decl.name
      tokens.set(key, [...(tokens.get(key) ?? []), decl])
      if (prefix && TOKEN_HOSTS.has(prefix.slice(0, -1))) contextual.set(decl.name, [...(contextual.get(decl.name) ?? []), decl])
    } else if (decl.kind === 'extensionDecl' && !prefix) {
      // `extension Color { static let accent = … }`: indexed as `Color.accent`, and
      // by bare name for the contextual `.accent` that tokens are written with.
      for (const member of decl.members) {
        if (member.kind !== 'varDecl' || !member.modifiers.some(m => m.name === 'static')) continue
        const key = `${decl.name}.${member.name}`
        tokens.set(key, [...(tokens.get(key) ?? []), member])
        if (TOKEN_HOSTS.has(decl.name)) contextual.set(member.name, [...(contextual.get(member.name) ?? []), member])
      }
    }
  }
  for (const file of parsed) for (const decl of file.declarations) index(decl)
  /** Each View struct by its owner name, of those no other view shares a name with. */
  const viewDecls = new Map([...views].flatMap(([owner, decl]) => decl ? [[owner, decl] as const] : []))
  const helpers = viewHelpers(viewDecls, parsed)
  /** Each helper's own node, made where it is first called, and read in turn after the bodies (Wave 3a). */
  const helperNodes = new Map<ViewHelper, MutableNode>()
  const helperQueue: ViewHelper[] = []
  const helperNode = (helper: ViewHelper): MutableNode => {
    let node = helperNodes.get(helper)
    if (!node) {
      helperNodes.set(helper, node = Object.assign(add('definition', helper.name, helper.decl.span, helper.owner), { helper: true as const }))
      helperQueue.push(helper)
    }
    return node
  }
  const isSwiftUIText = (call: Expr) => call.kind === 'call' && callName(call.callee) === 'Text' && !definitions.has('Text')
  /** The helper `expr` calls, from a view of `owner`'s, unless a value of the same name in `scope` hides it. */
  const helperAt = (expr: Expr, owner: string, scope: Scope) => helperCall(expr, helpers.get(owner) ?? [], (name, declared) => {
    const binding = scope.get(name)
    return !!binding && (binding.source.file !== declared.file || binding.source.start !== declared.start)
  })

  /** `node` and the layers above it, nearest first. A layer met twice ends the walk, so an id that repeats cannot make it run forever. */
  function* upFrom(node: MutableNode | undefined): Generator<MutableNode> {
    const seen = new Set<string>()
    for (let layer = node; layer && !seen.has(layer.id); layer = layer.parentId ? byId.get(layer.parentId) : undefined) {
      seen.add(layer.id)
      yield layer
    }
  }

  /** Whether a layer is in a row template, or is one: asked of every value of every view, so kept until a layer's id is taken again. */
  function inTemplate(node: MutableNode): boolean {
    let known = templated.get(node)
    if (known === undefined) templated.set(node, known = [...upFrom(node)].some(layer => layer.kind === 'template'))
    return known
  }

  function property(node: MutableNode, name: string, expr: Expr | null, scope: Scope, capability?: string, reason?: string): AuthoringProperty {
    const value = expr ? classify(expr, scope, tokens, declaredNames, contextual) : { kind: 'literal' as const }
    const repeated = inTemplate(node)
    const invalid = diagnostics.some(d => d.severity === 'error' && d.span.file === node.source.file && d.span.start < node.source.end && d.span.end >= node.source.start)
    return {
      id: `${node.id}:${node.properties.length}`, name, expression: expr ? source(expr.span) : 'Implicit',
      valueKind: reason || invalid ? 'unsupported' : value.kind,
      source: expr?.span, declaration: value.declaration, ownerId: node.id,
      scope: node.kind === 'component' ? 'instance' : repeated ? 'template' : 'definition',
      capability, writable: false,
      reason: invalid ? 'Source diagnostics overlap this view. Resolve them before editing.' : reason ?? (value.kind === 'computed' ? 'Computed in Swift. Preserve the expression and edit its inputs or source.' : value.kind === 'unsupported' ? 'This expression cannot be resolved safely.' : READ_ONLY),
      ...'helper' in value && value.helper ? { helperArgument: true } : {},
    }
  }

  /**
   * `argument` says the view is written as another's argument, `run` that it is a run of texts
   * joined with `+`, and `title` that it is an alert's or a dialog's title written as a value,
   * which takes nothing but its words.
   */
  function expression(expr: Expr, parent: MutableNode, scope: Scope, { argument = false, run = false, title = false } = {}): void {
    // A helper's call points at its views, as a component's copy points at its Main. Read
    // as a property, it is where its modifiers start, as a call would be.
    const helper = helperAt(expr, parent.owner, scope)
    if (helper && !helper.call) markViewBase(helper.base)
    // Texts joined with `+` are one Text, whose runs are Texts (Wave 3a). Written bare, the
    // sum has no modifiers of its own: one after it would style its last run only.
    const joined = joinedText(expr, texts.get(expr.span.file) ?? '', isSwiftUIText)
    if (joined && !joined.parenthesised) {
      const group = add('view', 'Text', expr.span, parent.owner, parent)
      if (argument) Object.assign(group, { argument: true })
      group.properties.push(property(group, 'Source', expr, scope, undefined, 'Put the joined text in parentheses in Code to style all of it.'))
      for (const part of joined.runs) expression(part, group, scope, { run: true })
      return
    }
    if (joined?.parenthesised) markViewBase(joined.sum, joined.parenthesised)
    const chain = viewCallChain(expr)
    if (!chain) { add('opaque', 'Custom expression', expr.span, parent.owner, parent); return }
    const name = joined ? 'Text' : helper ? helper.helper.name : callName(chain.base.callee)
    if (!name) { add('opaque', 'Custom expression', expr.span, parent.owner, parent); return }
    const custom = helper ? [{ node: helperNode(helper.helper) }] : definitions.get(name) ?? []
    const builtin = custom.length === 0 && SUPPORTED_VIEWS.has(name)
    const capability = builtin ? authoringCapability(name, 'view', chain.base.args.map(a => a.label)) : undefined
    const node = add(custom.length === 1 ? 'component' : name === 'ForEach' || name === 'List' && chain.base.args.length > 0 ? 'collection' : builtin ? 'view' : 'opaque', name, expr.span, parent.owner, parent)
    if (custom.length === 1) Object.assign(node, { definitionId: custom[0]!.node.id })
    if (helper) Object.assign(node, { helper: true })
    // A run is part of the text it is joined into, which it can't leave or be wrapped out of.
    if (run) Object.assign(node, { textRun: true, argument: true })
    if (joined) {
      Object.assign(node, { drawnFrom: joined.sum.span })
      for (const part of joined.runs) expression(part, node, scope, { run: true })
    }
    // Real SwiftUI with no drawing yet, or a name the checker says the preview draws a box for (D12).
    const unknown = !custom.length && diagnostics.some(d => d.code === 'unresolved_identifier' && d.severity === 'warning' && d.span.file === expr.span.file && d.span.start === expr.span.start)
    if (!custom.length && UNIMPLEMENTED_VIEWS.has(name) || unknown) Object.assign(node, { undrawn: UNIMPLEMENTED_VIEWS.has(name) ? 'unsupported' : 'unknown' })
    if (argument) Object.assign(node, { argument: true })
    const reason = custom.length > 1 ? 'More than one matching component declaration; ownership is ambiguous.' : !custom.length && !capability ? 'This constructor overload is outside the authoring subset.' : undefined
    for (const [i, arg] of chain.base.args.entries()) {
      node.properties.push(property(node, arg.label ?? (name === 'Text' ? 'content' : `argument ${i + 1}`), arg.value, scope, capability?.id, reason))
    }
    // A labelled box keeps its modifiers editable: only the view itself goes undrawn.
    if (reason && !builtin && !chain.base.args.length && node.undrawn !== 'unsupported') node.properties.push(property(node, 'Source', expr, scope, undefined, reason))
    for (const modifier of chain.modifiers) {
      const modifierName = modifier.callee.kind === 'memberAccess' ? modifier.callee.member : 'unknown'
      const supported = authoringCapability(modifierName, 'modifier', modifier.args.map(a => a.label))
      const unsupported = supported ? undefined : 'This modifier overload is outside the authoring subset; preserve its source.'
      for (const [index, arg] of modifier.args.entries()) {
        const colorArgument = ['foregroundColor', 'foregroundStyle', 'background', 'fill', 'tint', 'border'].includes(modifierName) && index === 0 && !arg.label || modifierName === 'shadow' && arg.label === 'color'
        const translucent = colorArgument && colorOpacityParts(arg.value)
        const propertyName = arg.label ? `${modifierName}.${arg.label}` : modifierName
        if (translucent) {
          node.properties.push(property(node, propertyName, translucent.color, scope, supported?.id, unsupported))
          node.properties.push(property(node, `${modifierName}.opacity`, translucent.opacity, scope, supported?.id, unsupported))
        } else node.properties.push(property(node, propertyName, arg.value, scope, supported?.id, unsupported))
      }
      // A corner radius written inside its shape - `.clipShape(.rect(cornerRadius: .radiusMedium))` -
      // is still the view's corner radius, and a radius token field reads it there.
      const shape = modifierName === 'clipShape' && modifier.args.length === 1 ? modifier.args[0]!.value : undefined
      if (shape?.kind === 'call' && !shape.trailingClosure && (shape.callee.kind === 'memberAccess' && !shape.callee.base && shape.callee.member === 'rect' || shape.callee.kind === 'identifier' && shape.callee.name === 'RoundedRectangle')) {
        const corner = shape.args.every(argument => ['cornerRadius', 'style'].includes(argument.label ?? '')) ? shape.args.find(a => a.label === 'cornerRadius') : undefined
        if (corner) node.properties.push(property(node, 'clipShape.cornerRadius', corner.value, scope, supported?.id, unsupported))
      }
      if (!modifier.args.length) node.properties.push({ ...property(node, modifierName, null, scope, supported?.id, unsupported), source: modifier.callee.kind === 'memberAccess' ? modifier.callee.memberSpan : modifier.span })
    }
    if (name === 'Text' && !node.properties.some(p => p.name === 'font')) {
      let origin: AuthoringProperty | undefined
      for (const ancestor of upFrom(parent)) {
        origin = [...ancestor.properties].reverse().find(p => p.name === 'font')
        if (origin) break
      }
      node.properties.push({ id: `${node.id}:inherited-font`, name: 'font', expression: origin?.expression ?? 'Environment / call site', valueKind: 'inherited', source: origin?.source, ownerId: origin?.ownerId ?? parent.id, scope: 'inherited', writable: false, reason: origin ? 'Inherited from an enclosing source view; it affects its descendants.' : 'No local font is declared; the environment supplies it.' })
    }
    // A syntax error takes the controls of its own file's views, not every file's: a half-typed draft elsewhere
    // is no reason to lock the design, and the planner refuses only changes to the file that does not parse.
    if (!diagnostics.some(d => d.span.file === node.source.file && (isSyntaxError(d) || d.severity === 'error' && d.span.start < node.source.end && d.span.end >= node.source.start))) {
      const template = inTemplate(parent)
      // A control that keeps its scope and description is kept as it is, rather than copied.
      const recipes = designControlRecipes(node, expr, texts.get(node.source.file) ?? '', layers, input.deploymentTarget)
      const controls = (title ? recipes.filter(({ control }) => control.id.startsWith('content')) : recipes).map(({ control }) => template || control.id.startsWith('fill:') ? { ...control, scope: template ? 'All rows in this template' : control.scope, description: control.id.startsWith('fill:') ? `${control.description} Parent: ${parent.name}. Hug uses natural SwiftUI sizing; shapes may stay flexible. Fill expands where the parent supplies a finite size.` : control.description } : control)
      Object.assign(node, { controls })
      node.properties = node.properties.map(property => controls.some(c => c.source.start === property.source?.start && c.source.end === property.source.end) ? { ...property, valueKind: property.valueKind === 'computed' ? 'literal' : property.valueKind, writable: true, reason: 'Editable through a validated source control.' } : property)
    }
    if (!title) Object.assign(node, modifierModel(node, expr, texts.get(node.source.file) ?? '', { deploymentTarget: input.deploymentTarget, allowEdits: !!node.controls }))
    // The same chain read as a layer: one value per Figma property (Wave 2).
    if (node.controls && !title) {
      const layer = readLayer(expr, layerContext(layers, node, parent, texts.get(node.source.file) ?? ''))
      if (layer) Object.assign(node, { layer })
    }
    const explicitLabel = builtin && ['NavigationLink', 'Button'].includes(name) ? chain.base.args.find(argument => argument.label === 'label' && argument.value.kind === 'closure')?.value : undefined
    const closure = explicitLabel?.kind === 'closure' ? explicitLabel : chain.base.trailingClosure
    const parts = builtin ? VIEW_PARTS[name] : undefined
    const ownViews = closure && (capability?.content || builtin && (CONTENT_VIEWS.has(name) || !!parts?.views || name === 'Button' && (!!explicitLabel || chain.base.args.some(arg => arg.label === 'action')))) ? closure : undefined
    if (ownViews) {
      if (node.kind === 'collection') {
        const template = add('template', 'Row template', ownViews.span, parent.owner, node)
        const locals = new Map(scope)
        const params = ownViews.params.length ? ownViews.params : [{ name: '$0', span: ownViews.span }]
        for (const param of params) locals.set(param.name.replace(/^\$/, ''), { kind: 'data-binding', source: param.span })
        block(ownViews.body, template, locals)
      } else {
        const locals = new Map(scope)
        for (const param of ownViews.params) locals.set(param.name.replace(/^\$/, ''), { kind: 'computed', source: param.span })
        block(ownViews.body, node, locals)
      }
    }
    // With multiple trailing closures, NavigationLink's first closure is the
    // destination; its labeled closure is the visible row. Actions remain excluded.
    const destination = builtin && name === 'NavigationLink' ? (explicitLabel ? chain.base.trailingClosure : undefined) ?? chain.base.args.find(argument => argument.label === 'destination')?.value : undefined
    if (destination) {
      const slot = add('branch', 'Destination', destination.span, parent.owner, node)
      if (destination.kind === 'closure') block(destination.body, slot, scope)
      else expression(destination, slot, scope, { argument: true })
    }
    // Its other parts, each a slot of its own in the order written (Wave 3a): a Section's
    // header, a Toggle's label, a Label's icon. Actions and plain values are not views.
    const written = parts ? [...chain.base.args.map(arg => ({ part: parts.slots[arg.label ?? ''], value: arg.value })), { part: parts.slots.trailing, value: chain.base.trailingClosure }] : []
    for (const { part, value } of written.sort((a, b) => (a.value?.span.start ?? 0) - (b.value?.span.start ?? 0))) {
      if (!part || !value || value === ownViews || value.kind !== 'closure' && value.kind !== 'call' && !helperAt(value, parent.owner, scope)) continue
      const slot = add('branch', part, value.span, parent.owner, node)
      if (value.kind !== 'closure') { expression(value, slot, scope, { argument: true }); continue }
      const locals = new Map(scope)
      for (const param of value.params) locals.set(param.name.replace(/^\$/, ''), { kind: 'computed', source: param.span })
      block(value.body, slot, locals)
    }
    // A container of the project's own is given views where it is called: its Content (Wave 3a).
    const container = custom.length === 1 && 'decl' in custom[0]! ? custom[0].decl : undefined
    const given = helper?.call ? helperContent(helper.helper, helper.call) : container ? containerContent(container, chain.base) : []
    for (const { property, value } of given) {
      if (value.kind !== 'closure' && value.kind !== 'call' && !helperAt(value, parent.owner, scope)) continue
      const slot = add('branch', property.charAt(0).toUpperCase() + property.slice(1), value.span, parent.owner, node)
      if (value.kind === 'closure') block(value.body, slot, scope)
      else expression(value, slot, scope, { argument: true })
    }
    // A visual slot has its own layer; action closures and scalar colors are not views,
    // and a border is a setting of the view it outlines (D8).
    const corners = cornersOf(chain, texts.get(node.source.file) ?? '')
    for (const modifier of chain.modifiers) {
      const name = modifier.callee.kind === 'memberAccess' ? modifier.callee.member : ''
      const label = MODIFIER_SLOTS[name]
      if (!label || borderOf(modifier, corners, texts.get(node.source.file) ?? '')) continue
      if (name === 'alert' || name === 'confirmationDialog') {
        // From its name on: the modifier's own span starts with the view it is chained on.
        const start = modifier.callee.kind === 'memberAccess' ? modifier.callee.memberSpan.start : modifier.span.start
        presented(modifier, add('branch', label, { file: modifier.span.file, start, end: modifier.span.end }, parent.owner, node), scope)
        continue
      }
      const closure = modifier.trailingClosure ?? modifier.args.find(arg => arg.label === 'content' && arg.value.kind === 'closure')?.value
      if (closure?.kind === 'closure') {
        const slot = add('branch', label, closure.span, parent.owner, node)
        const locals = new Map(scope)
        for (const param of closure.params) locals.set(param.name.replace(/^\$/, ''), { kind: 'computed', source: param.span })
        block(closure.body, slot, locals)
      } else if (name === 'background' || name === 'overlay') {
        const argument = modifier.args.find(arg => arg.label === null)?.value
        const content = argument && viewCallChain(argument)
        const contentName = content && callName(content.base.callee)
        // Color styling stays in its modifier. Qualification must not resolve to a local Color component.
        const builtinColor = contentName === 'Color' && (!definitions.has('Color') || content?.base.callee.kind === 'memberAccess' && content.base.callee.base?.kind === 'identifier' && content.base.callee.base.name === 'SwiftUI')
        if (argument && (helperAt(argument, parent.owner, scope) || contentName && !builtinColor && (SUPPORTED_VIEWS.has(contentName) || definitions.has(contentName)))) {
          const slot = add('branch', label, argument.span, parent.owner, node)
          expression(argument, slot, scope, { argument: true })
        }
      }
    }
  }

  /**
   * An alert's or a confirmation dialog's parts where they are written (Wave 3b): its title,
   * then its actions and message, each a slot. A title written as a value, words or data, is
   * read as the `Text` SwiftUI makes of it, whose words are edited in place, or shown read
   * only when they come from data, and which takes nothing added. SwiftUI's older alert,
   * `.alert(isPresented:) { Alert(…) }`, returns an `Alert` rather than its actions, and is
   * read as written, whole.
   */
  function presented(modifier: CallExpr, slot: MutableNode, scope: Scope): void {
    const title = modifier.args.find(arg => arg.label === null)?.value
    if (title) {
      const value = !(title.kind === 'call' && callName(viewCallChain(title)!.base.callee) === 'Text')
      if (value) markViewBase(title, title.span, { kind: 'call', callee: { kind: 'identifier', name: 'Text', span: title.span }, args: [{ label: null, labelSpan: null, value: title, span: title.span }], trailingClosure: null, span: title.span })
      expression(title, slot, scope, { argument: true, title: value })
    }
    const older = olderAlert(modifier)
    if (older) { block(older.body, slot, closureScope(older, scope)); return }
    const written = [...modifier.args.map(arg => ({ part: PRESENTATION_PARTS[arg.label ?? ''], value: arg.value })), { part: PRESENTATION_PARTS.trailing, value: modifier.trailingClosure }]
    for (const { part, value } of written.sort((a, b) => (a.value?.span.start ?? 0) - (b.value?.span.start ?? 0))) {
      if (!part || value?.kind !== 'closure') continue
      block(value.body, add('branch', part, value.span, slot.owner, slot), closureScope(value, scope))
    }
  }

  /** `scope` with a closure's parameters in it, as values worked out in Swift. */
  function closureScope(closure: ClosureExpr, scope: Scope): Scope {
    const locals = new Map(scope)
    for (const param of closure.params) locals.set(param.name.replace(/^\$/, ''), { kind: 'computed', source: param.span })
    return locals
  }

  function block(body: Block, parent: MutableNode, inherited: Scope): void {
    const scope = new Map(inherited)
    for (const stmt of body.statements) {
      if (stmt.kind === 'declStmt' && stmt.declaration.kind === 'varDecl') {
        scope.set(stmt.declaration.name, { kind: 'computed', source: stmt.declaration.nameSpan })
      } else if (stmt.kind === 'exprStmt' || stmt.kind === 'returnStmt') {
        const value = stmt.kind === 'exprStmt' ? stmt.expression : stmt.value
        if (value) expression(value, parent, scope)
      } else if (stmt.kind === 'ifStmt') {
        const branch = add('branch', 'Condition', stmt.span, parent.owner, parent)
        const locals = new Map(scope)
        for (const condition of stmt.conditions) {
          const expr = condition.kind === 'expr' ? condition.expr : condition.value
          branch.properties.push(property(branch, 'condition', expr, scope))
          if (condition.kind === 'optionalBinding') locals.set(condition.name, { kind: 'computed', source: condition.nameSpan })
        }
        block(stmt.then, branch, locals)
        if (stmt.else) {
          // An `else if` covers exactly the span of its nested Condition, so the two would share an
          // id and the Condition would become its own parent. Starting after `then` keeps them apart.
          const span = stmt.else.kind === 'block' ? stmt.else.span : { ...stmt.else.span, start: stmt.then.span.end }
          const otherwise = add('branch', 'Otherwise', span, parent.owner, branch)
          if (stmt.else.kind === 'block') block(stmt.else, otherwise, scope)
          else block({ kind: 'block', span: stmt.else.span, statements: [stmt.else] }, otherwise, scope)
        }
      } else if (stmt.kind === 'switchStmt') {
        const branch = add('branch', 'Switch', stmt.span, parent.owner, parent)
        branch.properties.push(property(branch, 'condition', stmt.subject, scope))
        for (const item of stmt.cases) {
          const label = item.isDefault ? 'Otherwise' : 'Case ' + item.patterns.map(pattern => source(pattern.span)).join(', ')
          const content = add('branch', label, item.span, parent.owner, branch)
          block(item.body, content, scope)
        }
      } else add('opaque', stmt.kind, stmt.span, parent.owner, parent)
    }
  }

  /** What a view's own code reads by name: its properties, as `body` and its helpers see them. */
  const scopes = new Map<string, Scope>()
  for (const candidates of definitions.values()) for (const { decl, node } of candidates) {
    const scope = new Map<string, Binding>()
    for (const member of decl.members) {
      if (member.kind !== 'varDecl' || member.name === 'body') continue
      const wrapped = member.attributes.some(a => ['State', 'Binding', 'ObservedObject', 'StateObject', 'Environment', 'EnvironmentObject', 'Bindable'].includes(a.name))
      const memberwise = !member.accessor && !member.initializer && !member.modifiers.some(m => ['private', 'fileprivate', 'static'].includes(m.name)) && !decl.members.some(m => m.kind === 'initDecl')
      // Given where the view is used: by its memberwise init, or by every init of its own, as written.
      scope.set(member.name, { kind: wrapped ? 'data-binding' : memberwise || !member.accessor && setByEveryInit(decl, member.name) ? 'component-argument' : 'computed', source: member.nameSpan })
    }
    if (views.get(node.owner) === decl) scopes.set(node.owner, scope)
    for (const member of decl.members) {
      if (member.kind === 'varDecl' && member.name === 'body' && member.accessor) block(member.accessor, node, scope)
    }
  }
  for (const preview of previews) block(preview.body, preview.node, new Map())
  // A helper is read once, after the bodies that call it; one called only from another
  // helper joins the queue as that one is read, and one nothing calls is read last, so
  // Layers can list it as not used. Its parameters are values each call gives it: set
  // where it is used when every call writes them out, and data otherwise.
  const written = writtenParameters(helpers, viewDecls)
  let read = 0
  const readHelpers = () => {
    for (; read < helperQueue.length; read++) {
      const helper = helperQueue[read]!
      const scope = new Map(scopes.get(helper.owner))
      for (const param of helper.params) scope.set(param.internalName, { kind: written.has(param) ? 'component-argument' : 'data-binding', source: param.span, helper: true })
      block(helper.body, helperNodes.get(helper)!, scope)
    }
  }
  readHelpers()
  for (const own of helpers.values()) own.forEach(helperNode)
  readHelpers()
  helperReach(nodes, [...helperNodes.values()])
  // Unsupported declarations remain represented, including their exact source ranges.
  const collectOpaque = (node: Node): void => {
    if (['unsupportedDecl', 'errorDecl', 'unsupportedStmt', 'errorStmt', 'errorExpr'].includes(node.kind)) {
      if (!nodes.some(n => n.source.file === node.span.file && n.source.start <= node.span.start && n.source.end >= node.span.end && n.kind !== 'definition')) add('opaque', node.kind, node.span, node.span.file)
      return
    }
    forEachChild(node, collectOpaque)
  }
  parsed.forEach(collectOpaque)
  return enrichAuthoring({ deploymentTarget: input.deploymentTarget, ast: parsed, files: input.files, nodes, descriptions: input.componentDescriptions, colors: input.colors }, { schemaVersion: 1, projectId: input.projectId, revision: input.revision, nodes, roots, diagnostics, runtimeToSource: {} })
}
