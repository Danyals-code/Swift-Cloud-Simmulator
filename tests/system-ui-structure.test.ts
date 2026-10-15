import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { unwrapProblem, wrapProblem, type AuthoringNode, type ContainerLayout, type DesignEditRequest } from '@studio/shared'
import { APP, XCODE, bodyOf, draw, editWritten, edited, project, screen, typecheckInXcode, viewWritten } from './helpers/layer-project'

/**
 * Wave 4c: content structures in Design (doc 18, Wave 4): new screens that start as a List, a
 * Form or a Scroll, Wrap in them, Unwrap, a Safe area field on any view, and a carousel's Page
 * dots and Dots background.
 */

/** The screen called `view`'s definition, as Screen settings receives it. */
function definition(source: string, view = 'ContentView', target?: string): AuthoringNode {
  const found = buildAuthoringModel({ projectId: 'structure', revision: 1, files: project(source), deploymentTarget: target }).nodes.find(n => n.kind === 'definition' && n.name === view)
  if (!found) throw new Error(`No screen called ${view}`)
  return found
}
/** The file after `operation` on the screen called `view`; throws with the planner's reason when it refuses. */
function onScreen(source: string, operation: DesignEditRequest['operation'], view = 'ContentView', target?: string): string {
  const screenNode = definition(source, view, target)
  const plan = planDesignEdit({ projectId: 'structure', baseRevision: 1, files: project(source), scope: screenNode.owner, target: screenNode.source, fingerprint: screenNode.fingerprint, deploymentTarget: target, operation })
  if (!plan.ok) throw new Error(plan.reason)
  return plan.changes.find(change => change.file === APP)?.after ?? source
}
/** What a new screen adds to the end of a one-file project: everything after the file it was made in. */
const added = (source: string, after: string) => after.slice(source.length)

const HOME = screen('        VStack {\n            Text("Home")\n        }')

describe('New screen as a List, a Form or a Scroll', () => {
  it('starts a Form screen with the Form as its root, a section of one row and the title, and no padding, size or background', () => {
    expect(added(HOME, onScreen(HOME, { kind: 'screen-create', name: 'SettingsScreen', title: 'Settings', layout: 'Form' }))).toBe(`

struct SettingsScreen: View {
    var body: some View {
        Form {
            Section("Section") {
                Text("Row")
            }
        }
        .navigationTitle("Settings")
    }
}
`)
  })

  it('titles a Form screen’s section with a header before iOS 15, which has no titled Section', () => {
    expect(added(HOME, onScreen(HOME, { kind: 'screen-create', name: 'SettingsScreen', title: 'Settings', layout: 'Form' }, 'ContentView', '14.0'))).toContain('        Form {\n            Section(header: Text("Section")) {\n                Text("Row")\n            }\n        }\n')
  })

  it('starts a List screen with one row, and a Scroll screen with a column in it', () => {
    expect(added(HOME, onScreen(HOME, { kind: 'screen-create', name: 'InboxScreen', title: 'Inbox', layout: 'List' }))).toBe(`

struct InboxScreen: View {
    var body: some View {
        List {
            Text("Row")
        }
        .navigationTitle("Inbox")
    }
}
`)
    expect(added(HOME, onScreen(HOME, { kind: 'screen-create', name: 'StoryScreen', title: 'Story', layout: 'ScrollView' }))).toBe(`

struct StoryScreen: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Text("Item")
            }
        }
        .navigationTitle("Story")
    }
}
`)
  })

  it('keeps a stack screen as it was: padded, filling the screen, on the system background', () => {
    expect(added(HOME, onScreen(HOME, { kind: 'screen-create', name: 'ClubScreen', title: 'Club', layout: 'VStack' }))).toBe(`

struct ClubScreen: View {
    var body: some View {
        VStack(spacing: 16) {
            Text("Club")
                .font(.title)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(.systemBackground))
        .navigationTitle("Club")
    }
}
`)
  })

  it('draws a List or a Form screen edge to edge on its grouped background, with no white frame around it', () => {
    for (const layout of ['List', 'Form'] as const) {
      const made = onScreen(HOME, { kind: 'screen-create', name: 'SettingsScreen', title: 'Settings', layout })
      const page = draw(project(made), { allPages: true, designScreens: [{ view: 'SettingsScreen', name: 'Settings' }] }).pages?.find(p => p.id === 'screen:SettingsScreen')
      const grouped = page?.tree.nodes.filter(n => n.background?.kind === 'solid' && n.background.color.r === 242 && n.background.color.b === 247)
      expect(grouped?.map(n => n.frame), layout).toContainEqual({ x: 0, y: 0, width: 393, height: 852 })
      expect(page?.tree.nodes.some(n => n.background?.kind === 'solid' && n.background.color.r === 255 && n.frame.width === 393), layout).toBe(false)
    }
  })

  it('refuses a layout it has no screen for', () => {
    expect(() => onScreen(HOME, { kind: 'screen-create', name: 'OddScreen', title: 'Odd', layout: 'toString' as 'List' })).toThrow('choose its layout')
  })
})

/** The `Text`s of a one-screen project, in the order written. */
const texts = (source: string) => buildAuthoringModel({ projectId: 'structure', revision: 1, files: project(source) }).nodes.filter(n => n.name === 'Text')
/** The screen's body after wrapping the texts at `indexes` in `layout`, or the reason it was refused. */
function wrapped(source: string, layout: ContainerLayout, indexes = [0, 1], target?: string): string {
  const all = texts(source), first = all[indexes[0]!]!
  const result = editWritten(source, source.slice(first.source.start, first.source.end), { kind: 'layer-wrap', ids: indexes.map(i => all[i]!.id), layout }, target)
  return 'refused' in result ? `refused: ${result.refused}` : bodyOf(project(result.text))
}
const COLUMN = screen('        VStack(alignment: .leading, spacing: 12) {\n            Text("A")\n            Text("B")\n            Text("C")\n        }')

describe('Wrap in a List, a Form or a Scroll', () => {
  it('puts the views in a List or a Form as its rows', () => {
    expect(wrapped(COLUMN, 'List')).toBe('        VStack(alignment: .leading, spacing: 12) {\n            List {\n                Text("A")\n                Text("B")\n            }\n            Text("C")\n        }')
    expect(wrapped(COLUMN, 'Form', [2])).toBe('        VStack(alignment: .leading, spacing: 12) {\n            Text("A")\n            Text("B")\n            Form {\n                Text("C")\n            }\n        }')
  })

  it('puts several views in a Scroll in a stack that keeps their spacing and alignment, scrolling across a row', () => {
    expect(wrapped(COLUMN, 'ScrollView')).toBe('        VStack(alignment: .leading, spacing: 12) {\n            ScrollView {\n                VStack(alignment: .leading, spacing: 12) {\n                    Text("A")\n                    Text("B")\n                }\n            }\n            Text("C")\n        }')
    const row = screen('        HStack(spacing: 8) {\n            Text("A")\n            Text("B")\n        }')
    expect(wrapped(row, 'ScrollView')).toBe('        HStack(spacing: 8) {\n            ScrollView(.horizontal) {\n                HStack(spacing: 8) {\n                    Text("A")\n                    Text("B")\n                }\n            }\n        }')
  })

  it('refuses a List or a Form inside a scroll view or a list, where iOS gives it no height and shows none of it', () => {
    const scrolled = screen('        ScrollView {\n            VStack(spacing: 16) {\n                Text("A")\n                Text("B")\n            }\n        }')
    expect(wrapped(scrolled, 'List')).toBe('refused: A List inside a scroll view or a list has no height of its own, so iOS would show none of it. Wrap what holds it instead.')
    expect(wrapped(screen('        List {\n            Text("A")\n        }'), 'Form', [0])).toBe('refused: A Form inside a scroll view or a list has no height of its own, so iOS would show none of it. Wrap what holds it instead.')
    expect(wrapped(scrolled, 'VStack')).toContain('VStack(spacing: 16) {\n                    Text("A")')
    // The Layers menu asks the planner's own question, before anything is written (Wave 4c).
    const menu = (source: string, layout: string, indexes = [0, 1]) => wrapProblem(buildAuthoringModel({ projectId: 'structure', revision: 1, files: project(source) }).nodes, indexes.map(i => texts(source)[i]!.id), layout)
    expect(menu(scrolled, 'List')).toBe('A List inside a scroll view or a list has no height of its own, so iOS would show none of it. Wrap what holds it instead.')
    expect(menu(scrolled, 'ScrollView')).toBeNull()
    expect(menu(COLUMN, 'Form', [2])).toBeNull()
    expect(menu(COLUMN, 'Grid')).toBe('Choose Column, Row, Overlap, List, Form or Scroll.')
    expect(wrapped(COLUMN, 'Grid' as ContainerLayout)).toBe('refused: Choose Column, Row, Overlap, List, Form or Scroll.')
  })

  it('puts one view in a Scroll on its own', () => {
    expect(wrapped(COLUMN, 'ScrollView', [2])).toBe('        VStack(alignment: .leading, spacing: 12) {\n            Text("A")\n            Text("B")\n            ScrollView {\n                Text("C")\n            }\n        }')
  })
})

/** The screen's body after unwrapping the view written as `view`, or the reason it was refused. */
function unwrapped(source: string, view: string, target?: string): string {
  const result = editWritten(source, view, { kind: 'layer-unwrap' }, target)
  return 'refused' in result ? `refused: ${result.refused}` : bodyOf(project(result.text))
}

describe('Unwrap', () => {
  it('puts a stack’s views in its place, in a parent that takes several and lays them out the same way', () => {
    const source = screen('        VStack(alignment: .leading, spacing: 16) {\n            Text("Title")\n            VStack(alignment: .leading, spacing: 16) {\n                Text("A")\n                Text("B")\n            }\n            Text("End")\n        }')
    expect(unwrapped(source, 'VStack(alignment: .leading, spacing: 16) {\n                Text("A")\n                Text("B")\n            }')).toBe('        VStack(alignment: .leading, spacing: 16) {\n            Text("Title")\n            Text("A")\n            Text("B")\n            Text("End")\n        }')
    // One view is laid out alike whatever its stack says, and a centred stack's alignment is the default.
    expect(unwrapped(screen('        VStack(spacing: 24) {\n            HStack(alignment: .top, spacing: 2) {\n                Text("A")\n            }\n        }'), 'HStack(alignment: .top, spacing: 2) {\n                Text("A")\n            }')).toBe('        VStack(spacing: 24) {\n            Text("A")\n        }')
    expect(unwrapped(screen('        ScrollView {\n            VStack(alignment: .center) {\n                Text("A")\n                Text("B")\n            }\n        }'), 'VStack(alignment: .center) {\n                Text("A")\n                Text("B")\n            }')).toBe('        ScrollView {\n            Text("A")\n            Text("B")\n        }')
    expect(unwrapped(screen('        List {\n            Group {\n                Text("A")\n                Text("B")\n            }\n        }'), 'Group {\n                Text("A")\n                Text("B")\n            }')).toBe('        List {\n            Text("A")\n            Text("B")\n        }')
  })

  it('refuses where its views would be laid out another way, saying how, as the Layers menu does', () => {
    const cases: [string, string, string][] = [
      ['        VStack(spacing: 24) {\n            HStack(alignment: .top, spacing: 2) {\n                Text("A")\n                Text("B")\n            }\n        }', 'HStack(alignment: .top, spacing: 2) {\n                Text("A")\n                Text("B")\n            }', 'Its views would stack down rather than run across. Keep it, or change this in Code.'],
      ['        HStack {\n            ZStack {\n                Text("A")\n                Text("B")\n            }\n        }', 'ZStack {\n                Text("A")\n                Text("B")\n            }', 'Its views would run across rather than overlap. Keep it, or change this in Code.'],
      ['        VStack(spacing: 24) {\n            VStack(alignment: .center, spacing: 2) {\n                Text("A")\n                Text("B")\n            }\n        }', 'VStack(alignment: .center, spacing: 2) {\n                Text("A")\n                Text("B")\n            }', 'Its spacing (2) would be lost. Keep it, or change this in Code.'],
      ['        VStack(spacing: 20) {\n            VStack(alignment: .leading) {\n                Text("A")\n                Text("B")\n            }\n        }', 'VStack(alignment: .leading) {\n                Text("A")\n                Text("B")\n            }', 'Its default spacing and alignment (.leading) would be lost. Keep it, or change this in Code.'],
      ['        List {\n            VStack(alignment: .leading) {\n                Text("A")\n                Text("B")\n            }\n        }', 'VStack(alignment: .leading) {\n                Text("A")\n                Text("B")\n            }', 'Each of its views would be a row of its own. Keep it, or change this in Code.'],
    ]
    for (const [body, view, reason] of cases) {
      const source = screen(body)
      expect(unwrapped(source, view), view).toBe(`refused: ${reason}`)
      expect(unwrapProblem(buildAuthoringModel({ projectId: 'layer', revision: 1, files: project(source) }).nodes, viewWritten(source, view)), view).toBe(reason)
    }
  })

  it('unwraps a List, a Form, a Scroll and a group, written on one line or with a hidden view and a note inside', () => {
    const list = screen('        VStack {\n            List {\n                Text("A")\n                // A note\n                Text("B")\n            }\n        }')
    expect(unwrapped(list, 'List {\n                Text("A")\n                // A note\n                Text("B")\n            }')).toBe('        VStack {\n            Text("A")\n            // A note\n            Text("B")\n        }')
    expect(unwrapped(screen('        VStack {\n            Form { Text("A"); Text("B") }\n        }'), 'Form { Text("A"); Text("B") }')).toBe('        VStack {\n            Text("A"); Text("B")\n        }')
    expect(unwrapped(screen('        HStack {\n            Group {\n                Text("A")\n                Text("B")\n            }\n        }'), 'Group {\n                Text("A")\n                Text("B")\n            }')).toBe('        HStack {\n            Text("A")\n            Text("B")\n        }')
  })

  it('makes the one view of a screen’s root the root, and of a scroll view the view it scrolls', () => {
    expect(unwrapped(screen('        return HStack {\n            Text("A")\n        }'), 'HStack {\n            Text("A")\n        }')).toBe('        return Text("A")')
    const scroll = screen('        ScrollView {\n            VStack(spacing: 16) {\n                Text("Item")\n            }\n        }')
    expect(unwrapped(scroll, scroll.slice(scroll.indexOf('ScrollView {'), scroll.lastIndexOf('\n    }\n}')))).toBe('        VStack(spacing: 16) {\n            Text("Item")\n        }')
  })

  it('refuses when a modifier of its own would be lost, naming each', () => {
    const source = screen('        VStack {\n            HStack {\n                Text("A")\n                Text("B")\n            }\n            .padding(8)\n            .background(Color.blue)\n        }')
    expect(unwrapped(source, 'HStack {\n                Text("A")\n                Text("B")\n            }\n            .padding(8)\n            .background(Color.blue)')).toBe('refused: Its padding and background would be lost. Remove them first.')
    const titled = screen('        List {\n            Text("Row")\n        }\n        .navigationTitle("Inbox")')
    expect(unwrapped(titled, 'List {\n            Text("Row")\n        }\n        .navigationTitle("Inbox")')).toBe('refused: Its screen title would be lost. Remove it first.')
  })

  it('refuses several views where one goes, an empty container, and what is no container it unwraps', () => {
    const root = screen('        VStack {\n            Text("A")\n            Text("B")\n        }')
    expect(unwrapped(root, 'VStack {\n            Text("A")\n            Text("B")\n        }')).toBe('refused: What holds it shows one view, so its views can’t all go there. Keep it, or change this in Code.')
    const repeated = screen('        HStack {\n            ForEach(0..<3, id: \\.self) { index in\n                Text("Row")\n            }\n        }')
    expect(unwrapped(repeated, repeated.slice(repeated.indexOf('HStack {'), repeated.lastIndexOf('\n    }\n}')))).toMatch(/^refused: What holds it shows one view/)
    expect(unwrapped(screen('        VStack {\n            HStack { }\n            Text("A")\n        }'), 'HStack { }')).toBe('refused: There is nothing in it to keep. Delete it instead.')
    expect(unwrapped(root, 'Text("A")')).toBe('refused: Select a stack, a group, a List, a Form or a Scroll to put its views in its place.')
  })
})

/** The control called `id` of the view written as `view`. */
const control = (source: string, view: string, id: string, target?: string) => viewWritten(source, view, target).controls?.find(c => c.id === id)
/** The screen's body after setting the control `id` of the view written as `view` to `value`. */
const set = (source: string, view: string, id: string, value: string, target?: string) => bodyOf(project(edited(source, view, { kind: 'property', control: id, value }, target)))

describe('Safe area', () => {
  const hero = screen('        VStack {\n            Color.blue\n                .frame(height: 200)\n            Text("Body")\n        }')

  it('reads Respect on a view that stays inside the bars, and extends it to the top', () => {
    expect(control(hero, 'Text("Body")', 'safeArea')).toMatchObject({ label: 'Safe area', kind: 'select', value: 'Respect', options: ['Respect', 'Extend to top', 'Extend to bottom', 'Extend all'] })
    expect(set(hero, 'Text("Body")', 'safeArea', 'Extend to top')).toBe('        VStack {\n            Color.blue\n                .frame(height: 200)\n            Text("Body").ignoresSafeArea(edges: .top)\n        }')
  })

  it('extends a view after its last modifier, on a line of its own where that one is', () => {
    const source = screen('        VStack {\n            Image(systemName: "star")\n                .resizable()\n                .frame(height: 200)\n            Text("Body")\n        }')
    expect(set(source, 'Image(systemName: "star")\n                .resizable()\n                .frame(height: 200)', 'safeArea', 'Extend all')).toBe('        VStack {\n            Image(systemName: "star")\n                .resizable()\n                .frame(height: 200)\n                .ignoresSafeArea()\n            Text("Body")\n        }')
  })

  it('reads and changes each edge in place, and Respect takes it away', () => {
    const extended = (modifier: string) => screen(`        VStack {\n            Text("Hero")\n                .frame(height: 200)\n                ${modifier}\n            Text("Body")\n        }`)
    const view = (modifier: string) => `Text("Hero")\n                .frame(height: 200)\n                ${modifier}`
    const value = (modifier: string) => control(extended(modifier), view(modifier), 'safeArea')?.value
    expect(['.ignoresSafeArea()', '.ignoresSafeArea(edges: .all)', '.ignoresSafeArea(.all)', '.ignoresSafeArea(edges: .top)', '.ignoresSafeArea(.all, edges: .bottom)'].map(value)).toEqual(['Extend all', 'Extend all', 'Extend all', 'Extend to top', 'Extend to bottom'])
    expect(set(extended('.ignoresSafeArea()'), view('.ignoresSafeArea()'), 'safeArea', 'Extend to bottom')).toContain('                .frame(height: 200)\n                .ignoresSafeArea(edges: .bottom)\n')
    expect(set(extended('.ignoresSafeArea(edges: .top)'), view('.ignoresSafeArea(edges: .top)'), 'safeArea', 'Respect')).toBe('        VStack {\n            Text("Hero")\n                .frame(height: 200)\n            Text("Body")\n        }')
  })

  it('reads another spelling of the same edges as its option, and changes it in place', () => {
    const extended = (modifier: string) => screen(`        VStack {\n            Text("Hero")\n                ${modifier}\n        }`)
    const value = (modifier: string) => control(extended(modifier), `Text("Hero")\n                ${modifier}`, 'safeArea')?.value
    expect(['.ignoresSafeArea(.all, edges: .all)', '.ignoresSafeArea(edges: [.top])', '.ignoresSafeArea(.all, edges: [.bottom])', '.ignoresSafeArea(edges: [.vertical, .horizontal])', '.ignoresSafeArea(edges: [.top, .bottom, .leading, .trailing])'].map(value)).toEqual(['Extend all', 'Extend to top', 'Extend to bottom', 'Extend all', 'Extend all'])
    expect(set(extended('.ignoresSafeArea(.all, edges: .all)'), 'Text("Hero")\n                .ignoresSafeArea(.all, edges: .all)', 'safeArea', 'Extend to top')).toBe('        VStack {\n            Text("Hero")\n                .ignoresSafeArea(edges: .top)\n        }')
  })

  it('shows a region, several edges or the older spelling as written, read only', () => {
    for (const modifier of ['.ignoresSafeArea(.keyboard)', '.ignoresSafeArea(edges: [.top, .bottom])', '.ignoresSafeArea(edges: .vertical)', '.edgesIgnoringSafeArea(.all)']) {
      const source = screen(`        VStack {\n            Text("Hero")${modifier}\n        }`)
      expect(control(source, `Text("Hero")${modifier}`, 'safeArea'), modifier).toMatchObject({ kind: 'text', value: modifier, disabledReason: 'This view reaches under the bars in a way Safe area doesn’t set. Change it in Code.' })
    }
  })

  it('is set from iOS 14', () => {
    expect(control(hero, 'Text("Body")', 'safeArea', '13.0')?.disabledReason).toBe('Needs iOS 14 or newer. Change the deployment target to set it.')
  })
})

describe('a carousel’s Page dots and Dots background', () => {
  const carousel = (style: string, more = '') => screen(`        VStack {\n            TabView {\n                Text("Page 1")\n                Text("Page 2")\n            }\n            .tabViewStyle(${style})${more}\n            .frame(height: 240)\n        }`)
  const view = (style: string, more = '') => `TabView {\n                Text("Page 1")\n                Text("Page 2")\n            }\n            .tabViewStyle(${style})${more}\n            .frame(height: 240)`
  const dots = (style: string, more = '', target?: string) => control(carousel(style, more), view(style, more), 'pager:dots', target)

  it('reads the dots iOS shows as Automatic, Always or Never, and writes each in place', () => {
    expect(dots('.page(indexDisplayMode: .always)')).toMatchObject({ label: 'Page dots', kind: 'select', value: 'Always', options: ['Automatic', 'Always', 'Never'] })
    expect(dots('.page')?.value).toBe('Automatic')
    expect(dots('.page(indexDisplayMode: .never)')?.value).toBe('Never')
    expect(set(carousel('.page'), view('.page'), 'pager:dots', 'Always')).toContain('            .tabViewStyle(.page(indexDisplayMode: .always))\n')
    expect(set(carousel('.page(indexDisplayMode: .always)'), view('.page(indexDisplayMode: .always)'), 'pager:dots', 'Automatic')).toContain('            .tabViewStyle(.page)\n')
  })

  it('has no dots on tabs, shows another spelling as written, and is set from iOS 14', () => {
    const tabs = screen('        TabView {\n            Text("Mail")\n        }')
    expect(control(tabs, 'TabView {\n            Text("Mail")\n        }', 'pager:dots')).toBeUndefined()
    expect(control(tabs, 'TabView {\n            Text("Mail")\n        }', 'pager:background')).toBeUndefined()
    expect(dots('PageTabViewStyle(indexDisplayMode: .always)')).toMatchObject({ kind: 'text', value: 'PageTabViewStyle(indexDisplayMode: .always)', disabledReason: 'These dots are set in a way Page dots doesn’t write. Change them in Code.' })
    expect(dots('.page', '', '13.0')?.disabledReason).toBe('Needs iOS 14 or newer. Change the deployment target to set it.')
  })

  it('is no tabs of the app’s inside a screen, where only a TabView of tabs or the screen’s own is', () => {
    const navigation = (body: string) => buildAuthoringModel({ projectId: 'structure', revision: 1, files: project(screen(body)) }).navigation
    const home = (content: string) => `        NavigationStack {\n            VStack {\n${content}\n                Text("Below")\n            }\n            .navigationTitle("Home")\n        }`
    const pages = '                TabView {\n                    Text("One")\n                    Text("Two")\n                }\n                .tabViewStyle(.page)\n                .frame(height: 240)'
    expect(navigation(home(pages))?.style).toBe(navigation(home('                Text("Above")'))?.style)
    expect(navigation(home(pages))?.style).not.toBe('tabs')
    expect(navigation('        TabView {\n            Text("One")\n            Text("Two")\n        }\n        .tabViewStyle(.page)')?.style).toBe('tabs')
  })

  it('puts a background behind the dots under the page style, and takes it away', () => {
    expect(control(carousel('.page'), view('.page'), 'pager:background')).toMatchObject({ label: 'Dots background', kind: 'toggle', value: 'false' })
    expect(set(carousel('.page'), view('.page'), 'pager:background', 'true')).toContain('            .tabViewStyle(.page)\n            .indexViewStyle(.page(backgroundDisplayMode: .always))\n            .frame(height: 240)\n')
    const shown = '\n            .indexViewStyle(.page(backgroundDisplayMode: .always))'
    expect(control(carousel('.page', shown), view('.page', shown), 'pager:background')?.value).toBe('true')
    expect(set(carousel('.page', shown), view('.page', shown), 'pager:background', 'false')).toBe(bodyOf(project(carousel('.page'))))
    const interactive = '\n            .indexViewStyle(.page(backgroundDisplayMode: .interactive))'
    expect(control(carousel('.page', interactive), view('.page', interactive), 'pager:background')).toMatchObject({ kind: 'text', disabledReason: 'This background is set in a way Dots background doesn’t write. Change it in Code.' })
  })

  it('reads a background set on a view around the carousel, which it takes, read only, and writes no second one', () => {
    const around = (style: string) => screen(`        VStack {\n            TabView {\n                Text("Page 1")\n                Text("Page 2")\n            }\n            .tabViewStyle(.page)\n            .frame(height: 240)\n        }\n        ${style}`)
    const always = around('.indexViewStyle(.page(backgroundDisplayMode: .always))')
    expect(control(always, view('.page'), 'pager:background')).toMatchObject({ kind: 'toggle', value: 'true', disabledReason: 'Set on the Column around it. Change it there.' })
    expect(editWritten(always, view('.page'), { kind: 'property', control: 'pager:background', value: 'false' })).toEqual({ refused: 'Set on the Column around it. Change it there.' })
    const never = around('.indexViewStyle(.page(backgroundDisplayMode: .never))')
    expect(control(never, view('.page'), 'pager:background')).toMatchObject({ kind: 'text', value: '.indexViewStyle(.page(backgroundDisplayMode: .never))', disabledReason: 'Set on the Column around it. Change it there.' })
    // Its own is the one it takes, and one switched off in the code is none.
    const shown = '\n            .indexViewStyle(.page(backgroundDisplayMode: .always))'
    expect(control(screen(bodyOf(project(never)).replace('.tabViewStyle(.page)', `.tabViewStyle(.page)${shown}`)), view('.page', shown), 'pager:background')).toMatchObject({ kind: 'toggle', value: 'true', disabledReason: undefined })
    const off = around('// .indexViewStyle(.page(backgroundDisplayMode: .always))')
    expect(control(off, view('.page'), 'pager:background')).toMatchObject({ kind: 'toggle', value: 'false', disabledReason: undefined })
  })
})

describe.skipIf(!XCODE)('the forms 4c’s structure writes, in Xcode 27', () => {
  it('type-check at their lowest iOS with warnings as errors', () => {
    const forms: [string, string][] = []
    const whole = (body: string) => screen(body)
    for (const layout of ['List', 'Form', 'ScrollView', 'VStack'] as const) forms.push(['14.0', onScreen(HOME, { kind: 'screen-create', name: `${layout}Screen`, title: 'Settings', layout }, 'ContentView', '14.0')])
    forms.push(['15.0', onScreen(HOME, { kind: 'screen-create', name: 'FormScreen', title: 'Settings', layout: 'Form' }, 'ContentView', '15.0')])
    const row = screen('        HStack(spacing: 8) {\n            Text("A")\n            Text("B")\n        }')
    for (const [source, layout, indexes] of [[COLUMN, 'List', [0, 1]], [COLUMN, 'Form', [2]], [COLUMN, 'ScrollView', [0, 1]], [COLUMN, 'ScrollView', [2]], [row, 'ScrollView', [0, 1]]] as const) forms.push(['14.0', whole(wrapped(source, layout, [...indexes], '14.0'))])
    const nested = screen('        VStack(spacing: 16) {\n            Text("Title")\n            VStack(spacing: 16) {\n                Text("A")\n                Text("B")\n            }\n        }')
    forms.push(['14.0', whole(unwrapped(nested, 'VStack(spacing: 16) {\n                Text("A")\n                Text("B")\n            }', '14.0'))])
    const scroll = screen('        ScrollView {\n            VStack(spacing: 16) {\n                Text("Item")\n            }\n        }')
    forms.push(['14.0', whole(unwrapped(scroll, scroll.slice(scroll.indexOf('ScrollView {'), scroll.lastIndexOf('\n    }\n}')), '14.0'))])
    forms.push(['14.0', whole(unwrapped(screen('        VStack {\n            Form { Text("A"); Text("B") }\n        }'), 'Form { Text("A"); Text("B") }', '14.0'))])
    const hero = screen('        VStack {\n            Color.blue\n                .frame(height: 200)\n            Text("Body")\n        }')
    for (const value of ['Extend to top', 'Extend to bottom', 'Extend all']) forms.push(['14.0', whole(set(hero, 'Color.blue\n                .frame(height: 200)', 'safeArea', value, '14.0'))])
    const pager = (style: string) => screen(`        VStack {\n            TabView {\n                Text("Page 1")\n                Text("Page 2")\n            }\n            .tabViewStyle(${style})\n            .frame(height: 240)\n        }`)
    const pagerView = (style: string) => `TabView {\n                Text("Page 1")\n                Text("Page 2")\n            }\n            .tabViewStyle(${style})\n            .frame(height: 240)`
    for (const value of ['Always', 'Never']) forms.push(['14.0', whole(set(pager('.page'), pagerView('.page'), 'pager:dots', value, '14.0'))])
    forms.push(['14.0', whole(set(pager('.page'), pagerView('.page'), 'pager:background', 'true', '14.0'))])
    // Each is in the Swift checked, as each writes it.
    expect(forms.map(([, text]) => text).join('\n')).toContain('.indexViewStyle(.page(backgroundDisplayMode: .always))')
    expect(forms.some(([, text]) => text.includes('Section(header: Text("Section"))'))).toBe(true)
    typecheckInXcode(forms.map(([version, text]) => `// target: iOS ${version}\n${text}`))
  }, 300_000)
})
