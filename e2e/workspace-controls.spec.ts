import { expect, test, type Page } from '@playwright/test'

async function open(page: Page) {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await expect(page.getByTestId('render-tree')).toBeVisible()
}

const phones = (page: Page) => page.getByTestId('device-frame').evaluateAll(elements => elements.map(element => {
  const r = element.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}))

function expectFixed(before: Awaited<ReturnType<typeof phones>>, after: Awaited<ReturnType<typeof phones>>) {
  expect(after).toHaveLength(before.length)
  before.forEach((phone, i) => {
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(after[i]![key]).toBeCloseTo(phone[key], 1)
  })
}

test('both panel controls keep the Design phone fixed and remain available when collapsed', async ({ page }) => {
  await open(page)
  const before = await phones(page)
  for (const pane of ['navigator', 'preview']) {
    const toggle = page.getByTestId(`pane-toggle-${pane}`)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expectFixed(before, await phones(page))
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expectFixed(before, await phones(page))
  }
})

test('renames the app, navigator file, and open editor tab', async ({ page }) => {
  await open(page)
  await page.getByTestId('project-name').dblclick()
  await page.getByTestId('project-name-input').fill('My Preview App')
  await page.getByTestId('project-name-input').press('Enter')
  await expect(page.getByTestId('project-name')).toHaveText('My Preview App')
  await page.getByTestId('workspace-develop').click()
  const rail = (await page.getByTestId('file-rail').boundingBox())!
  const addFile = (await page.getByTestId('new-file').boundingBox())!
  expect(addFile.x + addFile.width).toBeLessThanOrEqual(rail.x + rail.width)
  const file = page.getByTestId('file-rail').getByText('ContentView.swift', { exact: true })
  await file.dblclick()
  await page.getByTestId('file-rename-input').fill('Screen.swift')
  await page.getByTestId('file-rename-input').press('Enter')
  await expect(page.getByTestId('tab-bar').getByRole('tab', { name: 'Screen.swift' })).toBeVisible()
  await page.getByTestId('tab-bar').getByRole('tab', { name: 'Screen.swift' }).dblclick()
  await page.getByTestId('tab-rename-input').fill('MainScreen.swift')
  // Clicking outside commits, too.
  await page.getByTestId('project-name').click()
  await expect(page.getByTestId('file-rail').getByText('MainScreen.swift', { exact: true })).toBeVisible()
  await expect(page.getByTestId('save-indicator')).toContainText('Saved locally')
  await page.reload()
  await page.getByTestId('gallery-dismiss').click()
  await expect(page.getByTestId('project-name')).toHaveText('My Preview App')
})

test('searchable shortcuts use an accessible animated dialog', async ({ page }) => {
  await open(page)
  await page.getByTestId('shortcuts-button').click()
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await page.getByLabel('Search shortcuts').fill('rename')
  await expect(dialog).toContainText('Rename file')
  await expect(dialog).not.toContainText('Restart preview')
  await page.getByLabel('Search shortcuts').press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('shortcuts-button')).toBeFocused()
})

test('Add works without a selection and keeps the status label steady', async ({ page }) => {
  await open(page)
  await page.getByTestId('inspect-toggle').click()
  await page.getByTestId('collapse-layers').click()
  await expect(page.getByRole('treeitem', { expanded: true })).toHaveCount(0)
  await page.getByTestId('add-view').click()
  await page.getByTestId('add-view-search').fill('Text')
  await page.getByTestId('add-view-text').click()
  await expect(page.getByTestId('add-view-palette')).toHaveCount(0)
  await expect(page.getByTestId('status-view')).toContainText('Editing')
  await page.getByTestId('live-toggle').click()
  await expect(page.getByTestId('status-view')).toContainText('Live preview')
})
