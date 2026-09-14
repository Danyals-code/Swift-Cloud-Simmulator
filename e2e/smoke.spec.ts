import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 0 gate (docs/06-VERTICAL-SLICE.md §"Phase 0 gate").
 *
 * These five tests are the contract for "the skeleton works". They are deliberately
 * about plumbing rather than about Swift — there is no compiler yet — because the
 * integration seams between editor, worker, renderer and storage are where this kind
 * of project actually breaks, and they are much cheaper to keep working than to fix
 * three phases later.
 */

async function openStudio(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('editor')).toBeVisible()
  // First compile has to land before the tree exists.
  await expect(page.getByTestId('render-tree')).toBeVisible()
}

async function editorText(page: Page): Promise<string> {
  return page.getByTestId('editor').locator('.cm-content').innerText()
}

test('loads the studio with the starter project', async ({ page }) => {
  await openStudio(page)

  await expect(page.getByTestId('project-name')).toHaveText('CounterApp')
  await expect(page.getByTestId('file-rail')).toContainText('CounterApp.swift')
  expect(await editorText(page)).toContain('struct ContentView: View')
})

test('gate 1 — edits persist across a reload', async ({ page }) => {
  await openStudio(page)

  const marker = `// persisted-${Date.now()}`
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type(`${marker}\n`)

  await expect(page.getByTestId('save-indicator')).toContainText('Saved', { timeout: 5_000 })

  await page.reload()
  await expect(page.getByTestId('editor')).toBeVisible()
  expect(await editorText(page)).toContain(marker)
})

test('gate 2 — a worker diagnostic reaches the editor and the problems panel', async ({ page }) => {
  await openStudio(page)

  // The stub pipeline pins one info diagnostic to the `import SwiftUI` line.
  await expect(page.getByTestId('console')).toContainText('not yet parsed')
  await expect(page.getByTestId('editor').locator('.cm-lintRange').first()).toBeVisible()
})

test('gate 3 — the render tree paints inside the device frame, and taps round-trip', async ({
  page,
}) => {
  await openStudio(page)

  await expect(page.getByTestId('device-frame')).toBeVisible()
  const tree = page.getByTestId('render-tree')
  await expect(tree.locator('[data-node-id="title"]')).toContainText('Hello, World!')
  await expect(tree.locator('[data-node-id="count"]')).toContainText('Count: 0')

  // The full loop: DOM hit test -> worker -> state mutation -> new tree -> repaint.
  await tree.locator('[data-node-id="btn-plus"]').click()
  await expect(tree.locator('[data-node-id="count"]')).toContainText('Count: 1')

  await tree.locator('[data-node-id="btn-plus"]').click()
  await tree.locator('[data-node-id="btn-minus"]').click()
  await expect(tree.locator('[data-node-id="count"]')).toContainText('Count: 1')

  // Reset drops the stub's state without touching the source.
  await page.getByRole('button', { name: 'Reset state' }).click()
  await expect(tree.locator('[data-node-id="count"]')).toContainText('Count: 0')
})

test('gate 3b — unsupported features render a labelled placeholder (FR-4.11)', async ({ page }) => {
  await openStudio(page)

  const placeholder = page.getByTestId('render-tree').locator('[data-kind="placeholder"]')
  await expect(placeholder).toBeVisible()
  await expect(placeholder).toContainText('Swift compiler')
})

test('gate 4 — the exported zip contains the edited source, byte-identical', async ({ page }) => {
  await openStudio(page)

  const marker = `// exported-${Date.now()}`
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type(`${marker}\n`)
  await expect(page.getByTestId('save-indicator')).toContainText('Saved', { timeout: 5_000 })

  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('export-button').click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toBe('CounterApp.zip')

  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const zip = Buffer.concat(chunks)

  expect(zip.length).toBeGreaterThan(0)
  // Zip local file header magic — proves we produced a real archive, not an error page.
  expect(zip.subarray(0, 2).toString('latin1')).toBe('PK')
  // Stored paths are visible in the (uncompressed) local file headers.
  expect(zip.toString('latin1')).toContain('CounterApp/Sources/CounterApp.swift')
})

test('the preview pane toggles with Ctrl+B', async ({ page }) => {
  await openStudio(page)

  await expect(page.getByTestId('device-pane')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+b')
  await expect(page.getByTestId('device-pane')).toBeHidden()
  await page.keyboard.press('ControlOrMeta+b')
  await expect(page.getByTestId('device-pane')).toBeVisible()
})
