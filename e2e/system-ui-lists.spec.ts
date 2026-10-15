import { expect, test, type Page } from '@playwright/test'
import { openCounter, openInDesign, sourceInCode } from './designer-helpers'

/**
 * System UI in lists and controls (doc 18, Wave 4a), in Chrome and Safari alike: a button
 * that asks first, a Picker's options, a row's swipe actions, and a Section's footer, each
 * set from Design and written as the plainest Swift.
 */

const app = (screen: string, body: string, state = '') => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { ${screen}() }
    }
}

struct ${screen}: View {
${state}    var body: some View {
${body}
    }
}
`

const drawn = (page: Page, text: string) => page.getByTestId('render-tree').getByText(text, { exact: true })
/** A drawn button, by the layer a click on it lands on, which selects it in Design as on the phone. */
const drawnButton = (page: Page, name: string) => page.getByTestId('render-tree').getByRole('button', { name, exact: true })
const inspector = (page: Page) => page.getByTestId('authoring-inspector')
const layers = (page: Page) => page.getByTestId('logical-layers')
const layer = (page: Page, name: string) => layers(page).locator(`[data-source-name="${name}"]`)
const idle = (page: Page) => expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')

test('a button that asks first: Show alert writes the alert, and it is a screen under the screen', async ({ page }) => {
  await openInDesign(page, app('DraftScreen', `        NavigationStack {
            VStack {
                Button("Delete draft") { }
            }
            .navigationTitle("Draft")
        }`), 'Delete draft')
  await drawnButton(page, 'Delete draft').click()
  await inspector(page).getByRole('combobox', { name: 'On tap', exact: true }).selectOption('alert')
  await inspector(page).getByRole('textbox', { name: 'Alert title', exact: true }).fill('Delete the draft?')
  await inspector(page).getByRole('textbox', { name: 'Alert message', exact: true }).fill('This can’t be undone.')
  // Delete (Destructive) and Cancel are the buttons it starts with.
  await expect(inspector(page).getByRole('textbox', { name: 'Button 1 title', exact: true })).toHaveValue('Delete')
  await expect(inspector(page).getByRole('combobox', { name: 'Button 1 role', exact: true })).toHaveValue('destructive')
  await expect(inspector(page).getByRole('combobox', { name: 'Button 2 role', exact: true })).toHaveValue('cancel')
  await inspector(page).getByRole('button', { name: 'Save', exact: true }).click()

  await expect(inspector(page)).toContainText('Show alert: Delete the draft?')
  const alert = page.locator('[data-testid="gallery-page"][data-page-kind="alert"]')
  await expect(alert.getByTestId('render-tree')).toContainText('This can’t be undone.')
  const expand = page.getByTestId('design-screen').getByRole('button', { name: 'Expand Draft', exact: true })
  if (await expand.count()) await expand.click()
  await expect(page.getByTestId('design-screen').getByRole('button', { name: 'Delete the draft?', exact: true })).toBeVisible()
  await idle(page)
  const source = await sourceInCode(page)
  expect(source).toContain('@State private var isShowingAlert = false')
  expect(source).toContain('Button("Delete draft") { isShowingAlert = true }')
  expect(source).toContain('.alert("Delete the draft?", isPresented: $isShowingAlert) {')
  expect(source).toContain('Button("Delete", role: .destructive) { }')
  expect(source).toContain('Button("Cancel", role: .cancel) { }')
})

test('a Picker’s new option takes the next value, so choosing it in Preview selects it', async ({ page }) => {
  await openInDesign(page, app('SettingsScreen', `        VStack {
            Picker("Theme", selection: $theme) {
                Text("Light").tag(0)
                Text("Dark").tag(1)
            }
            .pickerStyle(.segmented)
            Text("Theme \\(theme)")
        }`, '    @State private var theme = 0\n\n'), 'Theme 0')
  await layer(page, 'Picker').first().click()
  await inspector(page).getByRole('button', { name: 'Add option', exact: true }).click()
  await expect(drawn(page, 'Option')).toBeVisible()
  await idle(page)
  expect(await sourceInCode(page)).toContain('                Text("Dark").tag(1)\n                Text("Option").tag(2)\n')

  await page.getByTestId('live-toggle').click()
  await page.getByTestId('render-tree').getByRole('button', { name: 'Option', exact: true }).click()
  await expect(drawn(page, 'Theme 2')).toBeVisible()
})

test('a swipe action from the palette is drawn open on the canvas only while its button is selected', async ({ page }) => {
  await openInDesign(page, app('InboxScreen', `        List {
            Text("Groceries")
            Text("Errands")
        }`), 'Groceries')
  await drawn(page, 'Groceries').click()
  await page.getByTestId('add-view').click()
  await page.getByTestId('add-view-swipe-action').click()
  await expect(page.getByTestId('add-view-palette')).toBeHidden()
  await idle(page)
  const written = await sourceInCode(page)
  expect(written).toContain('            Text("Groceries").swipeActions {\n                Button("Delete", systemImage: "trash", role: .destructive) { }\n            }\n')

  // The starter is a destructive Delete with a trash icon, which iOS may draw as the icon alone.
  const action = drawnButton(page, 'Delete').or(drawn(page, 'Delete'))
  // Closed while the row itself is selected, as iOS draws a row nobody has swiped.
  await expect(action).toHaveCount(0)
  const open = layers(page).getByRole('button', { name: 'Expand Groceries', exact: true })
  if (await open.count()) await open.click()
  const slot = layer(page, 'Swipe actions')
  await expect(slot).toHaveCount(1)
  // With the slot selected, Add puts a view inside it.
  await slot.click()
  await page.getByTestId('add-view').click()
  await expect(page.getByTestId('add-view-target')).toHaveText('Into Swipe actions')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('add-view-palette')).toBeHidden()
  const openSlot = layers(page).getByRole('button', { name: 'Expand Swipe actions', exact: true })
  if (await openSlot.count()) await openSlot.click()
  await layer(page, 'Button').first().click()
  await expect(action.first()).toBeVisible()

  // Selecting another row closes it again, and showing it open changed nothing written.
  await drawn(page, 'Errands').click()
  await expect(action).toHaveCount(0)
  await idle(page)
  expect(await sourceInCode(page)).toBe(written)
})

test('a Section gets a footer, written in the closure form Swift has for a title and a footer', async ({ page }) => {
  await openInDesign(page, app('SettingsScreen', `        Form {
            Section("Network") {
                Text("Wi-Fi")
            }
        }`), 'Wi-Fi')
  await layer(page, 'Section').first().click()
  const footer = inspector(page).getByRole('textbox', { name: 'Footer', exact: true })
  await expect(footer).toHaveValue('')
  await footer.fill('Connect to a network to sync.')
  await footer.press('Enter')
  await expect(drawn(page, 'Connect to a network to sync.')).toBeVisible()
  await idle(page)
  expect(await sourceInCode(page)).toContain(`            Section {
                Text("Wi-Fi")
            } header: {
                Text("Network")
            } footer: {
                Text("Connect to a network to sync.")
            }`)
})

test('a context menu opened on a row of a scrolled List opens beside that row, as iOS places it', async ({ page }) => {
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  // Code opens with the preview pointing at views; this test holds a row as on a phone.
  await page.getByTestId('live-toggle').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(app('ContentView', `        List(0..<40, id: \\.self) { index in
            Text("Row \\(index)")
                .contextMenu {
                    Button("Copy") { }
                }
        }`))
  const preview = page.getByTestId('render-tree')
  await expect(drawn(page, 'Row 0')).toBeVisible()
  const listScroll = () => preview.evaluate((tree) => {
    const scroller = [...tree.querySelectorAll<HTMLElement>('*')]
      .find((el) => el.scrollHeight > el.clientHeight + 20 && getComputedStyle(el).overflowY !== 'visible')
    return scroller?.scrollTop ?? -1
  })
  await preview.hover()
  await page.mouse.wheel(0, 500)
  await expect.poll(listScroll).toBeGreaterThan(200)

  const row = drawnButton(page, 'Row 14')
  await expect(row).toBeVisible()
  await row.click({ button: 'right' })
  const copy = preview.getByRole('button', { name: 'Copy', exact: true })
  await expect(copy).toBeVisible()
  // Beside the row it was opened on, under it or over it: never where the row was before the List scrolled.
  const held = (await row.boundingBox())!, menu = (await copy.boundingBox())!
  const gap = menu.y >= held.y ? menu.y - (held.y + held.height) : held.y - (menu.y + menu.height)
  expect(gap).toBeGreaterThanOrEqual(0)
  expect(gap).toBeLessThan(120)
})
