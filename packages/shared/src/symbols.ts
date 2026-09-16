/**
 * Legacy symbol-name helpers retained for API compatibility.
 *
 * The preview worker and renderer use exact definitions in `symbol-map.ts`.
 * Do not use suffix stripping for rendering: removing `.slash` or `.fill` can
 * change the meaning of a symbol.
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
