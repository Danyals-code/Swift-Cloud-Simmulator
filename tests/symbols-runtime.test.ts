import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { RenderTreeView, symbolAsset } from '@studio/swiftui-render-dom'
import { SYMBOL_MAP, symbolDefinition, symbolDrawsMode, symbolDrawsVariableValue, symbolLayerColors, type CompileResult, type RenderNode } from '@studio/shared'
import { XCODE, typecheckInXcode } from './helpers/layer-project'

// Symbols (Wave 6b), read from the render tree `compile` emits and the markup it paints.
// What each expectation stands for is measured in
// docs/parity/native/iphone18pro-symbols/measurements.json.

let revision = 1
beforeEach(() => { resetPipelineState(); revision = 1 })
/** Every source drawn here, type-checked in Xcode 27 at the end. */
const sources: string[] = []

function app(body: string): CompileResult {
  const text = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        ${body}
    }
}`
  sources.push(text)
  const result = compile({
    projectId: 'symbols', revision: revision++, canvas: { width: 402, height: 874 }, colorScheme: 'light',
    files: [{ id: 'Sources/App.swift', text }],
  })
  expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
  return result
}

const images = (result: CompileResult) => result.renderTree!.nodes.filter(node => node.image?.symbol)
const image = (result: CompileResult, symbol: string, index = 0) => images(result).filter(node => node.image!.symbol === symbol)[index]!
const markup = (result: CompileResult) => renderToStaticMarkup(createElement(RenderTreeView, { tree: result.renderTree!, onEvent: () => {} }))
const css = (r: number, g: number, b: number, a = 1) => a >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})`
const layers = (node: RenderNode) => symbolLayerColors(node.image!).map(color => css(color.r, color.g, color.b, color.a))

const red = [255, 56, 60] as const
const blue = [0, 136, 255] as const
const green = [52, 199, 89] as const
const yellow = [255, 204, 0] as const
const white = [255, 255, 255] as const

/** The audit's 84 common names that drew a question mark on 2026-10-14 (doc 18, row 1). */
const AUDIT_MISSES = `person.crop.circle person.crop.circle.fill bell.badge star.leadinghalf.filled chevron.forward chevron.backward
arrow.triangle.2.circlepath square.and.arrow.down pencil.circle doc.on.doc message message.fill bubble.left bubble.left.fill bubble.right
phone phone.fill video video.fill photo.on.rectangle mic mic.fill speaker.wave.3 shuffle repeat headphones stopwatch dollarsign.circle
mappin mappin.circle car car.fill bus tram bicycle figure.walk figure.run moon.stars cloud.rain cloud.sun cloud.sun.fill umbrella
heart.text.square cross.case pills hand.raised ellipsis.circle ellipsis.circle.fill line.3.horizontal.decrease
line.3.horizontal.decrease.circle square.grid.2x2.fill rectangle.grid.1x2 antenna.radiowaves.left.and.right printer qrcode barcode
graduationcap newspaper crown trophy pin pin.fill archivebox cube sun.horizon fork.knife takeoutbag.and.cup.and.straw dumbbell
figure.strengthtraining.traditional bed.double brain.head.profile face.smiling hand.wave square.and.arrow.up.on.square
rectangle.portrait.and.arrow.right laptopcomputer applewatch power hexagon app.badge plus.app checklist note.text text.bubble`.split(/\s+/)

describe('symbol coverage', () => {
  it('draws every one of the audit\'s 84 misses', () => {
    expect(AUDIT_MISSES).toHaveLength(84)
    expect(AUDIT_MISSES.filter(name => !symbolAsset(name))).toEqual([])
  })

  it('maps well over 600 names, each to a drawing', () => {
    const names = Object.keys(SYMBOL_MAP)
    expect(names.length).toBeGreaterThan(600)
    expect(names.filter(name => !symbolAsset(name)?.body)).toEqual([])
  })

  it('draws a new name in place of the question mark', () => {
    const page = markup(app('Image(systemName: "fork.knife")'))
    expect(page).toContain('fork.knife (Ionicons approximation)')
    expect(page).not.toContain('unsupported symbol')
  })

  it('keeps the base symbol where iOS has no composed one, as 6a measured', () => {
    expect(images(app('Image(systemName: "folder").symbolVariant(.square)')).map(node => node.image!.symbol)).toEqual(['folder'])
  })
})

/** Where a drawing's arrow points, or any point lands: `point` through the `<g transform>`s around it, the innermost first. */
function placed(body: string, [x, y]: readonly [number, number]): [number, number] {
  const transforms = [...body.matchAll(/<g transform="([^"]+)">/g)].map(match => match[1]!).reverse()
  for (const transform of transforms) {
    for (const [, kind, args] of [...transform.matchAll(/(translate|scale|rotate)\(([^)]*)\)/g)].reverse()) {
      const [a = 0, b = 0, c = 0] = args!.split(/[\s,]+/).map(Number)
      if (kind === 'translate') [x, y] = [x + a, y + b]
      else if (kind === 'scale') [x, y] = [x * a, y * b]
      else {
        const turn = a * Math.PI / 180, dx = x - b, dy = y - c
        ;[x, y] = [b + dx * Math.cos(turn) - dy * Math.sin(turn), c + dx * Math.sin(turn) + dy * Math.cos(turn)]
      }
    }
  }
  return [Math.round(x), Math.round(y)]
}

describe('look-alikes', () => {
  const body = (name: string) => symbolAsset(name, 'm')!.body
  /** The Ionicon a name draws, or its drawing's name. */
  const icon = (name: string) => /href="[^"]*#([\w-]+)"/.exec(body(name))?.[1]

  it('points arrow.right.to.line right, at the line on the right, and left.to.line left', () => {
    // toline is an arrow down to a line; its tip is at (256, 384) and the line at y 448.
    const [right, rightLine] = [placed(body('arrow.right.to.line'), [256, 384]), placed(body('arrow.right.to.line'), [256, 448])]
    expect(right[0]).toBeGreaterThan(256)
    expect(rightLine[0]).toBeGreaterThan(right[0])
    const [left, leftLine] = [placed(body('arrow.left.to.line'), [256, 384]), placed(body('arrow.left.to.line'), [256, 448])]
    expect(left[0]).toBeLessThan(256)
    expect(leftLine[0]).toBeLessThan(left[0])
  })

  it('draws outline names as outlines, as iOS 27 does (docs/parity/native/iphone18pro-symbols, names-*)', () => {
    for (const name of ['person.badge.plus', 'square.on.square', 'bag.badge.plus', 'photo.on.rectangle.angled', 'note.text', 'person.crop.rectangle', 'pencil.and.outline', 'gauge', 'speedometer', 'rosette', 'applewatch', 'ipad']) {
      expect(icon(name), name).toMatch(/-outline$/)
    }
    // arrow-redo has no outline: uturn.forward is uturn.backward, mirrored.
    expect(body('arrow.uturn.forward')).toBe(`<g transform="translate(512 0) scale(-1 1)">${body('arrow.uturn.backward')}</g>`)
    expect(body('arrow.uturn.right')).toBe(body('arrow.uturn.forward'))
    expect(body('doc.text.magnifyingglass')).not.toContain('fill="currentColor"')
  })

  it('draws a fill name filled where its outline name is an outline', () => {
    for (const name of ['sun.horizon', 'sunrise', 'sunset', 'playpause', 'pills', 'rectangle.grid.1x2', 'book.closed', 'text.book.closed']) {
      expect(body(`${name}.fill`), name).not.toBe(body(name))
      expect(body(`${name}.fill`), name).toContain('fill="currentColor"')
    }
  })

  it('draws what tells a name from its neighbours, rather than the neighbour', () => {
    const distinct = (names: readonly string[]) => expect(new Set(names.map(body)).size, names.join(' ')).toBe(names.length)
    distinct(['bubble.left', 'plus.bubble', 'quote.bubble', 'exclamationmark.bubble'])
    distinct(['bubble.left.fill', 'plus.bubble.fill', 'quote.bubble.fill', 'exclamationmark.bubble.fill'])
    distinct(['shield', 'xmark.shield', 'checkmark.shield'])
    distinct(['shield.fill', 'xmark.shield.fill'])
    distinct(['sun.horizon', 'sunrise', 'sunset'])
    distinct(['moon', 'moon.stars'])
    distinct(['moon.fill', 'moon.stars.fill'])
    distinct(['books.vertical', 'building.columns'])
    distinct(['tennisball', 'tennisball.fill', 'tennis.racket'])
    distinct(['eyeglasses', 'sunglasses', 'sunglasses.fill'])
    // A rack of servers, not a database's cylinders; a network, not a branching graph.
    expect(icon('server.rack')).not.toBe('server')
    expect(icon('network')).not.toBe('git-network')
    // A gem is not a diamond.
    expect(icon('diamond')).toBeUndefined()
    expect(icon('diamond.fill')).toBeUndefined()
  })

  it('has no drawing for a name whose look-alike would lose what it means, so the checker warns', () => {
    for (const name of ['carrot', 'restart', 'play.tv', 'phone.arrow.up.right', 'camera.viewfinder', 'person.wave.2', 'qrcode.viewfinder', 'barcode.viewfinder', 'doc.on.clipboard', 'list.clipboard', 'list.bullet.clipboard', 'moon.zzz', 'radio']) {
      expect(symbolDefinition(name), name).toBeNull()
    }
  })

  it('never repeats an attribute on one element, where the first would win', () => {
    for (const name of Object.keys(SYMBOL_MAP)) {
      for (const tag of body(name).match(/<\w+[^>]*>/g) ?? []) {
        const names = [...tag.matchAll(/\s([\w-]+)="/g)].map(match => match[1])
        expect(new Set(names).size, `${name}: ${tag}`).toBe(names.length)
      }
    }
  })

  it('draws wifi\'s arcs about 0.14 of its width thick, and its dot 0.21 across, as iOS 27 does (variable.png: 12.5, 19 and 91 px)', () => {
    const wifi = body('wifi')
    const outer = /<path d="M(\d+) \d+A\d+ \d+ 0 0 1 (\d+) \d+"[^>]*stroke-width="(\d+)"/.exec(wifi.slice(wifi.lastIndexOf('<path')))!
    const width = Number(outer[2]) - Number(outer[1]) + Number(outer[3])
    const within = (value: number, measured: number) => expect(Math.abs(value / measured - 1)).toBeLessThan(0.1)
    within(Number(outer[3]) / width, 12.5 / 91)
    within(2 * Number(/<circle[^>]* r="(\d+)"/.exec(wifi)![1]) / width, 19 / 91)
  })
})

describe('the symbols in a container', () => {
  it('keep a mirrored glyph mirrored, whether the container is painted as a layer or not', () => {
    const glyph = (name: string, layered: boolean) => placed(symbolAsset(name, 'm', { layered })!.body, [400, 256])
    for (const name of ['arrow.counterclockwise.circle', 'arrow.counterclockwise.circle.fill']) {
      expect(glyph(name, true), name).toEqual(glyph(name, false))
    }
    // The glyph arrow.counterclockwise draws on the left where arrow.clockwise's is on the right.
    expect(symbolAsset('arrow.counterclockwise.circle', 'm', { layered: true })!.body).toContain('scale(-1 1)')
  })
})

/** Apple's list of the SF Symbol names it ships, and the older names it still draws (macOS only). */
const CORE_GLYPHS = '/System/Library/CoreServices/CoreGlyphs.bundle/Contents/Resources'

describe.skipIf(!existsSync(`${CORE_GLYPHS}/name_availability.plist`))('every name drawn, against Apple’s own list', () => {
  const read = (file: string) => JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', `${CORE_GLYPHS}/${file}`], { encoding: 'utf8', maxBuffer: 64 << 20 }))

  it('is a symbol Apple ships, or an older name for one that iOS still draws', () => {
    const shipped = (read('name_availability.plist') as { symbols: Record<string, string> }).symbols
    const aliases = read('name_aliases.strings') as Record<string, string>
    expect(Object.keys(SYMBOL_MAP).filter(name => !shipped[name] && !shipped[aliases[name] ?? ''])).toEqual([])
    // Older names the map keeps: rectangle.on.rectangle.fill is rectangle.fill.on.rectangle.fill.
    expect(aliases['photo.on.rectangle.fill']).toBe('photo.fill.on.rectangle.fill')
    expect(aliases['rectangle.on.rectangle.fill']).toBe('rectangle.fill.on.rectangle.fill')
    // globe.fill arrived in 2025, iOS 26.
    expect(shipped['globe.fill']).toBe('2025')
  })
})

describe('rendering modes', () => {
  it('paints a filled container a quarter and an outline half as strong as the glyph, in hierarchical', () => {
    const result = app(`VStack {
            Image(systemName: "checkmark.circle.fill").symbolRenderingMode(.hierarchical).foregroundStyle(.red)
            Image(systemName: "star.circle").symbolRenderingMode(.hierarchical).foregroundStyle(.red)
        }`)
    expect(layers(image(result, 'checkmark.circle.fill'))).toEqual([css(...red), css(...red, 0.5), css(...red, 0.25)])
    const page = markup(result)
    expect(page).toContain('data-symbol-mode="hierarchical"')
    expect(page).toContain(`--symbol-3:${css(...red, 0.25)}`)
  })

  it('reads the mode from around the symbol, painting the primary style when none is set', () => {
    const result = app(`VStack {
            Image(systemName: "plus.circle.fill")
            Label("Add", systemImage: "person.crop.circle.fill")
        }
        .symbolRenderingMode(SymbolRenderingMode.hierarchical)`)
    expect(image(result, 'plus.circle.fill').image!.symbolPaint?.mode).toBe('hierarchical')
    expect(layers(image(result, 'person.crop.circle.fill'))[2]).toBe(css(0, 0, 0, 0.25))
  })

  it('paints the glyph in the first palette style and a filled container in the last, up to three', () => {
    const result = app(`VStack {
            Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.red, .blue)
            Image(systemName: "checkmark.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.red, .green, .blue)
            Image(systemName: "bell.badge").symbolRenderingMode(.palette).foregroundStyle(.red, .green, .blue)
            Image(systemName: "heart.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.red)
        }`)
    expect(layers(image(result, 'person.crop.circle.fill'))).toEqual([css(...red), css(...blue), css(...blue)])
    expect(layers(image(result, 'checkmark.circle.fill'))).toEqual([css(...red), css(...green), css(...blue)])
    expect(layers(image(result, 'bell.badge'))[1]).toBe(css(...green))
    expect(layers(image(result, 'heart.circle.fill'))).toEqual([css(...red), css(...red), css(...red)])
  })

  it('reads two styles alone as palette, and ignores the second in the other modes', () => {
    const result = app(`VStack {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.white, .blue)
            Image(systemName: "xmark.circle.fill").symbolRenderingMode(.hierarchical).foregroundStyle(.red, .blue)
            Image(systemName: "plus.circle.fill").symbolRenderingMode(.monochrome).foregroundStyle(.red, .blue)
        }`)
    expect(image(result, 'checkmark.circle.fill').image!.symbolPaint?.mode).toBe('palette')
    expect(layers(image(result, 'checkmark.circle.fill'))).toEqual([css(...white), css(...blue), css(...blue)])
    expect(layers(image(result, 'xmark.circle.fill'))).toEqual([css(...red), css(...red, 0.5), css(...red, 0.25)])
    expect(image(result, 'plus.circle.fill').image!.symbolPaint?.mode).toBeUndefined()
    expect(image(result, 'plus.circle.fill').image!.color).toEqual({ r: red[0], g: red[1], b: red[2], a: 1 })
  })

  it('paints the fixed multicolor colours, and the foreground style where iOS has none', () => {
    const result = app(`VStack {
            Image(systemName: "heart.fill")
            Image(systemName: "star.fill")
            Image(systemName: "leaf")
            Image(systemName: "checkmark.circle.fill")
            Image(systemName: "folder.badge.plus")
            Image(systemName: "flame.fill")
        }
        .symbolRenderingMode(.multicolor)
        .foregroundStyle(.purple)`)
    expect(layers(image(result, 'heart.fill'))[0]).toBe(css(...red))
    expect(layers(image(result, 'star.fill'))[0]).toBe(css(...yellow))
    expect(layers(image(result, 'leaf'))[0]).toBe(css(...green))
    const check = layers(image(result, 'checkmark.circle.fill'))
    expect([check[0], check[2]]).toEqual([css(...white), css(...blue)])
    const badge = layers(image(result, 'folder.badge.plus'))
    expect(badge[0]).toBe(css(...green))
    expect(badge[1]).toBe(layers(image(result, 'flame.fill'))[0])
    expect(markup(result)).toContain('data-symbol-mode="multicolor"')
  })

  it('names which symbols have a second layer here, and which multicolor table entries', () => {
    expect(symbolDrawsMode('checkmark.circle.fill', 'palette')).toBe(true)
    expect(symbolDrawsMode('person.crop.circle.fill', 'hierarchical')).toBe(true)
    expect(symbolDrawsMode('bell.badge', 'hierarchical')).toBe(true)
    expect(symbolDrawsMode('heart.fill', 'hierarchical')).toBe(false)
    expect(symbolDrawsMode('heart.fill', 'multicolor')).toBe(true)
    expect(symbolDrawsMode('flame.fill', 'multicolor')).toBe(false)
    expect(symbolDrawsMode('not.a.symbol', 'palette')).toBe(false)
  })

  it('paints a gradient as the glyph\'s style, and each other layer in its own, as SwiftUI 27 draws them', () => {
    // ImageRenderer on macOS 27: palette (gradient, gray) draws the glyph in the gradient on a
    // gray disc; hierarchical draws the gradient at full, half and quarter strength.
    const result = app(`VStack {
            Image(systemName: "checkmark.circle.fill").symbolRenderingMode(.palette).foregroundStyle(LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing), Color.gray)
            Image(systemName: "xmark.circle.fill").symbolRenderingMode(.hierarchical).foregroundStyle(LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing))
            Image(systemName: "plus.circle.fill").foregroundStyle(LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing))
        }`)
    const page = markup(result)
    const [palette, hierarchical, monochrome] = page.split('<svg width="100%" height="100%"').slice(1)
    // The disc takes the gray, the glyph the gradient, each through a mask of its own layer.
    expect(palette).toContain('data-symbol-mode="palette"')
    expect(palette!.match(/<mask /g)).toHaveLength(3)
    expect(palette).toMatch(/background:rgb\(142 142 147\)/)
    expect(palette).toMatch(/background:linear-gradient/)
    expect(hierarchical).toContain('data-symbol-mode="hierarchical"')
    expect(hierarchical!.match(/opacity:0\.(5|25)/g)).toEqual(['opacity:0.5', 'opacity:0.25'])
    // With no mode, the glyph is knocked out of the gradient disc, as before.
    expect(monochrome).not.toContain('data-symbol-mode')
  })

  it('paints a filled container under its glyph in two layers, rather than knocking the glyph out', () => {
    expect(symbolAsset('heart.circle.fill', 'm')!.body).toContain('<mask')
    const layered = symbolAsset('heart.circle.fill', 'm', { layered: true })!.body
    expect(layered).not.toContain('<mask')
    expect(layered).toContain('var(--symbol-3')
  })
})

describe('variable values', () => {
  /** How many of a symbol's parts are dimmed. */
  const dimmed = (name: string, value: number) => (symbolAsset(name, 'm', { variableValue: value })!.body.match(/opacity="\.3"/g) ?? []).length

  it('dims the parts above the value, as iOS 27 draws wifi, cellularbars and speaker.wave.3', () => {
    expect([0, 0.2, 0.34, 0.5, 0.67, 0.8, 1].map(value => dimmed('wifi', value))).toEqual([3, 2, 1, 1, 1, 0, 0])
    expect([0, 0.2, 0.34, 0.5, 0.67, 0.8, 1].map(value => dimmed('cellularbars', value))).toEqual([4, 3, 2, 2, 1, 0, 0])
    expect([0, 0.2, 0.34, 0.5, 0.67, 0.8, 1].map(value => dimmed('speaker.wave.3', value))).toEqual([3, 2, 1, 1, 1, 0, 0])
    expect([0, 0.2, 0.5, 0.67, 1].map(value => dimmed('speaker.wave.2', value))).toEqual([2, 1, 1, 0, 0])
    expect(symbolDrawsVariableValue('wifi')).toBe(true)
    expect(symbolDrawsVariableValue('heart')).toBe(false)
  })

  it('carries the value from Image(systemName:variableValue:) to the painter', () => {
    const result = app(`HStack {
            Image(systemName: "wifi", variableValue: 0.5)
            Image(systemName: "cellularbars", variableValue: 0.2)
            Image(systemName: "wifi")
        }`)
    expect(image(result, 'wifi').image!.symbolPaint?.variableValue).toBe(0.5)
    expect(image(result, 'wifi', 1).image!.symbolPaint?.variableValue).toBeUndefined()
    expect(markup(result).match(/opacity="\.3"/g)).toHaveLength(1 + 3)
  })
})

describe('symbol effects', () => {
  const opacity = (result: CompileResult, index: number) => images(result)[index]!.opacity

  it('hides a symbol that disappears or has not appeared, keeping its frame, and draws every other effect as it is', () => {
    const result = app(`HStack {
            Image(systemName: "heart.fill").symbolEffect(.bounce, value: 0)
            Image(systemName: "heart.fill").symbolEffect(.disappear)
            Image(systemName: "heart.fill").symbolEffect(.disappear, isActive: false)
            Image(systemName: "heart.fill").symbolEffect(.disappear.down)
            Image(systemName: "heart.fill").symbolEffect(.appear)
            Image(systemName: "heart.fill").symbolEffect(.pulse)
        }`)
    expect([0, 1, 2, 3, 4, 5].map(index => opacity(result, index))).toEqual([1, 0, 1, 0, 0, 1])
    const frames = images(result).map(node => node.frame.width)
    expect(new Set(frames).size).toBe(1)
    expect(result.diagnostics.filter(diagnostic => /symbolEffect/.test(diagnostic.message))).toEqual([])
  })

  it('draws a hidden symbol again where effects are removed between the effect and the symbol, and only there', () => {
    const result = app(`VStack {
            Image(systemName: "heart.fill").symbolEffectsRemoved().symbolEffect(.disappear)
            Image(systemName: "star.fill").symbolEffect(.disappear).symbolEffectsRemoved()
            Image(systemName: "bell.fill").symbolEffectsRemoved(false).symbolEffect(.disappear)
            Image(systemName: "star.fill").symbolEffect(.appear, isActive: false)
        }`)
    expect([0, 1, 2, 3].map(index => opacity(result, index))).toEqual([1, 0, 0, 1])
  })
})

describe.skipIf(!XCODE)('in Xcode 27', () => {
  it('type-checks every source drawn above', () => {
    typecheckInXcode(sources)
  }, 300_000)
})
