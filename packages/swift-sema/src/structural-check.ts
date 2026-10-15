import type { FileId } from '@studio/shared'
import { Lexer, Parser, afterOffMarkers, hiddenViewsIn, viewSiteAt, walk, type CallExpr, type Decl, type Expr, type FuncDecl, type Node, type SourceFileNode, type TypeRef, type VarDecl } from '@studio/swift-syntax'

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

export type StructuralKind = 'delete' | 'hide' | 'show' | 'insert' | 'move' | 'moveTo' | 'duplicate' | 'wrap' | 'unwrap' | 'reparent' | 'spacing' | 'restructure'

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
  /** Swift a change to the view's own arrangement may take out of it: Auto spacing's Spacers, or the container an unwrap takes away, once. */
  readonly removes?: string
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

  // Hiding, showing, wrapping and spacing out change a region's shape as well as its place: counted, not ordered.
  const removed = difference(was, now), added = difference(now, was)
  const allowed: { removed: Bag | 'comments'; added: Bag | 'comments' } =
    kind === 'hide' ? { removed: count(view), added: 'comments' }
      : kind === 'show' ? { removed: 'comments', added: count(atoms(hiddenViewsIn(edit.before, file).find(hidden => hidden.start === edit.view.start)?.source ?? '', file)) }
      // An unwrap takes the container away, once, and adds nothing (Wave 4c).
      : kind === 'unwrap' ? { removed: count(atoms(edit.removes ?? '', file)), added: new Map() }
      : { removed: repeatable(count(atoms(edit.removes ?? '', file))), added: repeatable(count(atoms(edit.adds ?? '', file))) }
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
  // The view itself, not a modifier after it: `List { }.toolbar { }.sheet { }` starts at
  // the same place three times, and only the innermost of them holds the List's rows.
  let container: CallExpr | undefined
  walk(tree, (node: Node) => {
    if (node.kind === 'call' && node.trailingClosure && node.span.start === toward && (!container || node.span.end < container.span.end)) container = node
  })
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
    const returns = block.statements.some(statement => statement.kind === 'returnStmt')
    // Beside a `return`, even `body` is no view builder: another view there is built and thrown away (C5).
    const views = block.statements.filter(statement => statement.kind === 'exprStmt' || statement.kind === 'returnStmt').length
    if (!block.statements.length) problems.push({ key: `${key}:empty`, message: `This change would leave \`${name}\` with nothing to show. Nothing was changed.` })
    else if (returns && views > 1) problems.push({ key: `${key}:returned:${views}`, message: `\`${name}\` returns its one view, so a view beside it would not show on iOS. Nothing was changed.` })
    else if (!builder && !returns && views > 1) {
      problems.push({ key: `${key}:two`, message: `\`${name}\` can hold only one view, so this change would stop the app from building. Nothing was changed.` })
    }
  }
  for (const decl of tree.declarations) visit(decl)
  return problems
}

function isView(type: TypeRef | null): boolean {
  return type?.kind === 'someType' && type.constraint.kind === 'namedType' && type.constraint.name === 'View'
}

/** What a padding or frame call a change wrote must look like for Swift to build it. */
export interface ArgumentEdit {
  readonly file: FileId
  readonly before: string
  readonly after: string
  /** Every file of the project after the change, where tokens and constants are declared. The changed file alone when omitted. */
  readonly declarations?: readonly SourceFileNode[]
}

/** The members of `Edge.Set` that `.padding` takes as its first argument. */
export const EDGE_SET_MEMBERS: readonly string[] = ['all', 'horizontal', 'vertical', 'top', 'bottom', 'leading', 'trailing']
const EDGES = new Set(EDGE_SET_MEMBERS)
const FRAME_FORMS = [['width', 'height', 'alignment'], ['minWidth', 'idealWidth', 'maxWidth', 'minHeight', 'idealHeight', 'maxHeight', 'alignment']]
/** `String.padding(toLength:withPad:startingAt:)`, which shares the name and is no view's. */
const STRING_PADDING = 'toLength,withPad,startingAt'
/** `GeometryProxy.frame(in:)`, which shares the name and is no view's. */
const PROXY_FRAME = 'in'
const NUMBER_TYPES = new Set(['CGFloat', 'Double', 'Float', 'Int'])

/**
 * A `.padding`, `.frame` or `.border` a change wrote with arguments SwiftUI has no
 * version of.
 *
 * The planner's other checks parse the result and resolve its names, and
 * `.padding(.space16, 24)` passes both: only the type checker knows `.space16` is no
 * edge. This knows the overloads, and the project's own tokens, constants and
 * overloads, well enough to catch that shape in whichever writer has it. A call already
 * in the file before the change is its author's to fix, not the change's.
 */
export function modifierArgumentProblem(edit: ArgumentEdit): string | null {
  const tree = Parser.parse(edit.after, edit.file).sourceFile
  const trees = [tree, ...(edit.declarations ?? []).filter(other => other.span.file !== edit.file)]
  const was = new Set(unbuildable(Parser.parse(edit.before, edit.file).sourceFile, edit.before, trees))
  const added = unbuildable(tree, edit.after, trees).find(call => !was.has(call))
  return added ? `This change would write \`${added}\`, which would stop the app from building. Nothing was changed.` : null
}

/** The padding, frame and border calls in a file that no overload takes, as written, on one line. */
function unbuildable(tree: SourceFileNode, text: string, trees: readonly SourceFileNode[]): string[] {
  const found: string[] = []
  walk(tree, (node: Node) => {
    if (node.kind !== 'call') return
    const name = node.callee.kind === 'memberAccess' ? node.callee.member : node.callee.kind === 'identifier' ? node.callee.name : ''
    const labels = node.args.map(arg => arg.label)
    const builds = name === 'padding' ? labels.join() === STRING_PADDING || paddingBuilds(node, trees)
      : name === 'frame' ? labels.join() === PROXY_FRAME || frameBuilds(labels)
      : name === 'border' ? labels[0] === null && (labels.length === 1 || labels.length === 2 && labels[1] === 'width')
      : true
    if (!builds && !ownOverload(trees, name, labels)) found.push('.' + name + text.slice(node.callee.span.end, node.span.end).replace(/\s+/g, ' '))
  })
  return found
}

/** Whether the project declares a function by this name that takes these argument labels. */
function ownOverload(trees: readonly SourceFileNode[], name: string, labels: readonly (string | null)[]): boolean {
  const takes = (decl: FuncDecl) => {
    let at = 0
    for (const param of decl.params) {
      const label = param.externalName === '_' ? null : param.externalName ?? param.internalName
      if (at < labels.length && labels[at] === label) at++
      else if (!param.defaultValue) return false
    }
    return at === labels.length
  }
  const visit = (decl: Decl): boolean => decl.kind === 'funcDecl' ? decl.name === name && takes(decl)
    : 'members' in decl && (decl.members as readonly Decl[]).some(visit)
  return trees.some(tree => tree.declarations.some(visit))
}

/** `padding()`, `padding(length)`, `padding(insets)`, `padding(edges)` and `padding(edges, length)`. */
function paddingBuilds(call: CallExpr, trees: readonly SourceFileNode[]): boolean {
  if (call.args.some(arg => arg.label !== null) || call.args.length > 2) return false
  if (call.args.length < 2) return true
  const [edges, length] = call.args.map(arg => arg.value) as [Expr, Expr]
  return !notEdges(edges, trees) && !(length.kind === 'arrayLiteral' || length.kind === 'memberAccess' && !length.base && EDGES.has(length.member))
}

/**
 * Whether a value certainly is no `Edge.Set`: a number, a name `Edge.Set` does not have,
 * or a type's number constant. A bare name could be a local of any type, so it is left be.
 */
function notEdges(value: Expr, trees: readonly SourceFileNode[]): boolean {
  if (value.kind === 'integerLiteral' || value.kind === 'floatLiteral') return true
  if (value.kind === 'unary') return notEdges(value.operand, trees)
  if (value.kind === 'memberAccess' && !value.base) return !EDGES.has(value.member) && !declared(trees, value.member, 'Edge.Set').length
  const decls = value.kind === 'memberAccess' && value.base?.kind === 'identifier' ? declared(trees, value.member, value.base.name) : []
  return decls.length > 0 && decls.every(decl => decl.typeAnnotation ? decl.typeAnnotation.kind === 'namedType' && NUMBER_TYPES.has(decl.typeAnnotation.name) : decl.initializer?.kind === 'integerLiteral' || decl.initializer?.kind === 'floatLiteral')
}

/** The properties named `name` that `owner`, or an extension of it, declares. */
function declared(trees: readonly SourceFileNode[], name: string, owner: string): VarDecl[] {
  const out: VarDecl[] = []
  const visit = (decl: Decl, inside: string | undefined) => {
    if (decl.kind === 'varDecl' && decl.name === name && inside === owner) out.push(decl)
    if ('members' in decl && 'name' in decl) for (const member of decl.members as readonly Decl[]) visit(member, String(decl.name))
  }
  for (const tree of trees) for (const decl of tree.declarations) visit(decl, undefined)
  return out
}

/** `frame(width:height:alignment:)` or `frame(minWidth:idealWidth:maxWidth:minHeight:idealHeight:maxHeight:alignment:)`, each label at most once and in order. */
function frameBuilds(labels: readonly (string | null)[]): boolean {
  return FRAME_FORMS.some(form => {
    let at = 0
    return labels.every(label => { const index = label === null ? -1 : form.indexOf(label, at); at = index + 1; return index >= 0 })
  })
}
