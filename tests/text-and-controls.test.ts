import { beforeEach, describe, expect, it } from 'vitest'
import type { CompileResult, DynamicTypeSize } from '@studio/shared'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { canvasFont, textMeasureKey } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { RenderTreeView } from '@studio/swiftui-render-dom'

/**
 * Text, fonts and controls the preview used to trap on, draw as something else, or
 * drop without a word. Each case compiles a small app and reads what the canvas draws
 * and what the Problems pane says.
 */

beforeEach(resetPipelineState)

const options = { canvas: { width: 393, height: 852 }, colorScheme: 'light' as const, safeArea: { top: 0, bottom: 0, leading: 0, trailing: 0 } }
const app = (body: string, extra = '', members = '') =>
  `import SwiftUI\n@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { ${members}\nvar body: some View { ${body} } }\n${extra}`
function run(text: string, dynamicTypeSize?: DynamicTypeSize): CompileResult {
  return compile({ ...options, files: [{ id: 'App.swift', text }], revision: 1, ...(dynamicTypeSize ? { dynamicTypeSize } : {}) })
}
const errors = (r: CompileResult) => r.diagnostics.filter(d => d.severity === 'error').map(d => d.message)
const warnings = (r: CompileResult) => r.diagnostics.filter(d => d.severity === 'warning').map(d => d.message)
const runs = (r: CompileResult) => r.renderTree!.nodes.flatMap(n => n.text?.runs ?? [])
const html = (r: CompileResult) => renderToStaticMarkup(createElement(RenderTreeView, { tree: r.renderTree!, onEvent: () => {} }))
/** A colour as it lands on a white screen, which is what a simulator screenshot reads. */
const onWhite = ({ r, g, b, a }: { r: number; g: number; b: number; a: number }) => [r, g, b].map(c => Math.round(c * a + 255 * (1 - a)))
const SECONDARY_ON_WHITE = [138, 138, 142]
const texts = (r: CompileResult) => r.renderTree!.nodes.filter(n => n.text).map(n => n.text!.runs.map(run => run.text).join(''))

describe('Date.FormatStyle chains draw the date as iOS writes it in en_US', () => {
  // 9:41:07 in the morning of Sunday 9 September 2001, in the preview's own time zone.
  const moment = 'let d = Calendar.current.startOfDay(for: Date(timeIntervalSince1970: 1_000_036_800)).addingTimeInterval(9 * 3600 + 41 * 60 + 7)'
  const cases: [string, string][] = [
    ['.dateTime.weekday()', 'Sun'],
    ['.dateTime.weekday(.wide)', 'Sunday'],
    ['.dateTime.weekday(.narrow)', 'S'],
    ['.dateTime.weekday(.short)', 'Su'],
    ['.dateTime.day().month()', 'Sep 9'],
    ['.dateTime.month(.wide).day()', 'September 9'],
    ['.dateTime.month(.narrow)', 'S'],
    ['.dateTime.month(.defaultDigits).day()', '9/9'],
    ['.dateTime.month(.twoDigits).day(.twoDigits)', '09/09'],
    ['.dateTime.year()', '2001'],
    ['.dateTime.month().year()', 'Sep 2001'],
    ['.dateTime.year().month().day()', 'Sep 9, 2001'],
    ['.dateTime.weekday(.wide).day().month(.wide)', 'Sunday, September 9'],
    ['.dateTime.day()', '9'],
    // iOS puts a narrow no-break space before the day period, and joins a date with a
    // month in words to its time with "at".
    ['.dateTime.hour()', '9\u202fAM'],
    ['.dateTime.hour().minute()', '9:41\u202fAM'],
    ['.dateTime.minute().hour()', '9:41\u202fAM'],
    ['.dateTime.hour().minute().second()', '9:41:07\u202fAM'],
    ['.dateTime.hour(.defaultDigits(amPM: .omitted)).minute()', '9:41'],
    ['.dateTime.hour(.twoDigits(amPM: .narrow)).minute()', '09:41\u202fa'],
    ['.dateTime.weekday().hour().minute()', 'Sun 9:41\u202fAM'],
    ['.dateTime.year().month().day().hour().minute()', 'Sep 9, 2001 at 9:41\u202fAM'],
    ['.dateTime.year().month(.wide).day().hour().minute()', 'September 9, 2001 at 9:41\u202fAM'],
    ['.dateTime.era().year()', '2001 AD'],
    ['.dateTime.minute()', '41'],
  ]
  it.each(cases)('d.formatted(%s)', (style, expected) => {
    const r = run(app(`Text(d.formatted(${style}))`, '', moment))
    expect(errors(r)).toEqual([])
    expect(texts(r)[0]).toBe(expected)
  })

  it('draws the same style through Text(_:format:) and an interpolation', () => {
    const r = run(app('VStack { Text(d, format: .dateTime.weekday(.wide).day().month(.wide)); Text("Due \\(d, format: .dateTime.day().month())") }', '', moment))
    expect(errors(r)).toEqual([])
    expect(texts(r)).toEqual(['Sunday, September 9', 'Due Sep 9'])
  })

  it('keeps the screen when a style asks for a field the preview does not write', () => {
    const r = run(app('Text(d.formatted(.dateTime.quarter().day().month()))', '', moment))
    expect(errors(r)).toEqual([])
    expect(texts(r)[0]).toMatch(/^Sep 9/)
  })
})

describe('Font modifiers return a font rather than stopping the screen', () => {
  it.each([
    ['.body.width(.condensed)', 17],
    ['.title.width(.expanded).bold()', 28],
    ['.system(size: 20).width(.compressed)', 20],
  ])('draws %s at its size and says the width is not drawn', (font, size) => {
    const r = run(app(`Text("Hello").font(${font})`))
    expect(errors(r)).toEqual([])
    expect(runs(r)[0]).toMatchObject({ text: 'Hello', font: { size } })
    expect(warnings(r).join('\n')).toMatch(/width/)
  })

  // Line spacing measured in the iOS 27 simulator: each style's own, two points less
  // when tight and two more when loose, but for .subheadline and .footnote, which keep
  // theirs when loose.
  it.each([
    ['.title.leading(.tight)', 28, 32],
    ['.body.leading(.loose)', 17, 24],
    ['.subheadline.leading(.loose)', 15, 20],
    ['.caption2.bold().leading(.tight)', 11, 11],
  ])('spaces lines for %s as iOS does', (font, size, lineHeight) => {
    const r = run(app(`Text("Hello").font(${font})`))
    expect(errors(r)).toEqual([])
    expect(warnings(r)).toEqual([])
    expect(runs(r)[0]!.font).toMatchObject({ size, lineHeight })
  })

  it('draws .smallCaps() as small capitals, measured as it is painted', () => {
    const r = run(app('VStack { Text("Hello").font(.body.smallCaps()); Text("Hello").font(.title.lowercaseSmallCaps().bold()) }'))
    expect(errors(r)).toEqual([])
    expect(warnings(r)).toEqual([])
    const [body, title] = runs(r)
    expect(body!.font).toMatchObject({ size: 17, smallCaps: true })
    expect(title!.font).toMatchObject({ size: 28, weight: 700, smallCaps: true })
    expect(html(r)).toContain('font-variant-caps:small-caps')
    // Measured with the capitals the canvas draws, and never mistaken for the plain face.
    expect(canvasFont(body!.font)).toContain('small-caps')
    expect(textMeasureKey({ text: 'Hello', font: body!.font })).not.toBe(textMeasureKey({ text: 'Hello', font: { ...body!.font, smallCaps: false } }))
  })

  it('keeps small capitals on their half of a Text concatenation', () => {
    const r = run(app('Text("Small").font(.body.smallCaps()) + Text(" plain")'))
    expect(runs(r).map(run => [run.text, run.font.smallCaps === true])).toEqual([['Small', true], [' plain', false]])
  })
})

describe('A custom font says it is drawn in the system face, and scales as iOS scales it', () => {
  it('names the font it cannot draw', () => {
    const r = run(app('Text("Hello").font(.custom("Georgia", size: 20))'))
    expect(errors(r)).toEqual([])
    expect(warnings(r)).toContain("Custom font 'Georgia' is not in this project; the preview draws the system font at the same size.")
    expect(runs(r)[0]!.font).toMatchObject({ size: 20 })
  })

  // `UIFontMetrics` in the iOS 27 simulator: 20 pt relative to .body is 26.33 at
  // xxxLarge and 17.33 at xSmall; relative to .title it is 24 and 40 at accessibility5.
  it.each([
    ['.custom("Georgia", size: 20)', 'large', 20],
    ['.custom("Georgia", size: 20)', 'xxxLarge', 26.333],
    ['.custom("Georgia", size: 20)', 'xSmall', 17.333],
    ['.custom("Georgia", size: 20, relativeTo: .title)', 'xxxLarge', 24],
    ['.custom("Georgia", size: 20, relativeTo: .title)', 'accessibility5', 40],
    ['.custom("Georgia", size: 20, relativeTo: .caption)', 'accessibility5', 63.667],
    ['.custom("Georgia", fixedSize: 20)', 'accessibility5', 20],
    ['Font.custom("Georgia", size: 20).bold()', 'xxxLarge', 26.333],
  ] as [string, DynamicTypeSize, number][])('draws %s at %s at %d pt', (font, category, size) => {
    const r = run(app(`Text("Hello").font(${font})`), category)
    expect(errors(r)).toEqual([])
    expect(runs(r)[0]!.font.size).toBeCloseTo(size, 2)
  })
})

describe('Controls draw what their labels and styles ask for', () => {
  it('writes a string badge without quotes, beside a number badge', () => {
    const r = run(app('List { Text("Inbox").badge("New"); Text("Mail").badge(3) }'))
    expect(errors(r)).toEqual([])
    expect(texts(r)).toEqual(['Inbox', 'New', 'Mail', '3'])
  })

  it('draws the icon a Label is given as a closure, before its title', () => {
    const r = run(app('Label { Text("Title") } icon: { Image(systemName: "star") }'))
    expect(errors(r)).toEqual([])
    const icon = r.renderTree!.nodes.find(n => n.image?.symbol === 'star')
    const title = r.renderTree!.nodes.find(n => n.text?.runs[0]?.text === 'Title')
    expect(icon, 'icon').toBeDefined()
    expect(icon!.frame.x + icon!.frame.width).toBeLessThanOrEqual(title!.frame.x)
  })

  // The iOS 27 simulator: the label above the bar in body text, the current value below
  // it in secondary caption text, each 4 pt from the 4 pt bar.
  it('draws a ProgressView label above its bar and its current value below', () => {
    const r = run(app('ProgressView(value: 0.4) { Text("Loading") } currentValueLabel: { Text("40%") }.padding(20)'))
    expect(errors(r)).toEqual([])
    const node = (text: string) => r.renderTree!.nodes.find(n => n.text?.runs[0]?.text === text)!
    const [label, current] = [node('Loading'), node('40%')]
    expect(label.text!.runs[0]!.font.size).toBe(17)
    expect(current.text!.runs[0]!.font.size).toBe(12)
    expect(onWhite(current.text!.runs[0]!.color)).toEqual(SECONDARY_ON_WHITE)
    expect(label.frame.x).toBe(current.frame.x)
    expect(current.frame.y - (label.frame.y + label.frame.height)).toBeCloseTo(12, 1)
  })

  // The iOS 27 simulator draws the value labels in body text 8 pt either side of the
  // track, centred on it, and the label itself nowhere outside a Form.
  it('draws a Slider between its value labels, and slides only on the track', () => {
    const r = run(app('Slider(value: $v) { Text("Volume") } minimumValueLabel: { Text("0") } maximumValueLabel: { Text("100") }.padding(20)', '', '@State var v = 0.5'))
    expect(errors(r)).toEqual([])
    expect(texts(r)).toEqual(['0', '100'])
    const node = (text: string) => r.renderTree!.nodes.find(n => n.text?.runs[0]?.text === text)!
    const slider = r.renderTree!.nodes.find(n => n.slider)!
    const target = r.renderTree!.nodes.find(n => n.hitTarget)!
    const [min, max] = [node('0'), node('100')]
    expect(min.frame.x).toBe(20)
    expect(slider.frame.x - (min.frame.x + min.frame.width)).toBeCloseTo(8, 1)
    expect(max.frame.x - (slider.frame.x + slider.frame.width)).toBeCloseTo(8, 1)
    expect(max.frame.x + max.frame.width).toBeCloseTo(373, 1)
    expect(min.frame.y + min.frame.height / 2).toBeCloseTo(slider.frame.y + slider.frame.height / 2, 1)
    expect(target.frame).toEqual(slider.frame)
  })

  it('draws an indeterminate ProgressView label under its spinner in secondary text', () => {
    const r = run(app('ProgressView { Text("Loading") }'))
    expect(errors(r)).toEqual([])
    const label = r.renderTree!.nodes.find(n => n.text?.runs[0]?.text === 'Loading')
    expect(label?.text!.runs[0]!.font.size).toBe(17)
    expect(onWhite(label!.text!.runs[0]!.color)).toEqual(SECONDARY_ON_WHITE)
  })

  const checkbox = `struct Check: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
      Button { configuration.isOn.toggle() } label: {
        HStack { Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square"); configuration.label }
      }
    }
  }`
  const symbols = (r: CompileResult) => r.renderTree!.nodes.flatMap(n => n.image?.symbol ? [n.image.symbol] : [])

  it.each([
    ['on the Toggle', 'Toggle("Remember me", isOn: $on).toggleStyle(Check())'],
    ['on a container', 'VStack { Toggle("Remember me", isOn: $on) }.toggleStyle(Check())'],
    ['on a toggle with a label: closure', 'Toggle(isOn: $on, label: { Text("Remember me") }).toggleStyle(Check())'],
  ])('draws a custom ToggleStyle written %s, and its button toggles the binding', (_, body) => {
    const r = run(app(body, checkbox, '@State var on = true'))
    expect(errors(r)).toEqual([])
    expect(symbols(r)).toEqual(['checkmark.square.fill'])
    expect(texts(r)).toEqual(['Remember me'])
    expect(r.renderTree!.nodes.filter(n => n.shape?.shape === 'capsule')).toEqual([])
    const target = r.renderTree!.nodes.find(n => n.hitTarget?.enabled)!.hitTarget!
    applyEvent({ kind: 'tap', handlerId: target.handlerId, location: { x: 0, y: 0 } })
    expect(symbols(rerender(2))).toEqual(['square'])
  })

  it.each([
    ['Toggle(configuration).padding()'],
    ['Toggle(isOn: configuration.$isOn) { configuration.label }.tint(.green)'],
  ])('draws a stock toggle a custom style builds from its configuration: %s', (inner) => {
    const style = `struct Wrapped: ToggleStyle { func makeBody(configuration: Configuration) -> some View { ${inner} } }`
    const r = run(app('Toggle("Wi-Fi", isOn: $on).toggleStyle(Wrapped())', style, '@State var on = true'))
    expect(errors(r)).toEqual([])
    expect(texts(r)).toEqual(['Wi-Fi'])
    expect(r.renderTree!.nodes.filter(n => n.shape?.shape === 'capsule').length).toBeGreaterThan(0)
    const target = r.renderTree!.nodes.find(n => n.hitTarget?.enabled)!.hitTarget!
    expect(target.value).toBe('on')
  })

  it.each([
    ['Label(configuration)'],
    ['Label(configuration).font(.headline)'],
    ['HStack { Label(configuration); Spacer() }'],
  ])('draws a stock label a custom style builds from its configuration: %s', (inner) => {
    const style = `struct Wrapped: LabelStyle { func makeBody(configuration: Configuration) -> some View { ${inner} } }`
    const r = run(app('Label("Inbox", systemImage: "tray").labelStyle(Wrapped())', style))
    expect(errors(r)).toEqual([])
    expect(texts(r)).toEqual(['Inbox'])
    expect(symbols(r)).toEqual(['tray'])
  })

  it('draws a custom LabelStyle from its makeBody, icon above title', () => {
    const style = 'struct Stacked: LabelStyle { func makeBody(configuration: Configuration) -> some View { VStack(spacing: 2) { configuration.icon; configuration.title } } }'
    const r = run(app('Label("Inbox", systemImage: "tray").labelStyle(Stacked())', style))
    expect(errors(r)).toEqual([])
    const icon = r.renderTree!.nodes.find(n => n.image?.symbol === 'tray')!
    const title = r.renderTree!.nodes.find(n => n.text?.runs[0]?.text === 'Inbox')!
    expect(icon.frame.y + icon.frame.height).toBeLessThanOrEqual(title.frame.y)
    expect(icon.frame.x + icon.frame.width / 2).toBeCloseTo(title.frame.x + title.frame.width / 2, 1)
  })
})

describe('What the preview does not apply, it says; what is cheap, it applies', () => {
  const flow = `struct Flow: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize { .zero }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {}
  }`
  it.each([
    ['.scrollTransition', 'ScrollView { Text("A").scrollTransition { content, phase in content.opacity(phase.isIdentity ? 1 : 0.3) } }', '', /'\.scrollTransition' is recognized but not applied by the preview/],
    ['pinnedViews', 'ScrollView { LazyVStack(pinnedViews: [.sectionHeaders]) { Section { Text("A") } header: { Text("H") } } }', '', /pinnedViews.*not applied/],
    ['.asymmetric', 'Text("A").transition(.asymmetric(insertion: .scale, removal: .opacity))', '', /asymmetric.*insertion/],
    ['.toolbar(.hidden, for: .automatic)', 'TabView { Text("A").toolbar(.hidden, for: .automatic).tabItem { Text("One") } }', '', /\.toolbar\(\.hidden, for: \.automatic\).*not applied/],
    ['a custom Layout', 'Flow { Text("A") }', flow, /'Flow' is a custom Layout/],
  ])('warns on %s', (_, body, extra, message) => {
    const r = run(app(body, extra))
    expect(errors(r)).toEqual([])
    expect(warnings(r).join('\n')).toMatch(message)
  })

  it('does not warn on the custom Layout protocol types themselves', () => {
    const r = run(app('Text("A")', flow))
    expect(warnings(r).join('\n')).not.toMatch(/ProposedViewSize|Subviews/)
  })

  it('plays an asymmetric transition with its insertion transition', () => {
    const r = run(app('Text("A").transition(.asymmetric(insertion: .scale, removal: .opacity))'))
    expect(r.renderTree!.nodes.find(n => n.text)?.transition).toMatchObject({ kind: 'scale' })
  })

  it('hides the navigation bar for .toolbar(.hidden, for: .navigationBar), keeping toolbar items elsewhere', () => {
    const hidden = run(app('NavigationStack { Text("Body").navigationTitle("Title").toolbar(.hidden, for: .navigationBar) }'))
    expect(warnings(hidden)).toEqual([])
    expect(texts(hidden)).toEqual(['Body'])
    const shown = run(app('NavigationStack { Text("Body").navigationTitle("Title").toolbar(.visible, for: .navigationBar).toolbar { Button("Add") {} } }'))
    expect(texts(shown)).toContain('Add')
  })

  it('aligns a Grid column as .gridColumnAlignment asks', () => {
    const r = run(app('Grid { GridRow { Text("Name").gridColumnAlignment(.leading); Text("1") }; GridRow { Text("A"); Text("22") } }'))
    expect(warnings(r)).toEqual([])
    const node = (text: string) => r.renderTree!.nodes.find(n => n.text?.runs[0]?.text === text)!
    expect(node('A').frame.x).toBe(node('Name').frame.x)
    // The other column keeps the grid's own centring.
    expect(node('1').frame.x + node('1').frame.width / 2).toBeCloseTo(node('22').frame.x + node('22').frame.width / 2, 1)
  })
})
