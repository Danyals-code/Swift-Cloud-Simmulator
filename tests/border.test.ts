import { beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { resetPipelineState } from '@studio/swiftui-runtime'
import type { AuthoringNode, DesignEditRequest, SourceFile } from '@studio/shared'

/**
 * A border that follows the shape (D8): Border is a setting on a view, written as a
 * stroke over it that takes the view's own corners, drawn inside, on or outside its edge.
 */
beforeEach(resetPipelineState)
const files = (text: string): SourceFile[] => [{ id: 'Sources/App.swift', text }]
const model = (text: string) => buildAuthoringModel({ projectId: 'border', revision: 1, files: files(text) })
const APP = `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
`
const screen = (body: string) => `${APP}
struct ContentView: View {
    var body: some View {
${body}
    }
}
`
const CARD = `        Text("Club")
            .padding()
            .background(Color.white)
            .clipShape(.rect(cornerRadius: 12))`

/** The view named `name`, the `index`th in the file. */
const view = (text: string, name: string, index = 0) => model(text).nodes.filter(node => node.name === name && node.kind === 'view')[index]!
function plan(text: string, node: AuthoringNode, operation: DesignEditRequest['operation']) {
  return planDesignEdit({ projectId: 'border', baseRevision: 1, files: files(text), scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation })
}
function edit(text: string, name: string, operation: DesignEditRequest['operation'], index = 0) {
  const result = plan(text, view(text, name, index), operation)
  if (!result.ok) throw new Error(result.reason)
  return result.changes[0]?.after ?? text
}

const BORDERED = `${CARD}
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(Color.gray, lineWidth: 1)
            }`

describe('a border is one setting of its view (D8)', () => {
  it('shows as one Border row with Color, Width and Position, not as a layer', () => {
    const nodes = model(screen(BORDERED)).nodes
    const card = nodes.find(node => node.name === 'Text')!
    const rows = card.modifiers!.filter(modifier => ['Border', 'Overlay'].includes(modifier.label))
    expect(rows.map(row => [row.name, row.label, row.capabilities.remove, row.capabilities.toggle])).toEqual([['border', 'Border', true, true]])
    expect(rows[0]!.controls.map(control => [control.id.split(':').at(-1), control.value])).toEqual([['color', 'gray'], ['width', '1'], ['position', 'inside']])
    expect(nodes.filter(node => node.parentId === card.id).map(node => node.name)).toEqual([])
  })
})

describe('adding a border (D8)', () => {
  it('draws it inside the edge, with the corners of the view it is on', () => {
    expect(edit(screen(CARD), 'Text', { kind: 'modifier-add', name: 'border' })).toBe(screen(`${CARD}
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(Color.gray, lineWidth: 1)
            }`))
  })
})

/** The id of the selected view's control whose id ends with `name`. */
const control = (text: string, name: string) => view(text, 'Text').controls!.find(item => item.id.endsWith(`:${name}`))!.id
const set = (text: string, name: string, value: string) => edit(text, 'Text', { kind: 'property', control: control(text, name), value })

describe('changing a border (D8)', () => {
  it('draws it outside the edge, on a shape as much larger as the line is wide', () => {
    expect(set(screen(BORDERED), 'position', 'outside')).toBe(screen(`${CARD}
            .overlay {
                RoundedRectangle(cornerRadius: 13)
                    .strokeBorder(Color.gray, lineWidth: 1)
                    .padding(-1)
            }`))
  })

  it('draws it on the edge, half in and half out', () => {
    expect(set(screen(BORDERED), 'position', 'center')).toBe(screen(`${CARD}
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.gray, lineWidth: 1)
            }`))
  })

  it('widens an outside border everywhere its width is written', () => {
    const outside = set(screen(BORDERED), 'position', 'outside')
    expect(set(outside, 'width', '3')).toBe(screen(`${CARD}
            .overlay {
                RoundedRectangle(cornerRadius: 15)
                    .strokeBorder(Color.gray, lineWidth: 3)
                    .padding(-3)
            }`))
  })

  it('changes its colour and nothing else', () => {
    expect(set(screen(BORDERED), 'color', 'red')).toBe(screen(BORDERED.replace('Color.gray', 'Color.red')))
  })
})

describe('removing or switching off a border (D8)', () => {
  const row = (text: string) => view(text, 'Text').modifiers!.find(modifier => modifier.name === 'border')!

  it('removes the whole overlay', () => {
    expect(edit(screen(BORDERED), 'Text', { kind: 'modifier-remove', modifier: row(screen(BORDERED)).id })).toBe(screen(CARD))
  })

  it('switches the whole overlay off and back on, still reading as the Border', () => {
    const off = edit(screen(BORDERED), 'Text', { kind: 'modifier-toggle', modifier: row(screen(BORDERED)).id, enabled: false })
    expect(model(off).nodes.filter(node => node.name === 'RoundedRectangle')).toEqual([])
    expect([row(off).label, row(off).enabled]).toEqual(['Border', false])
    expect(edit(off, 'Text', { kind: 'modifier-toggle', modifier: row(off).id, enabled: true })).toBe(screen(BORDERED))
  })

  it('keeps a switched-off border to the corners, so it comes back as the Border', () => {
    const off = edit(screen(BORDERED), 'Text', { kind: 'modifier-toggle', modifier: row(screen(BORDERED)).id, enabled: false })
    const rounder = set(off, 'cornerRadius', '20')
    expect(row(rounder).label).toBe('Border')
    expect(edit(rounder, 'Text', { kind: 'modifier-toggle', modifier: row(rounder).id, enabled: true })).toBe(screen(BORDERED.replaceAll('cornerRadius: 12', 'cornerRadius: 20')))
  })
})

describe('a border follows the corners of its view (D8)', () => {
  const SQUARE = `        Text("Club")
            .padding()
            .background(Color.white)`

  it('takes the new radius in the same step as the corner radius', () => {
    const text = screen(BORDERED)
    expect(set(text, 'cornerRadius', '20')).toBe(screen(BORDERED.replaceAll('cornerRadius: 12', 'cornerRadius: 20')))
  })

  it('outlines a square view with a rectangle, rounds it with the view, and squares it again', () => {
    const bordered = edit(screen(SQUARE), 'Text', { kind: 'modifier-add', name: 'border' })
    expect(bordered).toBe(screen(`${SQUARE}
            .overlay {
                Rectangle()
                    .strokeBorder(Color.gray, lineWidth: 1)
            }`))
    const rounded = edit(bordered, 'Text', { kind: 'modifier-add', name: 'clipShape' })
    expect(rounded).toBe(screen(`${SQUARE}
            .clipShape(.rect(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(Color.gray, lineWidth: 1)
            }`))
    const corners = view(rounded, 'Text').modifiers!.find(modifier => modifier.name === 'clipShape')!
    expect(edit(rounded, 'Text', { kind: 'modifier-remove', modifier: corners.id })).toBe(bordered)
  })

  it('keeps an outside border concentric on uneven corners, and square where a corner is', () => {
    const uneven = `        Text("Club")\n            .padding()\n            .clipShape(.rect(topLeadingRadius: 20, bottomLeadingRadius: 0, bottomTrailingRadius: 8, topTrailingRadius: 0))`
    const bordered = edit(screen(uneven), 'Text', { kind: 'modifier-add', name: 'border' })
    expect(set(bordered, 'position', 'outside')).toBe(screen(`${uneven}
            .overlay {
                UnevenRoundedRectangle(topLeadingRadius: 21, bottomLeadingRadius: 0, bottomTrailingRadius: 9, topTrailingRadius: 0)
                    .strokeBorder(Color.gray, lineWidth: 1)
                    .padding(-1)
            }`))
  })

  it('keeps an outside border concentric when the radius changes', () => {
    const outside = set(screen(BORDERED), 'position', 'outside')
    expect(set(outside, 'cornerRadius', '20')).toBe(screen(`${CARD.replace('cornerRadius: 12', 'cornerRadius: 20')}
            .overlay {
                RoundedRectangle(cornerRadius: 21)
                    .strokeBorder(Color.gray, lineWidth: 1)
                    .padding(-1)
            }`))
  })
})

describe('a border reads the corners however the view is rounded (D8)', () => {
  it.each([
    ['.clipShape(RoundedRectangle(cornerRadius: 12))', 'RoundedRectangle(cornerRadius: 12)'],
    ['.clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))', 'RoundedRectangle(cornerRadius: 12, style: .continuous)'],
    ['.cornerRadius(8)', 'RoundedRectangle(cornerRadius: 8)'],
    ['.clipShape(.capsule)', 'Capsule()'],
    ['.clipShape(Capsule())', 'Capsule()'],
    ['.clipShape(.circle)', 'Circle()'],
    ['.clipShape(Circle())', 'Circle()'],
    ['.background(Color.white, in: .rect(cornerRadius: 16))', 'RoundedRectangle(cornerRadius: 16)'],
    ['.background(Color.white, in: RoundedRectangle(cornerRadius: 16))', 'RoundedRectangle(cornerRadius: 16)'],
    ['.background(RoundedRectangle(cornerRadius: 16).fill(Color.white))', 'RoundedRectangle(cornerRadius: 16)'],
    ['.background { RoundedRectangle(cornerRadius: 16).fill(Color.white) }', 'RoundedRectangle(cornerRadius: 16)'],
    ['.clipShape(.rect(topLeadingRadius: 20, bottomTrailingRadius: 8))', 'UnevenRoundedRectangle(topLeadingRadius: 20, bottomTrailingRadius: 8)'],
  ])('written as %s', (corners, shape) => {
    const text = screen(`        Text("Club")\n            .padding()\n            ${corners}`)
    expect(edit(text, 'Text', { kind: 'modifier-add', name: 'border' })).toBe(screen(`        Text("Club")\n            .padding()\n            ${corners}\n            .overlay {\n                ${shape}\n                    .strokeBorder(Color.gray, lineWidth: 1)\n            }`))
  })

  it('written as a button\'s border shape, and goes before that style as a border does', () => {
    const text = screen('        Button("Join") { }\n            .buttonStyle(.bordered)\n            .buttonBorderShape(.capsule)')
    expect(edit(text, 'Button', { kind: 'modifier-add', name: 'border' })).toBe(screen('        Button("Join") { }\n            .overlay {\n                Capsule()\n                    .strokeBorder(Color.gray, lineWidth: 1)\n            }\n            .buttonStyle(.bordered)\n            .buttonBorderShape(.capsule)'))
  })
})

describe('borders written in Code (D8)', () => {
  const HAND = `${CARD}
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.gray.opacity(0.3), lineWidth: 2))`

  it('reads a stroke of the view\'s own shape as its Border, and keeps it on one line', () => {
    const card = view(screen(HAND), 'Text')
    const row = card.modifiers!.find(modifier => modifier.label === 'Border')!
    expect(row.controls.map(item => [item.id.split(':').at(-1), item.value])).toEqual([['color', 'gray'], ['opacity', '0.3'], ['width', '2'], ['position', 'center']])
    expect(set(screen(HAND), 'position', 'inside')).toBe(screen(`${CARD}
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.gray.opacity(0.3), lineWidth: 2))`))
  })

  it('keeps a border written on one line in its closure on one line', () => {
    const line = screen(`${CARD}\n            .overlay { RoundedRectangle(cornerRadius: 12).stroke(Color.gray, lineWidth: 2) }`)
    expect(set(line, 'position', 'inside')).toBe(screen(`${CARD}\n            .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(Color.gray, lineWidth: 2) }`))
  })

  it('leaves an overlay with a comment in it as the layer it was, so no rewrite loses the comment', () => {
    const text = screen(`${CARD}\n            .overlay {\n                // The brand outline\n                RoundedRectangle(cornerRadius: 12)\n                    .strokeBorder(Color.gray, lineWidth: 1)\n            }`)
    expect(view(text, 'Text').modifiers!.map(modifier => modifier.label)).toContain('Overlay')
  })

  it('keeps an old .border as the Border it was, with its colour and width', () => {
    const text = screen(`${CARD}\n            .border(Color.gray, width: 1)`)
    const row = view(text, 'Text').modifiers!.find(modifier => modifier.label === 'Border')!
    expect([row.name, row.controls.map(item => [item.kind, item.value])]).toEqual(['border', [['select', 'gray'], ['number', '1']]])
    expect(edit(text, 'Text', { kind: 'property', control: row.controls[1]!.id, value: '2' })).toBe(screen(`${CARD}\n            .border(Color.gray, width: 2)`))
  })

  it('leaves an overlay of some other shape as the layer it was', () => {
    const text = screen(HAND.replace('RoundedRectangle(cornerRadius: 12)', 'RoundedRectangle(cornerRadius: 8)'))
    const card = view(text, 'Text')
    expect(card.modifiers!.map(modifier => modifier.label)).toContain('Overlay')
    expect(model(text).nodes.filter(node => node.parentId === card.id).map(node => node.name)).toEqual(['Overlay'])
  })
})

describe('where a border is written (D8)', () => {
  it('stays on the line of a view written on one line', () => {
    const text = screen('        Text("Club").padding().clipShape(.rect(cornerRadius: 12))')
    expect(edit(text, 'Text', { kind: 'modifier-add', name: 'border' })).toBe(screen('        Text("Club").padding().clipShape(.rect(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.gray, lineWidth: 1))'))
  })

  it('is written as an argument before iOS 15, which has no overlay closure', () => {
    const text = screen(CARD.replace('.clipShape(.rect(cornerRadius: 12))', '.clipShape(RoundedRectangle(cornerRadius: 12))'))
    const node = view(text, 'Text')
    const result = planDesignEdit({ projectId: 'border', baseRevision: 1, files: files(text), scope: node.owner, target: node.source, fingerprint: node.fingerprint, deploymentTarget: '14.0', operation: { kind: 'modifier-add', name: 'border' } })
    if (!result.ok) throw new Error(result.reason)
    expect(result.changes[0]!.after).toBe(text.replace('.clipShape(RoundedRectangle(cornerRadius: 12))', '.clipShape(RoundedRectangle(cornerRadius: 12))\n            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.gray, lineWidth: 1))'))
  })

  it('keeps its place before a shadow added after it', () => {
    const shadowed = edit(screen(BORDERED), 'Text', { kind: 'modifier-add', name: 'shadow' })
    expect(shadowed.indexOf('.overlay {')).toBeLessThan(shadowed.indexOf('.shadow('))
  })
})

describe('a shape drawn only by its stroke (D8)', () => {
  const RING = '        Circle()\n            .stroke(Color.blue, lineWidth: 8)\n            .frame(width: 80, height: 80)'
  const stroke = (text: string) => model(text).nodes.find(node => node.name === 'Circle')!.modifiers!.find(modifier => modifier.name === 'stroke')!

  it('cannot have its stroke switched off, which would fill it in', () => {
    expect([stroke(screen(RING)).capabilities.toggle, stroke(screen(RING)).capabilities.reason]).toEqual([false, 'Switched off, this stroke would leave the shape filled in. Change it in Code.'])
  })

  it('can when a fill is written too', () => {
    expect(stroke(screen(RING.replace('Circle()', 'Circle()\n            .fill(Color.white)'))).capabilities.toggle).toBe(true)
  })
})

/**
 * Does every border D8 writes build in Xcode 27? Opt-in, as `tests/xcode-build.test.ts` is:
 *
 *     XCODE_BUILD=1 npx vitest run tests/border.test.ts
 */
describe.skipIf(process.env.XCODE_BUILD !== '1')('what a border is written as typechecks in Xcode', () => {
  it('in every position, on every kind of corner, in both forms', () => {
    const added = (corners: string) => edit(screen(`        Text("Club")\n            .padding()\n            ${corners}`), 'Text', { kind: 'modifier-add', name: 'border' })
    const TOKENS = '\nextension CGFloat {\n    static let radiusMedium: CGFloat = 12\n}\n'
    const shapes: string[] = []
    for (const corners of ['.clipShape(.rect(cornerRadius: 12))', '.clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))', '.background(Color.white)', '.clipShape(.capsule)', '.clipShape(Circle())', '.background(Color.white, in: .rect(cornerRadius: 16))', '.cornerRadius(8)', '.clipShape(.rect(topLeadingRadius: 20, bottomLeadingRadius: 0, bottomTrailingRadius: 8, topTrailingRadius: 0))', '.clipShape(.rect(topLeadingRadius: 20, bottomTrailingRadius: 8))']) {
      const inside = added(corners)
      shapes.push(inside, set(inside, 'position', 'center'), set(set(inside, 'position', 'outside'), 'width', '3'))
    }
    const token = edit(screen('        Text("Club")\n            .padding()\n            .clipShape(.rect(cornerRadius: .radiusMedium))') + TOKENS, 'Text', { kind: 'modifier-add', name: 'border' })
    shapes.push(token, set(token, 'position', 'outside'))
    shapes.push(edit(screen('        Text("Club").padding().clipShape(.rect(cornerRadius: 12))'), 'Text', { kind: 'modifier-add', name: 'border' }))
    shapes.push(set(screen(`${CARD}\n            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.gray.opacity(0.3), lineWidth: 2))`), 'position', 'outside'))
    shapes.push(set(set(screen(BORDERED), 'cornerRadius', '20'), 'color', 'red'))
    shapes.push(edit(screen('        Button("Join") { }\n            .buttonStyle(.bordered)\n            .buttonBorderShape(.capsule)'), 'Button', { kind: 'modifier-add', name: 'border' }))
    shapes.push(set(screen(`${CARD}\n            .overlay { RoundedRectangle(cornerRadius: 12).stroke(Color.gray, lineWidth: 2) }`), 'position', 'outside'))
    const root = mkdtempSync(join(tmpdir(), 'studio-border-'))
    try {
      const sdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], { encoding: 'utf8' }).trim()
      for (const [index, text] of shapes.entries()) {
        const file = join(root, `Border${index}.swift`)
        writeFileSync(file, text)
        execFileSync('xcrun', ['--sdk', 'iphonesimulator', 'swiftc', '-typecheck', '-parse-as-library', '-sdk', sdk, '-target', 'arm64-apple-ios27.0-simulator', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
    expect(shapes).toHaveLength(34)
  }, 300_000)
})
