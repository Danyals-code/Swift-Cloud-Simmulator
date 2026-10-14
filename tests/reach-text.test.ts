import { beforeEach, describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { resetPipelineState } from '@studio/swiftui-runtime'
import type { AuthoringNode, SourceFile } from '@studio/shared'
import { XCODE, bodyOf, draw, project, typecheckInXcode } from './helpers/layer-project'

/**
 * Text written with values in it (doc 18, Wave 3a): the words around each `\(…)` are
 * edited in Design, and every value stays exactly as the code has it. Text that is a value
 * on its own stays read-only, and says why.
 */
beforeEach(resetPipelineState)

const app = (body: string) => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var count = 3
    @State private var limit = 5
    @State private var price = 2.5
    @State private var name: String? = nil
    @State private var item = Item()
    var body: some View {
${body}
    }
}

struct Item {
    var title = "First"
}
`

const files = (body: string) => project(app(`        ${body}`))
const textNode = (body: string): AuthoringNode => {
  const found = buildAuthoringModel({ projectId: 'text', revision: 1, files: files(body) }).nodes.find(n => n.name === 'Text' && n.kind === 'view')
  if (!found) throw new Error('No Text')
  return found
}
const field = (body: string, id: string) => textNode(body).controls?.find(control => control.id === id)
/** A segmented value: the words, and between each pair the Swift of one value, as the field reads it. */
const parts = (...segments: string[]) => JSON.stringify(segments)

function plan(source: readonly SourceFile[], id: string, value: string) {
  const target = buildAuthoringModel({ projectId: 'text', revision: 1, files: [...source] }).nodes.find(n => n.name === 'Text' && n.kind === 'view')!
  return planDesignEdit({ projectId: 'text', baseRevision: 1, files: [...source], scope: target.owner, target: target.source, fingerprint: target.fingerprint, operation: { kind: 'property', control: id, value } })
}
function written(body: string, value: string): string {
  const result = plan(files(body), 'content:parts', value)
  if (!result.ok) throw new Error(result.reason)
  return bodyOf(project(result.changes[0]?.after ?? app(`        ${body}`)))
}
const refusal = (body: string, value: string) => {
  const result = plan(files(body), 'content:parts', value)
  return result.ok ? 'written' : result.reason
}

describe('reading the words of a text with values in it', () => {
  it.each([
    ['values between words', 'Text("Total: \\(count) of \\(limit)")', parts('Total: ', 'count', ' of ', 'limit', '')],
    ['a value first', 'Text("\\(count) items")', parts('', 'count', ' items')],
    ['values side by side', 'Text("\\(count)\\(limit)")', parts('', 'count', '', 'limit', '')],
    ['a value with a format and one with a fallback in quotes', 'Text("Price: \\(price, specifier: "%.2f") for \\(name ?? "Guest")")', parts('Price: ', 'price, specifier: "%.2f"', ' for ', 'name ?? "Guest"', '')],
    ['escaped quotes', 'Text("Say \\"hi\\" \\(count)")', parts('Say "hi" ', 'count', '')],
    ['verbatim text', 'Text(verbatim: "Total: \\(count)")', parts('Total: ', 'count', '')],
  ])('reads %s', (_, body, value) => {
    expect(field(body, 'content:parts')).toMatchObject({ kind: 'text', label: 'Text', value })
    expect(field(body, 'content')).toBeUndefined()
  })

  it('leaves a plain text as it was', () => {
    expect(field('Text("Hello")', 'content')).toMatchObject({ kind: 'text', value: 'Hello' })
    expect(field('Text("Hello")', 'content:parts')).toBeUndefined()
  })

  it('shows words with a line break in them read-only, as a field of one line cannot keep it', () => {
    expect(field('Text("Say \\"hi\\"\\n\\(count)")', 'content:parts')).toMatchObject({ value: parts('Say "hi"\n', 'count', ''), disabledReason: expect.stringMatching(/line break/) })
  })

  it('has no field for a text written over several lines or as a raw string', () => {
    expect(field('Text("""\n            Total: \\(count)\n            """)', 'content:parts')).toBeUndefined()
    expect(field('Text(#"Total: \\#(count)"#)', 'content:parts')).toBeUndefined()
  })
})

describe('writing the words', () => {
  it('rewrites the words and keeps every value byte for byte', () => {
    expect(written('Text("Total: \\(count) of \\(limit)")', parts('Sum: ', 'count', ' / ', 'limit', ' in all')))
      .toBe('        Text("Sum: \\(count) / \\(limit) in all")')
    expect(written('Text("Price: \\(price, specifier: "%.2f") for \\(name ?? "Guest")")', parts('Cost ', 'price, specifier: "%.2f"', ', ', 'name ?? "Guest"', '!')))
      .toBe('        Text("Cost \\(price, specifier: "%.2f"), \\(name ?? "Guest")!")')
  })

  it('escapes quotes, backslashes and line breaks, so what looks like a value stays words', () => {
    expect(written('Text("Total: \\(count)")', parts('Say "hi" \\ ', 'count', ' \\(limit)\nnext')))
      .toBe('        Text("Say \\"hi\\" \\\\ \\(count) \\\\(limit)\\nnext")')
  })

  it('writes nothing when the words are the same', () => {
    const result = plan(files('Text("Total: \\(count)")'), 'content:parts', parts('Total: ', 'count', ''))
    expect(result).toMatchObject({ ok: true, changes: [] })
  })

  it.each([
    ['a value that is not the code’s', parts('Total: ', 'secret', '')],
    ['a value taken away', parts('Total: ')],
    ['something that is not words and values', 'Total: 3'],
  ])('refuses %s', (_, value) => {
    expect(refusal('Text("Total: \\(count)")', value)).toMatch(/values in this text/)
  })

  it('draws the new words with the values in the preview', () => {
    const result = plan(files('Text("Total: \\(count) of \\(limit)")'), 'content:parts', parts('', 'count', ' done, ', 'limit', ' to go'))
    if (!result.ok) throw new Error(result.reason)
    const drawn = draw(project(result.changes[0]!.after))
    expect(drawn.renderTree?.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? []).join('')).toContain('3 done, 5 to go')
  })
})

describe('text that comes from data', () => {
  it.each([
    ['a value', 'Text(item.title)', 'item.title'],
    ['a formatted value', 'Text(price, format: .number)', 'price'],
  ])('shows %s read-only, and says why', (_, body, value) => {
    expect(field(body, 'content:data')).toMatchObject({ kind: 'text', label: 'Text', value, disabledReason: expect.stringMatching(/^This text comes from data/) })
    expect(plan(files(body), 'content:data', 'Hello')).toMatchObject({ ok: false, reason: expect.stringMatching(/^This text comes from data/) })
  })
})

describe.skipIf(!XCODE)('what the words writer writes builds in Xcode 27', () => {
  it('for words around values, escapes and formats', () => {
    const sources = [
      ['Text("Total: \\(count) of \\(limit)")', parts('Sum: ', 'count', ' / ', 'limit', ' in all')],
      ['Text("Price: \\(price, specifier: "%.2f") for \\(name ?? "Guest")")', parts('Cost ', 'price, specifier: "%.2f"', ', ', 'name ?? "Guest"', '!')],
      ['Text("Total: \\(count)")', parts('Say "hi" \\ ', 'count', ' \\(limit)\nnext')],
      ['Text(verbatim: "Total: \\(count)")', parts('All: ', 'count', '')],
    ].map(([body, value]) => {
      const result = plan(files(body!), 'content:parts', value!)
      if (!result.ok) throw new Error(result.reason)
      return result.changes[0]!.after
    })
    typecheckInXcode(sources)
    expect(sources).toHaveLength(4)
  }, 300_000)
})
