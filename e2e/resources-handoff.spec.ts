import { expect, test, type Page } from '@playwright/test'
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
async function open(page: Page) {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(SOURCE)
  await expect(page.getByTestId('render-tree').getByText('First', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click(); await page.getByTestId('inspect-toggle').click()
  await page.getByTestId('inspector-tab-settings').click()
  await page.getByTestId('project-resources').locator('summary').first().click()
  await page.getByLabel('Add bundled image').setInputFiles({ name: 'Photo.png', mimeType: 'image/png', buffer: photo })
  await expect(page.getByTestId('render-tree').getByRole('img', { name: 'Photo', exact: true })).toBeVisible()
  await page.getByTestId('project-resources').getByText('Photo · 2 × 1 pt', { exact: true }).click()
  await page.getByLabel('Photo dark image').setInputFiles({ name: 'Photo-dark.png', mimeType: 'image/png', buffer: darkPhoto })
  await expect(page.getByTestId('project-resources').getByRole('img', { name: 'Photo dark', exact: true })).toBeVisible()
  await expect(page.getByTestId('logical-layers').getByRole('tree')).toHaveAttribute('aria-busy', 'false')
}
async function download(page: Page) {
  const waiting = page.waitForEvent('download')
  await page.getByTestId('download-editable').click()
  const file = await waiting
  return readFileSync((await file.path())!)
}

for (const run of [1, 2]) test(`fresh designer handoff workflow ${run}: edit, export, reload, external edit, review, reopen`, async ({ page }, info) => {
  test.setTimeout(120_000)
  await open(page)
  const layers = page.getByTestId('logical-layers'), inspector = page.getByTestId('authoring-inspector'), resources = page.getByTestId('project-resources')
  await layers.locator('[data-source-name="List"]').click()
  await inspector.getByRole('button', { name: 'Add record', exact: true }).click()
  await inspector.getByLabel('Record title', { exact: true }).fill('Preview item')
  await inspector.getByRole('button', { name: 'Apply preview records', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Preview item', { exact: true })).toBeVisible()
  await page.getByTestId('inspector-tab-preview').click()
  const scenarios = page.getByTestId('preview-scenarios')
  await scenarios.locator('summary').first().click(); await page.getByLabel('Preview scenario', { exact: true }).selectOption('')
  await expect(page.getByTestId('render-tree').getByText('First', { exact: true })).toBeVisible()
  await page.getByTestId('inspector-tab-settings').click()
  await expect(layers.getByRole('tree')).toHaveAttribute('aria-busy', 'false')
  await layers.locator('[data-source-name="Card"][data-source-kind="component"]').first().click()
  const title = inspector.getByRole('textbox', { name: 'title', exact: true })
  await title.fill('Custom primary'); await title.press('Enter')
  await expect(page.getByTestId('render-tree').getByText('Custom primary', { exact: true })).toBeVisible()
  await expect(page.getByTestId('render-tree').getByText('Secondary', { exact: true })).toBeVisible()
  // Settings remounts after visiting Preview, so reopen its resource disclosure.
  await resources.locator('summary').first().click()
  await resources.getByText('Theme.brand · color · blue', { exact: true }).click()
  await resources.getByLabel('Theme.brand value').fill('#2468ac')
  await resources.getByRole('button', { name: 'Update shared value · all uses', exact: true }).click()
  await expect(resources).toContainText('#2468ac')
  await expect(layers.getByRole('tree')).toHaveAttribute('aria-busy', 'false')
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
    await page.getByTestId('inspector-tab-preview').click()
    await page.getByTestId('device-select').click(); await page.getByTestId(`device-select-menu-${device}`).click()
    await page.getByTestId('scheme-toggle').getByRole('button', { name: scheme === 'dark' ? 'Dark' : 'Light', exact: true }).click()
    await page.getByTestId('type-scale-select').click(); await page.getByTestId(`type-scale-select-menu-${size}`).click()
    await expect(page.getByTestId('render-tree').getByRole('img', { name: 'Photo', exact: true })).toBeVisible()
    // Capture evidence only; native comparison thresholds remain a separate required gate.
    await info.attach(`${device}-${scheme}-${size}`, { body: await page.getByTestId('device-frame').screenshot(), contentType: 'image/png' })
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
