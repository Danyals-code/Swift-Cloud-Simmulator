import { beforeEach, describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult, RenderNode } from '@studio/shared'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * The standard library, and the Foundation corner of it SwiftUI leans on.
 *
 * Every case here answered "cannot find X in scope" or "has no member X" before
 * Phase 5 of the defect register. They are grouped by what the code is doing rather
 * than by which file implements it: someone wondering whether `items.sort()` works
 * looks for the call, not for `stdlib.ts`.
 *
 * The assertions are on the *answer*, never on the absence of an error. A method
 * that exists and returns the wrong thing is the failure this phase was written to
 * remove, and a test that only checks for a clean compile would pass on it.
 */

const device = DEVICES['iphone-15']
let revision = 1

function run(source: string): CompileResult {
  resetPipelineState()
  return compile({
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  } satisfies CompileRequest)
}

function app(body: string, extra = ''): string {
  return [
    'import SwiftUI',
    '@main',
    'struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }',
    'struct ContentView: View {',
    body,
    '}',
    extra,
  ].join('\n')
}

const errors = (result: CompileResult): string[] =>
  result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)

const texts = (result: CompileResult): string[] =>
  (result.renderTree?.nodes ?? [])
    .filter((n) => n.text)
    .map((n) => n.text!.runs.map((r) => r.text).join(''))

function nodes(result: CompileResult): readonly RenderNode[] {
  return result.renderTree?.nodes ?? []
}

/** Renders `Text(verbatim: "\(expr)")`, Swift's own text for the value, and returns what it drew. */
function evaluate(expr: string, extra = ''): string {
  const result = run(app(`    var body: some View { Text(verbatim: "\\(${expr})") }`, extra))
  expect(errors(result)).toEqual([])
  return texts(result).join('')
}

/** Runs statements in a `-> String` method and returns what it drew. */
function runStatements(body: string, extra = ''): string {
  const result = run(
    app(`    var body: some View { Text(demo()) }\n    func demo() -> String {\n${body}\n    }`, extra),
  )
  expect(errors(result)).toEqual([])
  return texts(result).join('')
}

/** The first error a snippet reports, for the cases where trapping is the correct answer. */
function failure(source: string): string {
  const reported = errors(run(source))
  expect(reported.length).toBeGreaterThan(0)
  return reported[0]!
}

const view = (expr: string, extra = ''): CompileResult =>
  run(app(`    var body: some View { ${expr} }`, extra))

beforeEach(() => {
  resetPipelineState()
})

// ------------------------------------------------------------------ 5.1

describe('UUID, Date and URL exist at runtime', () => {
  it('makes a UUID that looks like one and is not the same twice', () => {
    const pair = evaluate('"\\(UUID().uuidString)|\\(UUID().uuidString)"').split('|')
    expect(pair[0]).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/)
    expect(pair[0]).not.toBe(pair[1])
  })

  it('interpolates a UUID as its string rather than as its type name', () => {
    expect(evaluate('UUID()')).toMatch(/^[0-9A-F-]{36}$/)
  })

  it('carries a UUID as an Identifiable id, which is what it is for', () => {
    const extra = 'struct Item: Identifiable { let id = UUID(); let title: String }'
    const body =
      '    let items = [Item(title: "One"), Item(title: "Two")]\n' +
      '    var body: some View { ForEach(items) { item in Text(item.title) } }'
    const result = run(app(body, extra))
    expect(errors(result)).toEqual([])
    expect(texts(result)).toEqual(['One', 'Two'])
  })

  it('reads a Date back as the interval it was built from', () => {
    expect(evaluate('Date(timeIntervalSince1970: 86_400).timeIntervalSince1970')).toBe('86400.0')
  })

  it('describes a Date the way Foundation does', () => {
    expect(evaluate('Date(timeIntervalSince1970: 0)')).toBe('1970-01-01 00:00:00 +0000')
  })

  it('adds an interval and measures the gap back', () => {
    expect(
      evaluate('Date(timeIntervalSince1970: 0).addingTimeInterval(60).timeIntervalSince1970'),
    ).toBe('60.0')
    expect(
      evaluate(
        'Date(timeIntervalSince1970: 90).timeIntervalSince(Date(timeIntervalSince1970: 30))',
      ),
    ).toBe('60.0')
  })

  it('compares two Dates, because Date is Comparable', () => {
    expect(evaluate('Date(timeIntervalSince1970: 1) < Date(timeIntervalSince1970: 2)')).toBe('true')
    expect(evaluate('Date(timeIntervalSince1970: 2) < Date(timeIntervalSince1970: 1)')).toBe('false')
    expect(evaluate('Date(timeIntervalSince1970: 1) == Date(timeIntervalSince1970: 1)')).toBe('true')
  })

  it('answers Date.now', () => {
    expect(evaluate('Date.now.timeIntervalSince1970 > 1_600_000_000')).toBe('true')
  })

  it('keeps a URL exactly as it was written', () => {
    expect(evaluate('URL(string: "https://example.com")!.absoluteString')).toBe(
      'https://example.com',
    )
  })

  it('answers nil for a string that is not a URL, which is why the idiom force-unwraps', () => {
    expect(evaluate('URL(string: "not a url") == nil')).toBe('true')
  })

  it('reads a URL apart', () => {
    const url = 'URL(string: "https://example.com/a/b.json?q=1")!'
    expect(evaluate(`${url}.host!`)).toBe('example.com')
    expect(evaluate(`${url}.path`)).toBe('/a/b.json')
    expect(evaluate(`${url}.lastPathComponent`)).toBe('b.json')
    expect(evaluate(`${url}.pathExtension`)).toBe('json')
  })

  it('builds a Link, which could not be constructed at all without URL', () => {
    const result = view('Link("Docs", destination: URL(string: "https://example.com")!)')
    expect(errors(result)).toEqual([])
    expect(texts(result)).toContain('Docs')
  })
})

describe('a Date drawn in a Text', () => {
  // The assertions are on the parts that do not move between machines. `Intl` uses
  // the platform's locale and zone, which is the point - the separators and the
  // order are the real ones rather than a transcription - so asserting the exact
  // string would be asserting where the test happens to run.
  const epoch = 'Date(timeIntervalSince1970: 0)'

  it('draws the date rather than an empty string', () => {
    const drawn = texts(run(app(`    var body: some View { Text(${epoch}) }`)))
    expect(drawn.join('')).toMatch(/1970/)
  })

  it('takes a style', () => {
    const time = texts(run(app(`    var body: some View { Text(${epoch}, style: .time) }`))).join('')
    expect(time).toMatch(/\d{1,2}:\d{2}/)
    expect(time).not.toMatch(/1970/)

    const date = texts(run(app(`    var body: some View { Text(${epoch}, style: .date) }`))).join('')
    expect(date).toMatch(/1970/)
  })

  it('draws a UUID and a URL as their own text', () => {
    expect(texts(run(app('    var body: some View { Text(UUID()) }'))).join('')).toMatch(
      /^[0-9A-F-]{36}$/,
    )
    expect(
      texts(run(app('    var body: some View { Text(URL(string: "https://a.co")!) }'))).join(''),
    ).toBe('https://a.co')
  })

  it('draws Text(verbatim:), which was also empty', () => {
    expect(texts(run(app('    var body: some View { Text(verbatim: "1 + 1") }')))).toEqual(['1 + 1'])
  })
})

// ------------------------------------------------------------------ 5.2

describe('CaseIterable.allCases', () => {
  const tab = 'enum Tab: String, CaseIterable { case home, search, settings }'

  it('lists every case, in declaration order', () => {
    expect(evaluate('Tab.allCases.map { $0.rawValue }.joined(separator: ",")', tab)).toBe(
      'home,search,settings',
    )
  })

  it('drives a ForEach, which is what it is almost always for', () => {
    const body =
      '    var body: some View { ForEach(Tab.allCases, id: \\.self) { tab in Text(tab.rawValue) } }'
    const result = run(app(body, tab))
    expect(errors(result)).toEqual([])
    expect(texts(result)).toEqual(['home', 'search', 'settings'])
  })

  it('is not synthesised for an enum that does not declare the conformance', () => {
    expect(failure(app('    var body: some View { Text("\\(Tab.allCases.count)") }', 'enum Tab { case home }'))).toContain(
      "has no member 'allCases'",
    )
  })

  it('leaves a hand-written allCases alone', () => {
    const manual =
      'enum Tab: CaseIterable { case home, search\n' +
      '    static var allCases: [Tab] { [.home] } }'
    expect(evaluate('Tab.allCases.count', manual)).toBe('1')
  })
})

// ------------------------------------------------------------------ 5.3

describe('Int and Double from a String', () => {
  it('parses what Swift parses', () => {
    expect(evaluate('Int("42") ?? -1')).toBe('42')
    expect(evaluate('Int("-7") ?? 0')).toBe('-7')
    expect(evaluate('Double("1.5") ?? 0')).toBe('1.5')
  })

  it('answers nil rather than trapping, which is the whole point of the optional', () => {
    expect(evaluate('Int("abc") == nil')).toBe('true')
    expect(evaluate('Int("") == nil')).toBe('true')
    expect(evaluate('Int("1.5") == nil')).toBe('true')
  })

  it('is no more permissive than Swift: leading space and underscores are nil', () => {
    // JavaScript's `Number` accepts both. A preview that accepts more than the
    // compiler shows a value where the app gets nil.
    expect(evaluate('Int(" 42") == nil')).toBe('true')
    expect(evaluate('Int("4_2") == nil')).toBe('true')
    expect(evaluate('Int("0x10") == nil')).toBe('true')
  })

  it('reads a text field the way a form does', () => {
    const body =
      '    @State private var entry = "12"\n' +
      '    var body: some View { Text("\\((Int(entry) ?? 0) * 2)") }'
    expect(texts(run(app(body)))).toEqual(['24'])
  })
})

// ------------------------------------------------------------------ 5.4

describe('Bool.toggle', () => {
  it('flips the value through the storage it came from', () => {
    expect(runStatements('      var flag = false\n      flag.toggle()\n      return "\\(flag)"')).toBe('true')
  })

  it('flips a property, not a copy of one', () => {
    const body =
      '    @State private var on = false\n' +
      '    var body: some View { Text("\\(on)").onAppear { on.toggle() } }'
    expect(texts(run(app(body)))).toEqual(['true'])
  })

  it('refuses a let, as Xcode does', () => {
    expect(
      failure(app('    var body: some View { Text(demo()) }\n    func demo() -> String {\n      let flag = false\n      flag.toggle()\n      return "\\(flag)"\n    }')),
    ).toContain('immutable value')
  })
})

// ------------------------------------------------------------------ 5.5

describe('the mutating collection methods', () => {
  const mutate = (statements: string): string =>
    runStatements(`      var items = [3, 1, 2]\n${statements}\n      return "\\(items)"`)

  it('removes the first element and answers it', () => {
    expect(runStatements('      var items = [3, 1, 2]\n      let first = items.removeFirst()\n      return "\\(first) \\(items)"')).toBe(
      '3 [1, 2]',
    )
  })

  it('discards a result with `_ =`, which did not parse as an assignment', () => {
    expect(runStatements('      var items = [1, 2]\n      _ = items.popLast()\n      return "\\(items)"')).toBe(
      '[1]',
    )
  })

  it('pops the last element, answering nil on empty rather than trapping', () => {
    expect(runStatements('      var items: [Int] = []\n      return "\\(items.popLast() == nil)"')).toBe('true')
    expect(mutate('      _ = items.popLast()')).toBe('[3, 1]')
  })

  it('sorts in place, with and without a comparator', () => {
    expect(mutate('      items.sort()')).toBe('[1, 2, 3]')
    expect(mutate('      items.sort(by: >)')).toBe('[3, 2, 1]')
    expect(mutate('      items.sort { $0 > $1 }')).toBe('[3, 2, 1]')
  })

  it('reverses in place', () => {
    expect(mutate('      items.reverse()')).toBe('[2, 1, 3]')
  })

  it('swaps two positions', () => {
    expect(mutate('      items.swapAt(0, 2)')).toBe('[2, 1, 3]')
  })

  it('replaces and removes a subrange', () => {
    expect(mutate('      items.replaceSubrange(0..<2, with: [9])')).toBe('[9, 2]')
    expect(mutate('      items.removeSubrange(0..<2)')).toBe('[2]')
  })

  it('traps on an index outside the collection instead of answering quietly', () => {
    expect(
      failure(app('    var body: some View { Text(demo()) }\n    func demo() -> String {\n      var items = [1]\n      items.swapAt(0, 5)\n      return "x"\n    }')),
    ).toContain('Index out of range')
  })

  it('refuses to mutate a let collection, which the preview used to allow', () => {
    // `let items = [1]` then `items.append(2)` ran, changed the array and reported
    // nothing, while Xcode refuses to build it. Found while adding the seven methods
    // above, each of which would have been a seventh way to do the same thing.
    const constant = (call: string): string =>
      failure(
        app(
          `    var body: some View { Text(demo()) }\n    func demo() -> String {\n      let items = [2, 1]\n      ${call}\n      return "x"\n    }`,
        ),
      )

    expect(constant('items.append(3)')).toContain("'items' is a 'let' constant")
    expect(constant('items.sort()')).toContain("'items' is a 'let' constant")
    expect(constant('items.removeAll()')).toContain("'items' is a 'let' constant")
  })

  it('refuses to mutate a collection held inside a let struct', () => {
    // The constancy has to travel through the member access: the constant holds the
    // struct, so writing one of its fields is writing to the constant.
    expect(
      failure(app('    var body: some View { Text(demo()) }\n    func demo() -> String {\n      let bag = Bag()\n      bag.items.append(1)\n      return "x"\n    }', 'struct Bag { var items: [Int] = [] }')),
    ).toContain("'bag.items' is a 'let' constant")
  })

  it('still mutates a collection held inside a let class', () => {
    // The opposite case, and the reason the rule cannot simply follow the binding: a
    // `let` on a class holds a *reference*, so the object's own properties stay
    // writable. `let store = Store()` in a view is the commonest shape there is.
    expect(
      runStatements(
        '      let store = Store()\n      store.items.append(1)\n      store.items.append(2)\n      return "\\(store.items.count)"',
        'class Store { var items: [Int] = [] }',
      ),
    ).toBe('2')
  })

  it('refuses to write through a let collection’s subscript', () => {
    expect(
      failure(app('    var body: some View { Text(demo()) }\n    func demo() -> String {\n      let scores = ["a": 1]\n      scores["b"] = 2\n      return "x"\n    }')),
    ).toContain("is a 'let' constant")
  })

  it('still allows every one of them on a var', () => {
    expect(runStatements('      var items = [2, 1]\n      items.append(3)\n      items.sort()\n      return "\\(items)"')).toBe(
      '[1, 2, 3]',
    )
  })

  it('traps on removeFirst from an empty collection', () => {
    expect(
      failure(app('    var body: some View { Text(demo()) }\n    func demo() -> String {\n      var items: [Int] = []\n      _ = items.removeFirst()\n      return "x"\n    }')),
    ).toContain('empty collection')
  })
})

// ------------------------------------------------------------------ 5.6

describe('maths', () => {
  it('answers the five free functions', () => {
    expect(evaluate('sqrt(9.0)')).toBe('3.0')
    expect(evaluate('pow(2.0, 10.0)')).toBe('1024.0')
    expect(evaluate('floor(1.7)')).toBe('1.0')
    expect(evaluate('ceil(1.2)')).toBe('2.0')
    expect(evaluate('round(1.5)')).toBe('2.0')
  })

  it('rounds halves away from zero, as Swift does and JavaScript does not', () => {
    // `Math.round(-1.5)` is -1. Swift's answer is -2, and so is `(-1.5).rounded()`.
    expect(evaluate('round(-1.5)')).toBe('-2.0')
    expect(evaluate('(-1.5).rounded()')).toBe('-2.0')
    expect(evaluate('(-2.5).rounded()')).toBe('-3.0')
  })

  it('takes a rounding rule', () => {
    expect(evaluate('(1.2).rounded(.up)')).toBe('2.0')
    expect(evaluate('(1.8).rounded(.down)')).toBe('1.0')
    expect(evaluate('(-1.8).rounded(.towardZero)')).toBe('-1.0')
  })

  it('answers truncatingRemainder', () => {
    expect(evaluate('(5.5).truncatingRemainder(dividingBy: 2.0)')).toBe('1.5')
  })
})

// ------------------------------------------------------------------ 5.7

describe('the free functions and type statics', () => {
  it('builds a Set that drops duplicates', () => {
    expect(evaluate('Set([1, 2, 2, 3]).count')).toBe('3')
  })

  it('builds an Array from a range, a string and a repeated value', () => {
    expect(evaluate('Array(1...3)')).toBe('[1, 2, 3]')
    expect(evaluate('Array("abc").count')).toBe('3')
    expect(evaluate('Array(repeating: 0, count: 3)')).toBe('[0, 0, 0]')
  })

  it('zips two collections, stopping at the shorter', () => {
    expect(evaluate('zip([1, 2, 3], ["a", "b"]).count')).toBe('2')
    expect(
      runStatements(
        '      var out = ""\n      for (n, s) in zip([1, 2], ["a", "b"]) { out += "\\(n)\\(s)" }\n      return out',
      ),
    ).toBe('1a2b')
  })

  it('strides to and through a bound', () => {
    expect(evaluate('Array(stride(from: 0, to: 6, by: 2))')).toBe('[0, 2, 4]')
    expect(evaluate('Array(stride(from: 0, through: 6, by: 2))')).toBe('[0, 2, 4, 6]')
    expect(evaluate('Array(stride(from: 3, to: 0, by: -1))')).toBe('[3, 2, 1]')
  })

  it('names a value type', () => {
    expect(evaluate('type(of: 1)')).toBe('Int')
    expect(evaluate('type(of: "a")')).toBe('String')
  })

  it('answers Int.max and Int.min, which is what a minimum search starts from', () => {
    expect(
      runStatements(
        '      var best = Int.max\n      for n in [4, 2, 9] { if n < best { best = n } }\n      return "\\(best)"',
      ),
    ).toBe('2')
    expect(evaluate('Int.min < 0')).toBe('true')
  })

  it('answers Double.pi', () => {
    expect(evaluate('(Double.pi * 100).rounded()')).toBe('314.0')
  })

  it('picks a random value inside the range it was given', () => {
    expect(evaluate('Int.random(in: 5...5)')).toBe('5')
    expect(evaluate('(1...6).contains(Int.random(in: 1...6))')).toBe('true')
    expect(evaluate('(0.0...1.0).contains(Double.random(in: 0...1))')).toBe('true')
  })

  it('is silent when an assertion holds', () => {
    expect(runStatements('      assert(1 == 1)\n      precondition(true)\n      return "ok"')).toBe('ok')
  })

  it('stops with the message it was given when one does not', () => {
    expect(
      failure(app('    var body: some View { Text(demo()) }\n    func demo() -> String {\n      fatalError("not built yet")\n    }')),
    ).toContain('not built yet')
    expect(
      failure(app('    var body: some View { Text(demo()) }\n    func demo() -> String {\n      precondition(false, "needs a value")\n      return "x"\n    }')),
    ).toContain('needs a value')
  })
})

// ------------------------------------------------------------------ 5.8

describe('String members', () => {
  it('capitalises every word', () => {
    expect(evaluate('"hello there".capitalized')).toBe('Hello There')
  })

  it('takes and drops from either end', () => {
    expect(evaluate('"abcdef".prefix(2)')).toBe('ab')
    expect(evaluate('"abcdef".suffix(2)')).toBe('ef')
    expect(evaluate('"abcdef".dropFirst()')).toBe('bcdef')
    expect(evaluate('"abcdef".dropLast(2)')).toBe('abcd')
  })

  it('reverses by character, so a composed emoji survives', () => {
    expect(evaluate('String("abc".reversed())')).toBe('cba')
    expect(evaluate('String("a👋🏽b".reversed())')).toBe('b👋🏽a')
  })

  it('separates into components, keeping the empty ones split drops', () => {
    expect(evaluate('"a,b,,c".components(separatedBy: ",").count')).toBe('4')
    expect(evaluate('"a,b".components(separatedBy: ",")[1]')).toBe('b')
  })

  it('pads to a length, and truncates past it', () => {
    expect(evaluate('"ab".padding(toLength: 5, withPad: ".", startingAt: 0)')).toBe('ab...')
    expect(evaluate('"abcdef".padding(toLength: 3, withPad: ".", startingAt: 0)')).toBe('abc')
  })

  it('counts unicode scalars, which is not the character count', () => {
    expect(evaluate('"👋🏽".count')).toBe('1')
    expect(evaluate('"👋🏽".unicodeScalars.count')).toBe('2')
  })

  it('appends in place', () => {
    expect(runStatements('      var text = "a"\n      text.append("b")\n      return text')).toBe('ab')
  })

  it('answers starts(with:)', () => {
    expect(evaluate('"abc".starts(with: "ab")')).toBe('true')
  })
})

// ------------------------------------------------------------------ 5.9

describe('Array members', () => {
  it('answers allSatisfy', () => {
    expect(evaluate('[2, 4].allSatisfy { $0 % 2 == 0 }')).toBe('true')
    expect(evaluate('[2, 5].allSatisfy { $0 % 2 == 0 }')).toBe('false')
  })

  it('flattens one level with flatMap', () => {
    expect(evaluate('[[1, 2], [3]].flatMap { $0 }')).toBe('[1, 2, 3]')
  })

  it('drops from either end', () => {
    expect(evaluate('[1, 2, 3].dropFirst()')).toBe('[2, 3]')
    expect(evaluate('[1, 2, 3].dropLast(2)')).toBe('[1]')
  })

  it('finds the first and last match', () => {
    expect(evaluate('[1, 2, 3].first { $0 > 1 } ?? 0')).toBe('2')
    expect(evaluate('[1, 2, 3].last { $0 > 1 } ?? 0')).toBe('3')
    expect(evaluate('[1, 2].first { $0 > 9 } == nil')).toBe('true')
  })

  it('shuffles and picks without losing or inventing elements', () => {
    expect(evaluate('[1, 2, 3].shuffled().sorted()')).toBe('[1, 2, 3]')
    expect(evaluate('[7].randomElement() ?? 0')).toBe('7')
    expect(evaluate('[Int]().randomElement() == nil')).toBe('true')
  })
})

// ------------------------------------------------------------------ 5.10

describe('Dictionary members', () => {
  const scores = '["b": 2, "a": 1]'

  it('sorts into an array of pairs', () => {
    expect(evaluate(`${scores}.sorted { $0.key < $1.key }.map { $0.key }.joined(separator: ",")`)).toBe(
      'a,b',
    )
  })

  it('maps the values and keeps a dictionary', () => {
    expect(evaluate(`${scores}.mapValues { $0 * 10 }["a"] ?? 0`)).toBe('10')
    expect(evaluate(`${scores}.mapValues { $0 * 10 }.count`)).toBe('2')
  })

  it('filters into a dictionary, not into an array', () => {
    expect(evaluate(`${scores}.filter { $0.value > 1 }.count`)).toBe('1')
    expect(evaluate(`${scores}.filter { $0.value > 1 }["b"] ?? 0`)).toBe('2')
  })

  it('drives a list the way a grouped screen does', () => {
    const body =
      '    let scores = ["b": 2, "a": 1]\n' +
      '    var body: some View { ForEach(scores.sorted { $0.key < $1.key }, id: \\.key) { pair in Text("\\(pair.key)=\\(pair.value)") } }'
    const result = run(app(body))
    expect(errors(result)).toEqual([])
    expect(texts(result)).toEqual(['a=1', 'b=2'])
  })
})

// ------------------------------------------------------------------ 5.11

describe('a key path where a closure is expected', () => {
  const person = 'struct Person { let name: String; let adult: Bool }'
  const people =
    'let people = [Person(name: "Ada", adult: true), Person(name: "Bo", adult: false)]'

  it('maps by key path', () => {
    expect(evaluate('people.map(\\.name).joined(separator: ",")', `${person}\n${people}`)).toBe(
      'Ada,Bo',
    )
  })

  it('filters and searches by key path', () => {
    expect(evaluate('people.filter(\\.adult).count', `${person}\n${people}`)).toBe('1')
    expect(evaluate('people.allSatisfy(\\.adult)', `${person}\n${people}`)).toBe('false')
    expect(evaluate('people.first(where: \\.adult)!.name', `${person}\n${people}`)).toBe('Ada')
  })
})

// ------------------------------------------------------------------ 5.12

describe('nested types', () => {
  it('constructs one through its parent', () => {
    expect(evaluate('Item.Status.draft.rawValue', 'struct Item { enum Status: String { case draft } }')).toBe(
      'draft',
    )
    expect(evaluate('Box.Inner(n: 5).n', 'struct Box { struct Inner { var n: Int } }')).toBe('5')
  })

  it('reaches one unqualified from inside its parent', () => {
    const extra =
      'struct Box {\n' +
      '    struct Inner { var n: Int }\n' +
      '    var inner = Inner(n: 7)\n' +
      '}'
    expect(evaluate('Box().inner.n', extra)).toBe('7')
  })

  it('keeps two nested types of the same name apart', () => {
    const extra =
      'struct A { struct Inner { var n = 1 } }\n' +
      'struct B { struct Inner { var n = 2 } }'
    expect(evaluate('"\\(A.Inner().n)\\(B.Inner().n)"', extra)).toBe('12')
  })

  it('gives a nested type its methods', () => {
    const extra = 'struct Item { struct Price { var amount: Int\n        func doubled() -> Int { amount * 2 } } }'
    expect(evaluate('Item.Price(amount: 4).doubled()', extra)).toBe('8')
  })
})

// ------------------------------------------------------------------ 5.13

describe('implicit self inside an extension on a built-in type', () => {
  it('calls a member of the receiver with no receiver written', () => {
    expect(evaluate('"ab".shout', 'extension String { var shout: String { uppercased() } }')).toBe('AB')
  })

  it('reads a property of the receiver', () => {
    expect(
      evaluate('"hello".isLong', 'extension String { var isLong: Bool { count > 3 } }'),
    ).toBe('true')
  })

  it('works on numbers too', () => {
    expect(
      evaluate('(4).describedTwice', 'extension Int { var describedTwice: String { description + description } }'),
    ).toBe('44')
  })

  it('still reaches a sibling the extension declared', () => {
    const extra =
      'extension String {\n' +
      '    var shout: String { uppercased() }\n' +
      '    var loud: String { shout + "!" }\n' +
      '}'
    expect(evaluate('"ab".loud', extra)).toBe('AB!')
  })
})

// ------------------------------------------------------------------ 5.14

describe('the small framework values', () => {
  it('pads each edge by its own length', () => {
    const result = view('Text("a").padding(EdgeInsets(top: 4, leading: 40, bottom: 4, trailing: 4))')
    expect(errors(result)).toEqual([])
    const text = nodes(result).find((n) => n.text)!
    // The leading inset is the one that has to arrive in the right field: swapping
    // leading and trailing is invisible in a symmetric layout and wrong in this one.
    expect(text.frame.x).toBeGreaterThanOrEqual(40)
  })

  it('reads an edge back off the value', () => {
    expect(evaluate('EdgeInsets(top: 1, leading: 2, bottom: 3, trailing: 4).leading')).toBe('2.0')
  })

  it('takes the line width from a StrokeStyle', () => {
    const result = view('Circle().stroke(Color.red, style: StrokeStyle(lineWidth: 6))')
    expect(errors(result)).toEqual([])
    expect(nodes(result).find((n) => n.shape)?.shape?.stroke?.width).toBe(6)
  })

  it('shades a colour into a gradient', () => {
    const result = view('Rectangle().fill(Color.red.gradient).frame(width: 40, height: 40)')
    expect(errors(result)).toEqual([])
    const fill = nodes(result).find((n) => n.shape)?.shape?.fill
    expect(fill?.kind).toBe('linearGradient')

    // Two stops, and the second is the darker one. A gradient from a colour to
    // itself renders as a flat fill and looks exactly like the feature working.
    const stops = (fill as { stops: readonly { color: { r: number } }[] }).stops
    expect(stops.length).toBe(2)
    expect(stops[1]!.color.r).toBeLessThan(stops[0]!.color.r)
  })

  it('spells a material either way', () => {
    const contextual = view('Text("a").padding().background(.ultraThinMaterial)')
    const explicit = view('Text("a").padding().background(Material.ultraThin)')
    expect(errors(explicit)).toEqual([])
    const left = nodes(contextual).find((n) => n.material)!.material!
    const right = nodes(explicit).find((n) => n.material)!.material!
    expect(right.opacity).toBe(left.opacity)
  })

  it('answers a GeometryProxy frame', () => {
    const result = run(
      app('    var body: some View { GeometryReader { geo in Text("\\(Int(geo.frame(in: .local).width))") } }'),
    )
    expect(errors(result)).toEqual([])
    expect(texts(result)).toEqual([String(device.width)])
  })

  it('combines two transitions instead of failing on the second', () => {
    const result = view('Text("a").transition(AnyTransition.opacity.combined(with: .slide))')
    expect(errors(result)).toEqual([])
    expect(texts(result)).toContain('a')
  })
})

// ------------------------------------------------------------------ 5.15

describe('the bitwise operators', () => {
  it('answers the five of them', () => {
    expect(evaluate('6 & 3')).toBe('2')
    expect(evaluate('6 | 3')).toBe('7')
    expect(evaluate('6 ^ 3')).toBe('5')
    expect(evaluate('1 << 3')).toBe('8')
    expect(evaluate('8 >> 2')).toBe('2')
  })

  it('keeps Swift’s precedence: shifts bind tighter than arithmetic', () => {
    expect(evaluate('1 << 2 + 1')).toBe('5')
    expect(evaluate('1 | 2 & 3')).toBe('3')
  })

  it('shifts past 32 bits, where JavaScript would wrap', () => {
    // `1 << 40` is 256 with JavaScript's own operators, which is a wrong number that
    // looks like a number.
    expect(evaluate('1 << 40')).toBe('1099511627776')
  })

  it('masks a negative number the way a 64-bit Int does', () => {
    expect(evaluate('-8 >> 1')).toBe('-4')
    expect(evaluate('-1 & 255')).toBe('255')
  })

  it('refuses two Doubles, as Swift does', () => {
    expect(failure(app('    var body: some View { Text("\\(1.5 & 1.0)") }'))).toContain('Int operands')
  })
})

// ------------------------------------------------------------------ the measure

describe('a file written the way people actually write one', () => {
  /**
   * The standing measure behind this phase: not one construct at a time, but the
   * shape of a real first file - a `UUID` id, a `CaseIterable` filter, a computed
   * list, `Int(_:)` on a field, and a sort. Each of the five pieces failed on its
   * own before Phase 5, and a file like this failed at the first of them.
   */
  const source = [
    'import SwiftUI',
    '',
    'struct Task: Identifiable {',
    '    let id = UUID()',
    '    let title: String',
    '    var done: Bool',
    '    let added: Date',
    '}',
    '',
    'enum Filter: String, CaseIterable {',
    '    case all, open, done',
    '}',
    '',
    '@main',
    'struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }',
    '',
    'struct ContentView: View {',
    '    @State private var filter: Filter = .open',
    '    @State private var entry = "2"',
    '    private let tasks = [',
    '        Task(title: "Write", done: false, added: Date(timeIntervalSince1970: 200)),',
    '        Task(title: "Ship", done: true, added: Date(timeIntervalSince1970: 100)),',
    '        Task(title: "Rest", done: false, added: Date(timeIntervalSince1970: 300)),',
    '    ]',
    '',
    '    private var shown: [Task] {',
    '        let matching = tasks.filter { task in',
    '            switch filter {',
    '            case .all: return true',
    '            case .open: return !task.done',
    '            case .done: return task.done',
    '            }',
    '        }',
    '        return matching.sorted { $0.added < $1.added }',
    '    }',
    '',
    '    var body: some View {',
    '        VStack {',
    '            ForEach(Filter.allCases, id: \\.self) { option in',
    '                Text(option.rawValue.capitalized)',
    '            }',
    '            ForEach(shown) { task in',
    '                Text(task.title)',
    '            }',
    '            Text("\\(shown.map(\\.title).joined(separator: "+"))")',
    '            Text("\\((Int(entry) ?? 0) * shown.count)")',
    '        }',
    '    }',
    '}',
  ].join('\n')

  it('compiles with nothing reported', () => {
    const result = run(source)
    expect(result.diagnostics.filter((d) => d.severity !== 'info').map((d) => d.message)).toEqual([])
  })

  it('draws what the code says it draws', () => {
    const drawn = texts(run(source))
    expect(drawn).toEqual(['All', 'Open', 'Done', 'Write', 'Rest', 'Write+Rest', '4'])
  })
})

// ------------------------------------------------------------------ no false positives

describe('none of it changes what ordinary code reports', () => {
  const clean = (source: string): void => {
    const result = run(source)
    expect(result.diagnostics.filter((d) => d.severity !== 'info').map((d) => d.message)).toEqual([])
  }

  it('says nothing about a project type called Date or URL', () => {
    // A local declaration shadows the framework's, which is Swift's own rule and
    // matters here: `Date` is an ordinary name for a calendar app's own model.
    const extra = 'struct Date { var label: String }'
    expect(evaluate('Date(label: "mine").label', extra)).toBe('mine')
  })

  it('says nothing about a project function called round or assert', () => {
    const extra = 'func round(_ text: String) -> String { "(" + text + ")" }'
    expect(evaluate('round("a")', extra)).toBe('(a)')
  })

  it('leaves a plain view chain alone', () => {
    clean(app('    var body: some View { Text("Hi").font(.title).padding().foregroundStyle(.blue) }'))
  })

  it('leaves a project’s own extension alone', () => {
    clean(
      app('    var body: some View { Text("Hi").card() }', 'extension View { func card() -> some View { padding() } }'),
    )
  })

  it('leaves a nested type alone', () => {
    clean(app('    var body: some View { Text(Item.Status.draft.rawValue) }', 'struct Item { enum Status: String { case draft } }'))
  })
})
