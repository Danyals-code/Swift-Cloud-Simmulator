import { describe, expect, it } from 'vitest'
import { collectConformance, Parser } from '@studio/swift-syntax'
import { Interpreter } from './interpreter'

/**
 * Protocols and extensions — Phase 8a.
 *
 * The unit under test is really one function, `collectConformance`, which decides what
 * members a type has once they may be written in four places. So these run the merged
 * result rather than inspecting it: a merge that produces the right list but loses the
 * ordering, or resolves an override to the wrong layer, passes a structural assertion
 * and fails a user.
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

function members(source: string): string[] {
  const parsed = Parser.parse(`${source}\n`, 'Sources/Test.swift')
  const model = collectConformance([parsed.sourceFile])
  return [...model.types.keys()]
}

describe('extensions', () => {
  it('adds a method to a type declared elsewhere', () => {
    expect(
      run(`
struct Card {
    var title: String
}

extension Card {
    func shout() -> String { title + "!" }
}

func main() {
    print(Card(title: "hi").shout())
}`),
    ).toEqual(['hi!'])
  })

  it('adds a computed property that can read stored ones', () => {
    expect(
      run(`
struct Rect {
    var width: Double
    var height: Double
}

extension Rect {
    var area: Double { width * height }
}

func main() {
    print("\\(Rect(width: 3, height: 4).area)")
}`),
    ).toEqual(['12.0'])
  })

  it('extends a built-in type the project never declared', () => {
    // `extension Int` has no declaration to merge into, which is a different path
    // through the merge than `extension Card` — and it is the one users reach for.
    expect(
      run(`
extension Int {
    func doubled() -> Int { self * 2 }
}

func main() {
    print("\\(21.doubled())")
}`),
    ).toEqual(['42'])
  })

  it('lets one extension call a method written in another', () => {
    expect(
      run(`
struct Chain {}

extension Chain {
    func first() -> String { "one" }
}

extension Chain {
    func second() -> String { first() + " two" }
}

func main() {
    print(Chain().second())
}`),
    ).toEqual(['one two'])
  })

  it('registers an extended built-in as a known type', () => {
    expect(members('extension String { func shout() -> String { self } }')).toContain('String')
  })
})

describe('protocols', () => {
  it('calls a default implementation written in an extension', () => {
    // The idiomatic way to give a protocol a default: Swift does not allow a body on
    // the requirement itself, so `extension P` is where every real default lives.
    expect(
      run(`
protocol Greeter {
    var name: String { get }
    func greet() -> String
}

extension Greeter {
    func greet() -> String { "Hello, " + name }
}

struct Person: Greeter {
    var name: String
}

func main() {
    print(Person(name: "Ada").greet())
}`),
    ).toEqual(['Hello, Ada'])
  })

  it('lets the conforming type override the default', () => {
    expect(
      run(`
protocol Greeter {
    func greet() -> String
}

extension Greeter {
    func greet() -> String { "default" }
}

struct Loud: Greeter {
    func greet() -> String { "LOUD" }
}

func main() {
    print(Loud().greet())
}`),
    ).toEqual(['LOUD'])
  })

  it('takes a default from a body written inside the protocol', () => {
    expect(
      run(`
protocol Named {
    func label() -> String { "unnamed" }
}

struct Thing: Named {}

func main() {
    print(Thing().label())
}`),
    ).toEqual(['unnamed'])
  })

  it('inherits defaults through a refined protocol', () => {
    expect(
      run(`
protocol Base {
    func describe() -> String
}

extension Base {
    func describe() -> String { "base" }
}

protocol Refined: Base {}

struct Impl: Refined {}

func main() {
    print(Impl().describe())
}`),
    ).toEqual(['base'])
  })

  it('does not treat a bare requirement as callable', () => {
    // `func greet() -> String` with no body is a promise, not an implementation.
    // Calling it must trap rather than silently return nil, because a silent nil
    // surfaces three layers away as a mystery.
    expect(() =>
      run(`
protocol Greeter {
    func greet() -> String
}

struct Silent: Greeter {}

func main() {
    print(Silent().greet())
}`),
    ).toThrow()
  })

  it('conforms an enum to a protocol', () => {
    expect(
      run(`
protocol Titled {
    var title: String { get }
}

enum Tab: String, Titled {
    case home
    case profile

    var title: String { rawValue }
}

func main() {
    print(Tab.profile.title)
}`),
    ).toEqual(['profile'])
  })

  it('extends an enum', () => {
    expect(
      run(`
enum Step {
    case one
    case two
}

extension Step {
    var next: Step {
        switch self {
        case .one: return .two
        case .two: return .one
        }
    }
    func label() -> String {
        switch self {
        case .one: return "1"
        case .two: return "2"
        }
    }
}

func main() {
    print(Step.one.next.label())
}`),
    ).toEqual(['2'])
  })
})

describe('class inheritance', () => {
  it('inherits a superclass method', () => {
    expect(
      run(`
class Animal {
    var name = "animal"
    func speak() -> String { "..." }
}

class Dog: Animal {
    override func speak() -> String { "woof" }
}

func main() {
    print(Dog().speak())
}`),
    ).toEqual(['woof'])
  })

  it('inherits stored properties, superclass first', () => {
    // The order matters beyond tidiness: stored properties initialise in this order,
    // so a subclass property whose default reads an inherited one must come second.
    expect(
      run(`
class Base {
    var a = 1
}

class Derived: Base {
    var b = 2
}

func main() {
    let d = Derived()
    print("\\(d.a) \\(d.b)")
}`),
    ).toEqual(['1 2'])
  })

  it('inherits a method the subclass does not override', () => {
    expect(
      run(`
class Animal {
    func speak() -> String { "..." }
    func twice() -> String { speak() + speak() }
}

class Cat: Animal {
    override func speak() -> String { "meow" }
}

func main() {
    print(Cat().twice())
}`),
    ).toEqual(['meowmeow'])
  })

  it('carries the superclass conformances down', () => {
    expect(
      run(`
protocol Describable {}

extension Describable {
    func describe() -> String { "described" }
}

class Base: Describable {}
class Sub: Base {}

func main() {
    print(Sub().describe())
}`),
    ).toEqual(['described'])
  })
})

describe('static members survive the merge', () => {
  it('does not count a static property as a memberwise argument', () => {
    // A `static let` sitting above the stored properties used to shift every
    // memberwise argument by one, silently assigning `title` from nothing.
    expect(
      run(`
struct Config {
    static let shared = "global"
    var title: String
}

func main() {
    print(Config(title: "local").title + " " + Config.shared)
}`),
    ).toEqual(['local global'])
  })

  it('finds a static method added by an extension', () => {
    expect(
      run(`
struct Maker {}

extension Maker {
    static func make() -> String { "made" }
}

func main() {
    print(Maker.make())
}`),
    ).toEqual(['made'])
  })
})
