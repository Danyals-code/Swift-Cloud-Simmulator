/**
 * The inline Markdown a `LocalizedStringKey` title draws (Wave 6a): `**` and `__` bold,
 * `*` and `_` italic, `***` both, `` ` `` code, `~~` and `~` strikethrough, `[text](url)`,
 * a bare URL, an email address, `www.` and `<url>` a link, and `&amp;`-style entities, as
 * iOS 27 draws them (docs/parity/native/iphone18pro-text). Delimiters follow CommonMark's
 * flanking rules, so `5 * 3 * 2` and `snake_case` stay as written.
 */
export interface MarkdownSpan {
  readonly text: string
  readonly bold?: true
  readonly italic?: true
  readonly code?: true
  readonly strike?: true
  readonly link?: true
  /** The index of the value put into the literal this span stands for, its `text` empty. */
  readonly part?: number
}

/** Whether a title has anything Markdown could act on; the cheap test before parsing. */
export const MARKDOWN_MARK = /[*_`~[\\<&@]|:\/\/|www\./

type Style = Omit<MarkdownSpan, 'text' | 'part'>
interface Piece { text: string; style: Style }
interface Delimiter { char: string; count: number; at: number; open: boolean; close: boolean; length: number; piece: Piece }

const WHITESPACE = /\s/u
const PUNCTUATION = /[\p{P}\p{S}\udc00-\udfff]/u
const ESCAPABLE = /[!-/:-@[-`{-~]/
const WORD = /[\p{L}\p{N}]/u
const EMAIL_LOCAL = /[\w.+-]+$/
const EMAIL_DOMAIN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9_-]+)+/
const URI = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*$/
const ENTITY = /^&(#\d{1,7}|#[xX][\dA-Fa-f]{1,6}|[A-Za-z][A-Za-z\d]{1,31});/
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '\u00a9', reg: '\u00ae', trade: '\u2122', hellip: '\u2026',
  mdash: '\u2014', ndash: '\u2013', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', deg: '\u00b0', times: '\u00d7', euro: '\u20ac', pound: '\u00a3', bull: '\u2022', middot: '\u00b7',
}

/**
 * A value put into a literal stands in the parsed text as one lone surrogate, which no
 * Swift String can hold, so it never meets a character of the literal's own. The flanking
 * rules count it as punctuation, as iOS counts its `%@`: `"x**\(name)**y"` stays as written.
 */
const ATOM = 0xdc00
/** A lone low surrogate: one not after a high one, which an emoji's would be. */
const ATOMS = /((?<![\ud800-\udbff])[\udc00-\udfff])/

const cache = new Map<string, readonly MarkdownSpan[] | null>()

/**
 * The spans a title draws, or null when Markdown changes nothing in it. A literal with
 * values put into it is given as its parts, `[text, value, text, …]`: the values (odd
 * indexes) are never read, only their places, and each comes back as a span with `part`.
 */
export function markdownSpans(source: string | readonly string[]): readonly MarkdownSpan[] | null {
  let joined = typeof source === 'string' ? source : source[0] ?? ''
  if (typeof source !== 'string') for (let i = 1; i < source.length; i += 2) joined += String.fromCharCode(ATOM + (i >> 1)) + (source[i + 1] ?? '')
  let spans = cache.get(joined)
  if (spans === undefined) {
    if (cache.size > 255) cache.clear()
    cache.set(joined, spans = spansOf(joined))
  }
  return spans
}

function spansOf(source: string): readonly MarkdownSpan[] | null {
  const out: MarkdownSpan[] = []
  for (const piece of parse(source, {})) {
    if (!piece.text) continue
    const last = out[out.length - 1]
    if (last && sameStyle(last, piece.style)) out[out.length - 1] = { ...last, text: last.text + piece.text }
    else out.push({ text: piece.text, ...piece.style })
  }
  if (out.length === 1 && out[0]!.text === source && sameStyle(out[0]!, {})) return null
  if (!ATOMS.test(source)) return out
  return out.flatMap((span) => span.text.split(ATOMS).flatMap((text, i) =>
    i % 2 ? [{ ...span, text: '', part: (text.charCodeAt(0) - ATOM) * 2 + 1 }] : text ? [{ ...span, text }] : []))
}

function sameStyle(a: Style, b: Style): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.code === b.code && a.strike === b.strike && a.link === b.link
}

function parse(source: string, style: Style): Piece[] {
  const pieces: Piece[] = []
  const delimiters: Delimiter[] = []
  let text = ''
  const flush = () => { if (text) pieces.push({ text, style }); text = '' }
  const link = (words: string, end: number) => { flush(); pieces.push({ text: words, style: { ...style, link: true } }); return end }
  for (let i = 0; i < source.length;) {
    const c = source[i]!
    if (c === '\\' && ESCAPABLE.test(source[i + 1] ?? '')) { text += source[i + 1]; i += 2; continue }
    const run = runLength(source, i)
    if (c === '`') {
      const end = source.indexOf('`'.repeat(run), i + run)
      if (end >= 0 && source[end + run] !== '`') {
        let code = source.slice(i + run, end)
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1)
        flush(); pieces.push({ text: code, style: { ...style, code: true } }); i = end + run; continue
      }
      text += source.slice(i, i + run); i += run; continue
    }
    if (c === '[') {
      const close = source.indexOf(']', i + 1)
      const end = close >= 0 && source[close + 1] === '(' ? destinationEnd(source, close + 2) : -1
      if (end >= 0 && !source.slice(i + 1, close).includes('[')) {
        flush(); pieces.push(...parse(source.slice(i + 1, close), { ...style, link: true })); i = end + 1; continue
      }
    }
    if (c === '<') {
      const end = source.indexOf('>', i)
      const inside = source.slice(i + 1, end)
      if (end > i && (URI.test(inside) || EMAIL_DOMAIN.test(inside.slice(inside.indexOf('@') + 1)) && /^[\w.+-]+@/.test(inside))) { i = link(inside, end + 1); continue }
    }
    if (c === '&') {
      const entity = ENTITY.exec(source.slice(i, i + 40))
      const name = entity?.[1]
      const decoded = !name ? undefined : name[0] !== '#' ? ENTITIES[name] : String.fromCodePoint(parseInt(name[1] === 'x' || name[1] === 'X' ? name.slice(2) : name.slice(1), name[1] === 'x' || name[1] === 'X' ? 16 : 10) || 0xfffd)
      if (decoded) { text += decoded; i += entity![0].length; continue }
    }
    if ((c === 'h' || c === 'w') && !WORD.test(source[i - 1] ?? ' ')) {
      const end = autolinkEnd(source, i)
      if (end > i) { i = link(source.slice(i, end), end); continue }
    }
    if (c === '@') {
      const local = EMAIL_LOCAL.exec(text)?.[0]
      const domain = local && EMAIL_DOMAIN.exec(source.slice(i + 1))?.[0].replace(/[._-]+$/, '')
      if (local && domain) { text = text.slice(0, -local.length); i = link(`${local}@${domain}`, i + 1 + domain.length); continue }
    }
    if (c === '*' || c === '_' || (c === '~' && run <= 2)) {
      const before = source[i - 1] ?? ' ', after = source[i + run] ?? ' '
      const left = !WHITESPACE.test(after) && (!PUNCTUATION.test(after) || WHITESPACE.test(before) || PUNCTUATION.test(before))
      const right = !WHITESPACE.test(before) && (!PUNCTUATION.test(before) || WHITESPACE.test(after) || PUNCTUATION.test(after))
      const open = c === '_' ? left && (!right || PUNCTUATION.test(before)) : left
      const close = c === '_' ? right && (!left || PUNCTUATION.test(after)) : right
      flush()
      const piece = { text: source.slice(i, i + run), style }
      pieces.push(piece)
      if (open || close) delimiters.push({ char: c, count: run, length: run, at: pieces.length - 1, open, close, piece })
      i += run; continue
    }
    text += c; i++
  }
  flush()
  emphasise(pieces, delimiters)
  return pieces
}

function runLength(source: string, at: number): number {
  let end = at
  while (source[end] === source[at]) end++
  return end - at
}

/** Where a link's `(url)` ends: its parentheses may hold balanced pairs, `(https://a.com/(x))`. */
function destinationEnd(source: string, from: number): number {
  for (let i = from, depth = 0; i < source.length; i++) {
    if (source[i] === '(') depth++
    else if (source[i] === ')' && depth-- === 0) return i
  }
  return -1
}

/**
 * Where a bare `https://` or `www.` link starting at `at` ends, or `at` when none does:
 * up to the next space, less trailing punctuation and a `)` it doesn't open, as GitHub's
 * extended autolinks, which iOS follows.
 */
function autolinkEnd(source: string, at: number): number {
  const head = /^(?:https?:\/\/|www\.)[^\s<]*/.exec(source.slice(at))?.[0]
  if (!head || !/[^./]\./.test(head.replace(/^https?:\/\//, ''))) return at
  let end = head.length
  while (end > 0 && /[?!.,:*_~'"]/.test(head[end - 1]!)) end--
  while (head[end - 1] === ')' && head.slice(0, end).split(')').length > head.slice(0, end).split('(').length) end--
  return at + end
}

/**
 * CommonMark's "process emphasis": each closer takes the nearest opener of its kind
 * before it, two characters for bold where both have two, else one for italic, and
 * styles what lies between. Tildes strike, one or two, the opener's as many as the closer's.
 */
function emphasise(pieces: Piece[], delimiters: Delimiter[]): void {
  for (let c = 0; c < delimiters.length; c++) {
    const closer = delimiters[c]!
    while (closer.close && closer.count > 0) {
      let o = c - 1
      for (; o >= 0; o--) {
        const opener = delimiters[o]!
        if (opener.char !== closer.char || !opener.open || opener.count === 0) continue
        if (closer.char === '~' && opener.length !== closer.length) continue
        const both = opener.close || closer.open
        if (closer.char !== '~' && both && (opener.length + closer.length) % 3 === 0 && (opener.length % 3 !== 0 || closer.length % 3 !== 0)) continue
        break
      }
      if (o < 0) break
      const opener = delimiters[o]!
      const used = closer.char === '~' ? closer.count : opener.count >= 2 && closer.count >= 2 ? 2 : 1
      const mark: Style = closer.char === '~' ? { strike: true } : used === 2 ? { bold: true } : { italic: true }
      for (let p = opener.at + 1; p < closer.at; p++) pieces[p]!.style = { ...pieces[p]!.style, ...mark }
      // Delimiters between the two can no longer match anything.
      for (let d = o + 1; d < c; d++) delimiters[d]!.count = 0
      opener.count -= used
      closer.count -= used
      opener.piece.text = opener.piece.text.slice(used)
      closer.piece.text = closer.piece.text.slice(used)
    }
  }
}
