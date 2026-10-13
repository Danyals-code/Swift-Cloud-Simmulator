import type { AuthoringNode, SourceFile } from '@studio/shared'
import { forEachChild, viewSiteAt, type Expr, type Node } from '@studio/swift-syntax'
import { callOf, expressionOf, raw, type FeatureContext } from './authoring-context'
import { enumCases } from './authoring-components'
import { swiftString, viewCallChain } from './design-controls'

const isTag = (item: Node): item is Extract<Node, { kind: 'call' }> => item.kind === 'call' && item.callee.kind === 'memberAccess' && item.callee.member === 'tag' && item.args.length === 1 && item.args[0]!.label === null
const textOf = (tag: Expr) => tag.kind === 'stringLiteral' && tag.segments.every(s => s.kind === 'text') ? tag.segments.map(s => s.kind === 'text' ? s.value : '').join('') : undefined

/**
 * A duplicated Picker option, given a tag of its own (doc 18, Fix first 6).
 *
 * A Picker selects the option whose tag is the selection, so a copy that kept its
 * original's tag is selected along with it, and choosing it chooses the original. An Int
 * takes the next number, a String a numbered name and an enum a case no other option
 * uses; with no case left, or a tag worked out in code, the copy is refused. Adding a case
 * to an enum could break a `switch` elsewhere, so that stays in Code. A view that is not
 * an option of a Picker is left exactly as copied.
 *
 * `copy` is the duplicate as written, checked already: it is the original's text at `offset`.
 */
export function retagDuplicate(ctx: FeatureContext, node: AuthoringNode, copy: { readonly files: readonly SourceFile[]; readonly offset: number }): readonly SourceFile[] {
  const byId = (id?: string) => ctx.nodes.find(n => n.id === id)
  let picker = byId(node.parentId)
  while (picker && picker.kind !== 'definition' && !(picker.kind === 'view' && picker.name === 'Picker')) picker = byId(picker.parentId)
  const content = picker?.kind === 'view' ? callOf(ctx, picker)?.trailingClosure : undefined
  if (!picker || !content) return copy.files
  const tags: Expr[] = []
  const collect = (item: Node) => { if (isTag(item)) tags.push(item.args[0]!.value); forEachChild(item, collect) }
  collect(content)
  const inside = tags.filter(tag => tag.span.start >= node.source.start && tag.span.end <= node.source.end)
  if (!inside.length) return copy.files
  const expression = expressionOf(ctx, node)
  const own = expression ? viewCallChain(expression)?.modifiers.filter(isTag).at(-1)?.args[0]?.value : undefined
  if (!own || inside.length > 1) throw new Error('The options inside this would be copied with their tags, so each copy would be chosen along with its original. Duplicate the options one at a time.')
  const written = raw(ctx, own.span)
  let next: string | undefined
  if (/^-?\d+$/.test(written)) next = String(Math.max(...tags.map(tag => raw(ctx, tag.span)).filter(text => /^-?\d+$/.test(text)).map(Number)) + 1)
  const name = textOf(own)
  if (name !== undefined) {
    const used = new Set(tags.map(textOf))
    let n = 2
    while (used.has(`${name} ${n}`)) n++
    next = swiftString(`${name} ${n}`)
  }
  // `.tag(.dark)` does not build, as `tag` takes any Hashable: an enum's tag names its type.
  if (own.kind === 'memberAccess' && own.base?.kind === 'identifier') {
    const type = own.base.name, cases = enumCases(ctx, type)
    if (cases?.includes(own.member)) {
      const used = new Set(tags.flatMap(tag => tag.kind === 'memberAccess' ? [tag.member] : []))
      const free = cases.find(item => !used.has(item))
      if (!free) throw new Error(`Every case of ${type} already has an option in this picker, so a copy would be chosen along with one of them. Add a case to ${type} in Code, then duplicate.`)
      next = `${type}.${free}`
    }
  }
  if (!next) throw new Error(`This option’s tag, ${written}, is worked out in code, so a copy would be chosen along with it. Duplicate it in Code and give the copy its own tag.`)
  const file = ctx.files.find(f => f.id === node.source.file)!
  const site = viewSiteAt(file.text, file.id, node.source.start)
  const copied = copy.files.find(f => f.id === file.id)
  const start = site ? own.span.start - site.start + copy.offset : undefined
  if (!copied || start === undefined || copied.text.slice(start, start + written.length) !== written) throw new Error('The copy changed while it was planned. Duplicate it again.')
  return copy.files.map(f => f === copied ? { ...f, text: f.text.slice(0, start) + next + f.text.slice(start + written.length) } : f)
}

