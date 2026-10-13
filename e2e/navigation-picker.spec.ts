import { expect, test, type Page } from '@playwright/test'

const phones = (page: Page) => page.getByTestId('gallery-page')
const libraryPhone = (page: Page) => phones(page).filter({ has: page.getByRole('button', { name: 'Edit Library', exact: true }) })
const destination = (page: Page) => page.getByRole('combobox', { name: 'Navigate to', exact: true })
/**
 * Folio opens in Edit with every screen drawn: three tab lanes, with Book details
 * and the Add a book sheet beside Library. The sheet Reading list opens is the same
 * screen, so it is drawn once - five phones for six pages.
 */
const DRAWN_SCREENS = 5
async function folio(page: Page) {
  await page.setViewportSize({ width: 1920, height: 1200 })
  await page.goto('/')
  await page.getByTestId('gallery-source-app').click()
  await page.getByTestId('template-folio').click()
  await page.getByTestId('template-confirm').click()
  // Book details draws a sample book too, so the list is read from the Library phone.
  await expect(libraryPhone(page).getByTestId('render-tree').getByText('The Secret Garden', { exact: true })).toBeVisible()
  await expect(phones(page)).toHaveCount(DRAWN_SCREENS)
  await page.getByRole('button', { name: 'Edit Library', exact: true }).click()
  await page.getByTestId('logical-layers').getByRole('treeitem', { name: 'Book row, Component', exact: true }).click()
  await expect(destination(page)).toBeVisible()
  await expect(page.getByTestId('navigation-destination-editor')).toContainText('book')
}
/** The selected view's own Swift, opened from its settings - what "View source" used to show. */
async function openSelectionInCode(page: Page) {
  await page.getByTestId('authoring-inspector').getByRole('button', { name: 'View actions', exact: true }).click()
  await page.getByRole('option', { name: 'Open in Code', exact: true }).click()
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-mode', 'develop')
  return page.getByTestId('editor').locator('.cm-content')
}

test('canvas eyedropper cancels safely, preserves selection, and applies the chosen tab screen', async ({ page, browserName }, testInfo) => {
  // Not a fix. On CI's Linux WebKit this ran past 30 s in its last steps in 12 of 14
  // runs to 2026-09-25, more than seven times as long as on a Mac, while tests that
  // take twice as long on a Mac pass there. Tripled until a trace says which step is
  // slow; a run that still times out points at a stall, and its retry trace shows where.
  test.slow(browserName === 'webkit', 'Runs past 30 s in its last steps on CI\'s Linux WebKit')
  await folio(page)
  const original = await destination(page).inputValue()
  const library = libraryPhone(page)
  const originalBounds = await library.boundingBox()
  await page.getByRole('button', { name: 'Pick screen from canvas', exact: true }).click()
  await expect(page.getByTestId('navigation-pick-target')).toHaveCount(DRAWN_SCREENS)
  const targetBounds = await page.getByRole('button', { name: 'Navigate to Settings', exact: true }).boundingBox()
  await page.keyboard.down('Space')
  await page.mouse.move(targetBounds!.x + targetBounds!.width / 2, targetBounds!.y + targetBounds!.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBounds!.x + targetBounds!.width / 2 + 30, targetBounds!.y + targetBounds!.height / 2 + 25)
  await page.mouse.up()
  await page.keyboard.up('Space')
  await expect(page.getByTestId('navigation-pick-target')).toHaveCount(DRAWN_SCREENS)
  const canvas = await page.getByTestId('device-pane').boundingBox()
  await page.mouse.move(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -160)
  await page.keyboard.up('Control')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('navigation-pick-target')).toHaveCount(0)
  await expect(phones(page)).toHaveCount(DRAWN_SCREENS)
  await expect(destination(page)).toHaveValue(original)
  const restoredBounds = await library.boundingBox()
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(restoredBounds![key]).toBeCloseTo(originalBounds![key], 1)
  // Putting the settings panel away mid-pick cancels the pick, as leaving for the
  // old Preview tab did, and bringing it back finds the destination untouched.
  await page.getByRole('button', { name: 'Pick screen from canvas', exact: true }).click()
  await expect(page.getByTestId('navigation-pick-target')).toHaveCount(DRAWN_SCREENS)
  await page.getByTestId('pane-toggle-preview').click()
  await expect(page.getByTestId('navigation-pick-target')).toHaveCount(0)
  await page.getByTestId('pane-toggle-preview').click()
  await expect(destination(page)).toHaveValue(original)
  await expect(page.getByTestId('logical-layers').locator('[aria-selected="true"]')).toContainText('Book row')
  await page.getByRole('button', { name: 'Pick screen from canvas', exact: true }).click()
  const settings = page.getByTestId('navigation-pick-target').filter({ hasText: 'Choose Settings' })
  await expect(settings).toHaveAttribute('aria-disabled', 'false')
  await settings.hover()
  await expect(page.getByTestId('logical-layers').locator('[aria-selected="true"]')).toContainText('Book row')
  const screenshot = testInfo.outputPath('navigation-screen-picker.png')
  await page.screenshot({ path: screenshot })
  await testInfo.attach('navigation screen picker', { path: screenshot, contentType: 'image/png' })
  await settings.click()
  await expect(page.getByTestId('navigation-pick-target')).toHaveCount(0)
  await expect(destination(page)).toHaveValue(/Settings/)
  await expect(page.getByTestId('navigation-destination-editor')).toContainText('Current: BookDetailView(book: book)')
  await page.getByRole('button', { name: 'Apply destination', exact: true }).click()
  await expect(page.getByTestId('navigation-destination-editor')).toContainText('Current: SettingsView()')
  const source = await openSelectionInCode(page)
  await expect(source).toContainText('destination: SettingsView()')
  await expect(source).toContainText('BookRow(book: book)')
  await expect(source).toContainText('BookDetailView(book: book)')
  await page.getByTestId('workspace-design').click()
  await page.getByTestId('live-toggle').click()
  await page.getByTestId('render-tree').getByRole('button', { name: 'The Secret Garden, Frances Hodgson Burnett', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByRole('textbox', { name: 'Your name', exact: true })).toBeVisible()
})

test('picking a data-driven detail retains the selected row data rather than its preview sample', async ({ page }) => {
  await folio(page)
  await destination(page).fill('SettingsView')
  await destination(page).press('Escape')
  await page.getByRole('button', { name: 'Pick screen from canvas', exact: true }).click()
  const detail = page.getByTestId('navigation-pick-target').filter({ hasText: 'Choose Book details' })
  await expect(detail).toHaveAttribute('aria-disabled', 'false')
  await detail.click()
  await expect(destination(page)).toHaveValue(/Book detail/i)
  await expect(page.getByRole('button', { name: 'Apply destination', exact: true })).toBeDisabled()
  const source = await openSelectionInCode(page)
  await expect(source).toContainText('NavigationLink(value: book)')
  await expect(source).not.toContainText('destination: BookDetailView')
})
