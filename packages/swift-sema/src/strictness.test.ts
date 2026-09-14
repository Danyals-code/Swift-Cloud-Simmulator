import { describe, expect, it } from 'vitest'
import { Parser } from '@studio/swift-syntax'
import { Checker } from './checker'
import { lintStrictness } from './strictness'

/**
 * Phase 6 gate 4: the strictness linter catches a curated set of "works here, fails
 * in Xcode" cases.
 *
 * This file is that curated set, and it is written in two halves on purpose. The
 * second half — the code that must produce *nothing* — is the more important one.
 * A strictness pass that cries wolf is worse than no pass at all: people stop
 * reading the panel, and then the genuine warnings go unread too. Every check here
 * was added with its silence case written first.
 */

function lint(source: string): { message: string; fix: string | null }[] {
  const parsed = Parser.parse(source, 'Sources/App.swift')
  expect(
    parsed.diagnostics.filter((d) => d.severity === 'error'),
    'the fixture itself must parse',
  ).toEqual([])

  const model = Checker.check([parsed.sourceFile])
  return lintStrictness([parsed.sourceFile], model).map((d) => ({
    message: d.message,
    fix: d.fixIts?.[0]?.edits[0]?.newText ?? null,
  }))
}

function messages(source: string): string[] {
  return lint(source).map((d) => d.message)
}

function app(body: string, extra = ''): string {
  return `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}

struct ContentView: View {
${body}
}

${extra}`
}

describe('numeric strictness', () => {
  it('flags Int and Double mixed in arithmetic', () => {
    const found = lint(
      app(`    let width: Int = 100
    let scale: Double = 1.5

    var body: some View {
        Text("\\(width * scale)")
    }`),
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.message).toContain("cannot be applied to operands of type 'Int' and 'Double'")
    expect(found[0]!.fix).toBe('Double(width)')
  })

  it('flags a float literal against an Int', () => {
    // `someInt * 0.5` is an error in Swift: the literal cannot become an Int.
    expect(
      messages(
        app(`    let count: Int = 3

    var body: some View {
        Text("\\(count * 0.5)")
    }`),
      ),
    ).toHaveLength(1)
  })

  it('says nothing about an integer literal against a Double', () => {
    // `someDouble * 2` is fine: the literal takes its type from context. Warning
    // here would fire on ordinary, correct code.
    expect(
      messages(
        app(`    let scale: Double = 1.5

    var body: some View {
        Text("\\(scale * 2)")
    }`),
      ),
    ).toEqual([])
  })

  it('says nothing when the conversion is already written', () => {
    expect(
      messages(
        app(`    let width: Int = 100
    let scale: Double = 1.5

    var body: some View {
        Text("\\(Double(width) * scale)")
    }`),
      ),
    ).toEqual([])
  })

  it('says nothing when a type cannot be determined', () => {
    // No annotation, no literal — the pass must not guess.
    expect(
      messages(
        app(`    let values = compute()

    var body: some View {
        Text("\\(values * 2)")
    }`),
      ),
    ).toEqual([])
  })
})

describe('Text takes a string', () => {
  it('flags a number passed to Text', () => {
    const found = lint(
      app(`    let count: Int = 3

    var body: some View {
        Text(count)
    }`),
    )
    expect(found[0]!.message).toContain("'Text' cannot be initialised with a value of type 'Int'")
    expect(found[0]!.fix).toBe('"\\(count)"')
  })

  it('says nothing about an interpolated string', () => {
    expect(
      messages(
        app(`    let count: Int = 3

    var body: some View {
        Text("\\(count)")
    }`),
      ),
    ).toEqual([])
  })

  it('says nothing about a plain string', () => {
    expect(messages(app('    var body: some View { Text("hello") }'))).toEqual([])
  })
})

describe('property wrappers', () => {
  it('flags @State on a let', () => {
    const found = lint(
      app(`    @State private let count = 0

    var body: some View { Text("x") }`),
    )
    expect(found[0]!.message).toContain("can only be applied to a 'var'")
    expect(found[0]!.fix).toBe('var')
  })

  it('says nothing about @State on a var', () => {
    expect(
      messages(
        app(`    @State private var count = 0

    var body: some View { Text("x") }`),
      ),
    ).toEqual([])
  })
})

describe('mutability', () => {
  it('flags assignment to a let', () => {
    const found = lint(
      app(`    var body: some View {
        Button("Go") {
            let total = 0
            total = 1
            print(total)
        }
    }`),
    )
    expect(found[0]!.message).toContain("is a 'let' constant")
  })

  it('flags a non-mutating method that writes a property', () => {
    const found = lint(`struct Counter {
    var count = 0

    func bump() {
        count += 1
    }
}`)
    expect(found[0]!.message).toContain("is not declared 'mutating'")
    expect(found[0]!.fix).toBe('mutating ')
  })

  it('says nothing when the method is mutating', () => {
    expect(
      messages(`struct Counter {
    var count = 0

    mutating func bump() {
        count += 1
    }
}`),
    ).toEqual([])
  })

  it('says nothing when the method only reads', () => {
    expect(
      messages(`struct Counter {
    var count = 0

    func doubled() -> Int {
        return count * 2
    }
}`),
    ).toEqual([])
  })
})

describe('ForEach identity', () => {
  const ITEM = `struct Item {
    let name: String
}`

  const IDENTIFIABLE = `struct Item: Identifiable {
    let id: Int
    let name: String
}`

  it('flags a ForEach over a non-Identifiable element', () => {
    const found = lint(
      app(
        `    let items: [Item] = []

    var body: some View {
        ForEach(items) { item in
            Text(item.name)
        }
    }`,
        ITEM,
      ),
    )
    expect(found[0]!.message).toContain("does not conform to 'Identifiable'")
    expect(found[0]!.fix).toBe(', id: \\.self')
  })

  it('says nothing when the element is Identifiable', () => {
    expect(
      messages(
        app(
          `    let items: [Item] = []

    var body: some View {
        ForEach(items) { item in
            Text(item.name)
        }
    }`,
          IDENTIFIABLE,
        ),
      ),
    ).toEqual([])
  })

  it('says nothing when an id key path is given', () => {
    expect(
      messages(
        app(
          `    let items: [Item] = []

    var body: some View {
        ForEach(items, id: \\.name) { item in
            Text(item.name)
        }
    }`,
          ITEM,
        ),
      ),
    ).toEqual([])
  })

  it('says nothing about a range', () => {
    expect(
      messages(
        app(`    var body: some View {
        ForEach(0..<3) { index in
            Text("\\(index)")
        }
    }`),
      ),
    ).toEqual([])
  })
})

describe('argument labels', () => {
  it('flags a call that omits them', () => {
    const found = lint(`struct Greeter {
    func greet(name: String, times: Int) -> String {
        return name
    }

    func run() -> String {
        return greet("Ada", 2)
    }
}`)
    expect(found[0]!.message).toContain('Missing argument label')
    expect(found[0]!.message).toContain("'name:'")
    expect(found[0]!.fix).toBe('name: ')
  })

  it('says nothing when the labels are written', () => {
    expect(
      messages(`struct Greeter {
    func greet(name: String) -> String {
        return name
    }

    func run() -> String {
        return greet(name: "Ada")
    }
}`),
    ).toEqual([])
  })

  it('says nothing when the parameter suppresses its label', () => {
    expect(
      messages(`struct Greeter {
    func greet(_ name: String) -> String {
        return name
    }

    func run() -> String {
        return greet("Ada")
    }
}`),
    ).toEqual([])
  })
})

describe('returns', () => {
  it('flags a multi-statement body with no return', () => {
    const found = lint(`struct Maths {
    func total() -> Int {
        let a = 1
        a + 2
    }
}`)
    expect(found.some((d) => d.message.includes('Missing return'))).toBe(true)
  })

  it('says nothing about a single-expression body', () => {
    expect(
      messages(`struct Maths {
    func total() -> Int {
        1 + 2
    }
}`),
    ).toEqual([])
  })

  it('says nothing about a view body', () => {
    // `some View` bodies are result builders: they have no return and need none.
    expect(
      messages(
        app(`    var body: some View {
        Text("a")
        Text("b")
    }`),
      ),
    ).toEqual([])
  })
})

describe('the silence case', () => {
  it('reports nothing at all on an idiomatic app', () => {
    // The most important assertion in the file. Everything here is correct Swift
    // that Xcode compiles, so any warning is a false positive — and one false
    // positive is enough to make the whole panel ignorable.
    const source = `import SwiftUI

struct Task: Identifiable {
    let id: Int
    var title: String
    var done: Bool
}

@main
struct TaskApp: App {
    var body: some Scene {
        WindowGroup { TaskList() }
    }
}

struct TaskList: View {
    @State private var tasks = [
        Task(id: 1, title: "Write the linter", done: false),
        Task(id: 2, title: "Prove it stays quiet", done: true)
    ]
    @State private var showingSheet = false
    @State private var filter = ""

    var remaining: Int {
        var count = 0
        for task in tasks {
            if !task.done {
                count += 1
            }
        }
        return count
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Open") {
                    ForEach(tasks) { task in
                        HStack {
                            Text(task.title)
                            Spacer()
                            Text(task.done ? "done" : "open")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("\\(remaining) left")
            .toolbar {
                Button("Add") {
                    showingSheet = true
                }
            }
            .sheet(isPresented: $showingSheet) {
                VStack(spacing: 16) {
                    TextField("Title", text: $filter)
                        .padding()
                    Button("Close") {
                        showingSheet = false
                    }
                }
            }
        }
    }
}
`
    expect(messages(source)).toEqual([])
  })

  it('reports nothing on arithmetic between values of the same type', () => {
    expect(
      messages(
        app(`    let a: Double = 1.5
    let b: Double = 2.5
    let c: Int = 3
    let d: Int = 4

    var body: some View {
        Text("\\(a * b) \\(c + d)")
    }`),
      ),
    ).toEqual([])
  })
})
