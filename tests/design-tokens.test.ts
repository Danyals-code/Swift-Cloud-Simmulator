import { beforeEach, describe, expect, it } from 'vitest'
import { buildAuthoringModel, Checker, planDesignEdit } from '@studio/swift-sema'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { Parser } from '@studio/swift-syntax'
import { applyProjectTransaction, projectFromFiles } from '@studio/project-model'
import { assetCatalog } from '../packages/exporter/src/resources'
import type { AuthoringNode, DesignEditRequest, PreviewColorAsset, SourceFile } from '@studio/shared'

/**
 * Design tokens, as the studio writes and reads them.
 *
 * Five kinds live in `DesignSystem/Tokens.swift` as static members of framework types,
 * and a colour token's values live in the asset catalog. Every field that takes a colour,
 * spacing, radius or font links to a token by its Swift name, with dot syntax.
 */

beforeEach(resetPipelineState)

const TOKENS = `import SwiftUI

// MARK: - Colors

extension Color {
    static let accent = Color("accent")
    static let textPrimary = Color("textPrimary")
}

extension ShapeStyle where Self == Color {
    static var accent: Color { Color("accent") }
    static var textPrimary: Color { Color("textPrimary") }
}

// MARK: - Spacing

extension CGFloat {
    static let space16: CGFloat = 16
}

// MARK: - Corner radius

extension CGFloat {
    static let radiusMedium: CGFloat = 12
}

// MARK: - Text styles

extension Font {
    static let sectionTitle = Font.system(.headline)
}

// MARK: - Shadows

struct ShadowToken {
    let color: Color
    let radius: CGFloat
    let x: CGFloat
    let y: CGFloat
}

extension View {
    func shadow(_ token: ShadowToken) -> some View {
        shadow(color: token.color, radius: token.radius, x: token.x, y: token.y)
    }
}

extension ShadowToken {
    static let low = ShadowToken(color: .black.opacity(0.1), radius: 4, x: 0, y: 2)
}
`
const COLORS: readonly PreviewColorAsset[] = [{ name: 'accent', light: '#0A84FF' }, { name: 'textPrimary', light: '#1C1C1E', dark: '#F2F2F7' }]
const app = (body: string) => `import SwiftUI\n@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View {\n    var body: some View {\n        ${body}\n    }\n}\n`
const project = (body: string, tokens: string | null = TOKENS): SourceFile[] => [{ id: 'Sources/App.swift', text: app(body) }, ...(tokens ? [{ id: 'Sources/DesignSystem/Tokens.swift', text: tokens }] : [])]
const model = (files: readonly SourceFile[], colors = COLORS) => buildAuthoringModel({ projectId: 't', revision: 1, files, colors })
const node = (files: readonly SourceFile[], name: string, colors = COLORS) => model(files, colors).nodes.find(n => n.name === name && n.kind !== 'definition')!
function plan(files: readonly SourceFile[], target: AuthoringNode, operation: DesignEditRequest['operation'], colors = COLORS) {
  return planDesignEdit({ projectId: 't', baseRevision: 1, files, colors, scope: target.owner, target: target.source, fingerprint: target.fingerprint, operation })
}
function planned(files: readonly SourceFile[], target: AuthoringNode, operation: DesignEditRequest['operation'], colors: readonly PreviewColorAsset[] = COLORS) {
  const result = plan(files, target, operation, colors)
  if (!result.ok) throw new Error(result.reason)
  const next = files.filter(file => !result.changes.some(c => c.file === file.id && c.deleted)).map(file => ({ ...file, text: result.changes.find(c => c.file === file.id)?.after ?? file.text }))
  for (const change of result.changes) if (change.before === null) next.push({ id: change.file, text: change.after })
  return { result, files: next, colors: result.colorSets ?? colors }
}
const errors = (files: readonly SourceFile[]) => Checker.check(files.map(f => Parser.parse(f.text, f.id).sourceFile)).diagnostics.filter(d => d.severity === 'error')

describe('reading tokens', () => {
  it('lists every kind with its value, and counts references however they are spelled', () => {
    const files = project('VStack(spacing: .space16) { Text("A").foregroundStyle(.accent); Text("B").foregroundColor(Color.accent).font(.sectionTitle) }.padding(.space16).shadow(.low)')
    const styles = model(files).styles!
    const byName = Object.fromEntries(styles.map(s => [s.name, s]))
    expect(byName.accent).toMatchObject({ kind: 'color', form: 'token', reference: '.accent', light: '#0A84FF', value: '#0A84FF' })
    expect(byName.textPrimary).toMatchObject({ kind: 'color', light: '#1C1C1E', dark: '#F2F2F7' })
    expect(byName.space16).toMatchObject({ kind: 'spacing', value: '16' })
    expect(byName.radiusMedium).toMatchObject({ kind: 'radius', value: '12' })
    expect(byName.sectionTitle).toMatchObject({ kind: 'font', font: { style: 'headline' }, value: 'Headline' })
    expect(byName.low).toMatchObject({ kind: 'shadow', shadow: { color: 'black', opacity: 0.1, radius: 4, x: 0, y: 2 } })
    // The ShapeStyle twin is the same token, and its own `Color("accent")` is not a use.
    expect(styles.filter(s => s.name === 'accent')).toHaveLength(1)
    expect(byName.accent!.uses).toHaveLength(2)
    expect(byName.space16!.uses).toHaveLength(2)
  })

  it('shows a linked field by token name, and a raw value as a raw value', () => {
    const files = project('Text("A").foregroundStyle(.accent).padding(12).cornerRadius(.radiusMedium).font(.sectionTitle)')
    const text = node(files, 'Text')
    expect(text.styles).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'foregroundStyle', kind: 'color', token: 'accent' }),
      expect.objectContaining({ label: 'padding', kind: 'spacing', value: '12' }),
      expect.objectContaining({ label: 'cornerRadius', kind: 'radius', token: 'radiusMedium' }),
      expect.objectContaining({ label: 'font', kind: 'font', token: 'sectionTitle' }),
    ]))
    expect(text.styles!.find(p => p.label === 'padding')!.token).toBeUndefined()
  })

  it('keeps system colours editable in a project that extends Color', () => {
    const files = project('Text("A").foregroundColor(Color.blue)')
    expect(node(files, 'Text').controls?.some(c => c.value === 'blue')).toBe(true)
  })
})

describe('writing tokens', () => {
  it('creates Tokens.swift on first use, with the colour in the asset catalog', () => {
    const files = project('Text("A").foregroundStyle(.blue)', null)
    const text = node(files, 'Text', [])
    const { result, files: next, colors } = planned(files, text, { kind: 'style-create', name: 'brand', style: 'color', value: '#6d28d9', token: { value: '#6D28D9', dark: '#A78BFA' } }, [])
    const tokens = result.changes.find(c => c.file === 'Sources/DesignSystem/Tokens.swift')
    expect(tokens?.before).toBeNull()
    expect(tokens?.after).toContain('extension Color {\n    static let brand = Color("brand")\n}')
    expect(tokens?.after).toContain('extension ShapeStyle where Self == Color {\n    static var brand: Color { Color("brand") }\n}')
    expect(colors).toEqual([{ name: 'brand', light: '#6D28D9', dark: '#A78BFA' }])
    expect(errors(next)).toEqual([])
  })

  it('adds each kind to its own section, next to tokens of the same kind', () => {
    let files = project('Text("A").padding(8)')
    let colors: readonly PreviewColorAsset[] = COLORS
    const add = (operation: DesignEditRequest['operation']) => { const next = planned(files, node(files, 'Text', colors), operation, colors); files = next.files; colors = next.colors }
    add({ kind: 'style-create', name: 'space24', style: 'spacing', value: '24' })
    add({ kind: 'style-create', name: 'radiusSmall', style: 'radius', value: '6' })
    add({ kind: 'style-create', name: 'captionStrong', style: 'font', value: 'caption', token: { value: 'caption', font: { style: 'caption', weight: 'semibold' } } })
    add({ kind: 'style-create', name: 'high', style: 'shadow', value: '', token: { value: '', shadow: { color: 'black', opacity: 0.2, radius: 12, x: 0, y: 6 } } })
    const tokens = files.find(f => f.id === 'Sources/DesignSystem/Tokens.swift')!.text
    expect(tokens).toContain('extension CGFloat {\n    static let space16: CGFloat = 16\n    static let space24: CGFloat = 24\n}')
    expect(tokens).toContain('extension CGFloat {\n    static let radiusMedium: CGFloat = 12\n    static let radiusSmall: CGFloat = 6\n}')
    expect(tokens).toContain('extension Font {\n    static let sectionTitle = Font.system(.headline)\n    static let captionStrong = Font.system(.caption, weight: .semibold)\n}')
    expect(tokens).toContain('extension ShadowToken {\n    static let low = ShadowToken(color: .black.opacity(0.1), radius: 4, x: 0, y: 2)\n    static let high = ShadowToken(color: .black.opacity(0.2), radius: 12, x: 0, y: 6)\n}')
    expect(errors(files)).toEqual([])
  })

  it('refuses names Swift or the preview would misread, and says what would work', () => {
    const files = project('Text("A")')
    const text = node(files, 'Text')
    const refuse = (name: string, style: 'color' | 'spacing' | 'radius' | 'font', value: string) => { const result = plan(files, text, { kind: 'style-create', name, style, value }); expect(result.ok).toBe(false); return result.ok ? '' : result.reason }
    expect(refuse('primary', 'color', '#000000')).toContain('textPrimary')
    expect(refuse('gap', 'spacing', '8')).toContain('spaceGap')
    expect(refuse('card', 'radius', '8')).toContain('radiusCard')
    expect(refuse('body', 'font', 'body')).toContain('bodyText')
    expect(refuse('accent', 'color', '#000000')).toContain('already used')
    expect(refuse('small', 'color', '#000000')).toContain('SwiftUI')
  })

  it('refuses a colour Xcode would take for the app’s own accent colour, however it is spelled', () => {
    // Every Xcode app has an AccentColor colour set; a token's set of that name, in any
    // letter case, would be the same folder in the export.
    const files = project('Text("A")')
    const result = plan(files, node(files, 'Text'), { kind: 'style-create', name: 'accentcolor', style: 'color', value: '#FF0000' })
    expect(result.ok ? '' : result.reason).toContain('Xcode')
  })

  it('links a field with dot syntax and refuses a spacing token in a corner field', () => {
    const files = project('Text("A").foregroundStyle(.blue).cornerRadius(4)')
    const text = node(files, 'Text')
    const color = text.styles!.find(p => p.kind === 'color')!, radius = text.styles!.find(p => p.kind === 'radius')!
    expect(planned(files, text, { kind: 'style-link', property: color.property, name: 'accent' }).files[0]!.text).toContain('.foregroundStyle(.accent)')
    expect(planned(files, text, { kind: 'style-link', property: radius.property, name: 'radiusMedium' }).files[0]!.text).toContain('.cornerRadius(.radiusMedium)')
    expect(plan(files, text, { kind: 'style-link', property: radius.property, name: 'space16' })).toMatchObject({ ok: false })
  })

  it('writes Color.name into a ShapeStyle field when a hand-written token has no ShapeStyle twin', () => {
    const tokens = 'import SwiftUI\n\nextension Color {\n    static let ink = Color("ink")\n}\n'
    const files = project('Text("A").foregroundStyle(.blue)', tokens)
    const text = node(files, 'Text', [{ name: 'ink', light: '#111111' }])
    const property = text.styles!.find(p => p.kind === 'color')!
    expect(planned(files, text, { kind: 'style-link', property: property.property, name: 'ink' }, [{ name: 'ink', light: '#111111' }]).files[0]!.text).toContain('.foregroundStyle(Color.ink)')
  })

  it('edits a colour token in the catalog and every other kind in Swift', () => {
    const files = project('Text("A")')
    const text = node(files, 'Text')
    const colour = planned(files, text, { kind: 'style-edit', name: 'textPrimary', value: '#000000', token: { value: '#000000', dark: '#FFFFFF' } })
    expect(colour.result.changes).toEqual([])
    expect(colour.colors).toEqual([{ name: 'accent', light: '#0A84FF' }, { name: 'textPrimary', light: '#000000', dark: '#FFFFFF' }])
    const spacing = planned(files, text, { kind: 'style-edit', name: 'space16', value: '20' })
    expect(spacing.files[1]!.text).toContain('static let space16: CGFloat = 20')
    const font = planned(files, text, { kind: 'style-edit', name: 'sectionTitle', value: 'title3', token: { value: 'title3', font: { style: 'title3', weight: 'bold' } } })
    expect(font.files[1]!.text).toContain('static let sectionTitle = Font.system(.title3, weight: .bold)')
    expect(errors(font.files)).toEqual([])
  })

  it('moves a legacy style into Tokens.swift and rewrites every reference in one step', () => {
    const files: SourceFile[] = [
      { id: 'Sources/App.swift', text: app('VStack { Text("A").foregroundColor(brandColor); Text("B").padding(cardSpacing) }') },
      { id: 'Sources/Styles/brandColor.swift', text: 'import SwiftUI\n\nlet brandColor: Color = Color.blue\n' },
      { id: 'Sources/Styles/cardSpacing.swift', text: 'import SwiftUI\n\nlet cardSpacing: CGFloat = 12\n' },
    ]
    const colour = planned(files, node(files, 'Text', []), { kind: 'style-migrate', name: 'brandColor' }, [])
    expect(colour.files.find(f => f.id === 'Sources/App.swift')!.text).toContain('.foregroundColor(Color.brandColor)')
    expect(colour.result.changes.find(c => c.file === 'Sources/Styles/brandColor.swift')).toMatchObject({ deleted: true })
    expect(colour.colors).toEqual([{ name: 'brandColor', light: '#0088FF' }])
    const spacing = planned(colour.files, node(colour.files, 'Text', colour.colors), { kind: 'style-migrate', name: 'cardSpacing' }, colour.colors)
    expect(spacing.files.find(f => f.id === 'Sources/App.swift')!.text).toContain('.padding(CGFloat.spaceCard)')
    expect(spacing.files.find(f => f.id === 'Sources/DesignSystem/Tokens.swift')!.text).toContain('static let spaceCard: CGFloat = 12')
    expect(errors(spacing.files)).toEqual([])
  })
})

describe('tokens end to end', () => {
  it('previews, commits and exports what the writers produce', () => {
    const files = project('Text("A").foregroundStyle(.blue)', null)
    const text = node(files, 'Text', [])
    const created = planned(files, text, { kind: 'style-create-link', property: text.styles!.find(p => p.kind === 'color')!.property, name: 'brand', style: 'color', value: '#FF0000', token: { value: '#FF0000', dark: '#00FF00' } }, [])
    const light = compile({ files: created.files, colors: created.colors, canvas: { width: 393, height: 852 }, colorScheme: 'light', revision: 1 })
    const dark = compile({ files: created.files, colors: created.colors, canvas: { width: 393, height: 852 }, colorScheme: 'dark', revision: 2 })
    const color = (r: ReturnType<typeof compile>) => r.renderTree?.nodes.find(n => n.text)?.text?.runs[0]?.color
    expect(color(light)).toMatchObject({ r: 255, g: 0, b: 0 })
    expect(color(dark)).toMatchObject({ r: 0, g: 255, b: 0 })

    const base = { ...projectFromFiles(files.map(f => ({ name: f.id.replace(/^Sources\//, ''), text: f.text })))!, id: 'p' }
    const committed = applyProjectTransaction(base, 0, { projectId: 'p', baseRevision: 0, changes: created.result.changes.map(c => c.file === 'Sources/App.swift' ? { ...c, before: base.files[0]!.text } : c), colors: { before: undefined, after: created.colors } })
    expect(committed.ok).toBe(true)
    const catalog = assetCatalog(committed.ok ? committed.project : base, 'App/Assets.xcassets')
    expect(new TextDecoder().decode(catalog.get('App/Assets.xcassets/brand.colorset/Contents.json'))).toContain('"appearance": "luminosity"')
  })
})

describe('colour tokens that alias system colours', () => {
  it('keeps a system colour adaptive, and converts to and from a custom light/dark pair', () => {
    const files = project('Text("A").foregroundStyle(.blue)', null)
    const created = planned(files, node(files, 'Text', []), { kind: 'style-create', name: 'textMuted', style: 'color', value: 'secondary' }, [])
    const tokens = () => created.files.find(f => f.id === 'Sources/DesignSystem/Tokens.swift')!.text
    expect(tokens()).toContain('static let textMuted = Color.secondary')
    expect(tokens()).toContain('static var textMuted: Color { Color.secondary }')
    expect(created.colors).toEqual([])
    const custom = planned(created.files, node(created.files, 'Text', []), { kind: 'style-edit', name: 'textMuted', value: '#6B7280', token: { value: '#6B7280', dark: '#9CA3AF' } }, [])
    const text = custom.files.find(f => f.id === 'Sources/DesignSystem/Tokens.swift')!.text
    expect(text).toContain('static let textMuted = Color("textMuted")')
    expect(text).toContain('static var textMuted: Color { Color("textMuted") }')
    expect(custom.colors).toEqual([{ name: 'textMuted', light: '#6B7280', dark: '#9CA3AF' }])
    const back = planned(custom.files, node(custom.files, 'Text', custom.colors), { kind: 'style-edit', name: 'textMuted', value: 'secondary' }, custom.colors)
    expect(back.files.find(f => f.id === 'Sources/DesignSystem/Tokens.swift')!.text).toBe(tokens())
    expect(back.colors).toEqual([])
    expect(errors(back.files)).toEqual([])
  })
})
