/**
 * How an SF Symbol name is looked up.
 *
 * The symbol set is organised by suffix: `star`, `star.fill`, `star.circle`,
 * `star.circle.fill` are one family, and a name nobody has drawn usually still has
 * a sensible base shape sitting one or two suffixes up. Stripping progressively is
 * what lets a table of eighty shapes answer for several hundred names.
 *
 * It lives in `shared` because two sides need the same answer and must not drift:
 * the worker, which decides whether a name is known at all (and therefore whether
 * to count it as missing coverage), and the renderer, which decides what to draw.
 */

/**
 * The names to try for `name`, most specific first.
 *
 * `star.circle.fill` yields `star.circle.fill`, `star.circle`, `star`. An
 * underscored spelling is offered alongside each, because a table written as an
 * object literal cannot use a dotted key without quoting every one of them.
 */
export function symbolCandidates(name: string): readonly string[] {
  const normalised = name.trim()
  if (normalised.length === 0) return []

  const parts = normalised.split('.')
  const out: string[] = []

  for (let end = parts.length; end > 0; end--) {
    const candidate = parts.slice(0, end).join('.')
    out.push(candidate)
    const underscored = candidate.replace(/\./g, '_')
    if (underscored !== candidate) out.push(underscored)
  }

  return out
}

/** True when `name` carries the `.fill` variant anywhere in its suffixes. */
export function isFilledSymbol(name: string): boolean {
  return name.split('.').includes('fill')
}
