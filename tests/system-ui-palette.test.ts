import { describe, expect, it } from 'vitest'
import { buildAuthoringModel } from '@studio/swift-sema'
import { XCODE, bodyOf, edited, project, refusal, screen, setLayer, text, typecheckInXcode, viewWritten } from './helpers/layer-project'
import { VIEW_CATALOG } from '../apps/web/lib/viewCatalog'

/**
 * Wave 4c: the Add palette's views and the modifier catalog's last entries (doc 18, Wave 4):
 * a Color as a view with a Fill, each view gated at the iOS it needs, and badge, position,
 * safeAreaInset, trim and ignoresSafeArea in the catalog.
 */

/** The catalog entry called `name` of the view written as `view`. */
const entry = (source: string, view: string, name: string, target?: string) => viewWritten(source, view, target).modifierCatalog?.find(e => e.name === name)
/** The screen's body after adding the modifier called `name` to the view written as `view`. */
const added = (source: string, view: string, name: string, target?: string) => bodyOf(project(edited(source, view, { kind: 'modifier-add', name }, target)))

describe('the catalog’s new entries', () => {
  const plain = screen('        VStack {\n            Text("Hero")\n        }')

  it('extends any view under the bars from iOS 14, as Safe area does', () => {
    expect(entry(plain, 'Text("Hero")', 'ignoresSafeArea')).toMatchObject({ label: 'Safe area', category: 'layout', available: true })
    expect(added(plain, 'Text("Hero")', 'ignoresSafeArea')).toBe('        VStack {\n            Text("Hero").ignoresSafeArea()\n        }')
    expect(entry(plain, 'Text("Hero")', 'ignoresSafeArea', '13.0')).toMatchObject({ available: false, reason: 'Needs iOS 14 or newer. Change the deployment target to use it.' })
  })

  it('puts a badge on a row of a list or on a tab’s view from iOS 15, and nowhere else', () => {
    const rows = screen('        List {\n            Text("Inbox")\n        }')
    expect(entry(rows, 'Text("Inbox")', 'badge')).toMatchObject({ label: 'Badge', available: true })
    expect(added(rows, 'Text("Inbox")', 'badge')).toBe('        List {\n            Text("Inbox").badge(3)\n        }')
    expect(entry(rows, 'Text("Inbox")', 'badge', '14.0')).toMatchObject({ available: false, reason: 'Needs iOS 15 or newer. Change the deployment target to use it.' })
    const tabs = screen('        TabView {\n            Text("Mail")\n                .tabItem { Label("Mail", systemImage: "envelope") }\n        }')
    const mail = 'Text("Mail")\n                .tabItem { Label("Mail", systemImage: "envelope") }'
    expect(entry(tabs, mail, 'badge')).toMatchObject({ available: true })
    expect(added(tabs, mail, 'badge')).toContain('                .tabItem { Label("Mail", systemImage: "envelope") }\n                .badge(3)\n')
    expect(entry(plain, 'Text("Hero")', 'badge')).toBeUndefined()
    const pages = screen('        TabView {\n            Text("One")\n        }\n        .tabViewStyle(.page)')
    expect(entry(pages, 'Text("One")', 'badge')).toBeUndefined()
    expect(refusal(plain, 'Text("Hero")', { kind: 'modifier-add', name: 'badge' })).toBe('Badge can only be added to a row of a List, a Form or a Section, or to a tab.')
  })

  it('places a view’s center at a point, with a field for each', () => {
    expect(entry(plain, 'Text("Hero")', 'position')).toMatchObject({ label: 'Position', category: 'layout', available: true })
    const placed = added(plain, 'Text("Hero")', 'position')
    expect(placed).toBe('        VStack {\n            Text("Hero").position(x: 100, y: 100)\n        }')
    expect(viewWritten(screen(placed), 'Text("Hero").position(x: 100, y: 100)').controls?.filter(c => c.id.startsWith('modifier:0:')).map(c => [c.label, c.value])).toEqual([['position · x', '100'], ['position · y', '100']])
  })

  it('pins a bar to the bottom of any view from iOS 15, a text in its slot', () => {
    expect(entry(plain, 'Text("Hero")', 'safeAreaInset')).toMatchObject({ label: 'Inset bar', available: true })
    const list = screen('        List {\n            Text("Row")\n        }')
    expect(added(list, 'List {\n            Text("Row")\n        }', 'safeAreaInset')).toBe('        List {\n            Text("Row")\n        }\n        .safeAreaInset(edge: .bottom) {\n            Text("Bar")\n        }')
    // Its edge is a field, top or bottom, as the bar's views are layers of their own.
    const inset = screen(added(list, 'List {\n            Text("Row")\n        }', 'safeAreaInset'))
    const pinned = 'List {\n            Text("Row")\n        }\n        .safeAreaInset(edge: .bottom) {\n            Text("Bar")\n        }'
    expect(viewWritten(inset, pinned).modifiers?.find(m => m.name === 'safeAreaInset')?.controls.map(c => [c.label, c.kind, c.value, c.options])).toEqual([['safe Area Inset · edge', 'select', 'bottom', ['top', 'bottom']]])
    expect(bodyOf(project(edited(inset, pinned, { kind: 'property', control: viewWritten(inset, pinned).modifiers!.find(m => m.name === 'safeAreaInset')!.controls[0]!.id, value: 'top' })))).toContain('.safeAreaInset(edge: .top) {')
    expect(entry(plain, 'Text("Hero")', 'safeAreaInset', '14.0')).toMatchObject({ available: false })
  })

  it('trims a shape’s outline, written straight after the shape where a fill or a stroke still takes it', () => {
    const ring = screen('        Circle()\n            .stroke(Color.blue, lineWidth: 4)\n            .frame(width: 80, height: 80)')
    const view = 'Circle()\n            .stroke(Color.blue, lineWidth: 4)\n            .frame(width: 80, height: 80)'
    expect(entry(ring, view, 'trim')).toMatchObject({ label: 'Trim', available: true })
    expect(added(ring, view, 'trim')).toBe('        Circle()\n            .trim(from: 0, to: 0.75)\n            .stroke(Color.blue, lineWidth: 4)\n            .frame(width: 80, height: 80)')
    const trimmed = screen(added(ring, view, 'trim'))
    const shape = viewWritten(trimmed, 'Circle()\n            .trim(from: 0, to: 0.75)\n            .stroke(Color.blue, lineWidth: 4)\n            .frame(width: 80, height: 80)')
    expect(shape.controls?.filter(c => c.id.startsWith('modifier:0:')).map(c => [c.label, c.value, c.max])).toEqual([['trim · from', '0', 1], ['trim · to', '0.75', 1]])
    // Removed as any card is, it moves nowhere: a modifier after it would no longer take a shape.
    expect(shape.modifiers?.[0]?.capabilities).toMatchObject({ remove: true, moveUp: false, moveDown: false })
    expect(refusal(trimmed, shape.source && trimmed.slice(shape.source.start, shape.source.end), { kind: 'modifier-move', modifier: shape.modifiers![2]!.id, toIndex: 0 })).toBe('This move would cross a pinned modifier. Preserve its source position.')
    const dropped = viewWritten(ring, view).modifiers![1]!.id
    expect(bodyOf(project(edited(ring, view, { kind: 'modifier-add', name: 'trim', before: dropped })))).toBe(added(ring, view, 'trim'))
    expect(entry(plain, 'Text("Hero")', 'trim')).toBeUndefined()
  })
})

describe('a carousel in the catalog', () => {
  const tabs = screen('        TabView {\n            Text("Page 1")\n            Text("Page 2")\n        }')
  const TABS = 'TabView {\n            Text("Page 1")\n            Text("Page 2")\n        }'

  it('turns a TabView’s tabs into pages swiped through, and puts a background behind their dots, from iOS 14', () => {
    expect(entry(tabs, TABS, 'tabViewStyle')).toMatchObject({ label: 'Page style', available: true })
    expect(added(tabs, TABS, 'tabViewStyle')).toBe(`        ${TABS}\n        .tabViewStyle(.page)`)
    expect(entry(tabs, TABS, 'indexViewStyle')).toMatchObject({ label: 'Dots background', available: true })
    expect(added(tabs, TABS, 'indexViewStyle')).toBe(`        ${TABS}\n        .indexViewStyle(.page(backgroundDisplayMode: .always))`)
    expect(entry(tabs, TABS, 'tabViewStyle', '13.0')).toMatchObject({ available: false })
    expect(entry(screen('        VStack {\n            Text("Hero")\n        }'), 'Text("Hero")', 'tabViewStyle')).toBeUndefined()
  })
})

describe('a Color as a view', () => {
  const band = screen('        VStack {\n            Color.mint\n                .frame(height: 20)\n            Text("Below")\n        }')
  const BAND = 'Color.mint\n                .frame(height: 20)'

  it('reads as a Color with its colour as its Fill, not as code', () => {
    const color = viewWritten(band, BAND)
    expect(color).toMatchObject({ kind: 'view', name: 'Color' })
    expect(color.layer?.fill).toMatchObject({ value: { kind: 'color', color: { name: 'mint' } }, state: 'literal' })
  })

  it('changes its colour in place, as a Fill does', () => {
    const changed = text(setLayer(project(band), 'Color', [{ section: 'fill', fill: { kind: 'color', color: { name: 'orange' } } }]))
    expect(bodyOf(project(changed))).toBe('        VStack {\n            Color.orange\n                .frame(height: 20)\n            Text("Below")\n        }')
  })
})

describe('each view at the iOS it needs', () => {
  /** Why the view written as `view` can't be changed at `target`, as its modifiers say. */
  const locked = (body: string, view: string, target: string) => viewWritten(screen(body), view, target).modifierCatalog?.[0]?.reason

  it('locks a view below the iOS that has it, as Xcode refuses it there', () => {
    const corners = 'UnevenRoundedRectangle(topLeadingRadius: 12, bottomTrailingRadius: 12)'
    expect(locked(`        ${corners}\n            .frame(width: 60, height: 30)`, `${corners}\n            .frame(width: 60, height: 30)`, '15.0')).toBe('UnevenRoundedRectangle needs iOS 16 or newer. Change the deployment target to edit it here.')
    expect(locked(`        ${corners}\n            .frame(width: 60, height: 30)`, `${corners}\n            .frame(width: 60, height: 30)`, '16.0')).toBeUndefined()
    const reader = 'ScrollViewReader { proxy in\n            Text("Top")\n        }\n        .padding(8)'
    expect(locked(`        ${reader}`, reader, '13.0')).toBe('ScrollViewReader needs iOS 14 or newer. Change the deployment target to edit it here.')
  })
})

describe('the Add palette’s gates, as the authoring model reads each view', () => {
  /**
   * The iOS each lock in a snippet's layers names at `target`: a view's own, and a written
   * modifier's, whose catalog entry says it can't be added there.
   */
  function locks(snippet: string, target: number): number[] {
    const source = screen(snippet.split('\n').map(line => `        ${line}`).join('\n'))
    const nodes = buildAuthoringModel({ projectId: 'gates', revision: 1, files: project(source), deploymentTarget: `${target}.0` }).nodes.filter(node => node.owner === 'ContentView' && node.kind !== 'definition')
    return nodes.flatMap(node => [
      /^\w+ needs iOS (\d+) or newer\. Change the deployment target to edit it here\.$/.exec(node.modifierCatalog?.[0]?.reason ?? '')?.[1],
      ...(node.modifiers ?? []).map(modifier => /^Needs iOS (\d+) or newer/.exec(node.modifierCatalog?.find(entry => entry.name === modifier.name)?.reason ?? '')?.[1]),
    ]).filter((version): version is string => !!version).map(Number)
  }

  it.each(VIEW_CATALOG.filter(item => item.snippet && ((item.minimumIOS ?? 13) > 13 || item.older)).map(item => [item.name, item] as const))('%s is locked below the iOS the palette offers it at, and not at it', (_, item) => {
    const minimum = item.minimumIOS ?? 13
    // Below its own gate, the palette writes the older spelling, as the app below it would.
    const below = item.older && item.older.before > minimum - 1 ? item.older.snippet : item.snippet
    // A tab's Label is read by App navigation rather than as a layer, so the Xcode test alone checks Tabs below iOS 14.
    if (item.id !== 'tabview') expect(Math.max(...locks(below, minimum - 1)), below).toBe(minimum)
    expect(locks(item.older && item.older.before > minimum ? item.older.snippet : item.snippet, minimum), item.snippet).toEqual([])
    if (item.older) expect(Math.max(...locks(item.snippet, item.older.before - 1)), item.snippet).toBe(item.older.before)
  })
})

describe('a card titled before iOS 15', () => {
  const card = screen('        GroupBox(label: Text("Title")) {\n            Text("Body")\n        }')
  const CARD = 'GroupBox(label: Text("Title")) {\n            Text("Body")\n        }'

  it('has a Title, as one titled in words has, which changes the Text’s words in place', () => {
    expect(viewWritten(card, CARD, '14.0').controls?.find(c => c.id === 'title')).toMatchObject({ label: 'Title', kind: 'text', value: 'Title' })
    expect(viewWritten(screen('        GroupBox("Title") {\n            Text("Body")\n        }'), 'GroupBox("Title") {\n            Text("Body")\n        }', '15.0').controls?.find(c => c.id === 'title')).toMatchObject({ label: 'Title', kind: 'text', value: 'Title' })
    expect(bodyOf(project(edited(card, CARD, { kind: 'property', control: 'title', value: 'Plan' }, '14.0')))).toBe('        GroupBox(label: Text("Plan")) {\n            Text("Body")\n        }')
  })
})

describe.skipIf(!XCODE)('the forms 4c’s catalog and fields write, in Xcode 27', () => {
  it('type-check at their lowest iOS with warnings as errors', () => {
    const plain = screen('        VStack {\n            Text("Hero")\n        }')
    const rows = screen('        List {\n            Text("Inbox")\n        }')
    const tabs = screen('        TabView {\n            Text("Mail")\n                .tabItem { Label("Mail", systemImage: "envelope") }\n        }')
    const ring = screen('        Circle()\n            .stroke(Color.blue, lineWidth: 4)\n            .frame(width: 80, height: 80)')
    const pages = screen('        TabView {\n            Text("Page 1")\n            Text("Page 2")\n        }')
    const PAGES = 'TabView {\n            Text("Page 1")\n            Text("Page 2")\n        }'
    const band = project(screen('        VStack {\n            Color.mint\n                .frame(height: 20)\n        }'))
    const forms: [string, string][] = [
      ['14.0', screen(added(plain, 'Text("Hero")', 'ignoresSafeArea', '14.0'))],
      ['15.0', screen(added(rows, 'Text("Inbox")', 'badge', '15.0'))],
      ['15.0', screen(added(tabs, 'Text("Mail")\n                .tabItem { Label("Mail", systemImage: "envelope") }', 'badge', '15.0'))],
      ['14.0', screen(added(plain, 'Text("Hero")', 'position', '14.0'))],
      ['15.0', screen(added(rows, 'List {\n            Text("Inbox")\n        }', 'safeAreaInset', '15.0'))],
      ['14.0', screen(added(ring, 'Circle()\n            .stroke(Color.blue, lineWidth: 4)\n            .frame(width: 80, height: 80)', 'trim', '14.0'))],
      ['14.0', screen(added(pages, PAGES, 'tabViewStyle', '14.0'))],
      ['14.0', screen(added(pages, PAGES, 'indexViewStyle', '14.0'))],
      ['14.0', text(setLayer(band, 'Color', [{ section: 'fill', fill: { kind: 'color', color: { name: 'orange' } } }], 0, '14.0'))],
      ['15.0', text(setLayer(band, 'Color', [{ section: 'fill', fill: { kind: 'color', color: { name: 'systemBackground' } } }], 0, '15.0'))],
      ['14.0', text(setLayer(band, 'Color', [{ section: 'fill', fill: { kind: 'color', color: { hex: '#0A84FF' } } }], 0, '14.0'))],
      ['14.0', edited(screen('        GroupBox(label: Text("Title")) {\n            Text("Body")\n        }'), 'GroupBox(label: Text("Title")) {\n            Text("Body")\n        }', { kind: 'property', control: 'title', value: 'Plan' }, '14.0')],
    ]
    const inset = forms[4]![1], pinned = 'List {\n            Text("Inbox")\n        }\n        .safeAreaInset(edge: .bottom) {\n            Text("Bar")\n        }'
    forms.push(['15.0', edited(inset, pinned, { kind: 'property', control: viewWritten(inset, pinned, '15.0').modifiers!.find(m => m.name === 'safeAreaInset')!.controls[0]!.id, value: 'top' }, '15.0')])
    expect(forms.map(([, written]) => written).join('\n')).toContain('Color(.systemBackground)\n')
    typecheckInXcode(forms.map(([version, written]) => `// target: iOS ${version}\n${written}`))
  }, 300_000)
})
