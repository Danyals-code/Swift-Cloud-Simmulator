/**
 * The old-style (NeXTSTEP) property list format that `project.pbxproj` uses.
 *
 * Built as a serialiser over a data structure rather than string templates. A
 * pbxproj is a few hundred cross-referencing objects, and this file is the one
 * deliverable that cannot be verified without a Mac - so well-formedness has to be
 * structural, not something template strings are trusted to get right.
 *
 * The parser exists for the same reason: round-tripping the generated file proves
 * its syntax without an Xcode to open it in.
 */

export type PlistValue = string | readonly PlistValue[] | PlistDict

export interface PlistDict {
  readonly [key: string]: PlistValue
}

/** Trailing `/* comment *\/` annotations, keyed by object id, as Xcode writes them. */
export type PlistComments = ReadonlyMap<string, string>

/**
 * What Xcode itself leaves unquoted: alphanumerics, underscore and dot.
 *
 * The old-style plist grammar permits more - hyphens and slashes are legal bare -
 * but Xcode quotes them anyway, and matching Xcode is the conservative choice for a
 * file that cannot be verified without a Mac. `"-Onone"` and
 * `"com.apple.product-type.application"` are quoted for exactly this reason.
 */
const BARE_WORD_WRITE = /^[A-Za-z0-9_.]+$/

/**
 * What the parser accepts bare.
 *
 * Deliberately wider than what we write, so the parser can also read project files
 * Xcode produced rather than only its own output.
 */
const BARE_WORD_READ = /[A-Za-z0-9_$/:.-]/

export function quote(value: string): string {
  if (value.length > 0 && BARE_WORD_WRITE.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

function isDict(value: PlistValue): value is PlistDict {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Serialises a plist in Xcode's layout: tab-indented, one entry per line.
 *
 * Xcode rewrites the file to its own taste on first save. Matching its exact
 * formatting is therefore not worth chasing; being *valid* is everything.
 */
export function serializePlist(root: PlistDict, comments: PlistComments = new Map()): string {
  const out: string[] = ['// !$*UTF8*$!']
  writeDict(root, 1, out, comments)
  return out.join('\n') + '\n'
}

function annotate(key: string, comments: PlistComments): string {
  const comment = comments.get(key)
  return comment ? `${quote(key)} /* ${comment} */` : quote(key)
}

function writeDict(dict: PlistDict, depth: number, out: string[], comments: PlistComments): void {
  const indent = '\t'.repeat(depth - 1)
  const inner = '\t'.repeat(depth)

  if (depth === 1) out.push('{')
  else out[out.length - 1] += '{'

  for (const [key, value] of Object.entries(dict)) {
    const label = annotate(key, comments)

    if (isDict(value)) {
      out.push(`${inner}${label} = `)
      writeDict(value, depth + 1, out, comments)
      out[out.length - 1] += ';'
    } else if (Array.isArray(value)) {
      out.push(`${inner}${label} = (`)
      for (const entry of value) {
        if (typeof entry !== 'string') throw new Error('Only string arrays are supported')
        out.push(`${inner}\t${annotate(entry, comments)},`)
      }
      out.push(`${inner});`)
    } else {
      out.push(`${inner}${label} = ${annotate(String(value), comments)};`)
    }
  }

  out.push(`${indent}}`)
}

// ------------------------------------------------------------------- parsing

class PlistParser {
  private pos = 0

  constructor(private readonly text: string) {}

  parse(): PlistDict {
    this.skipTrivia()
    const value = this.parseValue()
    this.skipTrivia()
    if (this.pos < this.text.length) {
      throw new Error(`Trailing content at offset ${this.pos}`)
    }
    if (!isDict(value)) throw new Error('Root value is not a dictionary')
    return value
  }

  private skipTrivia(): void {
    for (;;) {
      while (this.pos < this.text.length && /\s/.test(this.text[this.pos]!)) this.pos++

      if (this.text.startsWith('//', this.pos)) {
        while (this.pos < this.text.length && this.text[this.pos] !== '\n') this.pos++
        continue
      }
      if (this.text.startsWith('/*', this.pos)) {
        const end = this.text.indexOf('*/', this.pos + 2)
        if (end === -1) throw new Error('Unterminated comment')
        this.pos = end + 2
        continue
      }
      return
    }
  }

  private parseValue(): PlistValue {
    const ch = this.text[this.pos]
    if (ch === '{') return this.parseDict()
    if (ch === '(') return this.parseArray()
    return this.parseString()
  }

  private parseDict(): PlistDict {
    this.expect('{')
    const out: Record<string, PlistValue> = {}

    for (;;) {
      this.skipTrivia()
      if (this.text[this.pos] === '}') {
        this.pos++
        return out
      }

      const key = this.parseString()
      this.skipTrivia()
      this.expect('=')
      this.skipTrivia()
      out[key] = this.parseValue()
      this.skipTrivia()
      this.expect(';')
    }
  }

  private parseArray(): PlistValue[] {
    this.expect('(')
    const out: PlistValue[] = []

    for (;;) {
      this.skipTrivia()
      if (this.text[this.pos] === ')') {
        this.pos++
        return out
      }

      out.push(this.parseValue())
      this.skipTrivia()
      // A trailing comma before `)` is legal and is what Xcode writes.
      if (this.text[this.pos] === ',') this.pos++
    }
  }

  private parseString(): string {
    if (this.text[this.pos] === '"') {
      this.pos++
      let value = ''
      while (this.pos < this.text.length && this.text[this.pos] !== '"') {
        if (this.text[this.pos] === '\\') {
          const next = this.text[this.pos + 1]
          value += next === 'n' ? '\n' : (next ?? '')
          this.pos += 2
          continue
        }
        value += this.text[this.pos]
        this.pos++
      }
      this.expect('"')
      return value
    }

    const start = this.pos
    while (this.pos < this.text.length && BARE_WORD_READ.test(this.text[this.pos]!)) this.pos++
    if (this.pos === start) {
      throw new Error(`Expected a value at offset ${this.pos}, found ${JSON.stringify(this.text[this.pos])}`)
    }
    return this.text.slice(start, this.pos)
  }

  private expect(char: string): void {
    if (this.text[this.pos] !== char) {
      throw new Error(
        `Expected '${char}' at offset ${this.pos}, found ${JSON.stringify(this.text[this.pos])}`,
      )
    }
    this.pos++
  }
}

export function parsePlist(text: string): PlistDict {
  return new PlistParser(text).parse()
}
