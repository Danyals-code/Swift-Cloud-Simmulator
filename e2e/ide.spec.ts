import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 4 gates - the IDE experience.
 *
 * 1. Create a second file, define a type, use it from the first.
 * 2. Every template renders with zero unsupported placeholders.
 * 3. Clicking a rendered element in the inspector jumps the editor to the right line.
 * 4. Dark mode and Dynamic Type re-render correctly without losing state.
 *
 * Gate 2 is covered exhaustively in `tests/templates.test.ts`, which asserts on the
 * render tree directly for every template; the check here is that the gallery is
 * actually wired to the UI.
 */

async function openStudio(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('editor')).toBeVisible()
  await expect(page.getByTestId('render-tree')).toBeVisible()
}

const preview = (page: Page) => page.getByTestId('render-tree')
const appButton = (page: Page, name: string) => preview(page).getByRole('button', { name })

async function editorText(page: Page): Promise<string> {
  return page.getByTestId('editor').locator('.cm-content').innerText()
}

/**
 * Replaces the document with a single line.
 *
 * CodeMirror auto-closes brackets, so typing a multi-line block leaves the
 * auto-inserted `}` in place as well as the one the test typed - silently producing
 * unbalanced source and a failure that has nothing to do with the product.
 */
async function replaceAll(page: Page, source: string) {
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(source)
}

/** Height of the painted node whose text matches, in device points. */
async function nodeHeight(page: Page, text: string): Promise<number> {
  return page.evaluate((needle) => {
    const tree = document.querySelector('[data-testid="render-tree"]')
    const node = [...(tree?.children ?? [])].find(
      (c) => (c as HTMLElement).innerText.trim() === needle,
    ) as HTMLElement | undefined
    return node ? Math.round(parseFloat(node.style.height)) : -1
  }, text)
}

// ---------------------------------------------------------------- gate 1

test('gate 1 - a second file can define a type the first one uses', async ({ page }) => {
  await openStudio(page)

  await page.getByTestId('new-file').click()
  await page.getByTestId('new-file-input').fill('Badge')
  await page.getByTestId('new-file-input').press('Enter')

  await expect(page.getByTestId('file-rail')).toContainText('Badge.swift')
  await expect(page.getByTestId('tab-bar')).toContainText('Badge.swift')

  // The starter content declares `Badge`, so a new file is immediately valid.
  expect(await editorText(page)).toContain('struct Badge: View')

  await replaceAll(
    page,
    'import SwiftUI; struct Badge: View { var body: some View { Text("from another file") } }',
  )

  await page.getByTestId('file-rail').getByText('CounterApp.swift').click()
  await replaceAll(
    page,
    'import SwiftUI; ' +
      '@main struct CounterApp: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { var body: some View { VStack { Badge() } } }',
  )

  // Cross-file resolution: no diagnostics, and the other file's view renders.
  await expect(preview(page)).toContainText('from another file', { timeout: 5_000 })
  await expect(page.getByTestId('console')).toContainText('No problems.')
})

test('gate 1 - an unresolved cross-file name is reported', async ({ page }) => {
  await openStudio(page)
  await replaceAll(
    page,
    'import SwiftUI; ' +
      '@main struct A: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { var body: some View { VStack { NotDeclared() } } }',
  )

  await expect(page.getByTestId('console')).toContainText("Cannot find 'NotDeclared' in scope", {
    timeout: 5_000,
  })
})

test('files can be switched with Ctrl+P', async ({ page }) => {
  await openStudio(page)

  await page.getByTestId('new-file').click()
  await page.getByTestId('new-file-input').fill('Sidebar')
  await page.getByTestId('new-file-input').press('Enter')
  await expect(page.getByTestId('editor')).toContainText('struct Sidebar')

  await page.keyboard.press('ControlOrMeta+p')
  await expect(page.getByTestId('file-switcher')).toBeVisible()

  // Subsequence matching: `ca` finds CounterApp.swift.
  await page.getByTestId('file-switcher-input').fill('ca')
  await page.getByTestId('file-switcher-input').press('Enter')

  await expect(page.getByTestId('file-switcher')).toHaveCount(0)
  expect(await editorText(page)).toContain('struct ContentView: View')
})

test('a file can be deleted, and the last one cannot', async ({ page }) => {
  await openStudio(page)

  await page.getByTestId('new-file').click()
  await page.getByTestId('new-file-input').fill('Temp')
  await page.getByTestId('new-file-input').press('Enter')
  await expect(page.getByTestId('file-rail')).toContainText('Temp.swift')

  await page.getByRole('button', { name: 'Delete Temp.swift' }).click()
  await expect(page.getByTestId('file-rail')).not.toContainText('Temp.swift')

  // With one file left there is no delete control at all - removing it would leave a
  // project with nothing to show and no way back.
  await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0)
})

// ---------------------------------------------------------------- gate 2

test('gate 2 - a template from the gallery loads and renders cleanly', async ({ page }) => {
  await openStudio(page)

  await page.getByTestId('template-select').selectOption('tasks')

  await expect(preview(page)).toContainText('Tasks', { timeout: 5_000 })
  await expect(preview(page)).toContainText('of 4 complete')
  await expect(preview(page).locator('[data-kind="placeholder"]')).toHaveCount(0)
  await expect(page.getByTestId('console')).toContainText('No problems.')
})

// ---------------------------------------------------------------- gate 3

test('gate 3 - the inspector names a view and reports its computed frame', async ({ page }) => {
  await openStudio(page)
  await expect(preview(page)).toContainText('Hello, World!')

  await page.getByTestId('inspect-toggle').click()
  await expect(page.getByTestId('inspector-readout')).toBeVisible()

  const title = preview(page).locator('[data-kind="text"]', { hasText: 'Hello, World!' }).first()
  await title.hover()

  await expect(page.getByTestId('inspector-readout')).toContainText('Text')
  await expect(page.getByTestId('inspect-highlight')).toBeVisible()
  // `.largeTitle` measures 41pt tall - the number a screenshot cannot tell you.
  await expect(page.getByTestId('inspector-frame')).toContainText('41')
})

test('gate 3 - clicking an inspected view jumps the editor to its source', async ({ page }) => {
  await openStudio(page)
  await expect(preview(page)).toContainText('Hello, World!')

  await page.getByTestId('inspect-toggle').click()
  await preview(page).locator('[data-kind="text"]', { hasText: 'Hello, World!' }).first().click()

  // The editor moves its cursor to the line that produced the view.
  await expect(page.getByTestId('editor').locator('.cm-activeLine').first()).toContainText('Text(')
})

test('gate 3 - leaving inspector mode restores tapping', async ({ page }) => {
  await openStudio(page)

  await page.getByTestId('inspect-toggle').click()
  await expect(page.getByTestId('inspector-readout')).toBeVisible()

  await page.getByTestId('inspect-toggle').click()
  await expect(page.getByTestId('inspector-readout')).toHaveCount(0)

  await appButton(page, 'Plus').click()
  await expect(preview(page)).toContainText('Count: 1')
})

// ---------------------------------------------------------------- gate 4

test('gate 4 - dark mode and Dynamic Type re-render without losing state', async ({ page }) => {
  await openStudio(page)

  await appButton(page, 'Plus').click()
  await appButton(page, 'Plus').click()
  await expect(preview(page)).toContainText('Count: 2')

  expect(await nodeHeight(page, 'Hello, World!')).toBe(41)

  // Dynamic Type is a layout input: text grows, and every frame above it with it.
  await page.getByTestId('type-scale-select').selectOption('1.6')
  await expect.poll(() => nodeHeight(page, 'Hello, World!'), { timeout: 5_000 }).toBeGreaterThan(41)
  await expect(preview(page)).toContainText('Count: 2')

  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(preview(page)).toContainText('Count: 2', { timeout: 5_000 })

  await page.getByTestId('type-scale-select').selectOption('1')
  await expect.poll(() => nodeHeight(page, 'Hello, World!'), { timeout: 5_000 }).toBe(41)
  await expect(preview(page)).toContainText('Count: 2')
})

test('gate 4 - dark mode actually changes the rendered colours', async ({ page }) => {
  await openStudio(page)

  await replaceAll(
    page,
    'import SwiftUI; ' +
      '@main struct A: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { var body: some View { Text("adapts").foregroundStyle(.primary) } }',
  )
  await expect(preview(page)).toContainText('adapts', { timeout: 5_000 })

  const colorOf = () =>
    page.evaluate(() => {
      const tree = document.querySelector('[data-testid="render-tree"]')
      const node = [...(tree?.children ?? [])].find(
        (c) => (c as HTMLElement).innerText.trim() === 'adapts',
      )
      const painted = (node?.querySelector('div') ?? node) as HTMLElement | null
      return painted ? getComputedStyle(painted).color : ''
    })

  const light = await colorOf()
  expect(light).not.toBe('')

  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect.poll(colorOf, { timeout: 5_000 }).not.toBe(light)
})
