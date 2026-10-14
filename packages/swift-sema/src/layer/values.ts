import type { Length } from '@studio/shared'
import type { Expr } from '@studio/swift-syntax'
import type { LayerContext } from './context'

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

/** A number, or a token's expression as written; undefined for anything worked out at run time. */
export function lengthOf(value: Expr, ctx: Pick<LayerContext, 'text'>): Length | undefined {
  const written = sourceOf(ctx, value), number = numberIn(written)
  if (number !== undefined) return number
  const plain = (expr: Expr): boolean => expr.kind === 'identifier' || expr.kind === 'memberAccess' && (!expr.base || plain(expr.base))
  // A value reached through an instance, `proxy.size.width` or `model.gap`, is worked out at run time:
  // a token is a type's member, `Layout.gap`, an implicit one, `.space16`, or a constant's name.
  const root = (expr: Expr): Expr => expr.kind === 'memberAccess' && expr.base ? root(expr.base) : expr
  const base = root(value)
  const instance = base !== value && base.kind === 'identifier' && /^[a-z_]/.test(base.name)
  return plain(value) && !instance ? { token: written } : undefined
}

/** A length as Swift: the number, or the token's expression as it was written. */
export const lengthSource = (length: Length) => typeof length === 'number' ? String(length) : length.token

/** Three places, finer than a colour channel's 1/255 step, as the panel writes every amount. */
export const amount = (value: number) => String(Math.round(value * 1000) / 1000)
