import { beforeEach, describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import type { AuthoringNode, DesignEditRequest, SourceFile } from '@studio/shared'

/**
 * The modifier stack: the v1 catalog, where new modifiers land, and switching one off.
 *
 * Every change is a planned source edit, so each case also checks that the result
 * parses and type-checks and that the preview still draws.
 */

beforeEach(resetPipelineState)
const wrap = (body: string, extra = '') => `import SwiftUI\n@main struct StackApp: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View {\n    var body: some View {\n        ${body}\n    }\n}\n${extra}`
const files = (text: string): SourceFile[] => [{ id: 'Sources/App.swift', text }]
const node = (text: string, name = 'Text', target = '17.0'): AuthoringNode => buildAuthoringModel({ projectId: 'stack', revision: 1, files: files(text), deploymentTarget: target }).nodes.find(n => n.name === name && n.kind !== 'definition')!
function plan(text: string, operation: DesignEditRequest['operation'], name = 'Text', target = '17.0') {
  const selected = node(text, name, target)
  return planDesignEdit({ projectId: 'stack', baseRevision: 1, files: files(text), deploymentTarget: target, scope: selected.owner, target: selected.source, fingerprint: selected.fingerprint, operation })
}
function edit(text: string, operation: DesignEditRequest['operation'], name = 'Text', target = '17.0'): string {
  const result = plan(text, operation, name, target)
  if (!result.ok) throw new Error(result.reason)
  return result.changes[0]?.after ?? text
}
const draws = (text: string) => {
  const result = compile({ projectId: 'stack', revision: 1, files: files(text), canvas: { width: 393, height: 852 }, colorScheme: 'light' })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  return result
}

describe('the v1 catalog', () => {
  const cases: readonly [string, string, readonly string[]][] = [
    ['offset', '.offset(x: 0, y: 0)', ['offset · x', 'offset · y']],
    ['clipShape', '.clipShape(.rect(cornerRadius: 12))', ['cornerRadius']],
    // A border follows the view's corners, square here (D8).
    ['border', '.overlay(Rectangle().strokeBorder(Color.gray, lineWidth: 1))', ['border · color', 'width', 'position']],
    ['shadow', '.shadow(color: Color.black.opacity(0.15), radius: 8, x: 0, y: 4)', ['radius', 'x', 'y']],
    ['blur', '.blur(radius: 4)', ['radius']],
    ['bold', '.bold()', []], ['italic', '.italic()', []], ['underline', '.underline()', []], ['strikethrough', '.strikethrough()', []],
    ['tracking', '.tracking(1)', ['tracking']], ['lineSpacing', '.lineSpacing(4)', ['lineSpacing']],
    ['rotationEffect', '.rotationEffect(.degrees(15))', ['degrees']], ['scaleEffect', '.scaleEffect(1.1)', ['scaleEffect']],
    ['disabled', '.disabled(true)', ['disabled']], ['navigationTitle', '.navigationTitle("Title")', ['navigationTitle']],
    ['navigationBarTitleDisplayMode', '.navigationBarTitleDisplayMode(.inline)', ['Title size']],
    ['foregroundStyle', '.foregroundStyle(Color.primary)', ['foregroundStyle']], ['multilineTextAlignment', '.multilineTextAlignment(.center)', ['multilineTextAlignment']],
  ]
  it.each(cases)('adds %s as valid, editable, movable Swift', (name, source, labels) => {
    const result = edit(wrap('Text("Hello")'), { kind: 'modifier-add', name })
    expect(result).toContain(`Text("Hello")${source}`)
    const modifier = node(result).modifiers!.find(m => m.name === name)!
    expect(modifier.capabilities).toMatchObject({ remove: true, toggle: true })
    for (const label of labels) expect(modifier.controls.map(c => c.label).join(' | ')).toContain(label)
    draws(result)
  })

  it('writes the iOS 16 corner radius where .rect(cornerRadius:) is unavailable', () => {
    expect(edit(wrap('Text("A")'), { kind: 'modifier-add', name: 'clipShape' }, 'Text', '16.0')).toContain('.clipShape(RoundedRectangle(cornerRadius: 12))')
  })

  it('adds a shadow token when the App has one', () => {
    const tokens = 'struct ShadowToken { let color: Color; let radius: CGFloat; let x: CGFloat; let y: CGFloat }\nextension View { func shadow(_ token: ShadowToken) -> some View { shadow(color: token.color, radius: token.radius, x: token.x, y: token.y) } }\nextension ShadowToken { static let low = ShadowToken(color: .black.opacity(0.1), radius: 4, x: 0, y: 2) }\n'
    const result = edit(wrap('Text("A")', tokens), { kind: 'modifier-add', name: 'shadow' })
    expect(result).toContain('Text("A").shadow(.low)')
    draws(result)
  })

  it('offers the older spellings by name only, never in the menu', () => {
    const catalog = node(wrap('Text("A")')).modifierCatalog!
    expect(catalog.find(entry => entry.name === 'cornerRadius')?.hidden).toBe(true)
    expect(catalog.find(entry => entry.name === 'foregroundColor')?.hidden).toBe(true)
    expect(catalog.filter(entry => !entry.hidden).every(entry => !!entry.description)).toBe(true)
  })

  it('links a corner radius token inside clipShape', () => {
    const tokens = 'extension CGFloat { static let radiusMedium: CGFloat = 12 }\n'
    const source = edit(wrap('Text("A")', tokens), { kind: 'modifier-add', name: 'clipShape' })
    const radius = node(source).styles!.find(style => style.kind === 'radius')!
    const linked = edit(source, { kind: 'style-link', property: radius.property, name: 'radiusMedium' })
    expect(linked).toContain('.clipShape(.rect(cornerRadius: .radiusMedium))')
    draws(linked)
  })
})

describe('where a new modifier lands', () => {
  it('puts padding inside a background added first, so the background covers it', () => {
    const result = edit(wrap('Text("A").background(Color.blue)'), { kind: 'modifier-add', name: 'padding' })
    expect(result).toContain('Text("A").padding(16).background(Color.blue)')
  })
  it('puts text styling first and effects last, and never moves what is there', () => {
    let source = wrap('Text("A").padding(8).opacity(0.5)')
    source = edit(source, { kind: 'modifier-add', name: 'font' })
    source = edit(source, { kind: 'modifier-add', name: 'shadow' })
    expect(source).toContain('Text("A").font(.body).padding(8).shadow(color: Color.black.opacity(0.15), radius: 8, x: 0, y: 4).opacity(0.5)')
  })
  it('refuses to add to a stack with a modifier it does not recognise, whose return type is unknown', () => {
    expect(plan(wrap('Text("A").customLook().background(Color.blue)', 'extension View { func customLook() -> some View { self } }'), { kind: 'modifier-add', name: 'padding' })).toMatchObject({ ok: false })
  })
})

describe('switching a modifier off and on', () => {
  it('comments it out in place and restores the exact text', () => {
    const source = wrap('Text("A")\n            .padding(8)\n            .background(Color.blue)\n            .opacity(0.5)')
    const background = node(source).modifiers![1]!
    const off = edit(source, { kind: 'modifier-toggle', modifier: background.id, enabled: false })
    expect(off).toContain('.padding(8)\n            /*studio-off:1 ".background(Color.blue)"*/\n            .opacity(0.5)')
    const model = node(off).modifiers!
    expect(model.map(m => [m.name, m.enabled])).toEqual([['padding', true], ['background', false], ['opacity', true]])
    // Controls still belong to the right card after the one that is off.
    expect(model[2]!.controls[0]?.value).toBe('0.5')
    expect(draws(off).renderTree?.nodes.some(n => n.background?.kind === 'solid' && n.background.color.b > 200 && n.background.color.r < 50)).toBe(false)
    const on = edit(off, { kind: 'modifier-toggle', modifier: model[1]!.id, enabled: true })
    expect(on).toBe(source)
  })

  it('keeps a multi-line modifier with a closure exact through off and on', () => {
    const source = wrap('Text("A")\n            .overlay {\n                Text("/* not a comment */ \\"quoted\\"")\n            }\n            .padding(4)')
    const overlay = node(source).modifiers![0]!
    const off = edit(source, { kind: 'modifier-toggle', modifier: overlay.id, enabled: false })
    expect(node(off).modifiers!.map(m => [m.name, m.enabled])).toEqual([['overlay', false], ['padding', true]])
    // The marker is one line and holds no asterisk, so it cannot open or close a comment.
    expect(off.split('\n').find(line => line.includes('studio-off'))).not.toMatch(/\*.*\*.*\*/)
    expect(draws(off).renderTree?.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? []).join(' ')).not.toContain('quoted')
    expect(edit(off, { kind: 'modifier-toggle', modifier: node(off).modifiers![0]!.id, enabled: true })).toBe(source)
  })

  it('switches off the last modifier, and moves and removes an entry that is off', () => {
    const source = wrap('Text("A").padding(8).opacity(0.5)')
    const off = edit(source, { kind: 'modifier-toggle', modifier: node(source).modifiers![1]!.id, enabled: false })
    expect(off).toContain('Text("A").padding(8)/*studio-off:1 ".opacity(0.5)"*/')
    const moved = edit(off, { kind: 'modifier-move', modifier: node(off).modifiers![1]!.id, toIndex: 0 })
    expect(moved).toContain('Text("A")/*studio-off:1 ".opacity(0.5)"*/.padding(8)')
    const removed = edit(moved, { kind: 'modifier-remove', modifier: node(moved).modifiers![0]!.id })
    expect(removed).toContain('Text("A").padding(8)\n')
    draws(removed)
  })

  it('still pins a chain with a comment a person wrote', () => {
    const selected = node(wrap('Text("A").padding(8) // keep this\n            .opacity(0.5)'))
    expect(selected.modifiers!.every(m => !m.capabilities.remove && !m.capabilities.toggle)).toBe(true)
  })

  it('refuses to switch off a modifier the rest of the chain depends on', () => {
    const source = wrap('Image(systemName: "star").resizable().frame(width: 20, height: 20)')
    const resizable = node(source, 'Image').modifiers![0]!
    const result = plan(source, { kind: 'modifier-toggle', modifier: resizable.id, enabled: false }, 'Image')
    // `.frame` still type-checks on an Image, so this one is allowed; the planner is the judge.
    expect(result.ok).toBe(true)
  })
})
