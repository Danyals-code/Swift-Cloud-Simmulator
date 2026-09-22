import type { AuthoringNode, AuthoringOperation, DesignValue, SourceFile, SourceSpan } from '@studio/shared'
import { afterOffMarkers, forEachChild, Lexer, Parser, type Node } from '@studio/swift-syntax'
import { buildAuthoringModel } from './authoring'
import { Checker } from './checker'
import { configureAction } from './authoring-behavior'
import { emptyComponents } from './authoring-components'
import { allDeclarations, applyPatches, callOf, identifier, insertMember, namedStruct, ownerOf, patch, raw, shadowsMember, shapedProject, sourceRoot, swiftValue, type FeatureContext, type SourcePatch } from './authoring-context'

type ScreenOperation = Extract<AuthoringOperation, { kind: 'screen-create' | 'screen-duplicate' | 'screen-remove' }>

/** Where a screen's own file goes in a project that follows the shape. */
export const screenFile = (ctx: FeatureContext, name: string) => `${sourceRoot(ctx)}Features/${name.replace(/Screen$/, '') || name}/${name}.swift`

export function screenPatches(ctx: FeatureContext, node: AuthoringNode, operation: ScreenOperation): SourcePatch[] {
  return screenEdit(ctx, node, operation).patches
}

/**
 * Creating, copying and removing a screen.
 *
 * In a project that follows the shape, a screen is a file under `Features/`, with a
 * `#Preview` so it opens on its own in Xcode. In an imported project it is appended
 * to the file the designer is already in, because moving somebody else's code
 * around is not this tool's business.
 */
export function screenEdit(ctx: FeatureContext, node: AuthoringNode, operation: ScreenOperation): { patches: SourcePatch[]; files?: SourceFile[]; removed?: string[] } {
  const file = ctx.files.find(f => f.id === node.source.file)!
  if (operation.kind !== 'screen-remove' && (!identifier(operation.name) || allDeclarations(ctx).some(d => 'name' in d && d.name === operation.name))) throw new Error('Choose a unique screen name.')
  if (operation.kind === 'screen-create') {
    if (!['VStack', 'HStack', 'ZStack'].includes(operation.layout) || !operation.title.trim() || operation.title.length > 100) throw new Error('Enter a screen name of 1–100 characters and choose its layout.')
    const container = operation.layout === 'ZStack' ? 'ZStack(alignment: .center)' : `${operation.layout}(spacing: 16)`
    const text = `\n\nstruct ${operation.name}: View {\n    var body: some View {\n        ${container} {\n            Text(${swiftValue(operation.title)})\n                .font(.title)\n        }\n        .padding(24)\n        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)\n        .background(Color(.systemBackground))\n        .navigationTitle(${swiftValue(operation.title)})\n    }\n}\n`
    if (shapedProject(ctx)) {
      const id = screenFile(ctx, operation.name)
      if (ctx.files.some(existing => existing.id === id)) throw new Error('A screen file with that name already exists.')
      return { patches: [], files: [{ id, text: `import SwiftUI${text}\n#Preview {\n    ${operation.name}()\n}\n` }] }
    }
    return { patches: [{ file: file.id, start: file.text.length, end: file.text.length, text }] }
  }
  const owner = namedStruct(ctx, node.name)
  if (node.kind !== 'definition' || !owner || !emptyComponents(ctx).includes(owner.name)) throw new Error('Select a screen with a standalone view definition.')
  if (operation.kind === 'screen-duplicate') {
    const text = raw(ctx, owner.span)
    const start = owner.nameSpan.start - owner.span.start, end = owner.nameSpan.end - owner.span.start
    const copied = text.slice(0, start) + operation.name + text.slice(end)
    // A file-private declaration or extension may be used indirectly by the view.
    // Keep the duplicate in that lexical file instead of widening access or copying
    // shared state. Additional imports are retained by the same fallback.
    const sourceFile = ctx.ast.find(ast => ast.span.file === owner.span.file)
    let fileScoped = false
    const inspect = (item: Node) => {
      if (item.span.start >= owner.span.start && item.span.end <= owner.span.end) return
      if ('modifiers' in item && Array.isArray(item.modifiers) && item.modifiers.some(m => m.name === 'private' || m.name === 'fileprivate')) fileScoped = true
      if (item.kind === 'importDecl' && raw(ctx, item.span).trim() !== 'import SwiftUI') fileScoped = true
      forEachChild(item, inspect)
    }
    if (sourceFile) inspect(sourceFile)
    if (shapedProject(ctx) && !fileScoped) {
      const id = screenFile(ctx, operation.name)
      if (ctx.files.some(existing => existing.id === id)) throw new Error('A screen file with that name already exists.')
      return { patches: [], files: [{ id, text: `import SwiftUI\n\n${copied}\n\n#Preview {\n    ${operation.name}()\n}\n` }] }
    }
    return { patches: [{ file: file.id, start: file.text.length, end: file.text.length, text: '\n\n' + copied + '\n' }] }
  }
  const references = ctx.files.flatMap(f => Lexer.tokenize(f.text, f.id).tokens.filter(t => t.kind === 'identifier' && t.text === owner.name && !(f.id === owner.span.file && t.span.start >= owner.span.start && t.span.end <= owner.span.end)))
  // A `#Preview` that only shows this screen goes with it rather than being left
  // behind as code that no longer compiles.
  const previews = ownPreviews(ctx, owner.name)
  const inPreview = (reference: { span: SourceSpan }) => previews.some(preview => preview.file === reference.span.file && reference.span.start >= preview.start && reference.span.end <= preview.end)
  const outside = references.filter(reference => !inPreview(reference))
  if (outside.length) throw new Error('This screen is used by the app or another screen. Change its incoming destinations before removing it.')
  const patches = [patch(owner.span, ''), ...previews.map(preview => ({ ...preview, text: '' }))]
  // A screen that had its own file leaves no empty file behind.
  const after = applyPatches(ctx, patches)
  const removed = ctx.files.filter(file => {
    if (!patches.some(item => item.file === file.id)) return false
    const left = after.find(item => item.id === file.id)?.text ?? ''
    return !left.replace(/import\s+\w+|\s+/g, '')
  }).map(file => file.id)
  return { patches, ...(removed.length ? { removed } : {}) }
}

/**
 * The `#Preview` blocks that show this view and nothing else of the project's.
 *
 * Read from the parsed source rather than matched with a pattern: a preview that
 * wraps the screen in a `NavigationStack`, or one with a name of its own, is still
 * this screen's preview, and one that also builds another view is not.
 */
function ownPreviews(ctx: FeatureContext, name: string): { file: string; start: number; end: number }[] {
  const others = new Set(allDeclarations(ctx).filter(d => 'name' in d && d.name !== name).map(d => (d as { name: string }).name))
  const found: { file: string; start: number; end: number }[] = []
  for (const file of ctx.ast) {
    for (const decl of file.declarations) {
      if (decl.kind !== 'macroDecl' || decl.name !== 'Preview') continue
      let shows = false, showsOther = false
      const visit = (node: Node) => {
        if (node.kind === 'identifier') {
          if (node.name === name) shows = true
          else if (others.has(node.name)) showsOther = true
        }
        forEachChild(node, visit)
      }
      forEachChild(decl, visit)
      if (!shows || showsOther) continue
      const text = ctx.files.find(item => item.id === decl.span.file)?.text ?? ''
      found.push({ file: decl.span.file, start: text.lastIndexOf('\n', decl.span.start - 1) + 1, end: decl.span.end })
    }
  }
  return found
}

/**
 * A value the screen can be in more than one of.
 *
 * States switch a screen's values, so a screen with none cannot have states. This
 * writes the one line that fixes that - `@State private var loading = false` - on
 * the screen itself, which is where a designer is standing when they need it.
 */
export function createScreenValue(ctx: FeatureContext, node: AuthoringNode, name: string, value: DesignValue): SourcePatch[] {
  const owner = node.kind === 'definition' ? namedStruct(ctx, node.name) : ownerOf(ctx, node)
  if (!owner) throw new Error('Select a screen first.')
  if (!identifier(name) || name.length > 40) throw new Error('Use a value name of letters and numbers, starting with a letter.')
  if (owner.members.some(member => 'name' in member && member.name === name) || shadowsMember(ctx, node, name)) throw new Error(`This screen already has something called “${name}”.`)
  if (value === null || typeof value === 'number' && !Number.isFinite(value)) throw new Error('Choose what this value starts as.')
  const type = typeof value === 'boolean' ? 'Bool' : typeof value === 'number' ? 'Double' : 'String'
  return [insertMember(ctx, owner, `@State private var ${name}: ${type} = ${swiftValue(value)}`)]
}

/** Prepare destinations, values and navigation context as one validated document edit. */
export function guidedAction(ctx: FeatureContext, node: AuthoringNode, operation: Extract<AuthoringOperation, { kind: 'guided-action' }>) {
  let files = [...ctx.files], current = node, context = ctx
  const apply = (patches: SourcePatch[], created: readonly SourceFile[] = []) => {
    const offset = current.source.start + patches.filter(p => p.file === current.source.file && p.end <= current.source.start).reduce((n, p) => n + p.text.length - (p.end - p.start), 0)
    files = applyPatches(context, patches, created)
    const ast = files.map(f => Parser.parse(f.text, f.id).sourceFile)
    const snapshot = buildAuthoringModel({ files, parsed: ast, diagnostics: Checker.check(ast).diagnostics, projectId: '', revision: 0, deploymentTarget: ctx.deploymentTarget })
    const found = snapshot.nodes.find(n => n.source.file === current.source.file && n.source.start === offset && n.kind !== 'definition')
    if (!found) throw new Error('The selected button could not be preserved. No changes were made.')
    current = found; context = { ...ctx, files, ast, nodes: snapshot.nodes }
  }
  if (operation.createScreen) {
    if (!['navigate', 'sheet', 'cover'].includes(operation.action.type) || !('destination' in operation.action) || operation.action.destination !== operation.createScreen.name) throw new Error('The new screen must match the action destination.')
    const created = screenEdit(context, current, { kind: 'screen-create', ...operation.createScreen, layout: 'VStack' })
    apply(created.patches, created.files ?? [])
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
      if (root.kind !== 'view' || Number.parseFloat(ctx.deploymentTarget ?? '17.0') < 16) throw new Error('This screen needs a navigation container, which this project’s iOS version is too old for. Ask a developer to raise it to iOS 16 or newer.')
      // Insert at either boundary so the selected node remains identifiable. A modifier
      // switched off at the end of the root's chain is written after it, and goes inside with it.
      const end = afterOffMarkers(context.files.find(f => f.id === root.source.file)?.text ?? '', root.source.end)
      apply([{ file: root.source.file, start: root.source.start, end: root.source.start, text: 'NavigationStack {\n' }, { file: root.source.file, start: end, end, text: '\n}' }])
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
