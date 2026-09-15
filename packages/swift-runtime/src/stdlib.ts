import type { CallArgument } from './host'
import {
  array,
  asIndexSet,
  bool,
  copyValue,
  describe,
  dictionaryKey,
  double,
  formatDouble,
  graphemes,
  int,
  NIL,
  numericValue,
  str,
  typeNameOf,
  valuesEqual,
  VOID,
  type ClosureValue,
  type SwiftValue,
} from './values'

type Invoke = (closure: ClosureValue, args: readonly SwiftValue[]) => SwiftValue
type Trap = (reason: string) => never

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
): SwiftValue | undefined {
  const arg = (i: number): SwiftValue | undefined => args[i]?.value
  const labelled = (name: string): SwiftValue | undefined =>
    args.find((a) => a.label === name)?.value

  const closureArg = (i = args.length - 1): ClosureValue => {
    const value = args[i]?.value
    if (value?.kind !== 'closure') trap(`'${member}' requires a closure argument`)
    return value
  }

  switch (target.kind) {
    case 'string':
      return stringMethod(target.value, member, arg, labelled, trap)

    case 'array':
      return arrayMethod(target, member, args, arg, labelled, closureArg, invoke, trap)

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
        default:
          return undefined
      }

    case 'double':
      switch (member) {
        case 'rounded':
          return double(Math.round(target.value))
        case 'squareRoot':
          return double(Math.sqrt(target.value))
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

    default:
      return undefined
  }
}

function stringMethod(
  value: string,
  member: string,
  arg: (i: number) => SwiftValue | undefined,
  labelled: (name: string) => SwiftValue | undefined,
  trap: Trap,
): SwiftValue | undefined {
  const text = (v: SwiftValue | undefined): string => {
    if (v?.kind !== 'string') trap(`'${member}' expects a String argument`)
    return v.value
  }

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
   */
  const predicateArg = (label: string): ClosureValue | null => {
    const named = args.find((a) => a.label === label)?.value
    if (named?.kind === 'closure') return named
    const last = args[args.length - 1]
    return last && !last.label && last.value.kind === 'closure' ? last.value : null
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
        const kept = target.elements.filter((e) => !truthyOf(invoke(predicate, [e])))
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
    case 'contains': {
      // `contains(where:)` takes a predicate; `contains(_:)` takes a value.
      const predicate = predicateArg('where')
      if (predicate) return bool(target.elements.some((e) => truthyOf(invoke(predicate, [e]))))

      const value = arg(0)
      return value ? bool(target.elements.some((e) => valuesEqual(e, value))) : undefined
    }
    case 'firstIndex': {
      const predicate = predicateArg('where')
      if (predicate) {
        const found = target.elements.findIndex((e) => truthyOf(invoke(predicate, [e])))
        return found >= 0 ? int(found) : NIL
      }

      const of = labelled('of') ?? arg(0)
      if (!of) return undefined
      const index = target.elements.findIndex((e) => valuesEqual(e, of))
      return index >= 0 ? int(index) : NIL
    }
    case 'map':
      return array(target.elements.map((e) => copyValue(invoke(closureArg(), [e]))))
    case 'compactMap':
      return array(
        target.elements
          .map((e) => invoke(closureArg(), [e]))
          .filter((v) => v.kind !== 'nil')
          .map(copyValue),
      )
    case 'filter':
      return array(target.elements.filter((e) => truthyOf(invoke(closureArg(), [e]))).map(copyValue))
    case 'forEach':
      for (const element of target.elements) invoke(closureArg(), [element])
      return VOID
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
