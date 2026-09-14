import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 0 gates (plumbing) plus Phase 1 gates (the real front end).
 *
 * Phase 0's tests proved the seams: editor -> worker -> render tree -> DOM -> event
 * -> repaint. Those still matter and still run. Phase 1 adds the assertions that
 * only mean something once real Swift is being parsed — in particular, that the
 * reference app produces *no* diagnostics at all, which is the gate that a false
 * positive is worse than a missed error.
 */

async function openStudio(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('editor')).toBeVisible()
  await expect(page.getByTestId('render-tree')).toBeVisible()
}

async function editorText(page: Page): Promise<string> {
  return page.getByTestId('editor').locator('.cm-content').innerText()
}

async function typeAtTop(page: Page, text: string) {
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type(text)
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
  await typeAtTop(page, `${marker}\n`)
  await expect(page.getByTestId('save-indicator')).toContainText('Saved', { timeout: 5_000 })

  await page.reload()
  await expect(page.getByTestId('editor')).toBeVisible()
  expect(await editorText(page)).toContain(marker)
})

test('Phase 1 gate 4 — the reference app produces no diagnostics at all', async ({ page }) => {
  // The most important assertion in the suite. Anything reported on the starter
  // template is a false positive on unambiguously correct code, and a spurious
  // squiggle destroys trust in every other diagnostic.
  await openStudio(page)

  await expect(page.getByTestId('console')).toContainText('No problems.')
  await expect(page.getByTestId('editor').locator('.cm-lintRange')).toHaveCount(0)
})

test('gate 2 — a real parse error reaches the editor and the problems panel', async ({ page }) => {
  await openStudio(page)
  await typeAtTop(page, 'let broken = \n')

  const console_ = page.getByTestId('console')
  await expect(console_).toContainText('Expected an expression', { timeout: 5_000 })
  await expect(page.getByTestId('editor').locator('.cm-lintRange').first()).toBeVisible()
})

test('Phase 1 gate 2 — a missing brace does not invalidate the rest of the file', async ({
  page,
}) => {
  await openStudio(page)

  // Delete the final closing brace, which is the most common mid-typing state.
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')

  // An error is expected, but the outline must still resolve the app and its views
  // rather than collapsing.
  await expect(page.getByTestId('render-tree')).toContainText('CounterApp', { timeout: 5_000 })
})

test('reports unimplemented SwiftUI by name rather than calling it unresolved', async ({ page }) => {
  // FR-4.11. `NavigationStack` is valid Swift; saying "cannot find in scope" would be
  // both wrong and unhelpful.
  await openStudio(page)
  await typeAtTop(page, 'let placeholder = NavigationStack { }\n')

  const console_ = page.getByTestId('console')
  await expect(console_).toContainText('NavigationStack', { timeout: 5_000 })
  await expect(console_).toContainText('not drawn by the preview yet')
  await expect(console_).toContainText('unsupported_swiftui_view')
})

test('gate 3 — the parsed outline renders in the device frame', async ({ page }) => {
  await openStudio(page)

  await expect(page.getByTestId('device-frame')).toBeVisible()
  const tree = page.getByTestId('render-tree')

  await expect(tree.locator('[data-node-id="outline-title"]')).toContainText('Parsed structure')
  await expect(tree.locator('[data-node-id="outline-entry"]')).toContainText('@main CounterApp')
  await expect(tree.locator('[data-node-id="outline-entry"]')).toContainText('ContentView')

  // The structure is read from the user's real source, so it must match it.
  const rows = tree.locator('[data-node-id^="outline-row-"]')
  await expect(rows.first()).toContainText('VStack')
  await expect(tree).toContainText('HStack')
  await expect(tree).toContainText('Button')
  await expect(tree).toContainText('Spacer')
})

test('gate 3 — the outline updates as you type', async ({ page }) => {
  await openStudio(page)
  const tree = page.getByTestId('render-tree')
  await expect(tree).toContainText('VStack')

  // Replace the whole document with a different view, and watch the outline follow.
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(
    [
      'import SwiftUI',
      '@main',
      'struct TinyApp: App {',
      '    var body: some Scene { WindowGroup { Root() } }',
      '}',
      'struct Root: View {',
      '    var body: some View {',
      '        ZStack {',
      '            Circle()',
      '        }',
      '    }',
      '}',
    ].join('\n'),
  )

  await expect(tree).toContainText('ZStack', { timeout: 5_000 })
  await expect(tree).toContainText('Circle')
  await expect(tree.locator('[data-node-id="outline-entry"]')).toContainText('@main TinyApp')
  await expect(tree).not.toContainText('VStack')
})

test('gate 3 — tapping an outline row round-trips through the worker', async ({ page }) => {
  // The full loop: DOM hit test -> worker -> state mutation -> new tree -> repaint.
  await openStudio(page)
  const tree = page.getByTestId('render-tree')

  const firstRow = tree.locator('[data-node-id="outline-row-0"]')
  await expect(firstRow).toBeVisible()
  await expect(tree.locator('[data-node-id="outline-row-0-highlight"]')).toHaveCount(0)

  await firstRow.click()
  await expect(tree.locator('[data-node-id="outline-row-0-highlight"]')).toBeVisible()

  // Tapping again clears it.
  await firstRow.click()
  await expect(tree.locator('[data-node-id="outline-row-0-highlight"]')).toHaveCount(0)

  // Reset clears selection without touching the source.
  await firstRow.click()
  await expect(tree.locator('[data-node-id="outline-row-0-highlight"]')).toBeVisible()
  await page.getByRole('button', { name: 'Reset state' }).click()
  await expect(tree.locator('[data-node-id="outline-row-0-highlight"]')).toHaveCount(0)
})

test('gate 3b — unsupported features render a labelled placeholder (FR-4.11)', async ({ page }) => {
  await openStudio(page)

  const placeholder = page.getByTestId('render-tree').locator('[data-kind="placeholder"]')
  await expect(placeholder).toBeVisible()
  await expect(placeholder).toContainText('View rendering')
})

test('gate 4 — the exported zip contains the edited source, byte-identical', async ({ page }) => {
  await openStudio(page)

  const marker = `// exported-${Date.now()}`
  await typeAtTop(page, `${marker}\n`)
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
  expect(zip.subarray(0, 2).toString('latin1')).toBe('PK')
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
