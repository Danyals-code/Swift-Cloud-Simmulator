import { describe, expect, it } from 'vitest'
import { Parser } from '@studio/swift-syntax'
import { Interpreter } from './interpreter'
import { describe as describeValue, type SwiftValue } from './values'

/**
 * The language features Phase 7 added: classes, enums, pattern matching and the
 * control flow the vertical slice left out.
 *
 * Everything here is checked by *running* it and reading what `print` said, rather
 * than by inspecting the tree. A parser that accepts `switch` and an interpreter that
 * takes the wrong branch would pass a structural test and fail a user.
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

function value(source: string): SwiftValue {
  const logs = run(`func main() { ${source} }`)
  return { kind: 'string', value: logs.join('|') }
}

describe('classes', () => {
  it('shares an instance rather than copying it', () => {
    // The defining difference between a class and a struct, and the reason
    // ObservableObject can work at all.
    expect(
      run(`
class Counter {
    var count = 0
}

func main() {
    let a = Counter()
    let b = a
    b.count = 5
    print("\\(a.count) \\(b.count)")
}`),
    ).toEqual(['5 5'])
  })

  it('still copies a struct', () => {
    expect(
      run(`
struct Counter {
    var count = 0
}

func main() {
    var a = Counter()
    var b = a
    b.count = 5
    print("\\(a.count) \\(b.count)")
}`),
    ).toEqual(['0 5'])
  })

  it('mutates through a let binding, because the reference is what is constant', () => {
    expect(
      run(`
class Box {
    var value = 1
}

func main() {
    let box = Box()
    box.value = 9
    print("\\(box.value)")
}`),
    ).toEqual(['9'])
  })

  it('runs a declared initialiser', () => {
    expect(
      run(`
class Person {
    var name: String
    var greeting = ""

    init(name: String) {
        self.name = name
        self.greeting = "Hello, " + name
    }
}

func main() {
    let p = Person(name: "Ada")
    print(p.greeting)
}`),
    ).toEqual(['Hello, Ada'])
  })

  it('calls a method that mutates its own state', () => {
    expect(
      run(`
class Counter {
    var count = 0

    func bump() {
        count += 1
    }
}

func main() {
    let c = Counter()
    c.bump()
    c.bump()
    print("\\(c.count)")
}`),
    ).toEqual(['2'])
  })
})

describe('enums', () => {
  it('constructs and compares cases', () => {
    expect(
      run(`
enum Direction {
    case north, south
}

func main() {
    let d = Direction.north
    print("\\(d == Direction.north) \\(d == Direction.south)")
}`),
    ).toEqual(['true false'])
  })

  it('carries an implicit String raw value', () => {
    expect(
      run(`
enum Tab: String {
    case home, settings
}

func main() {
    print(Tab.settings.rawValue)
}`),
    ).toEqual(['settings'])
  })

  it('carries an explicit raw value', () => {
    expect(
      run(`
enum Status: String {
    case ok = "fine"
    case bad = "broken"
}

func main() {
    print(Status.ok.rawValue)
}`),
    ).toEqual(['fine'])
  })

  it('builds a case from a raw value, and nil when there is none', () => {
    expect(
      run(`
enum Tab: String {
    case home, settings
}

func main() {
    let found = Tab(rawValue: "settings")
    let missing = Tab(rawValue: "nope")
    print("\\(found == Tab.settings) \\(missing == nil)")
}`),
    ).toEqual(['true true'])
  })

  it('carries associated values', () => {
    expect(
      run(`
enum Load {
    case idle
    case failed(String)
}

func main() {
    let state = Load.failed("timeout")
    switch state {
    case .idle:
        print("idle")
    case .failed(let reason):
        print("failed: " + reason)
    }
}`),
    ).toEqual(['failed: timeout'])
  })

  it('resolves contextual member syntax against a declared type', () => {
    // `.home` has no base to resolve against; the annotation is what says what it means.
    expect(
      run(`
enum Tab: String {
    case home, settings
}

func main() {
    let tab: Tab = .settings
    print(tab.rawValue)
}`),
    ).toEqual(['settings'])
  })

  it('supports methods and computed properties on the case', () => {
    expect(
      run(`
enum Tab {
    case home, settings

    var title: String {
        switch self {
        case .home:
            return "Home"
        case .settings:
            return "Settings"
        }
    }
}

func main() {
    print(Tab.settings.title)
}`),
    ).toEqual(['Settings'])
  })
})

describe('switch', () => {
  it('takes the matching case and nothing after it', () => {
    // Swift does not fall through, and a test that only checked the right branch ran
    // would pass even if every later branch ran too.
    expect(
      run(`
func main() {
    let n = 2
    switch n {
    case 1:
        print("one")
    case 2:
        print("two")
    case 3:
        print("three")
    default:
        print("many")
    }
}`),
    ).toEqual(['two'])
  })

  it('falls to default when nothing matches', () => {
    expect(
      run(`
func main() {
    switch 9 {
    case 1:
        print("one")
    default:
        print("many")
    }
}`),
    ).toEqual(['many'])
  })

  it('matches a range', () => {
    expect(
      run(`
func main() {
    switch 7 {
    case 0...5:
        print("low")
    case 6...10:
        print("high")
    default:
        print("off the scale")
    }
}`),
    ).toEqual(['high'])
  })

  it('matches several patterns in one case', () => {
    expect(
      run(`
func main() {
    switch "b" {
    case "a", "b":
        print("early")
    default:
        print("late")
    }
}`),
    ).toEqual(['early'])
  })

  it('binds the subject with case let, and honours where', () => {
    expect(
      run(`
func main() {
    let n = 12
    switch n {
    case let x where x > 10:
        print("big \\(x)")
    case let x:
        print("small \\(x)")
    }
}`),
    ).toEqual(['big 12'])
  })
})

describe('guard', () => {
  it('continues when the condition holds', () => {
    expect(
      run(`
func check(_ value: Int) {
    guard value > 0 else {
        print("not positive")
        return
    }
    print("positive")
}

func main() {
    check(1)
    check(-1)
}`),
    ).toEqual(['positive', 'not positive'])
  })

  it('binds a value that outlives it', () => {
    // The whole point of `guard let`: the binding escapes into the enclosing scope.
    expect(
      run(`
func main() {
    let name: String? = "Ada"
    guard let unwrapped = name else {
        print("missing")
        return
    }
    print("hello " + unwrapped)
}`),
    ).toEqual(['hello Ada'])
  })
})

describe('optional binding', () => {
  it('unwraps in an if', () => {
    expect(
      run(`
func main() {
    let value: Int? = 3
    if let v = value {
        print("got \\(v)")
    } else {
        print("none")
    }
}`),
    ).toEqual(['got 3'])
  })

  it('takes the else branch for nil', () => {
    expect(
      run(`
func main() {
    let value: Int? = nil
    if let v = value {
        print("got \\(v)")
    } else {
        print("none")
    }
}`),
    ).toEqual(['none'])
  })

  it('supports the shorthand that rebinds the same name', () => {
    expect(
      run(`
func main() {
    let value: String? = "here"
    if let value {
        print(value)
    }
}`),
    ).toEqual(['here'])
  })

  it('stops at the first failing clause', () => {
    // `if let a = a, a > 5` reads `a` in the second clause only because the first
    // succeeded. Evaluating both eagerly would trap on nil.
    expect(
      run(`
func main() {
    let value: Int? = nil
    if let v = value, v > 5 {
        print("big")
    } else {
        print("no")
    }
}`),
    ).toEqual(['no'])
  })
})

describe('loops', () => {
  it('runs a while loop', () => {
    expect(
      run(`
func main() {
    var i = 0
    var total = 0
    while i < 4 {
        total += i
        i += 1
    }
    print("\\(total)")
}`),
    ).toEqual(['6'])
  })

  it('runs a repeat-while at least once', () => {
    expect(
      run(`
func main() {
    var i = 10
    repeat {
        print("ran")
        i += 1
    } while i < 5
}`),
    ).toEqual(['ran'])
  })

  it('breaks out of a loop', () => {
    expect(
      run(`
func main() {
    for i in 0..<10 {
        if i == 3 {
            break
        }
        print("\\(i)")
    }
}`),
    ).toEqual(['0', '1', '2'])
  })

  it('continues to the next iteration', () => {
    expect(
      run(`
func main() {
    for i in 0..<4 {
        if i == 1 {
            continue
        }
        print("\\(i)")
    }
}`),
    ).toEqual(['0', '2', '3'])
  })

  it('filters with a where clause', () => {
    expect(
      run(`
func main() {
    for i in 0..<6 where i % 2 == 0 {
        print("\\(i)")
    }
}`),
    ).toEqual(['0', '2', '4'])
  })

  it('breaks out of a switch without leaving the loop', () => {
    // `break` inside a switch case leaves the switch. Getting this wrong would end
    // the loop on the first matched case.
    expect(
      run(`
func main() {
    for i in 0..<3 {
        switch i {
        case 1:
            break
        default:
            print("\\(i)")
        }
    }
}`),
    ).toEqual(['0', '2'])
  })
})

describe('static members', () => {
  it('reads a static property without an instance', () => {
    expect(
      run(`
struct Config {
    static let title = "Studio"
}

func main() {
    print(Config.title)
}`),
    ).toEqual(['Studio'])
  })

  it('calls a static method', () => {
    expect(
      run(`
struct Maths {
    static func double(_ n: Int) -> Int {
        return n * 2
    }
}

func main() {
    print("\\(Maths.double(21))")
}`),
    ).toEqual(['42'])
  })
})

describe('describing values', () => {
  it('prints an enum case by name', () => {
    expect(describeValue({ kind: 'enum', typeName: 'Tab', caseName: 'home', associated: [], rawValue: null })).toBe(
      'home',
    )
  })

  it('is still a string-valued helper', () => {
    expect(value('print("x")').kind).toBe('string')
  })
})
