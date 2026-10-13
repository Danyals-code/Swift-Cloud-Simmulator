import { FREE_FUNCTIONS, STDLIB_MEMBERS, type StdlibMember } from '@studio/swift-sema'

/**
 * The standard library the browser preview runs, one line per type.
 *
 * Built from the editor's member table rather than written out by hand, and that
 * table is run member by member through the interpreter in `tests/editor.test.ts`:
 * every name here is one the preview really has, and a member added to the runtime
 * and the table reaches both prompts with nobody editing them. Types that share a
 * list - `Double`, `Float` and `CGFloat` - share a line.
 */
export function previewStdlibList(): string {
  const types = new Map<readonly StdlibMember[], string[]>()
  for (const [name, members] of STDLIB_MEMBERS) types.set(members, [...(types.get(members) ?? []), name])
  const lines = [...types].map(([members, names]) => `- ${names.join(', ')}: ${[...new Set(members.map(member => member.name))].join(', ')}`)
  lines.push(`- Free functions: ${[...FREE_FUNCTIONS.keys()].join(', ')}`)
  lines.push(`- Making values: ${PREVIEW_INITIALIZERS.join(', ')}`)
  return lines.join('\n')
}

/** Ways to make a value, as written. `preview-stdlib.test.ts` runs every one in the preview. */
export const PREVIEW_INITIALIZERS: readonly string[] = [
  'Int("42")', 'Double("1.5")', 'String(42)', 'String(format: "%.1f", x)', 'String(repeating: "-", count: 3)',
  'Array(1...3)', 'Array(repeating: 0, count: 3)', 'Set([1, 2])', 'Dictionary(grouping: items, by: { $0.kind })',
  'Dictionary(uniqueKeysWithValues: pairs)', 'Int.random(in: 1...6)', 'Double.random(in: 0...1)', 'UUID()', 'Date()',
  'Date(timeIntervalSince1970: 0)', 'URL(string: "https://example.com")',
]

/**
 * Valid Swift the preview does not run, named in the prompt as examples.
 *
 * Each is paired with an expression `preview-stdlib.test.ts` runs and expects to fail,
 * so an example stops being named the day the preview learns it.
 */
export const PREVIEW_UNSUPPORTED: readonly (readonly [name: string, probe: string])[] = [
  ['String.map', '"ab".map { $0 }'],
  ['String.filter', '"ab".filter { $0 != "a" }'],
  ['Character.isLetter', 'Character("a").isLetter'],
  ['Dictionary.first', '["a": 1].first'],
  ['Array.lazy', '[1].lazy'],
  ['Array.count(where:)', '[1].count(where: { $0 > 0 })'],
  ['Calendar', 'Calendar.current'],
  ['.dateTime format styles', 'Date().formatted(.dateTime.month())'],
]

/**
 * What generated code may call, and what to write instead of the rest.
 *
 * Code outside this list compiles in Xcode and stops the preview with "has no
 * member", which is the failure a model cannot see coming: the code is correct
 * Swift. Saying which members exist is cheaper than repairing the screen after.
 */
export const PREVIEW_STDLIB = `Preview standard library: the browser preview interprets Swift and runs only the standard-library members listed here. Anything else on these types (for example ${PREVIEW_UNSUPPORTED.map(([name]) => name).join(', ')}) stops the preview with "has no member" even though Xcode accepts it. Stay within the list; when something is missing, write a small loop or helper function instead. Format numbers with Text(value, format: .currency(code:) / .percent / .number), value.formatted(...) with the same styles, String(format:), or "\\(value, specifier: "%.1f")". Format dates with Text(date, style: .date) or date.formatted(). A Set<T> is supported, including insert, remove, contains, union, intersection, subtracting and the subset checks; call .sorted() before showing one, since a set has no order.
${previewStdlibList()}`
