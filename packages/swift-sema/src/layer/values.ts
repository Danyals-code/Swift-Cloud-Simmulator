import { isConditional, type Conditional, type Length, type SourceSpan, type TokenLength } from '@studio/shared'
import type { Expr, TernaryExpr } from '@studio/swift-syntax'
import { raw } from '../authoring-context'
import type { LayerContext } from './context'
import { LENGTH_HOSTS, declarationOf, literalNumber, resolveConstant } from './tokens'

/**
 * Numbers and tokens, read and written the same way by every section: one test for a
 * number as written, and one for a token the panel keeps linked and writes back.
 */

/** An expression as written, without the space around it. */
export const sourceOf = (ctx: Pick<LayerContext, 'text'>, expr: Expr) => ctx.text.slice(expr.span.start, expr.span.end).trim()

/**
 * A number literal as written, `12`, `0.5` or `-4`, or undefined for anything else. A
 * negative one is undefined too where `signed` is false, as for a colour's channel.
 */
export function numberIn(written: string, signed = true): number | undefined {
  return /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(written) && (signed || written[0] !== '-') ? Number(written) : undefined
}

/** The number literal an expression is, read the same way. */
export const numberOf = (value: Expr, ctx: Pick<LayerContext, 'text'>, signed?: boolean) => numberIn(sourceOf(ctx, value), signed)

/** A token as the panel writes it back: a name, `.member` or `Type.member`, and nothing that could run. */
export const isToken = (written: string) => /^\.?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(written)

/** A token that can name a constant: not a member read off an instance, `model.gap`, or off a member, `.space.large`. */
export const isConstantToken = (written: string) => isToken(written) && !/^(?:\.|[a-z])\w*\./.test(written)

/** Where a value is read: the file, and the project and struct its constants are declared in, with the constants it is linked to so far. */
type ValueSite = Pick<LayerContext, 'text' | 'project' | 'linked'>

/**
 * A length read through a token, linked: its token as written, after adding what it is
 * declared as to `ctx.linked` when it is a constant the panel can read (Wave 3b), a `let` of
 * the view's struct, a type's `static let`, an `extension CGFloat` member, or a global `let`:
 * its number, or the expression it is worked out from, `8 * 2`. `at` is where it is read,
 * which decides what a bare name is.
 */
export function linkLength(written: string, ctx: Omit<ValueSite, 'text'>, at: SourceSpan): TokenLength {
  const constant = !ctx.linked.has(written) ? resolveConstant(ctx.project, written, at, LENGTH_HOSTS) : undefined
  if (constant) {
    const value = literalNumber(constant.initializer), declaration = declarationOf(ctx.project, constant)
    ctx.linked.set(written, value !== undefined ? { value, declaration } : { expression: raw(ctx.project, constant.initializer.span).trim(), declaration })
  }
  return { token: written }
}

/** A number, or a token's expression as written; undefined for anything worked out at run time. */
function plainLengthOf(value: Expr, ctx: ValueSite): number | TokenLength | undefined {
  const written = sourceOf(ctx, value), number = numberIn(written)
  if (number !== undefined) return number
  const plain = (expr: Expr): boolean => expr.kind === 'identifier' || expr.kind === 'memberAccess' && (!expr.base || plain(expr.base))
  // A value reached through an instance, `proxy.size.width` or `model.gap`, is worked out at run time:
  // a token is a type's member, `Layout.gap`, an implicit one, `.space16`, or a constant's name.
  const root = (expr: Expr): Expr => expr.kind === 'memberAccess' && expr.base ? root(expr.base) : expr
  const base = root(value)
  const instance = base !== value && base.kind === 'identifier' && /^[a-z_]/.test(base.name)
  return plain(value) && !instance ? linkLength(written, ctx, value.span) : undefined
}

/**
 * A number, a token, or two of them a condition chooses between, `selected ? 16 : 8`
 * (Wave 3b); undefined for anything else worked out at run time.
 */
export function lengthOf(value: Expr, ctx: ValueSite): Length | undefined {
  if (value.kind !== 'ternary') return plainLengthOf(value, ctx)
  // `.infinity` is no length a case can be given in the panel.
  return casesOf(value, ctx, branch => branch.kind === 'memberAccess' && branch.member === 'infinity' ? undefined : plainLengthOf(branch, ctx))
}

/**
 * Two values a condition chooses between, `selected ? 16 : 8` (Wave 3b), each read as one
 * value is by `read`; undefined when either case can't be read.
 */
export function casesOf<T>(value: TernaryExpr, ctx: Pick<LayerContext, 'text'>, read: (branch: Expr) => T | undefined): Conditional<T> | undefined {
  const then = read(value.then), otherwise = read(value.else)
  return then === undefined || otherwise === undefined ? undefined : { condition: sourceOf(ctx, value.condition), then, otherwise }
}

/** A length as Swift: the number, the token's expression as it was written, or the condition choosing between two. */
export function lengthSource(length: Length): string {
  if (typeof length === 'number') return String(length)
  if (isConditional(length)) return `${length.condition} ? ${lengthSource(length.then)} : ${lengthSource(length.otherwise)}`
  return length.token
}

/**
 * Whether a length can be written back: a number, a token that is a name and nothing that
 * could run, or a condition as it was read choosing between two of those.
 */
export function writableLength(length: Length | undefined, valid: (number: number) => boolean): boolean {
  if (typeof length === 'number') return valid(length)
  if (!length) return false
  if (isConditional(length)) return !!length.condition.trim() && !isConditional(length.then) && !isConditional(length.otherwise) && writableLength(length.then, valid) && writableLength(length.otherwise, valid)
  return isToken(length.token)
}

/** A number or two a condition chooses between, in a value that takes no token, such as an opacity (Wave 3b). */
export function amountOf(value: Expr, ctx: Pick<LayerContext, 'text'>, signed?: boolean): number | Conditional<number> | undefined {
  return value.kind === 'ternary' ? casesOf(value, ctx, branch => numberOf(branch, ctx, signed)) : numberOf(value, ctx, signed)
}

/** Why a value a condition chooses can't be replaced by one plain value, for `what` the value is. */
export const conditionKept = (what: string, condition: string) => `This view’s ${what} depends on ${condition}: change each case in the panel. Change it in Code to give it one value.`

/** Three places, finer than a colour channel's 1/255 step, as the panel writes every amount. */
export const amount = (value: number) => String(Math.round(value * 1000) / 1000)

/**
 * Checks a value a change gives against the one read in its place (Wave 3b): a condition
 * stays the one it was, so a drag on the canvas can't write over it and a change from the
 * panel writes only the condition the code has.
 *
 * `after` is null where the change takes the whole value away, which keeps no condition to
 * drop; undefined where the change leaves it out, as a switch from Fixed to Fill leaves out
 * the size, which drops the condition as one plain value would. `what` is what it is.
 */
export function keepCondition(before: unknown, after: unknown, what: string): void {
  if (isConditional(after) && !(isConditional(before) && before.condition === after.condition)) throw new Error(`A condition is written in Code. Change this view’s ${what} there.`)
  if (isConditional(before) && after !== null && !isConditional(after)) throw new Error(conditionKept(what, before.condition))
}
