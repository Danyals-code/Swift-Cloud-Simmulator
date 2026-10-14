import { beforeEach, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import type { CompileResult, Fill, RenderNode } from '@studio/shared'

/**
 * Colours, paints and shape styles the preview drew clear, black or not at
 * all. Each app is compiled the way the canvas compiles it and the render tree is
 * read back, so a test fails for the reason a designer would see.
 */

beforeEach(resetPipelineState)

const options = { canvas: { width: 393, height: 852 }, colorScheme: 'light' as const, safeArea: { top: 0, bottom: 0, leading: 0, trailing: 0 } }
const app = (body: string, extra = '') =>
  `import SwiftUI\n@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { var body: some View { ${body} } }\n${extra}`

function run(text: string, scheme: 'light' | 'dark' = 'light'): CompileResult {
  const result = compile({ ...options, colorScheme: scheme, files: [{ id: 'App.swift', text }], revision: 1 })
  expect(result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([])
  expect(result.renderTree?.nodes.some((n) => n.kind === 'placeholder')).toBe(false)
  return result
}
const nodes = (text: string, scheme?: 'light' | 'dark'): readonly RenderNode[] => run(text, scheme).renderTree!.nodes
const shapeFill = (text: string): Fill | undefined => nodes(text).find((n) => n.shape?.fill)?.shape?.fill
const solid = (r: number, g: number, b: number, a = 1): Fill => ({ kind: 'solid', color: { r, g, b, a } })

// ---------------------------------------------------------------- Color initialisers

it('runs a project Color(hex:) initialiser that takes an Int', () => {
  const text = app('Rectangle().fill(Color(hex: 0xFF8000))', `extension Color {
    init(hex: Int, opacity: Double = 1) {
        print("hex init ran")
        self.init(.sRGB, red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255, opacity: opacity)
    }
}`)
  const result = run(text)
  expect(result.logs.map((l) => l.message)).toContain('hex init ran')
  expect(result.renderTree!.nodes.find((n) => n.shape?.fill)?.shape?.fill).toEqual(solid(255, 128, 0))
})

it('delegates self.init in a struct extension initialiser to the memberwise one', () => {
  const text = app('Text(Point(both: 3).describe)', `struct Point { var x: Int; var y: Int; var describe: String { "\\(x),\\(y)" } }
extension Point { init(both: Int) { self.init(x: both, y: both) } }`)
  expect(nodes(text).flatMap((n) => n.text?.runs.map((r) => r.text) ?? [])).toEqual(['3,3'])
})

it('keeps the framework initialisers for calls an extension init does not take', () => {
  const text = app('VStack { Rectangle().fill(Color(.systemRed)); Rectangle().fill(Color(red: 0, green: 1, blue: 0)) }', `extension Color {
    init(_ hex: String) { self.init(red: 1, green: 1, blue: 1) }
}`)
  const fills = nodes(text).flatMap((n) => (n.shape?.fill ? [n.shape.fill] : []))
  expect(fills).toEqual([solid(255, 56, 60), solid(0, 255, 0)])
})

it('runs a hex String initialiser that parses with Int(_:radix:)', () => {
  const text = app('Rectangle().fill(Color(hex: "#FF8000"))', `extension Color {
    init(hex: String) {
        let cleaned = hex.replacingOccurrences(of: "#", with: "")
        let value = Int(cleaned, radix: 16) ?? 0
        self.init(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }
}`)
  expect(shapeFill(text)).toEqual(solid(255, 128, 0))
})

it('runs extension initialisers reached through Color.init, a static token and UIColor', () => {
  const text = app('VStack { Rectangle().fill(Color.init(hex: 0x00FF00)); Rectangle().fill(.brand); Rectangle().fill(Color(uiColor: UIColor(hex: 0x0000FF))) }', `extension Color {
    init(hex: Int) { self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255) }
    static let brand = Color(hex: 0xFF0000)
}
extension UIColor {
    convenience init(hex: Int) { self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1) }
}`)
  const fills = nodes(text).flatMap((n) => (n.shape?.fill ? [n.shape.fill] : []))
  expect(fills).toEqual([solid(0, 255, 0), solid(255, 0, 0), solid(0, 0, 255)])
})

it.each([
  ['scanHexInt64', `var cleaned = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        cleaned = cleaned.replacingOccurrences(of: "#", with: "")
        var rgb: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&rgb)`],
  ['scanUInt64(representation:)', `let scanner = Scanner(string: hex)
        _ = scanner.scanString("#")
        let rgb = scanner.scanUInt64(representation: .hexadecimal) ?? 0`],
])('runs a hex String initialiser that reads its digits with Scanner.%s', (_, scan) => {
  const text = app('Rectangle().fill(Color(hex: "#FF8000"))', `extension Color {
    init(hex: String) {
        ${scan}
        self.init(red: Double((rgb & 0xFF0000) >> 16) / 255.0, green: Double((rgb & 0x00FF00) >> 8) / 255.0, blue: Double(rgb & 0x0000FF) / 255.0)
    }
}`)
  expect(shapeFill(text)).toEqual(solid(255, 128, 0))
})

it('scans as Foundation does: no digits leaves the value and answers false', () => {
  const text = app('Text(scanned("#FF8000"))', `func scanned(_ hex: String) -> String {
    var rgb: UInt64 = 7
    let found = Scanner(string: hex).scanHexInt64(&rgb)
    return "\\(found) \\(rgb)"
}`)
  const result = run(text)
  expect(result.diagnostics.filter((d) => d.message.includes('Scanner'))).toEqual([])
  expect(result.renderTree!.nodes.flatMap((n) => n.text?.runs.map((r) => r.text) ?? [])).toEqual(['false 7'])
})

it('runs the common hex initialiser that trims with CharacterSet.alphanumerics.inverted and switches on the length', () => {
  const text = app('VStack { Rectangle().fill(Color(hex: "#FF8000")); Rectangle().fill(Color(hex: " 80FF8000 ")) }', `extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        var a: UInt64 = 0
        var r: UInt64 = 0
        var g: UInt64 = 0
        var b: UInt64 = 0
        switch hex.count {
        case 3:
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (1, 1, 1, 0)
        }
        self.init(.sRGB, red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255, opacity: Double(a) / 255)
    }
}`)
  const fills = nodes(text).flatMap((n) => (n.shape?.fill ? [n.shape.fill] : []))
  expect(fills).toEqual([solid(255, 128, 0), { kind: 'solid', color: { r: 255, g: 128, b: 0, a: expect.closeTo(128 / 255, 3) } }])
})

it('trims with the character sets Foundation names, and with one of given characters', () => {
  const text = app('Text(trimmed)', '').replace('struct ContentView: View {', `struct ContentView: View {
    let trimmed = "[" + "  #ab1!? ".trimmingCharacters(in: .whitespaces) + "|" + "#ab1!".trimmingCharacters(in: CharacterSet(charactersIn: "#!")) + "|" + "12ab34".trimmingCharacters(in: .decimalDigits) + "]"`)
  expect(nodes(text).flatMap((n) => n.text?.runs.map((r) => r.text) ?? [])).toEqual(['[#ab1!?|ab1|ab]'])
})

it('gives a let declared without a value its value later, as a tuple', () => {
  const text = app('Text(pair(true))', 'func pair(_ first: Bool) -> String { let x: Int; let y: Int; (x, y) = first ? (1, 2) : (3, 4); return "\\(x) \\(y)" }')
  expect(nodes(text).flatMap((n) => n.text?.runs.map((r) => r.text) ?? [])).toEqual(['1 2'])
})

// ---------------------------------------------------------------- gradient strokes

const html = (text: string) => renderToStaticMarkup(createElement(RenderTreeView, { tree: run(text).renderTree!, onEvent: () => {} }))
const strokeOf = (text: string) => nodes(text).find((n) => n.shape?.stroke ?? n.path?.stroke)
const red = { r: 255, g: 56, b: 60, a: 1 }
const blue = { r: 0, g: 136, b: 255, a: 1 }

it('paints a LinearGradient stroke with the gradient, in the tree and the DOM', () => {
  const text = app('Circle().stroke(LinearGradient(colors: [.red, .blue], startPoint: .top, endPoint: .bottom), lineWidth: 4).frame(width: 100, height: 100)')
  const stroke = strokeOf(text)!.shape!.stroke!
  expect(stroke).toMatchObject({ width: 4, fill: { kind: 'linearGradient', start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 }, stops: [{ color: red, location: 0 }, { color: blue, location: 1 }] } })
  expect(stroke.usesForeground).toBeFalsy()
  const markup = html(text)
  expect(markup).toMatch(/<linearGradient id="([^"]+)-stroke"/)
  expect(markup).toMatch(/stroke="url\(#[^"]+-stroke\)"/)
})

it('paints an AngularGradient strokeBorder through a mask of the outline', () => {
  const text = app('Circle().strokeBorder(AngularGradient(colors: [.red, .blue], center: .center), lineWidth: 6).frame(width: 100, height: 100)')
  expect(strokeOf(text)!.shape!.stroke).toMatchObject({ width: 6, placement: 'inside', fill: { kind: 'angularGradient', stops: [{ color: red }, { color: blue }] } })
  const markup = html(text)
  expect(markup).toMatch(/<mask id="[^"]+-stroke"/)
  expect(markup).toContain('conic-gradient(')
})

it('paints Color.gradient and RadialGradient strokes, and a stroked Path', () => {
  const capsule = strokeOf(app('Capsule().stroke(.red.gradient, lineWidth: 4).frame(width: 100, height: 40)'))!.shape!.stroke!
  expect(capsule.fill).toMatchObject({ kind: 'linearGradient', stops: [{ color: red }, {}] })
  const radial = app('RoundedRectangle(cornerRadius: 12).stroke(RadialGradient(colors: [.red, .blue], center: .center, startRadius: 0, endRadius: 50), lineWidth: 3).frame(width: 100, height: 100)')
  expect(strokeOf(radial)!.shape!.stroke!.fill).toMatchObject({ kind: 'radialGradient', endRadius: 50 })
  expect(html(radial)).toMatch(/<radialGradient id="[^"]+-stroke"/)
  const path = app('Path { p in p.move(to: .zero); p.addLine(to: CGPoint(x: 100, y: 100)) }.stroke(LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing), lineWidth: 2)')
  expect(strokeOf(path)!.path!.stroke).toMatchObject({ width: 2, fill: { kind: 'linearGradient', start: { x: 0, y: 0.5 } } })
})

it('fills and strokes Canvas drawings with .color and .linearGradient shading', () => {
  const text = app(`Canvas { context, size in
    context.fill(Path(CGRect(x: 0, y: 0, width: 50, height: 50)), with: .color(.red))
    context.fill(Path(ellipseIn: CGRect(x: 50, y: 0, width: 50, height: 50)), with: .linearGradient(Gradient(colors: [.red, .blue]), startPoint: .zero, endPoint: CGPoint(x: size.width, y: 0)))
    context.stroke(Path(CGRect(x: 0, y: 0, width: 100, height: 50)), with: .color(Color.blue), lineWidth: 2)
}.frame(width: 100, height: 50)`)
  const paths = nodes(text).filter((n) => n.path).map((n) => n.path!)
  expect(paths[0]!.fill).toEqual({ kind: 'solid', color: red })
  expect(paths[1]!.fill).toMatchObject({ kind: 'linearGradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, stops: [{ color: red }, { color: blue }] })
  expect(paths[2]!.stroke).toMatchObject({ color: blue, width: 2 })
})

it('resolves the static-member gradient spellings as ShapeStyles', () => {
  const textFill = nodes(app('Text("Hi").foregroundStyle(.linearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing))')).find((n) => n.text)!.text!.runs[0]!.foregroundFill
  expect(textFill).toMatchObject({ kind: 'linearGradient', start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 }, stops: [{ color: red }, { color: blue }] })
  expect(shapeFill(app('Rectangle().fill(.linearGradient(Gradient(colors: [.red, .blue]), startPoint: .top, endPoint: .bottom))'))).toMatchObject({ kind: 'linearGradient', start: { x: 0.5, y: 0 }, stops: [{ color: red }, { color: blue }] })
  expect(shapeFill(app('Circle().fill(.radialGradient(colors: [.red, .blue], center: .center, startRadius: 5, endRadius: 40))'))).toMatchObject({ kind: 'radialGradient', startRadius: 5, endRadius: 40 })
  expect(shapeFill(app('Circle().fill(.angularGradient(colors: [.red, .blue], center: .center, startAngle: .degrees(0), endAngle: .degrees(180)))'))).toMatchObject({ kind: 'angularGradient', startAngle: 0, endAngle: 180 })
  expect(shapeFill(app('Circle().fill(.conicGradient(colors: [.red, .blue], center: .center))'))).toMatchObject({ kind: 'angularGradient', stops: [{ color: red }, { color: blue }] })
  expect(strokeOf(app('Circle().stroke(.linearGradient(colors: [.red, .blue], startPoint: .top, endPoint: .bottom), lineWidth: 3)'))!.shape!.stroke!.fill).toMatchObject({ kind: 'linearGradient' })
})

it('mixes colours with Color.mix(with:by:)', () => {
  const fills = nodes(app('VStack { Rectangle().fill(Color.red.mix(with: .blue, by: 0)); Rectangle().fill(.red.mix(with: Color.blue, by: 1)); Rectangle().fill(Color.red.mix(with: .blue, by: 0.5)); Rectangle().fill(Color.red.mix(with: .blue, by: 0.5).opacity(0.5)) }')).flatMap((n) => (n.shape?.fill ? [n.shape.fill] : []))
  expect(fills[0]).toEqual({ kind: 'solid', color: red })
  expect(fills[1]).toEqual({ kind: 'solid', color: blue })
  const half = (fills[2] as { color: { r: number; g: number; b: number; a: number } }).color
  // Between the two in every channel, and so neither of them nor the black a lost colour drew.
  expect(half.r).toBeGreaterThan(blue.r); expect(half.r).toBeLessThan(red.r)
  expect(half.b).toBeGreaterThan(red.b); expect(half.b).toBeLessThan(blue.b)
  expect(half.a).toBe(1)
  expect(fills[3]).toEqual({ kind: 'solid', color: { ...half, a: 0.5 } })
})

it('strokes with a gradient foreground style when the stroke names no paint', () => {
  const stroke = strokeOf(app('Circle().stroke(lineWidth: 8).foregroundStyle(LinearGradient(colors: [.red, .blue], startPoint: .top, endPoint: .bottom)).frame(width: 80, height: 80)'))!.shape!.stroke!
  expect(stroke).toMatchObject({ width: 8, color: red, fill: { kind: 'linearGradient', stops: [{ color: red }, { color: blue }] } })
  const plain = strokeOf(app('Circle().stroke(lineWidth: 8).foregroundStyle(.red).frame(width: 80, height: 80)'))!.shape!.stroke!
  expect(plain.color).toEqual(red)
  expect(plain.fill).toBeUndefined()
})

it('draws a border painted with a gradient', () => {
  const text = app('Text("Hi").padding().border(LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing), width: 2)')
  const border = nodes(text).find((n) => n.border)?.border
  expect(border).toMatchObject({ width: 2, color: red, fill: { kind: 'linearGradient', stops: [{ color: red }, { color: blue }] } })
  expect(html(text)).toContain('border-image:linear-gradient(')
})

// ---------------------------------------------------------------- styles that trapped

it('draws the system background and fill styles at their hierarchical levels', () => {
  const backgrounds = (text: string, scheme?: 'light' | 'dark') => nodes(text, scheme).flatMap((n) => (n.background ? [n.background] : []))
  // The screen's own background comes first; the view's is the last.
  expect(backgrounds(app('Text("Hi").padding().background(.background.secondary)')).at(-1)).toEqual(solid(242, 242, 247))
  expect(backgrounds(app('Text("Hi").padding().background(.background.secondary)'), 'dark').at(-1)).toEqual(solid(28, 28, 30))
  expect(shapeFill(app('Rectangle().fill(.fill)'))).toEqual(solid(120, 120, 128, 0.2))
  expect(shapeFill(app('Rectangle().fill(.fill.secondary)'))).toEqual(solid(120, 120, 128, 0.16))
  expect(shapeFill(app('Rectangle().fill(.tertiary)'))).toEqual(solid(60, 60, 67, 0.3))
  const text = nodes(app('VStack { Text("A").foregroundStyle(.fill.tertiary); Text("B").foregroundStyle(.foreground.secondary) }')).filter((n) => n.text).map((n) => n.text!.runs[0]!.color)
  expect(text).toEqual([{ r: 118, g: 118, b: 128, a: 0.12 }, { r: 60, g: 60, b: 67, a: 0.6 }])
})

it('casts the drop shadow a ShapeStyle carries, from a fill, a foreground style and a background', () => {
  const dropShadow = { radius: 4, x: 0, y: 0, color: { r: 0, g: 0, b: 0, a: 0.33 } }
  const circle = nodes(app('Circle().fill(.blue.shadow(.drop(radius: 4))).frame(width: 50, height: 50)'))
  expect(circle.find((n) => n.shape)?.shape?.fill).toEqual({ kind: 'solid', color: blue })
  expect(circle.find((n) => n.shadow)?.shadow).toMatchObject(dropShadow)
  const text = nodes(app('Text("Hi").foregroundStyle(.red.shadow(.drop(color: .black, radius: 2, x: 0, y: 1)))'))
  expect(text.find((n) => n.text)?.text?.runs[0]?.color).toEqual(red)
  expect(text.find((n) => n.shadow)?.shadow).toMatchObject({ radius: 2, x: 0, y: 1, color: { r: 0, g: 0, b: 0, a: 1 } })
  const card = nodes(app('Text("Card").padding().background(Color.white.shadow(.drop(radius: 8, y: 2)), in: RoundedRectangle(cornerRadius: 12))'))
  expect(card.find((n) => n.shadow)?.shadow).toMatchObject({ radius: 8, x: 0, y: 2 })
  expect(card.some((n) => n.background && 'color' in n.background && n.background.color.r === 255 && n.background.color.a === 1 && n.shadow === undefined)).toBe(true)
})

it('draws an inner shadow inside a filled shape', () => {
  const text = app('RoundedRectangle(cornerRadius: 12).fill(Color.blue.shadow(.inner(color: .black, radius: 4, x: 2, y: 2))).frame(width: 100, height: 60)')
  const shape = nodes(text).find((n) => n.shape)!.shape!
  expect(shape.fill).toEqual({ kind: 'solid', color: blue, innerShadow: { color: { r: 0, g: 0, b: 0, a: 1 }, radius: 4, x: 2, y: 2 } })
  expect(html(text)).toMatch(/<filter id="[^"]+-inner"/)
  const background = app('Text("Well").padding().background(Color.gray.shadow(.inner(radius: 3)))')
  expect(html(background)).toContain('box-shadow:inset 0px 0px 3px rgb(0 0 0 / 0.33)')
})

it.each([
  'Text("Hi").padding().glassEffect(.regular.tint(.blue).interactive())',
  'Text("Hi").padding().glassEffect(Glass.regular.tint(.blue))',
  'Text("Hi").padding().glassEffect(.clear.interactive(), in: .capsule)',
])('draws the view and its Liquid Glass for %s, with nothing to warn of', (body) => {
  const result = run(app(body))
  expect(result.renderTree!.nodes.flatMap((n) => n.text?.runs.map((r) => r.text) ?? [])).toEqual(['Hi'])
  expect(result.diagnostics.filter((d) => d.severity === 'warning' && d.message.includes('.glassEffect'))).toEqual([])
})

it('draws AnyShapeStyle as the style it wraps, and a Gradient as a top-to-bottom ShapeStyle', () => {
  expect(shapeFill(app('Rectangle().fill(AnyShapeStyle(Color.red))'))).toEqual({ kind: 'solid', color: red })
  const texts = nodes(app('VStack { Text("A").foregroundStyle(true ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary)); Text("B").foregroundStyle(AnyShapeStyle(LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing))) }')).filter((n) => n.text).map((n) => n.text!.runs[0]!)
  expect(texts[0]!.color).toEqual(blue)
  expect(texts[1]!.foregroundFill).toMatchObject({ kind: 'linearGradient', start: { x: 0, y: 0.5 } })
  expect(shapeFill(app('Rectangle().fill(Gradient(colors: [.red, .blue]))'))).toMatchObject({ kind: 'linearGradient', start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 }, stops: [{ color: red }, { color: blue }] })
})

it('fills a shape with a material as a material panel cut to the shape, not black', () => {
  const drawn = nodes(app('RoundedRectangle(cornerRadius: 8).fill(.ultraThinMaterial).frame(width: 100, height: 50)'))
  expect(drawn.some((n) => n.shape?.fill?.kind === 'solid' && n.shape.fill.color.a === 1 && n.shape.fill.color.r === 0)).toBe(false)
  expect(drawn.some((n) => n.material)).toBe(true)
})

// The hex initialiser most projects copy, verbatim: several names on one `let`, each
// assigned once from a tuple in a switch.
it('runs the common Color(hex: String) initialiser exactly as it is usually written', () => {
  const text = app('Rectangle().fill(Color(hex: "#FF8000"))', `extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (1, 1, 1, 0)
        }
        self.init(.sRGB, red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255, opacity: Double(a) / 255)
    }
}`)
  const result = run(text)
  expect(result.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message)).toEqual([])
  expect(result.renderTree!.nodes.find((n) => n.shape?.fill)?.shape?.fill).toEqual(solid(255, 128, 0))
})

it('reads the fixed-width integers as Int', () => {
  const text = app('Text("\\(UInt64("ff", radix: 16) ?? 0) \\(Int32(7) + 1) \\(UInt8(200))")')
  const result = run(text)
  expect(result.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message)).toEqual([])
  expect(result.renderTree!.nodes.flatMap((n) => n.text?.runs.map((r) => r.text) ?? [])).toContain('255 8 200')
})

// The adaptive colour most projects write by hand before an asset catalog: UIKit asks
// the closure once per appearance.
it.each([
  ['a ternary', 'traits.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light)'],
  ['a switch', 'switch traits.userInterfaceStyle { case .dark: return UIColor(dark); default: return UIColor(light) }'],
])('runs a Color(light:dark:) initialiser through UIColor { traits in } written with %s', (_, provider) => {
  const text = app('Rectangle().fill(Color(light: .white, dark: .black))', `extension Color {
    init(light: Color, dark: Color) {
        self.init(UIColor { traits in
            ${provider}
        })
    }
}`)
  for (const [scheme, fill] of [['light', solid(255, 255, 255)], ['dark', solid(0, 0, 0)]] as const) {
    const result = run(text, scheme)
    expect(result.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message)).toEqual([])
    expect(result.renderTree!.nodes.find((n) => n.shape?.fill)?.shape?.fill).toEqual(fill)
  }
})

it('reads UIColor(named:) as the asset catalog colour, and nil where the catalog has none', () => {
  const text = app('Rectangle().fill(Color(uiColor: UIColor(named: "Missing") ?? .red))')
  expect(nodes(text).find((n) => n.shape?.fill)?.shape?.fill).toEqual(solid(255, 0, 0))
})
