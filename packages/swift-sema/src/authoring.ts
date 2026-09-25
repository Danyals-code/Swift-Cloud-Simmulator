import { modifierModel } from './authoring-modifiers'
import { borderOf, cornersOf } from './authoring-border'
import { enrichAuthoring } from './authoring-features'
import type { ComponentDescription, PreviewColorAsset } from '@studio/shared'
import {
  authoringCapability,
  type AuthoringNode, type AuthoringProperty, type AuthoringSnapshot,
  type Diagnostic, type PropertyValueKind, type SourceFile, type SourceSpan,
} from '@studio/shared'
import { Lexer, Parser, forEachChild, isSyntaxError, type Block, type Decl, type Expr, type Node, type SourceFileNode, type StructDecl, type VarDecl } from '@studio/swift-syntax'
import { SUPPORTED_VIEWS, UNIMPLEMENTED_VIEWS } from './builtins'
import { colorOpacityParts, designControlRecipes, viewCallChain, AUTHORING_COLORS, AUTHORING_FONTS } from './design-controls'

type MutableNode = Omit<AuthoringNode, 'children' | 'properties'> & { children: string[]; properties: AuthoringProperty[] }
interface Binding { kind: PropertyValueKind; source: SourceSpan }
type Scope = ReadonlyMap<string, Binding>

const READ_ONLY = 'Read-only in this version. Use the source to change this property.'

// Reading view-builder content does not grant a writer for the container overload.
const CONTENT_VIEWS = new Set(['VStack', 'HStack', 'ZStack', 'LazyVStack', 'LazyHStack', 'LazyVGrid', 'LazyHGrid', 'Grid', 'GridRow', 'ViewThatFits', 'GeometryReader', 'ScrollView', 'ForEach', 'List', 'Section', 'Form', 'NavigationStack', 'NavigationView', 'NavigationSplitView', 'NavigationLink', 'TabView', 'Tab', 'Group', 'GroupBox', 'DisclosureGroup', 'ControlGroup', 'AnyView', 'WindowGroup', 'ToolbarItem', 'ToolbarItemGroup', 'Picker'])
const CONTENT_SLOTS: Readonly<Record<string, string>> = { background: 'Background', overlay: 'Overlay', toolbar: 'Toolbar', sheet: 'Sheet', fullScreenCover: 'Full screen cover', navigationDestination: 'Destination', safeAreaInset: 'Safe area inset' }


function callName(expr: Expr): string | null {
  if (expr.kind === 'identifier') return expr.name
  if (expr.kind === 'memberAccess' && (!expr.base || expr.base.kind === 'identifier' && expr.base.name === 'SwiftUI')) return expr.member
  return null
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

/** Framework types whose static members are design tokens, read with contextual `.name`. */
const TOKEN_HOSTS = new Set(['Color', 'ShapeStyle', 'CGFloat', 'Double', 'Font', 'ShadowToken'])

/** A conservative classification: a runtime value never authorizes a source edit. */
function classify(expr: Expr, scope: Scope, tokens: ReadonlyMap<string, readonly VarDecl[]>, declaredNames: ReadonlySet<string>, contextual: ReadonlyMap<string, readonly VarDecl[]> = new Map()): { kind: PropertyValueKind; declaration?: SourceSpan } {
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
    if (binding) return { kind: root?.startsWith('$') ? 'data-binding' : binding.kind, declaration: binding.source }
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

export interface AuthoringInput {
  readonly files: readonly SourceFile[]
  readonly projectId: string
  readonly revision: number
  readonly deploymentTarget?: string
  readonly componentDescriptions?: readonly ComponentDescription[]
  readonly parsed?: readonly SourceFileNode[]
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
  const nodes: MutableNode[] = []
  const byId = new Map<string, MutableNode>()
  const roots: string[] = []
  const declaredNames = new Set<string>()
  const definitions = new Map<string, { decl: StructDecl; node: MutableNode }[]>()
  const previews: { body: Block; node: MutableNode }[] = []
  const tokens = new Map<string, VarDecl[]>()
  const contextual = new Map<string, VarDecl[]>()
  const fingerprint = (span: SourceSpan) => JSON.stringify(Lexer.tokenize(source(span), span.file).tokens.filter(t => t.kind !== 'endOfFile').map(t => [t.kind, t.text]))

  function add(kind: AuthoringNode['kind'], name: string, span: SourceSpan, owner: string, parent?: MutableNode): MutableNode {
    const id = JSON.stringify([span.file, span.start, span.end, kind])
    const node: MutableNode = { id, kind, name, source: span, owner, parentId: parent?.id, fingerprint: fingerprint(span), children: [], properties: [], runtimeIds: [] }
    nodes.push(node)
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

  function property(node: MutableNode, name: string, expr: Expr | null, scope: Scope, capability?: string, reason?: string): AuthoringProperty {
    const value = expr ? classify(expr, scope, tokens, declaredNames, contextual) : { kind: 'literal' as const }
    let parent: MutableNode | undefined = node
    let repeated = false
    while (parent) { if (parent.kind === 'template') repeated = true; parent = parent.parentId ? byId.get(parent.parentId) : undefined }
    const invalid = diagnostics.some(d => d.severity === 'error' && d.span.file === node.source.file && d.span.start < node.source.end && d.span.end >= node.source.start)
    return {
      id: `${node.id}:${node.properties.length}`, name, expression: expr ? source(expr.span) : 'Implicit',
      valueKind: reason || invalid ? 'unsupported' : value.kind,
      source: expr?.span, declaration: value.declaration, ownerId: node.id,
      scope: node.kind === 'component' ? 'instance' : repeated ? 'template' : 'definition',
      capability, writable: false,
      reason: invalid ? 'Source diagnostics overlap this view. Resolve them before editing.' : reason ?? (value.kind === 'computed' ? 'Computed in Swift. Preserve the expression and edit its inputs or source.' : value.kind === 'unsupported' ? 'This expression cannot be resolved safely.' : READ_ONLY),
    }
  }

  function expression(expr: Expr, parent: MutableNode, scope: Scope, { argument = false } = {}): void {
    const chain = viewCallChain(expr)
    if (!chain) { add('opaque', 'Custom expression', expr.span, parent.owner, parent); return }
    const name = callName(chain.base.callee)
    if (!name) { add('opaque', 'Custom expression', expr.span, parent.owner, parent); return }
    const custom = definitions.get(name) ?? []
    const builtin = custom.length === 0 && SUPPORTED_VIEWS.has(name)
    const capability = builtin ? authoringCapability(name, 'view', chain.base.args.map(a => a.label)) : undefined
    const node = add(custom.length === 1 ? 'component' : name === 'ForEach' || name === 'List' && chain.base.args.length > 0 ? 'collection' : builtin ? 'view' : 'opaque', name, expr.span, parent.owner, parent)
    if (custom.length === 1) Object.assign(node, { definitionId: custom[0]!.node.id })
    // Real SwiftUI with no drawing yet, or a name the checker says the preview draws a box for (D12).
    const unknown = !custom.length && diagnostics.some(d => d.code === 'unresolved_identifier' && d.severity === 'warning' && d.span.file === expr.span.file && d.span.start === expr.span.start)
    if (!custom.length && UNIMPLEMENTED_VIEWS.has(name) || unknown) Object.assign(node, { undrawn: UNIMPLEMENTED_VIEWS.has(name) ? 'unsupported' : 'unknown' })
    if (argument) Object.assign(node, { argument: true })
    const reason = custom.length > 1 ? 'More than one matching component declaration; ownership is ambiguous.' : !custom.length && !capability ? 'This constructor overload is outside the authoring subset.' : undefined
    for (const [i, arg] of chain.base.args.entries()) {
      node.properties.push(property(node, arg.label ?? (name === 'Text' ? 'content' : `argument ${i + 1}`), arg.value, scope, capability?.id, reason))
    }
    if (reason && !builtin && !chain.base.args.length) node.properties.push(property(node, 'Source', expr, scope, undefined, reason))
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
      let ancestor: MutableNode | undefined = parent
      let origin: AuthoringProperty | undefined
      while (ancestor && !origin) { origin = [...ancestor.properties].reverse().find(p => p.name === 'font'); ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined }
      node.properties.push({ id: `${node.id}:inherited-font`, name: 'font', expression: origin?.expression ?? 'Environment / call site', valueKind: 'inherited', source: origin?.source, ownerId: origin?.ownerId ?? parent.id, scope: 'inherited', writable: false, reason: origin ? 'Inherited from an enclosing source view; it affects its descendants.' : 'No local font is declared; the environment supplies it.' })
    }
    // A syntax error takes the controls of its own file's views, not every file's: a half-typed draft elsewhere
    // is no reason to lock the design, and the planner refuses only changes to the file that does not parse.
    if (!diagnostics.some(d => d.span.file === node.source.file && (isSyntaxError(d) || d.severity === 'error' && d.span.start < node.source.end && d.span.end >= node.source.start))) {
      let ancestor: MutableNode | undefined = parent
      let template = false
      while (ancestor) { if (ancestor.kind === 'template') template = true; ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined }
      const controls = designControlRecipes(node, expr, texts.get(node.source.file) ?? '', input.deploymentTarget).map(r => ({ ...r.control, scope: template ? 'All rows in this template' : r.control.scope, description: r.control.id.startsWith('fill:') ? `${r.control.description} Parent: ${parent.name}. Hug uses natural SwiftUI sizing; shapes may stay flexible. Fill expands where the parent supplies a finite size.` : r.control.description }))
      Object.assign(node, { controls })
      node.properties = node.properties.map(property => controls.some(c => c.source.start === property.source?.start && c.source.end === property.source.end) ? { ...property, valueKind: property.valueKind === 'computed' ? 'literal' : property.valueKind, writable: true, reason: 'Editable through a validated source control.' } : property)
    }
    Object.assign(node, modifierModel(node, expr, texts.get(node.source.file) ?? '', input.deploymentTarget, !!node.controls))
    const explicitLabel = builtin && ['NavigationLink', 'Button'].includes(name) ? chain.base.args.find(argument => argument.label === 'label' && argument.value.kind === 'closure')?.value : undefined
    const closure = explicitLabel?.kind === 'closure' ? explicitLabel : chain.base.trailingClosure
    if (closure && (capability?.content || builtin && (CONTENT_VIEWS.has(name) || name === 'Button' && (!!explicitLabel || chain.base.args.some(arg => arg.label === 'action'))))) {
      if (node.kind === 'collection') {
        const template = add('template', 'Row template', closure.span, parent.owner, node)
        const locals = new Map(scope)
        const params = closure.params.length ? closure.params : [{ name: '$0', span: closure.span }]
        for (const param of params) locals.set(param.name.replace(/^\$/, ''), { kind: 'data-binding', source: param.span })
        block(closure.body, template, locals)
      } else {
        const locals = new Map(scope)
        for (const param of closure.params) locals.set(param.name.replace(/^\$/, ''), { kind: 'computed', source: param.span })
        block(closure.body, node, locals)
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
    // Section headers/footers are content slots, not repeated rows or actions.
    if (name === 'Section' && capability) for (const arg of chain.base.args) {
      if (!['header', 'footer'].includes(arg.label ?? '')) continue
      const slot = add('branch', arg.label === 'header' ? 'Header' : 'Footer', arg.value.span, parent.owner, node)
      if (arg.value.kind === 'closure') block(arg.value.body, slot, scope)
      else expression(arg.value, slot, scope, { argument: true })
    }
    // A visual slot has its own layer; action closures and scalar colors are not views,
    // and a border is a setting of the view it outlines (D8).
    const corners = cornersOf(chain.modifiers, texts.get(node.source.file) ?? '')
    for (const modifier of chain.modifiers) {
      const name = modifier.callee.kind === 'memberAccess' ? modifier.callee.member : ''
      const label = CONTENT_SLOTS[name]
      if (!label || borderOf(modifier, corners, texts.get(node.source.file) ?? '')) continue
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
        if (argument && contentName && !builtinColor && (SUPPORTED_VIEWS.has(contentName) || definitions.has(contentName))) {
          const slot = add('branch', label, argument.span, parent.owner, node)
          expression(argument, slot, scope, { argument: true })
        }
      }
    }
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
          const otherwise = add('branch', 'Otherwise', stmt.else.span, parent.owner, branch)
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

  for (const candidates of definitions.values()) for (const { decl, node } of candidates) {
    const scope = new Map<string, Binding>()
    for (const member of decl.members) {
      if (member.kind !== 'varDecl' || member.name === 'body') continue
      const wrapped = member.attributes.some(a => ['State', 'Binding', 'ObservedObject', 'StateObject', 'Environment', 'EnvironmentObject', 'Bindable'].includes(a.name))
      const memberwise = !member.accessor && !member.initializer && !member.modifiers.some(m => ['private', 'fileprivate', 'static'].includes(m.name)) && !decl.members.some(m => m.kind === 'initDecl')
      scope.set(member.name, { kind: wrapped ? 'data-binding' : memberwise ? 'component-argument' : 'computed', source: member.nameSpan })
    }
    for (const member of decl.members) {
      if (member.kind === 'varDecl' && member.name === 'body' && member.accessor) block(member.accessor, node, scope)
    }
  }
  for (const preview of previews) block(preview.body, preview.node, new Map())
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
