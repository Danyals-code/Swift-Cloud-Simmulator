import type { FileId } from '@studio/shared'
import { Lexer, Parser, afterOffMarkers, hiddenViewsIn, viewSiteAt, walk, type CallExpr, type Decl, type Node, type SourceFileNode, type TypeRef } from '@studio/swift-syntax'

/**
 * The last check a structural change passes before it is kept.
 *
 * The planner used to accept any result that parsed without new checker errors, and
 * that is how a hidden view deleted by Add, a card deleted with its outline and a title
 * moved into `#Preview` were all kept: each one parsed. This compares the file before
 * and after, knowing only what the change was asked to do - not how it was worked out -
 * so it catches the bug in whichever writer has it, including the next one:
 *
 * - nothing outside the view goes, comes or moves, except what the change is about;
 * - the view lands in the declaration and the container it was sent to;
 * - no helper that holds one view is given a second, and no view is left with nothing
 *   to show, unless it already was.
 */

export type StructuralKind = 'delete' | 'hide' | 'show' | 'insert' | 'move' | 'moveTo' | 'duplicate' | 'wrap' | 'reparent' | 'restructure'

export interface StructuralEdit {
  readonly file: FileId
  readonly before: string
  readonly after: string
  /** What was asked for. `restructure` is a feature's own rewrite, of which only what it leaves behind is checked. */
  readonly kind: StructuralKind
  /** The selected views' source in `before`: one view, or several adjacent ones. */
  readonly view: { readonly start: number; readonly end: number }
  /** Swift the change brings besides the view: an inserted snippet, or the stack a wrap puts around it. */
  readonly adds?: string
  /** Where the view was sent, in `before`: a drop target or a destination. The view itself when omitted. */
  readonly toward?: number
  /** Whether the view goes inside `toward`, as its last child, rather than beside it. An insert works it out. */
  readonly inside?: boolean
  /** Where the view starts in `after`, for a change that keeps it. */
  readonly landed?: number
}

const LOST = 'This change would also remove other parts of the file, such as a hidden view or a note. Nothing was changed.'
const EXTRA = 'This change would add more than it was meant to. Nothing was changed.'
const ELSEWHERE = 'This change would put the view somewhere other than where it was dropped. Nothing was changed.'

/** What went wrong with a structural change, in words a designer can act on, or null when it did what it said. */
export function structuralEditProblem(edit: StructuralEdit): string | null {
  const beforeTree = Parser.parse(edit.before, edit.file).sourceFile
  const afterTree = Parser.parse(edit.after, edit.file).sourceFile
  if (edit.kind !== 'restructure') {
    const content = contentProblem(edit)
    if (content) return content
    if (edit.landed !== undefined && placeOf(afterTree, edit.landed) !== expectedPlace(edit, beforeTree)) return ELSEWHERE
  }
  const old = new Set(holderProblems(beforeTree).map(problem => problem.key))
  return holderProblems(afterTree).find(problem => !old.has(problem.key))?.message ?? null
}

interface Atom { readonly text: string; readonly start: number }

/**
 * Everything in a stretch of Swift that a change could lose, gain or move, in order:
 * each token and each comment - a hidden view is a run of comments, a switched-off
 * modifier is one. Whitespace is not in it, and a comment or string written over
 * several lines is compared with its whitespace collapsed, so re-indenting what moved
 * is no difference. Neither is `;`: a view that leaves a shared line takes one with it.
 */
function atoms(text: string, file: FileId): Atom[] {
  const out: Atom[] = []
  let cursor = 0
  for (const token of Lexer.tokenize(text, file).tokens) {
    for (const comment of text.slice(cursor, token.span.start).matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)) {
      out.push({ text: `comment ${comment[0].trim().replace(/\s+/g, ' ')}`, start: cursor + comment.index! })
    }
    if (token.kind !== 'endOfFile' && token.text !== ';') out.push({ text: token.kind === 'stringLiteral' ? token.text.replace(/\s+/g, ' ') : token.text, start: token.span.start })
    cursor = token.span.end
  }
  return out
}

function contentProblem(edit: StructuralEdit): string | null {
  const { file, kind } = edit
  const was = atoms(edit.before, file), now = atoms(edit.after, file)
  const [start, end] = viewExtent(edit)
  const view = was.filter(atom => atom.start >= start && atom.start < end)

  if (kind === 'delete') return same(was.filter(atom => !view.includes(atom)), now) ? null : LOST
  if (kind === 'insert' || kind === 'duplicate' || kind === 'move' || kind === 'moveTo' || kind === 'reparent') {
    // One run of text is added, copied or moved; everything else stays, in order.
    const run = kind === 'insert' ? atoms(edit.adds ?? '', file) : view
    const at = now.findIndex(atom => atom.start >= (edit.landed ?? Infinity))
    if (at < 0 || !same(now.slice(at, at + run.length), run)) return kind === 'insert' ? EXTRA : LOST
    const rest = [...now.slice(0, at), ...now.slice(at + run.length)]
    return same(rest, kind === 'insert' || kind === 'duplicate' ? was : was.filter(atom => !view.includes(atom))) ? null : LOST
  }

  // Hiding, showing and wrapping change a region's shape as well as its place: counted, not ordered.
  const removed = difference(was, now), added = difference(now, was)
  const allowed: { removed: Bag | 'comments'; added: Bag | 'comments' } =
    kind === 'hide' ? { removed: count(view), added: 'comments' }
      : kind === 'show' ? { removed: 'comments', added: count(atoms(hiddenViewsIn(edit.before, file).find(hidden => hidden.start === edit.view.start)?.source ?? '', file)) }
      : { removed: new Map(), added: repeatable(count(atoms(edit.adds ?? '', file))) }
  if (!within(removed, allowed.removed)) return LOST
  return within(added, allowed.added) ? null : EXTRA
}

function same(a: readonly Atom[], b: readonly Atom[]): boolean {
  return a.length === b.length && a.every((atom, i) => atom.text === b[i]!.text)
}

type Bag = Map<string, number>

function count(list: readonly Atom[]): Bag {
  const bag: Bag = new Map()
  for (const atom of list) bag.set(atom.text, (bag.get(atom.text) ?? 0) + 1)
  return bag
}

function difference(a: readonly Atom[], b: readonly Atom[]): Bag {
  const out: Bag = new Map(), other = count(b)
  for (const [text, n] of count(a)) if (n > (other.get(text) ?? 0)) out.set(text, n - (other.get(text) ?? 0))
  return out
}

/** Any number of each, for a wrap that may put a stack around several views. */
function repeatable(bag: Bag): Bag {
  return new Map([...bag.keys()].map(text => [text, Infinity]))
}

function within(bag: Bag, allowed: Bag | 'comments'): boolean {
  for (const [text, n] of bag) if (allowed === 'comments' ? !text.startsWith('comment ') : n > (allowed.get(text) ?? 0)) return false
  return true
}

/**
 * The text that is the selected view: its whole statement - with the switched-off
 * modifiers written after it - when it has one, through the last of several adjacent
 * ones, and only its own span when it is written as an argument, which is all a change
 * to it may take.
 */
function viewExtent(edit: StructuralEdit): [number, number] {
  const site = viewSiteAt(edit.before, edit.file, edit.view.start)
  if (!site) return [edit.view.start, edit.view.end]
  return [site.start, site.end >= edit.view.end ? site.end : afterOffMarkers(edit.before, edit.view.end)]
}

/** Where a view sits: the declaration it is in, then each container around it, outermost first. */
function placeOf(tree: SourceFileNode, offset: number): string {
  const containers: CallExpr[] = []
  walk(tree, (node: Node) => {
    const body = node.kind === 'call' ? node.trailingClosure?.body.span : undefined
    if (body && body.start < offset && offset < body.end) containers.push(node as CallExpr)
  })
  return [declarationAt(tree, offset), ...containers.sort((a, b) => a.span.start - b.span.start).map(nameOf)].join(' > ')
}

/** Where the view should be: beside what it was sent to, or inside it as its last child. */
function expectedPlace(edit: StructuralEdit, tree: SourceFileNode): string {
  const toward = edit.toward ?? edit.view.start
  const inside = edit.inside ?? (edit.kind === 'insert' && !!viewSiteAt(edit.before, edit.file, toward)?.container)
  let container: CallExpr | undefined
  walk(tree, (node: Node) => { if (node.kind === 'call' && node.trailingClosure && node.span.start === toward) container ??= node })
  return inside && container ? `${placeOf(tree, toward)} > ${nameOf(container)}` : placeOf(tree, toward)
}

function nameOf(call: CallExpr): string {
  return call.callee.kind === 'identifier' ? call.callee.name : call.callee.kind === 'memberAccess' ? call.callee.member : call.callee.kind
}

/** The declaration an offset is in, as a name: `HomeScreen.body`, `#Preview`. */
function declarationAt(tree: SourceFileNode, offset: number): string {
  const within = (decl: Decl) => offset >= decl.span.start && offset < decl.span.end
  for (const decl of tree.declarations) {
    if (!within(decl)) continue
    if (decl.kind === 'macroDecl') return `#${decl.name}`
    const name = 'name' in decl ? String(decl.name) : decl.kind
    const member = 'members' in decl ? (decl.members as readonly Decl[]).find(within) : undefined
    return member && 'name' in member ? `${name}.${String(member.name)}` : name
  }
  return ''
}

/**
 * Views that would not build, or would show nothing.
 *
 * A getter or function that returns `some View` without `@ViewBuilder` holds one view:
 * a second one outside a `return` is a compile error. `body` is a view builder, and a
 * builder with nothing in it builds - but a change that empties it has taken what the
 * view was.
 */
function holderProblems(tree: SourceFileNode): { key: string; message: string }[] {
  const problems: { key: string; message: string }[] = []
  const visit = (decl: Decl, owner?: string) => {
    if ('members' in decl && 'name' in decl) for (const member of decl.members as readonly Decl[]) visit(member, String(decl.name))
    if (decl.kind !== 'varDecl' && decl.kind !== 'funcDecl') return
    const block = decl.kind === 'varDecl' ? isView(decl.typeAnnotation) ? decl.accessor : null : isView(decl.returnType) ? decl.body : null
    if (!block) return
    const key = `${owner ?? ''}.${decl.name}`
    const builder = decl.name === 'body' || decl.attributes.some(attribute => attribute.name === 'ViewBuilder')
    const name = decl.name === 'body' && owner ? owner : decl.name
    if (!block.statements.length) problems.push({ key: `${key}:empty`, message: `This change would leave \`${name}\` with nothing to show. Nothing was changed.` })
    else if (!builder && !block.statements.some(statement => statement.kind === 'returnStmt') && block.statements.filter(statement => statement.kind === 'exprStmt').length > 1) {
      problems.push({ key: `${key}:two`, message: `\`${name}\` can hold only one view, so this change would stop the app from building. Nothing was changed.` })
    }
  }
  for (const decl of tree.declarations) visit(decl)
  return problems
}

function isView(type: TypeRef | null): boolean {
  return type?.kind === 'someType' && type.constraint.kind === 'namedType' && type.constraint.name === 'View'
}
