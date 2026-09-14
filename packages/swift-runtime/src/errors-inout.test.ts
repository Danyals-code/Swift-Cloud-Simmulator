import { describe, expect, it } from 'vitest'
import { Parser } from '@studio/swift-syntax'
import { Interpreter } from './interpreter'

/**
 * Error handling, `inout` and `super` - Phase 8c.
 *
 * All three are about where a value goes rather than what it is, which is why they
 * are tested by running code and reading what came out: a `catch` that binds the
 * wrong clause, an `inout` that writes to a copy, and a `super` call that dispatches
 * back to the override all produce well-formed trees and wrong answers.
 */

function run(source: string): string[] {
  const parsed = Parser.parse(`${source}\n`, 'Sources/Test.swift')
  expect(
    parsed.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message),
    'the fixture must parse cleanly',
  ).toEqual([])

  const logs: string[] = []
  const interpreter = new Interpreter({
    host: {
      log: (message) => {
        logs.push(message)
      },
    },
  })

  interpreter.load([parsed.sourceFile])
  const main = interpreter.globals.lookup('main')
  if (main?.value.kind === 'function') {
    interpreter.callFunction(main.value, [], parsed.sourceFile.span)
  }
  return logs
}

describe('throwing and catching', () => {
  it('catches an error thrown one call down', () => {
    expect(
      run(`
enum LoadError: Error {
    case missing
}

func load(_ ok: Bool) throws -> String {
    if !ok { throw LoadError.missing }
    return "data"
}

func main() {
    do {
        print(try load(true))
        print(try load(false))
        print("not reached")
    } catch {
        print("caught")
    }
}`),
    ).toEqual(['data', 'caught'])
  })

  it('binds the error to the implicit name', () => {
    expect(
      run(`
enum LoadError: Error {
    case missing
    case corrupt(String)
}

func fail() throws {
    throw LoadError.corrupt("header")
}

func main() {
    do {
        try fail()
    } catch {
        switch error {
        case .missing: print("missing")
        case .corrupt(let detail): print("corrupt " + detail)
        }
    }
}`),
    ).toEqual(['corrupt header'])
  })

  it('binds the error to a name the clause chooses', () => {
    expect(
      run(`
enum E: Error { case bad }

func fail() throws { throw E.bad }

func main() {
    do {
        try fail()
    } catch let problem {
        print("got it")
    }
}`),
    ).toEqual(['got it'])
  })

  it('takes the first clause that matches, in order', () => {
    expect(
      run(`
enum E: Error {
    case first
    case second
}

func fail() throws { throw E.second }

func main() {
    do {
        try fail()
    } catch E.first {
        print("wrong")
    } catch E.second {
        print("right")
    } catch {
        print("fallback")
    }
}`),
    ).toEqual(['right'])
  })

  it('falls through to a bare catch when no pattern matches', () => {
    expect(
      run(`
enum E: Error {
    case first
    case second
}

func fail() throws { throw E.second }

func main() {
    do {
        try fail()
    } catch E.first {
        print("wrong")
    } catch {
        print("fallback")
    }
}`),
    ).toEqual(['fallback'])
  })

  it('keeps an unmatched throw travelling outward', () => {
    // Swallowing it here would turn a real failure into silence three layers away.
    expect(
      run(`
enum E: Error {
    case inner
    case outer
}

func fail() throws { throw E.inner }

func main() {
    do {
        do {
            try fail()
        } catch E.outer {
            print("wrong")
        }
    } catch {
        print("outer caught it")
    }
}`),
    ).toEqual(['outer caught it'])
  })

  it('turns a throw into nil with try?', () => {
    expect(
      run(`
enum E: Error { case bad }

func load(_ ok: Bool) throws -> String {
    if !ok { throw E.bad }
    return "data"
}

func main() {
    if let good = try? load(true) {
        print(good)
    }
    let bad = try? load(false)
    if bad == nil { print("nil") }
}`),
    ).toEqual(['data', 'nil'])
  })

  it('traps on try! when the call throws', () => {
    expect(() =>
      run(`
enum E: Error { case bad }

func fail() throws -> Int { throw E.bad }

func main() {
    print("\\(try! fail())")
}`),
    ).toThrow()
  })

  it('does not trap on try! when the call succeeds', () => {
    expect(
      run(`
func fine() throws -> Int { 7 }

func main() {
    print("\\(try! fine())")
}`),
    ).toEqual(['7'])
  })

  it('runs a do block with no catches as a plain scope', () => {
    expect(
      run(`
func main() {
    let outer = 1
    do {
        let inner = outer + 1
        print("\\(inner)")
    }
}`),
    ).toEqual(['2'])
  })

  it('unwinds out of a loop', () => {
    expect(
      run(`
enum E: Error { case stop }

func check(_ n: Int) throws -> Int {
    if n > 2 { throw E.stop }
    return n
}

func main() {
    do {
        for n in [1, 2, 3, 4] {
            print("\\(try check(n))")
        }
    } catch {
        print("stopped")
    }
}`),
    ).toEqual(['1', '2', 'stopped'])
  })
})

describe('inout parameters', () => {
  it('writes back to the caller', () => {
    expect(
      run(`
func bump(_ value: inout Int) {
    value += 1
}

func main() {
    var count = 0
    bump(&count)
    bump(&count)
    print("\\(count)")
}`),
    ).toEqual(['2'])
  })

  it('swaps two variables', () => {
    expect(
      run(`
func exchange(_ a: inout Int, _ b: inout Int) {
    let temp = a
    a = b
    b = temp
}

func main() {
    var x = 1
    var y = 2
    exchange(&x, &y)
    print("\\(x) \\(y)")
}`),
    ).toEqual(['2 1'])
  })

  it('writes back through a property', () => {
    expect(
      run(`
struct Counter {
    var count = 0
}

func bump(_ value: inout Int) {
    value += 10
}

func main() {
    var c = Counter()
    bump(&c.count)
    print("\\(c.count)")
}`),
    ).toEqual(['10'])
  })

  it('refuses a let constant', () => {
    // Passing a `let` as `inout` is a compile error in Swift, and the useful thing
    // here is that it fails loudly rather than writing into a copy nobody reads.
    expect(() =>
      run(`
func bump(_ value: inout Int) { value += 1 }

func main() {
    let fixed = 0
    bump(&fixed)
}`),
    ).toThrow()
  })

  it('leaves a plain parameter copied', () => {
    expect(
      run(`
func bump(_ value: Int) -> Int {
    var local = value
    local += 1
    return local
}

func main() {
    var count = 0
    print("\\(bump(count)) \\(count)")
}`),
    ).toEqual(['1 0'])
  })
})

describe('super', () => {
  it('calls the method it overrode', () => {
    expect(
      run(`
class Animal {
    func speak() -> String { "..." }
}

class Dog: Animal {
    override func speak() -> String { super.speak() + " woof" }
}

func main() {
    print(Dog().speak())
}`),
    ).toEqual(['... woof'])
  })

  it('does not dispatch back to the override', () => {
    // The failure this guards is an infinite recursion, not a wrong string: if
    // `super.speak()` resolved against the instance's own type it would call itself.
    expect(
      run(`
class A {
    func name() -> String { "A" }
}

class B: A {
    override func name() -> String { "B(" + super.name() + ")" }
}

class C: B {
    override func name() -> String { "C(" + super.name() + ")" }
}

func main() {
    print(C().name())
}`),
    ).toEqual(['C(B(A))'])
  })

  it('reads an inherited property through super', () => {
    expect(
      run(`
class Base {
    var label = "base"
}

class Sub: Base {
    func describe() -> String { super.label }
}

func main() {
    print(Sub().describe())
}`),
    ).toEqual(['base'])
  })
})

describe('an uncaught throw', () => {
  it('surfaces as a runtime failure rather than escaping', () => {
    // It has to become something the pipeline recognises. Anything it does not
    // recognise is re-thrown, which takes the whole compile down with it - and the
    // preview would go blank instead of showing a diagnostic.
    expect(() =>
      run(`
enum E: Error { case bad }

func fail() throws { throw E.bad }

func main() {
    try fail()
}`),
    ).toThrow()
  })
})

describe('concurrency runs synchronously', () => {
  it('runs an async function where it is called', () => {
    // One rule, stated in the coverage matrix: the preview has no concurrency, so
    // everything async runs immediately and in order. `await` is transparent.
    expect(
      run(`
func load() async -> String {
    return "data"
}

func main() {
    print("before")
    let result = await load()
    print(result)
    print("after")
}`),
    ).toEqual(['before', 'data', 'after'])
  })

  it('accepts try await on a throwing async function', () => {
    expect(
      run(`
enum E: Error { case bad }

func load(_ ok: Bool) async throws -> String {
    if !ok { throw E.bad }
    return "data"
}

func main() {
    do {
        print(try await load(true))
        print(try await load(false))
    } catch {
        print("caught")
    }
}`),
    ).toEqual(['data', 'caught'])
  })
})

describe('a project declaration shadows the host', () => {
  it('prefers a user type named after a SwiftUI one', () => {
    // `Task` is an ordinary name for a to-do app's model type, and the host now
    // claims it for concurrency. Swift's rule is that the local declaration wins.
    expect(
      run(`
struct Task {
    var title: String
}

func main() {
    print(Task(title: "write tests").title)
}`),
    ).toEqual(['write tests'])
  })
})
