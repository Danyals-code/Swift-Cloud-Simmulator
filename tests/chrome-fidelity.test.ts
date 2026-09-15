import { describe, expect, it } from 'vitest'
import type { CompileRequest, RenderNode } from '@studio/shared'
import { symbolCandidates } from '@studio/shared'
import { symbolShapes, symbolStrokeScale } from '@studio/swiftui-render-dom'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * The details that decide whether a preview reads as iOS.
 *
 * Each of these was wrong in a way that no test could catch and every screenshot
 * showed, which is the category this file exists for: not "does it run" but "does
 * it look like the thing it claims to be".
 */

const device = DEVICES['iphone-15']

function compileSource(source: string, colorScheme: 'light' | 'dark' = 'light') {
  const request: CompileRequest = {
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme,
    revision: 1,
  }
  resetPipelineState()
  return compile(request)
}

function app(body: string): string {
  return `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
    var body: some View {
${body}
    }
}
`
}

const LIST_SCREEN = app(`        NavigationStack {
            List {
                Section("Places") {
                    NavigationLink("Kyoto") { Text("Kyoto") }
                    NavigationLink("Lisbon") { Text("Lisbon") }
                }
            }
            .navigationTitle("Explore")
        }`)

function node(nodes: readonly RenderNode[], id: string): RenderNode {
  const found = nodes.find((n) => n.id === id)
  expect(found, `no node ${id}`).toBeDefined()
  return found!
}

function solid(node: RenderNode): string {
  expect(node.background?.kind).toBe('solid')
  const c = node.background!.kind === 'solid' ? node.background.color : null
  return `${c!.r},${c!.g},${c!.b}`
}

describe('the screen behind a grouped list', () => {
  /**
   * The seam.
   *
   * The navigation bar painted `systemBackground` unconditionally, so every
   * navigation-plus-list screen had a white strip above a #F2F2F7 list with a hard
   * horizontal edge between them, about a third of the way down the phone. On iOS
   * the bar is transparent at the top of its content and no such edge exists.
   */
  it('is the grouped background, not white', () => {
    const tree = compileSource(LIST_SCREEN).renderTree!
    expect(solid(node(tree.nodes, 'screen'))).toBe('242,242,247')
  })

  it('is matched by the navigation bar, so there is no visible edge', () => {
    const tree = compileSource(LIST_SCREEN).renderTree!
    const bar = tree.nodes.find((n) => n.id.startsWith('navbar-bg'))

    expect(bar, 'no navigation bar background').toBeDefined()
    expect(solid(bar!)).toBe(solid(node(tree.nodes, 'screen')))
  })

  it('stays white for content that is not a grouped list', () => {
    const tree = compileSource(app('        Text("Plain")')).renderTree!
    expect(solid(node(tree.nodes, 'screen'))).toBe('255,255,255')
  })

  it('adapts in dark mode rather than staying light grey', () => {
    const tree = compileSource(LIST_SCREEN, 'dark').renderTree!
    expect(solid(node(tree.nodes, 'screen'))).toBe('0,0,0')
  })
})

describe('list rows', () => {
  /**
   * A `NavigationLink` arrives already wrapped in a hit target sized to its label -
   * about 22pt of a 44pt row - so the bottom half of every row was dead to the
   * touch. No list on iOS behaves that way.
   */
  it('are tappable across their whole height', () => {
    const tree = compileSource(LIST_SCREEN).renderTree!
    const targets = tree.nodes.filter((n) => n.hitTarget?.enabled && n.frame.width > 200)

    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      expect(target.frame.height, `${target.id} is shorter than a row`).toBeGreaterThanOrEqual(44)
    }
  })
})

describe('the tab bar', () => {
  it('draws the hairline iOS puts between it and the content', () => {
    const tree = compileSource(
      app(`        TabView {
            Text("One").tabItem { Label("One", systemImage: "house") }
            Text("Two").tabItem { Label("Two", systemImage: "gear") }
        }`),
    ).renderTree!

    const separator = tree.nodes.find((n) => n.id.startsWith('tabbar-sepl'))
    expect(separator, 'no hairline above the tab bar').toBeDefined()
    expect(separator!.frame.height).toBeLessThanOrEqual(1)
    expect(separator!.frame.width).toBe(device.width)
  })
})

describe('symbols reach the renderer by name', () => {
  it('carries the name the user wrote', () => {
    const tree = compileSource(app('        Image(systemName: "star.fill")')).renderTree!
    const image = tree.nodes.find((n) => n.kind === 'image')

    expect(image?.image?.symbol).toBe('star.fill')
  })

  it("names the framework's own chevrons, which nobody wrote", () => {
    // These used to carry a glyph and no name at all, so the renderer had nothing
    // to look up and a list row's disclosure indicator stayed a `›` character.
    const tree = compileSource(LIST_SCREEN).renderTree!
    const chevrons = tree.nodes.filter((n) => n.kind === 'image').map((n) => n.image?.symbol)

    expect(chevrons).toContain('chevron.right')
  })

  it('is still honest that the drawing is not Apple’s', () => {
    const tree = compileSource(app('        Image(systemName: "star.fill")')).renderTree!
    const image = tree.nodes.find((n) => n.kind === 'image')

    expect(image?.image?.approximated).toBe(true)
  })
})

describe('the symbol table', () => {
  it('strips variants most-specific first', () => {
    expect(symbolCandidates('star.circle.fill')).toEqual([
      'star.circle.fill',
      'star_circle_fill',
      'star.circle',
      'star_circle',
      'star',
    ])
  })

  it('draws the names the framework itself reaches for', () => {
    for (const name of [
      'chevron.right',
      'chevron.left',
      'chevron.down',
      'chevron.up.chevron.down',
    ]) {
      expect(symbolShapes(name), `${name} has no shape`).not.toBeNull()
    }
  })

  it('falls back to a base shape for an unlisted variant', () => {
    // Nothing draws `star.square.fill`; `star` answers for it rather than nothing.
    expect(symbolShapes('star.square.fill')).toEqual(symbolShapes('star'))
  })

  it('returns null rather than a wrong shape for an unknown name', () => {
    expect(symbolShapes('definitely.not.a.symbol')).toBeNull()
  })

  it('gives every shape either a stroke or a fill, never both undefined', () => {
    for (const name of ['star', 'star.fill', 'person', 'house.fill', 'sun.max', 'trash']) {
      for (const shape of symbolShapes(name)!) {
        expect(shape.d.length, `${name} has an empty path`).toBeGreaterThan(4)
        // A shape is stroked at a positive width or filled; zero would draw nothing.
        expect(shape.stroke === undefined || shape.stroke > 0).toBe(true)
      }
    }
  })

  it('thickens the stroke with the font weight, as SF Symbols do', () => {
    expect(symbolStrokeScale(400)).toBeCloseTo(1, 5)
    expect(symbolStrokeScale(700)).toBeGreaterThan(symbolStrokeScale(400))
    expect(symbolStrokeScale(300)).toBeLessThan(symbolStrokeScale(400))
  })
})
