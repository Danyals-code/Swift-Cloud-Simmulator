/**
 * The standard library, as the editor describes it.
 *
 * Two questions need the same answer and used to get neither: what to offer after
 * `text.`, and what to say when the caret rests on `count`. Completion answered the
 * first with a list of 159 view modifiers - correct after a view and nonsense after
 * a String - and hover answered the second with nothing at all.
 *
 * This is a *description*, not an implementation: the members live in
 * `swift-runtime/src/stdlib.ts`, which this package must not import. Two tables can
 * drift, and a table that claims a member the runtime does not have is exactly the
 * kind of lie the defect register exists to remove - so `tests/editor.test.ts` runs
 * every name here through the real pipeline and fails if one of them does not
 * resolve. The description is checked against the behaviour rather than trusted.
 *
 * Coverage is what Phase 5 built, which is in turn what SwiftUI code actually calls.
 * A member missing here is a missing completion, never a wrong one.
 */

export interface StdlibMember {
  readonly name: string
  readonly kind: 'property' | 'method'
  /** The signature, shown beside the name. */
  readonly detail: string
  /** One line of quick help. */
  readonly doc: string
  /** Whether completing it should open a parenthesis. */
  readonly takesArguments?: boolean
}

const property = (name: string, detail: string, doc: string): StdlibMember => ({
  name,
  kind: 'property',
  detail,
  doc,
})

const method = (name: string, detail: string, doc: string, takesArguments = true): StdlibMember => ({
  name,
  kind: 'method',
  detail,
  doc,
  takesArguments,
})

/** Members every collection shares, so each collection's own list stays short. */
const COLLECTION: readonly StdlibMember[] = [
  property('count', 'Int', 'The number of elements.'),
  property('isEmpty', 'Bool', 'True when there are no elements.'),
]

const STRING_MEMBERS: readonly StdlibMember[] = [
  ...COLLECTION,
  property('first', 'Character?', 'The first character, or nil when empty.'),
  property('last', 'Character?', 'The last character, or nil when empty.'),
  property('capitalized', 'String', 'Every word with its first letter uppercased.'),
  property('unicodeScalars', '[Unicode.Scalar]', 'The code points, which is not the character count.'),
  property('indices', 'Range<Int>', 'The positions of the characters.'),
  property('description', 'String', 'The string itself.'),
  method('uppercased', '() -> String', 'The string in upper case.', false),
  method('lowercased', '() -> String', 'The string in lower case.', false),
  method('hasPrefix', '(String) -> Bool', 'Whether the string begins with another.'),
  method('hasSuffix', '(String) -> Bool', 'Whether the string ends with another.'),
  method('starts', '(with: String) -> Bool', 'Whether the string begins with another.'),
  method('contains', '(String) -> Bool', 'Whether the string contains another.'),
  method('replacingOccurrences', '(of: String, with: String) -> String', 'Every occurrence replaced.'),
  method('split', '(separator: Character) -> [String]', 'Split on a separator, dropping empty pieces.'),
  method('components', '(separatedBy: String) -> [String]', 'Split on a separator, keeping empty pieces.'),
  method('trimmingCharacters', '(in: CharacterSet) -> String', 'The string without its surrounding whitespace.'),
  method('prefix', '(Int) -> String', 'The first n characters.'),
  method('suffix', '(Int) -> String', 'The last n characters.'),
  method('dropFirst', '(Int = 1) -> String', 'Everything after the first n characters.', false),
  method('dropLast', '(Int = 1) -> String', 'Everything before the last n characters.', false),
  method('reversed', '() -> [Character]', 'The characters, back to front.', false),
  method('padding', '(toLength: Int, withPad: String, startingAt: Int) -> String', 'Padded, or truncated, to a length.'),
  method('append', '(String) -> Void', 'Adds to the end. Mutating: the receiver must be a var.'),
]

const ARRAY_MEMBERS: readonly StdlibMember[] = [
  ...COLLECTION,
  property('first', 'Element?', 'The first element, or nil when empty.'),
  property('last', 'Element?', 'The last element, or nil when empty.'),
  property('indices', 'Range<Int>', 'The valid positions.'),
  method('map', '((Element) -> T) -> [T]', 'Each element transformed. Takes a key path too.'),
  method('filter', '((Element) -> Bool) -> [Element]', 'The elements the predicate keeps.'),
  method('compactMap', '((Element) -> T?) -> [T]', 'Each element transformed, dropping the nils.'),
  method('flatMap', '((Element) -> [T]) -> [T]', 'Each element transformed, flattened one level.'),
  method('reduce', '(T, (T, Element) -> T) -> T', 'Combined into a single value.'),
  method('forEach', '((Element) -> Void) -> Void', 'Runs a closure for each element.'),
  method('sorted', '(by: (Element, Element) -> Bool) -> [Element]', 'A sorted copy.', false),
  method('reversed', '() -> [Element]', 'A reversed copy.', false),
  method('shuffled', '() -> [Element]', 'A copy in random order.', false),
  method('joined', '(separator: String) -> String', 'The elements run together.', false),
  method('contains', '(Element) -> Bool', 'Whether an element is present. Takes a predicate too.'),
  method('allSatisfy', '((Element) -> Bool) -> Bool', 'Whether every element matches.'),
  method('first', '(where: (Element) -> Bool) -> Element?', 'The first match, or nil.'),
  method('last', '(where: (Element) -> Bool) -> Element?', 'The last match, or nil.'),
  method('firstIndex', '(of: Element) -> Int?', 'Where an element is, or nil.'),
  method('lastIndex', '(of: Element) -> Int?', 'Where an element last is, or nil.'),
  method('randomElement', '() -> Element?', 'One element at random, or nil when empty.', false),
  method('enumerated', '() -> [(offset: Int, element: Element)]', 'Each element with its position.', false),
  method('prefix', '(Int) -> [Element]', 'The first n elements.'),
  method('suffix', '(Int) -> [Element]', 'The last n elements.'),
  method('dropFirst', '(Int = 1) -> [Element]', 'Everything after the first n.', false),
  method('dropLast', '(Int = 1) -> [Element]', 'Everything before the last n.', false),
  method('min', '() -> Element?', 'The smallest element, or nil.', false),
  method('max', '() -> Element?', 'The largest element, or nil.', false),
  method('append', '(Element) -> Void', 'Adds to the end. Mutating: the receiver must be a var.'),
  method('insert', '(Element, at: Int) -> Void', 'Adds at a position. Mutating.'),
  method('remove', '(at: Int) -> Element', 'Removes at a position and answers it. Mutating.'),
  method('removeAll', '(where: (Element) -> Bool) -> Void', 'Removes everything the predicate matches. Mutating.', false),
  method('removeFirst', '() -> Element', 'Removes the first element. Traps when empty. Mutating.', false),
  method('removeLast', '() -> Element', 'Removes the last element. Traps when empty. Mutating.', false),
  method('popLast', '() -> Element?', 'Removes the last element, or nil when empty. Mutating.', false),
  method('sort', '(by: (Element, Element) -> Bool) -> Void', 'Sorts in place. Mutating.', false),
  method('reverse', '() -> Void', 'Reverses in place. Mutating.', false),
  method('swapAt', '(Int, Int) -> Void', 'Exchanges two positions. Mutating.'),
  method('replaceSubrange', '(Range<Int>, with: [Element]) -> Void', 'Replaces a range. Mutating.'),
  method('removeSubrange', '(Range<Int>) -> Void', 'Removes a range. Mutating.'),
]

/**
 * A `Set` is not an Array with different brackets.
 *
 * The runtime happens to represent one as an array that refuses duplicates, so
 * `set.append(…)` would run here - and Xcode rejects it. Listing the Array members
 * would advertise a name that does not exist, which is the one thing this file must
 * not do, so a Set gets the members a Set really has.
 */
const SET_MEMBERS: readonly StdlibMember[] = [
  ...COLLECTION,
  property('first', 'Element?', 'Some element, or nil when empty. A set has no order.'),
  method('contains', '(Element) -> Bool', 'Whether an element is present.'),
  method('insert', '(Element) -> (inserted: Bool, memberAfterInsert: Element)', 'Adds an element unless it is already there. Mutating.'),
  method('map', '((Element) -> T) -> [T]', 'Each element transformed, as an array.'),
  method('filter', '((Element) -> Bool) -> Set<Element>', 'The elements the predicate keeps.'),
  method('sorted', '(by: (Element, Element) -> Bool) -> [Element]', 'The elements as a sorted array.', false),
  method('forEach', '((Element) -> Void) -> Void', 'Runs a closure for each element.'),
  method('reduce', '(T, (T, Element) -> T) -> T', 'Combined into a single value.'),
  method('allSatisfy', '((Element) -> Bool) -> Bool', 'Whether every element matches.'),
  method('randomElement', '() -> Element?', 'One element at random, or nil when empty.', false),
]

const DICTIONARY_MEMBERS: readonly StdlibMember[] = [
  ...COLLECTION,
  property('keys', '[Key]', 'The keys.'),
  property('values', '[Value]', 'The values.'),
  method('mapValues', '((Value) -> T) -> [Key: T]', 'Each value transformed, keys kept.'),
  method('filter', '(((key: Key, value: Value)) -> Bool) -> [Key: Value]', 'The pairs the predicate keeps.'),
  method('sorted', '(by: …) -> [(key: Key, value: Value)]', 'The pairs as a sorted array.', false),
  method('map', '(((key: Key, value: Value)) -> T) -> [T]', 'Each pair transformed.'),
  method('contains', '(((key: Key, value: Value)) -> Bool) -> Bool', 'Whether any pair matches.'),
  method('updateValue', '(Value, forKey: Key) -> Value?', 'Sets a value and answers the old one. Mutating.'),
  method('removeValue', '(forKey: Key) -> Value?', 'Removes a key and answers its value. Mutating.'),
]

const INT_MEMBERS: readonly StdlibMember[] = [
  property('description', 'String', 'The number written out.'),
  property('magnitude', 'Int', 'The absolute value.'),
  method('isMultiple', '(of: Int) -> Bool', 'Whether the number divides exactly.'),
  method('quotientAndRemainder', '(dividingBy: Int) -> (quotient: Int, remainder: Int)', 'Both halves of a division.'),
]

const DOUBLE_MEMBERS: readonly StdlibMember[] = [
  property('description', 'String', 'The number written out.'),
  property('magnitude', 'Double', 'The absolute value.'),
  property('isNaN', 'Bool', 'Whether the value is not a number.'),
  property('isFinite', 'Bool', 'Whether the value is finite.'),
  method('rounded', '(FloatingPointRoundingRule) -> Double', 'Rounded; halves go away from zero.', false),
  method('squareRoot', '() -> Double', 'The square root.', false),
  method('truncatingRemainder', '(dividingBy: Double) -> Double', 'The remainder after division.'),
  method('isMultiple', '(of: Double) -> Bool', 'Whether the number divides exactly.'),
]

const BOOL_MEMBERS: readonly StdlibMember[] = [
  property('description', 'String', '"true" or "false".'),
  method('toggle', '() -> Void', 'Flips the value. Mutating: the receiver must be a var.', false),
]

const DATE_MEMBERS: readonly StdlibMember[] = [
  property('timeIntervalSince1970', 'TimeInterval', 'Seconds since 1 January 1970.'),
  property('timeIntervalSinceReferenceDate', 'TimeInterval', 'Seconds since 1 January 2001.'),
  property('description', 'String', 'The date in UTC, to the second.'),
  method('addingTimeInterval', '(TimeInterval) -> Date', 'A date this many seconds later.'),
  method('timeIntervalSince', '(Date) -> TimeInterval', 'The gap between two dates, in seconds.'),
  method('formatted', '() -> String', 'The date in the reader’s locale.', false),
]

const URL_MEMBERS: readonly StdlibMember[] = [
  property('absoluteString', 'String', 'The URL as written.'),
  property('path', 'String', 'The path component.'),
  property('host', 'String?', 'The host, or nil.'),
  property('scheme', 'String?', 'The scheme, or nil.'),
  property('query', 'String?', 'The query string, or nil.'),
  property('lastPathComponent', 'String', 'The final path segment.'),
  property('pathExtension', 'String', 'The extension, without its dot.'),
  method('appendingPathComponent', '(String) -> URL', 'The URL with a segment added.'),
]

const UUID_MEMBERS: readonly StdlibMember[] = [
  property('uuidString', 'String', 'The identifier in its usual written form.'),
]

const RANGE_MEMBERS: readonly StdlibMember[] = [
  ...COLLECTION,
  property('lowerBound', 'Int', 'The first value.'),
  property('upperBound', 'Int', 'The bound at the top; included only for `...`.'),
  method('contains', '(Int) -> Bool', 'Whether a value falls inside.'),
]

/**
 * Members by the type that has them, keyed by the name an annotation would use.
 *
 * `Character` is deliberately absent. The runtime carries one as a String, so its
 * String members would all answer - and `someCharacter.hasPrefix(…)` does not
 * compile in Xcode. A missing completion costs a keystroke; a wrong one costs trust.
 */
export const STDLIB_MEMBERS: ReadonlyMap<string, readonly StdlibMember[]> = new Map([
  ['String', STRING_MEMBERS],
  ['Array', ARRAY_MEMBERS],
  ['Set', SET_MEMBERS],
  ['Dictionary', DICTIONARY_MEMBERS],
  ['Int', INT_MEMBERS],
  ['Double', DOUBLE_MEMBERS],
  ['Float', DOUBLE_MEMBERS],
  ['CGFloat', DOUBLE_MEMBERS],
  ['Bool', BOOL_MEMBERS],
  ['Date', DATE_MEMBERS],
  ['URL', URL_MEMBERS],
  ['UUID', UUID_MEMBERS],
  ['Range', RANGE_MEMBERS],
  ['ClosedRange', RANGE_MEMBERS],
])

/** Free functions, for hover. The names are `KNOWN_FUNCTIONS`, described. */
export const FREE_FUNCTIONS: ReadonlyMap<string, { readonly detail: string; readonly doc: string }> =
  new Map([
    ['print', { detail: '(Any...) -> Void', doc: 'Writes to the preview’s console.' }],
    ['min', { detail: '(T, T) -> T', doc: 'The smaller of two values.' }],
    ['max', { detail: '(T, T) -> T', doc: 'The larger of two values.' }],
    ['abs', { detail: '(T) -> T', doc: 'The magnitude, without its sign.' }],
    ['sqrt', { detail: '(Double) -> Double', doc: 'The square root.' }],
    ['pow', { detail: '(Double, Double) -> Double', doc: 'One value raised to another.' }],
    ['round', { detail: '(Double) -> Double', doc: 'Rounded; halves go away from zero.' }],
    ['floor', { detail: '(Double) -> Double', doc: 'Rounded down.' }],
    ['ceil', { detail: '(Double) -> Double', doc: 'Rounded up.' }],
    ['zip', { detail: '([A], [B]) -> [(A, B)]', doc: 'Two sequences in step, stopping at the shorter.' }],
    ['stride', { detail: '(from: T, to: T, by: T) -> [T]', doc: 'Values at regular intervals. `through:` includes the bound.' }],
    ['type', { detail: '(of: T) -> T.Type', doc: 'The dynamic type of a value.' }],
    ['fatalError', { detail: '(String) -> Never', doc: 'Stops immediately with a message.' }],
    ['assert', { detail: '(Bool, String) -> Void', doc: 'Stops when the condition is false.' }],
    ['assertionFailure', { detail: '(String) -> Void', doc: 'Stops with a message.' }],
    ['precondition', { detail: '(Bool, String) -> Void', doc: 'Stops when the condition is false.' }],
    ['preconditionFailure', { detail: '(String) -> Void', doc: 'Stops with a message.' }],
    ['withAnimation', { detail: '(Animation, () -> T) -> T', doc: 'Animates every change the closure makes.' }],
  ])

/** What each property wrapper is for, for hover on `@State` and friends. */
export const WRAPPER_DOCS: ReadonlyMap<string, string> = new Map([
  ['State', 'Storage owned by this view. Changing it re-renders. The setter is nonmutating.'],
  ['Binding', 'A read/write reference to storage owned somewhere else. Written `$value` by the owner.'],
  ['StateObject', 'An observable object created once per view identity.'],
  ['ObservedObject', 'An observable object owned elsewhere and passed in.'],
  ['EnvironmentObject', 'An observable object taken from the environment.'],
  ['Environment', 'A value from the environment, by key path.'],
  ['Published', 'A property of an observable object that announces its changes.'],
  ['GestureState', 'State that resets when the gesture ends.'],
  ['AppStorage', 'Backed by user defaults. Not implemented in the preview.'],
  ['SceneStorage', 'Backed by scene restoration. Not implemented in the preview.'],
  ['FocusState', 'Which field holds focus. Not implemented in the preview.'],
])

/**
 * The type name a written annotation refers to, for member lookup.
 *
 * `[Item]` is an Array, `[String: Int]` a Dictionary, `String?` a String. Written
 * here rather than in the caller because every one of these spellings turns up in
 * ordinary code and getting one wrong offers the wrong type's members.
 */
export function builtinTypeName(annotation: string | null): string | null {
  if (!annotation) return null

  let name = annotation.trim()
  while (name.endsWith('?') || name.endsWith('!')) name = name.slice(0, -1).trim()

  if (name.startsWith('[') && name.endsWith(']')) {
    // A dictionary's brackets hold a colon at the top level; an array's do not.
    let depth = 0
    for (let i = 1; i < name.length - 1; i++) {
      const ch = name[i]!
      if (ch === '[' || ch === '<' || ch === '(') depth++
      else if (ch === ']' || ch === '>' || ch === ')') depth--
      else if (ch === ':' && depth === 0) return 'Dictionary'
    }
    return 'Array'
  }

  const generic = name.indexOf('<')
  if (generic > 0) name = name.slice(0, generic)

  return STDLIB_MEMBERS.has(name) ? name : null
}
