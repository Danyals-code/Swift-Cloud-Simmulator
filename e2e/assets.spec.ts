import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'

const png = readFileSync(new URL('../tests/fixtures/authoring-photo.png', import.meta.url)).toString('base64')

async function start(page: Page) {
  await page.goto('/')
  await page.getByTestId('template-blank').click()
  await page.getByTestId('template-confirm').click()
  await expect(page.getByTestId('template-gallery')).toBeHidden()
  await expect(page.getByTestId('add-screen')).toBeEnabled()
}

/**
 * A drop from outside the browser. Playwright cannot drag a file in from the desktop,
 * but the page sees the same events with the same `DataTransfer` either way.
 */
async function drop(target: Locator, payload: { files?: readonly string[]; asset?: string }) {
  await target.evaluate((element, { files, asset, png }) => {
    const transfer = new DataTransfer()
    const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0))
    for (const name of files ?? []) transfer.items.add(new File([name.endsWith('.png') ? bytes : new TextEncoder().encode('{}')], name, { type: name.endsWith('.png') ? 'image/png' : 'text/plain' }))
    if (asset) { transfer.setData('application/x-studio-asset', asset); transfer.setData('text/plain', `Image("${asset}")`) }
    for (const type of ['dragenter', 'dragover', 'drop']) element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }))
  }, { ...payload, png })
}

const assets = (page: Page) => page.getByTestId('assets-folder')
const assetRow = (page: Page, name: string) => assets(page).getByTestId('asset-image').filter({ hasText: name })
/** A view on the active screen, which is what a drop on the canvas lands on. */
const canvasView = (page: Page) => page.locator('[data-testid="gallery-page"][data-active] [data-node-id]').last()
const images = (page: Page) => page.locator('[data-testid="gallery-page"][data-active] img')

test('images land in Assets however they arrive, and an Assets image drops onto a view', async ({ page }) => {
  await start(page)
  // Hierarchy holds both views of the project: its layers, and its files.
  await expect(page.getByRole('tablist', { name: 'Left panel', exact: true }).getByRole('tab', { name: 'Hierarchy', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByTestId('hierarchy-files').click()
  await expect(assets(page)).toContainText('Drop PNG or JPEG images here')
  await expect(page.getByTestId('project-files').getByRole('button', { name: 'Sources' })).toBeVisible()

  // Dropped on the folder: added, named after the file. Anything else is refused by name.
  await drop(assets(page), { files: ['Sunset.png', 'notes.json'] })
  await expect(assetRow(page, 'Sunset')).toBeVisible()
  await expect(assets(page).getByRole('alert')).toContainText('notes.json is not a PNG or JPEG image.')

  // An Assets row dropped on a view becomes an Image there.
  await expect(images(page)).toHaveCount(0)
  await drop(canvasView(page), { asset: 'Sunset' })
  await expect(images(page)).toHaveCount(1)

  // A file dropped on a view goes to Assets and onto the view in one step.
  await drop(canvasView(page), { files: ['Beach.png'] })
  await expect(images(page)).toHaveCount(2)
  await expect(assetRow(page, 'Beach')).toBeVisible()

  // Dropped anywhere else, it still goes to Assets rather than replacing the studio.
  await drop(page.getByRole('complementary', { name: 'Settings', exact: true }), { files: ['Forest.png'] })
  await expect(assetRow(page, 'Forest')).toBeVisible()

  // A Swift file in Files opens in Code, whose file tree has the same Assets folder above the Swift.
  await page.getByTestId('project-files').getByRole('button', { name: 'HomeScreen.swift', exact: true }).click()
  await expect(page.getByTestId('editor')).toContainText('Image("Sunset")')
  await expect(page.getByTestId('file-rail').getByTestId('assets-folder').getByTestId('asset-image')).toHaveCount(3)
})

test('double-clicking an image in Assets opens it up close, zooms, and closes with Escape', async ({ page }) => {
  await start(page)
  await page.getByTestId('hierarchy-files').click()
  await drop(assets(page), { files: ['Sunset.png'] })
  await assetRow(page, 'Sunset').dblclick()
  const preview = page.getByTestId('asset-preview')
  await expect(preview).toBeVisible()
  await expect(preview.getByRole('button', { name: 'Fit', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(preview.getByRole('group', { name: 'Zoom' }).locator('output')).toHaveText(/^\d+%$/)
  // A click on the image is its real size; the buttons step from there.
  await page.getByTestId('asset-preview-image').click()
  await expect(preview.getByRole('group', { name: 'Zoom' }).locator('output')).toHaveText('100%')
  await preview.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(preview.getByRole('group', { name: 'Zoom' }).locator('output')).toHaveText('150%')
  const zoomed = (await page.getByTestId('asset-preview-image').boundingBox())!
  await preview.getByRole('button', { name: 'Fit', exact: true }).click()
  expect((await page.getByTestId('asset-preview-image').boundingBox())!.width).not.toBe(zoomed.width)
  await page.keyboard.press('Escape')
  await expect(preview).toBeHidden()
  // The keyboard opens it too, from the row.
  await assetRow(page, 'Sunset').focus()
  await page.keyboard.press('Enter')
  await expect(preview).toBeVisible()
  await page.getByRole('button', { name: 'Close preview', exact: true }).click()
  await expect(preview).toBeHidden()
})
