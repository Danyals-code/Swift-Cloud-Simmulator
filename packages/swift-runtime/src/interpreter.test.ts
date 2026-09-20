import { describe, expect, it } from 'vitest'
import { LineIndex } from '@studio/shared'
import { Parser } from '@studio/swift-syntax'
import { Interpreter, type InterpreterOptions } from './interpreter'
import { ExecutionBudgetExceeded, SwiftTrap, UnsupportedAtRuntime } from './errors'
import { describe as show, type SwiftValue } from './values'

const FILE = 'Test.swift'

interface RunResult {
  readonly value: SwiftValue
  readonly logs: string[]
  readonly source: string
}

/** Parses `source`, then calls its `test()` function. */
function run(source: string, options: InterpreterOptions = {}): RunResult {
  const logs: string[] = []
  const { sourceFile, diagnostics } = Parser.parse(source, FILE)
  expect(diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([])

  const interpreter = new Interpreter({
    ...options,
    host: { log: (message) => logs.push(message), ...options.host },
  })
  interpreter.load([sourceFile])

  const entry = interpreter.globals.lookup('test')
  if (entry?.value.kind !== 'function') throw new Error('snippet has no test() function')

  const value = interpreter.callFunction(entry.value, [], sourceFile.span)
  return { value, logs, source }
}

/** Runs `body` as the contents of `func test()`, returning printed output. */
function output(body: string, prelude = ''): string[] {
  return run(`${prelude}\nfunc test() {\n${body}\n}`).logs
}

/** Evaluates a single expression and renders it the way Swift's `print` would. */
function evaluate(expression: string, prelude = ''): string {
  return output(`print(${expression})`, prelude)[0] ?? ''
}

function expectTrap(source: string, options: InterpreterOptions = {}): SwiftTrap {
  try {
    run(source, options)
  } catch (error) {
    if (error instanceof SwiftTrap) return error
    throw error
  }
  throw new Error('expected a SwiftTrap, but the snippet completed')
}

// ===========================================================================

describe('literals and operators', () => {
  it.each([
    ['1 + 2', '3'],
    ['10 - 4', '6'],
    ['6 * 7', '42'],
    ['2 + 3 * 4', '14'],
    ['(2 + 3) * 4', '20'],
    ['-5 + 3', '-2'],
    ['1.5 + 2.25', '3.75'],
    ['true && false', 'false'],
    ['true || false', 'true'],
    ['!true', 'false'],
    ['3 < 5', 'true'],
    ['3 == 3', 'true'],
    ['"a" + "b"', 'ab'],
    ['"abc".count', '3'],
    ['[1, 2] + [3]', '[1, 2, 3]'],
    ['5 > 3 ? "yes" : "no"', 'yes'],
  ])('evaluates %s to %s', (expression, expected) => {
    expect(evaluate(expression)).toBe(expected)
  })

  it('truncates integer division the way Swift does', () => {
    // `5 / 2` is 2 in Swift, not 2.5. Getting this wrong is silent and pervasive.
    expect(evaluate('5 / 2')).toBe('2')
    expect(evaluate('-7 / 2')).toBe('-3')
    expect(evaluate('5.0 / 2.0')).toBe('2.5')
  })

  it('keeps Int and Double distinct in output', () => {
    expect(evaluate('4 / 2')).toBe('2')
    expect(evaluate('4.0')).toBe('4.0')
    expect(evaluate('2.0 * 3.0')).toBe('6.0')
  })

  it('short-circuits && and ||', () => {
    // Without short-circuiting this traps on an out-of-range index.
    expect(output('let xs: [Int] = []\nif xs.count > 0 && xs[0] > 1 { print("no") }\nprint("ok")')).toEqual(['ok'])
  })

  it('applies ?? only when the left side is nil', () => {
    expect(evaluate('nil ?? 7')).toBe('7')
    expect(evaluate('3 ?? 7')).toBe('3')
  })

  it('measures strings in grapheme clusters', () => {
    // Swift's `count` is graphemes; naive JS `.length` would say 4 here.
    expect(evaluate('"👋🏽".count')).toBe('1')
    expect(evaluate('"e\\u{301}".count')).toBe('1')
  })
})

describe('value semantics (Phase 2 gate 1)', () => {
  const POINT = 'struct Point { var x = 0\n    var y = 0 }'

  it('copies a struct on assignment', () => {
    expect(
      output(
        `var a = Point()
         var b = a
         b.x = 5
         print(a.x)
         print(b.x)`,
        POINT,
      ),
    ).toEqual(['0', '5'])
  })

  it('copies an array on assignment', () => {
    expect(
      output(`var a = [1, 2, 3]
              var b = a
              b.append(4)
              print(a.count)
              print(b.count)`),
    ).toEqual(['3', '4'])
  })

  it('copies a struct held inside an array', () => {
    expect(
      output(
        `var points = [Point()]
         var copy = points
         copy[0].x = 9
         print(points[0].x)
         print(copy[0].x)`,
        POINT,
      ),
    ).toEqual(['0', '9'])
  })

  it('copies a nested struct field', () => {
    expect(
      output(
        `var outer = Wrapper()
         var other = outer
         other.point.x = 7
         print(outer.point.x)`,
        `${POINT}\nstruct Wrapper { var point = Point() }`,
      ),
    ).toEqual(['0'])
  })

  it('passes arguments by value', () => {
    expect(
      output(
        `var a = [1, 2]
         print(consume(a))
         print(a.count)`,
        `func consume(_ items: [Int]) -> Int {
             var local = items
             local.append(99)
             return local.count
         }`,
      ),
    ).toEqual(['3', '2'])
  })

  it('does not copy closures - they are reference types', () => {
    expect(
      output(`var total = 0
              let bump = { total += 1 }
              let alias = bump
              bump()
              alias()
              print(total)`),
    ).toEqual(['2'])
  })
})

describe('structs and methods (Phase 2 gate 2)', () => {
  it('synthesises a memberwise initialiser', () => {
    expect(
      output('let c = Card(title: "Hi", count: 3)\nprint(c.title)\nprint(c.count)', 'struct Card { var title = ""\n  var count = 0 }'),
    ).toEqual(['Hi', '3'])
  })

  it('accepts positional memberwise arguments', () => {
    expect(
      output('let c = Card("Hi", 3)\nprint(c.title)', 'struct Card { var title = ""\n  var count = 0 }'),
    ).toEqual(['Hi'])
  })

  it('runs a mutating method against the caller’s storage', () => {
    expect(
      output(
        `var c = Counter()
         c.bump()
         c.bump()
         print(c.n)`,
        `struct Counter {
             var n = 0
             mutating func bump() { n += 1 }
         }`,
      ),
    ).toEqual(['2'])
  })

  it('refuses a mutating method on a let constant', () => {
    const trap = expectTrap(`struct Counter {
        var n = 0
        mutating func bump() { n += 1 }
    }
    func test() {
        let c = Counter()
        c.bump()
    }`)
    expect(trap.reason).toContain("is a 'let' constant")
  })

  it('re-evaluates a computed property on every read', () => {
    // This is what makes `body` reflect current state rather than construction-time state.
    expect(
      output(
        `var c = Counter()
         print(c.doubled)
         c.n = 5
         print(c.doubled)`,
        `struct Counter {
             var n = 1
             var doubled: Int { n * 2 }
         }`,
      ),
    ).toEqual(['2', '10'])
  })

  it('lets a later stored property reference an earlier one', () => {
    expect(
      output('let c = Chain()\nprint(c.b)', 'struct Chain { var a = 2\n  var b = 4 }'),
    ).toEqual(['4'])
  })

  it('calls a method on self implicitly', () => {
    expect(
      output(
        'let c = Greeter()\nprint(c.greeting)',
        `struct Greeter {
             var name = "World"
             func greet() -> String { "Hello, " + name }
             var greeting: String { greet() }
         }`,
      ),
    ).toEqual(['Hello, World'])
  })
})

describe('closures capture by reference', () => {
  it('mutates the enclosing variable', () => {
    // Exactly the mechanism behind `Button("Plus") { count += 1 }`.
    expect(
      output(`var count = 0
              let increment = { count += 1 }
              increment()
              increment()
              increment()
              print(count)`),
    ).toEqual(['3'])
  })

  it('mutates a struct property from a closure', () => {
    expect(
      output(
        `var view = Model()
         view.makeIncrementer()()
         print(view.count)`,
        `struct Model {
             var count = 0
             func makeIncrementer() -> () -> Void { { } }
         }`,
      ),
    ).toEqual(['0'])
  })

  it('supports $0 shorthand', () => {
    expect(evaluate('[1, 2, 3].map { $0 * 2 }')).toBe('[2, 4, 6]')
  })

  it('supports named closure parameters', () => {
    expect(evaluate('[1, 2, 3].map { value in value + 10 }')).toBe('[11, 12, 13]')
  })

  it('supports two-parameter closures', () => {
    expect(evaluate('[1, 2, 3, 4].reduce(0) { total, next in total + next }')).toBe('10')
  })
})

describe('control flow', () => {
  it('branches on if/else if/else', () => {
    expect(
      output(`for n in 0..<3 {
                if n == 0 { print("zero") }
                else if n == 1 { print("one") }
                else { print("many") }
              }`),
    ).toEqual(['zero', 'one', 'many'])
  })

  it('iterates a half-open range', () => {
    expect(output('for i in 0..<3 { print(i) }')).toEqual(['0', '1', '2'])
  })

  it('iterates a closed range', () => {
    expect(output('for i in 1...3 { print(i) }')).toEqual(['1', '2', '3'])
  })

  it('iterates an array', () => {
    expect(output('for name in ["a", "b"] { print(name) }')).toEqual(['a', 'b'])
  })

  it('snapshots the sequence, so mutation inside the loop does not extend it', () => {
    expect(
      output(`var items = [1, 2]
              for item in items {
                  items.append(item)
              }
              print(items.count)`),
    ).toEqual(['4'])
  })

  it('returns early from a function', () => {
    expect(
      output('print(firstEven([1, 3, 4, 6]))', `func firstEven(_ xs: [Int]) -> Int {
          for x in xs {
              if x % 2 == 0 { return x }
          }
          return -1
      }`),
    ).toEqual(['4'])
  })

  it('scopes loop variables to the loop body', () => {
    expect(
      output(`let i = "outer"
              for i in 0..<2 { print(i) }
              print(i)`),
    ).toEqual(['0', '1', 'outer'])
  })
})

describe('traps carry the right reason and position (Phase 2 gate 4)', () => {
  /** Resolves a trap's span to a 1-based line/column in the snippet. */
  function positionOf(trap: SwiftTrap, source: string) {
    return new LineIndex(source).locate(trap.span.start)
  }

  it('traps on integer division by zero', () => {
    const source = ['func test() {', '    let d = 0', '    print(10 / d)', '}'].join('\n')
    const trap = expectTrap(source)
    expect(trap.reason).toBe('Division by zero')
    expect(positionOf(trap, source).line).toBe(3)
  })

  it('traps on an out-of-range index', () => {
    const source = ['func test() {', '    let xs = [1, 2]', '    print(xs[5])', '}'].join('\n')
    const trap = expectTrap(source)
    expect(trap.reason).toBe('Index out of range')
    expect(positionOf(trap, source).line).toBe(3)
  })

  it('traps on arithmetic overflow rather than losing precision', () => {
    // The alternative is a silently wrong answer, which costs far more to debug.
    const trap = expectTrap('func test() {\n    print(9007199254740991 + 9007199254740991)\n}')
    expect(trap.reason).toContain('overflowed')
  })

  it('traps on force-unwrapping nil', () => {
    const trap = expectTrap('func test() {\n    let x: Int? = nil\n    print(x!)\n}')
    expect(trap.reason).toBe('Unexpectedly found nil while unwrapping an Optional value')
  })

  it('traps on an unknown member, naming it', () => {
    const trap = expectTrap('func test() {\n    print("hi".notAThing)\n}')
    expect(trap.reason).toContain("has no member 'notAThing'")
  })

  it('carries a Swift-shaped call stack, innermost first', () => {
    const trap = expectTrap(`struct Box {
        var n = 0
        func explode() -> Int { n / 0 }
    }
    func test() { print(Box().explode()) }`)
    expect(trap.frames[0]?.name).toBe('Box.explode')
    expect(trap.frames.map((f) => f.name)).toContain('test')
  })
})

describe('execution budget (Phase 2 gate 3)', () => {
  it('abandons an unbounded loop instead of hanging', () => {
    // The failure mode this prevents is a Web Worker that never returns, which the
    // user experiences as a preview frozen with no explanation.
    expect(() => run('func test() {\n    for i in 0..<100000000 { print(i) }\n}', { stepBudget: 5_000 })).toThrow(
      ExecutionBudgetExceeded,
    )
  })

  it('abandons infinite recursion without a stack overflow', () => {
    // Left alone this would surface as a RangeError naming the interpreter's own
    // frames rather than the user's code.
    let caught: unknown
    try {
      run('func loop() -> Int { loop() }\nfunc test() { print(loop()) }')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ExecutionBudgetExceeded)
    expect((caught as ExecutionBudgetExceeded).message).toContain('never ends')
  })

  it('names a source position so the loop is findable', () => {
    const source = 'func test() {\n    for i in 0..<100000000 { print(i) }\n}'
    try {
      run(source, { stepBudget: 5_000 })
    } catch (error) {
      const line = new LineIndex(source).locate((error as ExecutionBudgetExceeded).span.start).line
      expect(line).toBe(2)
    }
  })

  it('completes ordinary work well inside the budget', () => {
    expect(output('var total = 0\nfor i in 0..<1000 { total += i }\nprint(total)')).toEqual(['499500'])
  })
})

describe('standard library', () => {
  it.each([
    ['[3, 1, 2].sorted()', '[1, 2, 3]'],
    ['[1, 2, 3].filter { $0 > 1 }', '[2, 3]'],
    ['[1, 2, 3].reduce(0) { $0 + $1 }', '6'],
    ['[1, 2, 3].contains(2)', 'true'],
    ['[1, 2, 3].reversed()', '[3, 2, 1]'],
    ['["a", "b"].joined(separator: "-")', 'a-b'],
    ['[1, 2, 3].first', '1'],
    ['[Int]().isEmpty', 'true'],
    ['"Hello".uppercased()', 'HELLO'],
    ['"Hello".hasPrefix("He")', 'true'],
    ['"a,b".split(separator: ",")', '["a", "b"]'],
    ['min(3, 7)', '3'],
    ['max(3, 7)', '7'],
    ['abs(-4)', '4'],
    ['(0..<5).count', '5'],
  ])('evaluates %s to %s', (expression, expected) => {
    expect(evaluate(expression)).toBe(expected)
  })

  it('mutates an array in place through a method', () => {
    expect(
      output(`var xs = [1]
              xs.append(2)
              xs.insert(0, at: 0)
              print(xs)`),
    ).toEqual(['[0, 1, 2]'])
  })
})

describe('string interpolation', () => {
  it('renders values the way Swift does', () => {
    expect(evaluate('"n = \\(1 + 1)"')).toBe('n = 2')
    expect(evaluate('"d = \\(1.5)"')).toBe('d = 1.5')
    expect(evaluate('"whole = \\(2.0)"')).toBe('whole = 2.0')
    expect(evaluate('"b = \\(true)"')).toBe('b = true')
  })

  it('does not quote an interpolated string, but does quote one inside a collection', () => {
    expect(evaluate('"x = \\("hi")"')).toBe('x = hi')
    expect(evaluate('["hi"]')).toBe('["hi"]')
  })

  it('interpolates a struct using its memberwise description', () => {
    expect(
      evaluate('"\\(Point(x: 1, y: 2))"', 'struct Point { var x = 0\n  var y = 0 }'),
    ).toBe('Point(x: 1, y: 2)')
  })
})

describe('the host seam', () => {
  it('asks the host for names the interpreter does not own', () => {
    const seen: string[] = []
    const result = run('func test() { print(mystery) }', {
      host: {
        resolveGlobal: (name) => {
          seen.push(name)
          return name === 'mystery' ? { kind: 'string', value: 'from host' } : undefined
        },
      },
    })
    expect(seen).toContain('mystery')
    expect(result.logs).toEqual(['from host'])
  })

  it('routes an unknown global call to the host with its trailing closure', () => {
    let received: { name: string; count: number } | null = null
    run('func test() { VStack { 1; 2; 3 } }', {
      host: {
        callGlobal: (name, call) => {
          const contents = call.trailingClosure ? call.invokeBuilder(call.trailingClosure) : []
          received = { name, count: contents.length }
          return { kind: 'void' }
        },
      },
    })
    // A result builder collects every expression, not just the last.
    expect(received).toEqual({ name: 'VStack', count: 3 })
  })

  it('gives the builder only the taken branch of an if', () => {
    let count = -1
    run('func test() { Group { if false { 1 } else { 2; 3 } } }', {
      host: {
        callGlobal: (_name, call) => {
          count = call.trailingClosure ? call.invokeBuilder(call.trailingClosure).length : -1
          return { kind: 'void' }
        },
      },
    })
    expect(count).toBe(2)
  })

  it('flattens a loop in the builder, one entry per iteration', () => {
    let values: string[] = []
    run('func test() { Group { for i in 0..<3 { i } } }', {
      host: {
        callGlobal: (_name, call) => {
          values = call.trailingClosure
            ? call.invokeBuilder(call.trailingClosure).map((v) => show(v))
            : []
          return { kind: 'void' }
        },
      },
    })
    expect(values).toEqual(['0', '1', '2'])
  })

  it('evaluates a single-expression body exactly once', () => {
    // Re-evaluating for the implicit return would double every side effect.
    let calls = 0
    run('func test() { effect() }', {
      host: {
        callGlobal: (name) => {
          if (name !== 'effect') return undefined
          calls++
          return { kind: 'void' }
        },
      },
    })
    expect(calls).toBe(1)
  })
})

describe('review regressions: storage and lexical scopes', () => {
  it('initializes static stored references once, but computed properties on every access', () => {
    expect(output(`Store.shared.count += 1
      print(Store.shared.count)
      print(Store.fresh.count)
      print(Store.fresh.count)`, `class Store {
        var count = 0
        static let shared = Store()
        static var fresh: Store { Store() }
      }`)).toEqual(['1', '0', '0'])
  })

  it('invalidates stored statics when a program is reloaded', () => {
    const logs: string[] = []
    const interpreter = new Interpreter({ host: { log: text => logs.push(text) } })
    for (const initial of [1, 2]) {
      const { sourceFile } = Parser.parse(`struct Config { static let count = ${initial} }\nfunc test() { print(Config.count) }`, FILE)
      interpreter.load([sourceFile])
      const fn = interpreter.globals.lookup('test')!.value
      if (fn.kind !== 'function') throw new Error('missing test')
      interpreter.callFunction(fn, [], sourceFile.span)
    }
    expect(logs).toEqual(['1', '2'])
  })

  it('does not insert a dictionary default when calling a nonmutating member', () => {
    expect(output(`var values: [String: [Int]] = [:]
      print(values["missing", default: []].contains(1))
      print(values["missing", default: []].isEmpty)
      print(values.count)`)).toEqual(['false', 'true', '0'])
  })

  it('writes back default structs after mutating methods, including through a computed property', () => {
    expect(output(`var values: [String: Counter] = [:]
      values["missing", default: Counter()].increment()
      values["missing", default: Counter()].increment()
      print(values.count)
      print(values["missing", default: Counter()].value)
      var box = Box()
      box.counter.increment()
      print(box.stored.value)
      print(box.writes)`, `struct Counter { var value = 0; mutating func increment() { value += 1 } }
      struct Box {
        var stored = Counter()
        var writes = 0
        var counter: Counter { get { stored } set { writes += 1; stored = newValue } }
      }`)).toEqual(['1', '2', '1', '1'])
  })

  it('captures explicit values at creation while leaving other variables captured by reference', () => {
    expect(output(`var count = 1
      var live = 1
      let snapshot = { [count] in print(count); print(live) }
      count = 2
      live = 3
      snapshot()`)).toEqual(['1', '3'])
  })

  it('writes back mutations completed before a struct method throws', () => {
    expect(output(`var values: [String: Counter] = [:]
      do { try values["missing", default: Counter()].increment() } catch {}
      print(values.count)
      print(values["missing", default: Counter()].value)`, `enum Failure: Error { case stopped }
      struct Counter {
        var value = 0
        mutating func increment() throws { value += 1; throw Failure.stopped }
      }`)).toEqual(['1', '1'])
  })

  it('evaluates aliased captures once and copies captured arrays', () => {
    expect(output(`var values = [1]
      var evaluations = 0
      func next() -> Int { evaluations += 1; return evaluations }
      let snapshot = { [saved = values, number = next()] in print(saved); print(number) }
      values.append(2)
      snapshot()
      snapshot()
      print(evaluations)`)).toEqual(['[1]', '1', '[1]', '1', '1'])
  })

  it('retains class reference semantics in an explicit capture', () => {
    expect(output(`let counter = Counter()
      let read = { [counter] in print(counter.value) }
      counter.value = 7
      read()`, 'class Counter { var value = 0 }')).toEqual(['7'])
  })

  it.each(['weak', 'unowned', 'unowned(safe)', 'unowned(unsafe)'])('diagnoses %s captures instead of silently changing their lifetime semantics', ownership => {
    const { sourceFile, diagnostics } = Parser.parse(`class Box {}\nlet box = Box()\nlet read = { [${ownership} box] in print(box) }`, FILE)
    expect(diagnostics.some(diagnostic => diagnostic.message.includes('closure captures'))).toBe(true)
    expect(() => new Interpreter().load([sourceFile])).toThrow(UnsupportedAtRuntime)
  })

  it('targets the named loop for break and continue, including through a switch', () => {
    expect(output(`var visits = 0
      outer: for _ in 0..<3 {
        for _ in 0..<3 {
          visits += 1
          switch visits { default: break outer }
        }
      }
      print(visits)
      var tails = 0
      again: for _ in 0..<3 {
        for _ in 0..<3 { continue again }
        tails += 1
      }
      print(tails)`)).toEqual(['1', '0'])
  })

  it('supports labelled do and if exits without swallowing an enclosing loop exit', () => {
    expect(output(`scope: do {
        if true { break scope }
        print("unreachable")
      }
      condition: if true {
        for _ in 0..<2 { break condition }
        print("unreachable")
      }
      print("done")`)).toEqual(['done'])
  })

  it('executes nested defers on lexical scope exit in reverse order', () => {
    expect(output(`defer { print("function") }
      if true {
        defer { print("first") }
        defer { print("second") }
        print("inside")
      }
      print("after")`)).toEqual(['inside', 'second', 'first', 'after', 'function'])
  })

  it('drains defers for each loop iteration and on labelled exits', () => {
    expect(output(`outer: for i in 0..<3 {
        defer { print(i) }
        for _ in 0..<2 {
          defer { print("inner") }
          if i == 0 { continue outer }
          break outer
        }
      }
      print("after")`)).toEqual(['inner', '0', 'inner', '1', 'after'])
  })

  it('runs defers before catch and preserves function return values', () => {
    expect(output(`do {
        defer { print("cleanup") }
        throw Failure.bad
      } catch { print("caught") }
      print(value())`, `enum Failure: Error { case bad }
      func value() -> Int { defer { print("return cleanup") }; return 7 }`)).toEqual(['cleanup', 'caught', 'return cleanup', '7'])
  })
})
