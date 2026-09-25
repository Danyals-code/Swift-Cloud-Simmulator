import { expect, test, type Page } from '@playwright/test'

/** Picks an item from the toolbar's More menu, which holds the workspace options. */
async function chooseMore(page: Page, item: 'theme' | 'problems') {
  await page.getByTestId('workspace-more').click()
  await page.getByTestId(`workspace-more-menu-${item}`).click()
}

test('Design opens first with an interactive preview and settings', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-mode', 'design')
  await expect(page.getByTestId('editor')).toBeHidden()
  await expect(page.getByTestId('device-select')).toBeVisible()
  await expect(page.getByTestId('render-tree')).toBeVisible()
  await expect(page.getByTestId('workspace-design')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('editor')).toBeVisible()
  await expect(page.getByTestId('render-tree')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Workspace view' }).getByRole('button')).toHaveCount(2)
  await page.getByTestId('workspace-design').click()
  await expect(page.getByTestId('render-tree')).toBeVisible()
  await expect(page.getByTestId('editor')).toBeHidden()
})

test('opening a source file from Design reveals code, and a reload comes back to Design', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  // Design's navigator lists screens rather than files, so a file opens from Go to file.
  await page.keyboard.press('ControlOrMeta+p')
  await page.getByTestId('file-switcher-input').fill('HomeScreen')
  await page.getByTestId('file-switcher-input').press('Enter')
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-mode', 'develop')
  await expect(page.getByTestId('editor')).toBeVisible()
  await expect(page.getByTestId('tab-bar').getByRole('tab', { name: 'HomeScreen.swift' })).toHaveAttribute('aria-selected', 'true')
  await page.reload()
  await page.getByTestId('gallery-dismiss').click()
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-mode', 'design')
  await expect(page.getByTestId('editor')).toBeHidden()
})

test('a narrow Design window keeps Layers and the preview settings in reach (D15)', async ({ page }) => {
  // Half of a laptop screen, as with the instructions tiled beside the studio.
  await page.setViewportSize({ width: 760, height: 700 })
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await expect(page.getByTestId('narrow-window')).toBeVisible()

  // The canvas keeps the room, and Layers opens over it. (Its own Collapse button is there
  // too, hidden, with the panel kept for when it opens again.)
  await expect(page.getByTestId('design-navigator')).toBeHidden()
  await page.getByRole('button', { name: 'Show left panel', exact: true }).click()
  await expect(page.getByTestId('layers-over')).toBeVisible()
  await expect(page.getByTestId('design-navigator')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('layers-over')).toHaveCount(0)

  // The preview settings the toolbar has no room for are in the canvas heading.
  await expect(page.getByTestId('device-select')).toBeVisible()
  await expect(page.getByTestId('type-scale-select')).toBeVisible()
  await expect(page.getByTestId('zoom-select')).toBeVisible()
  await page.getByTestId('scheme-toggle').getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(page.getByTestId('scheme-toggle').getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true')

  // Opening Layers stored nothing, so a wider window has it beside the canvas again.
  await page.setViewportSize({ width: 1300, height: 700 })
  await expect(page.getByTestId('design-navigator')).toBeVisible()
  await expect(page.getByTestId('layers-over')).toHaveCount(0)
  await expect(page.getByTestId('narrow-window')).toHaveCount(0)
})


test('workspace theme persists independently of preview appearance and mode', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  const previewLight = page.getByTestId('scheme-toggle').getByRole('button', { name: 'Light', exact: true })
  await previewLight.click()
  await chooseMore(page, 'theme')
  await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', 'dark')
  await expect(previewLight).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('render-tree')).toHaveCSS('color-scheme', 'light')
  await expect(page.getByTestId('toolbar')).toHaveCSS('background-color', 'rgb(36, 36, 38)')
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('editor').locator('.cm-editor')).toHaveCSS('background-color', 'rgb(32, 32, 34)')
  await page.reload()
  await page.getByTestId('gallery-dismiss').click()
  await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', 'dark')
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-mode', 'design')
  await expect(previewLight).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('workspace-develop').click()
  await chooseMore(page, 'theme')
  await expect(page.getByTestId('editor').locator('.cm-editor')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', 'light')
})

test('the panes on both sides of each workspace can be dragged', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()

  const width = (testId: string) => page.getByTestId(testId).evaluate(el => el.getBoundingClientRect().width)
  const drag = async (label: string, by: number) => {
    const handle = page.getByTestId(`splitter-${label}`)
    const box = (await handle.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    // More than one move: a single one used to be all the divider ever saw,
    // because the re-render it caused tore the drag down behind it.
    await page.mouse.move(box.x + box.width / 2 + by / 2, box.y + box.height / 2)
    await page.mouse.move(box.x + box.width / 2 + by, box.y + box.height / 2)
    await page.mouse.up()
  }

  const layersBefore = await width('design-navigator')
  await drag('navigator-width', 90)
  expect(await width('design-navigator')).toBeGreaterThan(layersBefore + 60)

  const settings = page.getByRole('complementary', { name: 'Settings', exact: true })
  const settingsBefore = (await settings.boundingBox())!.width
  await drag('preview-settings-width', -70)
  expect((await settings.boundingBox())!.width).toBeGreaterThan(settingsBefore + 50)

  await page.getByTestId('workspace-develop').click()
  const pane = page.locator('section[aria-label="Preview"]')
  const previewBefore = (await pane.boundingBox())!.width
  await drag('preview-width', -80)
  expect((await pane.boundingBox())!.width).toBeGreaterThan(previewBefore + 60)

  // Dragged widths are a preference and survive the reload that Design does not.
  await page.reload()
  await page.getByTestId('gallery-dismiss').click()
  expect(await width('design-navigator')).toBeGreaterThan(layersBefore + 60)
})

test('the problems panel and the settings rail open where they were asked for', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()

  // Design keeps Problems and output in the More menu; the toolbar toggle is Code's.
  await chooseMore(page, 'problems')
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-mode', 'design')
  await expect(page.getByTestId('console')).toBeVisible()
  await expect(page.getByTestId('render-tree')).toBeVisible()
  await expect(page.getByTestId('editor')).toBeHidden()

  const settings = page.getByRole('complementary', { name: 'Settings', exact: true })
  await expect(settings).toBeVisible()
  await page.getByTestId('pane-toggle-preview').click()
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-mode', 'design')
  await expect(settings).toBeHidden()
  await expect(page.getByTestId('render-tree')).toBeVisible()
  await page.getByTestId('pane-toggle-preview').click()
  await expect(settings).toBeVisible()

  await page.getByTestId('pane-toggle-navigator').click()
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-mode', 'design')
  await expect(page.getByTestId('design-navigator')).toBeHidden()
})
