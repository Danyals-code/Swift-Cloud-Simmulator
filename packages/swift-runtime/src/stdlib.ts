import type { CallArgument } from './host'
import {
  applyKeyPath,
  array,
  asDate,
  asIndexSet,
  asKeyPath,
  asURL,
  asUUID,
  bool,
  copyValue,
  dateDescription,
  dateValue,
  describe,
  dictionaryKey,
  double,
  formatDouble,
  graphemes,
  int,
  NIL,
  numericValue,
  str,
  tuple,
  typeNameOf,
  urlValue,
  valuesEqual,
  VOID,
  type ClosureValue,
  type SwiftValue,
} from './values'

type Invoke = (closure: ClosureValue, args: readonly SwiftValue[]) => SwiftValue
type Trap = (reason: string) => never

/**
 * Writes a new value into the storage the receiver came from.
 *
 * `append` and `sort` mutate the array object in place, so the caller sees the change
 * for free. A scalar has nothing to mutate: `flag.toggle()` has to *replace* the
 * receiver, and only the interpreter knows where it lives. It supplies this, and
 * traps when the receiver is not assignable.
 */
type ReplaceSelf = (value: SwiftValue) => void

/**
 * Swift's rounding rule: halves go away from zero.
 *
 * `Math.round` breaks ties towards positive infinity, so it answers -1 for -1.5 where
 * Swift answers -2. One value in four hundred, and wrong in the direction that shows
 * up in a total rather than in a test.
 */
function roundedAwayFromZero(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n)
}

/**
 * Standard library shims for the supported subset.
 *
 * Coverage is chosen by what the slice's code actually calls, not by mirroring the
 * real stdlib. Anything missing falls through to the interpreter's "has no member"
 * trap, which names the member - so a gap reports as a precise, actionable message
 * rather than as a wrong answer.
 */

// -------------------------------------------------------------- properties

/** Member access with no call: `text.count`, `items.isEmpty`, `range.lowerBound`. */
export function getBuiltinProperty(target: SwiftValue, member: string): SwiftValue | undefined {
  switch (target.kind) {
    case 'string': {
      // Grapheme clusters, not code points - see `graphemes` in values.ts.
      const chars = graphemes(target.value)
      switch (member) {
        case 'count':
          return int(chars.length)
        case 'isEmpty':
          return bool(target.value.length === 0)
        case 'first':
          return chars.length > 0 ? str(chars[0]!) : NIL
        case 'last':
          return chars.length > 0 ? str(chars[chars.length - 1]!) : NIL
        case 'description':
          return str(target.value)
        case 'capitalized':
          // Foundation capitalises every word, not only the first.
          return str(target.value.replace(/(^|\s)(\S)/g, (_, gap: string, ch: string) => gap + ch.toUpperCase()))
        case 'unicodeScalars':
          // Code points, which is the entire difference from `count`: "👋🏽" is one
          // character and two scalars.
          return array([...target.value].map(str))
        case 'indices':
          return { kind: 'range', lower: 0, upper: chars.length, closed: false }
        default:
          return undefined
      }
    }

    case 'array':
      switch (member) {
        case 'count':
          return int(target.elements.length)
        case 'isEmpty':
          return bool(target.elements.length === 0)
        case 'first':
          return target.elements[0] ?? NIL
        case 'last':
          return target.elements[target.elements.length - 1] ?? NIL
        case 'indices':
          return { kind: 'range', lower: 0, upper: target.elements.length, closed: false }
        case 'description':
          return str(describe(target))
        default:
          return undefined
      }

    case 'dictionary':
      switch (member) {
        case 'count':
          return int(target.entries.size)
        case 'isEmpty':
          return bool(target.entries.size === 0)
        case 'keys':
          return array([...target.entries.keys()].map(str))
        case 'values':
          return array([...target.entries.values()])
        default:
          return undefined
      }

    case 'range':
      switch (member) {
        case 'lowerBound':
          return int(target.lower)
        case 'upperBound':
          return int(target.upper)
        case 'count':
          return int(Math.max(0, target.upper - target.lower + (target.closed ? 1 : 0)))
        case 'isEmpty':
          return bool(target.upper - target.lower + (target.closed ? 1 : 0) <= 0)
        default:
          return undefined
      }

    case 'int':
      switch (member) {
        case 'description':
          return str(String(target.value))
        case 'magnitude':
          return int(Math.abs(target.value))
        default:
          return undefined
      }

    case 'double':
      switch (member) {
        case 'description':
          return str(formatDouble(target.value))
        case 'magnitude':
          return double(Math.abs(target.value))
        case 'isNaN':
          return bool(Number.isNaN(target.value))
        case 'isFinite':
          return bool(Number.isFinite(target.value))
        default:
          return undefined
      }

    case 'bool':
      return member === 'description' ? str(target.value ? 'true' : 'false') : undefined

    // `UUID`, `Date` and `URL`. Their stored form is deliberately unreachable - only
    // the members Foundation really publishes answer here.
    case 'opaque': {
      const uuid = asUUID(target)
      if (uuid) {
        if (member === 'uuidString') return str(uuid.uuidString)
        if (member === 'description') return str(uuid.uuidString)
        return undefined
      }

      const date = asDate(target)
      if (date) {
        switch (member) {
          case 'timeIntervalSince1970':
            return double(date.epochSeconds)
          case 'timeIntervalSinceReferenceDate':
            // Foundation's reference date is 1 January 2001, not 1970.
            return double(date.epochSeconds - 978_307_200)
          case 'description':
            return str(dateDescription(date.epochSeconds))
          default:
            return undefined
        }
      }

      const url = asURL(target)
      if (url) return urlProperty(url.absoluteString, member)

      return undefined
    }

    default:
      return undefined
  }
}

/**
 * The parts of a `URL`.
 *
 * Parsed with the platform's own `URL`, so an odd input is answered the way a browser
 * answers it rather than by a regular expression written here. A URL that will not
 * parse - which `URL(string:)` should already have rejected - reports the whole string
 * for `path` and nothing for the rest, which is what Foundation does for a relative one.
 */
function urlProperty(absoluteString: string, member: string): SwiftValue | undefined {
  let parsed: URL | null = null
  try {
    parsed = new URL(absoluteString)
  } catch {
    parsed = null
  }

  switch (member) {
    case 'absoluteString':
    case 'description':
      return str(absoluteString)
    case 'path':
      return str(parsed ? decodeURIComponent(parsed.pathname) : absoluteString)
    case 'host':
      return parsed && parsed.hostname !== '' ? str(parsed.hostname) : NIL
    case 'scheme':
      return parsed ? str(parsed.protocol.replace(/:$/, '')) : NIL
    case 'query':
      return parsed && parsed.search !== '' ? str(parsed.search.slice(1)) : NIL
    case 'lastPathComponent': {
      const path = parsed ? decodeURIComponent(parsed.pathname) : absoluteString
      const parts = path.split('/').filter((p) => p !== '')
      return str(parts[parts.length - 1] ?? '/')
    }
    case 'pathExtension': {
      const path = parsed ? parsed.pathname : absoluteString
      const last = path.split('/').pop() ?? ''
      const dot = last.lastIndexOf('.')
      return str(dot > 0 ? last.slice(dot + 1) : '')
    }
    default:
      return undefined
  }
}

// ----------------------------------------------------------------- methods

/**
 * Member calls on built-in types.
 *
 * Mutating methods (`append`, `remove`) mutate `target` in place. The interpreter
 * writes the value back through its lvalue afterwards, so `items.append(x)` reaches
 * the caller's storage rather than a copy.
 */
export function callBuiltinMember(
  target: SwiftValue,
  member: string,
  args: readonly CallArgument[],
  invoke: Invoke,
  trap: Trap,
  replaceSelf: ReplaceSelf,
): SwiftValue | undefined {
  const arg = (i: number): SwiftValue | undefined => args[i]?.value
  const labelled = (name: string): SwiftValue | undefined =>
    args.find((a) => a.label === name)?.value

  /**
   * The transform of a `map`, `filter` or `first(where:)`.
   *
   * A key path is a function in Swift - `map(\.name)` is how a collection of models
   * becomes a collection of one of their properties, and it is at least as common in
   * view code as the closure form. Accepting only a closure made it a hard error two
   * layers from the call, so both forms resolve to the same one-argument function
   * here rather than at every call site.
   */
  const unaryArg = (i = args.length - 1): ((value: SwiftValue) => SwiftValue) => {
    const value = args[i]?.value
    if (value?.kind === 'closure') return (element) => invoke(value, [element])

    const path = asKeyPath(value)
    if (path) return (element) => applyKeyPath(path, element)

    trap(`'${member}' requires a closure or key path argument`)
  }

  const closureArg = (i = args.length - 1): ClosureValue => {
    const value = args[i]?.value
    if (value?.kind !== 'closure') trap(`'${member}' requires a closure argument`)
    return value
  }

  switch (target.kind) {
    case 'string':
      return stringMethod(target.value, member, arg, labelled, replaceSelf, trap)

    case 'array':
      return arrayMethod(target, member, args, arg, labelled, closureArg, unaryArg, invoke, trap)

    case 'dictionary':
      switch (member) {
        case 'removeValue': {
          const key = labelled('forKey')
          if (!key) return undefined
          const k = dictionaryKey(key)
          const existing = target.entries.get(k) ?? NIL
          target.entries.delete(k)
          return existing
        }
        case 'updateValue': {
          const value = arg(0)
          const key = labelled('forKey')
          if (!value || !key) return undefined
          const k = dictionaryKey(key)
          const previous = target.entries.get(k) ?? NIL
          target.entries.set(k, copyValue(value))
          return previous
        }
        case 'keys':
          return array([...target.entries.keys()].map(str))
        case 'values':
          return array([...target.entries.values()])

        // A dictionary's element is a `(key: , value: )` tuple, which is what makes
        // `$0.key` read in all three of these.
        case 'mapValues': {
          const transform = unaryArg()
          const entries = new Map<string, SwiftValue>()
          for (const [k, v] of target.entries) entries.set(k, copyValue(transform(v)))
          return { kind: 'dictionary', entries }
        }
        case 'filter': {
          // `Dictionary.filter` answers a dictionary, unlike `Array.filter`.
          const predicate = unaryArg()
          const entries = new Map<string, SwiftValue>()
          for (const [k, v] of target.entries) {
            if (truthyOf(predicate(tuple([str(k), v], ['key', 'value'])))) entries.set(k, copyValue(v))
          }
          return { kind: 'dictionary', entries }
        }
        case 'sorted': {
          // Answers an *array* of pairs: a dictionary has no order to sort into.
          const by = labelled('by') ?? arg(args.length - 1)
          const pairs = [...target.entries].map(([k, v]) => tuple([str(k), v], ['key', 'value']))
          if (by?.kind === 'closure') pairs.sort((a, b) => (truthyOf(invoke(by, [a, b])) ? -1 : 1))
          else pairs.sort((a, b) => compareValues(a.elements[0]!, b.elements[0]!))
          return array(pairs)
        }
        case 'contains': {
          const predicate = unaryArg()
          const pairs = [...target.entries].map(([k, v]) => tuple([str(k), v], ['key', 'value']))
          return bool(pairs.some((pair) => truthyOf(predicate(pair))))
        }
        case 'map': {
          const transform = unaryArg()
          const pairs = [...target.entries].map(([k, v]) => tuple([str(k), v], ['key', 'value']))
          return array(pairs.map((pair) => copyValue(transform(pair))))
        }
        default:
          return undefined
      }

    case 'bool':
      switch (member) {
        case 'toggle':
          // Nothing to mutate in place - a Bool *is* its value - so the receiver is
          // replaced through the storage it came from.
          replaceSelf(bool(!target.value))
          return VOID
        default:
          return undefined
      }

    case 'int':
      switch (member) {
        case 'isMultiple': {
          const of = labelled('of') ?? arg(0)
          if (!of) return undefined
          const divisor = numericValue(of)
          return bool(divisor !== 0 && target.value % divisor === 0)
        }
        case 'quotientAndRemainder': {
          const by = labelled('dividingBy') ?? arg(0)
          if (!by) return undefined
          const divisor = numericValue(by)
          if (divisor === 0) trap('Division by zero')
          return tuple(
            [int(Math.trunc(target.value / divisor)), int(target.value % divisor)],
            ['quotient', 'remainder'],
          )
        }
        default:
          return undefined
      }

    case 'double':
      switch (member) {
        case 'rounded': {
          // `.rounded(.up)` and friends. The bare form rounds halves away from zero,
          // which is Swift's rule and not `Math.round`'s.
          const rule = arg(0)
          const name = rule?.kind === 'opaque' ? String((rule.payload as { name?: string }).name ?? '') : ''
          switch (name) {
            case 'up':
              return double(Math.ceil(target.value))
            case 'down':
              return double(Math.floor(target.value))
            case 'towardZero':
              return double(Math.trunc(target.value))
            case 'awayFromZero':
              return double(target.value < 0 ? Math.floor(target.value) : Math.ceil(target.value))
            default:
              return double(roundedAwayFromZero(target.value))
          }
        }
        case 'squareRoot':
          return double(Math.sqrt(target.value))
        case 'truncatingRemainder': {
          const by = labelled('dividingBy') ?? arg(0)
          if (!by) return undefined
          const divisor = numericValue(by)
          if (divisor === 0) trap('Division by zero')
          return double(target.value % divisor)
        }
        case 'isMultiple': {
          const of = labelled('of') ?? arg(0)
          if (!of) return undefined
          const divisor = numericValue(of)
          return bool(divisor !== 0 && target.value % divisor === 0)
        }
        default:
          return undefined
      }

    case 'range':
      switch (member) {
        case 'contains': {
          const value = arg(0)
          if (!value) return undefined
          const n = numericValue(value)
          return bool(n >= target.lower && (target.closed ? n <= target.upper : n < target.upper))
        }
        default:
          return undefined
      }

    case 'opaque': {
      const date = asDate(target)
      if (date) {
        switch (member) {
          case 'addingTimeInterval': {
            const interval = arg(0)
            return interval ? dateValue(date.epochSeconds + numericValue(interval)) : undefined
          }
          case 'timeIntervalSince': {
            const other = asDate(arg(0))
            return other ? double(date.epochSeconds - other.epochSeconds) : undefined
          }
          case 'formatted':
            // The locale-formatted form, which is what `formatted()` is for. The
            // locale is the browser's, so this is the only member of `Date` whose
            // answer legitimately differs between two machines.
            return str(
              new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
                new Date(date.epochSeconds * 1000),
              ),
            )
          case 'description':
            return str(dateDescription(date.epochSeconds))
          default:
            return undefined
        }
      }

      const url = asURL(target)
      if (url) {
        switch (member) {
          case 'appendingPathComponent': {
            const component = arg(0)
            if (component?.kind !== 'string') return undefined
            const base = url.absoluteString.replace(/\/$/, '')
            return urlValue(`${base}/${component.value}`)
          }
          case 'description':
            return str(url.absoluteString)
          default:
            return undefined
        }
      }

      return undefined
    }

    default:
      return undefined
  }
}

function stringMethod(
  value: string,
  member: string,
  arg: (i: number) => SwiftValue | undefined,
  labelled: (name: string) => SwiftValue | undefined,
  replaceSelf: ReplaceSelf,
  trap: Trap,
): SwiftValue | undefined {
  const text = (v: SwiftValue | undefined): string => {
    if (v?.kind !== 'string') trap(`'${member}' expects a String argument`)
    return v.value
  }

  /** How many characters a `prefix`/`dropFirst` style argument asks for, defaulting to 1. */
  const countArg = (fallback: number): number => {
    const first = arg(0)
    return first ? Math.max(0, Math.trunc(numericValue(first))) : fallback
  }

  // The members that count *characters* count grapheme clusters, so `"👋🏽ab".dropLast()`
  // keeps the emoji whole rather than splitting its modifier off. Split on demand:
  // `hasPrefix` and `uppercased` are called far more often and need none of it.
  let split: string[] | null = null
  const chars = (): string[] => (split ??= graphemes(value))

  switch (member) {
    case 'uppercased':
      return str(value.toUpperCase())
    case 'lowercased':
      return str(value.toLowerCase())
    case 'hasPrefix':
      return bool(value.startsWith(text(arg(0))))
    case 'hasSuffix':
      return bool(value.endsWith(text(arg(0))))
    case 'contains':
      return bool(value.includes(text(arg(0))))
    case 'replacingOccurrences': {
      const of = labelled('of')
      const with_ = labelled('with')
      if (!of || !with_) return undefined
      return str(value.split(text(of)).join(text(with_)))
    }
    case 'split': {
      const separator = labelled('separator') ?? arg(0)
      if (!separator) return undefined
      return array(value.split(text(separator)).map(str))
    }
    case 'trimmingCharacters':
      // The only `CharacterSet` the slice uses is `.whitespaces`.
      return str(value.trim())
    case 'starts':
      return bool(value.startsWith(text(labelled('with') ?? arg(0))))
    case 'reversed':
      // A `ReversedCollection` of Characters, so `String(text.reversed())` puts it
      // back together and `.count` counts characters. Reversing by grapheme keeps
      // "é" and "👋🏽" whole; reversing the code units would take them apart.
      return array([...chars()].reverse().map(str))
    case 'prefix':
      return str(chars().slice(0, countArg(1)).join(''))
    case 'suffix': {
      const n = countArg(1)
      return str(n === 0 ? '' : chars().slice(-n).join(''))
    }
    case 'dropFirst':
      return str(chars().slice(countArg(1)).join(''))
    case 'dropLast': {
      const n = countArg(1)
      return str(n === 0 ? value : chars().slice(0, Math.max(0, chars().length - n)).join(''))
    }
    case 'components': {
      // `components(separatedBy:)` is Foundation's; `split(separator:)` is the
      // standard library's, and the difference shows at the edges: components keeps
      // the empty strings that split drops.
      const separator = labelled('separatedBy') ?? arg(0)
      if (!separator) return undefined
      return array(value.split(text(separator)).map(str))
    }
    case 'padding': {
      // `padding(toLength:withPad:startingAt:)` truncates as well as pads, which is
      // the half people forget.
      const length = labelled('toLength')
      const pad = labelled('withPad')
      const startingAt = labelled('startingAt')
      if (!length || !pad) return undefined

      const target = Math.max(0, Math.trunc(numericValue(length)))
      if (chars().length >= target) return str(chars().slice(0, target).join(''))

      const padding = text(pad)
      if (padding.length === 0) return str(value)
      const start = startingAt ? Math.trunc(numericValue(startingAt)) : 0
      let out = value
      for (let i = 0; out.length < target; i++) out += padding[(start + i) % padding.length]!
      return str(out.slice(0, target))
    }
    case 'append': {
      const suffix = arg(0)
      if (!suffix) return undefined
      replaceSelf(str(value + text(suffix)))
      return VOID
    }
    case 'description':
      return str(value)
    default:
      return undefined
  }
}

function arrayMethod(
  target: Extract<SwiftValue, { kind: 'array' }>,
  member: string,
  args: readonly CallArgument[],
  arg: (i: number) => SwiftValue | undefined,
  labelled: (name: string) => SwiftValue | undefined,
  closureArg: (i?: number) => ClosureValue,
  unaryArg: (i?: number) => (value: SwiftValue) => SwiftValue,
  invoke: Invoke,
  trap: Trap,
): SwiftValue | undefined {
  /**
   * The predicate of a `(where:)` overload.
   *
   * A trailing closure carries no label, and `items.contains { $0.isDone }` is how
   * the overload is almost always written - so looking only for `where` misses it,
   * and the closure then falls through to the value branch where it compares
   * unequal to every element. That returns a confident wrong answer rather than an
   * error, which is the one failure mode worth going out of the way to prevent.
   *
   * A key path is a predicate too: `contains(where: \.isDone)`.
   */
  const predicateArg = (label: string): ((value: SwiftValue) => SwiftValue) | null => {
    const named = args.find((a) => a.label === label)?.value
    if (named?.kind === 'closure') return (element) => invoke(named, [element])

    const path = asKeyPath(named)
    if (path) return (element) => applyKeyPath(path, element)

    const last = args[args.length - 1]
    if (last && !last.label && last.value.kind === 'closure') {
      const closure = last.value
      return (element) => invoke(closure, [element])
    }
    return null
  }

  /** A position argument, bounds-checked the way Swift's own subscript is. */
  const indexArg = (value: SwiftValue | undefined, limit: number): number => {
    const index = Math.trunc(numericValue(value ?? NIL))
    if (Number.isNaN(index) || index < 0 || index > limit) trap('Index out of range')
    return index
  }

  /** The range a `…Subrange` method operates on. */
  const rangeArg = (value: SwiftValue | undefined): { start: number; end: number } => {
    if (value?.kind !== 'range') trap(`'${member}' expects a range`)
    const end = value.closed ? value.upper + 1 : value.upper
    if (value.lower < 0 || end > target.elements.length || value.lower > end) {
      trap('Range out of bounds')
    }
    return { start: value.lower, end }
  }

  switch (member) {
    // `move(fromOffsets:toOffset:)` - what `.onMove` calls.
    case 'move': {
      const from = asIndexSet(args.find((a) => a.label === 'fromOffsets')?.value)
      const toValue = args.find((a) => a.label === 'toOffset')?.value
      if (from && (toValue?.kind === 'int' || toValue?.kind === 'double')) {
        const moving = [...from]
          .sort((a, b) => a - b)
          .map((i) => target.elements[i])
          .filter((v): v is SwiftValue => v !== undefined)

        for (const index of [...from].sort((a, b) => b - a)) target.elements.splice(index, 1)

        // The destination is an offset into the *original* collection, so it shifts
        // by however many removed elements sat before it.
        const removedBefore = [...from].filter((i) => i < toValue.value).length
        target.elements.splice(Math.max(0, toValue.value - removedBefore), 0, ...moving)
        return VOID
      }
      break
    }

    case 'append': {
      // `append(contentsOf:)` concatenates a sequence; `append(_:)` adds one element.
      // Treating the first as the second produces an array with an array inside it,
      // which is wrong quietly - every later index is off by however many were meant
      // to be spliced in.
      const contents = labelled('contentsOf')
      if (contents) {
        if (contents.kind !== 'array') trap("'append(contentsOf:)' expects a sequence")
        target.elements.push(...contents.elements.map(copyValue))
        return VOID
      }

      const value = arg(0)
      if (!value) return undefined
      target.elements.push(copyValue(value))
      return VOID
    }
    case 'insert': {
      const value = arg(0)
      if (!value) return undefined

      // `Set.insert(_:)` has no position and refuses a duplicate, returning whether
      // it took. `Array.insert(_:at:)` always takes and returns nothing.
      const at = labelled('at')
      if (!at) {
        if (!target.unique) return undefined
        const present = target.elements.some((e) => valuesEqual(e, value))
        if (!present) target.elements.push(copyValue(value))
        return bool(!present)
      }

      const index = numericValue(at)
      if (index < 0 || index > target.elements.length) trap('Index out of range')
      target.elements.splice(index, 0, copyValue(value))
      return VOID
    }
    case 'remove': {
      // `remove(atOffsets:)` is what `.onDelete` calls. The indices are walked in
      // descending order so that each deletion cannot shift the position of one still
      // to come - the classic way this goes wrong is deleting the wrong rows.
      const offsets = asIndexSet(labelled('atOffsets'))
      if (offsets) {
        for (const index of [...offsets].sort((a, b) => b - a)) {
          if (index >= 0 && index < target.elements.length) target.elements.splice(index, 1)
        }
        return VOID
      }

      const at = labelled('at')
      if (!at) return undefined
      const index = numericValue(at)
      if (index < 0 || index >= target.elements.length) trap('Index out of range')
      return target.elements.splice(index, 1)[0] ?? NIL
    }
    case 'removeAll': {
      // `removeAll(where:)` keeps everything the predicate rejects. Ignoring the
      // predicate and truncating is the most destructive thing in the library: the
      // call looks like it worked and the data is gone.
      const predicate = predicateArg('where')
      if (predicate) {
        const kept = target.elements.filter((e) => !truthyOf(predicate(e)))
        target.elements.length = 0
        target.elements.push(...kept)
        return VOID
      }

      target.elements.length = 0
      return VOID
    }
    case 'removeLast':
      if (target.elements.length === 0) trap("Can't remove last element from an empty collection")
      return target.elements.pop() ?? NIL
    case 'removeFirst':
      // Traps on empty, like `removeLast`. `popLast` is the one that answers nil.
      if (target.elements.length === 0) trap("Can't remove first element from an empty collection")
      return target.elements.shift() ?? NIL
    case 'popLast':
      return target.elements.length === 0 ? NIL : (target.elements.pop() ?? NIL)
    case 'removeSubrange': {
      const { start, end } = rangeArg(arg(0))
      target.elements.splice(start, end - start)
      return VOID
    }
    case 'replaceSubrange': {
      const { start, end } = rangeArg(arg(0))
      const replacement = labelled('with')
      if (replacement?.kind !== 'array') trap("'replaceSubrange(_:with:)' expects a collection")
      target.elements.splice(start, end - start, ...replacement.elements.map(copyValue))
      return VOID
    }
    case 'swapAt': {
      const last = target.elements.length - 1
      const i = indexArg(arg(0), last)
      const j = indexArg(arg(1), last)
      const held = target.elements[i]!
      target.elements[i] = target.elements[j]!
      target.elements[j] = held
      return VOID
    }
    case 'sort': {
      // The in-place twin of `sorted`. Same comparator rules, no return value.
      const by = labelled('by') ?? (args.length > 0 ? arg(args.length - 1) : undefined)
      if (by?.kind === 'closure') target.elements.sort((a, b) => (truthyOf(invoke(by, [a, b])) ? -1 : 1))
      else target.elements.sort(compareValues)
      return VOID
    }
    case 'reverse':
      target.elements.reverse()
      return VOID
    case 'shuffle':
      shuffleInPlace(target.elements)
      return VOID
    case 'contains': {
      // `contains(where:)` takes a predicate; `contains(_:)` takes a value.
      const predicate = predicateArg('where')
      if (predicate) return bool(target.elements.some((e) => truthyOf(predicate(e))))

      const value = arg(0)
      return value ? bool(target.elements.some((e) => valuesEqual(e, value))) : undefined
    }
    case 'allSatisfy': {
      const predicate = unaryArg()
      return bool(target.elements.every((e) => truthyOf(predicate(e))))
    }
    case 'first': {
      // The property form is `getBuiltinProperty`'s; this is `first(where:)`.
      const predicate = predicateArg('where')
      if (!predicate) return undefined
      return target.elements.find((e) => truthyOf(predicate(e))) ?? NIL
    }
    case 'last': {
      const predicate = predicateArg('where')
      if (!predicate) return undefined
      return [...target.elements].reverse().find((e) => truthyOf(predicate(e))) ?? NIL
    }
    case 'firstIndex': {
      const predicate = predicateArg('where')
      if (predicate) {
        const found = target.elements.findIndex((e) => truthyOf(predicate(e)))
        return found >= 0 ? int(found) : NIL
      }

      const of = labelled('of') ?? arg(0)
      if (!of) return undefined
      const index = target.elements.findIndex((e) => valuesEqual(e, of))
      return index >= 0 ? int(index) : NIL
    }
    case 'lastIndex': {
      const predicate = predicateArg('where')
      const found = predicate
        ? target.elements.map((e) => truthyOf(predicate(e))).lastIndexOf(true)
        : (() => {
            const of = labelled('of') ?? arg(0)
            return of ? target.elements.map((e) => valuesEqual(e, of)).lastIndexOf(true) : -1
          })()
      return found >= 0 ? int(found) : NIL
    }
    case 'map': {
      const transform = unaryArg()
      return array(target.elements.map((e) => copyValue(transform(e))))
    }
    case 'compactMap': {
      const transform = unaryArg()
      return array(
        target.elements
          .map((e) => transform(e))
          .filter((v) => v.kind !== 'nil')
          .map(copyValue),
      )
    }
    case 'flatMap': {
      // One level, which is what `flatMap` means on a collection of collections. A
      // transform answering a non-collection contributes itself, so the shape of the
      // result never depends on how many elements happened to be arrays.
      const transform = unaryArg()
      const flattened: SwiftValue[] = []
      for (const element of target.elements) {
        const produced = transform(element)
        if (produced.kind === 'array') flattened.push(...produced.elements.map(copyValue))
        else flattened.push(copyValue(produced))
      }
      return array(flattened)
    }
    case 'filter': {
      const predicate = unaryArg()
      return array(target.elements.filter((e) => truthyOf(predicate(e))).map(copyValue))
    }
    case 'forEach': {
      const body = unaryArg()
      for (const element of target.elements) body(element)
      return VOID
    }
    case 'randomElement':
      return target.elements.length === 0
        ? NIL
        : copyValue(target.elements[Math.floor(Math.random() * target.elements.length)]!)
    case 'shuffled': {
      const copy = target.elements.map(copyValue)
      shuffleInPlace(copy)
      return array(copy)
    }
    case 'dropFirst': {
      const n = arg(0) ? Math.max(0, Math.trunc(numericValue(arg(0)!))) : 1
      return array(target.elements.slice(n).map(copyValue))
    }
    case 'dropLast': {
      const n = arg(0) ? Math.max(0, Math.trunc(numericValue(arg(0)!))) : 1
      return array(target.elements.slice(0, Math.max(0, target.elements.length - n)).map(copyValue))
    }
    case 'reduce': {
      const initial = arg(0)
      if (!initial) return undefined
      const closure = closureArg()
      let accumulator = copyValue(initial)
      for (const element of target.elements) accumulator = invoke(closure, [accumulator, element])
      return accumulator
    }
    case 'sorted': {
      const by = labelled('by') ?? (args.length > 0 ? arg(args.length - 1) : undefined)
      const sorted = [...target.elements]
      if (by?.kind === 'closure') sorted.sort((a, b) => (truthyOf(invoke(by, [a, b])) ? -1 : 1))
      else sorted.sort((a, b) => compareValues(a, b))
      return array(sorted.map(copyValue))
    }
    case 'reversed':
      return array([...target.elements].reverse().map(copyValue))
    case 'joined': {
      const separator = labelled('separator')

      // `joined` on a collection *of collections* flattens and stays a collection;
      // only on strings does it produce a string. Stringifying both means
      // `[[1], [2]].joined().count` answers 6 - the character count of "[1][2]" -
      // where Swift answers 2.
      if (target.elements.length > 0 && target.elements.every((e) => e.kind === 'array')) {
        const glue = separator?.kind === 'array' ? separator.elements : []
        const flattened: SwiftValue[] = []
        for (const [i, element] of target.elements.entries()) {
          if (i > 0) flattened.push(...glue.map(copyValue))
          flattened.push(...(element as Extract<SwiftValue, { kind: 'array' }>).elements.map(copyValue))
        }
        return array(flattened)
      }

      const glue = separator?.kind === 'string' ? separator.value : ''
      return str(target.elements.map((e) => describe(e, false)).join(glue))
    }
    case 'prefix': {
      const n = arg(0)
      return n ? array(target.elements.slice(0, numericValue(n)).map(copyValue)) : undefined
    }
    case 'suffix': {
      const n = arg(0)
      return n ? array(target.elements.slice(-numericValue(n)).map(copyValue)) : undefined
    }
    case 'min':
      return target.elements.length === 0
        ? NIL
        : [...target.elements].sort(compareValues)[0]!
    case 'max':
      return target.elements.length === 0
        ? NIL
        : [...target.elements].sort(compareValues)[target.elements.length - 1]!
    case 'enumerated':
      return array(
        target.elements.map((e, i) => ({
          kind: 'struct' as const,
          typeName: 'EnumeratedElement',
          fields: new Map<string, SwiftValue>([
            ['offset', int(i)],
            ['element', e],
          ]),
        })),
      )
    default:
      return undefined
  }
}

/**
 * Members that write to their receiver.
 *
 * Swift marks these `mutating`, and a `mutating` method on a `let` is a compile
 * error. The preview accepted every one of them: `let items = [1]` followed by
 * `items.append(2)` ran, changed the array and reported nothing, while the same code
 * in Xcode does not build. The check lives here rather than in the interpreter
 * because this file is what decides which members exist at all - a method added
 * below without a line here is a method that can quietly write to a constant.
 */
const MUTATING_MEMBERS: ReadonlySet<string> = new Set([
  // Array
  'append', 'insert', 'remove', 'removeAll', 'removeFirst', 'removeLast', 'popLast',
  'removeSubrange', 'replaceSubrange', 'sort', 'reverse', 'shuffle', 'swapAt', 'move',
  // Dictionary
  'updateValue', 'removeValue',
  // Bool and String
  'toggle',
])

export function isMutatingMember(member: string): boolean {
  return MUTATING_MEMBERS.has(member)
}

// ------------------------------------------------------------------ statics

/**
 * The largest and smallest `Int` the preview can represent.
 *
 * Swift's are 2^63 - 1 and -2^63, and these are 2^53 - 1 and -(2^53 - 1), because a
 * JavaScript number is exact only to 2^53 and the interpreter already traps rather
 * than lose precision past it. Reporting Swift's number here would hand back a value
 * that prints plausibly and traps on the first arithmetic - and `Int.max` is written
 * almost exclusively as a starting point for a minimum, where either bound works.
 * The difference is stated in the coverage matrix rather than hidden.
 */
const INT_MAX = Number.MAX_SAFE_INTEGER
const INT_MIN = -Number.MAX_SAFE_INTEGER

/**
 * Built-in type names that may be written as values.
 *
 * `Int.max` reads a member of the *type*, so `Int` has to resolve to something
 * first. Without this the failure was "cannot find 'Int' in scope", which reads as
 * though the preview had never heard of `Int`.
 */
export const BUILTIN_TYPE_NAMES: ReadonlySet<string> = new Set([
  'Int', 'Double', 'Float', 'CGFloat', 'Bool', 'String', 'Character',
  'Array', 'Dictionary', 'Set', 'Date', 'UUID', 'URL',
])

/** `Int.max`, `Double.pi`, `Date.now` - a static read on a built-in type. */
export function staticBuiltinProperty(typeName: string, member: string): SwiftValue | undefined {
  switch (`${typeName}.${member}`) {
    case 'Int.max':
      return int(INT_MAX)
    case 'Int.min':
      return int(INT_MIN)
    case 'Int.zero':
      return int(0)
    case 'Double.pi':
    case 'CGFloat.pi':
      return double(Math.PI)
    case 'Double.infinity':
    case 'CGFloat.infinity':
      return double(Number.POSITIVE_INFINITY)
    case 'Double.greatestFiniteMagnitude':
      return double(Number.MAX_VALUE)
    case 'Double.zero':
    case 'CGFloat.zero':
      return double(0)
    case 'Date.now':
      return dateValue(Date.now() / 1000)
    case 'Date.distantPast':
      return dateValue(-62_135_596_800)
    case 'Date.distantFuture':
      return dateValue(64_092_211_200)
    default:
      return undefined
  }
}

/** `Int.random(in:)`, `Bool.random()` - a static call on a built-in type. */
export function callStaticBuiltin(
  typeName: string,
  member: string,
  args: readonly CallArgument[],
  trap: Trap,
): SwiftValue | undefined {
  if (member !== 'random') return undefined

  if (typeName === 'Bool') return bool(Math.random() < 0.5)
  if (typeName !== 'Int' && typeName !== 'Double' && typeName !== 'CGFloat') return undefined

  const range = args.find((a) => a.label === 'in')?.value ?? args[0]?.value
  if (range?.kind !== 'range') trap(`'${typeName}.random(in:)' expects a range`)

  // A half-open range excludes its upper bound, and `Int.random(in: 0..<0)` has
  // nothing to answer - Swift traps there rather than returning a bound.
  if (typeName === 'Int') {
    const upper = range.closed ? range.upper : range.upper - 1
    if (upper < range.lower) trap('Range is empty')
    return int(range.lower + Math.floor(Math.random() * (upper - range.lower + 1)))
  }

  if (range.upper < range.lower) trap('Range is empty')
  return double(range.lower + Math.random() * (range.upper - range.lower))
}

/**
 * Fisher-Yates, in place.
 *
 * `[...].sort(() => Math.random() - 0.5)` is the usual shortcut and it is biased -
 * some orderings come up several times more often than others, which shows up as a
 * shuffle that keeps starting with the same element.
 */
function shuffleInPlace(elements: SwiftValue[]): void {
  for (let i = elements.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const held = elements[i]!
    elements[i] = elements[j]!
    elements[j] = held
  }
}

function truthyOf(value: SwiftValue): boolean {
  return value.kind === 'bool' ? value.value : value.kind !== 'nil'
}

function compareValues(a: SwiftValue, b: SwiftValue): number {
  if (a.kind === 'string' && b.kind === 'string') return a.value < b.value ? -1 : a.value > b.value ? 1 : 0
  const x = numericValue(a)
  const y = numericValue(b)
  if (Number.isNaN(x) || Number.isNaN(y)) return 0
  return x - y
}

export { typeNameOf }
