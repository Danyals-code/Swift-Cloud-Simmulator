import type { AuthoringNode, AuthoringOperation } from '@studio/shared'
import { Lexer, Parser } from '@studio/swift-syntax'
import { buildAuthoringModel } from './authoring'
import { Checker } from './checker'
import { configureAction } from './authoring-behavior'
import { emptyComponents } from './authoring-components'
import { allDeclarations, applyPatches, callOf, identifier, insertMember, namedStruct, ownerOf, patch, raw, shadowsMember, swiftValue, type FeatureContext, type SourcePatch } from './authoring-context'

type ScreenOperation = Extract<AuthoringOperation, { kind: 'screen-create' | 'screen-duplicate' | 'screen-remove' }>
export function screenPatches(ctx: FeatureContext, node: AuthoringNode, operation: ScreenOperation): SourcePatch[] {
  const file = ctx.files.find(f => f.id === node.source.file)!
  if (operation.kind !== 'screen-remove' && (!identifier(operation.name) || allDeclarations(ctx).some(d => 'name' in d && d.name === operation.name))) throw new Error('Choose a unique screen name.')
  if (operation.kind === 'screen-create') {
    if (!['VStack', 'HStack', 'ZStack'].includes(operation.layout) || !operation.title.trim() || operation.title.length > 100) throw new Error('Enter a screen name of 1–100 characters and choose its layout.')
    const container = operation.layout === 'ZStack' ? 'ZStack(alignment: .center)' : `${operation.layout}(spacing: 16)`
    const text = `\n\nstruct ${operation.name}: View {\n    var body: some View {\n        ${container} {\n            Text(${swiftValue(operation.title)})\n                .font(.title)\n        }\n        .padding(24)\n        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)\n        .background(Color(.systemBackground))\n        .navigationTitle(${swiftValue(operation.title)})\n    }\n}\n`
    return [{ file: file.id, start: file.text.length, end: file.text.length, text }]
  }
  const owner = namedStruct(ctx, node.name)
  if (node.kind !== 'definition' || !owner || !emptyComponents(ctx).includes(owner.name)) throw new Error('Select a screen with a standalone view definition.')
  if (operation.kind === 'screen-duplicate') {
    const text = raw(ctx, owner.span)
    const start = owner.nameSpan.start - owner.span.start, end = owner.nameSpan.end - owner.span.start
    return [{ file: file.id, start: file.text.length, end: file.text.length, text: '\n\n' + text.slice(0, start) + operation.name + text.slice(end) + '\n' }]
  }
  const references = ctx.files.flatMap(f => Lexer.tokenize(f.text, f.id).tokens.filter(t => t.kind === 'identifier' && t.text === owner.name && !(f.id === owner.span.file && t.span.start >= owner.span.start && t.span.end <= owner.span.end)))
  if (references.length) throw new Error('This screen is used by the app or another screen. Change its incoming destinations before removing it.')
  return [patch(owner.span, '')]
}

/** Prepare destinations, values and navigation context as one validated document edit. */
export function guidedAction(ctx: FeatureContext, node: AuthoringNode, operation: Extract<AuthoringOperation, { kind: 'guided-action' }>) {
  let files = [...ctx.files], current = node, context = ctx
  const apply = (patches: SourcePatch[]) => {
    const offset = current.source.start + patches.filter(p => p.file === current.source.file && p.end <= current.source.start).reduce((n, p) => n + p.text.length - (p.end - p.start), 0)
    files = applyPatches(context, patches)
    const ast = files.map(f => Parser.parse(f.text, f.id).sourceFile)
    const snapshot = buildAuthoringModel({ files, parsed: ast, diagnostics: Checker.check(ast).diagnostics, projectId: '', revision: 0, deploymentTarget: ctx.deploymentTarget })
    const found = snapshot.nodes.find(n => n.source.file === current.source.file && n.source.start === offset && n.kind !== 'definition')
    if (!found) throw new Error('The selected button could not be preserved. No changes were made.')
    current = found; context = { ...ctx, files, ast, nodes: snapshot.nodes }
  }
  if (operation.createScreen) {
    if (!['navigate', 'sheet'].includes(operation.action.type) || !('destination' in operation.action) || operation.action.destination !== operation.createScreen.name) throw new Error('The new screen must match the action destination.')
    apply(screenPatches(context, current, { kind: 'screen-create', ...operation.createScreen, layout: 'VStack' }))
  }
  if (operation.createValue) {
    const { name, value } = operation.createValue, owner = ownerOf(context, current)
    if (!owner || !identifier(name) || shadowsMember(context, current, name) || owner.members.some(m => 'name' in m && m.name === name)) throw new Error('Choose an unused value name, using letters and numbers.')
    if (!['toggle', 'set'].includes(operation.action.type) || !('state' in operation.action) || operation.action.state !== name || value === null || typeof value === 'number' && !Number.isFinite(value)) throw new Error('Choose a valid initial value for this action.')
    const type = typeof value === 'boolean' ? 'Bool' : typeof value === 'number' ? 'Double' : 'String'
    apply([insertMember(context, owner, `@State private var ${name}: ${type} = ${swiftValue(value)}`)])
  }
  if (operation.action.type === 'navigate') {
    let ancestor: AuthoringNode | undefined = current, root = current, hasNavigation = false
    while (ancestor && ancestor.kind !== 'definition') {
      if (['NavigationStack', 'NavigationView'].includes(ancestor.name)) hasNavigation = true
      root = ancestor; ancestor = context.nodes.find(n => n.id === ancestor!.parentId)
    }
    if (!hasNavigation) {
      if (root.kind !== 'view' || Number.parseFloat(ctx.deploymentTarget ?? '17.0') < 16) throw new Error('This screen needs a navigation container. Choose iOS 16 or newer in Device settings.')
      // Insert at either boundary so the selected node remains identifiable.
      apply([{ file: root.source.file, start: root.source.start, end: root.source.start, text: 'NavigationStack {\n' }, { file: root.source.file, start: root.source.end, end: root.source.end, text: '\n}' }])
    }
  }
  const patches = configureAction(context, current, operation.action, operation.replace)
  if (operation.createValue?.activeTitle !== undefined) {
    const title = callOf(context, current)?.args[0]?.value
    if (typeof operation.createValue.value !== 'boolean' || !title || title.kind !== 'stringLiteral') throw new Error('A selected label needs a switch value and a plain text button title.')
    patches.push(patch(title.span, `${operation.createValue.name} ? ${swiftValue(operation.createValue.activeTitle)} : ${raw(context, title.span)}`))
  }
  return { files: applyPatches(context, patches), offset: current.source.start + patches.filter(p => p.file === current.source.file && p.end <= current.source.start).reduce((n, p) => n + p.text.length - (p.end - p.start), 0) }
}
