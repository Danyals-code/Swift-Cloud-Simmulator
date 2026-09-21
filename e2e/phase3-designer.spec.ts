import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync, copyFileSync } from 'node:fs'

async function start(page: Page) {
  await page.goto('/')
  await page.getByTestId('template-blank').click()
  await page.getByTestId('template-confirm').click()
  await expect(page.getByTestId('template-gallery')).toBeHidden()
  await expect(page.getByTestId('add-screen')).toBeEnabled()
}
async function ready(page: Page) { await expect(page.getByTestId('authoring-inspector')).toHaveAttribute('aria-busy', 'false') }
async function add(page: Page, kind: string) { await page.getByTestId('add-view').click(); await page.getByTestId(`add-view-${kind}`).click(); await expect(page.getByTestId('add-view-palette')).toBeHidden(); await ready(page) }
async function input(page: Page, name: string, value: string) { const field = page.getByTestId('settings-basics').getByRole('textbox', { name, exact: true }); await field.fill(value); await field.press('Enter'); await ready(page) }
/** Design's left panel: App, Components, the screens and the focused screen's layers. */
const navigator = (page: Page) => page.getByRole('navigation', { name: 'Layers', exact: true })
/** Adds a modifier from the picker's suggestions for the selected view. */
async function modifier(page: Page, label: string) {
  await page.getByTestId('modifier-stack').getByRole('button', { name: 'Add modifier', exact: true }).click()
  await page.getByRole('dialog', { name: 'Add modifier', exact: true }).getByRole('button', { name: label, exact: true }).first().click()
  await ready(page)
}
/** A component's actions in the navigator's Components group, which shows on hover. */
async function componentAction(page: Page, name: string, action: 'Edit Main' | 'Insert copy into selection') {
  const row = navigator(page).getByTestId('design-component').filter({ hasText: name })
  await row.hover()
  await row.getByRole('button', { name: `Actions for ${name}`, exact: true }).click()
  await page.getByRole('option', { name: action, exact: true }).click()
}
/** Opens a disclosure section, whichever state the last selection left it in. */
async function expand(details: Locator) {
  if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await details.locator('summary').first().click()
  await expect(details).toHaveAttribute('open', '')
}
/** A copy's saved inputs live under Advanced › Variants. */
async function variants(page: Page) {
  await expand(page.getByTestId('settings-advanced'))
  await expand(page.getByTestId('component-variants'))
}

// The acceptance path starts blank and stays in Design throughout.
test('creates and reuses a component, exposes text, saves variants, and edits the shared design without Code', async ({ page }) => {
  await start(page); await add(page, 'text'); await input(page, 'Text', 'Club member')
  // One styled line is a component's worth: a bare Text is too small to be one.
  await page.getByRole('button', { name: '+ Padding', exact: true }).click(); await ready(page)
  await modifier(page, 'Font')
  const make = page.getByTestId('make-component')
  await make.locator('summary').click()
  await make.getByRole('textbox', { name: 'New component name', exact: true }).fill('MemberCard')
  await make.getByRole('button', { name: 'Make component', exact: true }).click()
  await expect(page.getByTestId('logical-layers').locator('[data-source-name="MemberCard"][data-source-kind="component"]')).toHaveCount(1)
  await navigator(page).getByRole('button', { name: 'Expand Components', exact: true }).click()
  await expect(navigator(page).getByTestId('design-component').filter({ hasText: 'MemberCard' })).toContainText('1 copy')
  await componentAction(page, 'MemberCard', 'Edit Main')
  await expect(page.getByTestId('authoring-inspector')).toContainText('The Main · changes apply to every copy (1)')
  await page.getByTestId('settings-basics').getByRole('button', { name: 'Club member', exact: true }).click()
  await page.getByTestId('settings-basics').getByText('Changeable per copy', { exact: true }).click()
  await page.getByRole('button', { name: 'Make text changeable per copy', exact: true }).click(); await ready(page)
  // Shared color applies to all instances of this text's component.
  await modifier(page, 'Text color')
  const color = page.locator('[data-testid="modifier-card"][data-modifier-name="foregroundStyle"]')
  await color.getByRole('textbox', { name: 'Custom color hex', exact: true }).fill('#6D28D9')
  await color.getByRole('textbox', { name: 'Custom color hex', exact: true }).press('Enter'); await ready(page)
  await color.getByRole('button', { name: 'Save as token…', exact: true }).click()
  await color.getByRole('textbox', { name: 'New token name', exact: true }).fill('clubBrand')
  await color.getByRole('button', { name: 'Save', exact: true }).click(); await ready(page)
  await expect(color.getByRole('combobox', { name: 'Text color token', exact: true })).toHaveValue('clubBrand')
  await navigator(page).getByTestId('design-screen').getByRole('button', { name: 'Home', exact: true }).click()
  await page.getByTestId('logical-layers').locator('[data-source-name="VStack"]').first().click()
  await componentAction(page, 'MemberCard', 'Insert copy into selection')
  const instances = page.getByTestId('logical-layers').locator('[data-source-name="MemberCard"][data-source-kind="component"]')
  await expect(instances).toHaveCount(2)
  await instances.first().click(); await input(page, 'label', 'Featured member')
  await variants(page)
  await page.getByLabel('Variant name', { exact: true }).fill('Featured')
  await page.getByRole('button', { name: 'Save variant from this instance', exact: true }).click()
  await instances.last().click(); await ready(page)
  await variants(page)
  await page.getByRole('button', { name: 'Apply Featured', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Featured member', { exact: true })).toHaveCount(2)
  await input(page, 'label', 'Guest')
  await expect(page.getByTestId('render-tree').getByText('Featured member', { exact: true })).toHaveCount(1)
  // The shared colour is an App token: editing it once reaches every copy.
  await page.getByTestId('level-app').click()
  const token = page.getByTestId('tokens-color').locator('[data-testid="token-row"][data-token="clubBrand"]')
  await token.getByRole('button', { name: /^clubBrand/ }).click()
  await token.getByRole('textbox', { name: 'Light value', exact: true }).fill('#124ABC')
  await token.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Guest', { exact: true })).toHaveCSS('color', 'rgb(18, 74, 188)')
  await expect(page.getByTestId('render-tree').getByText('Featured member', { exact: true })).toHaveCSS('color', 'rgb(18, 74, 188)')
  await expect(token.getByTestId('token-impact')).toContainText('across 1 component')
  await token.getByTestId('token-impact').getByRole('button', { name: 'Show', exact: true }).click()
  await expect(token.getByRole('button', { name: /· MemberCard$/ })).toBeVisible()
  await page.getByTestId('design-undo').click()
  await expect(page.getByTestId('render-tree').getByText('Guest', { exact: true })).toHaveCSS('color', 'rgb(109, 40, 217)')
  await expect(page.getByTestId('save-indicator')).toContainText('Saved locally')
  await page.reload(); await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('logical-layers').locator('[data-source-name="MemberCard"][data-source-kind="component"]').first().click()
  await variants(page)
  await expect(page.getByRole('button', { name: 'Apply Featured', exact: true })).toBeVisible()
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-mode', 'design')
})

const SOURCE = `import SwiftUI
struct Entry: Identifiable { let id: String; var title: String }
@main struct ReviewApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
 @State var name = "Campus"
 @State var items: [Entry] = [Entry(id: "one", title: "First"), Entry(id: "two", title: "Second")]
 var body: some View { NavigationStack { VStack {
 Image(systemName: "star.fill").foregroundColor(.blue)
 TextField("Name", text: $name)
 Text("Club preview").foregroundColor(Color(red: 0.8, green: 0.8, blue: 0.8)).background(Color.white)
 Button("Small") {}.frame(width: 25, height: 25)
 List(items) { item in Text(item.title).padding(8) }
 NavigationLink("Details") { Text("Club details") }
 } } }
}`
async function fixture(page: Page) {
  await page.goto('/'); await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content'); await editor.click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(SOURCE)
  await expect(page.getByTestId('render-tree').getByText('First', { exact: true })).toBeVisible()
  // Design opens in Edit, with the settings panel beside the canvas.
  await page.getByTestId('workspace-design').click()
  await expect(page.getByTestId('live-toggle')).toHaveAttribute('aria-pressed', 'false')
}

test('edits one record, duplicates it, checks empty content and returns to app data', async ({ page }) => {
  await fixture(page)
  await page.getByTestId('logical-layers').locator('[data-source-name="List"]').click()
  const data = page.getByTestId('settings-data')
  await expect(data).toContainText('Content edits affect one selected item')
  await data.getByLabel('Record edit scope', { exact: true }).selectOption('app')
  await data.getByLabel('Selected record', { exact: true }).selectOption('1')
  await data.getByLabel('Record title', { exact: true }).fill('Workshop')
  await data.getByRole('button', { name: 'Duplicate record', exact: true }).click()
  await data.getByLabel('Record title', { exact: true }).fill('Critique')
  await data.getByRole('button', { name: 'Apply app initial data', exact: true }).click()
  for (const label of ['First', 'Workshop', 'Critique']) await expect(page.getByTestId('render-tree').getByText(label, { exact: true })).toBeVisible()
  await data.getByRole('button', { name: 'Preview empty list', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('First', { exact: true })).toHaveCount(0)
  // The empty list is a saved state of its screen; the screen's Default state is
  // the app's own data again.
  await page.getByTestId('level-screen').click()
  const states = page.getByRole('region', { name: 'States', exact: true })
  await expect(states.getByRole('button', { name: /^Collection preview/ })).toHaveAttribute('aria-pressed', 'true')
  await states.getByRole('button', { name: /^Default/ }).click()
  await expect(states.getByRole('button', { name: /^Default/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('render-tree').getByText('Workshop', { exact: true })).toBeVisible()
  await page.getByTestId('logical-layers').locator('[data-source-name="List"]').click()
  await data.getByRole('button', { name: 'Edit row design', exact: true }).click()
  await page.getByTestId('logical-layers').locator('[data-source-name="Text"]').click()
  await expect(page.getByTestId('authoring-inspector')).toContainText('Row design · changes apply to every row')
})

test('compares real layouts, finds actionable checks, exports PNGs and presents screens', async ({ page }, info) => {
  await fixture(page)
  // Images belong to the App, whose settings list the bundled ones.
  await page.getByTestId('level-app').click()
  await page.getByLabel('Add bundled image', { exact: true }).setInputFiles('tests/fixtures/authoring-photo.png')
  await expect(page.getByTestId('project-resources')).toContainText(/authoring[_-]photo/)
  await page.getByTestId('logical-layers').locator('[data-source-name="VStack"]').click()
  await add(page, 'image')
  await page.getByRole('combobox', { name: 'Bundled image', exact: true }).selectOption({ index: 1 })
  await expect(page.getByTestId('render-tree').locator('img')).toHaveCount(1)
  await page.getByTestId('export-format').click()
  await page.getByTestId('export-format-menu-review').click()
  const dialog = page.getByRole('dialog', { name: 'Design review', exact: true })
  for (const number of [1, 2, 3]) await expect(dialog.getByTestId(`review-condition-${number}`).getByTestId('review-ready')).toHaveAttribute('aria-busy', 'false')
  const first = dialog.getByTestId('review-condition-1'), third = dialog.getByTestId('review-condition-3')
  await expect(first.locator('[data-studio-preview] input').first()).toHaveValue('Campus')
  await expect(first.locator('[data-studio-preview] img').first()).toBeVisible()
  await expect(first).toContainText('Low text contrast')
  await expect(first).toContainText('Small touch target')
  const largeFont = await third.getByText('Club preview', { exact: true }).evaluate(node => parseFloat(getComputedStyle(node).fontSize))
  const normalFont = await first.getByText('Club preview', { exact: true }).first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))
  expect(largeFont).toBeGreaterThan(normalFont)
  await first.getByRole('combobox', { name: 'Comparison 1 device', exact: true }).selectOption('ipad-11')
  await expect(first.getByTestId('review-ready')).toHaveAttribute('aria-busy', 'false')
  await first.getByRole('combobox', { name: 'Comparison 1 device', exact: true }).selectOption('iphone-se-3')
  await expect(first.getByTestId('review-ready')).toHaveAttribute('aria-busy', 'false')
  const png = page.waitForEvent('download'); await first.getByRole('button', { name: 'Export screen PNG', exact: true }).click()
  const download = await png, bytes = readFileSync((await download.path())!)
  expect(bytes.subarray(1, 4).toString()).toBe('PNG'); expect(bytes.readUInt32BE(16)).toBe(750); expect(bytes.readUInt32BE(20)).toBe(1334); expect(bytes.length).toBeGreaterThan(8000)
  copyFileSync((await download.path())!, info.outputPath('review-screen.png'))
  const sheet = page.waitForEvent('download'); await first.getByRole('button', { name: 'Export contact sheet', exact: true }).click()
  const sheetDownload = await sheet, sheetBytes = readFileSync((await sheetDownload.path())!)
  expect(sheetBytes.readUInt32BE(16)).toBeGreaterThan(1000); expect(sheetBytes.length).toBeGreaterThan(15000)
  copyFileSync((await sheetDownload.path())!, info.outputPath('review-contact-sheet.png'))
  await dialog.getByRole('button', { name: 'Present', exact: true }).click()
  await expect(dialog.getByTestId('review-condition-2')).toBeHidden()
  await dialog.getByRole('button', { name: 'Next screen', exact: true }).click()
  await expect(first.getByTestId('review-ready')).toHaveAttribute('aria-busy', 'false')
  await expect(first.getByText('Club details', { exact: true }).first()).toBeVisible()
  await dialog.getByRole('button', { name: 'Previous screen', exact: true }).press('ArrowLeft')
  await expect(first.getByText('Club preview', { exact: true }).first()).toBeVisible()
  await dialog.getByRole('button', { name: 'Compare', exact: true }).click()
  await first.getByRole('button', { name: 'Find layer in Design', exact: true }).first().click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('authoring-inspector')).toBeVisible()
})
