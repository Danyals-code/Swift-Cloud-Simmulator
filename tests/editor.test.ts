import { describe, expect, it } from 'vitest'
import type { CompileRequest } from '@studio/shared'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { FREE_FUNCTIONS, STDLIB_MEMBERS } from '@studio/swift-sema'
import { DEVICES } from '@studio/sim-shell'

/**
 * The editor's description of the standard library, checked against the runtime.
 *
 * `swift-sema` names the members for completion and hover; `swift-runtime`
 * implements them; the packages cannot import each other. Two tables that describe
 * the same thing drift, and the direction that matters is one-way: a member the
 * editor offers and the runtime does not have is a name suggested to the user that
 * does nothing when they use it.
 *
 * So every entry in the table is exercised here as real Swift, through the real
 * pipeline, and the second test makes the two lists cover each other - a member
 * added to the table without an expression here fails, rather than going unchecked.
 */

const device = DEVICES['iphone-15']
let revision = 1

function run(body: string): readonly string[] {
  resetPipelineState()
  const source = [
    'import SwiftUI',
    '@main',
    'struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }',
    'struct ContentView: View {',
    '    var body: some View { Text(demo()) }',
    '    func demo() -> String {',
    body,
    '        return "ok"',
    '    }',
    '}',
  ].join('\n')

  const result = compile({
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  } satisfies CompileRequest)

  return result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)
}

/**
 * One expression per member, written the way the member is really called.
 *
 * The receiver is a `var` throughout so the mutating members are legal on it, and
 * every call carries real arguments: a member called wrongly can fail for a reason
 * that is not "it does not exist", and that is the only failure this is looking for.
 */
const EXERCISES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  String: {
    count: 'r.count',
    isEmpty: 'r.isEmpty',
    first: 'r.first',
    last: 'r.last',
    capitalized: 'r.capitalized',
    unicodeScalars: 'r.unicodeScalars.count',
    indices: 'r.indices.count',
    description: 'r.description',
    uppercased: 'r.uppercased()',
    lowercased: 'r.lowercased()',
    hasPrefix: 'r.hasPrefix("a")',
    hasSuffix: 'r.hasSuffix("a")',
    starts: 'r.starts(with: "a")',
    contains: 'r.contains("a")',
    localizedCaseInsensitiveContains: 'r.localizedCaseInsensitiveContains("A")',
    localizedStandardContains: 'r.localizedStandardContains("A")',
    replacingOccurrences: 'r.replacingOccurrences(of: "a", with: "b")',
    split: 'r.split(separator: ",").count',
    components: 'r.components(separatedBy: ",").count',
    trimmingCharacters: 'r.trimmingCharacters(in: .whitespaces)',
    prefix: 'r.prefix(1)',
    suffix: 'r.suffix(1)',
    dropFirst: 'r.dropFirst()',
    dropLast: 'r.dropLast()',
    reversed: 'String(r.reversed())',
    padding: 'r.padding(toLength: 4, withPad: "-", startingAt: 0)',
    append: 'r.append("b")',
  },
  Array: {
    count: 'r.count',
    isEmpty: 'r.isEmpty',
    first: 'r.first',
    last: 'r.last',
    indices: 'r.indices.count',
    map: 'r.map { $0 + 1 }',
    filter: 'r.filter { $0 > 0 }',
    compactMap: 'r.compactMap { $0 }',
    flatMap: 'r.flatMap { [$0] }',
    reduce: 'r.reduce(0) { $0 + $1 }',
    forEach: 'r.forEach { _ = $0 }',
    sorted: 'r.sorted()',
    reversed: 'r.reversed()',
    shuffled: 'r.shuffled()',
    joined: 'r.map { "\\($0)" }.joined(separator: ",")',
    contains: 'r.contains(1)',
    allSatisfy: 'r.allSatisfy { $0 > 0 }',
    firstIndex: 'r.firstIndex(of: 1)',
    lastIndex: 'r.lastIndex(of: 1)',
    randomElement: 'r.randomElement()',
    enumerated: 'r.enumerated().count',
    prefix: 'r.prefix(1)',
    suffix: 'r.suffix(1)',
    dropFirst: 'r.dropFirst()',
    dropLast: 'r.dropLast()',
    min: 'r.min()',
    max: 'r.max()',
    append: 'r.append(4)',
    insert: 'r.insert(0, at: 0)',
    remove: 'r.remove(at: 0)',
    removeAll: 'r.removeAll()',
    removeFirst: 'r.removeFirst()',
    removeLast: 'r.removeLast()',
    popLast: 'r.popLast()',
    sort: 'r.sort()',
    reverse: 'r.reverse()',
    swapAt: 'r.swapAt(0, 1)',
    replaceSubrange: 'r.replaceSubrange(0..<1, with: [9])',
    removeSubrange: 'r.removeSubrange(0..<1)',
  },
  Set: {
    count: 'r.count',
    isEmpty: 'r.isEmpty',
    first: 'r.first',
    contains: 'r.contains(1)',
    insert: 'r.insert(9)',
    map: 'r.map { $0 + 1 }',
    filter: 'r.filter { $0 > 0 }',
    sorted: 'r.sorted()',
    forEach: 'r.forEach { _ = $0 }',
    reduce: 'r.reduce(0) { $0 + $1 }',
    allSatisfy: 'r.allSatisfy { $0 > 0 }',
    randomElement: 'r.randomElement()',
  },
  Dictionary: {
    count: 'r.count',
    isEmpty: 'r.isEmpty',
    keys: 'r.keys.count',
    values: 'r.values.count',
    mapValues: 'r.mapValues { $0 + 1 }.count',
    filter: 'r.filter { $0.value > 0 }.count',
    sorted: 'r.sorted { $0.key < $1.key }.count',
    map: 'r.map { $0.key }.count',
    contains: 'r.contains { $0.value > 0 }',
    updateValue: 'r.updateValue(2, forKey: "a")',
    removeValue: 'r.removeValue(forKey: "a")',
  },
  Int: {
    description: 'r.description',
    magnitude: 'r.magnitude',
    isMultiple: 'r.isMultiple(of: 2)',
    quotientAndRemainder: 'r.quotientAndRemainder(dividingBy: 2).quotient',
    formatted: 'r.formatted()',
  },
  Double: {
    description: 'r.description',
    magnitude: 'r.magnitude',
    isNaN: 'r.isNaN',
    isFinite: 'r.isFinite',
    rounded: 'r.rounded()',
    squareRoot: 'r.squareRoot()',
    truncatingRemainder: 'r.truncatingRemainder(dividingBy: 2.0)',
    isMultiple: 'r.isMultiple(of: 2.0)',
    formatted: 'r.formatted()',
  },
  Bool: {
    description: 'r.description',
    toggle: 'r.toggle()',
  },
  Date: {
    timeIntervalSince1970: 'r.timeIntervalSince1970',
    timeIntervalSinceReferenceDate: 'r.timeIntervalSinceReferenceDate',
    description: 'r.description',
    addingTimeInterval: 'r.addingTimeInterval(60)',
    timeIntervalSince: 'r.timeIntervalSince(Date(timeIntervalSince1970: 0))',
    formatted: 'r.formatted()',
  },
  URL: {
    absoluteString: 'r.absoluteString',
    path: 'r.path',
    host: 'r.host',
    scheme: 'r.scheme',
    query: 'r.query',
    lastPathComponent: 'r.lastPathComponent',
    pathExtension: 'r.pathExtension',
    appendingPathComponent: 'r.appendingPathComponent("b")',
  },
  UUID: {
    uuidString: 'r.uuidString',
  },
  Range: {
    count: 'r.count',
    isEmpty: 'r.isEmpty',
    lowerBound: 'r.lowerBound',
    upperBound: 'r.upperBound',
    contains: 'r.contains(1)',
  },
  ClosedRange: {
    count: 'r.count',
    isEmpty: 'r.isEmpty',
    lowerBound: 'r.lowerBound',
    upperBound: 'r.upperBound',
    contains: 'r.contains(1)',
  },
}

/** A receiver of each type, as a `var` so the mutating members are legal. */
const RECEIVERS: Readonly<Record<string, string>> = {
  String: 'var r = "abc"',
  Array: 'var r = [1, 2, 3]',
  Set: 'var r = Set([1, 2, 3])',
  Dictionary: 'var r = ["a": 1]',
  Int: 'var r = 42',
  Double: 'var r = 1.5',
  Bool: 'var r = true',
  Date: 'var r = Date(timeIntervalSince1970: 1000)',
  URL: 'var r = URL(string: "https://example.com/a/b.json?q=1")!',
  UUID: 'var r = UUID()',
  Range: 'var r = 0..<3',
  ClosedRange: 'var r = 0...3',
}

/** The types the editor describes but whose members are the same list as another's. */
const ALIASES: Readonly<Record<string, string>> = { Float: 'Double', CGFloat: 'Double' }

describe('every member the editor offers, the runtime has', () => {
  for (const [typeName, members] of STDLIB_MEMBERS) {
    if (ALIASES[typeName]) continue

    it(`${typeName}`, () => {
      const receiver = RECEIVERS[typeName]
      expect(receiver, `no receiver written for ${typeName}`).toBeDefined()

      const missing: string[] = []
      for (const member of members) {
        const call = EXERCISES[typeName]?.[member.name]
        expect(call, `no expression written for ${typeName}.${member.name}`).toBeDefined()

        const errors = run(`        ${receiver}\n        _ = ${call}`)
        const absent = errors.filter((message) => message.includes(`has no member '${member.name}'`))
        if (absent.length > 0) missing.push(`${member.name}: ${absent[0]}`)
      }
      expect(missing).toEqual([])
    })
  }

  it('describes every member it exercises, and exercises every one it describes', () => {
    // Both directions. An expression with no table entry is a member the editor
    // forgot to offer; a table entry with no expression is a claim nothing checked.
    for (const [typeName, exercises] of Object.entries(EXERCISES)) {
      const described = new Set((STDLIB_MEMBERS.get(typeName) ?? []).map((m) => m.name))
      expect(Object.keys(exercises).sort(), typeName).toEqual([...described].sort())
    }
  })

  it('has a receiver and a list for every type it describes', () => {
    for (const typeName of STDLIB_MEMBERS.keys()) {
      if (ALIASES[typeName]) continue
      expect(RECEIVERS[typeName], typeName).toBeDefined()
      expect(EXERCISES[typeName], typeName).toBeDefined()
    }
  })
})

describe('every free function the editor describes, the runtime has', () => {
  const CALLS: Readonly<Record<string, string>> = {
    print: 'print("a")',
    min: 'min(1, 2)',
    max: 'max(1, 2)',
    abs: 'abs(-1)',
    sqrt: 'sqrt(4.0)',
    pow: 'pow(2.0, 3.0)',
    round: 'round(1.5)',
    floor: 'floor(1.5)',
    ceil: 'ceil(1.5)',
    zip: 'zip([1], ["a"]).count',
    stride: 'Array(stride(from: 0, to: 4, by: 2)).count',
    type: 'type(of: 1)',
    fatalError: 'false ? fatalError("x") : ()',
    assert: 'assert(true)',
    assertionFailure: 'false ? assertionFailure("x") : ()',
    precondition: 'precondition(true)',
    preconditionFailure: 'false ? preconditionFailure("x") : ()',
    withAnimation: 'withAnimation { 1 }',
  }

  it('calls each one', () => {
    const missing: string[] = []
    for (const name of FREE_FUNCTIONS.keys()) {
      const call = CALLS[name]
      expect(call, `no call written for ${name}`).toBeDefined()

      const errors = run(`        _ = ${call}`)
      const unknown = errors.filter(
        (message) => message.includes(`Cannot find '${name}'`) || message.includes(`has no member '${name}'`),
      )
      if (unknown.length > 0) missing.push(`${name}: ${unknown[0]}`)
    }
    expect(missing).toEqual([])
  })
})
