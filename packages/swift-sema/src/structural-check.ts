import type { FileId } from '@studio/shared'
import { Lexer, Parser, hiddenViewsIn, viewSiteAt, type Decl, type SourceFileNode, type TypeRef } from '@studio/swift-syntax'

/**
 * The last check a structural change passes before it is kept (C11).
 *
 * The planner used to accept any result that parsed without new checker errors, and
 * that is how a hidden view deleted by Add, a card deleted with its outline and a title
 * moved into `#Preview` were all kept: each one parsed. This compares the file before
 * and after, knowing only what the change was asked to do - not how it was worked out -
 * so it catches the bug in whichever writer has it, including the next one:
 *
 * - nothing outside the view goes, or comes, except what the change is about;
 * - the view lands in the declaration it was sent to;
 * - no helper that holds one view is given a second, and no view is left with nothing
 *   to show, unless it already was.
 */

export type StructuralKind = 'delete' | 'hide' | 'show' | 'insert' | 'move' | 'moveTo' | 'duplicate' | 'wrap' | 'reparent'

export interface StructuralEdit {
  readonly file: FileId
  readonly before: string
  readonly after: string
  readonly kind: StructuralKind
  /** The selected view's source in `before`. */
  readonly view: { readonly start: number; readonly end: number }
  /** Swift the change is meant to bring besides the view: an inserted snippet, and a wrap it needs. */
  readonly adds?: string
  /** Where the view was sent, in `before`: a drop target or a destination. The view itself when omitted. */
  readonly toward?: number
  /** Where the view starts in `after`, for a change that keeps it. */
  readonly landed?: number
}

const LOST = 'This change would also remove other parts of the file, such as a hidden view or a note. Nothing was changed.'
const EXTRA = 'This change would add more than it was meant to. Nothing was changed.'
const ELSEWHERE = 'This change would put the view somewhere other than where it was dropped. Nothing was changed.'
/** Each layout the wrap writes, for what a wrap may add. */
const WRAPPERS = 'VStack(spacing: 16) { } HStack(spacing: 16) { } ZStack { }'

/** What went wrong with a structural change, in words a designer can act on, or null when it did what it said. */
export function structuralEditProblem(edit: StructuralEdit): string | null {
  const { file, before, after, kind } = edit
  const was = atoms(before, file), now = atoms(after, file)
  const removed = difference(was, now), added = difference(now, was)
  const view = atoms(before.slice(...viewExtent(edit)), file)
  const separators = new Map([[';', Infinity]])
  const allowed: { removed: Bag | 'comments'; added: Bag | 'comments' } =
    kind === 'delete' ? { removed: view, added: new Map() }
      : kind === 'hide' ? { removed: view, added: 'comments' }
      : kind === 'show' ? { removed: 'comments', added: atoms(hiddenViewsIn(before, file).find(hidden => hidden.start === edit.view.start)?.source ?? '', file) }
      : kind === 'insert' ? { removed: new Map(), added: atoms(edit.adds ?? '', file) }
      : kind === 'duplicate' ? { removed: new Map(), added: view }
      : kind === 'wrap' ? { removed: new Map(), added: repeatable(atoms(WRAPPERS, file)) }
      : { removed: new Map(), added: new Map() }
  if (!allowedIn(removed, allowed.removed, separators)) return LOST
  if (!allowedIn(added, allowed.added, separators)) return EXTRA

  const first = Parser.parse(before, file).sourceFile, last = Parser.parse(after, file).sourceFile
  if (edit.landed !== undefined && declarationAt(last, edit.landed) !== declarationAt(first, edit.toward ?? edit.view.start)) return ELSEWHERE

  const old = new Set(holderProblems(first).map(problem => problem.key))
  return holderProblems(last).find(problem => !old.has(problem.key))?.message ?? null
}

type Bag = Map<string, number>

/**
 * Everything in a stretch of Swift that a change could lose or gain: each token, and
 * each comment - a hidden view is a run of comments, a switched-off modifier is one.
 * Whitespace is not in it, so re-indenting what moved is not a difference.
 */
function atoms(text: string, file: FileId): Bag {
  const bag: Bag = new Map()
  const add = (atom: string) => bag.set(atom, (bag.get(atom) ?? 0) + 1)
  let cursor = 0
  for (const token of Lexer.tokenize(text, file).tokens) {
    for (const comment of text.slice(cursor, token.span.start).match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) ?? []) add(`comment ${comment.trim()}`)
    if (token.kind !== 'endOfFile') add(token.text)
    cursor = token.span.end
  }
  return bag
}

function difference(a: Bag, b: Bag): Bag {
  const out: Bag = new Map()
  for (const [atom, count] of a) if (count > (b.get(atom) ?? 0)) out.set(atom, count - (b.get(atom) ?? 0))
  return out
}

/** Any number of each, for a wrap that may put several around the selection. */
function repeatable(bag: Bag): Bag {
  return new Map([...bag.keys()].map(atom => [atom, Infinity]))
}

function allowedIn(bag: Bag, allowed: Bag | 'comments', separators: Bag): boolean {
  for (const [atom, count] of bag) {
    if (separators.has(atom)) continue
    if (allowed === 'comments' ? !atom.startsWith('comment ') : count > (allowed.get(atom) ?? 0)) return false
  }
  return true
}

/**
 * The text that is the selected view: its whole statement - with the switched-off
 * modifiers written after it - when it has one, and only its own span when it is
 * written as an argument, which is all a change to it may take.
 */
function viewExtent(edit: StructuralEdit): [number, number] {
  const site = viewSiteAt(edit.before, edit.file, edit.view.start)
  return site ? [site.start, site.end] : [edit.view.start, edit.view.end]
}

/** The declaration an offset is in, as a name: `HomeScreen.body`, `#Preview`. */
function declarationAt(source: SourceFileNode, offset: number): string | null {
  const within = (decl: Decl) => offset >= decl.span.start && offset < decl.span.end
  for (const decl of source.declarations) {
    if (!within(decl)) continue
    if (decl.kind === 'macroDecl') return `#${decl.name}`
    const name = 'name' in decl ? String(decl.name) : decl.kind
    const member = 'members' in decl ? (decl.members as readonly Decl[]).find(within) : undefined
    return member && 'name' in member ? `${name}.${String(member.name)}` : name
  }
  return null
}

/**
 * Views that would not build, or would show nothing.
 *
 * A getter or function that returns `some View` without `@ViewBuilder` holds one view:
 * a second one outside a `return` is a compile error. `body` is a view builder, and a
 * builder with nothing in it builds - but a change that empties it has taken what the
 * view was.
 */
function holderProblems(source: SourceFileNode): { key: string; message: string }[] {
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
  for (const decl of source.declarations) visit(decl)
  return problems
}

function isView(type: TypeRef | null): boolean {
  return type?.kind === 'someType' && type.constraint.kind === 'namedType' && type.constraint.name === 'View'
}
