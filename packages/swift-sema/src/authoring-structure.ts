import { groupLayoutOf, isStructuralLayer, layerMoveProblem, layoutParentOf, stackLayoutOf, tappableProblem, unwrapProblem, wrapProblem, type AuthoringNode, type AuthoringOperation, type ContainerLayout, type SourceFile } from '@studio/shared'
import { forEachChild, insertView, unwrapView, viewSiteAt, UNWRAP_REFUSAL, type Node } from '@studio/swift-syntax'
import { applyPatches, callOf, raw, type FeatureContext, type SourcePatch } from './authoring-context'

type StructureOperation = Extract<AuthoringOperation, { kind: 'layer-duplicate' | 'layer-wrap' | 'layer-reparent' }>

/**
 * The stack Wrap writes around the selected layers, before its `{`. Grouped the way they
 * already sit (a column in a column, or in a scroll view that scrolls up and down), it
 * takes the parent's alignment and spacing, so nothing moves (D3). Stacked another way,
 * it keeps the gap they had, the parent's spacing, and no alignment, which runs across
 * the other axis; with no spacing written there, it writes none either. A List or a Form
 * takes the views as its rows, with nothing of the stack's (Wave 4c).
 */
export function wrapperOf(ctx: FeatureContext, node: AuthoringNode, layout: ContainerLayout): string {
  if (!stackLayoutOf(layout)) return layout
  // A scroll view or a list sets no spacing or alignment of its own to take.
  const parent = layoutParentOf(ctx.nodes, node)
  const call = parent && stackLayoutOf(parent.name) ? callOf(ctx, parent) : undefined
  const along = groupLayoutOf(ctx.nodes, node) === layout
  const kept = layout === 'ZStack' && !along ? [] : call?.args.filter(arg => arg.label === 'spacing' || along && arg.label === 'alignment').map(arg => raw(ctx, arg.span)) ?? []
  return kept.length ? `${layout}(${kept.join(', ')})` : layout
}

/**
 * Everything Wrap writes around the selected layers, outermost first, each before its `{`
 * (Wave 4c). A Scroll holding several views holds them in the stack they sit in, so they
 * keep their gap and alignment, and scrolls across when that stack is a row.
 */
export function wrappersOf(ctx: FeatureContext, node: AuthoringNode, layout: ContainerLayout, several: boolean): string[] {
  if (layout !== 'ScrollView') return [wrapperOf(ctx, node, layout)]
  const inner = groupLayoutOf(ctx.nodes, node)
  const scroll = inner === 'HStack' ? 'ScrollView(.horizontal)' : 'ScrollView'
  return several ? [scroll, wrapperOf(ctx, node, inner)] : [scroll]
}

export function structureEdit(ctx: FeatureContext, node: AuthoringNode, operation: StructureOperation) {
  const file = ctx.files.find(f => f.id === node.source.file)!
  const site = viewSiteAt(file.text, file.id, node.source.start)
  if (!isStructuralLayer(node) || !site) throw new Error('Select a visual layer in a screen.')
  const eol = file.text.includes('\r\n') ? '\r\n' : '\n'
  if (operation.kind === 'layer-duplicate') {
    if (!site.inContent && site.siblings === 1) throw new Error('Wrap this screen’s root in a Column or Row before duplicating it.')
    const text = eol + site.indent + file.text.slice(site.start, site.end)
    return { files: applyPatches(ctx, [{ file: file.id, start: site.end, end: site.end, text }]), offset: site.end + eol.length + site.indent.length }
  }
  const selected = operation.ids.map(id => ctx.nodes.find(n => n.id === id)).filter((n): n is AuthoringNode => !!n).sort((a, b) => a.source.start - b.source.start)
  if (!selected.length || selected.length !== new Set(operation.ids).size || selected.some(n => !isStructuralLayer(n) || n.parentId !== node.parentId || n.owner !== node.owner || n.source.file !== file.id)) throw new Error('Select layers with the same parent. Nested and repeated row designs are edited separately.')
  const sites = selected.map(n => viewSiteAt(file.text, file.id, n.source.start)!)
  if (sites.some((s, i) => !s || i > 0 && s.index !== sites[i - 1]!.index + 1)) throw new Error('Select adjacent layers to keep their layout order predictable.')
  const first = sites[0]!, last = sites.at(-1)!
  const original = file.text.slice(first.start, last.end)
  if (operation.kind === 'layer-wrap') {
    // The Layers menu's own check (Wave 4c).
    const problem = wrapProblem(ctx.nodes, operation.ids, operation.layout)
    if (problem) throw new Error(problem)
    const heads = wrappersOf(ctx, node, operation.layout, selected.length > 1)
    // Each wrapper one step further in, and the views inside the innermost.
    const nest = (depth: number): string => `${heads[depth]} {${eol}${first.indent}${'    '.repeat(depth + 1)}${depth + 1 < heads.length ? nest(depth + 1) : original.replaceAll(eol, eol + '    '.repeat(depth + 1))}${eol}${first.indent}${'    '.repeat(depth)}}`
    const text = nest(0)
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

/**
 * Puts a container's views in its place (Wave 4c), when `unwrapProblem` says it can. Gives
 * what goes with the container besides its views, for the structural check to hold it to.
 */
export function unwrapEdit(ctx: FeatureContext, node: AuthoringNode): { files: SourceFile[]; offset: number; removes: string } {
  const problem = unwrapProblem(ctx.nodes, node)
  if (problem) throw new Error(problem)
  const file = ctx.files.find(f => f.id === node.source.file)!, call = callOf(ctx, node)
  let refusal = UNWRAP_REFUSAL
  const unwrapped = call?.trailingClosure && unwrapView(file.text, file.id, node.source.start, reason => { refusal = reason })
  if (!unwrapped) throw new Error(refusal)
  return { files: ctx.files.map(f => f.id === file.id ? { ...f, text: unwrapped.text } : f), offset: unwrapped.offset, removes: `${file.text.slice(call.span.start, call.trailingClosure.span.start)}{ }` }
}

/** What making a view tappable writes around it, less the view: the checker's word for what it may add (D16). */
export const TAPPABLE_WRAPPER = 'Button { } label: { } .buttonStyle(.plain)'

/**
 * Makes a view tappable (D16): a Button whose label is the view, as SwiftUI writes a
 * tappable card, with the plain style that keeps the look it had. The action starts
 * empty, and When tapped says what it does.
 */
export function makeTappable(ctx: FeatureContext, node: AuthoringNode) {
  const wrap = tappablePatch(ctx, node)
  return { files: applyPatches(ctx, [wrap]), offset: wrap.start }
}

/** The Button making a view tappable writes, in place of the view, which it keeps as its label. */
export function tappablePatch(ctx: FeatureContext, node: AuthoringNode): SourcePatch {
  const problem = tappableProblem(ctx.nodes, node)
  if (problem) throw new Error(problem)
  const file = ctx.files.find(f => f.id === node.source.file)!
  const site = viewSiteAt(file.text, file.id, node.source.start)
  if (!site) throw new Error('Select a visual layer in a screen.')
  const eol = file.text.includes('\r\n') ? '\r\n' : '\n'
  const unit = site.indent.includes('\t') ? '\t' : '    '
  const view = file.text.slice(site.start, site.end).replaceAll(eol, eol + unit)
  return { file: file.id, start: site.start, end: site.end, text: `Button {${eol}${site.indent}} label: {${eol}${site.indent}${unit}${view}${eol}${site.indent}}${eol}${site.indent}.buttonStyle(.plain)` }
}
