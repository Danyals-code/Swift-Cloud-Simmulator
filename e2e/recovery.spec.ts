import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { expect, test, type Download, type Page } from '@playwright/test'

/**
 * A4: one exception must not leave a participant looking at a blank page.
 *
 * Crashes are forced with the studio's test trigger: sessionStorage
 * `studio.test.crash` names what should throw while it renders - a panel, `app` for
 * the whole studio (optionally `app@<project id>` for one project), or `document`
 * for the page around it.
 */

const CRASH = 'studio.test.crash'

async function openCode(page: Page) {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('editor')).toBeVisible()
}

async function typeAtTop(page: Page, text: string) {
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.insertText(text)
}

/** Every Swift file in a downloaded project, whether it came as a zip or a JSON backup. */
async function swiftIn(download: Download): Promise<string> {
  const bytes = readFileSync((await download.path())!)
  if (download.suggestedFilename().endsWith('.json')) {
    const record = JSON.parse(new TextDecoder().decode(bytes)) as { project: { files: { text: string }[] } }
    return record.project.files.map(file => file.text).join('\n')
  }
  const entries = unzipSync(bytes)
  return Object.entries(entries).filter(([name]) => name.endsWith('.swift')).map(([, file]) => new TextDecoder().decode(file)).join('\n')
}

test('a crash of the whole studio shows the recovery screen, and the download holds the latest edit', async ({ page }) => {
  await openCode(page)
  const marker = `// kept ${Date.now()}`
  await typeAtTop(page, `${marker}\n`)
  // The crash comes with the next render, well inside the half-second autosave delay.
  await page.evaluate(key => sessionStorage.setItem(key, 'app'), CRASH)
  await page.keyboard.insertText('// and this\n')

  const screen = page.getByTestId('recovery-screen')
  await expect(screen).toBeVisible()
  await expect(screen.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()
  await expect(screen.getByRole('button', { name: 'Open another project', exact: true })).toBeVisible()
  const waiting = page.waitForEvent('download')
  await screen.getByRole('button', { name: 'Download my project', exact: true }).click()
  const download = await waiting
  expect(download.suggestedFilename()).toMatch(/\.swiftstudio\.zip$/)
  const swift = await swiftIn(download)
  expect(swift).toContain(marker)
  expect(swift).toContain('// and this')
})

test('a project that crashes the studio is not reopened by itself: Open another project starts on Your projects', async ({ page }) => {
  await openCode(page)
  await typeAtTop(page, '// saved first\n')
  await expect(page.getByTestId('save-indicator')).toContainText('Saved locally')
  const id = await page.evaluate(() => localStorage.getItem('studio.lastOpened'))
  // A crash that only this project's content causes.
  await page.evaluate(([key, value]) => sessionStorage.setItem(key!, value!), [CRASH, `app@${id}`])
  await page.reload()
  await expect(page.getByTestId('recovery-screen')).toBeVisible()

  // Reloading opens the same project, so it crashes again.
  await Promise.all([page.waitForEvent('load'), page.getByTestId('recovery-screen').getByRole('button', { name: 'Reload', exact: true }).click()])
  await expect(page.getByTestId('recovery-screen')).toBeVisible()

  // Opening another project starts without it, on the list of saved projects.
  await Promise.all([page.waitForEvent('load'), page.getByTestId('recovery-screen').getByRole('button', { name: 'Open another project', exact: true }).click()])
  await expect(page.getByTestId('template-gallery')).toBeVisible()
  await expect(page.getByTestId('recovery-screen')).toHaveCount(0)
  // The project that crashed is listed to choose, and a new one is open instead.
  const recents = page.getByTestId('gallery-recents')
  await expect(recents.getByRole('button', { name: /· edited/ })).toHaveCount(1)
  await expect(recents.getByRole('button', { name: /· open now/ })).toHaveCount(1)
  await expect(page.getByTestId('template-gallery')).toContainText('closed unexpectedly')
})

/** An edit made in Design, which re-renders every panel and gives Undo a step. */
async function addText(page: Page) {
  await page.getByTestId('add-view').click()
  await page.getByTestId('add-view-text').click()
  await expect(page.getByTestId('add-view-palette')).toBeHidden()
}

const PANELS = [
  { area: 'canvas', mode: 'design' },
  { area: 'settings', mode: 'design' },
  { area: 'navigator', mode: 'design' },
  { area: 'preview', mode: 'design' },
  { area: 'editor', mode: 'develop' },
] as const

for (const { area, mode } of PANELS) {
  test(`a crash in the ${area} panel stays there, and Undo brings it back`, async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('gallery-dismiss').click()
    await addText(page)
    if (mode === 'develop') await page.getByTestId('workspace-develop').click()

    // The panel throws from its next render on, which switching the workspace theme
    // from the toolbar - outside every panel - brings about.
    await page.evaluate(([key, value]) => sessionStorage.setItem(key!, value!), [CRASH, area])
    await page.getByTestId('workspace-more').click()
    await page.getByTestId('workspace-more-menu-theme').click()
    const panel = page.getByTestId('recovery-panel')
    await expect(panel).toHaveAttribute('data-area', area)
    await expect(panel.getByRole('button', { name: 'Download my project', exact: true })).toBeVisible()
    await expect(page.getByTestId('recovery-screen')).toHaveCount(0)
    // The rest of the studio still answers.
    await expect(page.getByTestId('toolbar')).toBeVisible()
    if (mode === 'design') await expect(page.getByTestId('design-undo')).toBeEnabled()

    // Once the cause is gone, Undo draws the panel again - or, in Code, where Undo lives
    // in the editor that stopped, the panel's own Try again.
    await page.evaluate(key => sessionStorage.removeItem(key), CRASH)
    if (mode === 'develop') await panel.getByRole('button', { name: 'Try again', exact: true }).click()
    else await page.getByTestId('design-undo').click()
    await expect(panel).toHaveCount(0)
  })
}

test('an error outside any panel shows a banner and the studio keeps working; browser noise does not', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  const banner = page.getByTestId('recovery-banner')

  // Chrome reports a ResizeObserver loop as an error with no error in it: noise.
  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' })))
  await page.waitForTimeout(300)
  await expect(banner).toHaveCount(0)

  // A failure in a timer or event handler is caught by no panel.
  await page.evaluate(() => { setTimeout(() => { throw new Error('Background failure') }) })
  await expect(banner).toBeVisible()
  await expect(banner.getByRole('button', { name: 'Download my project', exact: true })).toBeVisible()
  await expect(page.getByTestId('recovery-screen')).toHaveCount(0)
  // The studio behind it still edits.
  await addText(page)
  await expect(page.getByTestId('design-undo')).toBeEnabled()
  await banner.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(banner).toHaveCount(0)

  // A promise nobody waited on, too.
  await page.evaluate(() => { void Promise.reject(new Error('Async failure')) })
  await expect(banner).toBeVisible()
})

test('if the studio’s code cannot load, Download my project still hands over the saved work', async ({ page }) => {
  await openCode(page)
  const marker = `// saved ${Date.now()}`
  await typeAtTop(page, `${marker}\n`)
  await expect(page.getByTestId('save-indicator')).toContainText('Saved locally')

  // On the next load the studio's own code never arrives.
  await page.route('**/_next/static/chunks/*.js', async route => {
    const response = await route.fetch()
    const body = await response.text()
    if (body.includes('Loading project…')) return route.abort()
    return route.fulfill({ response, body })
  })
  await page.reload()
  const screen = page.getByTestId('recovery-screen')
  await expect(screen).toContainText('did not finish loading')

  // Nothing of the studio ran, so the copy comes straight from the browser's storage.
  const waiting = page.waitForEvent('download')
  await screen.getByRole('button', { name: 'Download my project', exact: true }).click()
  expect(await swiftIn(await waiting)).toContain(marker)
})

test('looking for saved work in a new browser leaves its storage as it was, so saving still works', async ({ page }) => {
  const blockStudio = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    const response = await route.fetch()
    const body = await response.text()
    if (body.includes('Loading project…')) return route.abort()
    return route.fulfill({ response, body })
  }
  await page.route('**/_next/static/chunks/*.js', blockStudio)
  await page.goto('/')
  const screen = page.getByTestId('recovery-screen')
  await screen.getByRole('button', { name: 'Download my project', exact: true }).click()
  await expect(screen.getByRole('status')).toContainText('No saved project was found')

  // Had the search created an empty database, every save from here on would fail.
  await page.unroute('**/_next/static/chunks/*.js', blockStudio)
  await openCode(page)
  await typeAtTop(page, '// first save\n')
  await expect(page.getByTestId('save-indicator')).toContainText('Saved locally')
})

test('if the recovery screen itself fails, the page around it still offers the download', async ({ page }) => {
  await openCode(page)
  const marker = `// last line ${Date.now()}`
  await typeAtTop(page, `${marker}\n`)
  // The studio crashes, and so does the screen that would have caught it.
  await page.evaluate(key => sessionStorage.setItem(key, 'app,document'), CRASH)
  await page.keyboard.insertText('// and this\n')

  const screen = page.locator('[data-testid="recovery-screen"][data-scope="page"]')
  await expect(screen).toBeVisible()
  const waiting = page.waitForEvent('download')
  await screen.getByRole('button', { name: 'Download my project', exact: true }).click()
  expect(await swiftIn(await waiting)).toContain(marker)
})
