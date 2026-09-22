import { expect, test, type Page } from '@playwright/test'
import { assertSource, replaceSource } from './designer-helpers'

const SOURCE = `import SwiftUI
@main struct NavigationApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        NavigationStack {
            VStack {
                NavigationLink(destination: DetailView()) {
                    Text("Open details")
                }
            }
        }
    }
}
struct DetailView: View { var body: some View { Text("Detail screen") } }
struct AnotherView: View { var body: some View { Text("Another screen") } }
struct RequiredView: View {
    let title: String
    var body: some View { Text(title) }
}`

const SHEET_SOURCE = `import SwiftUI
@main struct NavigationApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    @State private var presented = false
    var body: some View {
        Button("Open sheet") { presented = true }
            .sheet(isPresented: $presented) { DetailView() }
    }
}
struct DetailView: View { var body: some View { Text("Detail screen") } }
struct AnotherView: View { var body: some View { Text("Another screen") } }`

const destination = (page: Page) => page.getByRole('combobox', { name: 'Navigate to', exact: true })
const editor = (page: Page) => page.getByTestId('navigation-destination-editor')
const apply = (page: Page) => page.getByRole('button', { name: 'Apply destination', exact: true })
const expectedDestination = (expression: string) => SOURCE.replace('NavigationLink(destination: DetailView())', `NavigationLink(destination: ${expression})`)

async function open(page: Page, source = SOURCE, label = 'Open details') {
  await page.setViewportSize({ width: 1920, height: 1200 })
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  await replaceSource(page, source)
  await expect(page.getByTestId('render-tree').first().getByRole('button', { name: label, exact: true })).toBeVisible()
  // Design opens in Edit, so the layer can be selected straight away.
  await page.getByTestId('workspace-design').click()
  const layer = page.getByTestId('logical-layers').locator('[data-source-name="Text"], [data-source-name="Button"]').filter({ hasText: label })
  await layer.click()
  await expect(destination(page)).toBeVisible()
  await expect(destination(page)).toBeEnabled()
  await expect(editor(page)).toContainText('Current: DetailView()')
}

async function openLiveDestination(page: Page, text: string) {
  await page.getByTestId('live-toggle').click()
  await page.getByTestId('render-tree').getByRole('button', { name: 'Open details', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText(text, { exact: true })).toBeVisible()
}

test('choosing a screen updates only the destination Swift and live navigation uses it', async ({ page }) => {
  await open(page)
  await expect(destination(page)).toHaveValue('Detail')
  await page.getByRole('button', { name: 'Choose destination', exact: true }).click()
  await page.getByRole('option', { name: 'Another AnotherView()', exact: true }).click()
  await expect(destination(page)).toHaveValue('Another')
  await expect(editor(page)).toContainText('Current: DetailView()')
  await apply(page).click()
  await expect(editor(page)).toContainText('Current: AnotherView()')
  await expect(page.getByTestId('settings-basics').getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('Open details')
  await assertSource(page, expectedDestination('AnotherView()'))
  await openLiveDestination(page, 'Another screen')
})

test('keyboard search and selection stay a draft, and Escape closes choices without changing Swift', async ({ page }) => {
  await open(page)
  await destination(page).fill('another')
  await expect(page.getByRole('listbox', { name: 'Screens' }).getByRole('option')).toHaveCount(1)
  await destination(page).press('ArrowDown')
  await destination(page).press('Enter')
  await expect(destination(page)).toHaveValue('Another')
  await expect(page.getByRole('listbox', { name: 'Screens' })).toHaveCount(0)
  await expect(apply(page)).toBeEnabled()
  await expect(editor(page)).toContainText('Current: DetailView()')
  await page.getByRole('button', { name: 'Choose destination', exact: true }).click()
  await destination(page).press('Escape')
  await expect(destination(page)).toBeFocused()
  await expect(destination(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(editor(page)).toContainText('Current: DetailView()')
  await assertSource(page, SOURCE)
})

test('typing a known view name and pressing Enter applies its full destination expression', async ({ page }) => {
  await open(page)
  await destination(page).press('Enter')
  await expect(apply(page)).toBeDisabled()
  await destination(page).fill('AnotherView')
  await destination(page).press('Enter')
  await expect(editor(page)).toContainText('Current: AnotherView()')
  await expect(destination(page)).toHaveValue('Another')
  await assertSource(page, expectedDestination('AnotherView()'))
})

test('unknown views and missing inputs leave Swift unchanged; a complete input expression is retained', async ({ page, browserName }) => {
  test.fixme(browserName === 'webkit', 'WebKit loses the first Apply destination click while suggestions are open: they close on mousedown and move the button (NavigationDestinationEditor.tsx:80)')
  await open(page)
  await page.getByRole('button', { name: 'Choose destination', exact: true }).click()
  const required = page.getByRole('option', { name: /Required Needs title: String/ })
  await expect(required).toBeDisabled()
  await destination(page).fill('MissingView()')
  await apply(page).click()
  await expect(editor(page).getByRole('alert')).toBeVisible()
  await expect(editor(page)).toContainText('Current: DetailView()')
  await assertSource(page, SOURCE)
  await destination(page).fill('RequiredView()')
  await expect(editor(page).getByRole('alert')).toHaveCount(0)
  await apply(page).click()
  await expect(editor(page).getByRole('alert')).toContainText('requires title (String)')
  await expect(editor(page)).toContainText('Current: DetailView()')
  await assertSource(page, SOURCE)
  await destination(page).fill('RequiredView(title: "Provided title")')
  await destination(page).press('Escape')
  await apply(page).click()
  await expect(editor(page)).toContainText('Current: RequiredView(title: "Provided title")')
  await assertSource(page, expectedDestination('RequiredView(title: "Provided title")'))
  await openLiveDestination(page, 'Provided title')
})

test('a visual destination change is one undoable and redoable Swift edit', async ({ page }) => {
  await open(page)
  await destination(page).fill('AnotherView')
  await destination(page).press('Escape')
  await apply(page).click()
  await expect(editor(page)).toContainText('Current: AnotherView()')
  const expected = expectedDestination('AnotherView()')
  await assertSource(page, expected, false)
  const sourceEditor = page.getByTestId('editor').locator('.cm-content')
  await sourceEditor.click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(sourceEditor).toHaveText(SOURCE, { useInnerText: true })
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(sourceEditor).toHaveText(expected, { useInnerText: true })
  await page.getByTestId('workspace-design').click()
  await openLiveDestination(page, 'Another screen')
})

test('a sheet behavior opens its visual destination settings and preserves the presentation binding', async ({ page }) => {
  await open(page, SHEET_SOURCE, 'Open sheet')
  const sheet = page.locator('[data-testid="modifier-card"][data-modifier-name="sheet"]')
  // The sheet is a Navigate to card whose destination is edited in place, rather
  // than sending a supported route to Code.
  await expect(sheet).not.toContainText('Configured in code')
  await expect(sheet.getByRole('button', { name: 'Edit in Code', exact: true })).toHaveCount(0)
  await expect(sheet).toContainText('Navigate to')
  await expect(sheet.getByTestId('navigation-destination-editor')).toBeVisible()
  await sheet.getByRole('combobox', { name: 'Navigate to', exact: true }).click()
  await expect(destination(page)).toBeFocused()
  await destination(page).fill('AnotherView')
  await destination(page).press('Escape')
  await apply(page).click()
  await expect(editor(page)).toContainText('Current: AnotherView()')
  await assertSource(page, SHEET_SOURCE.replace('{ DetailView() }', '{ AnotherView() }'))
  await page.getByTestId('live-toggle').click()
  await page.getByTestId('render-tree').getByRole('button', { name: 'Open sheet', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Another screen', { exact: true })).toBeVisible()
})
