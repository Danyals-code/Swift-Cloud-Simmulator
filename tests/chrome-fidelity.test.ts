import { surfaceRadius, worldFrame } from './render-geometry'
import { describe, expect, it } from 'vitest'
import type { CompileRequest, RenderNode } from '@studio/shared'
import { symbolCandidates } from '@studio/shared'
import { symbolAsset, symbolStrokeScale } from '@studio/swiftui-render-dom'
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
  const c = node.background?.kind === 'solid' ? node.background.color : null
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
  it('floats a rounded blur surface inside the screen margins', () => {
    const tree = compileSource(
      app(`        TabView {
            Text("One").tabItem { Label("One", systemImage: "house") }
            Text("Two").tabItem { Label("Two", systemImage: "gear") }
        }`),
    ).renderTree!

    const panel = tree.nodes.find(n => n.id === 'tabbar-surface-material')!
    expect(panel.material).toBeDefined()
    expect(surfaceRadius(tree.nodes, panel)).toBeGreaterThanOrEqual(panel.frame.height / 2)
    expect(panel.frame.width).toBeLessThan(device.width)
    expect(tree.nodes.some(n => n.id === 'tab-0-selectedf')).toBe(true)
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
      expect(symbolAsset(name), `${name} has no shape`).not.toBeNull()
    }
  })

  it('preserves enclosure and fill for supported variants', () => {
    expect(symbolAsset('star.square.fill')).not.toEqual(symbolAsset('star'))
    expect(symbolAsset('star.square.fill')?.body).toContain('<mask')
    expect(symbolAsset('star.unknown')).toBeNull()
  })

  it('returns null rather than a wrong shape for an unknown name', () => {
    expect(symbolAsset('definitely.not.a.symbol')).toBeNull()
  })

  it('gives every shape either a stroke or a fill, never both undefined', () => {
    for (const name of ['star', 'star.fill', 'person', 'house.fill', 'sun.max', 'trash']) {
      expect(symbolAsset(name)?.body, `${name} has no SVG`).toMatch(/<(use|path|circle|rect|ellipse|polyline|polygon|line) /)
    }
  })

  it('thickens the stroke with the font weight, as SF Symbols do', () => {
    expect(symbolStrokeScale(400)).toBeCloseTo(1, 5)
    expect(symbolStrokeScale(700)).toBeGreaterThan(symbolStrokeScale(400))
    expect(symbolStrokeScale(300)).toBeLessThan(symbolStrokeScale(400))
  })
})

/**
 * Phase 13.1-13.4 of the defect register.
 *
 * Three of these blanked the preview from Swift nobody would look at twice; the
 * fourth drew a bar filling from its middle. All four were found by rendering a
 * screen rather than by asking the matrix whether a name was supported, because in
 * every case the name was.
 */
describe('a contextual colour with a member on it', () => {
  function evaluates(body: string): void {
    const result = compileSource(app(body))
    const errors = result.diagnostics.filter((d) => d.severity === 'error')
    expect(errors.map((d) => d.message), body).toEqual([])
    expect(result.renderTree, `${body} produced no tree`).not.toBeNull()
  }

  /**
   * `.red` is a token until something says what it is, and a member says it as
   * clearly as a declaration does. Every one of these used to trap on "Value of type
   * 'Token' has no member 'opacity'" - and a trap does not fail one view, it stops
   * evaluation and leaves the whole screen on the last good tree.
   */
  it('does not trap on .opacity', () => {
    evaluates('        Text("x").foregroundStyle(.red.opacity(0.5))')
  })

  it('does not trap inside .shadow(color:), which is where it is usually written', () => {
    evaluates('        Text("x").shadow(color: .black.opacity(0.2), radius: 4)')
  })

  it('does not trap on .gradient, which takes no parentheses', () => {
    evaluates('        Rectangle().fill(.blue.gradient).frame(height: 40)')
  })

  it('resolves to the same colour the explicit spelling does', () => {
    const fill = (source: string): string => {
      const nodes = compileSource(source).renderTree!.nodes
      const painted = nodes.find((n) => n.background?.kind === 'solid' && n.background.color.a < 1)
      expect(painted, `nothing translucent in ${source}`).toBeDefined()
      const c = painted!.background?.kind === 'solid' ? painted!.background.color : null
      return `${c!.r},${c!.g},${c!.b},${c!.a}`
    }

    expect(fill(app('        Text("x").background(.red.opacity(0.5))'))).toBe(
      fill(app('        Text("x").background(Color.red.opacity(0.5))')),
    )
  })

  /**
   * The promotion is narrow on purpose: only members `Color` answers, and only names
   * the palette knows. A material is not a colour, and painting one as a flat fill
   * because the token happened to be asked for `.opacity` would put a plausible wrong
   * thing on the screen - which is the failure mode the whole register is about.
   */
  it('leaves a token that is not a colour as whatever it already was', () => {
    const nodes = compileSource(
      app('        Text("x").background(.ultraThinMaterial.opacity(0.5))'),
    ).renderTree!.nodes

    // Without the palette check the name resolves to nothing, `.opacity(0.5)` makes
    // that a half-transparent black, and the screen gets a grey wash no line of the
    // user's code asked for.
    const washed = nodes.filter((n) => n.background?.kind === 'solid' && n.background.color.a < 1)
    expect(washed.map((n) => n.id)).toEqual([])
  })
})

/**
 * `Color` was not the only type with the problem above.
 *
 * Checking the other contextual types is what 13.1 said to do, and `Font` had it:
 * `.font(.title.bold())` trapped on "Value of type 'Token' has no member 'bold'" and
 * took the screen with it, which is about as ordinary a line of SwiftUI as exists.
 */
describe('a contextual text style with a face change on it', () => {
  function face(body: string): string {
    const result = compileSource(app(body))
    expect(result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message), body)
      .toEqual([])

    const run = result.renderTree!.nodes.flatMap((n) => n.text?.runs ?? [])[0]
    expect(run, `nothing drawn for ${body}`).toBeDefined()
    const f = run!.font
    return `${f.size}/${f.weight}/${f.lineHeight}/${f.italic ? 'italic' : 'upright'}/${f.family.split(',')[0]}`
  }

  it('keeps the style size and takes the new weight', () => {
    expect(face('        Text("x").font(.title.bold())')).toBe('28/700/34/upright/-apple-system')
    expect(face('        Text("x").font(.body.weight(.semibold))')).toBe(
      '17/600/22/upright/-apple-system',
    )
  })

  /**
   * The line height is the reason the style keeps its *name* rather than resolving to
   * a point size: `.title` leads at 34, where a ratio recomputed from 28 rounds to 36.
   */
  it('keeps the leading the text-style table gives, not a ratio', () => {
    expect(face('        Text("x").font(.title.bold())').split('/')[2]).toBe('34')
  })

  it('takes italic and a monospaced design, and both at once with a weight', () => {
    expect(face('        Text("x").font(.caption.italic())')).toBe('12/400/16/italic/-apple-system')
    expect(face('        Text("x").font(.title.monospaced())')).toBe('28/400/34/upright/ui-monospace')
    expect(face('        Text("x").font(.title.bold().italic())')).toBe('28/700/34/italic/-apple-system')
  })

  it('leaves the plain style and the system font alone', () => {
    expect(face('        Text("x").font(.title)')).toBe('28/400/34/upright/-apple-system')
    expect(face('        Text("x").font(.system(size: 20, weight: .bold))').startsWith('20/700/')).toBe(
      true,
    )
  })

  /** As narrow as the colour promotion: a project's own case is not a text style. */
  it('still reports a member on a token that is not a text style', () => {
    const result = compileSource(app('        Text("x").font(.notAStyle.bold())'))
    expect(result.diagnostics.map((d) => d.code)).toContain('runtime_trap')
  })
})

describe('a determinate progress bar', () => {
  function bar(body: string): { track: RenderNode; fill: RenderNode } {
    const nodes = compileSource(app(body)).renderTree!.nodes
    const track = nodes.find((n) => n.id.includes('track'))
    const fill = nodes.find((n) => n.id.endsWith('fill') || n.id.endsWith('-fillf'))
    expect(track, 'no track').toBeDefined()
    expect(fill, 'no fill').toBeDefined()
    return { track: { ...track!, frame: worldFrame(nodes, track!) }, fill: { ...fill!, frame: worldFrame(nodes, fill!) } }
  }

  /**
   * The fill was drawn full width and then scaled horizontally, and CSS scales about
   * the centre unless told otherwise - so a 40% bar was grey, blue, grey, with the
   * blue in the middle. It is a real width now, which also stops the rounded cap at
   * the end of the bar being squashed into an ellipse on the way.
   */
  it('starts at the leading edge of its track', () => {
    const { track, fill } = bar('        ProgressView(value: 0.4).padding()')
    expect(fill.frame.x).toBe(track.frame.x)
  })

  it('is as wide as the fraction of the track it represents', () => {
    const { track, fill } = bar('        ProgressView(value: 0.4).padding()')
    expect(fill.frame.width / track.frame.width).toBeCloseTo(0.4, 2)
  })

  it('draws the whole track at one', () => {
    const { track, fill } = bar('        ProgressView(value: 1).padding()')
    expect(fill.frame.width).toBeCloseTo(track.frame.width, 5)
  })

  it('applies to a Gauge, which is the same drawing with a range', () => {
    const { track, fill } = bar('        Gauge(value: 3, in: 0...4) { Text("n") }.padding()')
    expect(fill.frame.x).toBe(track.frame.x)
    expect(fill.frame.width / track.frame.width).toBeCloseTo(0.75, 2)
  })
})

describe('a sheet detent', () => {
  function sheetTop(detents: string): number {
    const source = app(`        Text("under")
            .sheet(isPresented: .constant(true)) {
                Text("sheet")${detents}
            }`)
    const nodes = compileSource(source).renderTree!.nodes
    const panel = nodes.find((n) => n.id === 'overlay-surface')
    expect(panel, `no sheet panel; ids were ${nodes.map((n) => n.id).join(' ')}`).toBeDefined()
    return panel!.frame.y
  }

  /**
   * `.presentationDetents` goes on the sheet's *content*, and the lookup read the
   * modifiers of the view carrying `.sheet` - which is not where anybody writes it.
   * Nothing was ever found, so every sheet in every project was a large one and a
   * `.medium` sheet could not be seen at all.
   */
  it('is read from the sheet content, so medium is about half the screen', () => {
    expect(sheetTop('.presentationDetents([.medium])') / device.height).toBeCloseTo(0.5, 1)
  })

  it('still defaults to large when nothing asks for a detent', () => {
    expect(sheetTop('')).toBeLessThan(sheetTop('.presentationDetents([.medium])'))
  })

  it('takes a fraction, and a smaller one sits lower', () => {
    expect(sheetTop('.presentationDetents([.fraction(0.3)])')).toBeGreaterThan(
      sheetTop('.presentationDetents([.medium])'),
    )
  })
})

describe('a view name the preview does not draw', () => {
  /**
   * `ContentUnavailableView` was in no table, so it was a typo, and a typo is
   * blocking - one empty-state view anywhere in a file blanked the whole preview. It
   * degrades the way `Chart` and `Map` already did.
   */
  it('warns and draws a placeholder rather than blanking the screen', () => {
    const result = compileSource(app('        PhaseAnimator([1, 2]) { _ in Text("x") }'))

    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(result.diagnostics.map((d) => d.code)).toContain('unsupported_swiftui_view')
    expect(result.renderTree!.nodes.some((n) => n.kind === 'placeholder')).toBe(true)
  })

  /**
   * `ContentUnavailableView` is the name that found this, and it is drawn now rather
   * than placeholdered: an empty state is what a screen shows before it has anything
   * to show, so it is among the first things written and the first things looked at.
   */
  it('draws ContentUnavailableView, including the stock search spelling', () => {
    const drawn = (body: string) => {
      const result = compileSource(app(body))
      expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
      expect(result.renderTree!.nodes.some((n) => n.kind === 'placeholder')).toBe(false)
      return {
        text: result.renderTree!.nodes.flatMap((n) => n.text?.runs.map((r) => r.text) ?? []),
        symbols: result.renderTree!.nodes.flatMap((n) => (n.image?.symbol ? [n.image.symbol] : [])),
      }
    }

    expect(drawn('        ContentUnavailableView("No Results", systemImage: "magnifyingglass")')).toEqual({
      text: ['No Results'],
      symbols: ['magnifyingglass'],
    })

    // The static-member spelling arrives carrying nothing at all, and stands for text
    // iOS supplies itself.
    expect(drawn('        ContentUnavailableView.search')).toEqual({
      text: ['No Results'],
      symbols: ['magnifyingglass'],
    })

    // `description:` takes a `Text`, so it arrives as a view rather than as a string.
    expect(
      drawn(
        '        ContentUnavailableView("No Mail", systemImage: "tray", description: Text("New mail appears here."))',
      ).text,
    ).toEqual(['No Mail', 'New mail appears here.'])
  })

  it('still reports a real typo as an error', () => {
    const result = compileSource(app('        ContentUnavailabeView("No Results")'))
    expect(result.diagnostics.some((d) => d.code === 'unresolved_identifier')).toBe(true)
  })

  /**
   * The list answers on the strength of a name, and several of those names are ones
   * an app would reasonably declare for itself. `enum Tab` is how a `TabView`
   * selection is written, and `Tab.allCases` used to answer with a *view* - a wrong
   * answer that surfaced two members later as "Value of type 'View' has no member
   * 'count'".
   */
  it('lets a type the project declared win over the SwiftUI name', () => {
    const result = compileSource(`import SwiftUI

enum Tab: String, CaseIterable { case home, search }

@main
struct DemoApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}

struct ContentView: View {
    var body: some View {
        Text("\\(Tab.allCases.count)")
    }
}
`)

    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const runs = result.renderTree!.nodes.flatMap((n) => n.text?.runs.map((r) => r.text) ?? [])
    expect(runs).toContain('2')
  })
})

/**
 * Phase 13.5-13.8 of the defect register.
 *
 * Four bugs about what colour a thing is when nothing has said. None of them belongs
 * to a view - they belong to every view at once, which is why a sweep by name could
 * not see them and one screenshot could.
 */

/** The colour of the run with this text, as `r,g,b,a`. */
function runColor(source: string, text: string): string {
  const nodes = compileSource(source).renderTree!.nodes
  for (const node of nodes) {
    for (const run of node.text?.runs ?? []) {
      if (run.text === text) return `${run.color.r},${run.color.g},${run.color.b},${run.color.a}`
    }
  }
  const seen = nodes.flatMap((n) => n.text?.runs.map((r) => r.text) ?? [])
  throw new Error(`no run "${text}"; the screen has ${JSON.stringify(seen)}`)
}

const BLUE = '0,136,255,1'
const RED = '255,59,48,1'
const BLACK = '0,0,0,1'

describe('what colour a label is when nothing has said', () => {
  /**
   * `Color.primary` was 85% black, and the missing 15% was on every string on every
   * screen: titles, rows, bars, buttons. Nothing pointed at it and every screenshot
   * showed it.
   */
  it('is opaque, the way UIColor.label is', () => {
    expect(runColor(app('        Text("Plain")'), 'Plain')).toBe(BLACK)
  })

  it('is opaque white in dark mode, not 90%', () => {
    const nodes = compileSource(app('        Text("Plain")'), 'dark').renderTree!.nodes
    const run = nodes.flatMap((n) => n.text?.runs ?? []).find((r) => r.text === 'Plain')
    expect(`${run!.color.r},${run!.color.g},${run!.color.b},${run!.color.a}`).toBe('255,255,255,1')
  })

  it('leaves the secondary levels translucent, which is how they work over colour', () => {
    expect(runColor(app('        Text("Quiet").foregroundStyle(.secondary)'), 'Quiet')).toBe(
      '60,60,67,0.6',
    )
  })

  /** `.tint` as a shape style resolved to the label colour, so it read as plain text. */
  it('resolves .tint as a style to the accent colour', () => {
    expect(runColor(app('        Text("New").foregroundStyle(.tint)'), 'New')).toBe(BLUE)
  })
})

describe('a button label', () => {
  /**
   * `applyButtonStyle` returned the label untouched for `.automatic`, `.borderless`
   * and `.plain` - which is three of the five styles and both of the defaults - so
   * every button, toolbar item and alert button was drawn in the label colour. The
   * blue is how an iOS screen says what is pressable.
   */
  it('is the accent colour by default', () => {
    expect(runColor(app('        Button("Tap") { }'), 'Tap')).toBe(BLUE)
  })

  it('is the accent colour in a toolbar, which is where it is most visible', () => {
    const source = app(`        NavigationStack {
            Text("body")
                .navigationTitle("Mail")
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Edit") { } } }
        }`)
    expect(runColor(source, 'Edit')).toBe(BLUE)
  })

  it('is red for a destructive role', () => {
    expect(runColor(app('        Button("Delete", role: .destructive) { }'), 'Delete')).toBe(RED)
  })

  it('is red for a destructive role inside a bordered button too', () => {
    const source = app('        Button("Delete", role: .destructive) { }.buttonStyle(.bordered)')
    expect(runColor(source, 'Delete')).toBe(RED)
  })

  /** `.plain` is the style that exists to opt out, and it has to keep working. */
  it('keeps the inherited colour under .plain', () => {
    expect(runColor(app('        Button("Quiet") { }.buttonStyle(.plain)'), 'Quiet')).toBe(BLACK)
  })

  it('follows .tint when one is given', () => {
    const source = app('        Button("Pink") { }.tint(.pink)')
    expect(runColor(source, 'Pink')).toBe('255,45,85,1')
  })

  it('is still white on the fill of a prominent button', () => {
    const source = app('        Button("Go") { }.buttonStyle(.borderedProminent)')
    expect(runColor(source, 'Go')).toBe('255,255,255,1')
  })

  /**
   * The alert is where the role matters most: "Delete" and "Cancel" the same colour
   * is the one place a preview being pretty-but-wrong could cost somebody data.
   */
  it('is tinted inside an alert, and red for the destructive one', () => {
    const source = app(`        Text("under")
            .alert("Delete?", isPresented: .constant(true)) {
                Button("Cancel", role: .cancel) { }
                Button("Delete", role: .destructive) { }
            }`)

    expect(runColor(source, 'Cancel')).toBe(BLUE)
    expect(runColor(source, 'Delete')).toBe(RED)
  })

  it('leaves a label that sets its own colour alone', () => {
    const source = app('        Button { } label: { Text("Mine").foregroundStyle(.green) }')
    expect(runColor(source, 'Mine')).toBe('52,199,89,1')
  })
})

/**
 * Phase 13.9-13.16 of the defect register: the chrome.
 *
 * None of these was a missing feature. Every one was a detail of something already
 * drawn, which is why the sweep by name could not see them and one screenshot could.
 */

describe('an alert', () => {
  const alert = (buttons: string, message = '') =>
    app(`        Text("under")
            .alert("Delete Account?", isPresented: .constant(true)) {
${buttons}
            }${message}`)

  const TWO = alert(
    `                Button("Delete", role: .destructive) { }
                Button("Cancel", role: .cancel) { }`,
    ' message: { Text("This cannot be undone.") }',
  )

  function nodesOf(source: string): readonly RenderNode[] {
    return compileSource(source).renderTree!.nodes
  }

  it('uses the captured native alert width', () => {
    const panel = nodesOf(TWO).find((n) => n.id.startsWith('ov-bg'))
    expect(panel!.frame.width).toBe(320)
  })

  /** A flat panel over a dimmed screen is the part a screenshot always gave away. */
  it('is a material rather than a flat fill', () => {
    const panel = nodesOf(TWO).find((n) => n.material)
    expect(panel, 'no material behind the alert').toBeDefined()
  })

  it('uses separated pill actions without an old-style divider strip', () => {
    const nodes = nodesOf(TWO)
    const pills = nodes.filter(n => /^ov-btn\d-pillf$/.test(n.id))
    expect(pills).toHaveLength(2)
    expect(nodes.some(n => n.id.startsWith('ov-btnrule'))).toBe(false)
    expect(pills[0]!.frame).toMatchObject({ width: 140, height: 48 })
    expect(worldFrame(nodes, pills[1]!).x - worldFrame(nodes, pills[0]!).x - pills[0]!.frame.width).toBe(8)
  })

  /**
   * And it must not be greedy. A `maxHeight: .infinity` on that vertical rule took
   * every point the screen would give and turned a two-button alert into a panel the
   * height of the phone.
   */
  it('hugs its content rather than filling the screen', () => {
    const panel = nodesOf(TWO).find((n) => n.id.startsWith('ov-bg'))!
    expect(panel.frame.height).toBeLessThan(200)
  })

  it('stacks three buttons as full-width rows instead', () => {
    const nodes = nodesOf(
      alert(`                Button("One") { }
                Button("Two") { }
                Button("Cancel", role: .cancel) { }`),
    )
    const rules = nodes.filter((n) => /^ov-btn\d-pillf$/.test(n.id))

    expect(rules.length).toBe(3)
    for (const rule of rules) expect(rule.frame.width).toBe(288)
  })

  /**
   * SwiftUI reorders: the cancel goes leading in a pair and last in a stack, whatever
   * order it was declared in. Declared first here, and it must still not be first.
   */
  it('moves the cancel button leading in a pair, whatever order it was written in', () => {
    const nodes = nodesOf(
      alert(`                Button("Cancel", role: .cancel) { }
                Button("Delete", role: .destructive) { }`),
    )
    const run = (text: string) =>
      nodes.find((n) => n.text?.runs.some((r) => r.text === text))!.frame.x

    expect(run('Cancel')).toBeLessThan(run('Delete'))
  })

  /** Its one visual effect on iOS, and only inside an alert. */
  it('uses the regular weight captured in native alert actions', () => {
    const nodes = nodesOf(TWO)
    const weight = (text: string) =>
      nodes.flatMap((n) => n.text?.runs ?? []).find((r) => r.text === text)!.font.weight

    expect(weight('Cancel')).toBe(400)
    expect(weight('Delete')).toBe(400)
  })
})

describe('a segmented picker', () => {
  const SEGMENTS = app(`        Picker("Mode", selection: .constant(0)) {
            Text("One").tag(0)
            Text("Two").tag(1)
            Text("Three").tag(2)
        }
        .pickerStyle(.segmented)`)

  it('uses capsule track and selected segment without old divider rules', () => {
    const nodes = compileSource(SEGMENTS).renderTree!.nodes
    const track = nodes.find(n => n.id.endsWith('segtrackf'))!
    const selected = nodes.find(n => n.id.endsWith('seg0bgf'))!
    expect(track.frame.height).toBe(32)
    expect(surfaceRadius(nodes, track)).toBeGreaterThanOrEqual(16)
    expect(surfaceRadius(nodes, selected)).toBeGreaterThanOrEqual(selected.frame.height / 2)
    expect(nodes.filter(n => /seg\ddivl$/.test(n.id))).toHaveLength(0)
    expect(track.background).toEqual({ kind: 'solid', color: { r: 238, g: 238, b: 239, a: 1 } })
  })

  it('labels segments at 13pt, semibold on the chosen one', () => {
    const runs = compileSource(SEGMENTS).renderTree!.nodes.flatMap((n) => n.text?.runs ?? [])
    const one = runs.find((r) => r.text === 'One')!
    const two = runs.find((r) => r.text === 'Two')!

    expect(one.font.size).toBe(13)
    expect(one.font.weight).toBe(600)
    expect(two.font.weight).toBe(400)
  })
})

describe('an indeterminate ProgressView', () => {
  /**
   * It was a filled `secondaryLabel` circle, and the comment beside it claimed a
   * dotted ring the renderer spun. Neither half was true of what appeared.
   */
  it('is a spinner rather than a filled dot', () => {
    const nodes = compileSource(app('        ProgressView()')).renderTree!.nodes
    expect(nodes.some((n) => n.shape?.shape === 'spinner')).toBe(true)
    expect(nodes.some((n) => n.shape?.shape === 'circle')).toBe(false)
  })
})

describe('the search field', () => {
  const SEARCH = app(`        NavigationStack {
            List { Text("row") }
                .navigationTitle("Mail")
                .searchable(text: .constant(""))
        }`)

  /**
   * The hit target used to wrap the whole padded box, and the renderer draws a text
   * field as an `<input>` at `inset: 0` of whatever it is put on - so the input
   * covered the magnifying glass and no search bar the studio drew ever had one.
   */
  it('draws the magnifying glass', () => {
    const symbols = compileSource(SEARCH).renderTree!.nodes.flatMap((n) =>
      n.image?.symbol ? [n.image.symbol] : [],
    )
    expect(symbols).toContain('magnifyingglass')
  })

  it('scopes the text field to the part beside the glass, not the whole box', () => {
    const nodes = compileSource(SEARCH).renderTree!.nodes
    const field = nodes.find((n) => n.hitTarget?.role === 'textField')!
    const glass = nodes.find((n) => n.image?.symbol === 'magnifyingglass')!

    expect(field.frame.x).toBeGreaterThan(glass.frame.x + glass.frame.width - 1)
  })
})

describe('inset grouped sections', () => {
  function sectionCards(source: string) {
    const nodes = compileSource(source).renderTree!.nodes
    return nodes.filter(n => /s\dbg/.test(n.id) && n.background).map(n => {
      let y = n.frame.y, parent = n.parent
      while (parent) { const p = nodes.find(n => n.id === parent)!; y += p.frame.y; parent = p.parent }
      return { ...n, frame: { ...n.frame, y } }
    }).sort((a, b) => a.frame.y - b.frame.y)
  }
  const TWO_SECTIONS = app(`        Form {
            Section { Text("first") }
            Section { Text("second") }
        }`)

  /**
   * A header supplies the gap through its own top padding; a section without one used
   * to supply nothing, so two headerless sections drew as one card with a hairline
   * between them - which says the opposite of what a section break says.
   */
  it('leave a gap between cards that have no header', () => {
    const cards = sectionCards(TWO_SECTIONS)

    expect(cards.length).toBe(2)
    expect(cards[1]!.frame.y - (cards[0]!.frame.y + cards[0]!.frame.height)).toBeGreaterThan(8)
  })

  it('keeps the profile top margin above the first card', () => {
    expect(sectionCards(TWO_SECTIONS)[0]!.frame.y - device.safeArea.top).toBe(10)
  })

  /**
   * A section with a header already has its gap: the header's top padding is it, and
   * the text sits inside. Adding the spacer there too would double it.
   */
  it('do not double the gap when the section has a header', () => {
    const gapBetween = (source: string): number => {
      const cards = sectionCards(source)
      return cards[1]!.frame.y - (cards[0]!.frame.y + cards[0]!.frame.height)
    }

    const headed = gapBetween(
      app(`        Form {
            Section("First") { Text("a") }
            Section("Second") { Text("b") }
        }`),
    )

    // Bigger than the plain gap, because the header text lives in it - and not the
    // plain gap *plus* a header block, which is what doubling would look like.
    expect(headed).toBeGreaterThan(gapBetween(TWO_SECTIONS))
    expect(headed).toBeLessThan(gapBetween(TWO_SECTIONS) + 40)
  })
})

describe('style token coverage', () => {
  /**
   * Supported tokens must paint a style; unsupported tokens must warn. Glass
   * styles are intentionally approximated with blur in the iOS 27 profile.
   */
  it('uses blur for the supported glass style', () => {
    const result = compileSource(app('        Button("x") { }.buttonStyle(.glass)'))
    const warning = result.diagnostics.find((d) => d.severity === 'warning')

    expect(warning).toBeUndefined()
    expect(result.renderTree?.nodes.some((n) => n.material?.blur === 12)).toBe(true)
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('covers every style modifier with a closed set of tokens, not only buttonStyle', () => {
    const warned = (body: string) =>
      compileSource(app(body)).diagnostics.some((d) => d.severity === 'warning')

    expect(warned('        Text("x").pickerStyle(.carousel)')).toBe(true)
    expect(warned('        Text("x").toggleStyle(.neon)')).toBe(true)
    expect(warned('        Text("x").listStyle(.hexagonal)')).toBe(true)
  })

  it('stays quiet for every style that is drawn, including the default spellings', () => {
    const quiet = (body: string) =>
      compileSource(app(body)).diagnostics.filter((d) => d.severity === 'warning')

    for (const body of [
      '        Button("x") { }.buttonStyle(.bordered)',
      '        Button("x") { }.buttonStyle(.borderedProminent)',
      '        Button("x") { }.buttonStyle(.plain)',
      '        Button("x") { }.buttonStyle(.automatic)',
      '        Toggle("t", isOn: .constant(true)).toggleStyle(.button)',
      '        List { Text("x") }.listStyle(.plain)',
      '        Button("x") { }.controlSize(.large)',
    ]) {
      expect(quiet(body).map((d) => d.message), body).toEqual([])
    }
  })

  /** A style in a variable has no value here, and guessing would warn on correct code. */
  it('says nothing about a style it cannot see', () => {
    const source = `import SwiftUI

@main
struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }

struct ContentView: View {
    let style = BorderedButtonStyle()
    var body: some View { Button("x") { }.buttonStyle(style) }
}
`
    expect(compileSource(source).diagnostics.filter((d) => d.severity === 'warning')).toEqual([])
  })
})

describe('the symbol table', () => {
  /**
   * `tray` was in neither the drawn table nor the Unicode fallback, so an inbox row
   * drew `▢` beside the word "Inbox". Added by frequency, which is the rule for this
   * table rather than alphabetical order.
   */
  it('draws the names the sample screens reached for and missed', () => {
    for (const name of [
      'tray',
      'tray.fill',
      'paperclip',
      'shield',
      'waveform',
      'percent',
      'thermometer',
      'hourglass',
      'alarm',
      'iphone',
      'tv',
      'keyboard',
      'airplane',
      'chart.pie',
      'list.dash',
      'text.aligncenter',
      'text.alignright',
    ]) {
      expect(symbolAsset(name), `${name} has no shape`).not.toBeNull()
    }
  })

  it('keeps every new shape drawable: a path with either a stroke or a fill', () => {
    for (const name of ['tray', 'airplane', 'chart.pie', 'keyboard', 'waveform']) {
      expect(symbolAsset(name)?.body, `${name} has no SVG`).toMatch(/<(use|path|circle|rect|ellipse|polyline|polygon|line) /)
    }
  })
})
