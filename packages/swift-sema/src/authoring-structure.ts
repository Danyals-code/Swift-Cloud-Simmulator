import { layerMoveProblem, type AuthoringNode, type AuthoringOperation } from '@studio/shared'
import { forEachChild, insertView, viewSiteAt, type Node } from '@studio/swift-syntax'
import { applyPatches, callOf, type FeatureContext } from './authoring-context'

type StructureOperation = Extract<AuthoringOperation, { kind: 'layer-duplicate' | 'layer-wrap' | 'layer-reparent' }>
const structural = (node: AuthoringNode) => ['view', 'component', 'collection'].includes(node.kind) && node.name !== 'WindowGroup'
export function structureEdit(ctx: FeatureContext, node: AuthoringNode, operation: StructureOperation) {
  const file = ctx.files.find(f => f.id === node.source.file)!
  const site = viewSiteAt(file.text, file.id, node.source.start)
  if (!structural(node) || !site) throw new Error('Select a visual layer in a screen.')
  const eol = file.text.includes('\r\n') ? '\r\n' : '\n'
  if (operation.kind === 'layer-duplicate') {
    if (!site.inContent && site.siblings === 1) throw new Error('Wrap this screen’s root in a Column or Row before duplicating it.')
    const text = eol + site.indent + file.text.slice(site.start, site.end)
    return { files: applyPatches(ctx, [{ file: file.id, start: site.end, end: site.end, text }]), offset: site.end + eol.length + site.indent.length }
  }
  const selected = operation.ids.map(id => ctx.nodes.find(n => n.id === id)).filter((n): n is AuthoringNode => !!n).sort((a, b) => a.source.start - b.source.start)
  if (!selected.length || selected.length !== new Set(operation.ids).size || selected.some(n => !structural(n) || n.parentId !== node.parentId || n.owner !== node.owner || n.source.file !== file.id)) throw new Error('Select layers with the same parent. Nested and repeated row designs are edited separately.')
  const sites = selected.map(n => viewSiteAt(file.text, file.id, n.source.start)!)
  if (sites.some((s, i) => !s || i > 0 && s.index !== sites[i - 1]!.index + 1)) throw new Error('Select adjacent layers to keep their layout order predictable.')
  const first = sites[0]!, last = sites.at(-1)!
  const original = file.text.slice(first.start, last.end)
  if (operation.kind === 'layer-wrap') {
    if (!['VStack', 'HStack', 'ZStack'].includes(operation.layout)) throw new Error('Choose Column, Row or Stack.')
    const constructor = operation.layout === 'ZStack' ? 'ZStack' : `${operation.layout}(spacing: 16)`
    const text = `${constructor} {${eol}${first.indent}    ${original.replaceAll(eol, eol + '    ')}${eol}${first.indent}}`
    return { files: applyPatches(ctx, [{ file: file.id, start: first.start, end: last.end, text }]), offset: first.start }
  }
  const destination = ctx.nodes.find(n => n.id === operation.destination)
  if (!destination || !callOf(ctx, destination)?.trailingClosure) throw new Error('Choose a layout container on this screen.')
  const problem = layerMoveProblem(ctx.nodes, operation.ids, destination)
  if (problem) throw new Error(problem)
  // The same identifier can name different local values in two containers.
  // A valid parse alone would not catch that silent change in meaning.
  const localsAt = (offset: number) => {
    const locals = new Map<string, number>()
    const visit = (item: Node) => {
      if (item.span.file !== file.id || item.span.start > offset || item.span.end < offset) return
      if (item.kind === 'block') for (const statement of item.statements) {
        if (statement.kind === 'declStmt' && statement.declaration.kind === 'varDecl' && statement.span.start < offset) locals.set(statement.declaration.name, statement.declaration.span.start)
      }
      forEachChild(item, visit)
    }
    ctx.ast.forEach(visit); return locals
  }
  const fromLocals = localsAt(node.source.start), toLocals = localsAt(callOf(ctx, destination)!.trailingClosure!.body.span.end - 1)
  const identifiers = new Set<string>()
  const collect = (item: Node) => {
    if (item.span.file !== file.id || item.span.end < first.start || item.span.start > last.end) return
    if (item.kind === 'identifier' && item.span.start >= first.start && item.span.end <= last.end) identifiers.add(item.name.replace(/^\$/, ''))
    forEachChild(item, collect)
  }
  ctx.ast.forEach(collect)
  if ([...identifiers].some(name => fromLocals.get(name) !== toLocals.get(name))) throw new Error('This move would change a local value used by the layer. Keep it with its current value or move the whole container.')
  if (sites.some(s => !s.inContent && sites.length === s.siblings)) throw new Error('The screen must keep its root layout.')
  const start = first.cutStart, end = last.cutEnd
  const remaining = file.text.slice(0, start) + file.text.slice(end)
  const target = destination.source.start - (destination.source.start >= end ? end - start : 0)
  const inserted = insertView(remaining, file.id, target, original.replaceAll(eol + first.indent, eol))
  if (!inserted) throw new Error('This container cannot receive the selected layers.')
  return { files: ctx.files.map(f => f.id === file.id ? { ...f, text: inserted.text } : f), offset: inserted.offset }
}
