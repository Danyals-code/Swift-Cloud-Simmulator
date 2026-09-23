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

test('without Web Locks, an out-of-date tab cannot save over newer work, and says so (B1)', async ({ context }) => {
  // An older browser, or one that refuses the lock: both tabs have the studio, and the
  // revision storage checks inside each write is what stands between them.
  await context.addInitScript(() => { Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }) })
  const first = await context.newPage()
  await first.goto('/')
  await first.getByTestId('gallery-dismiss').click()
  await renameApp(first, 'First tab')
  await expect(first.getByTestId('save-indicator')).toHaveText('Saved locally')

  const second = await context.newPage()
  await second.goto('/')
  await second.getByTestId('gallery-dismiss').click()
  await renameApp(second, 'Second tab')
  await expect(second.getByTestId('save-indicator')).toHaveText('Saved locally')

  // The first tab's copy is older now, and its next save is refused rather than kept.
  await renameApp(first, 'Stale tab')
  const banner = first.getByTestId('save-banner')
  await expect(banner).toContainText('This project was changed in another tab.')
  await expect(banner.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()
  await expect(banner.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
  await first.close()

  await second.reload()
  await second.getByTestId('gallery-dismiss').click()
  await expect(second.getByTestId('project-name')).toHaveText('Second tab')
})

test('when saves fail, the studio says why, offers the work as a file, and asks before switching or leaving (B3)', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await renameApp(page, 'Kept work')
  await expect(page.getByTestId('save-indicator')).toHaveText('Saved locally')
  // The browser stops taking writes, as it does when the disk is full.
  await page.evaluate(() => { IDBObjectStore.prototype.put = () => { throw new DOMException('The disk is full.', 'QuotaExceededError') } })
  await renameApp(page, 'Unsaved work')

  const banner = page.getByTestId('save-banner')
  await expect(banner).toContainText('The disk is full.')
  await expect(page.getByTestId('save-indicator')).toHaveText('Could not save')
  const downloading = page.waitForEvent('download')
  await banner.getByRole('button', { name: 'Download my project' }).click()
  expect((await downloading).suggestedFilename()).toMatch(/\.swiftstudio\.zip$/)

  // Closing the tab asks first.
  const asked = page.waitForEvent('dialog')
  await page.close({ runBeforeUnload: true })
  const leaving = await asked
  expect(leaving.type()).toBe('beforeunload')
  await leaving.dismiss()

  // So does switching project, which offers the download before going on without it.
  // (A rename alone leaves the files as they were made, so there is no "Open …?" first.)
  await page.getByTestId('workspace-more').click()
  await page.getByTestId('workspace-more-menu-new').click()
  await page.getByTestId('template-confirm').click()
  const unsaved = page.getByTestId('unsaved-confirm')
  await expect(unsaved).toContainText('Unsaved work')
  await expect(unsaved.getByRole('button', { name: 'Download this project' })).toBeVisible()
  await unsaved.getByRole('button', { name: 'Switch anyway' }).click()
  await expect(page.getByTestId('template-gallery')).toHaveCount(0)
  await expect(page.getByTestId('project-name')).toHaveText('MyDesignApp')
  await expect(page.getByTestId('save-banner')).toBeVisible()
})

test('coming back finds the work: the sheet opens on Your projects, and More leads to both (B6)', async ({ page }) => {
  await page.goto('/')
  // A fresh browser starts with a blank screen, and offers to start designing.
  await expect(page.getByTestId('gallery-source-design')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('gallery-dismiss').click()
  await expect(page.getByTestId('project-name')).toHaveText('MyDesignApp')
  await renameApp(page, 'My work')
  await expect(page.getByTestId('save-indicator')).toHaveText('Saved locally')

  // With work saved, the sheet leads back to it rather than to a new project.
  await page.reload()
  await expect(page.getByTestId('gallery-source-open')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('gallery-continue')).toContainText('My work')
  await expect(page.getByTestId('template-confirm')).toHaveText('Continue editing')
  await page.getByTestId('template-confirm').click()
  await expect(page.getByTestId('template-gallery')).toHaveCount(0)
  await expect(page.getByTestId('project-name')).toHaveText('My work')

  // The toolbar says what its icon opens, and More leads to the list and to a new project.
  await expect(page.getByTestId('app-icon')).toHaveAccessibleName('Projects')
  await page.getByTestId('workspace-more').click()
  await page.getByTestId('workspace-more-menu-projects').click()
  await expect(page.getByTestId('gallery-source-open')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('gallery-cancel').click()
  await page.getByTestId('workspace-more').click()
  await expect(page.getByTestId('workspace-more-menu-new')).toHaveText(/New project…/)
  await page.getByTestId('workspace-more-menu-new').click()
  await expect(page.getByTestId('gallery-source-design')).toHaveAttribute('aria-pressed', 'true')
})

test('a browser that keeps nothing says so, and does not claim to have saved (B2)', async ({ page }) => {
  // With no IndexedDB at all, the studio keeps the work in the page and nowhere else.
  await page.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }) })
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()

  await expect(page.getByTestId('save-banner')).toContainText('This browser is not saving your work.')
  await expect(page.getByTestId('save-indicator')).toHaveText('Not saved')
  await renameApp(page, 'Only in this tab')
  await expect(page.getByTestId('save-indicator')).toHaveText('Not saved')
  await expect(page.getByTestId('save-banner').getByRole('button', { name: 'Download my project' })).toBeVisible()
})
