import { forEachChild, type Block, type Expr, type IfStmt, type Node, type Stmt } from './ast'

/**
 * Names read in a body put in place by values, as Detach does to a component's body
 * (Wave 5b): `title` and `self.title` become what the copy gives it, and a condition that
 * becomes constant is folded, so the result is the plain views the copy shows.
 */

/** A value known when written: a Bool, a number, a String, nil, or a case written as `.primary` or `Style.primary`. */
export type Constant = boolean | number | string | null | { readonly case: string }

/** What `expr` is when written as a literal, `nil` or a case: `.primary`, `Style.primary`, `Pill.Style.primary` (Wave 5b). */
export function constantOf(expr: Expr): Constant | undefined {
  switch (expr.kind) {
    case 'booleanLiteral': case 'integerLiteral': case 'floatLiteral': return expr.value
    case 'nilLiteral': return null
    case 'stringLiteral': return expr.segments.every(s => s.kind === 'text') ? expr.segments.map(s => s.kind === 'text' ? s.value : '').join('') : undefined
    case 'memberAccess': {
      let base = expr.base
      while (base?.kind === 'memberAccess') base = base.base
      return !expr.base || base?.kind === 'identifier' && /^[A-Z]/.test(base.name) ? { case: expr.member } : undefined
    }
    default: return undefined
  }
}

/** What a read of a name becomes: its Swift, its later lines indented as from no indent; whether it needs no parentheses inside an expression; and its value, when known, which a condition on it folds by. */
export interface Substitution {
  readonly text: string
  readonly atomic: boolean
  readonly constant?: Constant
  /** Its Swift where a string interpolation shows it, when that reads it differently: `2.0` for a Double given `2`. */
  readonly interpolated?: string
  /** Its Swift as the words of a `Text`, when that reads it differently: `verbatim: "Use *care*"`, which isn't markdown. */
  readonly words?: string
}

/** The expressions that need no parentheses to be an operand or have a member read: a name, a literal, a call, a member. */
export const isAtomic = (expr: Expr): boolean => !['binary', 'unary', 'ternary', 'assign', 'try', 'closure', 'inout'].includes(expr.kind)

/**
 * The views of `block`, the body of a component, with each read of a name in `values` (and
 * each name in `renames`, a nested type written in full) put in place, and each `if` and
 * `?:` whose condition becomes constant folded to the branch that applies. Each root
 * statement is one string, its later lines indented as from no indent, and says whether it
 * is a view expression rather than an `if` or a `switch`, and whether one needs no parentheses
 * to take a modifier.
 */
export function substitute(text: string, block: Block, values: ReadonlyMap<string, Substitution>, renames: ReadonlyMap<string, string> = new Map()): { readonly text: string; readonly expression: boolean; readonly atomic: boolean }[] {
  const indentOf = (offset: number) => /^[\t ]*/.exec(text.slice(text.lastIndexOf('\n', offset - 1) + 1))![0]
  const reindent = (value: string, from: string, to: string) => from === to ? value : value.split('\n').map((line, i) => i && line.startsWith(from) ? to + line.slice(from.length) : line).join('\n')

  /** What a name read as `name` or as `self.name` becomes. */
  const substitution = (expr: Expr) => expr.kind === 'identifier' ? values.get(expr.name) : expr.kind === 'memberAccess' && expr.base?.kind === 'selfExpr' ? values.get(expr.member) : undefined

  function evaluate(expr: Expr): Constant | undefined {
    switch (expr.kind) {
      case 'unary': { const value = expr.operator === '!' ? evaluate(expr.operand) : undefined; return typeof value === 'boolean' ? !value : undefined }
      case 'binary': {
        const left = evaluate(expr.left), right = evaluate(expr.right)
        if (expr.operator === '&&') return left === false || right === false ? false : left === true && right === true ? true : undefined
        if (expr.operator === '||') return left === true || right === true ? true : left === false && right === false ? false : undefined
        if (left === undefined || right === undefined || !['==', '!='].includes(expr.operator)) return undefined
        // `x != nil` holds for any value written out.
        if (left === null || right === null) return (left === right) === (expr.operator === '==')
        const leftCase = typeof left === 'object' ? left.case : undefined, rightCase = typeof right === 'object' ? right.case : undefined
        if ((leftCase === undefined) !== (rightCase === undefined) || typeof left !== typeof right) return undefined
        return (leftCase !== undefined ? leftCase === rightCase : left === right) === (expr.operator === '==')
      }
      default: { const value = substitution(expr); return value ? value.constant : constantOf(expr) }
    }
  }

  /** Whether all of an `if`'s conditions hold, none can, or that isn't known. */
  function holds(statement: IfStmt): boolean | undefined {
    let all: boolean | undefined = true
    for (const condition of statement.conditions) {
      const value = condition.kind === 'expr' ? evaluate(condition.expr) : undefined
      if (value === false) return false
      if (value !== true) all = undefined
    }
    return all
  }
  /** What an `if` leaves: the statements of the branch that applies, none, or itself when that isn't known. */
  function fold(statement: Stmt): readonly Stmt[] {
    if (statement.kind !== 'ifStmt') return [statement]
    const value = holds(statement)
    if (value === undefined) return [statement]
    const branch = value ? statement.then : statement.else
    return !branch ? [] : branch.kind === 'ifStmt' ? fold(branch) : branch.statements.flatMap(fold)
  }

  /** Whether an operand or a base is written here, where anything but a name, a literal, a call or a member needs parentheses. */
  const tight = (parent: Node, child: Node) => ['binary', 'unary', 'forceUnwrap', 'optionalChain'].includes(parent.kind) || parent.kind === 'memberAccess' || parent.kind === 'call' && parent.callee === child || parent.kind === 'subscript' && parent.base === child || parent.kind === 'ternary' && parent.condition === child
  /** Whether the source already has parentheses just around a span. */
  const wrapped = (start: number, end: number) => /\(\s*$/.test(text.slice(Math.max(0, start - 8), start)) && /^\s*\)/.test(text.slice(end, end + 8))

  /** Where a node is read: in a string interpolation, as the words of a `Text`, or elsewhere. */
  type Place = 'interpolated' | 'words' | undefined
  const placeOf = (parent: Node, child: Node, place: Place): Place => parent.kind === 'stringLiteral' || place === 'interpolated' ? 'interpolated'
    : parent.kind === 'call' && parent.callee.kind === 'identifier' && parent.callee.name === 'Text' && parent.args.length === 1 && !parent.args[0]!.label && parent.args[0]!.value === child ? 'words' : undefined
  /** The Swift of a node with what is inside it put in place and folded. */
  function out(node: Node, inTight = false, place?: Place): string {
    if (node.kind === 'identifier' || node.kind === 'memberAccess' && node.base?.kind === 'selfExpr') {
      const value = substitution(node as Expr)
      // A value over several lines takes the indent of the line it is read on.
      const written = (value && (place && value[place] || value.text))?.split('\n').map((line, i) => i && line ? indentOf(node.span.start) + line : line).join('\n')
      if (value) return inTight && !value.atomic && !wrapped(node.span.start, node.span.end) ? `(${written})` : written!
      if (node.kind === 'identifier' && renames.has(node.name)) return renames.get(node.name)!
    }
    if (node.kind === 'ternary') {
      const value = evaluate(node.condition)
      if (typeof value === 'boolean') return out(value ? node.then : node.else, inTight, place)
    }
    // `subtitle ?? "none"` is the value written out, or what stands in for nil, as words where a `Text` shows it.
    const left = node.kind === 'binary' && node.operator === '??' ? evaluate(node.left) : undefined
    if (node.kind === 'binary' && left !== undefined) {
      const kept = left === null ? node.right : node.left, written = out(kept, inTight, place)
      return place === 'words' && kept.kind === 'stringLiteral' && /[*_~`[]/.test(written) ? `verbatim: ${written}` : written
    }
    const edits: { start: number; end: number; text: string }[] = []
    if (node.kind === 'block') {
      for (const statement of node.statements) {
        const kept = fold(statement)
        if (kept.length === 1 && kept[0] === statement) { edits.push({ start: statement.span.start, end: statement.span.end, text: out(statement) }); continue }
        // A folded `if` gives way to its branch's views, each on a line of its own at the `if`'s indent, or to nothing, its line gone too.
        const lineStart = statement.span.start - indentOf(statement.span.start).length, ownLine = text[lineStart - 1] === '\n' || lineStart === 0
        const newline = text.indexOf('\n', statement.span.end), ownEnd = newline >= 0 && !text.slice(statement.span.end, newline).trim()
        const indent = indentOf(statement.span.start), eol = text.includes('\r\n') ? '\r\n' : '\n'
        if (ownLine && ownEnd) edits.push({ start: lineStart, end: kept.length ? newline - (text[newline - 1] === '\r' ? 1 : 0) : newline + 1, text: kept.map(s => indent + reindent(out(s), indentOf(s.span.start), indent)).join(eol) })
        else edits.push({ start: statement.span.start, end: statement.span.end, text: kept.map(s => out(s)).join('; ') })
      }
    } else forEachChild(node, child => {
      const written = out(child, tight(node, child), placeOf(node, child, place))
      if (written !== text.slice(child.span.start, child.span.end)) edits.push({ start: child.span.start, end: child.span.end, text: written })
    })
    let result = text.slice(node.span.start, node.span.end)
    for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start - node.span.start) + edit.text + result.slice(edit.end - node.span.start)
    return result
  }

  return block.statements.flatMap(fold).map(statement => {
    const value = statement.kind === 'returnStmt' ? statement.value : statement.kind === 'exprStmt' ? statement.expression : undefined
    return { text: reindent(out(value ?? statement), indentOf(statement.span.start), ''), expression: !!value, atomic: !value || atomic(value) }
  })
  /** Whether an expression needs no parentheses once its reads are put in place and what is constant folded. */
  function atomic(expr: Expr): boolean {
    const value = expr.kind === 'ternary' ? evaluate(expr.condition) : undefined
    if (expr.kind === 'ternary' && typeof value === 'boolean') return atomic(value ? expr.then : expr.else)
    return substitution(expr)?.atomic ?? isAtomic(expr)
  }
}
