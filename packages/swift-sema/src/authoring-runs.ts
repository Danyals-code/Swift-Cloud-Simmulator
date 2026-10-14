import type { SourceSpan } from '@studio/shared'
import { chainBase, type BinaryExpr, type Expr } from '@studio/swift-syntax'

/**
 * Texts joined with `+` (doc 18, Concern 2, item 12): `Text("Total: ") + Text("\(n)").bold()`.
 * Swift joins them into one Text, so Design reads one Text whose runs are the Texts it
 * joins, and a sum written in parentheses, `(A + B).font(.title)`, has modifiers of its own.
 */
export interface JoinedText {
  /** The sum itself, inside any parentheses. */
  readonly sum: BinaryExpr
  /** Each run, in order: a Text's call and its modifiers, or a joined text in parentheses with modifiers of its own. */
  readonly runs: readonly Expr[]
  /** Where the parentheses around a sum with modifiers of its own open and close; null for a sum written bare. */
  readonly parenthesised: SourceSpan | null
}

/**
 * `expr` read as a joined text, or null when it is not one, or when any part of it is
 * not certainly a Text: `isText` says whether a call is SwiftUI's `Text`. A sum's left
 * side may itself be a sum, `A + B + C` is `(A + B) + C`, and its runs are all of theirs.
 */
export function joinedText(expr: Expr, text: string, isText: (call: Expr) => boolean): JoinedText | null {
  // Written bare, the sum is the expression; in parentheses, it is where its modifiers start.
  const sum = expr.kind === 'binary' ? expr : chainBase(expr)
  if (sum.kind !== 'binary' || sum.operator !== '+') return null
  const runs: Expr[] = []
  const collect = (part: Expr): boolean => {
    if (part.kind === 'binary' && part.operator === '+') return collect(part.left) && collect(part.right)
    const call = chainBase(part)
    if (call.kind === 'call' ? !isText(call) : !joinedText(part, text, isText)) return false
    runs.push(part)
    return true
  }
  if (!collect(sum)) return null
  if (sum === expr) return { sum, runs, parenthesised: null }
  // The parser keeps no node for parentheses: they close at the first `)` after the sum.
  const close = text.indexOf(')', sum.span.end)
  return close < 0 || text.slice(sum.span.end, close).trim() ? null : { sum, runs, parenthesised: { file: sum.span.file, start: expr.span.start, end: close + 1 } }
}
