import { beforeEach, describe, expect, it } from 'vitest'
import { buildAuthoringModel } from '@studio/swift-sema'
import { resetPipelineState } from '@studio/swiftui-runtime'
import type { AuthoringSnapshot } from '@studio/shared'
import { XCODE, draw, editWritten as edit, project as files, typecheckInXcode, viewWritten as view, writtenAs as written } from './helpers/layer-project'

/**
 * Wave 3a: texts joined with `+` (doc 18, Concern 2, item 12). Swift joins Texts into one
 * Text, which the preview draws as one, with each part a run of its own: a group named by
 * the words it draws, whose runs are selected and styled with what keeps a Text a Text.
 */
beforeEach(resetPipelineState)

const screen = (body: string, target = '') => `import SwiftUI
${target}
@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    let count = 3

    var body: some View {
        VStack {
${body}
        }
    }
}
`
const model = (text: string): AuthoringSnapshot => buildAuthoringModel({ projectId: 'runs', revision: 1, files: files(text) })

const SUM = '            Text("Total: ").foregroundColor(.secondary) + Text("\\(count)").bold() + Text(" items")'

describe('texts joined with +', () => {
  it('are one Text whose runs are Texts of their own', () => {
    const text = screen(SUM)
    const snapshot = model(text)
    const group = snapshot.nodes.find(node => node.kind === 'view' && node.name === 'Text' && node.children.length)!
    expect(written(text, group)).toBe(SUM.trim())
    expect(group.children.map(id => written(text, snapshot.nodes.find(node => node.id === id)!))).toEqual(['Text("Total: ").foregroundColor(.secondary)', 'Text("\\(count)").bold()', 'Text(" items")'])
  })

  it('are drawn as one Text named by its words, with each run a layer the canvas selects', () => {
    const text = screen(SUM)
    const result = draw(files(text))
    const snapshot = result.authoring!
    const group = snapshot.nodes.find(node => node.kind === 'view' && node.name === 'Text' && node.children.length)!
    const layer = result.viewHierarchy![0]!.children[0]!.children[0]!
    expect(layer).toMatchObject({ type: 'Text', name: 'Total: 3 items' })
    expect(group.runtimeIds).toEqual([layer.id])
    expect(group.children.map(id => snapshot.nodes.find(node => node.id === id)!.runtimeIds.length)).toEqual([1, 1, 1])
  })
})

describe('a run', () => {
  const text = screen(SUM)

  it('stays where it is joined: it is not moved, wrapped or made tappable on its own', () => {
    const run = view(text, 'Text(" items")')
    expect(run.argument).toBe(true)
    expect(edit(text, 'Text(" items")', { kind: 'layer-wrap', ids: [run.id], layout: 'VStack' })).toEqual({ refused: 'The text is part of the view it is attached to, so it can’t be moved, wrapped, copied, hidden or deleted on its own. Select that view instead.' })
    expect(run.behavior?.canMakeTappable).toBeFalsy()
    expect(edit(text, 'Text(" items")', { kind: 'extract-component', name: 'ItemsLabel' })).toEqual({ refused: 'Part of joined text stays a Text in its sum. Make the whole text a component instead.' })
  })

  it('changes its words where they are written', () => {
    const run = view(text, 'Text(" items")')
    const content = run.controls!.find(control => control.id === 'content')!
    expect(edit(text, 'Text(" items")', { kind: 'property', control: content.id, value: ' in the cart' })).toEqual({ text: text.replace('Text(" items")', 'Text(" in the cart")') })
  })

  it('takes the text styles that keep a Text a Text, and nothing that makes it a view', () => {
    const run = view(text, 'Text(" items")')
    const available = (name: string) => run.modifierCatalog!.find(entry => entry.name === name)!
    expect(['font', 'bold', 'italic', 'fontWeight', 'underline', 'strikethrough', 'baselineOffset', 'tracking'].map(name => available(name).available)).toEqual(Array(8).fill(true))
    expect(available('padding')).toMatchObject({ available: false, reason: 'Part of joined text takes text styles only. Put the joined text in parentheses in Code to give all of it padding.' })
    expect(run.controls!.map(control => control.id).filter(id => id.startsWith('add:') || id.startsWith('fill:'))).toEqual([])
    expect(edit(text, 'Text(" items")', { kind: 'modifier-add', name: 'underline' })).toEqual({ text: text.replace('Text(" items")', 'Text(" items").underline()') })
    expect(edit(text, 'Text(" items")', { kind: 'modifier-add', name: 'padding' })).toEqual({ refused: available('padding').reason })
  })

  it('shows its Text section alone, and writes its colour as a Text keeps it before iOS 17', () => {
    const run = view(text, 'Text(" items")')
    expect(run.layer).toMatchObject({ textRun: true })
    expect(run.layer?.fill).toBeUndefined()
    expect(run.layer?.text?.alignment.disabledReason).toBe('Part of joined text takes text styles only. Set its alignment on the whole text, in parentheses, in Code.')
    const red = { section: 'text' as const, color: { name: 'red' } }
    expect(edit(text, 'Text(" items")', { kind: 'layer-set', changes: [red] })).toEqual({ text: text.replace('Text(" items")', 'Text(" items").foregroundStyle(.red)') })
    expect(edit(text, 'Text(" items")', { kind: 'layer-set', changes: [red] }, '16.0')).toEqual({ text: text.replace('Text(" items")', 'Text(" items").foregroundColor(Color.red)') })
    expect(edit(text, 'Text(" items")', { kind: 'layer-set', changes: [{ section: 'text', font: { style: 'title' } }] })).toEqual({ text: text.replace('Text(" items")', 'Text(" items").font(.title)') })
    expect(edit(text, 'Text(" items")', { kind: 'layer-set', changes: [{ section: 'effects', opacity: 0.5 }] })).toEqual({ refused: 'Part of joined text takes text styles only. Put the joined text in parentheses in Code to change all of it.' })
  })
})

describe('the joined text', () => {
  it('has no chain of its own unless it is in parentheses', () => {
    const text = screen(SUM)
    const group = view(text, SUM.trim())
    expect(group.modifierCatalog?.some(entry => entry.available)).toBeFalsy()
    expect(group.layer).toBeUndefined()
  })

  it('in parentheses, reads and writes the modifiers after them', () => {
    const sum = '            (Text("A") + Text("B").italic()).font(.title)'
    const text = screen(sum)
    const group = view(text, sum.trim())
    expect(group.modifiers?.map(modifier => modifier.name)).toEqual(['font'])
    expect(group.layer?.text?.font.value).toMatchObject({ style: 'title' })
    expect(edit(text, sum.trim(), { kind: 'modifier-add', name: 'opacity' })).toEqual({ text: text.replace(sum.trim(), `${sum.trim()}.opacity(1)`) })
    const result = draw(files(text))
    const bound = result.authoring!.nodes.find(node => node.kind === 'view' && node.name === 'Text' && node.children.length)!
    expect(bound.runtimeIds).toHaveLength(1)
  })

  describe.skipIf(!XCODE)('in Xcode 27', () => {
    it('builds every change written to a run, and to a joined text in parentheses', () => {
      const text = screen(SUM)
      const sum = '            (Text("A") + Text("B").italic()).font(.title)'
      const changed = [
        edit(text, 'Text(" items")', { kind: 'modifier-add', name: 'underline' }),
        edit(text, 'Text(" items")', { kind: 'modifier-add', name: 'font' }),
        edit(text, 'Text(" items")', { kind: 'modifier-add', name: 'baselineOffset' }),
        edit(text, 'Text(" items")', { kind: 'layer-set', changes: [{ section: 'text', color: { name: 'red' } }] }),
        edit(text, 'Text(" items")', { kind: 'layer-set', changes: [{ section: 'text', font: { style: 'title', weight: 'bold', italic: true } }] }),
        edit(text, 'Text(" items")', { kind: 'layer-set', changes: [{ section: 'text', tracking: 2 }] }),
        edit(screen(sum), sum.trim(), { kind: 'modifier-add', name: 'opacity' }),
      ]
      const older = (target: string) => edit(text, 'Text(" items")', { kind: 'layer-set', changes: [{ section: 'text', color: { name: 'red' }, font: { style: 'title', weight: 'bold', italic: true }, tracking: 1 }] }, `${target}.0`)
      // iOS 26 deprecates `+` on Text for interpolation, so the forms are checked where the joined text itself builds clean.
      const at = (target: string, result: { text: string } | { refused: string }) => 'text' in result ? result.text.replace('import SwiftUI\n', `import SwiftUI\n// target: iOS ${target}\n`) : `refused: ${result.refused}`
      typecheckInXcode([...changed.map(result => at('18', result)), at('16', older('16')), at('15', older('15'))])
    }, 300_000)
  })
})
