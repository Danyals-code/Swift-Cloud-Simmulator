import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { PNG } from 'pngjs'
import { openCounter, replaceSource } from './designer-helpers'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../tests/fixtures/ios27-screens.swift', import.meta.url), 'utf8')
const preview = (page: Page) => page.getByTestId('render-tree')
async function openFixture(page: Page) {
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  // Code opens with the preview pointing at views; the matrix taps it as an app.
  await page.getByTestId('live-toggle').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(source)
  await expect(preview(page).getByRole('button', { name: 'Compose', exact: true })).toBeVisible()
  await expect(preview(page)).toHaveAttribute('data-calibration', 'provisional')
}
async function capture(page: Page, info: TestInfo, name: string) {
  // Review artifacts, not native parity claims. Geometry baselines run in Vitest.
  await info.attach(name, { body: await preview(page).screenshot({ animations: 'disabled' }), contentType: 'image/png' })
}

for (const [device, scheme, type] of [
  ['iphone-se-3', 'light', 'large'], ['iphone-se-3', 'dark', 'large'],
  ['iphone-15', 'light', 'large'], ['iphone-15', 'dark', 'large'],
  ['iphone-18-pro', 'light', 'large'],
  ['ipad-11', 'light', 'large'], ['ipad-11', 'dark', 'large'],
  ['iphone-15', 'light', 'accessibility3'],
] as const) {
  test(`ios-27 screen matrix: ${device} ${scheme} ${type}`, async ({ page }, info) => {
    await openFixture(page)
    await page.getByTestId('device-select').click()
    await page.getByTestId(`device-select-menu-${device}`).click()
    await page.getByTestId('scheme-toggle').getByRole('button', { name: scheme === 'dark' ? 'Dark' : 'Light', exact: true }).click()
    await page.getByTestId('type-scale-select').click()
    await page.getByTestId(`type-scale-select-menu-${type}`).click()
    await expect(preview(page).getByRole('textbox', { name: 'Search library', exact: true })).toBeVisible()
    await capture(page, info, 'library')
    await preview(page).getByRole('button', { name: 'Compose', exact: true }).click()
    const sheet = preview(page).locator('[data-node-id="overlay-surface"]')
    await expect(sheet.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Taylor')
    // The background remains painted behind the sheet. Playwright's role lookup
    // does not consistently exclude inert subtrees (microsoft/playwright#36938),
    // so verify browser interaction blocking directly rather than DOM absence.
    const settings = preview(page).getByRole('button', { name: 'Settings', exact: true, includeHidden: true })
    await expect(settings).toHaveCount(1)
    expect(await settings.evaluate(element => element.closest('[inert]') !== null)).toBe(true)
    await settings.focus()
    await expect(settings).not.toBeFocused()
    await capture(page, info, 'sheet')
    await sheet.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    expect(await settings.evaluate(element => element.closest('[inert]') !== null)).toBe(false)
    await settings.focus()
    await expect(settings).toBeFocused()
    await settings.press('Enter')
    await expect(preview(page).getByRole('switch', { name: 'Notifications', exact: true })).toBeVisible()
    await capture(page, info, 'settings')
  })
}

test('ios-27 scroll collapse is local and menus stay beside their control', async ({ page }, info) => {
  await openFixture(page)
  // Font refinement may finish after the first frame. Wait for a stable revision.
  let revision = ''
  await expect.poll(async () => { const next = await preview(page).getAttribute('data-revision'); const settled = next === revision; revision = next ?? ''; return settled }).toBe(true)
  const bounds = await preview(page).boundingBox()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
  await page.mouse.wheel(0, 250)
  await expect(preview(page).locator('[data-chrome-role="inlineTitle"]')).toHaveCSS('opacity', '1')
  expect(await preview(page).getAttribute('data-revision')).toBe(revision)
  await capture(page, info, 'scrolled-library')
  await preview(page).getByRole('button', { name: 'Settings', exact: true }).click()
  const options = preview(page).getByRole('button', { name: 'Options', exact: true })
  await options.scrollIntoViewIfNeeded()
  const anchor = await options.boundingBox()
  await options.click()
  const menu = preview(page).locator('[data-node-id="overlay-menu"]')
  await expect(menu).toBeVisible()
  const panel = await menu.boundingBox()
  expect(Math.min(Math.abs(panel!.y - (anchor!.y + anchor!.height)), Math.abs(anchor!.y - (panel!.y + panel!.height)))).toBeLessThan(16)
  await capture(page, info, 'menu')
  await menu.getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(preview(page).getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Renamed')
})


test('ios-27 detail alerts close when their action is chosen', async ({ page }, info) => {
  await openFixture(page)
  await preview(page).getByRole('button', { name: 'A quiet place', exact: true }).click()
  await preview(page).getByRole('button', { name: 'Show alert', exact: true }).click()
  await expect(preview(page).getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  await capture(page, info, 'alert')
  await preview(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(preview(page).locator('[data-node-id="overlay-dim"]')).toHaveCount(0)
  await expect(preview(page).getByRole('button', { name: 'Show alert', exact: true })).toBeVisible()
})

// Exact wrapping is compared only with the Mac system font used by the reference.
// Linux still runs the interaction and geometry matrix with its substitute fonts.
test('reference phone retains native paragraph word boundaries on macOS', async ({ page }) => {
  test.skip(process.platform !== 'darwin', 'Native system-font word boundaries require macOS')
  await openFixture(page)
  await page.getByTestId('device-select').click()
  await page.getByTestId('device-select-menu-iphone-18-pro').click()
  const row = preview(page).getByLabel('A longer row with enough words to wrap onto several lines when accessibility text is selected.', { exact: true })
  await expect(row.locator('span')).toHaveText([
    'A longer row with enough words to wrap',
    'onto several lines when accessibility text is',
    'selected.',
  ])
  await preview(page).getByRole('button', { name: 'A quiet place', exact: true }).click()
  const paragraph = preview(page).getByLabel('A longer description that should wrap naturally and keep the same margins when text size changes.', { exact: true })
  await expect(paragraph.locator('span')).toHaveText([
    'A longer description that should wrap naturally',
    'and keep the same margins when text size',
    'changes.',
  ])
})

test.describe('a grouped list card as the browser draws it', () => {
  test.use({ deviceScaleFactor: 3 })

  test('rounds its corners as the iOS 27 simulator does', async ({ page }) => {
    await openCounter(page)
    await page.getByTestId('workspace-develop').click()
    await replaceSource(page, `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}

struct ContentView: View {
    var body: some View {
        NavigationStack {
            List { Section { Text("One"); Text("Two"); Text("Three") } }
                .navigationTitle("Corners")
        }
    }
}`)
    await expect(preview(page).getByText('Three', { exact: true })).toBeVisible()

    // The card is 370 pt wide, which gives the preview's scale on the page.
    const box = (await preview(page).locator('[data-node-id$="s0clip-clip"]').first().boundingBox())!
    const scale = box.width / 370
    // Whole CSS pixels, which both engines clip alike, measured from the card's own corner.
    const clip = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(14 * scale) + 2, height: Math.ceil(26 * scale) + 2 }
    const shot = PNG.sync.read(await page.screenshot({ clip }))
    const ratio = shot.width / clip.width
    // How far below the card's top its edge is, 4.5 pt in: 11.26 pt in the simulator, and
    // 6 for the corner the preview drew before. The card is white on the grey.
    const column = Math.round((box.x - clip.x + 4.5 * scale) * ratio)
    const green = (y: number) => shot.data[(y * shot.width + column) * 4 + 1]!
    const grey = green(0), edge = (grey + 255) / 2
    let y = Math.round((box.y - clip.y) * ratio)
    while (y < shot.height && green(y) < edge) y++
    expect(Math.abs((y / ratio - (box.y - clip.y)) / scale - 11.26)).toBeLessThan(1)
  })
})
