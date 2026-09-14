import { describe, expect, it } from 'vitest'
import { Parser, type VarDecl } from '@studio/swift-syntax'
import { flattenOutline, outlineStatements, type OutlineNode } from './outline'

/** Outlines the `body` of the first struct in a snippet. */
function outline(body: string): OutlineNode[] {
  const source = `struct V: View {\n    var body: some View {\n${body}\n    }\n}`
  const { sourceFile, diagnostics } = Parser.parse(source, 'Test.swift')
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])

  const struct = sourceFile.declarations[0]
  const decl =
    struct?.kind === 'structDecl'
      ? (struct.members.find((m) => m.kind === 'varDecl' && m.name === 'body') as VarDecl | undefined)
      : undefined
  return outlineStatements(decl?.accessor?.statements ?? [])
}

/** `depth:Name detail .mod1 .mod2` per row, for compact assertions. */
function rows(body: string): string[] {
  return flattenOutline(outline(body)).map(({ node, depth }) =>
    [
      `${depth}:${node.name}`,
      node.detail,
      ...node.modifiers.map((m) => `.${m}`),
    ]
      .filter(Boolean)
      .join(' '),
  )
}

describe('structure', () => {
  it('nests a stack and its children', () => {
    expect(rows('VStack { Text("a"); Text("b") }')).toEqual([
      '0:VStack',
      '1:Text "a"',
      '1:Text "b"',
    ])
  })

  it('reads modifiers in source order, not chain order', () => {
    // The chain parses inside out, so this is the assertion that unwinding works.
    expect(rows('Text("a").font(.title).padding().background(Color.red)')).toEqual([
      '0:Text "a" .font .padding .background',
    ])
  })

  it('shows a labelled numeric argument as the detail', () => {
    expect(rows('VStack(spacing: 16) { Spacer() }')).toEqual(['0:VStack spacing: 16', '1:Spacer'])
  })

  it('marks an interpolation without trying to evaluate it', () => {
    expect(rows('Text("Count: \\(count)")')).toEqual(['0:Text "Count: \\(…)"'])
  })

  it('nests several levels', () => {
    expect(rows('VStack { HStack { Text("a") } }')).toEqual(['0:VStack', '1:HStack', '2:Text "a"'])
  })
})

describe('action closures are not content', () => {
  it('does not list a Button action body as children', () => {
    // `Button("Minus") { count -= 1 }` reads structurally like `VStack { … }`, but the
    // closure is behaviour. Listing `count -= 1` as a child view is simply wrong.
    expect(rows('Button("Minus") { count -= 1 }')).toEqual(['0:Button "Minus"'])
  })

  it('still nests a Button label closure when there is no title argument', () => {
    expect(rows('Button(action: doThing) { Text("Go") }')).toEqual([
      '0:Button',
      '1:Text "Go"',
    ])
  })

  it('skips assignment statements anywhere they appear', () => {
    expect(rows('VStack { Text("a") }')).not.toContain('0:assign')
  })
})

describe('control flow', () => {
  it('shows both arms of an if', () => {
    expect(rows('if flag { Text("a") } else { Text("b") }')).toEqual([
      '0:if',
      '1:Text "a"',
      '1:Text "b"',
    ])
  })

  it('shows a for-in with its loop variable', () => {
    expect(rows('for item in items { Text("row") }')).toEqual([
      '0:for-in item',
      '1:Text "row"',
    ])
  })

  it('follows a return statement', () => {
    expect(rows('return Text("a")')).toEqual(['0:Text "a"'])
  })
})

describe('the reference app body', () => {
  it('produces the expected shape', () => {
    const body = `        VStack(spacing: 16) {
            Text("Hello, \\(name)!")
                .font(.largeTitle)
                .foregroundStyle(.primary)

            Text("Count: \\(count)")
                .font(.title2)

            HStack(spacing: 12) {
                Button("Minus") { count -= 1 }
                    .padding()
                    .background(Color.red.opacity(0.15))

                Spacer()

                Button("Plus") { count += 1 }
                    .padding()
                    .background(Color.green.opacity(0.15))
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
        }
        .padding()
        .background(Color(white: 0.95))`

    expect(rows(body)).toEqual([
      '0:VStack spacing: 16 .padding .background',
      '1:Text "Hello, \\(…)!" .font .foregroundStyle',
      '1:Text "Count: \\(…)" .font',
      '1:HStack spacing: 12 .frame .padding',
      '2:Button "Minus" .padding .background',
      '2:Spacer',
      '2:Button "Plus" .padding .background',
    ])
  })
})
