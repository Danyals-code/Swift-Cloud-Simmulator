import { readFileSync } from 'node:fs'
import { expect, test, type Download, type Locator, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'
import { openCounter } from './designer-helpers'

/**
 * The built-in image library (Wave 7b): 15 photos every project draws by name, listed in
 * Assets apart from the project's own, and never project files.
 */

async function startBlank(page: Page) {
  await page.goto('/')
  await page.getByTestId('template-blank').click()
  await page.getByTestId('template-confirm').click()
  await expect(page.getByTestId('template-gallery')).toBeHidden()
  await expect(page.getByTestId('add-screen')).toBeEnabled()
}

/** A row dragged from Assets and dropped, carrying what an Assets row carries. */
async function dropLibraryImage(target: Locator, name: string) {
  await target.evaluate((element, name) => {
    const transfer = new DataTransfer()
    transfer.setData('application/x-studio-asset', name)
    transfer.setData('text/plain', `Image("${name}")`)
    for (const type of ['dragenter', 'dragover', 'drop']) element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }))
  }, name)
}

const assets = (page: Page) => page.getByTestId('assets-folder')
const libraryRows = (page: Page) => assets(page).getByTestId('asset-library-image')
const canvasView = (page: Page) => page.locator('[data-testid="gallery-page"][data-active] [data-node-id]').last()
const canvasImages = (page: Page) => page.locator('[data-testid="gallery-page"][data-active] img')
/** Whether an image has arrived and decoded, rather than only being asked for. */
const loaded = (image: Locator) => image.evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth)

/** Shows the Files tab, where the Library folder starts open so the photos are easy to find. */
async function openLibrary(page: Page) {
  await page.getByTestId('hierarchy-files').click()
  await expect(assets(page).getByRole('button', { name: /^Library/ })).toHaveAttribute('aria-expanded', 'true')
  await expect(libraryRows(page)).toHaveCount(15)
}

/** Places snowy-peak on the blank screen and waits until it is drawn from its file. */
async function placeSnowyPeak(page: Page) {
  await startBlank(page)
  await expect(canvasImages(page)).toHaveCount(0)
  await dropLibraryImage(canvasView(page), 'snowy-peak')
  await expect(canvasImages(page)).toHaveCount(1)
  await expect(canvasImages(page)).toHaveAttribute('src', '/library/v1/snowy-peak.jpg')
  await expect.poll(() => loaded(canvasImages(page))).toBe(681)
  await expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
}

test('Assets lists the Library in a new project and in a template, without counting it as the project’s own', async ({ page }) => {
  await startBlank(page)
  await openLibrary(page)
  // The badge and the empty hint are about the project's own assets, which it has none of.
  await expect(assets(page)).toContainText('Drop PNG or JPEG images here')
  await expect(assets(page).getByTestId('asset-image')).toHaveCount(0)
  const peak = libraryRows(page).filter({ hasText: 'snowy-peak' })
  await expect(peak).toContainText('Library')
  await expect(peak).toContainText('227 × 341')
  await expect.poll(() => loaded(peak.locator('img'))).toBeGreaterThan(0)
  // Double-click looks closer, at the full image.
  await peak.dblclick()
  await expect(page.getByTestId('asset-preview')).toContainText('681 × 1024 px')
  await expect(page.getByTestId('asset-preview-image')).toHaveAttribute('src', '/library/v1/snowy-peak.jpg')
  await page.keyboard.press('Escape')

  await openCounter(page)
  await openLibrary(page)
  await expect(libraryRows(page).first()).toContainText('blue-mosaic')
})

test('a library image dragged onto the canvas draws there, and its name is in the code', async ({ page }) => {
  await placeSnowyPeak(page)
  // The screen's own file, as Code opens the app file first.
  await page.getByTestId('workspace-develop').click()
  await page.getByTestId('file-rail').getByText('HomeScreen.swift').click()
  await expect(page.getByTestId('editor')).toContainText('Image("snowy-peak")')
})

test('an export holds only the library images the code uses, as the 3x image, byte for byte', async ({ page }) => {
  await placeSnowyPeak(page)
  const waiting = page.waitForEvent('download')
  await page.getByTestId('export-button').click()
  const download: Download = await waiting
  const entries = unzipSync(new Uint8Array(readFileSync((await download.path())!)))
  const imagesets = new Set(Object.keys(entries).map(path => /\/([^/]+)\.imageset\//.exec(path)?.[1]).filter(Boolean))
  expect([...imagesets]).toEqual(['snowy-peak'])
  const [, contents] = Object.entries(entries).find(([path]) => path.endsWith('/snowy-peak.imageset/Contents.json'))!
  const set = JSON.parse(new TextDecoder().decode(contents)) as { images: { scale: string; filename?: string }[] }
  const filed = set.images.find(image => image.filename)!
  expect(filed.scale).toBe('3x')
  const [, bytes] = Object.entries(entries).find(([path]) => path.endsWith(`/snowy-peak.imageset/${filed.filename}`))!
  const served = new Uint8Array(await (await page.request.get('/library/v1/snowy-peak.jpg')).body())
  expect(Buffer.from(bytes).equals(Buffer.from(served))).toBe(true)
})

test('a share link of a project that uses a library image still works, and draws it', async ({ page, context }) => {
  // The link is read from what the page hands the clipboard, as the smoke test does.
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (text: string) => { (window as unknown as { copied?: string }).copied = text } })
  })
  await placeSnowyPeak(page)
  await expect(page.getByTestId('save-indicator')).toContainText('Saved', { timeout: 5_000 })
  await page.getByTestId('share-button').click()
  await expect(page.getByTestId('share-button')).toHaveText('Link copied', { timeout: 5_000 })
  const link = await page.evaluate(() => (window as unknown as { copied?: string }).copied ?? '')
  expect(link).toContain('#p=')

  const fresh = await context.browser()!.newContext()
  try {
    const other = await fresh.newPage()
    await other.goto(link)
    const image = other.getByTestId('render-tree').locator('img')
    await expect(image).toHaveAttribute('src', '/library/v1/snowy-peak.jpg')
    await expect.poll(() => loaded(image)).toBe(681)
  } finally {
    await fresh.close()
  }
})
