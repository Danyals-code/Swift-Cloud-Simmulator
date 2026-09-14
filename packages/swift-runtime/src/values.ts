import type { SourceSpan } from '@studio/shared'
import type { Block, ClosureParam, FuncDecl, Param } from '@studio/swift-syntax'

/**
 * The runtime value model.
 *
 * The thing most JS-hosted Swift emulators get wrong is value semantics, and getting
 * it wrong makes `@State` behave subtly incorrectly in ways that are very hard to
 * debug later. So the rule is explicit and enforced at every boundary:
 *
 *   struct, enum, array, dictionary   copied on assignment and on argument passing
 *   class, closure                    shared
 *
 * Swift implements the copying side with copy-on-write. We copy eagerly instead.
 * The *semantics* are identical — COW is purely an optimisation — and eager copying
 * is far easier to get right. Following the same rule that killed incremental
 * reparse in Phase 1: don't build the optimisation until a measurement asks for it.
 * `values.bench.test.ts` is the measurement that would.
 */

export type SwiftValue =
  | IntValue
  | DoubleValue
  | BoolValue
  | StringValue
  | ArrayValue
  | DictionaryValue
  | StructValue
  | EnumValue
  | ClosureValue
  | FunctionValue
  | RangeValue
  | TypeValue
  | OpaqueValue
  | VoidValue
  | NilValue

export interface IntValue {
  readonly kind: 'int'
  readonly value: number
}

export interface DoubleValue {
  readonly kind: 'double'
  readonly value: number
}

export interface BoolValue {
  readonly kind: 'bool'
  readonly value: boolean
}

export interface StringValue {
  readonly kind: 'string'
  readonly value: string
}

/** Mutable in place; copied at every assignment and argument boundary. */
export interface ArrayValue {
  readonly kind: 'array'
  elements: SwiftValue[]
}

export interface DictionaryValue {
  readonly kind: 'dictionary'
  entries: Map<string, SwiftValue>
}

/**
 * An instance of a user-declared `struct` or `class`.
 *
 * One shape for both; `reference` decides the semantics. A class is shared on
 * assignment and on argument passing, a struct is copied — that is the whole of the
 * difference, and expressing it as a flag keeps it to one branch in `copyValue`
 * rather than a parallel value kind every `switch` would have to learn.
 */
export interface StructValue {
  readonly kind: 'struct'
  readonly typeName: string
  fields: Map<string, SwiftValue>
  /** True for a `class` instance: never copied. */
  readonly reference?: boolean
}

/**
 * A case of a user-declared `enum`.
 *
 * Value semantics, like a struct. `associated` holds the payload positionally;
 * `rawValue` is present only for enums with a raw type, which is what makes
 * `Tab(rawValue:)` and `.rawValue` work.
 */
export interface EnumValue {
  readonly kind: 'enum'
  readonly typeName: string
  readonly caseName: string
  readonly associated: readonly SwiftValue[]
  readonly rawValue: SwiftValue | null
}

/** Closures are reference types in Swift, so these are shared, never copied. */
export interface ClosureValue {
  readonly kind: 'closure'
  readonly params: readonly ClosureParam[]
  readonly hasExplicitParams: boolean
  readonly body: Block
  /** Captured lexical environment. Typed as unknown to avoid a circular import. */
  readonly env: unknown
  readonly span: SourceSpan
}

export interface FunctionValue {
  readonly kind: 'function'
  readonly decl: FuncDecl
  /** Bound receiver for a method call, else null. */
  readonly self: StructValue | null
  readonly env: unknown
  /**
   * The type that *declared* this method, when it is a method.
   *
   * Only `super` reads it, and only `super` can be written without it: "start above
   * the type that declared the method now running" is a fact about where the code sits
   * in the source, and the receiver's own type is a different thing entirely — in a
   * three-level hierarchy they disagree, and resolving `super` against the receiver
   * calls the override again, forever.
   */
  readonly owner?: string | null
}

export interface RangeValue {
  readonly kind: 'range'
  readonly lower: number
  readonly upper: number
  /** `...` includes the upper bound; `..<` does not. */
  readonly closed: boolean
}

/** A type referenced as a value: `Color` in `Color.red`, or `ContentView` before a call. */
export interface TypeValue {
  readonly kind: 'type'
  readonly name: string
}

/**
 * A value the interpreter carries but does not understand.
 *
 * This is the seam that keeps `swift-runtime` free of any SwiftUI knowledge: views,
 * colours and fonts travel as opaque payloads supplied by the host (see `host.ts`),
 * so the interpreter can pass them around, store them in variables and hand them
 * back without ever needing to know what a `VStack` is.
 */
export interface OpaqueValue {
  readonly kind: 'opaque'
  readonly typeName: string
  readonly payload: unknown
}

export interface VoidValue {
  readonly kind: 'void'
}

export interface NilValue {
  readonly kind: 'nil'
}

/**
 * Splits a string the way Swift's `String` does — by grapheme cluster.
 *
 * Spreading a string (`[...text]`) splits by *code point*, which gets "👋🏽" wrong: the
 * emoji and its skin-tone modifier are two code points but one character. Swift's
 * `count` is 1; naive JS says 2, and `.first` returns half an emoji.
 */
const GRAPHEMES =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

export function graphemes(text: string): string[] {
  if (!GRAPHEMES) return [...text]
  return Array.from(GRAPHEMES.segment(text), (s) => s.segment)
}

// ------------------------------------------------------------- constructors

export const VOID: VoidValue = { kind: 'void' }
export const NIL: NilValue = { kind: 'nil' }

export function int(value: number): IntValue {
  return { kind: 'int', value }
}
export function double(value: number): DoubleValue {
  return { kind: 'double', value }
}
export function bool(value: boolean): BoolValue {
  return { kind: 'bool', value }
}
export function str(value: string): StringValue {
  return { kind: 'string', value }
}
export function array(elements: SwiftValue[]): ArrayValue {
  return { kind: 'array', elements }
}
export function enumCase(
  typeName: string,
  caseName: string,
  associated: readonly SwiftValue[] = [],
  rawValue: SwiftValue | null = null,
): EnumValue {
  return { kind: 'enum', typeName, caseName, associated, rawValue }
}

export function opaque(typeName: string, payload: unknown): OpaqueValue {
  return { kind: 'opaque', typeName, payload }
}

// ------------------------------------------------------------------ index sets

/**
 * `IndexSet` — a set of positions in a collection.
 *
 * Foundation rather than SwiftUI, which is why it lives here: `remove(atOffsets:)`
 * and `move(fromOffsets:toOffset:)` are `Array` methods, and the interpreter owns
 * `Array`. The host constructs them; the standard library consumes them.
 */
export const INDEX_SET_TYPE = 'IndexSet'

export interface IndexSetPayload {
  readonly indices: readonly number[]
}

export function indexSet(indices: readonly number[]): OpaqueValue {
  return { kind: 'opaque', typeName: INDEX_SET_TYPE, payload: { indices: [...indices] } }
}

export function asIndexSet(value: SwiftValue | undefined): readonly number[] | null {
  return value !== undefined && value.kind === 'opaque' && value.typeName === INDEX_SET_TYPE
    ? (value.payload as IndexSetPayload).indices
    : null
}

// ------------------------------------------------------------------ key paths

/** `\.self`, `\.id` — an unapplied property accessor. */
export const KEYPATH_TYPE = 'KeyPath'

export interface KeyPathPayload {
  readonly components: readonly string[]
}

export function keyPath(components: readonly string[]): OpaqueValue {
  return { kind: 'opaque', typeName: KEYPATH_TYPE, payload: { components } }
}

export function asKeyPath(value: SwiftValue | undefined): KeyPathPayload | null {
  return value !== undefined && value.kind === 'opaque' && value.typeName === KEYPATH_TYPE
    ? (value.payload as KeyPathPayload)
    : null
}

/**
 * Applies a key path to a value.
 *
 * `\.self` is the identity path, which is why it is the idiomatic `ForEach(_:id:)`
 * argument for an array of plain strings. Anything else walks stored fields.
 */
export function applyKeyPath(path: KeyPathPayload, value: SwiftValue): SwiftValue {
  let current = value
  for (const component of path.components) {
    if (component === 'self') continue
    if (current.kind !== 'struct') return NIL
    current = current.fields.get(component) ?? NIL
  }
  return current
}

// --------------------------------------------------------------- projections

/**
 * The type name carried by a property-wrapper projection — `$count`.
 *
 * Named `Binding` because that is what SwiftUI calls it and what the user writes,
 * but the mechanism is a *language* feature, not a SwiftUI one: a projection is a
 * read/write reference to storage somewhere else. The interpreter creates them and
 * passes them around without knowing anything about SwiftUI, which is what keeps the
 * boundary rule intact.
 */
export const PROJECTION_TYPE = 'Binding'

/** A read/write reference to storage owned by someone else. */
export interface ProjectionPayload {
  get(): SwiftValue
  set(value: SwiftValue): void
  /** For diagnostics: `count`, `self.isOn`. */
  readonly description: string
}

export function projection(payload: ProjectionPayload): OpaqueValue {
  return { kind: 'opaque', typeName: PROJECTION_TYPE, payload }
}

export function asProjection(value: SwiftValue | undefined): ProjectionPayload | null {
  return value !== undefined && value.kind === 'opaque' && value.typeName === PROJECTION_TYPE
    ? (value.payload as ProjectionPayload)
    : null
}

/**
 * Reads through a projection, so `@Binding var count` behaves like an `Int`.
 *
 * Applied on every field and variable read. Doing it here — rather than by looking
 * at the `@Binding` attribute on the declaration — means the transparency follows
 * the *value*, so a binding passed through three views deep still reads and writes
 * the original storage without any of the intermediate declarations mattering.
 */
export function unwrapProjection(value: SwiftValue): SwiftValue {
  const p = asProjection(value)
  return p ? p.get() : value
}

// ------------------------------------------------------------------ copying

/**
 * Produces an independent copy for value types, and returns reference types as-is.
 *
 * Called at every assignment, every argument pass and every struct-field read that
 * escapes. Getting the *set* of call sites right matters as much as this function.
 */
export function copyValue(value: SwiftValue): SwiftValue {
  switch (value.kind) {
    case 'array':
      return { kind: 'array', elements: value.elements.map(copyValue) }
    case 'dictionary': {
      const entries = new Map<string, SwiftValue>()
      for (const [k, v] of value.entries) entries.set(k, copyValue(v))
      return { kind: 'dictionary', entries }
    }
    case 'struct': {
      // A class instance is a reference: sharing it *is* the semantics.
      if (value.reference) return value
      const fields = new Map<string, SwiftValue>()
      for (const [k, v] of value.fields) fields.set(k, copyValue(v))
      return { kind: 'struct', typeName: value.typeName, fields }
    }
    case 'enum':
      return value.associated.length === 0
        ? value
        : { ...value, associated: value.associated.map(copyValue) }
    // Scalars are immutable, and closures/functions are reference types. Both are
    // safe to share.
    default:
      return value
  }
}

// --------------------------------------------------------------- inspection

export function isNumeric(value: SwiftValue): value is IntValue | DoubleValue {
  return value.kind === 'int' || value.kind === 'double'
}

export function numericValue(value: SwiftValue): number {
  return isNumeric(value) ? value.value : Number.NaN
}

export function truthy(value: SwiftValue): boolean {
  return value.kind === 'bool' ? value.value : value.kind !== 'nil' && value.kind !== 'void'
}

/** The name Swift would print for this value's type, used in diagnostics. */
export function typeNameOf(value: SwiftValue): string {
  switch (value.kind) {
    case 'int':
      return 'Int'
    case 'double':
      return 'Double'
    case 'bool':
      return 'Bool'
    case 'string':
      return 'String'
    case 'array':
      return 'Array'
    case 'dictionary':
      return 'Dictionary'
    case 'struct':
      return value.typeName
    case 'enum':
      return value.typeName
    case 'closure':
    case 'function':
      return 'Function'
    case 'range':
      return value.closed ? 'ClosedRange' : 'Range'
    case 'type':
      return value.name
    case 'opaque':
      return value.typeName
    case 'void':
      return 'Void'
    case 'nil':
      return 'Optional'
  }
}

/**
 * Renders a value the way Swift's `print` and string interpolation do.
 *
 * The details matter for fidelity: `1.0` prints as `1.0`, not `1`; `nil` prints as
 * `nil`; arrays use `[a, b]` with no quotes around interpolated strings but quotes
 * inside collections — which is Swift's actual, slightly inconsistent behaviour.
 */
export function describe(value: SwiftValue, insideCollection = false): string {
  switch (value.kind) {
    case 'int':
      return String(value.value)
    case 'double':
      return formatDouble(value.value)
    case 'bool':
      return value.value ? 'true' : 'false'
    case 'string':
      return insideCollection ? `"${value.value}"` : value.value
    case 'array':
      return `[${value.elements.map((e) => describe(e, true)).join(', ')}]`
    case 'dictionary': {
      if (value.entries.size === 0) return '[:]'
      const parts = [...value.entries].map(([k, v]) => `"${k}": ${describe(v, true)}`)
      return `[${parts.join(', ')}]`
    }
    case 'struct': {
      const fields = [...value.fields].map(([k, v]) => `${k}: ${describe(v, true)}`)
      return `${value.typeName}(${fields.join(', ')})`
    }
    case 'enum':
      // Swift prints an enum case by its name alone, payload in parentheses.
      return value.associated.length === 0
        ? value.caseName
        : `${value.caseName}(${value.associated.map((v) => describe(v, true)).join(', ')})`
    case 'closure':
    case 'function':
      return '(Function)'
    case 'range':
      return `${value.lower}${value.closed ? '...' : '..<'}${value.upper}`
    case 'type':
      return value.name
    case 'opaque':
      return value.typeName
    case 'void':
      return '()'
    case 'nil':
      return 'nil'
  }
}

/** Swift prints whole doubles with a trailing `.0`; JS does not. */
export function formatDouble(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? 'inf' : Number.isNaN(n) ? 'nan' : '-inf'
  return Number.isInteger(n) ? `${n}.0` : String(n)
}

/** Structural equality, matching Swift's synthesised `==` for the supported kinds. */
export function valuesEqual(a: SwiftValue, b: SwiftValue): boolean {
  if (isNumeric(a) && isNumeric(b)) return a.value === b.value
  if (a.kind !== b.kind) return false

  switch (a.kind) {
    case 'bool':
      return a.value === (b as BoolValue).value
    case 'string':
      return a.value === (b as StringValue).value
    case 'array': {
      const other = b as ArrayValue
      return (
        a.elements.length === other.elements.length &&
        a.elements.every((e, i) => valuesEqual(e, other.elements[i]!))
      )
    }
    case 'dictionary': {
      const other = b as DictionaryValue
      if (a.entries.size !== other.entries.size) return false
      for (const [k, v] of a.entries) {
        const rhs = other.entries.get(k)
        if (!rhs || !valuesEqual(v, rhs)) return false
      }
      return true
    }
    case 'struct': {
      const other = b as StructValue
      // Two class references are equal when they are the same object; Swift's `==`
      // for a class needs `Equatable`, and identity is the honest default.
      if (a.reference || other.reference) return a === other
      if (a.typeName !== other.typeName || a.fields.size !== other.fields.size) return false
      for (const [k, v] of a.fields) {
        const rhs = other.fields.get(k)
        if (!rhs || !valuesEqual(v, rhs)) return false
      }
      return true
    }
    case 'enum': {
      const other = b as EnumValue
      return (
        a.typeName === other.typeName &&
        a.caseName === other.caseName &&
        a.associated.length === other.associated.length &&
        a.associated.every((v, i) => valuesEqual(v, other.associated[i]!))
      )
    }
    case 'range': {
      const other = b as RangeValue
      return a.lower === other.lower && a.upper === other.upper && a.closed === other.closed
    }
    case 'nil':
    case 'void':
      return true
    case 'type':
      return a.name === (b as TypeValue).name

    /**
     * Opaque values compare by *value* when their payload is plain data.
     *
     * The host's design tokens — `.dark`, `.largeTitle`, a colour — are opaque
     * because the interpreter has no idea what they mean, but they are values, and
     * `scheme == .dark` has to be true when both name the same thing. Comparing by
     * identity made every such test silently false.
     *
     * A payload holding functions (a `Binding` is a pair of them) falls back to
     * identity, which is correct: two bindings onto the same storage are the same
     * binding, and two onto different storage are not equal whatever they contain.
     */
    case 'opaque': {
      const other = b as OpaqueValue
      if (a === other) return true
      if (a.typeName !== other.typeName) return false
      return isPlainData(a.payload) && isPlainData(other.payload)
        ? plainDataEqual(a.payload, other.payload)
        : false
    }
    default:
      return false
  }
}

/** Dictionary keys are stringified; the slice only uses String and Int keys. */
export function dictionaryKey(value: SwiftValue): string {
  return value.kind === 'string' ? value.value : describe(value, false)
}

export type { Param }

/**
 * Whether a payload is plain data — no functions, no cycles worth worrying about.
 *
 * The test that decides whether an opaque value compares by value or by identity.
 * Deliberately shallow-ish and total: an unfamiliar shape answers "no" and falls back
 * to identity, which is never *wrong*, only stricter.
 */
function isPlainData(value: unknown, depth = 0): boolean {
  if (depth > 4) return false
  if (value === null || value === undefined) return true

  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return true
    case 'object':
      if (Array.isArray(value)) return value.every((v) => isPlainData(v, depth + 1))
      return Object.values(value as Record<string, unknown>).every((v) => isPlainData(v, depth + 1))
    default:
      return false
  }
}

function plainDataEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => plainDataEqual(v, b[i]))
  }

  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => plainDataEqual(left[key], right[key]))
}
