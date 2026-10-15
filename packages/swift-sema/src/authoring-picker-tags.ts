import type { AuthoringNode, SourceFile, SourceSpan } from '@studio/shared'
import { forEachChild, viewSiteAt, type Expr, type Node } from '@studio/swift-syntax'
import { callOf, enumCases, expressionOf, layerById, raw, type FeatureContext } from './authoring-context'
import { literalText, swiftString, viewCallChain } from './design-controls'

const isTag = (item: Node): item is Extract<Node, { kind: 'call' }> => item.kind === 'call' && item.callee.kind === 'memberAccess' && item.callee.member === 'tag' && item.args.length === 1 && item.args[0]!.label === null
/** A tag written as a number, whole or not. */
const NUMBER = /^-?\d+(?:\.\d+)?$/

/**
 * The Picker an option of which `node` is, or is in: the nearest one above it, through its
 * stacks and its ForEach's rows but not a slot, such as its label. `byId` finds a layer.
 */
export function pickerAbove(node: AuthoringNode, byId: (id: string | undefined) => AuthoringNode | undefined): AuthoringNode | undefined {
  let picker = byId(node.parentId)
  while (picker && picker.kind !== 'definition' && picker.kind !== 'branch' && !(picker.kind === 'view' && picker.name === 'Picker')) picker = byId(picker.parentId)
  return picker?.kind === 'view' && picker.name === 'Picker' ? picker : undefined
}
const pickerOf = (ctx: FeatureContext, node: AuthoringNode) => pickerAbove(node, id => layerById(ctx, id))

/** The tag of every option of `picker`, as written, in order; undefined for a view that is no Picker. */
function tagsOf(ctx: FeatureContext, picker: AuthoringNode): Expr[] | undefined {
  const content = callOf(ctx, picker)?.trailingClosure
  if (!content) return undefined
  const tags: Expr[] = []
  const collect = (item: Node) => { if (isTag(item)) tags.push(item.args[0]!.value); forEachChild(item, collect) }
  collect(content)
  return tags
}

/**
 * The tag that comes after `like` among a Picker's `tags`: the next whole number above the
 * largest, written as a decimal when `like` is one so it stays a Double (Wave 4a), `name`
 * numbered when it is taken, or a case of the enum no option has. Undefined for a tag worked
 * out in code, which only Code can follow.
 */
function following(ctx: FeatureContext, tags: readonly Expr[], like: Expr, name: string): string | undefined {
  const written = raw(ctx, like.span)
  if (NUMBER.test(written)) {
    const next = Math.floor(Math.max(...tags.map(tag => raw(ctx, tag.span)).filter(text => NUMBER.test(text)).map(Number))) + 1
    return written.includes('.') ? next.toFixed(1) : String(next)
  }
  if (literalText(like) !== undefined) {
    const used = new Set(tags.map(literalText))
    let next = name
    for (let n = 2; used.has(next); n++) next = `${name} ${n}`
    return swiftString(next)
  }
  // `.tag(.dark)` does not build, as `tag` takes any Hashable: an enum's tag names its type.
  if (like.kind === 'memberAccess' && like.base?.kind === 'identifier') {
    const type = like.base.name, cases = enumCases(ctx, type)
    if (cases?.includes(like.member)) {
      const used = new Set(tags.flatMap(tag => tag.kind === 'memberAccess' ? [tag.member] : []))
      const free = cases.find(item => !used.has(item))
      if (!free) throw new Error(`Every case of ${type} already has an option in this picker, so another would be chosen along with one of them. Add a case to ${type} in Code first.`)
      return `${type}.${free}`
    }
  }
  return undefined
}

/**
 * The tag a new option of `picker` takes (Wave 4a), following its last option's: the next
 * number, a numbered `name`, or a free case of its enum. Undefined for a Picker whose
 * options have no tags, which a new one follows. One worked out in code is refused, as a
 * new option would have no value of its own.
 */
export function nextTag(ctx: FeatureContext, picker: AuthoringNode, name: string): string | undefined {
  const tags = tagsOf(ctx, picker) ?? []
  if (!tags.length) return undefined
  const next = following(ctx, tags, tags.at(-1)!, name)
  if (!next) throw new Error(`This picker’s options are tagged in code, as ${raw(ctx, tags.at(-1)!.span)}, so a new option would have no value of its own. Add it in Code and give it a tag.`)
  return next
}

/** A tag as its Value control reads it: a number, words, or an enum's case. */
const valueOf = (ctx: FeatureContext, tag: Expr): string => NUMBER.test(raw(ctx, tag.span)) ? String(Number(raw(ctx, tag.span))) : literalText(tag) ?? (tag.kind === 'memberAccess' ? tag.member : raw(ctx, tag.span))

/** Why an option of a Picker can't take `value` as its tag, at `tag`: another option has it, and choosing one would choose both. */
export function tagProblem(ctx: FeatureContext, node: AuthoringNode, tag: SourceSpan, value: string): string | null {
  const picker = pickerOf(ctx, node), tags = picker ? tagsOf(ctx, picker) ?? [] : []
  const number = NUMBER.test(value.trim()) ? String(Number(value)) : value
  return tags.some(other => other.span.start !== tag.start && valueOf(ctx, other) === number) ? `Another option of this picker has the value ${value}, so choosing one would choose both. Give it a value of its own.` : null
}

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
  const picker = pickerOf(ctx, node)
  const tags = picker && tagsOf(ctx, picker)
  if (!tags) return copy.files
  const inside = tags.filter(tag => tag.span.start >= node.source.start && tag.span.end <= node.source.end)
  if (!inside.length) return copy.files
  const expression = expressionOf(ctx, node)
  const own = expression ? viewCallChain(expression)?.modifiers.filter(isTag).at(-1)?.args[0]?.value : undefined
  if (!own || inside.length > 1) throw new Error('The options inside this would be copied with their tags, so each copy would be chosen along with its original. Duplicate the options one at a time.')
  const written = raw(ctx, own.span)
  const next = following(ctx, tags, own, literalText(own) ?? '')
  if (!next) throw new Error(`This option’s tag, ${written}, is worked out in code, so a copy would be chosen along with it. Duplicate it in Code and give the copy its own tag.`)
  const file = ctx.files.find(f => f.id === node.source.file)!
  const site = viewSiteAt(file.text, file.id, node.source.start)
  const copied = copy.files.find(f => f.id === file.id)
  const start = site ? own.span.start - site.start + copy.offset : undefined
  if (!copied || start === undefined || copied.text.slice(start, start + written.length) !== written) throw new Error('The copy changed while it was planned. Duplicate it again.')
  return copy.files.map(f => f === copied ? { ...f, text: f.text.slice(0, start) + next + f.text.slice(start + written.length) } : f)
}
