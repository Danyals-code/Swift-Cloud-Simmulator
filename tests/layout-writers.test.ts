import { beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { resetPipelineState } from '@studio/swiftui-runtime'
import type { AuthoringNode, DesignEditRequest, SourceFile } from '@studio/shared'

/**
 * Layout writers that wrote Swift Xcode rejects, or did something other than what the
 * panel said (doc 18, Fix first 1, 3 and 7).
 */
beforeEach(resetPipelineState)

const APP = 'Sources/App.swift'
const screen = (body: string, declarations = '') => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    var body: some View {
${body}
    }
}
${declarations}`
const project = (text: string, extra: readonly SourceFile[] = []): SourceFile[] => [{ id: APP, text }, ...extra]
const view = (files: readonly SourceFile[], name: string, index = 0): AuthoringNode =>
  buildAuthoringModel({ projectId: 'layout', revision: 1, files: [...files] }).nodes.filter(node => node.name === name && node.kind === 'view')[index]!
function plan(files: readonly SourceFile[], name: string, operation: DesignEditRequest['operation'], index = 0) {
  const node = view(files, name, index)
  return planDesignEdit({ projectId: 'layout', baseRevision: 1, files: [...files], scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation })
}
function edit(files: readonly SourceFile[], name: string, operation: DesignEditRequest['operation'], index = 0): SourceFile[] {
  const result = plan(files, name, operation, index)
  if (!result.ok) throw new Error(result.reason)
  return files.map(file => ({ ...file, text: result.changes.find(change => change.file === file.id)?.after ?? file.text })).concat(result.changes.filter(change => !files.some(file => file.id === change.file)).map(change => ({ id: change.file, text: change.after })))
}
const text = (files: readonly SourceFile[]) => files.find(file => file.id === APP)!.text
const paddingCard = (node: AuthoringNode) => node.modifiers!.find(modifier => modifier.name === 'padding')!

describe('padding next to a token or constant (Fix first 1)', () => {
  it.each([
    ['a constant in an enum', '        Text("A")\n            .padding(Layout.padding)', '\nenum Layout {\n    static let padding: CGFloat = 30\n}\n', 'Layout.padding', '30'],
    ['a CGFloat extension', '        Text("A")\n            .padding(.gutter)', '\nextension CGFloat {\n    static let gutter: CGFloat = 8\n}\n', 'gutter', '8'],
  ])('reads %s as the amount, linked to it, and offers no second amount', (_, body, declarations, token, value) => {
    const files = project(screen(body, declarations))
    const card = paddingCard(view(files, 'Text'))
    expect(card.controls.map(control => control.label)).not.toContain('Padding amount')
    const style = view(files, 'Text').styles!.find(item => card.propertyIds.includes(item.property))
    expect(style).toMatchObject({ kind: 'spacing', token, value })
  })

  it('reads the studio\'s own Save as token output as linked, and writes a number in its place', () => {
    const start = project(screen('        Text("A")\n            .padding(24)'))
    const property = view(start, 'Text').styles!.find(style => style.label === 'padding')!.property
    const saved = edit(start, 'Text', { kind: 'style-create-link', property, name: 'space16', style: 'spacing', value: '24' })
    expect(text(saved)).toContain('.padding(.space16)')
    const linked = view(saved, 'Text')
    expect(paddingCard(linked).controls.map(control => control.label)).not.toContain('Padding amount')
    const style = linked.styles!.find(item => paddingCard(linked).propertyIds.includes(item.property))!
    expect(style).toMatchObject({ token: 'space16', value: '24' })
    // Custom in the token picker, then a new number: each replaces the amount, never adds a second one.
    const custom = edit(saved, 'Text', { kind: 'style-local', property: style.property, value: '24' })
    expect(text(custom)).toContain('.padding(24)\n')
    const amount = view(custom, 'Text').controls!.find(control => control.label === 'padding')!
    expect(text(edit(custom, 'Text', { kind: 'property', control: amount.id, value: '30' }))).toContain('.padding(30)\n')
  })

  it.each([
    ['.padding(.horizontal)', '.padding(.horizontal, 12)'],
    ['.padding(Edge.Set.horizontal)', '.padding(Edge.Set.horizontal, 12)'],
    ['.padding([.top, .leading])', '.padding([.top, .leading], 12)'],
  ])('still reads %s as edges, and adds the amount after them', (written, expected) => {
    const files = project(screen(`        Text("A")\n            ${written}`))
    const amount = paddingCard(view(files, 'Text')).controls.find(control => control.label === 'Padding amount')!
    expect(text(edit(files, 'Text', { kind: 'property', control: amount.id, value: '12' }))).toContain(expected + '\n')
  })

  it('is refused by the planner, whichever writer would put it there', () => {
    const files = project(screen('        VStack {\n            Text("A")\n        }', '\nextension CGFloat {\n    static let space16: CGFloat = 16\n}\n'))
    expect(plan(files, 'VStack', { kind: 'insert', snippet: 'Text("B").padding(.space16, 24)' })).toEqual({ ok: false, reason: 'This change would write `.padding(.space16, 24)`, which would stop the app from building. Nothing was changed.' })
    expect(plan(files, 'VStack', { kind: 'insert', snippet: 'Text("B").padding(.horizontal, .space16)' })).toMatchObject({ ok: true })
  })
})

describe('a max width (Fix first 7)', () => {
  const FILLED = '        Text("A")\n            .frame(maxWidth: .infinity)'

  it('keeps the Width sizing, reading a capped width as Fill up to the cap', () => {
    const files = project(screen(FILLED))
    const cap = view(files, 'Text').controls!.find(control => control.id.endsWith(':bound') && control.label === 'frame · maxWidth')!
    const capped = edit(files, 'Text', { kind: 'property', control: cap.id, value: '260' })
    expect(text(capped)).toContain('Text("A")\n            .frame(maxWidth: 260)\n')
    const size = view(capped, 'Text').modifiers!.find(modifier => modifier.name === 'frame')!
    expect(size.controls.map(control => [control.label, control.value])).toEqual(expect.arrayContaining([['frame · maxWidth', '260'], ['max Height', ''], ['Width sizing', 'Fill']]))
    expect(size.controls.filter(control => control.value === '260')).toHaveLength(1)
  })

  it('takes the cap away with Hug, and replaces it with Fixed', () => {
    const capped = project(screen('        Text("A")\n            .frame(maxWidth: 260)'))
    expect(text(edit(capped, 'Text', { kind: 'property', control: 'fill:width', value: 'Hug' }))).toContain('        Text("A")\n    }')
    expect(text(edit(capped, 'Text', { kind: 'property', control: 'fill:width', value: 'Fixed' }))).toContain('Text("A").frame(width: 100)\n')
  })
})

describe('Fill on a button widens the button itself (Fix first 3)', () => {
  const STYLED = '\n            .buttonStyle(.borderedProminent)'
  const width = (files: readonly SourceFile[], value: string) => edit(files, 'Button', { kind: 'property', control: 'fill:width', value })
  const sizing = (files: readonly SourceFile[]) => view(files, 'Button').controls!.find(control => control.id === 'fill:width')

  it.each([
    ['a title and an action', '        Button("Join") { }', '        Button { } label: {\n            Text("Join")\n                .frame(maxWidth: .infinity)\n        }'],
    ['a title and an action on several lines', '        Button("Join") {\n            print("joined")\n        }', '        Button {\n            print("joined")\n        } label: {\n            Text("Join")\n                .frame(maxWidth: .infinity)\n        }'],
    ['a role', '        Button("Delete", role: .destructive) { }', '        Button(role: .destructive) { } label: {\n            Text("Delete")\n                .frame(maxWidth: .infinity)\n        }'],
    ['an action argument', '        Button("Join", action: {})', '        Button(action: {}) {\n            Text("Join")\n                .frame(maxWidth: .infinity)\n        }'],
    ['a symbol', '        Button("Add", systemImage: "plus") { }', '        Button { } label: {\n            Label("Add", systemImage: "plus")\n                .frame(maxWidth: .infinity)\n        }'],
    ['a label', '        Button { } label: {\n            Text("Join")\n        }', '        Button { } label: {\n            Text("Join")\n                .frame(maxWidth: .infinity)\n        }'],
    ['a label on one line', '        Button(action: {}) { Text("Join") }', '        Button(action: {}) { Text("Join").frame(maxWidth: .infinity) }'],
    ['a label of several views', '        Button { } label: {\n            Image(systemName: "plus")\n            Text("Add")\n        }', '        Button { } label: {\n            HStack {\n                Image(systemName: "plus")\n                Text("Add")\n            }\n            .frame(maxWidth: .infinity)\n        }'],
    ['a label of several views on one line', '        Button(action: {}) { Image(systemName: "plus"); Text("Add") }', '        Button(action: {}) { HStack { Image(systemName: "plus"); Text("Add") }.frame(maxWidth: .infinity) }'],
  ])('written with %s, by framing its label inside the style', (_, button, filled) => {
    const files = project(screen(button + STYLED))
    expect(sizing(files)?.value).toBe('Hug')
    const wide = width(files, 'Fill')
    expect(text(wide)).toBe(screen(filled + STYLED))
    expect(sizing(wide)?.value).toBe('Fill')
  })

  it('reads the label\'s frame as the button\'s sizing, and Hug and Fixed change it there', () => {
    const wide = width(project(screen('        Button("Join") { }' + STYLED)), 'Fill')
    expect(text(width(wide, 'Hug'))).toBe(screen('        Button { } label: {\n            Text("Join")\n        }' + STYLED))
    expect(text(width(wide, 'Fixed'))).toBe(screen('        Button { } label: {\n            Text("Join").frame(width: 100)\n        }' + STYLED))
  })

  it('makes two buttons in a row share it equally', () => {
    const pair = project(screen('        HStack {\n            Button("Cancel") { }\n            Button("Save") { }\n        }'))
    const both = edit(edit(pair, 'Button', { kind: 'property', control: 'fill:width', value: 'Fill' }, 0), 'Button', { kind: 'property', control: 'fill:width', value: 'Fill' }, 1)
    expect(text(both).match(/\.frame\(maxWidth: \.infinity\)/g)).toHaveLength(2)
    expect(text(both)).not.toMatch(/\}\s*\.frame/)
  })

  it('sizes the room around a button whose label it cannot reach, and says the shape keeps its size', () => {
    const files = project(screen('        Button { } label: {\n            let title = "Join"\n            Text(title)\n        }' + STYLED))
    expect(sizing(files)?.disabledReason).toBeUndefined()
    expect(sizing(files)?.description).toMatch(/shape/)
    expect(text(width(files, 'Fill'))).toBe(screen('        Button { } label: {\n            let title = "Join"\n            Text(title)\n        }' + STYLED + '.frame(maxWidth: .infinity)'))
  })

  it('keeps a frame already written outside the button where it is', () => {
    const outside = project(screen('        Button("Join") { }' + STYLED + '\n            .frame(maxWidth: .infinity)'))
    expect(sizing(outside)?.value).toBe('Fill')
    expect(text(width(outside, 'Hug'))).toBe(screen('        Button("Join") { }' + STYLED))
  })
})

/**
 * Does every form these writers produce build in Xcode 27? Opt-in, as `tests/xcode-build.test.ts` is:
 *
 *     XCODE_BUILD=1 npx vitest run tests/layout-writers.test.ts
 */
describe.skipIf(process.env.XCODE_BUILD !== '1')('what the layout writers write typechecks in Xcode', () => {
  it('for padding beside a token, a capped width and every button Fill form', () => {
    const TOKENS = '\nenum Layout {\n    static let padding: CGFloat = 30\n}\n\nextension CGFloat {\n    static let space16: CGFloat = 16\n}\n'
    const property = (files: SourceFile[], name: string, label: string, value: string) => text(edit(files, name, { kind: 'property', control: view(files, name).controls!.find(control => control.label === label || control.id === label)!.id, value }))
    const sources: string[] = []
    for (const written of ['.padding(Layout.padding)', '.padding(.space16)', '.padding(.horizontal)']) {
      const files = project(screen(`        Text("A")\n            ${written}`, TOKENS))
      const amount = view(files, 'Text').controls!.find(control => control.label === 'Padding amount')
      sources.push(amount ? property(files, 'Text', amount.id, '12') : text(files))
    }
    sources.push(property(project(screen('        Text("A")\n            .frame(maxWidth: .infinity)')), 'Text', 'fill:width', 'Fixed'))
    const STYLED = '\n            .buttonStyle(.borderedProminent)'
    for (const button of ['        Button("Join") { }', '        Button("Join") {\n            print("joined")\n        }', '        Button("Delete", role: .destructive) { }', '        Button("Join", action: {})', '        Button("Add", systemImage: "plus") { }', '        Button { } label: {\n            Text("Join")\n        }', '        Button(action: {}) { Text("Join") }', '        HStack { Button("A") { }; Button("B") { } }', '        Button { } label: {\n            Image(systemName: "plus")\n            Text("Add")\n        }', '        Button(action: {}) { Image(systemName: "plus"); Text("Add") }']) {
      const files = project(screen(button + STYLED))
      for (const value of ['Fill', 'Fixed']) sources.push(property(files, 'Button', 'fill:width', value))
      sources.push(property(files, 'Button', 'fill:height', 'Fill'))
    }
    const root = mkdtempSync(join(tmpdir(), 'studio-layout-'))
    try {
      const sdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], { encoding: 'utf8' }).trim()
      for (const [index, source] of sources.entries()) {
        const file = join(root, `Layout${index}.swift`)
        writeFileSync(file, source)
        execFileSync('xcrun', ['--sdk', 'iphonesimulator', 'swiftc', '-typecheck', '-parse-as-library', '-sdk', sdk, '-target', 'arm64-apple-ios27.0-simulator', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
    expect(sources).toHaveLength(34)
  }, 300_000)
})
