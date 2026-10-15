import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CompileResult, RenderNode } from '@studio/shared'
import { applyEvent, compile, endLayerDraft, rerender, resetPipelineState, setMeasureTarget } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'
import { worldFrame } from './render-geometry'

/**
 * Swipe actions, context menus and list rows (Wave 4a), through `compile()`, against
 * what the iOS 27 simulator draws for tests/fixtures/ios27-system-ui-4a.swift.
 */

const native = JSON.parse(readFileSync(new URL('../docs/parity/native/iphone18pro-system-ui/measurements.json', import.meta.url), 'utf8')).measured
const device = DEVICES['iphone-18-pro']
let revision = 1

function run(body: string, members = ''): CompileResult {
  resetPipelineState()
  const result = compile({
    files: [{ id: 'App.swift', text: `import SwiftUI\n\n@main\nstruct ProbeApp: App {\n    var body: some Scene {\n        WindowGroup { RootView() }\n    }\n}\n\nstruct RootView: View {\n${members}\n    var body: some View {\n${body}\n    }\n}\n` }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  })
  expect(result.diagnostics.filter(d => d.severity === 'error').map(d => d.message)).toEqual([])
  return result
}

const nodes = (r: CompileResult) => r.renderTree?.nodes ?? []
const texts = (r: CompileResult) => nodes(r).flatMap(n => n.text?.runs.map(run => run.text) ?? [])
const frame = (r: CompileResult, node: RenderNode) => worldFrame(nodes(r), node)
const rounded = (f: { x: number; y: number; width: number; height: number }) => ({ x: Math.round(f.x * 3) / 3, y: Math.round(f.y * 3) / 3, width: Math.round(f.width * 3) / 3, height: Math.round(f.height * 3) / 3 })
/** The control a person would tap by this name. */
const control = (r: CompileResult, label: string) => nodes(r).find(n => n.hitTarget?.enabled && n.a11y?.label === label)
/** The colour drawn topmost at the middle of a node, as a hit target is drawn beside what it covers. */
function fillOf(r: CompileResult, node: RenderNode): number[] | undefined {
  const at = frame(r, node), x = at.x + at.width / 2, y = at.y + at.height / 2
  const filled = nodes(r).filter(n => {
    const f = frame(r, n)
    return n.background?.kind === 'solid' && f.x <= x && x <= f.x + f.width && f.y <= y && y <= f.y + f.height
  }).at(-1)?.background
  return filled?.kind === 'solid' ? [filled.color.r, filled.color.g, filled.color.b] : undefined
}
/** The rows that swipe, in order. */
const rows = (r: CompileResult) => nodes(r).filter(n => n.hitTarget?.role === 'drag')

/**
 * Drags a row sideways, by `dx` points, and lets go unless it is `changed`, held there:
 * negative towards its trailing actions. As the preview sends it, the drag moves the row
 * before it ends, each event drawn before the next.
 */
function swipe(r: CompileResult, index: number, dx: number, phase: 'changed' | 'ended' = 'ended'): CompileResult {
  const handlerId = rows(r)[index]!.hitTarget!.handlerId
  const drag = (phase: 'changed' | 'ended') => applyEvent({ kind: 'drag', handlerId, phase, location: { x: dx, y: 0 }, startLocation: { x: 0, y: 0 }, translation: { x: dx, y: 0 } })
  drag('changed')
  if (phase === 'changed') return rerender(revision++)
  rerender(revision++)
  drag('ended')
  return rerender(revision++)
}

const ICONS = `        List {
            Text("Icons")
                .swipeActions {
                    Button(role: .destructive) { } label: {
                        Label("Delete", systemImage: "trash")
                    }
                    .labelStyle(.iconOnly)
                    Button { } label: {
                        Label("Flag", systemImage: "flag")
                    }
                    .labelStyle(.iconOnly)
                    .tint(.orange)
                }
            Text("Plain row")
        }`

describe('swipe actions', () => {
  it('opens a row swiped left to its trailing actions, each a capsule where iOS 27 draws it', () => {
    const closed = run(ICONS)
    expect(closed.diagnostics).toEqual([])
    expect(texts(closed)).toContain('Icons')
    expect(control(closed, 'Flag')).toBeUndefined()

    const open = swipe(closed, 0, -140)
    const measured = native.swipeActions.trailing.icons.actions as { x: [number, number] }[]
    // The fixture's row is the second; this one is the first, 52 higher.
    const y = native.swipeActions.trailing.labels.y as [number, number]
    expect(rounded(frame(open, control(open, 'Flag')!))).toEqual({ x: measured[0]!.x[0], y: y[0], width: measured[0]!.x[1] - measured[0]!.x[0], height: y[1] - y[0] })
    expect(rounded(frame(open, control(open, 'Delete')!))).toEqual({ x: measured[1]!.x[0], y: y[0], width: measured[1]!.x[1] - measured[1]!.x[0], height: y[1] - y[0] })
  })

  it('fills each action with its tint, red for a destructive role and systemGray3 for neither', () => {
    const open = swipe(run(`        List {
            Text("Titles")
                .swipeActions {
                    Button("Archive") { }
                        .tint(.blue)
                    Button("More") { }
                    Button("Remove", role: .destructive) { }
                }
        }`), 0, -140)
    const measured = native.swipeActions.trailing.titles.actions as { fill: number[] }[]
    expect(fillOf(open, control(open, 'Archive')!)).toEqual(measured[1]!.fill)
    expect(fillOf(open, control(open, 'More')!)).toEqual(measured[0]!.fill)
    expect(fillOf(open, control(open, 'Remove')!)).toEqual(native.swipeActions.trailing.labels.actions[1].fill)
  })

  it('tints an action with no tint of its own from a .tint around the list, and not from .accentColor, as iOS 27 does', () => {
    const fill = (modifier: string) => {
      const open = swipe(run(`        List {
            Text("Row")
                .swipeActions {
                    Button("More") { }
                }
        }
        .${modifier}(.green)`), 0, -140)
      return fillOf(open, control(open, 'More')!)
    }
    expect(fill('tint')).toEqual(native.swipeActions.tint.listTint)
    expect(fill('accentColor')).toEqual(native.swipeActions.tint.listAccentColor)
  })

  it('fills the open row systemGray5 and leaves out the separators beside it', () => {
    const closed = run(ICONS.replace('Text("Plain row")', 'Text("Plain row")\n            Text("Last row")'))
    expect(nodes(closed).filter(n => n.id.endsWith('sepl'))).toHaveLength(2)
    const open = swipe(closed, 0, -140)
    expect(fillOf(open, rows(open)[0]!)).toEqual(native.swipeActions.openRow.fill)
    expect(nodes(open).filter(n => n.id.endsWith('sepl'))).toHaveLength(1)
  })

  it('opens a row swiped right to its leading actions, the first written outermost', () => {
    const closed = run(`        List {
            Text("Leading icons")
                .swipeActions(edge: .leading) {
                    Button { } label: { Label("Delete", systemImage: "trash") }
                        .labelStyle(.iconOnly)
                        .tint(.red)
                    Button { } label: { Label("Flag", systemImage: "flag") }
                        .labelStyle(.iconOnly)
                        .tint(.orange)
                }
        }`)
    // Swiped the other way, towards an edge with no actions, it stays shut.
    expect(control(swipe(closed, 0, -140), 'Flag')).toBeUndefined()
    const open = swipe(closed, 0, 140)
    const measured = native.swipeActions.leading.icons as { row: number[]; actions: { x: [number, number] }[] }
    const across = (label: string) => { const f = frame(open, control(open, label)!); return [Math.round(f.x * 3) / 3, Math.round((f.x + f.width) * 3) / 3] }
    expect(across('Delete')).toEqual(measured.actions[0]!.x)
    expect(across('Flag')).toEqual(measured.actions[1]!.x)
    const slid = nodes(open).find(n => n.id.endsWith('swipebgf'))!
    expect(Math.round(frame(open, slid).x)).toBe(measured.row[0])
  })

  it('gives actions of one kind the widest one\'s width, and an action with an icon beside titles alone its own', () => {
    const width = (r: CompileResult, label: string) => Math.round(control(r, label)!.frame.width)
    const titles = swipe(run(`        List {
            Text("Short and long")
                .swipeActions {
                    Button("A") { }
                    Button("Longer title") { }
                }
        }`), 0, -140)
    expect(width(titles, 'A')).toBe(width(titles, 'Longer title'))
    const mixed = swipe(run(`        List {
            Text("Leading")
                .swipeActions(edge: .leading) {
                    Button("Pin") { }
                    Button { } label: { Label("Unread", systemImage: "envelope.badge") }
                }
        }`), 0, 140)
    expect(width(mixed, 'Pin')).toBeLessThan(width(mixed, 'Unread'))
  })

  it('runs a tapped action and shuts its row', () => {
    let r = swipe(run(`        List {
            Text("Count \\(count)")
                .swipeActions {
                    Button("Add") { count += 1 }
                }
        }`, '    @State private var count = 0'), 0, -140)
    applyEvent({ kind: 'tap', handlerId: control(r, 'Add')!.hitTarget!.handlerId, location: { x: 0, y: 0 } })
    r = rerender(revision++)
    expect(texts(r)).toContain('Count 1')
    expect(control(r, 'Add')).toBeUndefined()
  })

  it('grows the outermost action into a drag past the open row, and fades the others, as iOS 27 does', () => {
    const dragged = swipe(run(`        List {
            Text("Full swipe")
                .swipeActions {
                    Button(role: .destructive) { } label: {
                        Label("Delete", systemImage: "trash")
                    }
                    Button("Flag") { }
                        .tint(.orange)
                }
        }`), 0, -241, 'changed')
    const measured = native.swipeActions.fullSwipe.stretched as { first: [number, number]; other: { x: [number, number]; opacity: number } }
    const outer = frame(dragged, control(dragged, 'Delete')!)
    // Within the 2 points the preview's estimate of "Flag" differs by.
    expect(Math.abs(outer.x - measured.first[0])).toBeLessThan(2)
    expect(Math.abs(outer.x + outer.width - measured.first[1])).toBeLessThan(1)
    expect(nodes(dragged).find(n => n.id.endsWith('swipe-trailing-1capsulef'))!.opacity).toBe(measured.other.opacity)
  })

  it('runs the outermost action when swiped most of the way across, unless allowsFullSwipe is false', () => {
    const source = (full: string) => run(`        List {
            ForEach(items, id: \\.self) { item in
                Text(item)
                    .swipeActions(${full}) {
                        Button(role: .destructive) { items.removeAll { $0 == item } } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        Button("Flag") { }
                    }
            }
        }`, '    @State private var items = ["One", "Two"]')
    expect(texts(swipe(source('edge: .trailing'), 0, -330))).not.toContain('One')
    const kept = swipe(source('edge: .trailing, allowsFullSwipe: false'), 0, -330)
    expect(texts(kept)).toContain('One')
    expect(control(kept, 'Delete')).toBeDefined()
  })

  it('draws the Delete .onDelete makes as an action, which trailing actions replace and leading ones keep', () => {
    const r = run(`        List {
            ForEach(items, id: \\.self) { item in
                if item == "Leading" {
                    Text(item)
                        .swipeActions(edge: .leading) {
                            Button("Pin") { }
                        }
                } else if item == "Trailing" {
                    Text(item)
                        .swipeActions {
                            Button("Flag") { }
                        }
                } else {
                    Text(item)
                }
            }
            .onDelete { items.remove(atOffsets: $0) }
        }`, '    @State private var items = ["Plain", "Leading", "Trailing"]')
    const measured = native.swipeActions.onDelete.withLeadingActions.action as { x: [number, number]; fill: number[] }
    for (const index of [0, 1]) {
      const open = swipe(r, index, -140)
      const del = control(open, 'Delete')!
      expect(fillOf(open, del)).toEqual(measured.fill)
      expect(nodes(open).some(n => n.image?.symbol === 'trash')).toBe(true)
      expect(Math.round(frame(open, del).x + frame(open, del).width)).toBe(Math.round(measured.x[1]))
    }
    const trailing = swipe(r, 2, -140)
    expect(control(trailing, 'Delete')).toBeUndefined()
    expect(control(trailing, 'Flag')).toBeDefined()
  })
})

describe('list rows', () => {
  const LIST_ROWS = `        List {
            Text("Background")
                .listRowBackground(Color.yellow)
            Text("Insets")
                .listRowInsets(EdgeInsets(top: 8, leading: 40, bottom: 8, trailing: 16))
            Text("Red separator")
                .listRowSeparatorTint(.red)
            Text("Blue separator above")
                .listRowSeparatorTint(.blue, edges: .top)
            Text("No separator")
                .listRowSeparator(.hidden)
            Text("Plain row")
        }`

  it('draws each separator where iOS 27 does, in the tint of the row that names its edge', () => {
    const r = run(LIST_ROWS)
    expect(r.diagnostics).toEqual([])
    const drawn = nodes(r).filter(n => n.id.endsWith('sepl')).map(n => {
      const f = frame(r, n), fill = n.background?.kind === 'solid' ? n.background.color : undefined
      return { y: [f.y, f.y + f.height], x: [f.x, f.x + f.width], colour: fill && fill.a === 1 ? [fill.r, fill.g, fill.b] : 'separator' }
    })
    const measured = (native.listRows.separators as { y: number[]; x?: number[]; colour?: unknown; drawn?: false }[]).filter(s => s.drawn !== false)
    expect(drawn).toEqual(measured.map(({ y, x, colour }) => ({ y, x, colour })))
  })

  it('draws a row background over the whole row and its insets as iOS 27 does', () => {
    const r = run(LIST_ROWS)
    const background = nodes(r).find(n => n.id.endsWith('rowbgf'))!
    const f = frame(r, background)
    expect([f.x, f.y, f.width, f.height]).toEqual(native.listRows.background.row)
    const insets = nodes(r).find(n => n.text?.runs[0]?.text === 'Insets')!
    expect(frame(r, insets).x).toBe(16 + native.listRows.insets.leading)
  })
})

describe('reveal on selection, on the Design canvas only', () => {
  const SOURCE = `import SwiftUI

@main
struct RevealApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    var body: some View {
        List {
            Text("Swipe me")
                .swipeActions(edge: .leading) {
                    Button("Pin") { }
                        .tint(.yellow)
                }
            Text("Hold me")
                .contextMenu {
                    Button("Copy") { }
                }
            HStack {
                Text("Row content")
            }
            .swipeActions {
                Button("Flag") { }
            }
        }
    }
}
`
  /** Where these words are written, as the canvas's selection names a view. */
  const at = (words: string, end = words) => ({ file: 'App.swift', start: SOURCE.indexOf(words), end: SOURCE.indexOf(end) + end.length })
  const design = () => {
    resetPipelineState()
    return compile({ files: [{ id: 'App.swift', text: SOURCE }], canvas: { width: device.width, height: device.height }, safeArea: device.safeArea, colorScheme: 'light', revision: revision++, allPages: true })
  }
  const page = (r: CompileResult) => r.pages!.find(p => p.kind === 'root')!.tree
  const pageTexts = (r: CompileResult) => page(r).nodes.flatMap(n => n.text?.runs.map(run => run.text) ?? [])
  const liveTexts = (r: CompileResult) => texts(r)

  it('draws a row swiped open while one of its actions, or its slot, is selected', () => {
    setMeasureTarget(at('Button("Pin") { }'))
    const selected = design()
    expect(pageTexts(selected)).toContain('Pin')
    expect(liveTexts(selected)).not.toContain('Pin')
    // Its slot, by its closure or from the modifier's name on.
    setMeasureTarget(at('{\n                    Button("Pin")', '.tint(.yellow)\n                }'))
    expect(pageTexts(design())).toContain('Pin')
    setMeasureTarget(at('swipeActions(edge: .leading)', '.tint(.yellow)\n                }'))
    expect(pageTexts(design())).toContain('Pin')
    // The row itself, or nothing, draws it shut.
    setMeasureTarget(at('Text("Swipe me")', '.tint(.yellow)\n                }'))
    expect(pageTexts(design())).not.toContain('Pin')
    setMeasureTarget(null)
    expect(pageTexts(design())).not.toContain('Pin')
  })

  it('draws a context menu up while a view in it is selected', () => {
    setMeasureTarget(at('Button("Copy") { }'))
    const selected = design()
    expect(pageTexts(selected)).toContain('Copy')
    expect(liveTexts(selected)).not.toContain('Copy')
    // Under its row, the second of the list, where iOS 27 puts it after a long press.
    const panel = page(selected).nodes.find(n => n.id === 'overlay-menu')!
    const measured = native.contextMenu.panel.frame as number[]
    expect([panel.frame.x, panel.frame.y, panel.frame.width]).toEqual([measured[0], measured[1], measured[2]])
    setMeasureTarget(at('Text("Hold me")', 'Button("Copy") { }\n                }'))
    expect(pageTexts(design())).not.toContain('Copy')
  })

  it('draws a row shut, without running the program again, while a view in its content is selected', () => {
    design()
    setMeasureTarget(at('Text("Row content")'))
    const selected = endLayerDraft(revision++)
    expect(pageTexts(selected)).toContain('Row content')
    expect(pageTexts(selected)).not.toContain('Flag')
    // Only laid out again for the selection's handles: nothing it reveals changed.
    expect(selected.timings.evaluate).toBe(0)
  })

  it('draws what a new selection reveals without a compile, and draws it shut when the selection ends', () => {
    design()
    setMeasureTarget(at('Button("Pin") { }'))
    const opened = endLayerDraft(revision++)
    expect(pageTexts(opened)).toContain('Pin')
    expect(liveTexts(opened)).not.toContain('Pin')
    setMeasureTarget(null)
    expect(pageTexts(endLayerDraft(revision++))).not.toContain('Pin')
  })
})

describe('context menus', () => {
  it('opens on a long press as iOS 27 draws one: a dimmed screen and a panel of 42 point rows', () => {
    let r = run(`        List {
            Text("First row")
            Text("Hold me")
                .contextMenu {
                    Button { } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                    Button("Rename") { }
                    Button(role: .destructive) { } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            Text("Last row")
        }`)
    const held = nodes(r).find(n => n.hitTarget?.contextMenuHandlerId)!
    applyEvent({ kind: 'tap', handlerId: held.hitTarget!.contextMenuHandlerId!, location: { x: 1, y: 1 } })
    r = rerender(revision++)
    const measured = native.contextMenu
    const dim = nodes(r).find(n => n.id === 'overlay-dim')!
    expect(dim.background?.kind === 'solid' && dim.background.color.a).toBe(measured.backdrop.dim)
    const panel = nodes(r).find(n => n.id === 'overlay-menu')!
    expect([panel.frame.width, panel.frame.height]).toEqual([measured.panel.frame[2], measured.panel.frame[3]])
    const inPanel = (n: RenderNode) => { const f = frame(r, n), p = frame(r, panel); return { x: f.x - p.x, y: f.y - p.y, width: f.width, height: f.height } }
    const rowsDrawn = ['Copy', 'Rename', 'Delete'].map(label => inPanel(control(r, label)!))
    expect(rowsDrawn.map(row => [row.y, row.height])).toEqual([[10, 42], [52, 42], [94, 42]])
    const title = nodes(r).find(n => n.text?.runs[0]?.text === 'Rename')!
    expect(inPanel(title).x).toBe(measured.rows.titleFromPanel)
    const icon = nodes(r).find(n => n.image?.symbol === 'trash')!
    expect(inPanel(icon).x + inPanel(icon).width / 2).toBe(measured.rows.iconCentreFromPanel)
    expect(nodes(r).filter(n => n.id.includes('ov-sep'))).toEqual([])
  })

  /** The menu a long press on "Hold me" opens, and the Text it is written on. */
  function held(body: string): { r: CompileResult; panel: RenderNode; view: { x: number; y: number; width: number; height: number } } {
    let r = run(body)
    const view = frame(r, nodes(r).find(n => n.text?.runs[0]?.text === 'Hold me')!)
    applyEvent({ kind: 'tap', handlerId: nodes(r).find(n => n.hitTarget?.contextMenuHandlerId)!.hitTarget!.contextMenuHandlerId!, location: { x: 1, y: 1 } })
    r = rerender(revision++)
    return { r, panel: nodes(r).find(n => n.id === 'overlay-menu')!, view }
  }
  const leading = (inset: number) => `        VStack {
            HStack {
                Text("Hold me")
                    .contextMenu {
                        Button("Copy") { }
                        Button("Rename") { }
                    }
                Spacer()
            }
            Spacer()
        }
        .padding(.horizontal, ${inset})
        .padding(.vertical, 16)`

  it('puts the panel centred 16 points under the row pressed, as iOS 27 does', () => {
    const { panel } = held(`        List {
            Text("First row")
            Text("Hold me")
                .contextMenu {
                    Button { } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                    Button("Rename") { }
                    Button(role: .destructive) { } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            Text("Last row")
        }`)
    expect([panel.frame.x, panel.frame.y, panel.frame.width, panel.frame.height]).toEqual(native.contextMenu.panel.frame)
  })

  it('lines the panel up with a view it would leave the screen centred under, 16 from the screen\'s edge', () => {
    const measured = native.contextMenu.placement
    const gap = native.contextMenu.panel.gapBelowView as number
    const edge = held(leading(16))
    expect([edge.panel.frame.x, edge.panel.frame.width, edge.panel.frame.height]).toEqual([measured.leading.panel[0], measured.leading.panel[2], measured.leading.panel[3]])
    expect(edge.panel.frame.y).toBe(edge.view.y + edge.view.height + gap)
    // iOS 27 measures from the view drawn 16% larger while pressed, about 3 points further.
    expect(Math.abs(edge.panel.frame.y - measured.leading.panel[1])).toBeLessThan(3.5)
    const inset = held(leading(48))
    // The view's own edge, 48 in; iOS 27 lines up with its larger drawing, at 43.33.
    expect(inset.panel.frame.x).toBe(inset.view.x)
    expect(Math.abs(inset.panel.frame.x - measured.inset.panel[0])).toBeLessThan(5)
  })

  it('puts the panel above a view with no room under it', () => {
    const { panel, view } = held(`        VStack {
            Spacer()
            Text("Hold me")
                .contextMenu {
                    Button("Copy") { }
                    Button("Rename") { }
                    Button("Delete", role: .destructive) { }
                }
        }
        .padding()`)
    const measured = native.contextMenu.placement.bottom.panel as number[]
    expect(panel.frame.y + panel.frame.height).toBe(view.y - (native.contextMenu.panel.gapBelowView as number))
    expect(Math.abs(panel.frame.y - measured[1]!)).toBeLessThan(3.5)
    expect(Math.abs(panel.frame.x - measured[0]!)).toBeLessThan(0.5)
    expect([panel.frame.width, panel.frame.height]).toEqual([measured[2], measured[3]])
  })

  it('starts each title nearer the panel\'s edge in a menu with no icons, as iOS 27 does', () => {
    const { r, panel } = held(leading(16))
    const title = nodes(r).find(n => n.text?.runs[0]?.text === 'Rename')!
    expect(frame(r, title).x - frame(r, panel).x).toBe(native.contextMenu.rows.titleFromPanelWithoutIcons)
  })
})
