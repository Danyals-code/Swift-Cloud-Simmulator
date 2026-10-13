import type { TypeRef } from './ast'

/**
 * The kind of value a declared type takes, as the preview tells overloads apart.
 *
 * The preview has values at run time, not types, so of two functions sharing a name
 * and labels it runs the one its arguments suit: `label(1)` calls `label(_: Int)`
 * and `label("one")` calls `label(_: String)`. This is the one place that says which
 * types a value can tell apart. The interpreter scores an argument against it, and
 * the checker warns where two overloads take the same kind in every place; one
 * definition means the two can't disagree about what the preview can choose.
 *
 * - `int`, `decimal`, `string`, `character`, `bool`, `array`, `dictionary`, `range`,
 *   `function`, `tuple:<count>`: what a number, text, a collection or a closure is.
 * - `optional:<kind>`: nil, or a value of that kind.
 * - `type:<Name>`: an instance of a struct, class or enum the project declares.
 * - `protocol:<Name>`: anything conforming to a protocol the project declares.
 * - `named:<Name>`: a framework type, `Color` or `Date`, held as its own value.
 * - `any`: a generic, `Any`, `some View`, or a protocol any kind of value may be.
 */
export type ValueKind = string

/** What the names in a type mean where it is written. */
export interface TypeNames {
  /** The type an alias stands for. */
  readonly alias: (name: string) => TypeRef | undefined
  /** What a name the project declares is, if it declares it. */
  readonly declared: (name: string) => 'type' | 'protocol' | 'generic' | undefined
}

/** The integer types, each of which takes a whole number, and the decimal ones, which take any number. */
const INTEGER_TYPES: ReadonlySet<string> = new Set(['Int', 'Int8', 'Int16', 'Int32', 'Int64', 'UInt', 'UInt8', 'UInt16', 'UInt32', 'UInt64'])
/** Swift's floating-point types, all a Double in the preview. */
export const DECIMAL_TYPES: ReadonlySet<string> = new Set(['Double', 'Float', 'CGFloat', 'Float32', 'Float64', 'Float80', 'TimeInterval'])

/** Types a value of any kind may be passed as. */
const OPEN_TYPES: ReadonlySet<string> = new Set([
  'Any', 'AnyObject', 'AnyHashable', 'Equatable', 'Hashable', 'Comparable', 'Identifiable', 'CustomStringConvertible',
  'Codable', 'Encodable', 'Decodable', 'Sendable', 'Error', 'View', 'Shape', 'ShapeStyle', 'StringProtocol',
  'Numeric', 'BinaryInteger', 'BinaryFloatingPoint', 'Sequence', 'Collection',
])

export function valueKind(type: TypeRef | null, names: TypeNames, depth = 0): ValueKind {
  if (!type || depth > 8) return 'any'
  switch (type.kind) {
    case 'optionalType':
      return `optional:${valueKind(type.wrapped, names, depth + 1)}`
    case 'arrayType':
      return 'array'
    case 'dictionaryType':
      return 'dictionary'
    case 'functionType':
      return 'function'
    case 'tupleType':
      return `tuple:${type.elements.length}`
    case 'namedType':
      break
    default:
      return 'any'
  }
  const name = type.name
  const alias = names.alias(name)
  if (alias) return valueKind(alias, names, depth + 1)
  if (INTEGER_TYPES.has(name)) return 'int'
  if (DECIMAL_TYPES.has(name)) return 'decimal'
  switch (name) {
    case 'String':
      return 'string'
    case 'Character':
    case 'Substring':
      return 'character'
    case 'Bool':
      return 'bool'
    case 'Array':
    case 'Set':
      return 'array'
    case 'Dictionary':
      return 'dictionary'
    case 'Range':
    case 'ClosedRange':
      return 'range'
    case 'Optional':
      return `optional:${valueKind(type.generics[0] ?? null, names, depth + 1)}`
  }
  if (OPEN_TYPES.has(name)) return 'any'
  const declared = names.declared(name)
  if (declared === 'type') return `type:${name}`
  if (declared === 'protocol') return `protocol:${name}`
  if (declared === 'generic') return 'any'
  return `named:${name}`
}
