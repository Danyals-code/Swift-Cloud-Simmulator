import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import type { AlertActionSpec, BehaviorAction } from '@studio/shared'
import { APP, XCODE, bodyOf, draw, edited, editWritten, node, project, refusal, screen, typecheckInXcode, viewWritten } from './helpers/layer-project'

/**
 * Wave 4a: the system UI a tap shows, and the slots its buttons go in (doc 18, Wave 4):
 * Show alert and Show options from When tapped, read back as what they show.
 */

const DELETE: readonly AlertActionSpec[] = [{ title: 'Delete', role: 'destructive' }, { title: 'Cancel', role: 'cancel' }]
const BUTTON = 'Button("Delete") { }'
const SCREEN = screen(`        VStack {
            ${BUTTON}
        }`)

/** The file after inserting `snippet` with the `index`th slot called `slot` selected, or the planner's reason. */
function insertIntoSlot(source: string, slot: string, snippet: string, index = 0, target?: string): { text: string } | { refused: string } {
  const branch = buildAuthoringModel({ projectId: 'layer', revision: 1, files: project(source), deploymentTarget: target }).nodes.filter(n => n.kind === 'branch' && n.name === slot)[index]
  if (!branch) throw new Error(`No slot called ${slot}`)
  const plan = planDesignEdit({ projectId: 'layer', baseRevision: 1, files: project(source), scope: branch.owner, target: branch.source, fingerprint: branch.fingerprint, deploymentTarget: target, operation: { kind: 'insert', snippet } })
  return plan.ok ? { text: plan.changes.find(change => change.file === APP)?.after ?? source } : { refused: plan.reason }
}

const ITEMS = screen(`        NavigationStack {
            Text("Inbox")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Edit") { }
                    }
                }
        }`)
const ITEM = 'ToolbarItem(placement: .topBarTrailing) {\n                        Button("Edit") { }\n                    }'
const ITEMS_ADDED = ITEMS.replace(`${ITEM}\n`, `${ITEM}\n                    ToolbarItem {\n                        Button("Add") { }\n                    }\n`)

/** A screen with a slot of every kind Add can fill that is written as a closure. */
const EVERY_SLOT = screen(`        NavigationStack {
            List {
                Section {
                    Text("Wi-Fi")
                        .swipeActions { Button("Pin") { } }
                        .contextMenu { Button("Copy") { } } preview: { Text("Wi-Fi") }
                } header: {
                    Text("Network")
                } footer: {
                    Text("Sync")
                }
                Toggle(isOn: .constant(true)) { Text("Wi-Fi") }
                Stepper(value: .constant(1), in: 0...10) { Text("Count") }
                Slider(value: .constant(0.5), in: 0...1) { Text("Volume") } minimumValueLabel: { Text("0") } maximumValueLabel: { Text("1") }
                Picker(selection: .constant(0)) { Text("A").tag(0) } label: { Text("Pick") }
                Menu { Button("A") { } } label: { Text("More") }
                DisclosureGroup { Text("Body") } label: { Text("Details") }
                Label { Text("Inbox") } icon: { Image(systemName: "tray") }
                LabeledContent { Text("1") } label: { Text("Count") }
                GroupBox { Text("Body") } label: { Text("Box") }
                ContentUnavailableView { Text("Empty") } description: { Text("Nothing here") } actions: { Button("Add") { } }
                NavigationLink { Text("Detail") } label: { Text("Go") }
                Button { } label: { Text("Tap") }
                Text("Hello")
                    .background { Color.yellow }
                    .overlay { Circle() }
                    .safeAreaInset(edge: .bottom) { Text("Bar") }
                    .alert("Delete?", isPresented: .constant(false)) { Button("Delete", role: .destructive) { } } message: { Text("Gone for good.") }
            }
            .toolbar { Button("Edit") { } }
            .navigationDestination(for: Int.self) { number in Text("Number \\(number)") }
            .sheet(isPresented: .constant(false)) { Text("Sheet") }
            .fullScreenCover(isPresented: .constant(false)) { Text("Cover") }
        }`)
/** Each slot of `EVERY_SLOT` written as a closure, in the order Layers lists them, and the screen after a Text is added to it. */
function everySlot(): [string, { text: string } | { refused: string }][] {
  const branches = buildAuthoringModel({ projectId: 'layer', revision: 1, files: project(EVERY_SLOT) }).nodes.filter(n => n.kind === 'branch' && EVERY_SLOT[n.source.start] === '{')
  return branches.map(branch => {
    const plan = planDesignEdit({ projectId: 'layer', baseRevision: 1, files: project(EVERY_SLOT), scope: branch.owner, target: branch.source, fingerprint: branch.fingerprint, operation: { kind: 'insert', snippet: 'Text("Added")' } })
    return [branch.name, plan.ok ? { text: plan.changes.find(change => change.file === APP)!.after! } : { refused: plan.reason }]
  })
}

describe('Add with a slot selected', () => {
  it('puts the view inside it, as its last view', () => {
    const alert = screen(`        Text("Draft")
            .alert("Delete the draft?", isPresented: .constant(true)) {
                Button("Delete", role: .destructive) { }
            } message: {
                Text("This can’t be undone.")
            }`)
    expect(insertIntoSlot(alert, 'Actions', 'Button("Keep") { }')).toEqual({ text: alert.replace('Button("Delete", role: .destructive) { }\n', 'Button("Delete", role: .destructive) { }\n                Button("Keep") { }\n') })
    const toolbar = screen(`        NavigationStack {
            Text("Inbox")
                .toolbar { }
        }`)
    expect(insertIntoSlot(toolbar, 'Toolbar', 'Button("Add") { }')).toEqual({ text: toolbar.replace('.toolbar { }', '.toolbar {\n                    Button("Add") { }\n                }') })
    const section = screen(`        Form {
            Section {
                Text("Wi-Fi")
            } header: {
                Text("Network")
            }
        }`)
    expect(insertIntoSlot(section, 'Header', 'Image(systemName: "wifi")')).toEqual({ text: section.replace('Text("Network")\n', 'Text("Network")\n                Image(systemName: "wifi")\n') })
  })

  it('puts a view added to a toolbar of toolbar items in an item of its own, as a toolbar takes nothing else beside them', () => {
    expect(insertIntoSlot(ITEMS, 'Toolbar', 'Button("Add") { }')).toEqual({ text: ITEMS_ADDED })
    // Added with a toolbar item selected in Layers, it goes beside it, the same way.
    expect(editWritten(ITEMS, ITEM, { kind: 'insert', snippet: 'Button("Add") { }' })).toEqual({ text: ITEMS_ADDED })
    const group = ITEMS.replace('ToolbarItem(placement: .topBarTrailing) {', 'ToolbarItemGroup {')
    expect(insertIntoSlot(group, 'Toolbar', 'Text("Saved")')).toEqual({ text: group.replace('Button("Edit") { }\n                    }\n', 'Button("Edit") { }\n                    }\n                    ToolbarItem {\n                        Text("Saved")\n                    }\n') })
  })

  it('takes a view in every kind of slot written as a closure that holds views, but a slider’s value labels, which are one view each', () => {
    const SLIDER_LABELS = 'A slider’s minimum and maximum labels are one view each, of the same kind. Change them in Code.'
    expect(everySlot().map(([slot, added]) => [slot, 'refused' in added ? added.refused : 'added'])).toEqual([
      ['Swipe actions', 'added'], ['Context menu', 'added'], ['Preview', 'added'], ['Header', 'added'], ['Footer', 'added'],
      ['Label', 'added'], ['Label', 'added'], ['Label', 'added'], ['Minimum label', SLIDER_LABELS], ['Maximum label', SLIDER_LABELS],
      ['Label', 'added'], ['Label', 'added'], ['Label', 'added'], ['Title', 'added'], ['Icon', 'added'], ['Content', 'added'], ['Label', 'added'],
      ['Label', 'added'], ['Label', 'added'], ['Description', 'added'], ['Actions', 'added'], ['Destination', 'added'],
      ['Background', 'added'], ['Overlay', 'added'], ['Safe area inset', 'added'],
      ['Actions', 'added'], ['Message', 'An alert’s message is a single text. Change its words instead.'],
      ['Toolbar', 'added'], ['Destination', 'added'], ['Sheet', 'added'], ['Full screen cover', 'added'],
    ])
  })

  it('is refused for an alert’s message, which shows text alone', () => {
    const alert = screen(`        Text("Draft")
            .alert("Delete the draft?", isPresented: .constant(true)) {
                Button("Delete", role: .destructive) { }
            } message: {
                Text("This can’t be undone.")
            }`)
    expect(insertIntoSlot(alert, 'Message', 'Button("Keep") { }')).toEqual({ refused: 'An alert’s message is a single text. Change its words instead.' })
    expect(editWritten(alert, 'Text("This can’t be undone.")', { kind: 'insert', snippet: 'Button("Keep") { }' })).toEqual({ refused: 'An alert’s message is a single text. Change its words instead.' })
  })
})

describe('Show alert from When tapped', () => {
  it('writes a value that shows it, sets it on tap, and the alert with its buttons and message under the button', () => {
    const text = edited(SCREEN, BUTTON, { kind: 'behavior', action: { type: 'alert', title: 'Delete the draft?', message: 'This can’t be undone.', actions: DELETE }, replace: false })
    expect(text).toContain('    @State private var isShowingAlert = false\n    var body: some View {')
    expect(bodyOf(project(text))).toBe(`        VStack {
            Button("Delete") { isShowingAlert = true }
                .alert("Delete the draft?", isPresented: $isShowingAlert) {
                    Button("Delete", role: .destructive) { }
                    Button("Cancel", role: .cancel) { }
                } message: {
                    Text("This can’t be undone.")
                }
        }`)
  })
})

describe('Show alert from When tapped’s guided form', () => {
  it('makes any other view tappable first, keeping its look, then shows the alert', () => {
    const card = screen(`        VStack {
            Text("Drafts")
            Text("Draft")
        }`)
    const text = edited(card, 'Text("Draft")', { kind: 'guided-action', action: { type: 'alert', title: 'Delete the draft?', actions: DELETE }, replace: false })
    expect(text).toContain('@State private var isShowingAlert = false')
    expect(text).toContain('isShowingAlert = true')
    expect(text).toContain('.alert("Delete the draft?", isPresented: $isShowingAlert) {')
    expect(node(project(text), 'Button').behavior?.shows?.title).toBe('Delete the draft?')
  })
})

describe('the alert a tap shows', () => {
  it('is a screen under the screen it is shown on, as any alert written in code is', () => {
    const text = edited(SCREEN, BUTTON, { kind: 'behavior', action: { type: 'alert', title: 'Delete the draft?', message: 'This can’t be undone.', actions: DELETE }, replace: false })
    expect(draw(project(text), { allPages: true }).pages?.map(page => [page.kind, page.name])).toEqual([['root', 'Main page'], ['alert', 'Delete the draft?']])
  })
})

describe('Show options from When tapped', () => {
  it('writes a confirmation dialog the same way, its value named for the options it shows', () => {
    const text = edited(SCREEN, BUTTON, { kind: 'behavior', action: { type: 'dialog', title: 'Add a photo', actions: [{ title: 'Take Photo' }, { title: 'Choose from Library' }, { title: 'Cancel', role: 'cancel' }] }, replace: false })
    expect(text).toContain('@State private var isShowingOptions = false')
    expect(bodyOf(project(text))).toBe(`        VStack {
            Button("Delete") { isShowingOptions = true }
                .confirmationDialog("Add a photo", isPresented: $isShowingOptions) {
                    Button("Take Photo") { }
                    Button("Choose from Library") { }
                    Button("Cancel", role: .cancel) { }
                }
        }`)
  })

  it('takes a free name when the screen shows one already, and is refused before iOS 15', () => {
    const shown = edited(SCREEN, BUTTON, { kind: 'behavior', action: { type: 'alert', title: 'Delete the draft?', actions: DELETE }, replace: false })
    const second = shown.replace('        VStack {\n', '        VStack {\n            Button("Archive") { }\n')
    const text = edited(second, 'Button("Archive") { }', { kind: 'behavior', action: { type: 'alert', title: 'Archive it?', actions: [] }, replace: false })
    expect(text).toContain('@State private var isShowingAlert2 = false')
    expect(text).toContain(`Button("Archive") { isShowingAlert2 = true }
                .alert("Archive it?", isPresented: $isShowingAlert2) {
                    Button("OK") { }
                }`)
    expect(refusal(SCREEN, BUTTON, { kind: 'behavior', action: { type: 'dialog', title: 'Options', actions: [] }, replace: false }, '14.0')).toBe('Options shown on tap need an iOS 15 deployment target.')
    expect(refusal(SCREEN, BUTTON, { kind: 'behavior', action: { type: 'alert', title: 'Sure?', actions: [] }, replace: false }, '14.0')).toBe('An alert shown on tap needs an iOS 15 deployment target.')
  })
})

describe('a button that shows an alert or options', () => {
  it('reads back what it shows, so When tapped can say so', () => {
    const alert = edited(SCREEN, BUTTON, { kind: 'behavior', action: { type: 'alert', title: 'Delete the draft?', message: 'This can’t be undone.', actions: DELETE }, replace: false })
    expect(node(project(alert), 'Button').behavior?.shows).toEqual({ type: 'alert', title: 'Delete the draft?', message: 'This can’t be undone.', actions: DELETE })
    const dialog = edited(SCREEN, BUTTON, { kind: 'behavior', action: { type: 'dialog', title: 'Add a photo', actions: [{ title: 'Take Photo' }] }, replace: false })
    expect(node(project(dialog), 'Button').behavior?.shows).toEqual({ type: 'dialog', title: 'Add a photo', actions: [{ title: 'Take Photo' }] })
  })

  it('reads one written on the screen around it too, and nothing for a value set to something else', () => {
    const around = screen(`        VStack {
            Button("Delete") { confirming = true }
        }
        .alert("Delete the draft?", isPresented: $confirming) {
            Button("Delete", role: .destructive) { }
        }`).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var confirming = false\n')
    expect(node(project(around), 'Button').behavior?.shows).toEqual({ type: 'alert', title: 'Delete the draft?', actions: [{ title: 'Delete', role: 'destructive' }] })
    expect(node(project(around.replace('confirming = true }', 'confirming = false }')), 'Button').behavior?.shows).toBeUndefined()
  })
})

describe('choosing Show alert again', () => {
  it('rewrites the alert the button shows in place, with the value it already has', () => {
    const shown = edited(SCREEN, BUTTON, { kind: 'behavior', action: { type: 'alert', title: 'Delete the draft?', message: 'This can’t be undone.', actions: DELETE }, replace: false })
    const button = node(project(shown), 'Button')
    const text = edited(shown, shown.slice(button.source.start, button.source.end), { kind: 'behavior', action: { type: 'dialog', title: 'Discard changes?', actions: [{ title: 'Discard', role: 'destructive' }] }, replace: true })
    expect(text.match(/@State/g)).toHaveLength(1)
    expect(bodyOf(project(text))).toBe(`        VStack {
            Button("Delete") { isShowingAlert = true }
                .confirmationDialog("Discard changes?", isPresented: $isShowingAlert) {
                    Button("Discard", role: .destructive) { }
                }
        }`)
  })
})

/** A screen whose Button shows `presentation`, written under its stack, with `members` declared beside the value that shows it. */
const showing = (presentation: string, members = '') => screen(`        VStack {
            Button("Delete") { showing = true }
        }
${presentation}`).replace('struct ContentView: View {\n', `struct ContentView: View {\n    @State private var showing = false\n${members}`)
const TAPPED = 'Button("Delete") { showing = true }'
/** What When tapped's Replace sends for the alert a button shows, as read: `change` alters it first. */
function shownAgain(source: string, change: (action: Extract<BehaviorAction, { type: 'alert' | 'dialog' }>) => BehaviorAction = action => action, view = TAPPED): BehaviorAction {
  const shows = viewWritten(source, view).behavior?.shows
  if (!shows) throw new Error('The button shows nothing')
  return change(shows.message === undefined ? { type: shows.type, title: shows.title, actions: shows.actions } : { type: shows.type, title: shows.title, message: shows.message, actions: shows.actions })
}

describe('an alert or options When tapped can’t write back exactly (Wave 4a)', () => {
  it('are described read only with a reason, and Replace is refused with it, for a title with values in it', () => {
    const source = showing(`        .alert("Delete \\(name)?", isPresented: $showing) {
            Button("Delete", role: .destructive) { }
        }`, '    @State private var name = "Draft"\n')
    const reason = 'This alert’s title is more than plain words. Change it in Code.'
    expect(viewWritten(source, TAPPED).behavior?.shows).toEqual({ type: 'alert', title: '"Delete \\(name)?"', actions: [{ title: 'Delete', role: 'destructive' }], readOnly: reason })
    expect(refusal(source, TAPPED, { kind: 'behavior', action: shownAgain(source), replace: true })).toBe(reason)
    expect(refusal(source, TAPPED, { kind: 'guided-action', action: shownAgain(source), replace: true })).toBe(reason)
  })

  it('for a title written as a Text', () => {
    const source = showing(`        .alert(Text("Delete it?"), isPresented: $showing) {
            Button("Delete", role: .destructive) { }
        }`)
    const shows = viewWritten(source, TAPPED).behavior?.shows
    expect([shows?.title, shows?.readOnly]).toEqual(['Text("Delete it?")', 'This alert’s title is more than plain words. Change it in Code.'])
    expect(refusal(source, TAPPED, { kind: 'behavior', action: shownAgain(source), replace: true })).toBe(shows?.readOnly)
  })

  it('for one holding a text field', () => {
    const source = showing(`        .alert("Rename", isPresented: $showing) {
            TextField("Name", text: $name)
            Button("Save") { }
        }`, '    @State private var name = ""\n')
    expect(viewWritten(source, TAPPED).behavior?.shows).toEqual({ type: 'alert', title: 'Rename', actions: [{ title: 'Save' }], readOnly: 'This alert holds more than buttons. Change it in Code.' })
    expect(refusal(source, TAPPED, { kind: 'behavior', action: shownAgain(source), replace: true })).toBe('This alert holds more than buttons. Change it in Code.')
  })

  it('for a button written with a label, or with a modifier', () => {
    const reason = 'One of this alert’s buttons is more than a title and a role. Change it in Code.'
    const labelled = showing(`        .alert("Rename", isPresented: $showing) {
            Button(role: .cancel) { } label: { Text("Cancel") }
            Button("Save") { }
        } message: {
            Text("Pick a new name.")
        }`)
    expect(viewWritten(labelled, TAPPED).behavior?.shows?.readOnly).toBe(reason)
    expect(refusal(labelled, TAPPED, { kind: 'behavior', action: shownAgain(labelled), replace: true })).toBe(reason)
    const modified = showing(`        .alert("Rename", isPresented: $showing) {
            Button("Save") { }
                .keyboardShortcut(.defaultAction)
        }`)
    expect(viewWritten(modified, TAPPED).behavior?.shows?.readOnly).toBe(reason)
  })

  it('for one that presents a value', () => {
    const source = showing(`        .alert("Delete?", isPresented: $showing, presenting: selected) { item in
            Button("Delete \\(item)", role: .destructive) { }
        } message: { item in
            Text("\\(item) will be gone.")
        }`, '    @State private var selected: String? = "A"\n')
    const reason = 'This alert shows the value it presents. Change it in Code.'
    expect(viewWritten(source, TAPPED).behavior?.shows?.readOnly).toBe(reason)
    expect(refusal(source, TAPPED, { kind: 'behavior', action: shownAgain(source, action => ({ ...action, title: 'Remove?' })), replace: true })).toBe(reason)
  })

  it('for SwiftUI’s older alert, whose title is inside it', () => {
    const source = showing(`        .alert(isPresented: $showing) {
            Alert(title: Text("Delete?"))
        }`)
    const reason = 'This alert is written in a form When tapped doesn’t write. Change it in Code.'
    expect(viewWritten(source, TAPPED).behavior?.shows?.readOnly).toBe(reason)
    expect(refusal(source, TAPPED, { kind: 'behavior', action: { type: 'alert', title: 'Delete?', actions: [] }, replace: true })).toBe(reason)
  })

  it('for a message that is more than one plain text, or comments only Code keeps', () => {
    const message = showing(`        .alert("Delete?", isPresented: $showing) {
            Button("Delete", role: .destructive) { }
        } message: {
            Text("Gone for good.").bold()
        }`)
    expect(viewWritten(message, TAPPED).behavior?.shows?.readOnly).toBe('This alert’s message is more than one plain text. Change it in Code.')
    const commented = showing(`        .alert("Delete?", isPresented: $showing) {
            // Asked before every delete.
            Button("Delete", role: .destructive) { }
        }`)
    expect(viewWritten(commented, TAPPED).behavior?.shows?.readOnly).toBe('This alert has comments in it, which only Code keeps. Change it in Code.')
  })
})

const VISIBLE = showing(`        .confirmationDialog("Choose", isPresented: $showing, titleVisibility: .visible) {
            Button("One") { }
        }`)
/** The dialog above with a new title, from Replace. */
const retitled = () => edited(VISIBLE, TAPPED, { kind: 'behavior', action: shownAgain(VISIBLE, action => ({ ...action, title: 'Pick one' })), replace: true })
const DRAFTS = screen(`        VStack {
            Button("Delete") {
                showing = true
            }
        }
        .alert("Delete the draft?", isPresented: $showing) {
            Button("Delete", role: .destructive) {
                drafts.removeAll()
            }
            Button("Cancel", role: .cancel) { }
        }`).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var showing = false\n    @State private var drafts = ["One"]\n')
const DRAFTS_TAPPED = 'Button("Delete") {\n                showing = true\n            }'
/** The alert above reworded by Replace, its buttons the other way round. */
const reworded = () => edited(DRAFTS, DRAFTS_TAPPED, { kind: 'behavior', action: shownAgain(DRAFTS, action => ({ ...action, title: 'Delete every draft?', actions: [{ title: 'Keep', role: 'cancel' }, { title: 'Delete', role: 'destructive' }] }), DRAFTS_TAPPED), replace: true })

describe('Replace on an alert or options When tapped can write back (Wave 4a)', () => {
  it('keeps a dialog’s titleVisibility as written', () => {
    expect(viewWritten(VISIBLE, TAPPED).behavior?.shows).toEqual({ type: 'dialog', title: 'Choose', actions: [{ title: 'One' }] })
    expect(edited(VISIBLE, TAPPED, { kind: 'behavior', action: shownAgain(VISIBLE), replace: true })).toBe(VISIBLE)
    expect(retitled()).toBe(VISIBLE.replace('"Choose"', '"Pick one"'))
  })

  it('keeps what each button already does, by its title, and the tapped button’s action as written', () => {
    expect(bodyOf(project(reworded()))).toBe(`        VStack {
            Button("Delete") {
                showing = true
            }
        }
        .alert("Delete every draft?", isPresented: $showing) {
            Button("Keep", role: .cancel) { }
            Button("Delete", role: .destructive) {
                drafts.removeAll()
            }
        }`)
    expect(refusal(DRAFTS, DRAFTS_TAPPED, { kind: 'behavior', action: shownAgain(DRAFTS, action => ({ ...action, actions: [{ title: 'Remove', role: 'destructive' }, { title: 'Cancel', role: 'cancel' }] }), DRAFTS_TAPPED), replace: true }))
      .toBe('This alert’s Delete button does something when tapped. Keep a button called Delete, or change it in Code.')
  })
})

/** The slots of the view written as `view`, `Slot: [views]` with each view as written. */
function slots(source: string, view: string): string[] {
  const snapshot = buildAuthoringModel({ projectId: 'layer', revision: 1, files: project(source) })
  const byId = new Map(snapshot.nodes.map(n => [n.id, n]))
  const listed = (id: string): string => {
    const found = byId.get(id)!
    return found.kind === 'branch' ? `${found.name}: [${found.children.map(listed).join(', ')}]` : source.slice(found.source.start, found.source.end)
  }
  return viewWritten(source, view).children.map(listed).filter(entry => entry.includes(':'))
}
const ROW = (modifiers: string) => screen(`        List {
            Text("Inbox")${modifiers}
        }`)
/** A row given swipe actions, and one given a context menu, from the Add modifier menu. */
const swipeAdded = () => edited(ROW(''), 'Text("Inbox")', { kind: 'modifier-add', name: 'swipeActions' })
const menuAdded = () => edited(ROW('\n                .font(.headline)'), 'Text("Inbox")\n                .font(.headline)', { kind: 'modifier-add', name: 'contextMenu' })
const SWIPE = ROW(`
                .swipeActions {
                    Button("Pin") { }
                }`)
const SWIPE_ROW = SWIPE.slice(SWIPE.indexOf('Text("Inbox")'), SWIPE.lastIndexOf('\n        }\n    }'))
/** Swipe actions moved to the leading edge from their card, then given no full swipe. */
function swipeSet(): { leading: string; partial: string } {
  const leading = edited(SWIPE, SWIPE_ROW, { kind: 'property', control: 'modifier:0:detail:edge', value: 'leading' })
  return { leading, partial: edited(leading, leading.slice(leading.indexOf('Text("Inbox")'), leading.lastIndexOf('\n        }\n    }')), { kind: 'property', control: 'modifier:0:detail:fullSwipe', value: 'false' }) }
}

describe('swipe actions and context menus in Design', () => {
  it('list their buttons as layers in a slot of their own, and a context menu’s preview in another', () => {
    const swipe = ROW(`
                .swipeActions {
                    Button("Pin") { }
                        .tint(.yellow)
                }`)
    expect(slots(swipe, swipe.slice(swipe.indexOf('Text("Inbox")'), swipe.lastIndexOf('\n        }\n    }')))).toEqual(['Swipe actions: [Button("Pin") { }\n                        .tint(.yellow)]'])
    const menu = ROW(`
                .contextMenu {
                    Button("Copy") { }
                } preview: {
                    Text("Inbox preview")
                }`)
    expect(slots(menu, menu.slice(menu.indexOf('Text("Inbox")'), menu.lastIndexOf('\n        }\n    }')))).toEqual(['Context menu: [Button("Copy") { }]', 'Preview: [Text("Inbox preview")]'])
  })

  it('take a button added with their slot selected, as its last', () => {
    const swipe = ROW(`
                .swipeActions {
                    Button("Pin") { }
                }`)
    expect(insertIntoSlot(swipe, 'Swipe actions', 'Button("Flag") { }')).toEqual({ text: swipe.replace('Button("Pin") { }\n', 'Button("Pin") { }\n                    Button("Flag") { }\n') })
    const menu = ROW(`
                .contextMenu {
                    Button("Copy") { }
                }`)
    expect(insertIntoSlot(menu, 'Context menu', 'Button("Share") { }')).toEqual({ text: menu.replace('Button("Copy") { }\n', 'Button("Copy") { }\n                    Button("Share") { }\n') })
  })

  it('are offered as modifiers: swipe actions on rows from iOS 15, a context menu on any view', () => {
    const offered = (source: string, view: string, target?: string) => (viewWritten(source, view, target).modifierCatalog ?? []).filter(entry => ['swipeActions', 'contextMenu'].includes(entry.name)).map(entry => [entry.name, entry.label, entry.available])
    expect(offered(ROW(''), 'Text("Inbox")')).toEqual([['swipeActions', 'Swipe actions', true], ['contextMenu', 'Context menu', true]])
    expect(offered(ROW(''), 'Text("Inbox")', '14.0')).toEqual([['swipeActions', 'Swipe actions', false], ['contextMenu', 'Context menu', true]])
    expect(offered(SCREEN, BUTTON)).toEqual([['contextMenu', 'Context menu', true]])
  })

  it('are refused off a row, saying they need one, and before iOS 15, naming it, as the row’s catalog says', () => {
    expect(refusal(SCREEN, BUTTON, { kind: 'modifier-add', name: 'swipeActions' })).toBe('Swipe actions can only be added to a row of a List, a Form or a Section.')
    expect(viewWritten(ROW(''), 'Text("Inbox")', '14.0').modifierCatalog?.find(entry => entry.name === 'swipeActions')?.reason).toBe('Needs iOS 15 or newer. Change the deployment target to use it.')
    expect(refusal(ROW(''), 'Text("Inbox")', { kind: 'modifier-add', name: 'swipeActions' }, '14.0')).toBe('Needs iOS 15 or newer. Change the deployment target to use it.')
  })

  it('are written with a starter button, each on lines of their own', () => {
    expect(bodyOf(project(swipeAdded()))).toBe(`        List {
            Text("Inbox").swipeActions {
                Button("Delete", systemImage: "trash", role: .destructive) { }
            }
        }`)
    expect(bodyOf(project(menuAdded()))).toBe(`        List {
            Text("Inbox")
                .font(.headline)
                .contextMenu {
                    Button("Copy") { }
                }
        }`)
  })

  it('give swipe actions an Edge and a Full swipe, written into the modifier', () => {
    expect(viewWritten(SWIPE, SWIPE_ROW).modifiers?.find(m => m.name === 'swipeActions')?.controls.map(c => [c.label, c.kind, c.value, c.options])).toEqual([['Edge', 'select', 'trailing', ['leading', 'trailing']], ['Full swipe', 'toggle', 'true', undefined]])
    const { leading, partial } = swipeSet()
    expect(leading).toContain('.swipeActions(edge: .leading) {')
    expect(partial).toContain('.swipeActions(edge: .leading, allowsFullSwipe: false) {')
  })
})

describe.skipIf(!XCODE)('the forms Wave 4a writes, in Xcode 27', () => {
  it('type-check at their lowest iOS with warnings as errors', () => {
    const at = (version: string, text: string) => `// target: iOS ${version}\n${text}`
    const alert = edited(SCREEN, BUTTON, { kind: 'behavior', action: { type: 'alert', title: 'Delete the draft?', message: 'This can’t be undone.', actions: DELETE }, replace: false }, '15.0')
    const dialog = edited(SCREEN, BUTTON, { kind: 'behavior', action: { type: 'dialog', title: 'Add a photo', actions: [{ title: 'Take Photo' }, { title: 'Cancel', role: 'cancel' }] }, replace: false }, '15.0')
    const plain = edited(SCREEN, BUTTON, { kind: 'behavior', action: { type: 'alert', title: 'Saved', actions: [] }, replace: false }, '15.0')
    typecheckInXcode([at('15.0', alert), at('15.0', dialog), at('15.0', plain), at('15.0', swipeAdded()), at('14.0', menuAdded()), at('15.0', swipeSet().partial), at('15.0', retitled()), at('15.0', reworded()), ITEMS_ADDED, ...everySlot().flatMap(([, added]) => 'text' in added ? [added.text] : [])])
  }, 300_000)
})
