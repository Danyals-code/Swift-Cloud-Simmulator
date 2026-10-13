import type { CallArgument } from './host'
import { asProjection, bool, int, NIL, str, type OpaqueValue, type SwiftValue } from './values'

/**
 * Foundation's `Scanner`, as far as a `Color(hex:)` initialiser reads a string with it.
 *
 * It skips leading whitespace, as Foundation's default `charactersToBeSkipped` does, and
 * nothing else: `Scanner(string: "#FF8000").scanHexInt64(&rgb)` finds no digits and
 * leaves `rgb` as it was, on a device and here alike.
 */

export const SCANNER_TYPE = 'Scanner'

interface ScannerPayload {
  readonly text: string
  /** Mutable: scanning moves it on. */
  at: number
}

export function scannerValue(text: string): OpaqueValue {
  return { kind: 'opaque', typeName: SCANNER_TYPE, payload: { text, at: 0 } satisfies ScannerPayload }
}

export function callScannerMember(target: OpaqueValue, member: string, args: readonly CallArgument[]): SwiftValue | undefined {
  const scanner = target.payload as ScannerPayload
  const skip = () => {
    while (scanner.at < scanner.text.length && /\s/.test(scanner.text[scanner.at]!)) scanner.at++
  }
  // Digits in a base from where the scanner is, after an optional `0x` for hex; null
  // with the scanner unmoved when there are none.
  const scanNumber = (hex: boolean): number | null => {
    skip()
    const rest = scanner.text.slice(scanner.at)
    const match = hex ? /^(0[xX])?([0-9a-fA-F]+)/.exec(rest) : /^([+-]?[0-9]+)/.exec(rest)
    if (!match) return null
    scanner.at += match[0].length
    // Past what a preview integer holds, it holds the most it can, as Foundation does at UInt64's.
    return Math.min(hex ? parseInt(match[2]!, 16) : parseInt(match[1]!, 10), Number.MAX_SAFE_INTEGER)
  }
  const write = (value: number | null): SwiftValue => {
    if (value === null) return bool(false)
    asProjection(args[0]?.value)?.set(int(value))
    return bool(true)
  }

  switch (member) {
    case 'scanHexInt64':
    case 'scanHexInt32':
      return write(scanNumber(true))
    case 'scanInt':
    case 'scanInt64':
      // `scanInt(&n)` writes where it is given storage; `scanInt()` answers an optional.
      if (args[0]) return write(scanNumber(false))
      return optionalInt(scanNumber(false))
    case 'scanUInt64': {
      const representation = args.find((a) => a.label === 'representation')?.value
      const name = representation?.kind === 'opaque' ? (representation.payload as { name?: string }).name : undefined
      return optionalInt(scanNumber(name === 'hexadecimal'))
    }
    case 'scanString': {
      const wanted = args[0]?.value
      if (wanted?.kind !== 'string') return undefined
      skip()
      if (!scanner.text.startsWith(wanted.value, scanner.at)) return NIL
      scanner.at += wanted.value.length
      return str(wanted.value)
    }
    default:
      return undefined
  }
}

function optionalInt(value: number | null): SwiftValue {
  return value === null ? NIL : int(value)
}

/**
 * `CharacterSet`: Foundation's named sets, sets of given characters, and their inverses,
 * as far as `trimmingCharacters(in:)` reads them.
 */
export const CHARACTER_SET_TYPE = 'CharacterSet'

interface CharacterSetPayload {
  /** A named set, or null for `characters`. */
  readonly name: string | null
  readonly characters: string
  readonly inverted: boolean
}

const NAMED_SETS: Readonly<Record<string, RegExp>> = {
  whitespaces: /^[\p{Zs}\t]$/u,
  newlines: /^[\n\r\v\f\u0085\u2028\u2029]$/u,
  whitespacesAndNewlines: /^[\p{Zs}\t\n\r\v\f\u0085\u2028\u2029]$/u,
  decimalDigits: /^\p{Nd}$/u,
  letters: /^[\p{L}\p{M}]$/u,
  lowercaseLetters: /^\p{Ll}$/u,
  uppercaseLetters: /^[\p{Lu}\p{Lt}]$/u,
  alphanumerics: /^[\p{L}\p{M}\p{N}]$/u,
  punctuationCharacters: /^\p{P}$/u,
  symbols: /^\p{S}$/u,
}

/** `CharacterSet.alphanumerics`, or undefined for a name Foundation does not have here. */
export function namedCharacterSet(name: string): OpaqueValue | undefined {
  return NAMED_SETS[name] ? characterSetValue({ name, characters: '', inverted: false }) : undefined
}

/** `CharacterSet(charactersIn: "#")`. */
export function characterSetOf(characters: string): OpaqueValue {
  return characterSetValue({ name: null, characters, inverted: false })
}

/** `set.inverted`. */
export function characterSetProperty(target: OpaqueValue, member: string): SwiftValue | undefined {
  const set = target.payload as CharacterSetPayload
  return member === 'inverted' ? characterSetValue({ ...set, inverted: !set.inverted }) : undefined
}

/**
 * Whether a character is in a set: a `CharacterSet` value, or a named one written with
 * a leading dot, `.whitespaces`. Null when the value is no set this knows.
 */
export function inCharacterSet(value: SwiftValue | undefined, character: string): boolean | null {
  if (value?.kind !== 'opaque') return null
  if (value.typeName === CHARACTER_SET_TYPE) {
    const set = value.payload as CharacterSetPayload
    const found = set.name ? NAMED_SETS[set.name]!.test(character) : [...set.characters].includes(character)
    return found !== set.inverted
  }
  const name = (value.payload as { name?: unknown } | null)?.name
  return typeof name === 'string' && NAMED_SETS[name] ? NAMED_SETS[name].test(character) : null
}

function characterSetValue(payload: CharacterSetPayload): OpaqueValue {
  return { kind: 'opaque', typeName: CHARACTER_SET_TYPE, payload }
}
