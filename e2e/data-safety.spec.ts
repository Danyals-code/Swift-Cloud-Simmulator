import { expect, test, type Page } from '@playwright/test'

/**
 * PR-B: a participant's work survives the browser (B1, B2, B3, B6).
 *
 * Pages from one Playwright context share one browser's storage, locks and channels,
 * which is what two tabs of the study URL do.
 */

async function renameApp(page: Page, name: string) {
  await page.getByTestId('project-name').dblclick()
  await page.getByTestId('project-name-input').fill(name)
  await page.getByTestId('project-name-input').press('Enter')
  await expect(page.getByTestId('project-name')).toHaveText(name)
}

/**
 * Headless pages are always visible, so switching tabs fires nothing. This fires what
 * a browser does when somebody leaves a tab and comes back.
 */
async function hideAndShow(page: Page) {
  await page.evaluate(() => {
    for (const state of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
  })
}

test('a second tab asks before taking over, and the first cannot write over its work (B1)', async ({ context }) => {
  const first = await context.newPage()
  await first.goto('/')
  await first.getByTestId('gallery-dismiss').click()
  await renameApp(first, 'First tab')
  await expect(first.getByTestId('save-indicator')).toHaveText('Saved locally')

  const second = await context.newPage()
  await second.goto('/')
  const elsewhere = second.getByTestId('open-elsewhere')
  await expect(elsewhere).toContainText('open in another tab')
  await expect(second.getByTestId('template-gallery')).toHaveCount(0)
  await elsewhere.getByRole('button', { name: 'Use it here' }).click()

  await expect(first.getByTestId('open-elsewhere')).toBeVisible()
  await second.getByTestId('gallery-dismiss').click()
  await expect(second.getByTestId('project-name')).toHaveText('First tab')
  await renameApp(second, 'Second tab')
  await expect(second.getByTestId('save-indicator')).toHaveText('Saved locally')

  // The first tab is looked at again, and put away again.
  await first.bringToFront()
  await hideAndShow(first)
  await first.close()

  await second.reload()
  await second.getByTestId('gallery-dismiss').click()
  await expect(second.getByTestId('project-name')).toHaveText('Second tab')
})
