import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import type { DesignControl, DesignEditRequest } from '@studio/shared'
import { XCODE, bodyOf, edited, project, refusal, screen, typecheckInXcode, viewWritten } from './helpers/layer-project'

/**
 * Wave 4a: the system controls Design reads and writes (doc 18, Wave 4): a Picker's options,
 * a Button's role and icon, a Section's header and footer, and a list row's settings.
 */

const insert = (snippet: string): DesignEditRequest['operation'] => ({ kind: 'insert', snippet })
const set = (control: string, value: string): DesignEditRequest['operation'] => ({ kind: 'property', control, value })
/** The control `id` of the view written as `view`, as the panel shows it. */
const control = (source: string, view: string, id: string, target?: string): DesignControl | undefined => viewWritten(source, view, target).controls?.find(c => c.id === id)

const PICKER = `Picker("Theme", selection: $theme) {
                Text("Light").tag(0)
                Text("Dark").tag(1)
            }`
const THEMES = screen(`        Form {
            ${PICKER}
        }`).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var theme = 0\n')

/** An option added to the Picker above. */
const optionAdded = () => edited(THEMES, PICKER, insert('Text("Option")'))
const SIZES = screen(`        Form {
            Picker("Size", selection: $size) {
                Text("Small").tag(Size.small)
                Text("Medium").tag(Size.medium)
            }
        }`, 'enum Size { case small, medium, large }').replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var size = Size.small\n')
const DECIMALS = screen(`        Form {
            Picker("Size", selection: $scale) {
                Text("Small").tag(0.5)
                Text("Large").tag(1.5)
            }
        }`).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var scale = 0.5\n')
/** An option added to a Picker whose options are tagged with decimals. */
const optionAddedToDecimals = () => edited(DECIMALS, 'Picker("Size", selection: $scale) {\n                Text("Small").tag(0.5)\n                Text("Large").tag(1.5)\n            }', insert('Text("Option")'))
/** An option added beside the last of a Picker tagged with an enum's cases. */
const caseAdded = () => edited(SIZES, 'Text("Medium").tag(Size.medium)', insert('Text("Option")'))

describe('Add with a Picker selected', () => {
  it('puts the new option inside it, with the next tag', () => {
    expect(bodyOf(project(optionAdded()))).toBe(`        Form {
            Picker("Theme", selection: $theme) {
                Text("Light").tag(0)
                Text("Dark").tag(1)
                Text("Option").tag(2)
            }
        }`)
  })

  it('names a text tag after the option, and takes a case of an enum no option has', () => {
    const named = THEMES.replace('tag(0)', 'tag("Option")').replace('tag(1)', 'tag("Dark")').replace('@State private var theme = 0', '@State private var theme = "Dark"')
    expect(edited(named, PICKER.replace('tag(0)', 'tag("Option")').replace('tag(1)', 'tag("Dark")'), insert('Text("Option")'))).toContain('Text("Option").tag("Option 2")')
    const text = caseAdded()
    expect(text).toContain('Text("Medium").tag(Size.medium)\n                Text("Option").tag(Size.large)')
    expect(refusal(text, 'Text("Option").tag(Size.large)', insert('Text("Option")'))).toBe('Every case of Size already has an option in this picker, so another would be chosen along with one of them. Add a case to Size in Code first.')
  })

  it('is refused when the options are tagged in code, saying why', () => {
    const picker = `Picker("Size", selection: $size) {
                ForEach(Size.allCases, id: \\.self) { size in
                    Text(size.rawValue).tag(size)
                }
            }`
    const computed = screen(`        Form {
            ${picker}
        }`, 'enum Size: String, CaseIterable { case small, large }').replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var size = Size.small\n')
    expect(refusal(computed, picker, insert('Text("Option")'))).toBe('This picker’s options are tagged in code, as size, so a new option would have no value of its own. Add it in Code and give it a tag.')
  })

  it('puts a view added to a Menu inside it', () => {
    const menu = screen(`        Menu("Sort") {
            Button("Name") { }
        }`)
    expect(bodyOf(project(edited(menu, 'Menu("Sort") {\n            Button("Name") { }\n        }', insert('Button("Date") { }'))))).toBe(`        Menu("Sort") {
            Button("Name") { }
            Button("Date") { }
        }`)
  })

  it('leaves a view added to its Label slot untagged, as it is no option', () => {
    const labelled = THEMES.replace('Picker("Theme", selection: $theme) {', 'Picker(selection: $theme) {').replace('Text("Dark").tag(1)\n            }', 'Text("Dark").tag(1)\n            } label: {\n                Text("Theme")\n            }')
    const label = buildAuthoringModel({ projectId: 'layer', revision: 1, files: project(labelled) }).nodes.find(n => n.kind === 'branch' && n.name === 'Label')!
    const plan = planDesignEdit({ projectId: 'layer', baseRevision: 1, files: project(labelled), scope: label.owner, target: label.source, fingerprint: label.fingerprint, operation: insert('Image(systemName: "paintbrush")') })
    expect(plan.ok && plan.changes[0]!.after).toContain('Text("Theme")\n                Image(systemName: "paintbrush")\n            }')
  })

  it('tags an option of a picker of decimals with the next whole number, written as a decimal, as its value can be edited', () => {
    expect(optionAddedToDecimals()).toContain('Text("Large").tag(1.5)\n                Text("Option").tag(2.0)\n')
    expect(control(DECIMALS, 'Text("Large").tag(1.5)', 'tag')).toMatchObject({ kind: 'number', value: '1.5' })
  })

  it('tags an option added beside another the same way', () => {
    expect(bodyOf(project(edited(THEMES, 'Text("Light").tag(0)', insert('Text("Option")'))))).toContain('Text("Light").tag(0)\n                Text("Option").tag(2)\n                Text("Dark").tag(1)')
  })
})

describe('an option’s Value', () => {
  it('is its literal tag, a number, a text or a case of its enum', () => {
    expect(control(THEMES, 'Text("Light").tag(0)', 'tag')).toMatchObject({ label: 'Value', kind: 'number', value: '0', integer: true })
    expect(control(THEMES.replace('tag(0)', 'tag("light")'), 'Text("Light").tag("light")', 'tag')).toMatchObject({ label: 'Value', kind: 'text', value: 'light' })
    const sizes = screen(`        Picker("Size", selection: $size) {
            Text("Small").tag(Size.small)
            Text("Large").tag(Size.large)
        }`, 'enum Size { case small, medium, large }').replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var size = Size.small\n')
    expect(control(sizes, 'Text("Small").tag(Size.small)', 'tag')).toMatchObject({ label: 'Value', kind: 'select', value: 'small', options: ['small', 'medium', 'large'] })
    expect(edited(sizes, 'Text("Small").tag(Size.small)', set('tag', 'medium'))).toContain('Text("Small").tag(Size.medium)')
  })

  it('is written in place, and refused when another option has it, as choosing one would choose both', () => {
    expect(edited(THEMES, 'Text("Light").tag(0)', set('tag', '5'))).toContain('Text("Light").tag(5)')
    expect(refusal(THEMES, 'Text("Light").tag(0)', set('tag', '1'))).toBe('Another option of this picker has the value 1, so choosing one would choose both. Give it a value of its own.')
  })

  it('is offered on a Picker’s options alone, not on a tab’s tag or any other', () => {
    const tabs = screen(`        TabView(selection: $tab) {
            Text("A").tag(0)
            Text("B").tag(1)
        }`).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var tab = 0\n')
    expect(control(tabs, 'Text("A").tag(0)', 'tag')).toBeUndefined()
    expect(refusal(tabs, 'Text("A").tag(0)', set('tag', '1'))).toBe('This property is controlled by Swift or is outside the editable subset.')
    const label = THEMES.replace('Picker("Theme", selection: $theme) {', 'Picker(selection: $theme) {').replace('Text("Dark").tag(1)\n            }', 'Text("Dark").tag(1)\n            } label: {\n                Text("Theme").tag(9)\n            }')
    expect(control(label, 'Text("Theme").tag(9)', 'tag')).toBeUndefined()
  })

  it('is shown read only when the tag is worked out in code', () => {
    const computed = screen(`        Picker("Size", selection: $size) {
            ForEach(sizes, id: \\.self) { size in
                Text(size).tag(size)
            }
        }`).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var size = "S"\n    let sizes = ["S", "M"]\n')
    expect(control(computed, 'Text(size).tag(size)', 'tag')).toMatchObject({ value: 'size', disabledReason: 'This value is worked out in code. Change it in Code.' })
  })
})

const button = (written: string) => screen(`        VStack {
            ${written}
        }`).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var flagged = false\n')

const PLAIN = 'Button("Delete") { }'
/** A plain Button made destructive, then given a symbol, from its Role and Icon. */
const destructive = () => edited(button(PLAIN), PLAIN, set('role', 'Destructive'))
const trashed = () => edited(destructive(), 'Button("Delete", role: .destructive) { }', set('icon', 'trash'))
/** A plain Button given a symbol at iOS 14, which has `systemImage:` already. */
const symbolAt14 = () => edited(button(PLAIN), PLAIN, set('icon', 'trash'), '14.0')
const LABELLED = `Button { } label: {
                Label("Add", systemImage: "plus")
            }`
const TEXT_LABEL = 'Button { } label: { Text("Add") }'
/** A Button whose label is a text given a symbol, at iOS 14, which has Label. */
const textLabelIcon = () => edited(button(TEXT_LABEL), TEXT_LABEL, set('icon', 'plus'), '14.0')
/** A Button with a label made destructive. */
const labelledRole = () => edited(button(LABELLED), LABELLED, set('role', 'Destructive'))

describe('a Button’s Role and Icon', () => {
  it('are read from a button written with a symbol, a role or both, which gets all its fields', () => {
    for (const [written, icon, role] of [['Button("Add", systemImage: "plus") { }', 'plus', 'None'], ['Button("Delete", role: .destructive) { }', '', 'Destructive'], ['Button("Delete", systemImage: "trash", role: .destructive) { }', 'trash', 'Destructive'], ['Button("Close", role: .cancel) { }', '', 'Cancel']] as const) {
      const view = viewWritten(button(written), written)
      expect(view.controls?.find(c => c.id === 'title')?.value, written).toBe(written.slice(8, written.indexOf('"', 8)))
      expect(view.controls?.find(c => c.id === 'icon'), written).toMatchObject({ label: 'Icon', kind: 'text', value: icon })
      expect(view.controls?.find(c => c.id === 'role'), written).toMatchObject({ label: 'Role', kind: 'select', value: role, options: ['None', 'Destructive', 'Cancel'] })
      expect(view.behavior?.canConfigureAction, written).toBe(true)
    }
  })

  it('write the role and the symbol in place, adding and removing them', () => {
    expect(destructive()).toContain('Button("Delete", role: .destructive) { }')
    const trash = trashed()
    expect(trash).toContain('Button("Delete", systemImage: "trash", role: .destructive) { }')
    expect(edited(trash, 'Button("Delete", systemImage: "trash", role: .destructive) { }', set('role', 'Cancel'))).toContain('Button("Delete", systemImage: "trash", role: .cancel) { }')
    expect(edited(trash, 'Button("Delete", systemImage: "trash", role: .destructive) { }', set('role', 'None'))).toContain('Button("Delete", systemImage: "trash") { }')
    expect(edited(trash, 'Button("Delete", systemImage: "trash", role: .destructive) { }', set('icon', ''))).toContain('Button("Delete", role: .destructive) { }')
    expect(refusal(trash, 'Button("Delete", systemImage: "trash", role: .destructive) { }', set('icon', 'Trash Can'))).toBe('An SF Symbol name is lowercase words joined by dots, such as star.fill.')
    expect(symbolAt14()).toContain('Button("Delete", systemImage: "trash") { }')
  })

  it('offer no role before iOS 15, which has none', () => {
    expect(control(button('Button("Delete") { }'), 'Button("Delete") { }', 'role', '14.0')).toBeUndefined()
  })

  it('reach a button with a label: its role in its parentheses, its icon the Label’s', () => {
    const source = button(LABELLED)
    expect(control(source, LABELLED, 'icon')).toMatchObject({ value: 'plus' })
    expect(edited(source, LABELLED, set('icon', 'star'))).toContain('Label("Add", systemImage: "star")')
    const role = labelledRole()
    expect(role).toContain('Button(role: .destructive) { } label: {')
    expect(viewWritten(role, role.slice(role.indexOf('Button(role'), role.indexOf('}\n        }') + 1)).behavior?.canConfigureAction).toBe(true)
    expect(edited(role, role.slice(role.indexOf('Button(role'), role.indexOf('}\n        }') + 1), set('role', 'None'))).toContain('Button { } label: {')
  })

  it('give a button whose label is one text an Icon, which makes its label a Label', () => {
    expect(control(button(TEXT_LABEL), TEXT_LABEL, 'icon')).toMatchObject({ label: 'Icon', kind: 'text', value: '' })
    expect(textLabelIcon()).toContain('Button { } label: { Label("Add", systemImage: "plus") }')
    expect(refusal(button(TEXT_LABEL), TEXT_LABEL, set('icon', 'Plus Sign'))).toBe('An SF Symbol name is lowercase words joined by dots, such as star.fill.')
    // A Label is iOS 14's, and a text with a modifier of its own might not take it as a Label does.
    expect(control(button(TEXT_LABEL), TEXT_LABEL, 'icon', '13.0')).toBeUndefined()
    const styled = 'Button { } label: { Text("Add").bold() }'
    expect(control(button(styled), styled, 'icon')).toBeUndefined()
  })

  it('offer no Icon on an alert’s or a dialog’s buttons, which iOS draws as words alone, but do on a swipe action’s', () => {
    const view = 'Button("Delete", role: .destructive) { }'
    for (const presentation of ['alert', 'confirmationDialog']) {
      const source = screen(`        Text("Draft")
            .${presentation}("Delete?", isPresented: .constant(true)) {
                ${view}
            }`)
      expect(control(source, view, 'icon'), presentation).toBeUndefined()
      expect(control(source, view, 'role'), presentation).toMatchObject({ value: 'Destructive' })
    }
    const swipe = screen(`        List {
            Text("Draft")
                .swipeActions {
                    ${view}
                }
        }`)
    expect(control(swipe, view, 'icon')).toMatchObject({ value: '' })
  })

  it('keep the role when When tapped replaces the action', () => {
    const written = 'Button("Delete", systemImage: "trash", role: .destructive) { }'
    expect(edited(button(written), written, { kind: 'behavior', action: { type: 'toggle', state: 'flagged' }, replace: false })).toContain('Button("Delete", systemImage: "trash", role: .destructive) { flagged.toggle() }')
  })
})

const form = (section: string) => screen(`        Form {
            ${section}
        }`)
const values = (source: string, view: string, target?: string) => {
  const controls = viewWritten(source, view, target).controls ?? []
  return ['title', 'section:footer'].map(id => controls.find(c => c.id === id)).map(c => c && [c.label, c.value, c.disabledReason])
}

const TITLED = `Section("Network") {
                Text("Wi-Fi")
            }`
/** A footer added to a titled section, which writes both with closures. */
const footerAdded = () => edited(form(TITLED), TITLED, set('section:footer', 'Connect to a network to sync.'))
const UNTITLED = 'Section { Text("Wi-Fi") }'
/** A header given to an untitled section at iOS 14, which has no title initializer. */
const headerAt14 = () => edited(form(UNTITLED), UNTITLED, set('title', 'Network'), '14.0')
const HEADER_ARGUMENT = 'Section(header: Text("Network")) { Text("Wi-Fi") }'
/** A footer given to a section written with a header argument, at iOS 14. */
const footerArgumentAt14 = () => edited(form(HEADER_ARGUMENT), HEADER_ARGUMENT, set('section:footer', 'Sync'), '14.0')

describe('a Section’s Header and Footer', () => {
  it('are read as text from each way a section is written', () => {
    expect(values(form('Section("Account") { Text("Taylor") }'), 'Section("Account") { Text("Taylor") }')).toEqual([['Header', 'Account', undefined], ['Footer', '', undefined]])
    const closures = `Section {
                Text("Wi-Fi")
            } header: {
                Text("Network")
            } footer: {
                Text("Connect to a network to sync.")
            }`
    expect(values(form(closures), closures)).toEqual([['Header', 'Network', undefined], ['Footer', 'Connect to a network to sync.', undefined]])
    const args = 'Section(header: Text("Network"), footer: Text("Sync")) { Text("Wi-Fi") }'
    expect(values(form(args), args)).toEqual([['Header', 'Network', undefined], ['Footer', 'Sync', undefined]])
    expect(values(form('Section { Text("Wi-Fi") }'), 'Section { Text("Wi-Fi") }')).toEqual([['Header', '', undefined], ['Footer', '', undefined]])
  })

  it('are read only when the header or footer is more than one text', () => {
    const label = `Section {
                Text("Wi-Fi")
            } header: {
                Label("Network", systemImage: "wifi")
            }`
    expect(values(form(label), label)[0]).toEqual(['Header', '', 'This header is more than a text. Change it in Code.'])
  })

  it('offer a title chosen by a condition as its two words, each edited in place, as before Wave 4a', () => {
    const conditional = `Section(savedOnly ? "Up next" : "On the shelf") {
                Text("Row")
            }`
    const source = form(conditional).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var savedOnly = false\n')
    expect(viewWritten(source, conditional).controls?.filter(c => c.id.startsWith('title')).map(c => [c.id, c.label, c.value, c.disabledReason])).toEqual([['title:then', 'Header · when savedOnly is true', 'Up next', undefined], ['title:else', 'Header · otherwise', 'On the shelf', undefined]])
    expect(edited(source, conditional, set('title:else', 'Shelf'))).toContain('Section(savedOnly ? "Up next" : "Shelf") {')
  })

  it('add a footer to a titled section by writing it with closures, as no initializer takes a title and a footer', () => {
    expect(bodyOf(project(footerAdded()))).toBe(`        Form {
            Section {
                Text("Wi-Fi")
            } header: {
                Text("Network")
            } footer: {
                Text("Connect to a network to sync.")
            }
        }`)
    expect(edited(form(UNTITLED), UNTITLED, set('title', 'Network'))).toContain('Section("Network") { Text("Wi-Fi") }')
    expect(headerAt14()).toContain('Section { Text("Wi-Fi") } header: {\n                Text("Network")\n            }')
    expect(footerArgumentAt14()).toContain('Section(header: Text("Network"), footer: Text("Sync")) { Text("Wi-Fi") }')
  })

  it('edit in place, and take a header or footer away when emptied', () => {
    const closures = `Section {
                Text("Wi-Fi")
            } header: {
                Text("Network")
            } footer: {
                Text("Sync")
            }`
    expect(edited(form(closures), closures, set('section:footer', 'Stay in sync'))).toContain('Text("Stay in sync")')
    expect(bodyOf(project(edited(form(closures), closures, set('title', ''))))).toBe(`        Form {
            Section {
                Text("Wi-Fi")
            } footer: {
                Text("Sync")
            }
        }`)
    expect(edited(form('Section("Account") { Text("Taylor") }'), 'Section("Account") { Text("Taylor") }', set('title', ''))).toContain('Section { Text("Taylor") }')
    const args = 'Section(header: Text("Network"), footer: Text("Sync")) { Text("Wi-Fi") }'
    expect(edited(form(args), args, set('section:footer', ''))).toContain('Section(header: Text("Network")) { Text("Wi-Fi") }')
    expect(edited(form(args), args, set('title', ''))).toContain('Section(footer: Text("Sync")) { Text("Wi-Fi") }')
  })
})

const ROW_ENTRIES = ['listRowBackground', 'listRowInsets', 'listRowSeparatorTint', 'listRowSeparator']
/** The row entries the Add modifier menu offers the view written as `view`, with whether each is available. */
const rowEntries = (source: string, view: string, target?: string) => (viewWritten(source, view, target).modifierCatalog ?? []).filter(entry => ROW_ENTRIES.includes(entry.name)).map(entry => [entry.name, entry.label, entry.available])
/** The controls of the view's modifier card called `name`. */
const card = (source: string, view: string, name: string) => viewWritten(source, view).modifiers?.find(m => m.name === name)?.controls.map(c => [c.id.replace(/^modifier:\d+:/, ''), c.label, c.kind, c.value])
/** The same, with why each is read only. */
const readOnlyCard = (source: string, view: string, name: string) => viewWritten(source, view).modifiers?.find(m => m.name === name)?.controls.map(c => [c.label, c.value, c.disabledReason])
/** A List whose one row is written as `row`. */
const listOf = (row: string) => screen(`        List {
            ${row}
        }`).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    let gap: CGFloat = 4\n')

const ALL_ROW = 'Text("Row").listRowBackground(Color.yellow).listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16)).listRowSeparatorTint(Color.red)'
/** A list row given a background, insets and a separator colour, one after another, from the Add modifier menu. */
function rowSettings(): string {
  let text = edited(screen('        List {\n            Text("Row")\n        }'), 'Text("Row")', { kind: 'modifier-add', name: 'listRowBackground' })
  text = edited(text, 'Text("Row").listRowBackground(Color.yellow)', { kind: 'modifier-add', name: 'listRowInsets' })
  return edited(text, ALL_ROW.slice(0, ALL_ROW.lastIndexOf('.listRowSeparatorTint')), { kind: 'modifier-add', name: 'listRowSeparatorTint' })
}

describe('a list row’s settings', () => {
  it('are offered on rows of a List, a Form or a Section, and in a row template of one, and nowhere else', () => {
    const offered = [['listRowBackground', 'Row background', true], ['listRowInsets', 'Row insets', true], ['listRowSeparatorTint', 'Separator color', true], ['listRowSeparator', 'Row separator', true]]
    expect(rowEntries(screen('        List {\n            Text("Row")\n        }'), 'Text("Row")')).toEqual(offered)
    expect(rowEntries(form('Section("Account") { Text("Row") }'), 'Text("Row")')).toEqual(offered)
    expect(rowEntries(screen('        List {\n            ForEach(0..<3, id: \\.self) { index in\n                Text("Row \\(index)")\n            }\n        }'), 'Text("Row \\(index)")')).toEqual(offered)
    expect(rowEntries(screen('        List(0..<3, id: \\.self) { index in\n            Text("Row \\(index)")\n        }'), 'Text("Row \\(index)")')).toEqual(offered)
    expect(rowEntries(screen('        VStack {\n            Text("Row")\n        }'), 'Text("Row")')).toEqual([])
    expect(rowEntries(form('Section("Account") { Text("Row") }'), 'Section("Account") { Text("Row") }')).toEqual([])
    expect(rowEntries(screen('        List {\n            Text("Row")\n        }'), 'Text("Row")', '14.0').map(([name, , available]) => [name, available])).toEqual([['listRowBackground', true], ['listRowInsets', true], ['listRowSeparatorTint', false], ['listRowSeparator', false]])
  })

  it('are written as SwiftUI writes them, and edited on their cards', () => {
    const text = rowSettings(), all = ALL_ROW
    expect(text).toContain(all)
    expect(card(text, all, 'listRowBackground')).toEqual([['0', 'Row background', 'select', 'yellow']])
    expect(card(text, all, 'listRowInsets')).toEqual([['detail:top', 'Top', 'number', '8'], ['detail:leading', 'Leading', 'number', '16'], ['detail:bottom', 'Bottom', 'number', '8'], ['detail:trailing', 'Trailing', 'number', '16']])
    expect(card(text, all, 'listRowSeparatorTint')).toEqual([['0', 'Separator color', 'select', 'red']])
    expect(edited(text, all, set('modifier:1:detail:leading', '20'))).toContain('.listRowInsets(EdgeInsets(top: 8, leading: 20, bottom: 8, trailing: 16))')
    expect(edited(text, all, set('modifier:2:0', 'blue'))).toContain('.listRowSeparatorTint(Color.blue)')
  })
})

describe('a list row’s cards, read from values written otherwise (Wave 4a)', () => {
  it('read insets written with .init as EdgeInsets are, and edit them in place', () => {
    const row = 'Text("Row")\n                .listRowInsets(.init(top: 0, leading: 20, bottom: 0, trailing: 20))'
    expect(card(listOf(row), row, 'listRowInsets')).toEqual([['detail:top', 'Top', 'number', '0'], ['detail:leading', 'Leading', 'number', '20'], ['detail:bottom', 'Bottom', 'number', '0'], ['detail:trailing', 'Trailing', 'number', '20']])
    expect(edited(listOf(row), row, set('modifier:0:detail:leading', '24'))).toContain('.listRowInsets(.init(top: 0, leading: 24, bottom: 0, trailing: 20))')
  })

  it('show a value worked out in code read only, saying why, never an empty card', () => {
    const reason = 'This value is worked out in code. Change it in Code.'
    const computed = 'Text("Row")\n                .listRowInsets(EdgeInsets(top: gap, leading: 16, bottom: gap, trailing: 16))'
    expect(readOnlyCard(listOf(computed), computed, 'listRowInsets')).toEqual([['Top', 'gap', reason], ['Leading', '16', undefined], ['Bottom', 'gap', reason], ['Trailing', '16', undefined]])
    const whole = 'Text("Row")\n                .listRowInsets(EdgeInsets())'
    expect(readOnlyCard(listOf(whole), whole, 'listRowInsets')).toEqual([['Row insets', 'EdgeInsets()', reason]])
    const translucent = 'Text("Row")\n                .listRowBackground(Color.blue.opacity(0.2))'
    expect(readOnlyCard(listOf(translucent), translucent, 'listRowBackground')).toEqual([['Row background', 'Color.blue.opacity(0.2)', reason]])
    expect(refusal(listOf(translucent), translucent, set('modifier:0:0', 'red'))).toBe(reason)
  })
})

describe.skipIf(!XCODE)('the forms these controls write, in Xcode 27', () => {
  it('type-check at their lowest iOS with warnings as errors', () => {
    const forms: [string, string][] = [['13.0', optionAdded()], ['13.0', caseAdded()], ['13.0', optionAddedToDecimals()], ['15.0', trashed()], ['14.0', symbolAt14()], ['15.0', labelledRole()], ['14.0', textLabelIcon()], ['14.0', footerAdded()], ['14.0', headerAt14()], ['14.0', footerArgumentAt14()], ['15.0', rowSettings()]]
    typecheckInXcode(forms.map(([version, text]) => `// target: iOS ${version}\n${text}`))
  }, 300_000)
})
