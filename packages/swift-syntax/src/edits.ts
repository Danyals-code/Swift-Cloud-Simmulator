import type { FileId } from '@studio/shared'
import { Parser } from './parser'
import { walk, type Block, type Expr, type Node, type Stmt } from './ast'
import { afterOffMarkers } from './off-markers'

/**
 * Editing the source from the canvas.
 *
 * The studio's one rule is that the source is the truth, so a view moved or deleted
 * on the canvas is a *text edit* to the file the user wrote - never a model the
 * preview keeps beside it. Everything here therefore produces new file text and
 * nothing else, and every operation is expressed in terms the parser already
 * understands: a view is the statement that produces it, and its siblings are the
 * other statements of the block it is in.
 *
 * Working at statement level is what makes this safe. `Text("Hi").padding().bold()`
 * is one expression whose *extent* is hard to reason about from a view's own span -
 * the span points at `Text("Hi")` - but the statement containing it is exactly the
 * text that has to move, including every modifier hanging off it.
 *
 * The formatting the user wrote is left alone. A move swaps the two statements'
 * text and nothing else, so the indentation, the blank lines and the comments
 * around them stay where they were put.
 */

/** Views whose trailing closure builds *content* rather than running an action. */
const CONTAINERS = new Set([
  'VStack', 'HStack', 'ZStack', 'LazyVStack', 'LazyHStack', 'LazyVGrid', 'LazyHGrid',
  'List', 'ScrollView', 'Form', 'Section', 'Group', 'GroupBox', 'ForEach',
  'NavigationStack', 'NavigationView', 'NavigationSplitView', 'TabView', 'Grid', 'GridRow',
  'VSplitView', 'HSplitView', 'ViewThatFits', 'AnyLayout',
])

export interface ViewSite {
  /** The statement that produces this view. */
  readonly start: number
  readonly end: number
  /** The text to remove to take it out whole - whole lines when it has them to itself. */
  readonly cutStart: number
  readonly cutEnd: number
  /** Its position among the statements of the block it is in. */
  readonly index: number
  readonly siblings: number
  /** The whitespace its line begins with, so anything inserted beside it lines up. */
  readonly indent: string
  /** True when this view can take children of its own. */
  readonly container: boolean
  /** True when the block it sits in is a container's content, rather than a body or a branch. */
  readonly inContent: boolean
}

export interface SourceEdit {
  readonly text: string
  /**
   * Where the edited view now starts.
   *
   * The caller re-selects by this offset rather than by the view's old identity:
   * identities are positional, so after a move the old one names the view that was
   * swapped with it - the neighbour, not the thing that was moved.
   */
  readonly offset: number
}

/**
 * The statement whose view starts at `offset`, with the block it belongs to.
 *
 * Exact on purpose. A view written as an argument - `.overlay(Circle())`,
 * `Section(header: Text("A"))` - sits inside a statement without being one, and taking
 * the statement around it would move, hide or delete the view that takes it. `near`
 * answers the innermost statement containing `offset` instead, for a drop target: a
 * drop onto an overlay means beside the view it belongs to.
 */
function siteAt(text: string, file: FileId, offset: number, { near = false } = {}): { stmt: Stmt; block: Block; index: number; blockOwner: Expr | null } | null {
  const { sourceFile } = Parser.parse(text, file)

  let best: { stmt: Stmt; block: Block; index: number; blockOwner: Expr | null } | null = null
  /** The call a block hangs off, so a container's content can be told from an action. */
  const owners = new Map<Block, Expr>()

  walk(sourceFile, (node: Node) => {
    if (node.kind === 'call' && node.trailingClosure) owners.set(node.trailingClosure.body, node)
    if (node.kind !== 'block') return
    node.statements.forEach((stmt, index) => {
      if (near ? offset < stmt.span.start || offset >= stmt.span.end : viewStartOf(stmt) !== offset) return
      // At most one statement starts at an offset. Near it, deeper blocks are visited
      // after shallower ones, so the innermost statement containing it wins.
      if (!best || stmt.span.start >= best.stmt.span.start) {
        best = { stmt, block: node, index, blockOwner: owners.get(node) ?? null }
      }
    })
  })

  return best
}

/** Where the view a statement produces is written: past a `return`, where its expression starts. */
function viewStartOf(stmt: Stmt): number | null {
  if (stmt.kind === 'exprStmt') return stmt.expression.span.start
  if (stmt.kind === 'returnStmt') return stmt.value?.span.start ?? null
  return null
}

/** The name a call expression invokes, for `Text(…)` and `SwiftUI.Text(…)` alike. */
function calleeName(expr: Expr): string | null {
  if (expr.kind === 'call') return calleeName(expr.callee)
  if (expr.kind === 'identifier') return expr.name
  if (expr.kind === 'memberAccess') return expr.member
  return null
}

/** The view a statement produces, looking through `return` and modifier chains. */
function viewCallOf(stmt: Stmt): Expr | null {
  const expression =
    stmt.kind === 'exprStmt' ? stmt.expression : stmt.kind === 'returnStmt' ? stmt.value : null
  if (!expression) return null

  // `Text("Hi").padding()` is a call whose callee is a member of another call; the
  // *innermost* call is the view, and it is the one that says whether it has content.
  let current: Expr = expression
  for (;;) {
    if (current.kind === 'call') {
      const callee = current.callee
      if (callee.kind === 'memberAccess' && callee.base) {
        current = callee.base
        continue
      }
      return current
    }
    if (current.kind === 'memberAccess' && current.base) {
      current = current.base
      continue
    }
    return null
  }
}

function isContainer(stmt: Stmt): boolean {
  const call = viewCallOf(stmt)
  if (!call || call.kind !== 'call' || !call.trailingClosure) return false
  const name = calleeName(call)
  return !!name && CONTAINERS.has(name)
}

/** The block a container's children live in, for a statement that has one. */
function contentBlockOf(stmt: Stmt): Block | null {
  const call = viewCallOf(stmt)
  if (!call || call.kind !== 'call' || !call.trailingClosure) return null
  const name = calleeName(call)
  return name && CONTAINERS.has(name) ? call.trailingClosure.body : null
}

/**
 * The text a statement actually is.
 *
 * The parser folds a statement's `;` terminator into its span, so `Text("A"); Text("B")`
 * hands back a first statement that ends after the semicolon. Swapping two of those
 * moves the punctuation with the view and leaves the line malformed, so the extent is
 * trimmed back to the last character of the statement itself.
 */
function extentOf(text: string, stmt: Stmt): { start: number; end: number } {
  let end = stmt.span.end
  while (end > stmt.span.start && /[\s;]/.test(text[end - 1]!)) end--
  // A modifier switched off at the end of the chain is a comment after the statement,
  // not part of it, but it is still this view's: it moves, copies and goes with it.
  return { start: stmt.span.start, end: afterOffMarkers(text, end) }
}

function lineStartAt(text: string, offset: number): number {
  return text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
}

/**
 * The text that removes a statement whole.
 *
 * Its lines, when it has them to itself - which is how SwiftUI is written and what
 * makes a delete leave no blank line behind. When something else shares the line,
 * only the statement and its separator go.
 */
function cutOf(text: string, stmt: Stmt): Cut {
  const extent = extentOf(text, stmt)
  const lineStart = lineStartAt(text, extent.start)
  const before = text.slice(lineStart, extent.start)
  const newline = text.indexOf('\n', extent.end)
  const lineEnd = newline === -1 ? text.length : newline + 1
  const after = text.slice(extent.end, newline === -1 ? text.length : newline)

  if (/^[ \t]*$/.test(before) && /^[ \t;]*$/.test(after)) {
    return { start: lineStart, end: lineEnd, after: lineEnd, indent: before, ownLine: true }
  }

  const separator = /^[ \t]*;[ \t]*/.exec(text.slice(extent.end))
  return {
    start: extent.start,
    end: extent.end + (separator?.[0].length ?? 0),
    // Anything added beside it goes directly after the statement, in front of the
    // separator that a delete would have taken with it.
    after: extent.end,
    indent: /^[ \t]*/.exec(before)?.[0] ?? '',
    ownLine: false,
  }
}

export function viewSiteAt(text: string, file: FileId, offset: number): ViewSite | null {
  const found = siteAt(text, file, offset)
  if (!found) return null
  const { stmt, block, index, blockOwner } = found
  const cut = cutOf(text, stmt)
  const ownerName = blockOwner ? calleeName(blockOwner) : null

  const extent = extentOf(text, stmt)
  return {
    start: extent.start,
    end: extent.end,
    cutStart: cut.start,
    cutEnd: cut.end,
    index,
    siblings: block.statements.length,
    indent: cut.indent,
    container: isContainer(stmt),
    inContent: !!ownerName && CONTAINERS.has(ownerName),
  }
}

/**
 * Deletes the view at `offset`.
 *
 * Refuses to empty a body: a `some View` that returns nothing does not compile, and
 * an edit whose result is a broken file is not an edit the canvas should make on a
 * single click. Emptying a *container* is fine - `VStack { }` is a legal view - so
 * the refusal is only for the statement that is a block's whole content when that
 * block is not a container's.
 */
export function deleteView(text: string, file: FileId, offset: number): SourceEdit | null {
  const found = siteAt(text, file, offset)
  if (!found) return null
  const site = viewSiteAt(text, file, offset)!
  if (site.siblings === 1 && !site.inContent) return null

  const cut = cutOf(text, found.stmt)
  return { text: text.slice(0, cut.start) + text.slice(cut.end), offset: cut.start }
}

/**
 * Moves the view at `offset` past its previous or next sibling.
 *
 * The two statements' text is exchanged and nothing else is touched, so whatever
 * blank lines, comments and indentation surround them stay exactly where the user
 * put them. Returns null at either end of a block, which is what tells the studio
 * to draw the control as unavailable rather than to do nothing on a press.
 */
export function moveView(text: string, file: FileId, offset: number, direction: -1 | 1): SourceEdit | null {
  const found = siteAt(text, file, offset)
  if (!found) return null

  const target = found.index + direction
  const other = found.block.statements[target]
  if (!other) return null

  const a = found.index < target ? found.stmt : other
  const b = found.index < target ? other : found.stmt
  const first = extentOf(text, a)
  const second = extentOf(text, b)
  if (first.end > second.start) return null

  const firstText = text.slice(first.start, first.end)
  const secondText = text.slice(second.start, second.end)
  const edited =
    text.slice(0, first.start) +
    secondText +
    text.slice(first.end, second.start) +
    firstText +
    text.slice(second.end)

  // Where the moved statement ended up: the other statement's start when it moved
  // up, and that start shifted by the difference in lengths when it moved down.
  const movedUp = direction === -1
  const offsetAfter = movedUp
    ? first.start
    : second.start + (secondText.length - firstText.length)

  return { text: edited, offset: offsetAfter }
}

/**
 * Adds a view beside, or inside, the view at `offset`.
 *
 * A container takes it as its last child, because selecting a stack and pressing Add
 * means "put one in here"; anything else takes it as its next sibling. The snippet is
 * re-indented to wherever it lands, so a multi-line one arrives formatted rather than
 * flattened against the left margin.
 */
export function insertView(text: string, file: FileId, offset: number, snippet: string): SourceEdit | null {
  const found = siteAt(text, file, offset)
  if (!found) return null

  const content = contentBlockOf(found.stmt)
  const reference = content?.statements[content.statements.length - 1]

  if (content && reference) {
    // Last child of the container.
    const cut = cutOf(text, reference)
    return spliceStatement(text, cut, snippet)
  }

  if (content) {
    // A container with no statements can still hold text the parser does not turn
    // into one - a hidden view, a comment, a ForEach's `item in` - so the new view
    // goes in front of the closing brace and everything before it stays.
    const open = content.span.start
    const close = content.span.end - 1
    if (open === -1 || close === -1 || close < open) return null
    const outer = /^[ \t]*/.exec(text.slice(lineStartAt(text, found.stmt.span.start), found.stmt.span.start))?.[0] ?? ''
    const inner = outer + indentUnit(text)
    const closeLine = lineStartAt(text, close)
    if (closeLine > open && /^[ \t]*$/.test(text.slice(closeLine, close))) {
      // Lined up with what is already inside, when a line of it comes before the brace.
      const lastLine = lineStartAt(text, closeLine - 1)
      const indent = (lastLine > open ? /^[ \t]*(?=\S)/.exec(text.slice(lastLine, closeLine))?.[0] : undefined) ?? inner
      return { text: text.slice(0, closeLine) + `${indentSnippet(snippet, indent)}\n` + text.slice(closeLine), offset: closeLine + indent.length }
    }
    // A brace on a shared line - `VStack { }` - opens onto its own lines, which is
    // where nested content stays readable.
    const end = open + 1 + text.slice(open + 1, close).trimEnd().length
    return {
      text: text.slice(0, end) + `\n${indentSnippet(snippet, inner)}\n${outer}` + text.slice(close),
      offset: end + 1 + inner.length,
    }
  }

  return spliceStatement(text, cutOf(text, found.stmt), snippet)
}

interface Cut {
  readonly start: number
  readonly end: number
  /** Where a sibling added after this statement goes. */
  readonly after: number
  readonly indent: string
  readonly ownLine: boolean
}

/** Puts a snippet immediately after a statement, matching how that statement is written. */
function spliceStatement(text: string, cut: Cut, snippet: string): SourceEdit {
  if (cut.ownLine) {
    const inserted = `${indentSnippet(snippet, cut.indent)}\n`
    return { text: text.slice(0, cut.after) + inserted + text.slice(cut.after), offset: cut.after + cut.indent.length }
  }
  const inserted = `; ${snippet}`
  return { text: text.slice(0, cut.after) + inserted + text.slice(cut.after), offset: cut.after + 2 }
}

/** Tabs when the file is written with tabs, four spaces otherwise. */
function indentUnit(text: string): string {
  return /\n\t+\S/.test(text) ? '\t' : '    '
}

function indentSnippet(snippet: string, indent: string): string {
  return snippet
    .split('\n')
    .map((line, i) => (i === 0 ? indent + line : line.trim() ? indent + line : ''))
    .join('\n')
}

/**
 * The marker that lets a hidden view be found again.
 *
 * Hiding comments the view out, which is the only way a view can stop taking part in
 * the layout as well as in the drawing - `.hidden()` leaves its space behind. The
 * cost of commenting is that the parser stops seeing it, so the studio would have
 * nowhere to draw the switch that brings it back. This line is how it keeps it: an
 * ordinary comment that survives Xcode, a diff and a merge, and that reads as what
 * it is if the studio never opens the file again.
 */
export const HIDDEN_MARKER = '// hidden by Swift Web Studio'
const HIDDEN_END = '// end hidden view'

export interface HiddenView {
  /** Offset of the marker line, which is where the block starts. */
  readonly start: number
  readonly end: number
  /** The Swift that comes back when it is shown again. */
  readonly source: string
  readonly name: string
  readonly type: string
  /**
   * The container it was hidden from, as that view's own offset.
   *
   * Lets the studio list it where it belongs in the hierarchy rather than in a
   * drawer of things that are no longer anywhere.
   */
  readonly container: number | null
}

/**
 * Moves the view at `offset` to sit before or after another one.
 *
 * The general form of a move: the statement's text is cut and put back at the
 * target, so it works between siblings, into a different container and out of one -
 * which is what a drag in Layers or on the canvas means. Refuses to drop a view
 * inside itself, which would delete it and leave a copy of its own middle behind.
 */
export function moveViewTo(
  text: string,
  file: FileId,
  offset: number,
  targetOffset: number,
  position: 'before' | 'after',
): SourceEdit | null {
  const source = siteAt(text, file, offset)
  const target = siteAt(text, file, targetOffset, { near: true })
  if (!source || !target) return null
  if (source.stmt === target.stmt) return null

  const from = cutOf(text, source.stmt)
  const to = cutOf(text, target.stmt)
  // A container cannot land among its own children.
  if (to.start >= from.start && to.end <= from.end) return null

  const extent = extentOf(text, source.stmt)
  const body = from.ownLine
    ? stripIndent(text.slice(from.start, from.end).replace(/\r?\n$/, ''), from.indent)
    : text.slice(extent.start, extent.end)

  // Cut first, then place: with the source gone, everything after it has moved left
  // by the length of the cut.
  const without = text.slice(0, from.start) + text.slice(from.end)
  const shift = from.start < to.start ? from.end - from.start : 0
  const anchor = {
    start: to.start - shift,
    end: to.end - shift,
    after: to.after - shift,
    indent: to.indent,
    ownLine: to.ownLine,
  }

  if (anchor.ownLine) {
    const at = position === 'before' ? anchor.start : anchor.end
    const inserted = `${indentSnippet(body, anchor.indent)}\n`
    return { text: without.slice(0, at) + inserted + without.slice(at), offset: at + anchor.indent.length }
  }

  const at = position === 'before' ? anchor.start : anchor.after
  const inserted = position === 'before' ? `${body}; ` : `; ${body}`
  return {
    text: without.slice(0, at) + inserted + without.slice(at),
    offset: position === 'before' ? at : at + 2,
  }
}

/** The Swift that draws the view at `offset`, for a copy that a paste can place anywhere. */
export function copyView(text: string, file: FileId, offset: number): string | null {
  const found = siteAt(text, file, offset)
  if (!found) return null
  const cut = cutOf(text, found.stmt)
  const extent = extentOf(text, found.stmt)
  const body = text.slice(extent.start, extent.end)
  return cut.ownLine ? stripIndent(body, cut.indent) : body
}

/**
 * Hides the view at `offset` by commenting it out.
 *
 * Refused for a view that shares its line with another, because a `//` would take
 * the neighbour with it, and for the only view of a body, which would leave nothing
 * to draw at all.
 */
export function hideView(text: string, file: FileId, offset: number): SourceEdit | null {
  const found = siteAt(text, file, offset)
  const site = viewSiteAt(text, file, offset)
  if (!found || !site) return null
  const cut = cutOf(text, found.stmt)
  if (!cut.ownLine) return null
  if (site.siblings === 1 && !site.inContent) return null

  const commented = text
    .slice(cut.start, cut.end)
    .replace(/\r?\n$/, '')
    .split('\n')
    .map((line) => (line.startsWith(cut.indent) ? `${cut.indent}// ${line.slice(cut.indent.length)}` : `// ${line}`))
    .join('\n')

  return {
    text: `${text.slice(0, cut.start)}${cut.indent}${HIDDEN_MARKER}\n${commented}\n${cut.indent}${HIDDEN_END}\n${text.slice(cut.end)}`,
    offset: cut.start,
  }
}

/** Brings back the hidden view whose marker line starts at `start`. */
export function showView(text: string, file: FileId, start: number): SourceEdit | null {
  const hidden = hiddenViewsIn(text, file).find((view) => view.start === start)
  if (!hidden) return null

  const indent = /^[ \t]*/.exec(text.slice(lineStartAt(text, hidden.start)))?.[0] ?? ''
  const restored = hidden.source
    .split('\n')
    .map((line) => (line.trim() ? (line.startsWith(indent) ? line : indent + line) : line))
    .join('\n')

  return {
    text: `${text.slice(0, hidden.start)}${restored}\n${text.slice(hidden.end)}`,
    offset: hidden.start + indent.length,
  }
}

/**
 * Every view this file is hiding.
 *
 * Read from the text rather than from the tree, because a commented-out view is
 * exactly what the parser does not produce a tree for. A marker line followed by
 * commented lines is the shape; anything else is somebody's ordinary comment and is
 * left entirely alone.
 */
export function hiddenViewsIn(text: string, file: FileId): readonly HiddenView[] {
  const lines = text.split('\n')
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }

  const out: HiddenView[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() !== HIDDEN_MARKER) continue

    const body: string[] = []
    let end = i + 1
    for (; end < lines.length && /^[ \t]*\/\//.test(lines[end]!); end++) {
      if (lines[end]!.trim() === HIDDEN_END || lines[end]!.trim() === HIDDEN_MARKER) break
      body.push(lines[end]!.replace(/^([ \t]*)\/\/ ?/, '$1'))
    }
    if (!body.length) continue
    if (lines[end]?.trim() === HIDDEN_END) end++
    else {
      // Legacy markers had no terminator. Restore only the first parsed statement.
      const prefix = 'struct _Hidden: View { var body: some View {\n'
      const { sourceFile } = Parser.parse(prefix + body.join('\n') + '\n} }', file)
      let statementEnd: number | null = null
      walk(sourceFile, (node: Node) => {
        if (statementEnd !== null) return false
        if (node.kind === 'exprStmt' || node.kind === 'returnStmt') { statementEnd = node.span.end - prefix.length; return false }
      })
      if (statementEnd === null) continue
      const count = body.join('\n').slice(0, statementEnd).split('\n').length
      body.splice(count)
      end = i + 1 + count
    }

    const source = body.join('\n')
    const described = describeSnippet(source, file)
    out.push({
      start: starts[i]!,
      end: starts[end] ?? text.length,
      source,
      name: described.name,
      type: described.type,
      container: containerOffsetAt(text, file, starts[i]!),
    })
    i = end - 1
  }
  return out
}

/**
 * What a fragment of Swift draws, for naming a hidden view in the hierarchy.
 *
 * Parsed inside a view body rather than on its own: a file's top level holds
 * declarations, so `Text("Two")` alone is not a statement there and the parser is
 * right to say so.
 */
function describeSnippet(source: string, file: FileId): { name: string; type: string } {
  const { sourceFile } = Parser.parse(`struct _Hidden: View {
  var body: some View {
${source}
  }
}`, file)
  let found: { name: string; type: string } | null = null

  walk(sourceFile, (node: Node) => {
    if (found) return false
    if (node.kind !== 'exprStmt' && node.kind !== 'returnStmt') return
    const call = viewCallOf(node)
    const type = call ? calleeName(call) : null
    if (!type) return
    let name = ''
    if (call?.kind === 'call') {
      const first = call.args.find((argument) => argument.label === null)?.value
      if (first?.kind === 'stringLiteral') {
        name = first.segments.map((segment) => (segment.kind === 'text' ? segment.value : '…')).join('')
      }
    }
    found = { name: name || type, type }
    return false
  })

  return found ?? { name: 'View', type: 'View' }
}

/** The view whose content block encloses this offset, as that view's own start. */
function containerOffsetAt(text: string, file: FileId, offset: number): number | null {
  const { sourceFile } = Parser.parse(text, file)
  const owners = new Map<Block, Expr>()
  let best: { block: Block; owner: Expr } | null = null

  walk(sourceFile, (node: Node) => {
    if (node.kind === 'call' && node.trailingClosure) owners.set(node.trailingClosure.body, node)
    if (node.kind !== 'block') return
    if (offset < node.span.start || offset >= node.span.end) return
    const owner = owners.get(node)
    if (!owner) return
    if (!best || node.span.start >= best.block.span.start) best = { block: node, owner }
  })

  return best === null ? null : (best as { block: Block; owner: Expr }).owner.span.start
}

/** Takes one level of indentation off every line after the first. */
function stripIndent(block: string, indent: string): string {
  return block
    .split('\n')
    .map((line, i) => (i === 0 ? line.replace(indent, '') : line.startsWith(indent) ? line.slice(indent.length) : line))
    .join('\n')
}
