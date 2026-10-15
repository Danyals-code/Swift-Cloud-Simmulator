import { describe, expect, it } from 'vitest'
import { buildAuthoringModel } from '@studio/swift-sema'
import { presentedRoot, type DesignControl, type DesignEditRequest } from '@studio/shared'
import { XCODE, draw, edited, node, project, refusal, screen, typecheckInXcode, viewWritten } from './helpers/layer-project'

/**
 * Wave 4b: a sheet's settings in Design (doc 18, Wave 4): its height, grabber, background,
 * corners and swipe to close, read from and written on the view the sheet shows, and found
 * from the sheet's page for the Sheet section of Screen settings.
 */

const set = (control: string, value: string): DesignEditRequest['operation'] => ({ kind: 'property', control, value })
/** The control `id` of the view written as `view`, as the panel shows it. */
const control = (source: string, view: string, id: string, target?: string): DesignControl | undefined => viewWritten(source, view, target).controls?.find(c => c.id === id)
/** The ids of the sheet settings the view written as `view` has. */
const sheetIds = (source: string, view: string, target?: string) => viewWritten(source, view, target).controls?.filter(c => c.id.startsWith('sheet:')).map(c => c.id)

/** A screen that shows `shown` in a sheet, and has a detail screen to show. */
const opening = (shown: string, modifier = 'sheet') => screen(`        NavigationStack {
            Button("Open") { }
                .${modifier}(isPresented: .constant(true)) {
                    ${shown}
                }
        }`, `
struct DetailView: View {
    var body: some View {
        Text("Detail")
    }
}
`)
const DETAIL = 'DetailView()'
const SHEET = opening(DETAIL)

describe('a sheet’s settings', () => {
  it('are on the view the sheet shows, each with its value as iOS has it when none is written', () => {
    expect(sheetIds(SHEET, DETAIL)).toEqual(['sheet:height', 'sheet:grabber', 'sheet:background', 'sheet:radius', 'sheet:swipe'])
    expect(['sheet:height', 'sheet:grabber', 'sheet:background', 'sheet:radius', 'sheet:swipe'].map(id => control(SHEET, DETAIL, id)?.value)).toEqual(['Large', 'Automatic', 'Default', '', 'true'])
    expect(control(SHEET, DETAIL, 'sheet:height')).toMatchObject({ label: 'Height', kind: 'select', options: ['Large', 'Medium', 'Medium and large', 'Fixed height'] })
    expect(control(SHEET, DETAIL, 'sheet:background')?.options).toEqual(expect.arrayContaining(['Default', 'red', 'systemBackground', 'thinMaterial']))
  })

  it('are written on the call the sheet shows, never in that view’s own code', () => {
    expect(edited(SHEET, DETAIL, set('sheet:height', 'Medium'))).toContain('                    DetailView().presentationDetents([.medium])\n')
    expect(edited(SHEET, DETAIL, set('sheet:grabber', 'Visible'))).toContain('DetailView().presentationDragIndicator(.visible)')
    expect(edited(SHEET, DETAIL, set('sheet:background', 'thinMaterial'))).toContain('DetailView().presentationBackground(.thinMaterial)')
    expect(edited(SHEET, DETAIL, set('sheet:background', 'yellow'))).toContain('DetailView().presentationBackground(Color.yellow)')
    expect(edited(SHEET, DETAIL, set('sheet:radius', '24'))).toContain('DetailView().presentationCornerRadius(24)')
    expect(edited(SHEET, DETAIL, set('sheet:swipe', 'false'))).toContain('DetailView().interactiveDismissDisabled()')
    expect(edited(SHEET, DETAIL, set('sheet:height', 'Medium'))).toContain('struct DetailView: View {\n    var body: some View {\n        Text("Detail")\n    }\n}')
  })

  it('read back what they wrote, and change it in place', () => {
    const shown = 'DetailView()\n                        .presentationDetents([.medium, .large])\n                        .presentationDragIndicator(.hidden)\n                        .presentationBackground(Color(.systemBackground))\n                        .presentationCornerRadius(30)\n                        .interactiveDismissDisabled()'
    const source = opening(shown)
    expect(['sheet:height', 'sheet:grabber', 'sheet:background', 'sheet:radius', 'sheet:swipe'].map(id => control(source, shown, id)?.value)).toEqual(['Medium and large', 'Hidden', 'systemBackground', '30', 'false'])
    expect(edited(source, shown, set('sheet:height', 'Fixed height'))).toContain('.presentationDetents([.height(300)])')
    expect(edited(source, shown, set('sheet:grabber', 'Automatic'))).toContain('.presentationDragIndicator(.automatic)')
    expect(edited(source, shown, set('sheet:radius', '12'))).toContain('.presentationCornerRadius(12)')
    // Default and Swipe to close take their modifier away, as iOS does that with none.
    expect(edited(source, shown, set('sheet:background', 'Default'))).toContain('.presentationDragIndicator(.hidden)\n                        .presentationCornerRadius(30)')
    expect(edited(source, shown, set('sheet:swipe', 'true'))).toContain('.presentationCornerRadius(30)\n                }')
  })

  it('keep a modifier a note holds in place, as taking any modifier away does', () => {
    const shown = 'DetailView()\n                        // Frosted, as in the mockup\n                        .presentationBackground(.thinMaterial)'
    expect(refusal(opening(shown), shown, set('sheet:background', 'Default'))).toBe('A note or an #if in this view’s modifiers keeps this setting where it is. Change it in Code.')
    expect(edited(opening(shown), shown, set('sheet:background', 'ultraThinMaterial'))).toContain('.presentationBackground(.ultraThinMaterial)')
  })

  it('give a fixed height a field of its own, and go on lines of their own where the view’s modifiers do', () => {
    const shown = 'DetailView()\n                        .presentationDetents([.height(200)])'
    const source = opening(shown)
    expect(control(source, shown, 'sheet:height')?.value).toBe('Fixed height')
    expect(control(source, shown, 'sheet:fixedHeight')).toMatchObject({ label: 'Fixed height', unit: 'pt', value: '200' })
    expect(edited(source, shown, set('sheet:fixedHeight', '240'))).toContain('.presentationDetents([.height(240)])')
    expect(edited(source, shown, set('sheet:grabber', 'Visible'))).toContain('                        .presentationDetents([.height(200)])\n                        .presentationDragIndicator(.visible)\n')
  })

  it('show what the code works out read only, saying why', () => {
    const shown = 'DetailView()\n                        .presentationDetents([.fraction(0.3)])\n                        .presentationBackground(LinearGradient(colors: [.red, .blue], startPoint: .top, endPoint: .bottom))'
    const source = opening(shown)
    expect(control(source, shown, 'sheet:height')).toMatchObject({ value: '[.fraction(0.3)]', disabledReason: 'This sheet’s height is set in code. Change it in Code.' })
    expect(control(source, shown, 'sheet:background')?.disabledReason).toBe('This sheet’s background is set in code. Change it in Code.')
  })

  it('are read only where the view the sheet shows, or a view inside it, sets them, showing what the canvas draws', () => {
    const own = SHEET.replace('        Text("Detail")\n', '        Text("Detail")\n            .presentationDetents([.medium])\n')
    expect(control(own, DETAIL, 'sheet:height')).toMatchObject({ value: 'Medium', disabledReason: 'DetailView sets this in its own code. Change it there, in Code.' })
    expect(control(own, DETAIL, 'sheet:grabber')).toMatchObject({ value: 'Automatic', disabledReason: undefined })
    // The form AI writes most: the height on the content inside the sheet's own stack.
    const stacked = 'NavigationStack {\n                        Form { }\n                            .navigationTitle("New")\n                            .presentationDetents([.medium])\n                            .presentationDragIndicator(.visible)\n                            .interactiveDismissDisabled()\n                    }'
    expect(['sheet:height', 'sheet:grabber', 'sheet:swipe'].map(id => control(opening(stacked), stacked, id)).map(c => [c?.value, c?.disabledReason])).toEqual([
      ['Medium', 'A view inside it sets this. Change it there.'], ['Visible', 'A view inside it sets this. Change it there.'], ['false', 'A view inside it sets this. Change it there.'],
    ])
    const fixed = stacked.replace('[.medium]', '[.height(200)]')
    expect(['sheet:height', 'sheet:fixedHeight'].map(id => control(opening(fixed), fixed, id)).map(c => [c?.value, c?.disabledReason])).toEqual([
      ['Fixed height', 'A view inside it sets this. Change it there.'], ['200', 'A view inside it sets this. Change it there.'],
    ])
    const worked = stacked.replace('[.medium]', 'detents')
    expect(control(opening(worked), worked, 'sheet:height')).toMatchObject({ value: 'detents', disabledReason: 'A view inside it sets this. Change it there.' })
  })

  it('show no value where the canvas’s value can’t be read exactly, saying why', () => {
    const unsure = 'This sheet’s height is set inside it where it can’t be read exactly. Change it in Code.'
    const both = opening('DetailView().presentationDetents([.large])').replace('        Text("Detail")\n', '        Text("Detail")\n            .presentationDetents([.medium])\n')
    expect(control(both, 'DetailView().presentationDetents([.large])', 'sheet:height')).toMatchObject({ value: '', disabledReason: unsure })
    const twice = 'VStack {\n                        Text("A").presentationDetents([.medium])\n                        Text("B").presentationDetents([.large])\n                    }'
    expect(control(opening(twice), twice, 'sheet:height')).toMatchObject({ value: '', disabledReason: unsure })
    const conditional = 'VStack {\n                        if true {\n                            Text("A").presentationDetents([.medium])\n                        }\n                    }'
    expect(control(opening(conditional), conditional, 'sheet:height')).toMatchObject({ value: '', disabledReason: unsure })
    const inBackground = 'Text("A")\n                        .background { Color.clear.presentationCornerRadius(30) }'
    expect(control(opening(inBackground), inBackground, 'sheet:radius')).toMatchObject({ value: '', disabledReason: 'This sheet’s corner radius is set inside it where it can’t be read exactly. Change it in Code.' })
  })

  it('leave a sheet the view opens itself to that sheet', () => {
    const nested = SHEET.replace('        Text("Detail")\n', '        Text("Detail")\n            .sheet(isPresented: .constant(false)) { Text("Inner").presentationDetents([.medium]) }\n')
    expect(control(nested, DETAIL, 'sheet:height')).toMatchObject({ value: 'Large', disabledReason: undefined })
  })

  it('are said to need the iOS each needs', () => {
    expect(control(SHEET, DETAIL, 'sheet:height', '16.0')?.disabledReason).toBeUndefined()
    expect(control(SHEET, DETAIL, 'sheet:radius', '16.0')?.disabledReason).toBe('Needs iOS 16.4 or newer. Change the deployment target to set it.')
    expect(control(SHEET, DETAIL, 'sheet:height', '15.0')?.disabledReason).toBe('Needs iOS 16 or newer. Change the deployment target to set it.')
    expect(control(SHEET, DETAIL, 'sheet:swipe', '15.0')?.disabledReason).toBeUndefined()
    expect(refusal(SHEET, DETAIL, set('sheet:height', 'Medium'), '15.0')).toBe('Needs iOS 16 or newer. Change the deployment target to set it.')
  })

  it('are on a popover’s view too, and a full-screen cover’s has its background alone', () => {
    expect(sheetIds(opening(DETAIL, 'popover'), DETAIL)).toEqual(['sheet:height', 'sheet:grabber', 'sheet:background', 'sheet:radius', 'sheet:swipe'])
    expect(sheetIds(opening(DETAIL, 'fullScreenCover'), DETAIL)).toEqual(['sheet:background'])
  })

  it('are on the sheet’s one view alone: not beside another, nor in a condition', () => {
    expect(sheetIds(opening('DetailView()\n                    Text("More")'), DETAIL)).toEqual([])
    expect(sheetIds(opening('if true { DetailView() }'), DETAIL)).toEqual([])
  })

  it('are on the sheet’s one view with notes or a value worked out around it, as its Sheet section finds it', () => {
    const ALL = ['sheet:height', 'sheet:grabber', 'sheet:background', 'sheet:radius', 'sheet:swipe']
    const noted = opening('// The editor\n                    DetailView() // shown over Home')
    expect(sheetIds(noted, DETAIL)).toEqual(ALL)
    expect(sheetIds(opening('/* The editor */ DetailView()'), DETAIL)).toEqual(ALL)
    expect(sheetIds(opening('let title = "Edit"\n                    DetailView()'), DETAIL)).toEqual(ALL)
    expect(edited(noted, DETAIL, set('sheet:height', 'Medium'))).toContain('                    DetailView().presentationDetents([.medium]) // shown over Home\n')
    for (const source of [noted, opening('DetailView()\n                    Text("More")')]) {
      const nodes = buildAuthoringModel({ projectId: 'layer', revision: 1, files: project(source) }).nodes
      const page = (draw(project(source), { allPages: true }).pages ?? []).find(candidate => candidate.kind === 'sheet')!
      const root = presentedRoot(nodes, page.source!)
      expect(root?.controls?.filter(c => c.id.startsWith('sheet:')).map(c => c.id) ?? []).toEqual(source === noted ? ALL : [])
    }
  })
})

describe('the catalog’s sheet settings', () => {
  const catalogOf = (source: string, view: string) => viewWritten(source, view).modifierCatalog?.filter(entry => entry.name.startsWith('presentation') || entry.name === 'interactiveDismissDisabled').map(entry => entry.name)

  it('are offered on the view a sheet shows, and nowhere else', () => {
    expect(catalogOf(SHEET, DETAIL)).toEqual(['presentationDetents', 'presentationDragIndicator', 'presentationBackground', 'presentationCornerRadius', 'interactiveDismissDisabled'])
    expect(catalogOf(opening(DETAIL, 'fullScreenCover'), DETAIL)).toEqual(['presentationBackground'])
    expect(catalogOf(SHEET, 'Text("Detail")')).toEqual([])
    expect(edited(SHEET, DETAIL, { kind: 'modifier-add', name: 'presentationDetents' })).toContain('DetailView().presentationDetents([.medium])\n')
    expect(refusal(SHEET, 'Text("Detail")', { kind: 'modifier-add', name: 'presentationDetents' })).toBe('Sheet height can only be added to the view a sheet shows.')
  })

  it('make their cards removable', () => {
    const shown = 'DetailView()\n                        .presentationCornerRadius(30)'
    const card = viewWritten(opening(shown), shown).modifiers?.find(m => m.name === 'presentationCornerRadius')
    expect(card?.capabilities.remove).toBe(true)
  })
})

describe('a sheet page’s root', () => {
  it('is found from the page’s source, the view its Sheet section changes', () => {
    const source = opening('DetailView()\n                        .sheet(isPresented: .constant(false)) { Text("Inner") }')
    const result = draw(project(source), { allPages: true })
    const nodes = buildAuthoringModel({ projectId: 'layer', revision: 1, files: project(source) }).nodes
    const roots = (result.pages ?? []).filter(page => page.kind === 'sheet').map(page => presentedRoot(nodes, page.source!))
    expect(roots.map(root => root && source.slice(root.source.start, root.source.end))).toEqual(['DetailView()\n                        .sheet(isPresented: .constant(false)) { Text("Inner") }', 'Text("Inner")'])
  })
})

describe.skipIf(!XCODE)('the forms the sheet settings write, in Xcode 27', () => {
  it('type-check at their lowest iOS with warnings as errors', () => {
    const all = (target: string) => {
      let source = SHEET
      for (const [id, value] of [['sheet:height', 'Medium and large'], ['sheet:grabber', 'Visible'], ['sheet:background', 'thinMaterial'], ['sheet:radius', '24'], ['sheet:swipe', 'false']] as const) {
        const view = node(project(source), 'DetailView', 0, target)
        source = edited(source, source.slice(view.source.start, view.source.end), set(id, value), target)
      }
      return source
    }
    const fixed = edited(SHEET, DETAIL, set('sheet:height', 'Fixed height'), '16.0')
    const colored = edited(SHEET, DETAIL, set('sheet:background', 'systemBackground'), '16.4')
    const cover = edited(opening(DETAIL, 'fullScreenCover'), DETAIL, set('sheet:background', 'red'), '16.4')
    const popover = edited(opening(DETAIL, 'popover'), DETAIL, set('sheet:height', 'Medium'), '16.0')
    expect(all('16.4')).toContain('DetailView().presentationDetents([.medium, .large]).presentationDragIndicator(.visible).presentationBackground(.thinMaterial).presentationCornerRadius(24).interactiveDismissDisabled()')
    const forms: [string, string][] = [['16.4', all('16.4')], ['16.0', fixed], ['16.4', colored], ['16.4', cover], ['16.0', popover]]
    typecheckInXcode(forms.map(([version, text]) => `// target: iOS ${version}\n${text}`))
  }, 300_000)
})
