import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { deflateSync, inflateSync } from 'fflate'
import { DEFAULT_PREVIEW_TARGET, SYMBOL_MAP, symbolDefinition, type CompileResult } from '@studio/shared'
import { compile, resetPipelineState, applyEvent, rerender } from '@studio/swiftui-runtime'
import { decodeProject, encodeProject, MemoryProjectStore, projectFromFiles } from '@studio/project-model'
import { symbolAsset, RenderTreeView } from '@studio/swiftui-render-dom'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

beforeEach(resetPipelineState)

function run(body: string, extra = '', scheme: 'light' | 'dark' = 'light') {
  const text = `import SwiftUI
@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
  @State var on = true
  @State var text = "Hello"
  @State var amount = 0.5
  @State var show = false
  var body: some View { ${body} }
}
${extra}`
  const result = compile({ files: [{ id: 'App.swift', text }], colorScheme: scheme, canvas: { width: 393, height: 852 }, previewTarget: DEFAULT_PREVIEW_TARGET, revision: 1 })
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  expect(result.renderTree).not.toBeNull()
  return result
}
const nodes = (result: CompileResult) => result.renderTree!.nodes
const textNode = (result: CompileResult, text: string) => nodes(result).find((n) => n.text?.runs.some((r) => r.text === text))!
const color = (result: CompileResult, text: string) => textNode(result, text).text!.runs[0]!.color
const purple = { r: 203, g: 48, b: 224, a: 1 }
const red = { r: 255, g: 56, b: 60, a: 1 }
function tap(result: CompileResult, label: string) {
  const hit = nodes(result).find((n) => n.hitTarget && n.a11y?.label === label)!.hitTarget!
  expect(applyEvent({ kind: 'tap', handlerId: hit.handlerId, location: { x: 0, y: 0 } })).toBe(true)
  return rerender(2)
}

describe('iOS 27 target persistence', () => {
  const project = () => projectFromFiles([{ name: 'App.swift', text: 'import SwiftUI\nstruct A: View { var body: some View { Text("Hello") } }' }])!
  it('uses iOS 27 without changing the exported deployment target or source', async () => {
    const original = project()
    const store = new MemoryProjectStore()
    await store.save(original)
    const loaded = (await store.load(original.id))!
    const decoded = decodeProject(encodeProject(loaded)!, 0)!
    expect(decoded.manifest.previewTarget).toEqual(DEFAULT_PREVIEW_TARGET)
    expect(decoded.manifest.deploymentTarget).toBe('17.0')
    expect(decoded.files).toEqual(original.files)
  })
  it('migrates old stored projects without modifying their source', async () => {
    const original = project()
    const legacy = { ...original, manifest: { ...original.manifest, previewTarget: undefined } }
    const store = new MemoryProjectStore()
    await store.save(legacy)
    expect((await store.load(legacy.id))?.manifest.previewTarget).toEqual(DEFAULT_PREVIEW_TARGET)
    expect((await store.load(legacy.id))?.files).toEqual(original.files)
  })
  it('accepts old links and rejects unsupported target values in new links', () => {
    const encoded = encodeProject(project())!
    const payload = JSON.parse(new TextDecoder().decode(inflateSync(Buffer.from(encoded, 'base64url'))))
    const encode = () => Buffer.from(deflateSync(new TextEncoder().encode(JSON.stringify(payload)))).toString('base64url')
    delete payload.p
    expect(decodeProject(encode(), 0)?.manifest.previewTarget).toEqual(DEFAULT_PREVIEW_TARGET)
    payload.p = { runtime: 'ios-999', sdk: 'ios-27', appearance: 'ios-27' }
    expect(decodeProject(encode(), 0)).toBeNull()
  })
})

describe('inherited visual environment', () => {
  it('tints buttons without tinting unrelated body text', () => {
    const result = run('VStack { Text("Body"); Button("Continue") {} }.tint(.purple)')
    expect(color(result, 'Body')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    expect(color(result, 'Continue')).toEqual(purple)
  })
  it('inherits through custom views, Groups, and nested overrides without leaking to siblings', () => {
    const result = run('VStack { Child(); Group { Button("Inner") {} }.tint(.red); Button("Sibling") {} }.tint(.purple)', 'struct Child: View { var body: some View { Button("Child") {} } }')
    expect(color(result, 'Child')).toEqual(purple)
    expect(color(result, 'Inner')).toEqual(red)
    expect(color(result, 'Sibling')).toEqual(purple)
  })
  it('preserves modifier order, with the nearest tint winning', () => {
    expect(color(run('Button("Order") {}.tint(.red).tint(.purple)'), 'Order')).toEqual(red)
  })
  it('resolves tint as an explicit foreground style including opacity', () => {
    const result = run('VStack { Text("Tint").foregroundStyle(.tint.opacity(0.5)); Text("Plain") }.tint(.purple)')
    expect(color(result, 'Tint')).toEqual({ ...purple, a: 0.5 })
    expect(color(result, 'Plain').r).toBe(0)
  })
  it('keeps destructive roles red and child foreground overrides intact', () => {
    const result = run('VStack { Button("Delete", role: .destructive) {}; Button { } label: { Text("Custom").foregroundStyle(.green) } }.tint(.purple)')
    expect(color(result, 'Delete')).toEqual(red)
    expect(color(result, 'Custom')).toEqual({ r: 52, g: 199, b: 89, a: 1 })
  })
  it('makes parent and direct bordered styles identical', () => {
    const parent = run('VStack { Button("Go") {} }.buttonStyle(.borderedProminent).tint(.purple)')
    const direct = run('VStack { Button("Go") {}.buttonStyle(.borderedProminent).tint(.purple) }')
    const shape = (r: CompileResult) => nodes(r).filter((n) => n.background && n.id !== 'screen').map((n) => ({ fill: n.background, radius: n.cornerRadius, size: [n.frame.width, n.frame.height] }))
    expect(shape(parent)).toHaveLength(1)
    expect(shape(parent)).toEqual(shape(direct))
    expect(color(parent, 'Go')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
  })
  it('allows a child to reset an inherited button or text field style', () => {
    const result = run('VStack { Button("Plain") {}.buttonStyle(.plain); Button("Styled") {}; TextField("Border", text: $text); TextField("Plain field", text: $text).textFieldStyle(.plain) }.buttonStyle(.bordered).textFieldStyle(.roundedBorder).tint(.purple)')
    expect(color(result, 'Plain')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    expect(color(result, 'Styled')).toEqual(purple)
    expect(nodes(result).filter((n) => n.border).length).toBe(1)
  })
  it('applies inherited tint to toggle, slider, progress, and selected tabs', () => {
    const result = run('VStack { Toggle("On", isOn: $on); Slider(value: $amount); ProgressView(value: amount) }.tint(.purple)')
    expect(nodes(result).find((n) => n.hitTarget?.role === 'slider')?.hitTarget?.color).toEqual(purple)
    expect(nodes(result).find((n) => n.shape?.shape === 'capsule')?.shape?.fill).toEqual({ kind: 'solid', color: purple })
    expect(nodes(result).find((n) => n.slider)?.slider?.tint).toEqual(purple)
    expect(nodes(result).some((n) => n.background?.kind === 'solid' && n.background.color.r === purple.r)).toBe(true)
    const tabbed = run('TabView { Text("Page").tabItem { Label("Home", systemImage: "house") } }.tint(.purple)')
    expect(color(tabbed, 'Home')).toEqual(purple)
  })
  it('keeps disabled controls visible and inert, even if a child tries to enable itself', () => {
    const result = run('VStack { Button("Disabled") {}.disabled(false); Slider(value: $amount); TextField("Name", text: $text) }.disabled(true)')
    expect(nodes(result).filter((n) => n.hitTarget).every((n) => !n.hitTarget!.enabled)).toBe(true)
    expect(textNode(result, 'Disabled').opacity).toBeLessThan(1)
    const markup = renderToStaticMarkup(createElement(RenderTreeView, { tree: result.renderTree!, onEvent: () => {} }))
    expect(markup).toContain('type="range"')
    expect(markup.match(/disabled=""/g)?.length).toBe(2)
  })
  it('preserves tint in toolbars and pushed destinations', () => {
    const result = run('NavigationStack { VStack { NavigationLink("Open") { Button("Detail") {} } }.navigationTitle("Home").toolbar { Button("Tool") {} } }.tint(.purple)')
    expect(color(result, 'Tool')).toEqual(purple)
    expect(nodes(result).some((n) => n.material?.blur === 12)).toBe(true)
    const detail = tap(result, 'Open')
    expect(color(detail, 'Detail')).toEqual(purple)
  })
  it('preserves inherited styles in a deferred sheet', () => {
    const result = run('VStack { Button("Present") { show = true } }.sheet(isPresented: $show) { Button("Sheet button") {} }.tint(.purple)')
    expect(color(tap(result, 'Present'), 'Sheet button')).toEqual(purple)
  })
  it('adapts semantic colors in dark mode while preserving explicit RGB colors', () => {
    const result = run('VStack { Text("Body"); Button("Tint") {}; Text("RGB").foregroundStyle(Color(red: 0.2, green: 0.4, blue: 0.6)) }.tint(.purple)', '', 'dark')
    expect(color(result, 'Body')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(color(result, 'Tint')).toEqual({ r: 191, g: 90, b: 242, a: 1 })
    expect(color(result, 'RGB')).toEqual({ r: 51, g: 102, b: 153, a: 1 })
  })
  it('uses distinct lightweight blur presets and supports both glass button styles', () => {
    const result = run('VStack { Text("Thin").padding().background(.thinMaterial); Text("Thick").padding().background(.thickMaterial); Button("Glass") {}.buttonStyle(.glass); Button("Prominent") {}.buttonStyle(.glassProminent) }')
    const blurs = nodes(result).flatMap((n) => n.material ? [n.material.blur] : [])
    expect(blurs).toContain(12)
    expect(blurs).toContain(28)
    expect(blurs.length).toBe(4)
    expect(result.diagnostics.filter((d) => d.severity === 'warning')).toEqual([])
  })
})

describe('environment values before custom view evaluation', () => {
  const reader = String.raw`struct Reader: View {
    @Environment(\.isEnabled) var enabled
    @Environment(\.controlSize) var size
    @Environment(\.colorScheme) var scheme
    var body: some View {
      VStack { Text(enabled ? "Enabled body" : "Disabled body"); Text(size == .small ? "Small body" : "Regular body"); Text(scheme == .dark ? "Dark body" : "Light body") }
    }
  }`
  it('reaches custom bodies already nested inside a container', () => {
    const result = run(String.raw`VStack { Reader().disabled(false) }.disabled(true).controlSize(.small).environment(\.colorScheme, .dark)`, reader)
    expect(textNode(result, 'Disabled body')).toBeDefined()
    expect(textNode(result, 'Small body')).toBeDefined()
    expect(textNode(result, 'Dark body')).toBeDefined()
  })
  it('resolves semantic paint colors in a nested dark environment', () => {
    const result = run(String.raw`VStack { VStack { Text("Dark label"); Button("Dark tint") {} }.tint(.purple).environment(\.colorScheme, .dark); Text("Light label") }`)
    expect(color(result, 'Dark label')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(color(result, 'Dark tint')).toEqual({ r: 191, g: 90, b: 242, a: 1 })
    expect(color(result, 'Light label')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
  })
  it('does not leak a nested environment into siblings', () => {
    const result = run(String.raw`VStack { Reader().environment(\.colorScheme, .dark); Reader() }`, reader)
    expect(textNode(result, 'Dark body')).toBeDefined()
    expect(textNode(result, 'Light body')).toBeDefined()
  })
  it('captures scoped environment values in deferred presentations', () => {
    const result = run(String.raw`VStack { Button("Present") { show = true } }.sheet(isPresented: $show) { Reader() }.controlSize(.small).environment(\.colorScheme, .dark)`, reader)
    const sheet = tap(result, 'Present')
    expect(textNode(sheet, 'Small body')).toBeDefined()
    expect(textNode(sheet, 'Dark body')).toBeDefined()
  })
})

describe('Ionicons adapter', () => {
  it('includes the artwork used by every gallery card', () => {
    const sprite = readFileSync('apps/web/public/ionicons-8.0.13.svg', 'utf8')
    const gallery = readFileSync('apps/web/components/TemplateGallery.tsx', 'utf8')
    const names = [...gallery.matchAll(/\['([a-z][a-z-]+)', '#[\da-f]+'/g)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(20)
    for (const name of [...names, 'code-slash']) expect(sprite, name).toContain(`id="${name}"`)
  })
  it('can paint every mapping known to the worker', () => {
    const sprite = readFileSync('apps/web/public/ionicons-8.0.13.svg', 'utf8')
    for (const [name, definition] of Object.entries(SYMBOL_MAP)) {
      expect(symbolAsset(name), name).not.toBeNull()
      if (!definition.icon.startsWith('#')) expect(sprite, name).toContain(`id="${definition.icon}"`)
    }
  })
  it('preserves meaning in slash, outline, filled, and enclosure variants', () => {
    expect(symbolAsset('eye.slash')).not.toEqual(symbolAsset('eye'))
    expect(symbolAsset('arrow.counterclockwise')).not.toEqual(symbolAsset('arrow.clockwise'))
    expect(symbolAsset('heart.fill')).not.toEqual(symbolAsset('heart'))
    expect(symbolAsset('star.circle.fill')?.body).toContain('mask=')
    expect(symbolDefinition('eye.slash.unknown')).toBeNull()
    expect(symbolAsset('<script>alert(1)</script>')).toBeNull()
  })
  it('measures and paints inherited imageScale from the same metadata', () => {
    const small = run('VStack { Image(systemName: "star") }.imageScale(.small)')
    const large = run('VStack { Image(systemName: "star") }.imageScale(.large)')
    const image = (r: CompileResult) => nodes(r).find((n) => n.image)!
    expect(image(large).frame.width).toBeGreaterThan(image(small).frame.width)
    expect(image(large).image!.symbolScale).toBe(1.3)
    expect(image(small).image!.symbolScale).toBe(0.8)
    const markup = renderToStaticMarkup(createElement(RenderTreeView, { tree: large.renderTree! }))
    expect(markup).toContain('viewBox="0 0 512 512"')
    expect(markup).toContain('preserveAspectRatio="xMidYMid meet"')
    expect(markup).not.toContain('☆')
  })
})

// Shared with the manual Xcode/browser comparison; guard against fixture drift.
it('compiles the native comparison fixture without diagnostics', () => {
  const result = compile({ files: [{ id: 'App.swift', text: readFileSync('tests/fixtures/ios27-appearance.swift', 'utf8') }], canvas: { width: 393, height: 852 }, colorScheme: 'light', revision: 1 })
  expect(result.diagnostics).toEqual([])
  expect(result.renderTree).not.toBeNull()
})
