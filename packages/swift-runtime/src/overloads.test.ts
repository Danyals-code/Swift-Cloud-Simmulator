import { describe, expect, it } from 'vitest'
import { Parser } from '@studio/swift-syntax'
import { Interpreter } from './interpreter'

/**
 * Members that share a name.
 *
 * Swift identifies a function by its name *and* its argument labels, and lets a
 * property and a method share a base name outright. Neither was true here: members
 * were keyed on the bare name, so the later declaration silently replaced the
 * earlier one - and because the interpreter is untyped, the call that was left then
 * ran the wrong body with an unbound parameter and returned an *answer* rather than
 * an error.
 *
 * That is the worst failure this product can have. The whole claim is that what runs
 * in the preview is what Xcode compiles, and a wrong number with no diagnostic is
 * indistinguishable from a right one until it reaches a Mac.
 */

function run(source: string): string[] {
  const parsed = Parser.parse(`${source}\n`, 'Sources/Test.swift')
  expect(
    parsed.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message),
    'the fixture must parse cleanly',
  ).toEqual([])

  const logs: string[] = []
  const interpreter = new Interpreter({ host: { log: (message) => void logs.push(message) } })
  interpreter.load([parsed.sourceFile])

  const main = interpreter.globals.lookup('main')
  if (main?.value.kind === 'function') {
    interpreter.callFunction(main.value, [], parsed.sourceFile.span)
  }
  return logs
}

describe('overloading by argument label', () => {
  it('calls the one the labels name', () => {
    expect(
      run(`
struct Box {
    func value(of n: Int) -> String { return "of:\\(n)" }
    func value(from n: Int) -> String { return "from:\\(n)" }
}

func main() {
    let box = Box()
    print(box.value(of: 1))
    print(box.value(from: 2))
}`),
    ).toEqual(['of:1', 'from:2'])
  })

  it('keeps them apart on an enum as well as a struct', () => {
    expect(
      run(`
enum Side {
    case left
    case right

    func nudged(by amount: Int) -> Int { return amount }
    func nudged(to amount: Int) -> Int { return amount * 10 }
}

func main() {
    print("\\(Side.left.nudged(by: 3)) \\(Side.left.nudged(to: 3))")
}`),
    ).toEqual(['3 30'])
  })

  it('picks the right one from an unqualified call inside the type', () => {
    expect(
      run(`
struct Week {
    let days = ["Mon", "Tue"]

    func total(on day: String) -> Int { return day.count }
    func total(of n: Int) -> Int { return n * 100 }

    func report() -> String { return "\\(total(on: "Mon")) \\(total(of: 2))" }
}

func main() { print(Week().report()) }`),
    ).toEqual(['3 200'])
  })

  it('chooses an initialiser by its labels', () => {
    expect(
      run(`
struct Point {
    var x = 0
    var y = 0

    init(x: Int) {
        self.x = x
        self.y = 0
    }

    init(both n: Int) {
        self.x = n
        self.y = n
    }
}

func main() {
    let a = Point(x: 5)
    let b = Point(both: 7)
    print("\\(a.x),\\(a.y) \\(b.x),\\(b.y)")
}`),
    ).toEqual(['5,0 7,7'])
  })

  it('still resolves a call whose labels match nothing, rather than refusing', () => {
    // A trailing closure arrives unlabelled even where its parameter has a label, so
    // an unmatched call falls back to the first declaration instead of failing.
    expect(
      run(`
struct Runner {
    func go(action: () -> Int) -> Int { return action() }
}

func main() { print("\\(Runner().go { 42 })") }`),
    ).toEqual(['42'])
  })
})

describe('a method and a property sharing a name', () => {
  it('reads the property and calls the method', () => {
    expect(
      run(`
final class Ledger {
    var amounts = [10, 20, 30]

    var spent: Int {
        return amounts.reduce(0) { running, next in return running + next }
    }

    func spent(over limit: Int) -> Int {
        return amounts.filter { n in return n > limit }
            .reduce(0) { running, next in return running + next }
    }
}

func main() {
    let ledger = Ledger()
    print("\\(ledger.spent) \\(ledger.spent(over: 15))")
}`),
    ).toEqual(['60 50'])
  })

  it('does the same for an unqualified call inside the type', () => {
    // This was the shape that failed first: `heaviest` calling `spent(on:)` found the
    // `Double` the property returns and tried to call it.
    expect(
      run(`
struct Basket {
    let prices = [4, 9, 16]

    var total: Int {
        return prices.reduce(0) { running, next in return running + next }
    }

    func total(over limit: Int) -> Int {
        return prices.filter { n in return n > limit }
            .reduce(0) { running, next in return running + next }
    }

    var summary: String { return "\\(total) \\(total(over: 5))" }
}

func main() { print(Basket().summary) }`),
    ).toEqual(['29 25'])
  })
})

describe('a projection reaches the members of what it projects', () => {
  it('writes through $store.property, as SwiftUI does', () => {
    // `Slider(value: $ledger.monthlyBudget)`, spelled without SwiftUI.
    expect(
      run(`
final class Settings {
    var volume = 3
}

func main() {
    let settings = Settings()
    var level = $settings.volume
    level = level + 4
    print("\\(settings.volume)")
}`),
    ).toEqual(['7'])
  })

  it('writes a struct field back through the binding it came from', () => {
    // A class is a reference and needs no write-back; a value type does, or the
    // change lands on a copy and vanishes.
    expect(
      run(`
struct Draft {
    var title = "one"
}

func main() {
    var draft = Draft()
    var bound = $draft.title
    bound = "two"
    print(draft.title)
}`),
    ).toEqual(['two'])
  })
})
