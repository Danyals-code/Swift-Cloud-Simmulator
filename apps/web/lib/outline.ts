/**
 * A file's declarations, for the jump bar.
 *
 * Deliberately a scan and not a parse. The real parser lives in the worker and is
 * asked between compiles for completion and hover, where the round trip is paid
 * once per interaction; a breadcrumb updates on every cursor move, and a worker
 * call per keystroke to redraw a label is the wrong trade. What a breadcrumb needs
 * is a list of names and roughly where each one starts and ends, and that survives
 * being approximate: the worst case is the bar naming the declaration above the one
 * you are in for a moment, which is a cosmetic error a parse would spend 40 ms
 * avoiding.
 *
 * Nesting is tracked by brace depth, which is why string literals and comments are
 * skipped rather than ignored - a `"}"` inside a string would otherwise close a
 * type and orphan everything below it.
 */

export type DeclarationKind =
  | 'struct'
  | 'class'
  | 'enum'
  | 'protocol'
  | 'extension'
  | 'func'
  | 'var'
  | 'let'
  | 'init'

export interface Declaration {
  readonly kind: DeclarationKind
  readonly name: string
  /** Offset of the `struct` / `func` keyword. */
  readonly start: number
  /** Offset just past the declaration's closing brace, or the end of the file. */
  readonly end: number
  /** Brace depth at the declaration, so `body` inside `ContentView` nests under it. */
  readonly depth: number
}

const DECL = /\b(struct|class|enum|protocol|extension|func|init|var|let)\b/g

/**
 * Every declaration in a file, in source order.
 *
 * Only ones that own a brace block, plus stored properties - a `let id: Int` is
 * worth naming in an outline, and a `var body: some View` is the single most
 * jumped-to line in any SwiftUI file.
 */
export function declarationsIn(text: string): readonly Declaration[] {
  const skip = maskedRanges(text)
  const masked = (at: number) => skip.some(([from, to]) => at >= from && at < to)

  const out: Declaration[] = []
  const open: { index: number; depth: number }[] = []
  let depth = 0

  // One pass for braces, one for declarations, merged by walking both in order.
  const decls: { kind: DeclarationKind; name: string; start: number; nameEnd: number }[] = []
  DECL.lastIndex = 0
  for (let match = DECL.exec(text); match !== null; match = DECL.exec(text)) {
    const start = match.index
    if (masked(start)) continue
    // A keyword has to start a word: `funcs` and `myVar` are not declarations.
    if (start > 0 && /[A-Za-z0-9_.]/.test(text[start - 1]!)) continue

    const kind = match[1] as DeclarationKind
    const after = start + match[1]!.length
    const name = kind === 'init' ? 'init' : nameAfter(text, after)
    if (!name) continue

    decls.push({ kind, name, start, nameEnd: after })
  }

  let next = 0
  for (let i = 0; i < text.length; i++) {
    if (masked(i)) continue
    const char = text[i]

    while (next < decls.length && decls[next]!.start <= i) {
      const decl = decls[next]!
      out.push({ ...decl, end: text.length, depth })
      open.push({ index: out.length - 1, depth })
      next++
    }

    if (char === '{') depth++
    else if (char === '}') {
      depth--
      // Close every declaration that was opened at this depth. A `var` with no
      // block never gets one, and is closed by the next declaration instead.
      for (let j = open.length - 1; j >= 0; j--) {
        if (open[j]!.depth !== depth) continue
        const entry = open.splice(j, 1)[0]!
        const decl = out[entry.index]!
        out[entry.index] = { ...decl, end: i + 1 }
        break
      }
    }
  }

  // Anything still open ends where the next sibling starts, so a stored property
  // does not swallow the rest of its type.
  for (const entry of open) {
    const decl = out[entry.index]!
    if (decl.end !== text.length) continue
    const sibling = out.find((other) => other.start > decl.start && other.depth <= decl.depth)
    out[entry.index] = { ...decl, end: sibling ? sibling.start : text.length }
  }

  return out
}

/** The chain of declarations containing `offset`, outermost first. */
export function declarationPathAt(
  declarations: readonly Declaration[],
  offset: number,
): readonly Declaration[] {
  return declarations
    .filter((decl) => offset >= decl.start && offset < decl.end)
    .sort((a, b) => a.depth - b.depth || a.start - b.start)
}

/** The identifier immediately after `at`, skipping spaces. */
function nameAfter(text: string, at: number): string | null {
  let i = at
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++
  const start = i
  while (i < text.length && /[A-Za-z0-9_]/.test(text[i]!)) i++
  return i > start ? text.slice(start, i) : null
}

/**
 * Ranges that must not be read as code: string literals, and both comment forms.
 *
 * Returned as ranges rather than stripped, because every offset this module hands
 * back has to index the original text - the editor scrolls to it.
 */
function maskedRanges(text: string): readonly [number, number][] {
  const ranges: [number, number][] = []
  let i = 0

  while (i < text.length) {
    const char = text[i]

    if (char === '"') {
      const multiline = text.startsWith('"""', i)
      const close = multiline ? '"""' : '"'
      let j = i + close.length
      while (j < text.length) {
        if (text[j] === '\\') {
          j += 2
          continue
        }
        if (text.startsWith(close, j)) {
          j += close.length
          break
        }
        if (!multiline && text[j] === '\n') break
        j++
      }
      ranges.push([i, j])
      i = j
      continue
    }

    if (char === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      const stop = end === -1 ? text.length : end
      ranges.push([i, stop])
      i = stop
      continue
    }

    if (char === '/' && text[i + 1] === '*') {
      // Swift's block comments nest, so a naive search for the first `*/` closes
      // the wrong one.
      let depth = 1
      let j = i + 2
      while (j < text.length && depth > 0) {
        if (text.startsWith('/*', j)) {
          depth++
          j += 2
        } else if (text.startsWith('*/', j)) {
          depth--
          j += 2
        } else j++
      }
      ranges.push([i, j])
      i = j
      continue
    }

    i++
  }

  return ranges
}
