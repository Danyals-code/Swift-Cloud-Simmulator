import { beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import type { CompileResult, RenderNode, TextRun } from '@studio/shared'
import { XCODE, typecheckInXcode } from './helpers/layer-project'

// Text and trust (Wave 6a), read from the render tree `compile` emits. What each
// expectation stands for is measured in docs/parity/native/iphone18pro-text/measurements.json.

let revision = 1
beforeEach(() => { resetPipelineState(); revision = 1 })
/** Every source drawn here, type-checked in Xcode 27 at the end. */
const sources: string[] = []

function app(body: string, extra = ''): CompileResult {
  const text = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
${extra}
    var body: some View {
        ${body}
    }
}`
  sources.push(text)
  const result = compile({
    projectId: 'text-trust', revision: revision++, canvas: { width: 402, height: 874 }, colorScheme: 'light',
    files: [{ id: 'Sources/App.swift', text }],
  })
  expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
  return result
}

const words = (node: RenderNode) => node.text?.runs.map(run => run.text).join('') ?? ''
const textNode = (result: CompileResult, text: string) => result.renderTree!.nodes.find(node => words(node) === text)
/** Each run as the words it draws and how, leaving out what it shares with plain text. */
const runs = (node: RenderNode | undefined) => node?.text?.runs.map((run: TextRun) => ({
  text: run.text,
  ...(run.font.weight !== 400 ? { weight: run.font.weight } : {}),
  ...(run.font.italic ? { italic: true } : {}),
  ...(/mono/i.test(run.font.family) ? { mono: true } : {}),
  ...(run.strikethrough ? { strikethrough: true } : {}),
}))
const accent = { r: 0, g: 136, b: 255, a: 1 }

describe('Markdown in literal titles', () => {
  it('draws bold, italic and both in a Text literal', () => {
    const result = app('Text("**Bold** and *italic* and ***both***")')
    expect(runs(textNode(result, 'Bold and italic and both'))).toEqual([
      { text: 'Bold', weight: 700 },
      { text: ' and ' },
      { text: 'italic', italic: true },
      { text: ' and ' },
      { text: 'both', weight: 700, italic: true },
    ])
  })
})

describe('Markdown in literal titles, marks and links', () => {
  it('draws code monospaced, strikethrough struck, and underscores as bold and italic', () => {
    const result = app(`VStack {
            Text("Run \`swift build\` now")
            Text("~~Old~~ price")
            Text("__Under__ _score_")
        }`)
    expect(runs(textNode(result, 'Run swift build now'))).toEqual([{ text: 'Run ' }, { text: 'swift build', mono: true }, { text: ' now' }])
    expect(runs(textNode(result, 'Old price'))).toEqual([{ text: 'Old', strikethrough: true }, { text: ' price' }])
    expect(runs(textNode(result, 'Under score'))).toEqual([{ text: 'Under', weight: 700 }, { text: ' ' }, { text: 'score', italic: true }])
  })

  it('keeps delimiters that do not flank a word as written', () => {
    const result = app('Text("5 * 3 * 2 and snake_case_name")')
    expect(runs(textNode(result, '5 * 3 * 2 and snake_case_name'))).toEqual([{ text: '5 * 3 * 2 and snake_case_name' }])
  })

  it('draws a link in the tint, over a foreground style, and in a tint the Text sets', () => {
    const result = app(`VStack {
            Text("Read the [terms](https://apple.com) first")
            Text("A [link](https://apple.com) in red").foregroundStyle(.red)
            Text("A [link](https://apple.com) tinted").tint(.green)
        }`)
    const colours = (text: string) => textNode(result, text)!.text!.runs.map(run => run.color)
    expect(colours('Read the terms first')[1]).toEqual(accent)
    expect(colours('A link in red')[0]).toEqual({ r: 255, g: 56, b: 60, a: 1 })
    expect(colours('A link in red')[1]).toEqual(accent)
    expect(colours('A link tinted')[1]).toEqual({ r: 52, g: 199, b: 89, a: 1 })
  })

  it('draws a Button title and a Label title from their Markdown', () => {
    const result = app(`VStack {
            Button("**Save** now") { }
            Label("*Starred* items", systemImage: "star")
        }`)
    const save = textNode(result, 'Save now')!
    expect(runs(save)).toEqual([{ text: 'Save', weight: 700 }, { text: ' now' }])
    expect(save.text!.runs.map(run => run.color)).toEqual([accent, accent])
    expect(runs(textNode(result, 'Starred items'))).toEqual([{ text: 'Starred', italic: true }, { text: ' items' }])
  })
})

describe('what is not Markdown', () => {
  it('reads only the literal: a value put into it, a String and verbatim text keep their asterisks', () => {
    const result = app(`VStack {
            Text("Hi \\(name), **welcome**")
            Text(name)
            Text(verbatim: "**Verbatim**")
            Text("Plain **\\(name)**")
        }`, '    let name = "**Ann**"')
    expect(runs(textNode(result, 'Hi **Ann**, welcome'))).toEqual([{ text: 'Hi **Ann**, ' }, { text: 'welcome', weight: 700 }])
    expect(runs(textNode(result, '**Ann**'))).toEqual([{ text: '**Ann**' }])
    expect(runs(textNode(result, '**Verbatim**'))).toEqual([{ text: '**Verbatim**' }])
    expect(runs(textNode(result, 'Plain **Ann**'))).toEqual([{ text: 'Plain ' }, { text: '**Ann**', weight: 700 }])
  })
})

describe('AttributedString', () => {
  const greeting = `    var greeting: AttributedString {
        var hello = AttributedString("Hello")
        hello.foregroundColor = .red
        hello.font = .title.bold()
        var world = AttributedString(" world")
        world.foregroundColor = .blue
        return hello + world
    }`

  it('draws joined strings, each in its own colour and font', () => {
    const result = app('Text(greeting)', greeting)
    const node = textNode(result, 'Hello world')!
    expect(node.text!.runs.map(run => run.text)).toEqual(['Hello', ' world'])
    expect(node.text!.runs.map(run => run.color)).toEqual([{ r: 255, g: 56, b: 60, a: 1 }, accent])
    expect(node.text!.runs.map(run => [run.font.size, run.font.weight])).toEqual([[28, 700], [17, 400]])
  })

  it('draws a plain string, its Markdown, and counts its characters', () => {
    const result = app(`VStack {
            Text(AttributedString("Plain string"))
            Text((try? AttributedString(markdown: "**Bold** and [link](https://apple.com)")) ?? "")
            Text("\\(greeting.characters.count) characters")
        }`, greeting)
    expect(runs(textNode(result, 'Plain string'))).toEqual([{ text: 'Plain string' }])
    const markdown = textNode(result, 'Bold and link')!
    expect(runs(markdown)).toEqual([{ text: 'Bold', weight: 700 }, { text: ' and ' }, { text: 'link' }])
    expect(markdown.text!.runs[2]!.color).toEqual(accent)
    expect(textNode(result, '11 characters')).toBeDefined()
  })

  it('appends, adds in place, and counts its runs', () => {
    const result = app(`VStack {
            Text(built)
            Text("\\(built.runs.count) runs")
        }`, `    var built: AttributedString {
        var text = AttributedString("One")
        var two = AttributedString(" two")
        two.foregroundColor = .green
        text.append(two)
        text += AttributedString(" three")
        return text
    }`)
    const node = textNode(result, 'One two three')!
    expect(node.text!.runs.map(run => run.text)).toEqual(['One', ' two', ' three'])
    expect(node.text!.runs[1]!.color).toEqual({ r: 52, g: 199, b: 89, a: 1 })
    expect(textNode(result, '3 runs')).toBeDefined()
  })
})

describe('AttributedString attributes and ranges', () => {
  it('reads an attribute it was not given as nil, and sets one on a range of its words', () => {
    const result = app(`VStack {
            Text(styled)
            Text(styled.font == nil ? "no font" : "a font")
        }`, `    var styled: AttributedString {
        var text = AttributedString("Read the terms first")
        if let range = text.range(of: "terms") {
            text[range].foregroundColor = .red
            text[range].underlineStyle = .single
        }
        return text
    }`)
    const node = textNode(result, 'Read the terms first')!
    expect(node.text!.runs.map(run => run.text)).toEqual(['Read the ', 'terms', ' first'])
    expect(node.text!.runs[1]!.color).toEqual({ r: 255, g: 56, b: 60, a: 1 })
    expect(node.text!.runs[1]!.underline).toBe(true)
    expect(node.text!.runs[0]!.underline).toBeUndefined()
    expect(textNode(result, 'no font')).toBeDefined()
  })

  it('finds no range for words it does not have', () => {
    const result = app('Text(missing)', `    var missing: String { AttributedString("abc").range(of: "z") == nil ? "none" : "found" }`)
    expect(textNode(result, 'none')).toBeDefined()
  })
})

describe('AttributedString, more members', () => {
  // measurements.json attributedMore: each as the iOS 27 simulator draws it. "Weight" is 56 wide
  // bold, 54.33 italic, 63.33 monospaced and 53.67 regular (as on markdown-weights).
  const members = `    var inserted: AttributedString {
        var text = AttributedString("inside")
        text.foregroundColor = .red
        return text
    }
    var scoped: AttributedString {
        var text = AttributedString("Scoped")
        text.swiftUI.foregroundColor = .red
        return text
    }
    var contained: AttributedString {
        var container = AttributeContainer()
        container.foregroundColor = .red
        return AttributedString("Contained", attributes: container)
    }
    var merged: AttributedString {
        var text = AttributedString("Merged")
        text.foregroundColor = .blue
        var container = AttributeContainer()
        container.font = .body.bold()
        text.mergeAttributes(container)
        return text
    }
    var replaced: AttributedString {
        var text = AttributedString("Replaced")
        text.font = .body.bold()
        var container = AttributeContainer()
        container.foregroundColor = .red
        text.setAttributes(container)
        return text
    }
    func intent(_ words: String, _ intent: InlinePresentationIntent) -> AttributedString {
        var text = AttributedString(words)
        text.inlinePresentationIntent = intent
        return text
    }`
  const red = { r: 255, g: 56, b: 60, a: 1 }

  it('draws an AttributedString put into a literal as its runs, never its description', () => {
    const result = app('Text("x \\(inserted) y")', members)
    const node = textNode(result, 'x inside y')!
    expect(node.text!.runs.map(run => run.text)).toEqual(['x ', 'inside', ' y'])
    expect(node.text!.runs[1]!.color).toEqual(red)
  })

  it('draws the swiftUI scope, the localized initialiser and AttributeContainer', () => {
    const result = app(`VStack {
            Text(scoped)
            Text(AttributedString(localized: "**Localized**"))
            Text(contained)
            Text(merged)
            Text(replaced)
        }`, members)
    expect(textNode(result, 'Scoped')!.text!.runs[0]!.color).toEqual(red)
    expect(runs(textNode(result, 'Localized'))).toEqual([{ text: 'Localized', weight: 700 }])
    expect(textNode(result, 'Contained')!.text!.runs[0]!.color).toEqual(red)
    // Merged keeps its blue and takes the bold; set replaces the bold with the red.
    expect(textNode(result, 'Merged')!.text!.runs.map(run => [run.color, run.font.weight])).toEqual([[accent, 700]])
    expect(textNode(result, 'Replaced')!.text!.runs.map(run => [run.color, run.font.weight])).toEqual([[red, 400]])
  })

  it('draws each inline presentation intent as its Markdown', () => {
    const result = app(`VStack {
            Text(intent("Strong", .stronglyEmphasized))
            Text(intent("Emphasized", .emphasized))
            Text(intent("Code", .code))
            Text(intent("Struck", .strikethrough))
        }`, members)
    expect(runs(textNode(result, 'Strong'))).toEqual([{ text: 'Strong', weight: 700 }])
    expect(runs(textNode(result, 'Emphasized'))).toEqual([{ text: 'Emphasized', italic: true }])
    expect(runs(textNode(result, 'Code'))).toEqual([{ text: 'Code', mono: true }])
    expect(runs(textNode(result, 'Struck'))).toEqual([{ text: 'Struck', strikethrough: true }])
  })
})

describe('what a click on text selects', () => {
  it('maps a Text drawn from a literal with an image, Markdown or an AttributedString to its own call', () => {
    const source = `VStack {
            Text("Rated \\(Image(systemName: "star.fill")) 4.8")
            Text("**Bold** \\(Image(systemName: "star.fill"))")
            Text("x \\(inserted)")
        }`
    const result = app(source, '    var inserted: AttributedString { AttributedString("in") }')
    const file = result.renderTree!.nodes.filter(node => node.text).map(node => node.origin!)
    expect(file).toHaveLength(3)
    const text = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var inserted: AttributedString { AttributedString("in") }
    var body: some View {
        ${source}
    }
}`
    expect(file.map(origin => text.slice(origin.start, origin.start + 5))).toEqual(['Text(', 'Text(', 'Text('])
  })
})

describe('images in text', () => {
  const symbolRuns = (node: RenderNode | undefined) => node?.text?.runs.map(run => run.symbol ? { symbol: run.symbol, size: run.font.size } : run.text)

  it('draws an interpolated symbol inline, at the text size', () => {
    const result = app(`VStack {
            Text("Rated \\(Image(systemName: "star.fill")) 4.8")
            Text("Rated \\(Image(systemName: "star.fill")) 4.8").font(.largeTitle)
        }`)
    const [body, large] = result.renderTree!.nodes.filter(node => node.text?.runs.some(run => run.symbol))
    expect(symbolRuns(body)).toEqual(['Rated ', { symbol: 'star.fill', size: 17 }, ' 4.8'])
    expect(symbolRuns(large)).toEqual(['Rated ', { symbol: 'star.fill', size: 34 }, ' 4.8'])
    expect(result.renderTree!.nodes.some(node => words(node).includes('View'))).toBe(false)
  })

  it('draws Text(Image) joined to a Text, and alone', () => {
    const result = app(`VStack {
            Text(Image(systemName: "heart.fill")) + Text(" Favourites")
            Text(Image(systemName: "chevron.right")).foregroundStyle(.blue)
        }`)
    const nodes = result.renderTree!.nodes.filter(node => node.text?.runs.some(run => run.symbol))
    expect(nodes.map(symbolRuns)).toEqual([[{ symbol: 'heart.fill', size: 17 }, ' Favourites'], [{ symbol: 'chevron.right', size: 17 }]])
    expect(nodes[1]!.text!.runs[0]!.color).toEqual(accent)
  })

  it('makes room for the symbol as iOS 27 does: 22 pt at body and 44 at large title', () => {
    // measurements.json textImage: "HH" is 24.67 and "H*H" 46.67 at body, 48.33 and 92.33 at large title.
    const result = app(`VStack(alignment: .leading) {
            Text("HH").fixedSize()
            Text("H\\(Image(systemName: "star.fill"))H").fixedSize()
            Text("HH").font(.largeTitle).fixedSize()
            Text("H\\(Image(systemName: "star.fill"))H").font(.largeTitle).fixedSize()
        }`)
    const [plain, star, plainLarge, starLarge] = result.renderTree!.nodes.filter(node => node.text && /^H/.test(words(node)))
    expect(star!.frame.width - plain!.frame.width).toBeCloseTo(22, 1)
    expect(starLarge!.frame.width - plainLarge!.frame.width).toBeCloseTo(44, 1)
    // A decision, not a measurement: the line keeps its height (natively a star adds 1 pt).
    expect(star!.frame.height).toBeCloseTo(plain!.frame.height, 0)
  })

  it('takes the line through an image put into a literal with Markdown around it', () => {
    // measurements.json parser: p-image draws Bold bold, the star, then "it" italic.
    const result = app('Text("**Bold** \\(Image(systemName: "star.fill")) *it*")')
    const node = result.renderTree!.nodes.find(node => node.text?.runs.some(run => run.symbol))!
    expect(node.text!.runs.map(run => run.symbol ?? run.text)).toEqual(['Bold', ' ', 'star.fill', ' ', 'it'])
    expect(node.text!.runs[0]!.font.weight).toBe(700)
    expect(node.text!.runs[4]!.font.italic).toBe(true)
    expect(node.text!.runs[2]!.font.weight).toBe(400)
  })

  it('draws an asset image in text at its own size, its bottom on the baseline, growing the line', () => {
    // measurements.json titlesMore: a 40 x 30 pt image between H's adds 40 to "HH" (24.67), and
    // the body line is 34.33 tall; at large title the line keeps its 40.67.
    const photo = { name: 'photo', light: `data:image/png;base64,${'A'.repeat(8)}`, width: 40, height: 30 }
    const text = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        VStack(alignment: .leading) {
            Text("HH").fixedSize()
            Text("H\\(Image("photo"))H").fixedSize()
            (Text(Image("photo")) + Text("H")).fixedSize()
            Text("H\\(Image("photo"))H").font(.largeTitle).fixedSize()
        }
    }
}`
    sources.push(text)
    const result = compile({
      projectId: 'text-trust', revision: revision++, canvas: { width: 402, height: 874 }, colorScheme: 'light', images: [photo],
      files: [{ id: 'Sources/App.swift', text }],
    })
    const texts = result.renderTree!.nodes.filter(node => node.text)
    const [plain, named, plus, large] = texts
    expect(named!.text!.runs.map(run => run.bitmap ? { image: run.bitmap.name } : run.text)).toEqual(['H', { image: 'photo' }, 'H'])
    expect(plus!.text!.runs.map(run => run.bitmap ? { image: run.bitmap.name } : run.text)).toEqual([{ image: 'photo' }, 'H'])
    expect(named!.frame.width - plain!.frame.width).toBeCloseTo(40, 1)
    expect(named!.frame.height).toBeCloseTo(34.33, 0)
    expect(large!.frame.height).toBeCloseTo(40.67, 0)
    const page = renderToStaticMarkup(createElement(RenderTreeView, { tree: result.renderTree!, onEvent: () => {} }))
    expect(page).toMatch(/<img[^>]*alt="photo"[^>]*style="[^"]*width:40px;height:30px/)
  })
})

describe('Apple\'s parser, as Text draws it', () => {
  // measurements.json parser: each frame and colour from the iOS 27 simulator.
  const linked = (result: CompileResult, text: string) => textNode(result, text)!.text!.runs.map(run => [run.text, run.color.b === 255 && run.color.g === 136])

  it('links a bare URL, an email address, www. and an autolink in angle brackets', () => {
    const result = app(`VStack {
            Text("Visit https://apple.com now")
            Text("Mail support@apple.com now")
            Text("Go to www.apple.com now")
            Text("Open <https://apple.com> now")
        }`)
    expect(linked(result, 'Visit https://apple.com now')).toEqual([['Visit ', false], ['https://apple.com', true], [' now', false]])
    expect(linked(result, 'Mail support@apple.com now')).toEqual([['Mail ', false], ['support@apple.com', true], [' now', false]])
    expect(linked(result, 'Go to www.apple.com now')).toEqual([['Go to ', false], ['www.apple.com', true], [' now', false]])
    expect(linked(result, 'Open https://apple.com now')).toEqual([['Open ', false], ['https://apple.com', true], [' now', false]])
  })

  it('strikes single tildes, reads entities, and takes a link URL with parentheses whole', () => {
    const result = app(`VStack {
            Text("One ~tilde~ here")
            Text("Fish &amp; chips &lt;3")
            Text("A [link](https://a.com/(x)) after")
        }`)
    expect(runs(textNode(result, 'One tilde here'))).toEqual([{ text: 'One ' }, { text: 'tilde', strikethrough: true }, { text: ' here' }])
    expect(runs(textNode(result, 'Fish & chips <3'))).toEqual([{ text: 'Fish & chips <3' }])
    expect(linked(result, 'A link after')).toEqual([['A ', false], ['link', true], [' after', false]])
  })

  it('counts a value put into the literal as punctuation, and reads Markdown across Texts put in', () => {
    const result = app(`VStack {
            Text("x**\\(name)**y")
            Text("**Hi** \\(Text("there").italic())")
            Text("**Hi \\(Text("there"))**")
        }`, '    let name = "Ann"')
    expect(runs(textNode(result, 'x**Ann**y'))).toEqual([{ text: 'x**Ann**y' }])
    expect(runs(textNode(result, 'Hi there'))).toEqual([{ text: 'Hi', weight: 700 }, { text: ' ' }, { text: 'there', italic: true }])
    const inside = result.renderTree!.nodes.filter(node => words(node) === 'Hi there')[1]
    expect(runs(inside)).toEqual([{ text: 'Hi ', weight: 700 }, { text: 'there', weight: 700 }])
  })

  it('keeps a literal\'s own private-use characters', () => {
    const result = app(`VStack {
            Text("Keep \u{F8FF} and \u{E000} **b**")
            Text("\u{E000} **\\(name)** \u{F8FF}")
        }`, '    let name = "Ann"')
    expect(runs(textNode(result, 'Keep \uf8ff and \ue000 b'))).toEqual([{ text: 'Keep \uf8ff and \ue000 ' }, { text: 'b', weight: 700 }])
    expect(runs(textNode(result, '\ue000 Ann \uf8ff'))).toEqual([{ text: '\ue000 ' }, { text: 'Ann', weight: 700 }, { text: ' \uf8ff' }])
  })

  it('draws Markdown in Toggle, Link and NavigationLink titles', () => {
    // measurements.json titlesMore: t-toggle, t-link, t-navlink each draw "Bold" bold.
    const result = app(`NavigationStack {
            VStack {
                Toggle("**Bold** toggle", isOn: .constant(true))
                Link("**Bold** link", destination: URL(string: "https://apple.com")!)
                NavigationLink("**Bold** nav") { Text("Next") }
            }
        }`)
    for (const title of ['toggle', 'link', 'nav']) expect(runs(textNode(result, `Bold ${title}`))).toEqual([{ text: 'Bold', weight: 700 }, { text: ` ${title}` }])
    expect(textNode(result, 'Bold link')!.text!.runs.map(run => run.color)).toEqual([accent, accent])
  })

})

describe('symbol variants', () => {
  const symbols = (result: CompileResult) => result.renderTree!.nodes.flatMap(node => node.image?.symbol ? [node.image.symbol] : [])

  it('draws each variant chain as its composed symbol, in SF Symbols order, and the base where there is none', () => {
    const result = app(`VStack {
            Image(systemName: "star").symbolVariant(.fill)
            Image(systemName: "star").symbolVariant(.circle)
            Image(systemName: "star").symbolVariant(.fill.circle)
            Image(systemName: "star").symbolVariant(.circle.fill)
            Image(systemName: "star").symbolVariant(.square)
            Image(systemName: "heart").symbolVariant(.fill.square)
            Image(systemName: "bell").symbolVariant(.slash.fill)
            Image(systemName: "folder").symbolVariant(.square)
            Image(systemName: "person").symbolVariant(.rectangle)
            Image(systemName: "star").symbolVariant(.none)
        }`)
    expect(symbols(result)).toEqual([
      'star.fill', 'star.circle', 'star.circle.fill', 'star.circle.fill', 'star.square', 'heart.square.fill', 'bell.slash.fill',
      'folder', 'person', 'star',
    ])
  })

  it('reaches the symbols inside, as a Label in a stack', () => {
    const result = app(`VStack {
            Label("Inbox", systemImage: "tray")
        }
        .symbolVariant(.fill)`)
    expect(symbols(result)).toEqual(['tray.fill'])
  })
})

describe('symbol variants, more', () => {
  const symbols = (result: CompileResult) => result.renderTree!.nodes.flatMap(node => node.image?.symbol ? [node.image.symbol] : [])

  it('reads the symbolVariants environment value as .symbolVariant', () => {
    // measurements.json titlesMore: t-env-fill draws star.fill.
    const result = app('Image(systemName: "star").environment(\\.symbolVariants, .fill)')
    expect(symbols(result)).toEqual(['star.fill'])
  })

  it('keeps the tab bar filled under .symbolVariant(.none), as iOS 27 does', () => {
    // tab-default, tab-none and tab-label-none.png: all three draw house.fill and tray.fill.
    const result = app(`TabView {
            Text("Home").tabItem { Label("Home", systemImage: "house") }
            Text("Inbox").tabItem { Label("Inbox", systemImage: "tray") }
        }
        .symbolVariant(.none)`)
    expect(symbols(result)).toEqual(expect.arrayContaining(['house.fill', 'tray.fill']))
    expect(symbols(result)).not.toContain('house')
  })
})

describe('zIndex', () => {
  const order = (nodes: readonly RenderNode[], colours: Record<string, string>) => nodes
    .filter(node => node.shape?.fill?.kind === 'solid')
    .sort((a, b) => a.z - b.z)
    .map(node => { const c = (node.shape!.fill as { color: { r: number; g: number; b: number } }).color; return colours[`${c.r},${c.g},${c.b}`] })
  const named = { '255,56,60': 'red', '0,136,255': 'blue', '52,199,89': 'green' }

  it('draws a raised view above a later sibling in a ZStack, HStack, VStack and overlay, keeping its place', () => {
    const result = app(`VStack {
            ZStack {
                Circle().fill(.red).frame(width: 80, height: 80).offset(x: -20).zIndex(1)
                Circle().fill(.blue).frame(width: 80, height: 80).offset(x: 20)
            }
            HStack(spacing: -20) {
                Circle().fill(.red).frame(width: 40, height: 40).zIndex(1)
                Circle().fill(.blue).frame(width: 40, height: 40)
            }
            VStack(spacing: -20) {
                Circle().fill(.green).frame(width: 40, height: 40).zIndex(2)
                Circle().fill(.red).frame(width: 40, height: 40).zIndex(1)
                Circle().fill(.blue).frame(width: 40, height: 40)
            }
            Color.clear.frame(width: 40, height: 40).overlay {
                Circle().fill(.red).zIndex(1)
                Circle().fill(.blue)
            }
        }`)
    expect(order(result.renderTree!.nodes, named)).toEqual(['blue', 'red', 'blue', 'red', 'blue', 'red', 'green', 'blue', 'red'])
    // Each keeps the place it was given: the ZStack's red circle is still on the left.
    const top = result.renderTree!.nodes.filter(node => node.shape?.fill?.kind === 'solid').sort((a, b) => a.frame.y - b.frame.y || a.z - b.z).slice(0, 2)
    expect(order(top, named)).toEqual(['blue', 'red'])
    expect(top[1]!.frame.x).toBeLessThan(top[0]!.frame.x)
  })
})

describe('masks', () => {
  it('cuts a view to a shape mask, whole or framed and placed by alignment', () => {
    const result = app(`VStack {
            Color.blue.frame(width: 100, height: 100).mask(Circle())
            Color.green.frame(width: 100, height: 100).mask(alignment: .topLeading) { Circle().frame(width: 50, height: 50) }
            Color.orange.frame(width: 100, height: 60).mask(RoundedRectangle(cornerRadius: 12))
        }`)
    const clips = result.renderTree!.nodes.filter(node => node.clipShape)
    expect(clips.map(node => node.clipShape!.kind)).toEqual(['circle', 'circle', 'roundedRectangle'])
    expect(clips.map(node => [node.frame.width, node.frame.height])).toEqual([[100, 100], [50, 50], [100, 60]])
    // Each colour keeps its own frame inside its cut, the green 100 x 100 from its 50 pt circle's corner.
    const inside = clips.map(clip => result.renderTree!.nodes.find(node => node.parent === clip.id)!)
    expect(inside.map(node => [node.frame.x, node.frame.y, node.frame.width, node.frame.height])).toEqual([[0, 0, 100, 100], [0, 0, 100, 100], [0, 0, 100, 60]])
    // And the masked views keep their own sizes in the stack: the green is still 100 tall.
    expect(clips[1]!.frame.y - clips[0]!.frame.y).toBeCloseTo(100 + 8, 0)
  })

  it('draws a gradient masked by text as the text in the gradient, across the frame of the gradient', () => {
    const result = app(`LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing)
            .frame(width: 240, height: 60)
            .mask(Text("Gradient").font(.largeTitle.bold()))`)
    const text = textNode(result, 'Gradient')!
    const run = text.text!.runs[0]!
    expect(run.foregroundFill?.kind).toBe('linearGradient')
    expect(run.font.size).toBe(34)
    expect(run.fillFrame!.width).toBe(240)
    expect(run.fillFrame!.height).toBe(60)
    // Centred in the gradient's frame, which the fill spans.
    expect(text.frame.x + run.fillFrame!.x).toBeCloseTo((402 - 240) / 2, 0)
    expect(text.frame.x + text.frame.width / 2).toBeCloseTo(201, 0)
    // The gradient itself isn't drawn: only the letters show it.
    expect(result.renderTree!.nodes.some(node => node.background && node.id !== 'screen')).toBe(false)
  })

  it('draws text with a gradient overlay masked by the same text as gradient text', () => {
    const result = app(`Text("Overlay")
            .font(.largeTitle)
            .overlay(LinearGradient(colors: [.pink, .purple], startPoint: .leading, endPoint: .trailing))
            .mask(Text("Overlay").font(.largeTitle))`)
    const texts = result.renderTree!.nodes.filter(node => words(node) === 'Overlay')
    expect(texts).toHaveLength(1)
    expect(texts[0]!.text!.runs[0]!.foregroundFill?.kind).toBe('linearGradient')
  })

  it('draws a colour masked by a symbol as the symbol in the colour', () => {
    const result = app(`Color.orange
            .frame(width: 100, height: 100)
            .mask { Image(systemName: "star.fill").font(.system(size: 80)) }`)
    const star = result.renderTree!.nodes.find(node => node.image?.symbol === 'star.fill')!
    expect(star.image!.color).toEqual({ r: 255, g: 141, b: 40, a: 1 })
    expect(result.renderTree!.nodes.some(node => node.background && node.id !== 'screen')).toBe(false)
  })

  it('keeps the opacity Design writes before the mask on what shows through', () => {
    const result = app(`Color.red
            .frame(width: 100, height: 100)
            .opacity(0.5)
            .mask { Image(systemName: "star.fill").font(.system(size: 80)) }`)
    const star = result.renderTree!.nodes.find(node => node.image?.symbol === 'star.fill')!
    // As `.opacity(0.5)` on the symbol itself draws it: in a group at 0.5.
    expect(star.opacity).toBeCloseTo(0.5, 5)
    expect(result.renderTree!.nodes.find(node => node.id === star.parent)!.opacity).toBeCloseTo(0.5, 5)
  })
})

describe('masks, paint', () => {
  it('draws a view masked by a shape painted at 30% at 30%', () => {
    // measurements.json titlesMore: t-mask-opacity is rgb(178, 219, 255), the blue at 30% on white.
    const result = app('Color.blue.frame(width: 60, height: 60).mask(Circle().fill(.black.opacity(0.3)))')
    const clip = result.renderTree!.nodes.find(node => node.clipShape?.kind === 'circle')!
    const blue = result.renderTree!.nodes.find(node => node.parent === clip.id || result.renderTree!.nodes.find(other => other.id === node.parent)?.parent === clip.id)!
    expect(blue.opacity).toBeCloseTo(0.3, 5)
  })

  it('leaves a shape mask painted with a gradient unmasked, for the checker to warn about', () => {
    const result = app('Color.blue.frame(width: 60, height: 60).mask(Circle().fill(LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)))')
    expect(result.renderTree!.nodes.some(node => node.clipShape?.kind === 'circle')).toBe(false)
  })
})

describe('iOS built-in font families', () => {
  const face = (result: CompileResult, text: string) => { const node = textNode(result, text)!; const font = node.text!.runs[0]!.font; return { family: font.family.split(',')[0], size: font.size, weight: font.weight, italic: font.italic, height: Math.round(node.frame.height * 100) / 100 } }

  it('draws each family iOS ships in its own face first, by family or PostScript name, at the line height iOS gives it', () => {
    const result = app(`VStack(alignment: .leading) {
            Text("Avenir").font(.custom("Avenir Next", size: 22))
            Text("Demi").font(.custom("AvenirNext-DemiBold", size: 22))
            Text("Georgia").font(.custom("Georgia", size: 22))
            Text("Menlo").font(.custom("Menlo", size: 22))
            Text("Snell").font(.custom("Snell Roundhand", size: 22))
            Text("Bold").font(.custom("Georgia", size: 22)).bold()
        }`)
    expect(face(result, 'Avenir')).toEqual({ family: '"Avenir Next"', size: 22, weight: 400, italic: false, height: 30.33 })
    expect(face(result, 'Demi')).toMatchObject({ family: '"Avenir Next"', weight: 600 })
    expect(face(result, 'Georgia')).toMatchObject({ family: '"Georgia"', height: 25 })
    expect(face(result, 'Menlo')).toMatchObject({ family: '"Menlo"', height: 25.67 })
    expect(face(result, 'Snell')).toMatchObject({ family: '"Snell Roundhand"', height: 28 })
    expect(face(result, 'Bold')).toMatchObject({ family: '"Georgia"', weight: 700 })
    // Each falls back to a face of its kind where the browser lacks it.
    const stack = (text: string) => textNode(result, text)!.text!.runs[0]!.font.family
    expect(stack('Georgia')).toMatch(/serif$/)
    expect(stack('Menlo')).toMatch(/monospace$/)
    expect(stack('Snell')).toMatch(/cursive$/)
  })

  it('draws a family iOS lacks in the system face, as iOS does', () => {
    const result = app('Text("Brand").font(.custom("Brand Sans", size: 22))')
    expect(face(result, 'Brand').family).toBe('-apple-system')
  })
})

describe('what the page draws', () => {
  const html = (result: CompileResult) => renderToStaticMarkup(createElement(RenderTreeView, { tree: result.renderTree!, onEvent: () => {} }))

  it('draws Markdown runs as spans of their own, with no asterisks', () => {
    const page = html(app('Text("**Bold** and `code`")'))
    expect(page).toMatch(/<span[^>]*font-weight:700[^>]*>Bold<\/span>/)
    expect(page).toMatch(/<span[^>]*font-family:ui-monospace[^>]*>code<\/span>/)
    expect(page).not.toContain('**')
  })

  it('draws an inline symbol where iOS 27 draws its ink, at body and large title', () => {
    // measurements.json textImage: star.fill at body is 22 wide in the line, its ink 17.33 tall
    // from 15.33 above the baseline to 2 below; at large title 44 wide, 30.67 above to 4.33 below.
    const page = html(app(`VStack {
            Text("Rated \\(Image(systemName: "star.fill")) 4.8")
            Text("Rated \\(Image(systemName: "star.fill")) 4.8").font(.largeTitle)
        }`))
    const boxes = [...page.matchAll(/<span data-symbol="star.fill" aria-hidden="true" style="display:inline-block;width:([\d.]+)px;height:([\d.]+)px;vertical-align:(-?[\d.]+)px/g)]
      .map(match => match.slice(1).map(Number))
    expect(boxes).toHaveLength(2)
    const [body, large] = boxes as [number[], number[]]
    for (const [got, want] of [[body[0], 22], [body[1], 17.33], [body[2], -2], [large[0], 44], [large[1], 35], [large[2], -4.33]] as const) expect(Math.abs(got! - want)).toBeLessThan(0.5)
    expect(page).not.toContain('View')
  })

  it('paints a gradient across the whole text, the inline symbol included', () => {
    // measurements.json titlesMore: t-gradient runs red to blue across "Go", the star and "now".
    const result = app(`Text("Go \\(Image(systemName: "star.fill")) now")
            .font(.largeTitle)
            .foregroundStyle(LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing))
            .fixedSize()`)
    const node = result.renderTree!.nodes.find(node => node.text?.runs.some(run => run.symbol))!
    const page = html(result)
    const size = `background-size:${node.frame.width}px ${node.frame.height}px`
    // Every span, the symbol's too, shows its part of one gradient as wide as the text.
    expect(page.split(size).length - 1).toBe(3)
    expect(page).toMatch(/data-symbol="star.fill"[^>]*><svg[^>]*><defs><mask/)
    const positions = page.split(size).slice(1).map(after => Number(/^;background-position:(-?[\d.]+)px/.exec(after)?.[1]))
    expect(positions[0]).toBe(0)
    expect(positions[1]).toBeLessThan(positions[0]!)
    expect(positions[2]).toBeLessThan(positions[1]!)
  })

  it('spreads a masked gradient across the gradient, behind the letters', () => {
    const page = html(app(`LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing)
            .frame(width: 240, height: 60)
            .mask(Text("Gradient"))`))
    expect(page).toMatch(/background-clip:text[^"]*background-size:240px 60px/)
  })
})

describe.skipIf(!XCODE)('in Xcode 27', () => {
  it('type-checks every source drawn above', () => {
    // `Text + Text` is deprecated from iOS 26, so a source joining Texts is checked at iOS 18.
    typecheckInXcode(sources.map(source => /\) \+ Text\(/.test(source) ? `// target: iOS 18\n${source}` : source))
  }, 300_000)
})
