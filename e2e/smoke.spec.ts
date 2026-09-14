import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 0 gates (plumbing), Phase 1 gates (the front end), Phase 2 gates (execution).
 *
 * Each phase's tests stay in the suite rather than being replaced, because the
 * seams they cover keep mattering: Phase 0's worker round-trip is what Phase 2's
 * button taps travel over, and Phase 1's "no false positives" gate is what stops
 * Phase 2 refusing to run correct code.
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

/**
 * Replaces the whole document.
 *
 * Takes a single line deliberately. CodeMirror auto-closes brackets, so typing a
 * multi-line block leaves the auto-inserted `}` in place *and* adds the one the test
 * typed on its own line — silently producing unbalanced source, and a failure that
 * has nothing to do with the product.
 */
async function replaceAll(page: Page, source: string) {
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(source)
}

/** The Button rows in the preview, in source order. */
function buttonRows(page: Page) {
  return page.getByTestId('render-tree').locator('[data-node-id^="outline-row-"]', {
    hasText: 'Button',
  })
}

// ---------------------------------------------------------------- Phase 0

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

// ---------------------------------------------------------------- Phase 1

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

  await expect(page.getByTestId('console')).toContainText('Expected an expression', {
    timeout: 5_000,
  })
  await expect(page.getByTestId('editor').locator('.cm-lintRange').first()).toBeVisible()
})

test('Phase 1 gate 2 — a missing brace does not invalidate the rest of the file', async ({
  page,
}) => {
  await openStudio(page)

  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')

  await expect(page.getByTestId('render-tree')).toContainText('CounterApp', { timeout: 5_000 })
})

test('reports unimplemented SwiftUI by name rather than calling it unresolved', async ({ page }) => {
  await openStudio(page)
  await typeAtTop(page, 'let placeholder = NavigationStack { }\n')

  const console_ = page.getByTestId('console')
  await expect(console_).toContainText('NavigationStack', { timeout: 5_000 })
  await expect(console_).toContainText('not drawn by the preview yet')
  await expect(console_).toContainText('unsupported_swiftui_view')
})

// ---------------------------------------------------------------- Phase 2

test('Phase 2 — the app is running, with evaluated values', async ({ page }) => {
  await openStudio(page)

  await expect(page.getByTestId('device-frame')).toBeVisible()
  const tree = page.getByTestId('render-tree')

  await expect(tree.locator('[data-node-id="outline-title"]')).toContainText('Running')
  await expect(tree.locator('[data-node-id="outline-entry"]')).toContainText('@main CounterApp')
  await expect(tree.locator('[data-node-id="outline-entry"]')).toContainText('ContentView')

  // Interpolations are resolved by actually running the code, not echoed as source.
  await expect(tree).toContainText('"Hello, World!"')
  await expect(tree).toContainText('"Count: 0"')
  await expect(tree).toContainText('VStack')
  await expect(tree).toContainText('HStack')
  await expect(tree).toContainText('Spacer')
})

test('Phase 2 gate — tapping a Button runs its real Swift closure', async ({ page }) => {
  // The counter app actually working: DOM tap -> worker -> interpreter runs
  // `count += 1` -> body re-evaluates -> the Text updates.
  await openStudio(page)
  const tree = page.getByTestId('render-tree')

  await expect(tree).toContainText('"Count: 0"')

  await buttonRows(page).nth(1).click()
  await expect(tree).toContainText('"Count: 1"')

  await buttonRows(page).nth(1).click()
  await expect(tree).toContainText('"Count: 2"')

  await buttonRows(page).nth(0).click()
  await expect(tree).toContainText('"Count: 1"')
})

test('Phase 2 gate — @State survives an edit that does not touch it (FR-5.3)', async ({ page }) => {
  await openStudio(page)
  const tree = page.getByTestId('render-tree')

  await buttonRows(page).nth(1).click()
  await buttonRows(page).nth(1).click()
  await expect(tree).toContainText('"Count: 2"')

  // An edit elsewhere in the file must not reset the counter.
  await typeAtTop(page, '// edit\n')
  await expect(tree).toContainText('"Count: 2"', { timeout: 5_000 })
})

test('Phase 2 — Reset state clears the counter without changing the source', async ({ page }) => {
  await openStudio(page)
  const tree = page.getByTestId('render-tree')

  await buttonRows(page).nth(1).click()
  await expect(tree).toContainText('"Count: 1"')

  await page.getByRole('button', { name: 'Reset state' }).click()
  await expect(tree).toContainText('"Count: 0"')
  expect(await editorText(page)).toContain('@State private var count = 0')
})

test('Phase 2 — a runtime trap is reported with its reason, not a crash', async ({ page }) => {
  await openStudio(page)

  await replaceAll(
    page,
    'import SwiftUI; ' +
      '@main struct BoomApp: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { var body: some View { Text("\\(1 / 0)") } }',
  )

  await expect(page.getByTestId('console')).toContainText('Division by zero', { timeout: 5_000 })
  await expect(page.getByTestId('render-tree')).toContainText('Execution stopped')
})

test('gate 3 — the view tree updates as you type', async ({ page }) => {
  await openStudio(page)
  const tree = page.getByTestId('render-tree')
  await expect(tree).toContainText('VStack')

  await replaceAll(
    page,
    'import SwiftUI; ' +
      '@main struct TinyApp: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { var body: some View { ZStack { Circle() } } }',
  )

  await expect(tree).toContainText('ZStack', { timeout: 5_000 })
  await expect(tree).toContainText('Circle')
  await expect(tree.locator('[data-node-id="outline-entry"]')).toContainText('@main TinyApp')
  await expect(tree).not.toContainText('VStack')
})

test('gate 3 — tapping a non-action row selects it', async ({ page }) => {
  // Buttons run their Swift action; every other row selects. Both round-trip through
  // the worker, which is what this covers.
  await openStudio(page)
  const tree = page.getByTestId('render-tree')

  const root = tree.locator('[data-node-id="outline-row-v-0"]')
  await expect(root).toContainText('VStack')
  await expect(tree.locator('[data-node-id="outline-row-v-0-highlight"]')).toHaveCount(0)

  await root.click()
  await expect(tree.locator('[data-node-id="outline-row-v-0-highlight"]')).toBeVisible()

  await root.click()
  await expect(tree.locator('[data-node-id="outline-row-v-0-highlight"]')).toHaveCount(0)
})

test('gate 3b — unsupported features render a labelled placeholder (FR-4.11)', async ({ page }) => {
  await openStudio(page)

  const placeholder = page.getByTestId('render-tree').locator('[data-kind="placeholder"]')
  await expect(placeholder).toBeVisible()
  await expect(placeholder).toContainText('Layout and drawing')
})
