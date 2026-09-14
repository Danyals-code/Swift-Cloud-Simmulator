import { describe, expect, it } from 'vitest'
import { Parser } from './parser'
import { walk, type Decl, type Expr, type Node, type SourceFileNode, type StructDecl } from './ast'

const FILE = 'Test.swift'

function parse(source: string) {
  return Parser.parse(source, FILE)
}

function errorsIn(source: string) {
  return parse(source).diagnostics.filter((d) => d.severity === 'error')
}

function parseClean(source: string): SourceFileNode {
  const { sourceFile, diagnostics } = parse(source)
  const errors = diagnostics.filter((d) => d.severity === 'error')
  expect(errors.map((e) => e.message)).toEqual([])
  return sourceFile
}

/** First expression in the first function/computed-property body. */
function firstExpression(source: string): Expr {
  const file = parseClean(source)
  let found: Expr | null = null
  walk(file, (node: Node) => {
    if (!found && node.kind === 'exprStmt') found = node.expression
  })
  expect(found).not.toBeNull()
  return found!
}

function kindsOf(file: SourceFileNode): string[] {
  return file.declarations.map((d) => d.kind)
}

function structNamed(file: SourceFileNode, name: string): StructDecl {
  const found = file.declarations.find(
    (d): d is StructDecl => d.kind === 'structDecl' && d.name === name,
  )
  expect(found, `struct ${name} not found`).toBeDefined()
  return found!
}

// --------------------------------------------------------------------------

describe('declarations', () => {
  it('parses an import', () => {
    const file = parseClean('import SwiftUI')
    expect(file.declarations[0]).toMatchObject({ kind: 'importDecl', module: 'SwiftUI' })
  })

  it('parses a struct with conformances and members', () => {
    const file = parseClean(`
      struct ContentView: View, Equatable {
          let title = "hi"
          var count: Int = 0
      }
    `)
    const decl = structNamed(file, 'ContentView')
    expect(decl.inherits.map((t) => t.name)).toEqual(['View', 'Equatable'])
    expect(decl.members).toHaveLength(2)
    expect(decl.members[0]).toMatchObject({ kind: 'varDecl', isLet: true, name: 'title' })
    expect(decl.members[1]).toMatchObject({ kind: 'varDecl', isLet: false, name: 'count' })
  })

  it('captures attributes and modifiers on a property', () => {
    const file = parseClean('struct V { @State private var count = 0 }')
    const member = structNamed(file, 'V').members[0]!
    expect(member).toMatchObject({ kind: 'varDecl', name: 'count' })
    expect(member.kind === 'varDecl' && member.attributes.map((a) => a.name)).toEqual(['State'])
    expect(member.kind === 'varDecl' && member.modifiers.map((m) => m.name)).toEqual(['private'])
  })

  it('parses @main on a struct', () => {
    const file = parseClean('@main struct App {}')
    const decl = file.declarations[0]!
    expect(decl.kind === 'structDecl' && decl.attributes.map((a) => a.name)).toEqual(['main'])
  })

  it('skips attribute arguments without choking on key-path syntax', () => {
    const errors = errorsIn('struct V { @Environment(\\.colorScheme) var scheme }')
    expect(errors).toEqual([])
  })

  it('parses a function with labels, defaults and a return type', () => {
    const file = parseClean('func greet(_ name: String, times count: Int = 1) -> String { return name }')
    const fn = file.declarations[0]!
    expect(fn.kind).toBe('funcDecl')
    if (fn.kind !== 'funcDecl') return
    expect(fn.params).toHaveLength(2)
    expect(fn.params[0]).toMatchObject({ externalName: '_', internalName: 'name' })
    expect(fn.params[1]).toMatchObject({ externalName: 'times', internalName: 'count' })
    expect(fn.params[1]!.defaultValue).toMatchObject({ kind: 'integerLiteral', value: 1 })
    expect(fn.returnType).toMatchObject({ kind: 'namedType', name: 'String' })
  })

  it('distinguishes a computed property from an initialiser with a trailing closure', () => {
    const file = parseClean(`
      struct V {
          var body: some View { Text("x") }
          var made = Maker { 1 }
      }
    `)
    const members = structNamed(file, 'V').members
    expect(members).toHaveLength(2)
    const [computed, stored] = members as [Decl, Decl]

    expect(computed).toMatchObject({ kind: 'varDecl', initializer: null })
    expect(computed.kind === 'varDecl' && computed.accessor).not.toBeNull()
    expect(stored.kind === 'varDecl' && stored.accessor).toBeNull()
    expect(stored.kind === 'varDecl' && stored.initializer?.kind).toBe('call')
  })

  it('parses `some View` as an opaque type', () => {
    const file = parseClean('struct V { var body: some View { Text("x") } }')
    const body = structNamed(file, 'V').members[0]!
    expect(body.kind === 'varDecl' && body.typeAnnotation).toMatchObject({
      kind: 'someType',
      constraint: { kind: 'namedType', name: 'View' },
    })
  })
})

describe('unsupported constructs are named, not mangled', () => {
  it.each([
    ['protocol P {}', 'protocol'],
    ['extension Int {}', 'extension'],
    ['typealias X = Int', 'typealias'],
  ])('reports %s as %s', (source, feature) => {
    const { diagnostics } = parse(source)
    const warning = diagnostics.find((d) => d.code === 'unsupported_language_feature')
    expect(warning?.feature).toBe(feature)
    // Unsupported is a warning, not an error: the code still exports fine.
    expect(warning?.severity).toBe('warning')
  })

  it.each([
    ['do { } catch { }', 'do-catch'],
    ['defer { }', 'defer'],
    ['throw MyError.bad', 'throw'],
  ])('reports the statement %s as %s', (statement, feature) => {
    const { diagnostics } = parse(`func f() { ${statement} }`)
    expect(diagnostics.find((d) => d.code === 'unsupported_language_feature')?.feature).toBe(feature)
  })

  it('keeps parsing declarations after an unsupported one', () => {
    const file = parseClean(`
      protocol Ignored { func inner() }
      struct Kept: View { var body: some View { Text("x") } }
    `)
    expect(kindsOf(file)).toEqual(['unsupportedDecl', 'structDecl'])
  })

  it('keeps parsing statements after an unsupported one', () => {
    const file = parseClean(`
      func f() {
          defer { cleanup() }
          let after = 1
      }
    `)
    const fn = file.declarations[0]!
    expect(fn.kind === 'funcDecl' && fn.body?.statements.map((s) => s.kind)).toEqual([
      'unsupportedStmt',
      'declStmt',
    ])
  })
})

describe('expressions', () => {
  it('applies arithmetic precedence', () => {
    const expr = firstExpression('func f() { a + b * c }')
    expect(expr).toMatchObject({
      kind: 'binary',
      operator: '+',
      right: { kind: 'binary', operator: '*' },
    })
  })

  it('binds comparison looser than arithmetic', () => {
    const expr = firstExpression('func f() { a + 1 < b }')
    expect(expr).toMatchObject({
      kind: 'binary',
      operator: '<',
      left: { kind: 'binary', operator: '+' },
    })
  })

  it('binds && tighter than ||', () => {
    const expr = firstExpression('func f() { a || b && c }')
    expect(expr).toMatchObject({
      kind: 'binary',
      operator: '||',
      right: { kind: 'binary', operator: '&&' },
    })
  })

  it('makes ?? right-associative', () => {
    const expr = firstExpression('func f() { a ?? b ?? c }')
    expect(expr).toMatchObject({
      kind: 'binary',
      operator: '??',
      right: { kind: 'binary', operator: '??' },
    })
  })

  it('parses a ternary with a comparison condition', () => {
    const expr = firstExpression('func f() { count < 0 ? Color.red : Color.primary }')
    expect(expr).toMatchObject({
      kind: 'ternary',
      condition: { kind: 'binary', operator: '<' },
      then: { kind: 'memberAccess', member: 'red' },
      else: { kind: 'memberAccess', member: 'primary' },
    })
  })

  it('parses compound assignment', () => {
    const expr = firstExpression('func f() { count += 1 }')
    expect(expr).toMatchObject({
      kind: 'assign',
      operator: '+=',
      target: { kind: 'identifier', name: 'count' },
      value: { kind: 'integerLiteral', value: 1 },
    })
  })

  it('parses a prefix minus without treating it as subtraction', () => {
    const expr = firstExpression('func f() { g(-1) }')
    expect(expr).toMatchObject({
      kind: 'call',
      args: [{ value: { kind: 'unary', operator: '-' } }],
    })
  })

  it('parses implicit member syntax', () => {
    const expr = firstExpression('func f() { x(.largeTitle) }')
    expect(expr).toMatchObject({
      kind: 'call',
      args: [{ value: { kind: 'memberAccess', base: null, member: 'largeTitle' } }],
    })
  })

  it('parses labelled call arguments', () => {
    const expr = firstExpression('func f() { VStack(alignment: .leading, spacing: 16) }')
    expect(expr).toMatchObject({
      kind: 'call',
      args: [{ label: 'alignment' }, { label: 'spacing' }],
    })
  })

  it('parses ranges', () => {
    expect(firstExpression('func f() { 0..<10 }')).toMatchObject({ kind: 'binary', operator: '..<' })
    expect(firstExpression('func f() { 1...5 }')).toMatchObject({ kind: 'binary', operator: '...' })
  })

  it('parses array and dictionary literals', () => {
    expect(firstExpression('func f() { [1, 2, 3] }')).toMatchObject({
      kind: 'arrayLiteral',
      elements: [{ value: 1 }, { value: 2 }, { value: 3 }],
    })
    expect(firstExpression('func f() { ["a": 1] }')).toMatchObject({ kind: 'dictionaryLiteral' })
    expect(firstExpression('func f() { [] }')).toMatchObject({ kind: 'arrayLiteral', elements: [] })
    expect(firstExpression('func f() { [:] }')).toMatchObject({ kind: 'dictionaryLiteral', entries: [] })
  })

  it('parses string interpolation into a nested expression', () => {
    const expr = firstExpression('func f() { "Count: \\(count + 1)" }')
    expect(expr.kind).toBe('stringLiteral')
    if (expr.kind !== 'stringLiteral') return
    expect(expr.segments.map((s) => s.kind)).toEqual(['text', 'interpolation'])
    const interpolation = expr.segments[1]!
    expect(interpolation.kind === 'interpolation' && interpolation.expression).toMatchObject({
      kind: 'binary',
      operator: '+',
    })
  })
})

describe('SwiftUI shapes', () => {
  it('continues a member chain across newlines', () => {
    // The single most important parser behaviour for SwiftUI: a modifier on its own
    // line is part of the same expression, not a new statement.
    const expr = firstExpression(`
      func f() {
          Text("x")
              .font(.largeTitle)
              .foregroundStyle(.primary)
      }
    `)
    expect(expr).toMatchObject({
      kind: 'call',
      callee: { kind: 'memberAccess', member: 'foregroundStyle' },
    })
  })

  it('attaches a trailing closure to a call', () => {
    const expr = firstExpression('func f() { Button("Plus") { count += 1 } }')
    expect(expr).toMatchObject({
      kind: 'call',
      callee: { kind: 'identifier', name: 'Button' },
      args: [{ value: { kind: 'stringLiteral' } }],
      trailingClosure: { kind: 'closure' },
    })
  })

  it('treats a bare trailing closure as a call', () => {
    const expr = firstExpression('func f() { VStack { Text("a") } }')
    expect(expr).toMatchObject({
      kind: 'call',
      callee: { kind: 'identifier', name: 'VStack' },
      args: [],
      trailingClosure: { kind: 'closure' },
    })
  })

  it('attaches a trailing closure after labelled arguments', () => {
    const expr = firstExpression('func f() { VStack(spacing: 16) { Text("a") } }')
    expect(expr).toMatchObject({
      kind: 'call',
      args: [{ label: 'spacing' }],
      trailingClosure: { kind: 'closure' },
    })
  })

  it('tells a ternary from optional chaining by the whitespace', () => {
    // `a ? .two : c` and `a?.two` differ only in spacing, and Swift reads them that
    // way too. Without the check, the ternary's then-branch is swallowed as a chain
    // and the `:` has nowhere to go — which broke every `flag ? .one : .two`.
    const ternary = parse('func f() { let x = a ? .two : .one }')
    expect(ternary.diagnostics.filter((d) => d.severity === 'error')).toEqual([])

    const chained = parseClean('func f() { let x = a?.two }')
    const fn = chained.declarations[0]!
    const statement = fn.kind === 'funcDecl' ? fn.body?.statements[0] : undefined
    const declaration = statement?.kind === 'declStmt' ? statement.declaration : undefined
    const initializer = declaration?.kind === 'varDecl' ? declaration.initializer : undefined

    expect(initializer?.kind).toBe('memberAccess')
    expect(initializer?.kind === 'memberAccess' && initializer.base?.kind).toBe('optionalChain')
  })

  it('does not read an if-body brace as a trailing closure', () => {
    // Without the condition-position suppression, `if x { … }` parses as a call to
    // `x` with a trailing closure and the body disappears.
    const file = parseClean('func f() { if ready { doThing() } }')
    const fn = file.declarations[0]!
    const stmt = fn.kind === 'funcDecl' ? fn.body?.statements[0] : undefined
    expect(stmt).toMatchObject({
      kind: 'ifStmt',
      conditions: [{ kind: 'expr', expr: { kind: 'identifier', name: 'ready' } }],
    })
    expect(stmt?.kind === 'ifStmt' && stmt.then.statements).toHaveLength(1)
  })

  it('does not read a for-in body brace as a trailing closure', () => {
    const file = parseClean('func f() { for item in items { use(item) } }')
    const fn = file.declarations[0]!
    const stmt = fn.kind === 'funcDecl' ? fn.body?.statements[0] : undefined
    expect(stmt).toMatchObject({
      kind: 'forInStmt',
      variable: 'item',
      sequence: { kind: 'identifier', name: 'items' },
    })
  })

  it('distinguishes closure parameters from a for-in inside a closure body', () => {
    // `{ for i in xs { } }` contains `in` at closure depth, but it is not a
    // parameter list. Getting this wrong eats the loop.
    const expr = firstExpression('func f() { run { for i in xs { g(i) } } }')
    expect(expr).toMatchObject({ kind: 'call', trailingClosure: { hasExplicitParams: false } })
    const closure = expr.kind === 'call' ? expr.trailingClosure : null
    expect(closure?.body.statements[0]).toMatchObject({ kind: 'forInStmt', variable: 'i' })
  })

  it('parses explicit closure parameters', () => {
    const expr = firstExpression('func f() { run { value in use(value) } }')
    const closure = expr.kind === 'call' ? expr.trailingClosure : null
    expect(closure).toMatchObject({ hasExplicitParams: true, params: [{ name: 'value' }] })
  })

  it('parses $0 shorthand', () => {
    const expr = firstExpression('func f() { items.map { $0 * 2 } }')
    const closure = expr.kind === 'call' ? expr.trailingClosure : null
    expect(closure?.hasExplicitParams).toBe(false)
    expect(closure?.body.statements[0]).toMatchObject({
      kind: 'exprStmt',
      expression: { kind: 'binary', left: { kind: 'identifier', name: '$0' } },
    })
  })
})

describe('error recovery', () => {
  it('recovers from a missing closing brace and still sees later declarations', () => {
    // Phase 1 gate 2. A single unbalanced brace must not invalidate the file.
    //
    // Written at column 1 deliberately: the recovery heuristic keys on a type
    // declaration appearing at column 1, which is how real files are written.
    const source = [
      'struct Broken: View {',
      '    var body: some View {',
      '        Text("x")',
      '',
      'struct Later: View {',
      '    var body: some View { Text("y") }',
      '}',
    ].join('\n')

    const { sourceFile, diagnostics } = parse(source)

    expect(diagnostics.some((d) => d.severity === 'error')).toBe(true)
    const names = sourceFile.declarations
      .filter((d): d is StructDecl => d.kind === 'structDecl')
      .map((d) => d.name)
    expect(names).toContain('Broken')
    expect(names).toContain('Later')
  })

  it('leaves a genuinely nested type nested', () => {
    // The recovery heuristic must not fire on well-formed code. An indented nested
    // struct is a real nested type, not a missing brace.
    const source = [
      'struct Outer {',
      '    struct Inner {',
      '        var x = 1',
      '    }',
      '}',
    ].join('\n')

    const file = parseClean(source)
    expect(file.declarations).toHaveLength(1)
    const outer = structNamed(file, 'Outer')
    expect(outer.members.map((m) => m.kind)).toEqual(['structDecl'])
  })

  it('recovers from garbage between declarations', () => {
    const { sourceFile } = parse(`
      struct A {}
      ??? !!!
      struct B {}
    `)
    const names = sourceFile.declarations
      .filter((d): d is StructDecl => d.kind === 'structDecl')
      .map((d) => d.name)
    expect(names).toEqual(['A', 'B'])
  })

  it('produces one diagnostic per mistake, not a cascade', () => {
    const errors = errorsIn('struct A { var x = }')
    expect(errors.length).toBeLessThanOrEqual(2)
  })

  it('terminates on deeply unbalanced input', () => {
    // Guards the progress invariant in parseSourceFile: a recovery path that
    // consumes nothing would hang the worker, not just fail.
    expect(() => parse('{'.repeat(200))).not.toThrow()
    expect(() => parse('('.repeat(200))).not.toThrow()
    expect(() => parse('struct '.repeat(200))).not.toThrow()
  })

  it('accepts semicolons as separators between declarations', () => {
    // Swift allows a whole file on one line. Found by an end-to-end test that typed
    // its fixture as a single line to dodge the editor's bracket auto-closing.
    const file = parseClean('import SwiftUI; struct A {}; struct B {}')
    expect(kindsOf(file)).toEqual(['importDecl', 'structDecl', 'structDecl'])
  })

  it('accepts semicolons between struct members', () => {
    const file = parseClean('struct A { var x = 1; var y = 2; func f() {} }')
    expect(structNamed(file, 'A').members.map((m) => m.kind)).toEqual([
      'varDecl',
      'varDecl',
      'funcDecl',
    ])
  })

  it('accepts stray trailing semicolons', () => {
    expect(kindsOf(parseClean('struct A {};;;'))).toEqual(['structDecl'])
  })

  it('always returns a source file, even for empty input', () => {
    expect(parse('').sourceFile.declarations).toEqual([])
    expect(parse('   \n\n  ').sourceFile.declarations).toEqual([])
  })

  it('gives error diagnostics a span inside the source', () => {
    const source = 'struct A { var x: }'
    for (const d of parse(source).diagnostics) {
      expect(d.span.start).toBeGreaterThanOrEqual(0)
      expect(d.span.end).toBeLessThanOrEqual(source.length)
      expect(d.span.end).toBeGreaterThanOrEqual(d.span.start)
    }
  })
})

describe('the vertical-slice reference app', () => {
  const REFERENCE = `import SwiftUI

@main
struct CounterApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var count = 0
    @State private var name = "World"

    var body: some View {
        VStack(spacing: 16) {
            Text("Hello, \\(name)!")
                .font(.largeTitle)
                .foregroundStyle(.primary)

            Text("Count: \\(count)")
                .font(.title2)
                .foregroundStyle(count < 0 ? Color.red : Color.primary)

            HStack(spacing: 12) {
                Button("Minus") {
                    count -= 1
                }
                .padding()
                .background(Color.red.opacity(0.15))

                Spacer()

                Button("Plus") {
                    count += 1
                }
                .padding()
                .background(Color.green.opacity(0.15))
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
        }
        .padding()
        .background(Color(white: 0.95))
    }
}
`

  it('parses with zero errors and zero unsupported warnings', () => {
    // Phase 1 gates 1 and 4: the corpus parses, and a false positive is worse than
    // a missed error.
    const { diagnostics } = parse(REFERENCE)
    expect(diagnostics.map((d) => `${d.severity}: ${d.message}`)).toEqual([])
  })

  it('yields the expected top-level structure', () => {
    const file = parseClean(REFERENCE)
    expect(kindsOf(file)).toEqual(['importDecl', 'structDecl', 'structDecl'])

    const app = structNamed(file, 'CounterApp')
    expect(app.attributes.map((a) => a.name)).toEqual(['main'])
    expect(app.inherits.map((t) => t.name)).toEqual(['App'])

    const view = structNamed(file, 'ContentView')
    expect(view.inherits.map((t) => t.name)).toEqual(['View'])
    expect(view.members.map((m) => m.kind)).toEqual(['varDecl', 'varDecl', 'varDecl'])
  })

  it('records both @State properties with their initialisers', () => {
    const view = structNamed(parseClean(REFERENCE), 'ContentView')
    const states = view.members.filter(
      (m): m is Extract<Decl, { kind: 'varDecl' }> =>
        m.kind === 'varDecl' && m.attributes.some((a) => a.name === 'State'),
    )
    expect(states.map((s) => s.name)).toEqual(['count', 'name'])
    expect(states[0]!.initializer).toMatchObject({ kind: 'integerLiteral', value: 0 })
    expect(states[1]!.initializer).toMatchObject({ kind: 'stringLiteral' })
  })

  it('parses the body as one chained expression ending in .background', () => {
    const view = structNamed(parseClean(REFERENCE), 'ContentView')
    const body = view.members.find((m) => m.kind === 'varDecl' && m.name === 'body')!
    const statements = body.kind === 'varDecl' ? (body.accessor?.statements ?? []) : []
    expect(statements).toHaveLength(1)
    expect(statements[0]).toMatchObject({
      kind: 'exprStmt',
      expression: { kind: 'call', callee: { kind: 'memberAccess', member: 'background' } },
    })
  })

  it('gives every node a span that lies within the source', () => {
    const file = parseClean(REFERENCE)
    walk(file, (node) => {
      expect(node.span.start).toBeGreaterThanOrEqual(0)
      expect(node.span.end).toBeLessThanOrEqual(REFERENCE.length)
      expect(node.span.end).toBeGreaterThanOrEqual(node.span.start)
    })
  })
})

describe('performance (NFR-1)', () => {
  it('parses a 500-line file well inside the 120 ms diagnostics budget', () => {
    const unit = `
struct View%N%: View {
    @State private var count = 0
    var body: some View {
        VStack(spacing: 8) {
            Text("Item \\(count)")
                .font(.headline)
                .foregroundStyle(count > 0 ? Color.green : Color.red)
            Button("Tap") { count += 1 }
                .padding()
        }
        .padding()
    }
}
`
    const source = Array.from({ length: 36 }, (_, i) => unit.replace(/%N%/g, String(i))).join('\n')
    expect(source.split('\n').length).toBeGreaterThan(500)

    // Warm up, then take the best of five — this asserts a ceiling, and CI machines
    // are noisy enough that a single cold sample would make the test flaky.
    for (let i = 0; i < 3; i++) Parser.parse(source, FILE)

    let best = Infinity
    for (let i = 0; i < 5; i++) {
      const started = performance.now()
      Parser.parse(source, FILE)
      best = Math.min(best, performance.now() - started)
    }

    expect(best).toBeLessThan(120)
  })
})
