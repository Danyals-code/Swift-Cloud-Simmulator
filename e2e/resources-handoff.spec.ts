import { expect, test, type Page } from '@playwright/test'
import { openCounter } from './designer-helpers'
import { readFileSync, writeFileSync } from 'node:fs'
import { unzipSync, zipSync } from 'fflate'

const SOURCE = `import SwiftUI
enum Theme { static let brand = Color.blue; static let gap: CGFloat = 12 }
struct Product: Identifiable { let id: String; var title: String }
struct Card: View { var title: String = "Card"; var body: some View { Text(title) } }
@main struct HandoffApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    @State private var items: [Product] = [Product(id: "one", title: "First"), Product(id: "two", title: "Second")]
    @State private var count = 0
    var body: some View {
        NavigationStack {
            VStack(spacing: Theme.gap) {
                Text("Product catalog").font(.title)
                Image("Photo").resizable().scaledToFit().frame(width: 100, height: 50)
                Card(title: "Primary").foregroundStyle(Theme.brand)
                Card(title: "Secondary").foregroundStyle(Theme.brand)
                List(items) { item in Text(item.title) }
                Text("Count \\(count)")
                Button("Increment") { count += 1 }
                NavigationLink("Details") { Text("Product detail") }
            }
        }
    }
}`
const darkPhoto = readFileSync(new URL('../tests/fixtures/authoring-photo-dark.png', import.meta.url))
const photo = readFileSync(new URL('../tests/fixtures/authoring-photo.png', import.meta.url))
/** The focused screen's layers, which the default one-tree navigator nests under the screen. */
const layerTree = (page: Page) => page.getByTestId('logical-layers').getByRole('group', { name: 'Design layers', exact: true })
async function open(page: Page) {
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(SOURCE)
  await expect(page.getByTestId('render-tree').getByText('First', { exact: true })).toBeVisible()
  // Design opens in Edit. Images are App settings, the first step of the settings path.
  await page.getByTestId('workspace-design').click(); await page.getByTestId('level-app').click()
  const resources = page.getByTestId('project-resources')
  await resources.getByLabel('Add bundled image').setInputFiles({ name: 'Photo.png', mimeType: 'image/png', buffer: photo })
  await expect(page.getByTestId('render-tree').getByRole('img', { name: 'Photo', exact: true })).toBeVisible()
  const asset = resources.getByRole('button', { name: /^Photo\s*2 × 1 pt/ })
  await asset.click()
  await resources.getByLabel('Photo dark image').setInputFiles({ name: 'Photo-dark.png', mimeType: 'image/png', buffer: darkPhoto })
  await expect(asset).toContainText('2 × 1 pt · dark')
  await expect(layerTree(page)).toHaveAttribute('aria-busy', 'false')
}
async function download(page: Page) {
  const waiting = page.waitForEvent('download')
  await page.getByTestId('export-format').click()
  await page.getByTestId('export-format-menu-editable').click()
  const file = await waiting
  return readFileSync((await file.path())!)
}

for (const run of [1, 2]) test(`fresh designer handoff workflow ${run}: edit, export, reload, external edit, review, reopen`, async ({ page }, info) => {
  test.setTimeout(120_000)
  await open(page)
  const layers = page.getByTestId('logical-layers'), inspector = page.getByTestId('authoring-inspector')
  await layers.locator('[data-source-name="List"]').click()
  await inspector.getByRole('button', { name: 'Add record', exact: true }).click()
  await inspector.getByLabel('Record title', { exact: true }).fill('Preview item')
  await inspector.getByRole('button', { name: 'Apply preview records', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Preview item', { exact: true })).toBeVisible()
  // Preview records are a state of the screen; its Default state is the app's own data.
  await page.getByTestId('level-screen').click()
  const appData = page.getByTestId('screen-states').getByRole('button', { name: /^Default/ })
  await appData.click()
  await expect(appData).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('render-tree').getByText('First', { exact: true })).toBeVisible()
  await expect(page.getByTestId('render-tree').getByText('Preview item', { exact: true })).toHaveCount(0)
  await expect(layerTree(page)).toHaveAttribute('aria-busy', 'false')
  await layers.locator('[data-source-name="Card"][data-source-kind="component"]').first().click()
  const title = inspector.getByRole('textbox', { name: 'title', exact: true })
  await title.fill('Custom primary'); await title.press('Enter')
  await expect(page.getByTestId('render-tree').getByText('Custom primary', { exact: true })).toBeVisible()
  await expect(page.getByTestId('render-tree').getByText('Secondary', { exact: true })).toBeVisible()
  // Shared values are the App's tokens: Theme.brand is a color token used by both cards.
  await page.getByTestId('level-app').click()
  const brand = page.getByTestId('tokens-color').locator('[data-testid="token-row"][data-token="Theme.brand"]')
  await brand.getByRole('button', { name: /^Theme\.brand/ }).click()
  await brand.getByLabel('Color source', { exact: true }).selectOption('#custom')
  await brand.getByLabel('Light value', { exact: true }).fill('#2468ac')
  await brand.getByRole('button', { name: 'Update everywhere', exact: true }).click()
  await expect(brand.getByRole('button', { name: 'Revert', exact: true })).toHaveCount(0)
  await expect(brand.getByLabel('Light value', { exact: true })).toHaveValue(/^#2468ac$/i)
  await expect(layerTree(page)).toHaveAttribute('aria-busy', 'false')
  await page.getByTestId('live-toggle').click()
  await page.getByTestId('render-tree').getByRole('button', { name: 'Increment', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Count 1', { exact: true })).toBeVisible()
  await page.getByTestId('render-tree').getByRole('button', { name: 'Details', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Product detail', { exact: true })).toBeVisible()
  const archive = await download(page), files = unzipSync(archive)
  await expect(page.getByTestId('save-indicator')).toContainText('Saved locally')
  const sourcePath = Object.keys(files).find(p => p.endsWith('/Sources/ContentView.swift')) ?? Object.keys(files).find(p => p.includes('/Sources/') && p.endsWith('.swift') && new TextDecoder().decode(files[p]).includes('Custom primary'))!
  const external = info.outputPath('external-edit.swift')
  writeFileSync(external, files[sourcePath]!)
  writeFileSync(external, readFileSync(external, 'utf8').replace('Product catalog', 'Developer catalog') + '\n// External developer logic remains byte-identical.\n')
  files[sourcePath] = new Uint8Array(readFileSync(external))
  const imported = info.outputPath('external.swiftstudio.zip'); writeFileSync(imported, zipSync(files))
  await page.reload()
  await expect(page.getByTestId('render-tree').getByText('Custom primary', { exact: true })).toBeVisible()
  if (await page.getByTestId('gallery-dismiss').isVisible()) await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('app-icon').click()
  await page.getByTestId('open-files-input').setInputFiles(imported)
  await expect(page.getByTestId('import-review')).toContainText('belongs to the current project')
  await page.getByRole('button', { name: 'Apply reviewed changes', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Developer catalog', { exact: true })).toBeVisible()
  const reopened = unzipSync(await download(page))
  expect(reopened[sourcePath]).toEqual(files[sourcePath])
  for (const path of Object.keys(files).filter(p => p.endsWith('.png'))) expect(reopened[path]).toEqual(files[path])
  await info.attach('editable-project', { body: await download(page), contentType: 'application/zip' })
  await info.attach('browser-review', { body: await page.screenshot(), contentType: 'image/png' })
})

for (const device of ['iphone-15', 'iphone-18-pro']) for (const scheme of ['light', 'dark']) for (const size of ['large', 'accessibility3']) {
  test(`resource review capture: ${device}, ${scheme}, ${size}`, async ({ page }, info) => {
    await open(page)
    // Device, appearance and text size are the toolbar's preview environment in Design.
    await page.getByTestId('device-select').click(); await page.getByTestId(`device-select-menu-${device}`).click()
    await page.getByTestId('scheme-toggle').getByRole('button', { name: scheme === 'dark' ? 'Dark' : 'Light', exact: true }).click()
    await page.getByTestId('type-scale-select').click(); await page.getByTestId(`type-scale-select-menu-${size}`).click()
    await expect(page.getByTestId('render-tree').getByRole('img', { name: 'Photo', exact: true })).toBeVisible()
    // Capture evidence only; native comparison thresholds remain a separate required gate.
    await info.attach(`${device}-${scheme}-${size}`, { body: await page.getByRole('figure', { name: /^Edit Main page/ }).getByTestId('device-frame').screenshot(), contentType: 'image/png' })
  })
}

test('invalid image leaves the saved project intact and reports a keyboard-readable error', async ({ page }) => {
  await open(page)
  const before = unzipSync(await download(page))
  await page.getByLabel('Add bundled image').setInputFiles({ name: 'Corrupt.png', mimeType: 'image/png', buffer: Buffer.from('not an image') })
  await expect(page.getByTestId('project-resources').getByRole('alert')).toContainText('corrupt')
  const after = unzipSync(await download(page))
  for (const path of Object.keys(before)) expect(after[path]).toEqual(before[path])
})
