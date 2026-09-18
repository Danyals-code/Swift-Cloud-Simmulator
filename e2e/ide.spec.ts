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

/**
 * Opens the studio and dismisses the welcome sheet.
 *
 * The studio opens with it: the first question is where the project comes from, and
 * a tool that answers that question for you is a tool that has picked for you. Every
 * test below is about what happens *after* that choice, so they all start by keeping
 * what is already open.
 */
async function openStudio(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('template-gallery')).toBeVisible()
  await page.getByTestId('gallery-dismiss').click()
  await expect(page.getByTestId('template-gallery')).toHaveCount(0)
  await page.getByTestId('workspace-develop').click()
  if (await page.getByTestId('pane-toggle-debug').getAttribute('aria-pressed') === 'false') await page.getByTestId('pane-toggle-debug').click()

  await expect(page.getByTestId('editor')).toBeVisible()
  await expect(page.getByTestId('render-tree')).toBeVisible()
}

const preview = (page: Page) => page.getByTestId('render-tree')

test('Fit shows the entire phone and manual zoom keeps its top reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await openStudio(page)
  const bounds = () => page.evaluate(() => {
    const pane = document.querySelector('[data-testid="device-pane"]')!.getBoundingClientRect()
    const frame = document.querySelector('[data-testid="device-frame"]')!.getBoundingClientRect()
    return { top: frame.top - pane.top, left: frame.left - pane.left, bottom: pane.bottom - frame.bottom, right: pane.right - frame.right }
  })
  await expect.poll(async () => { return Math.min(...Object.values(await bounds())) }).toBeGreaterThanOrEqual(27)

  // At 100% a phone is taller than the canvas, so it is centred and hangs over both
  // edges evenly - and its top is one drag away. The canvas has no scrollable extent
  // to run out of any more, so "reachable" is a pan rather than a scroll.
  await page.getByTestId('zoom-select').click()
  await page.getByTestId('zoom-select-menu-1').click()
  await expect.poll(async () => Math.abs((await bounds()).top - (await bounds()).bottom)).toBeLessThan(4)

  // A phone this size leaves no background to grab, so the canvas is dragged the
  // other way it can be: the middle button, which works over the phone as well.
  const pane = (await page.getByTestId('device-pane').boundingBox())!
  await page.mouse.move(pane.x + pane.width / 2, pane.y + 40)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(pane.x + pane.width / 2, pane.y + 240)
  await page.mouse.move(pane.x + pane.width / 2, pane.y + 400)
  await page.mouse.up({ button: 'middle' })
  expect((await bounds()).top).toBeGreaterThanOrEqual(27)

  await page.getByTestId('zoom-select').click()
  await page.getByTestId('zoom-select-menu-fit').click()
  await expect.poll(async () => { return Math.min(...Object.values(await bounds())) }).toBeGreaterThanOrEqual(27)
})

/**
 * Creates a source file through the navigator's New menu.
 *
 * The `+` used to be a button that opened an input directly. It is a menu now,
 * because there is more than one thing to create - a file, a group, or a whole
 * project from a template.
 */
async function newFile(page: Page, name: string) {
  await page.getByTestId('new-file').click()
  await page.getByTestId('new-file-menu-file').click()
  await page.getByTestId('new-file-input').fill(name)
  await page.getByTestId('new-file-input').press('Enter')
}

/** Creates a group through the same menu. */
async function newGroup(page: Page, name: string) {
  await page.getByTestId('new-file').click()
  await page.getByTestId('new-file-menu-folder').click()
  await page.getByTestId('new-file-input').fill(name)
  await page.getByTestId('new-file-input').press('Enter')
}

/** Picks a Dynamic Type step from the preview bar's popup. */
async function setTypeScale(page: Page, value: string) {
  await page.getByTestId('type-scale-select').click()
  await page.getByTestId(`type-scale-select-menu-${value}`).click()
}

/** Opens the navigator's context menu on a row. */
async function contextMenuOn(page: Page, label: string) {
  await page.getByTestId('file-rail').getByText(label, { exact: true }).click({ button: 'right' })
}
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

  await newFile(page, 'Badge')

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

  await newFile(page, 'Sidebar')
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

  await newFile(page, 'Temp')
  await expect(page.getByTestId('file-rail')).toContainText('Temp.swift')

  await contextMenuOn(page, 'Temp.swift')
  await page.getByTestId('navigator-menu-delete').click()
  await expect(page.getByTestId('file-rail')).not.toContainText('Temp.swift')

  // With one file left the delete item is disabled - removing it would leave a
  // project with nothing to show and no way back.
  await contextMenuOn(page, 'CounterApp.swift')
  await expect(page.getByTestId('navigator-menu-delete')).toBeDisabled()
  await page.keyboard.press('Escape')
})

test('a group can be created and a file moved into it', async ({ page }) => {
  await openStudio(page)

  await newGroup(page, 'Models')
  await expect(page.getByTestId('group-Sources/Models')).toBeVisible()

  // A file created while a group is selected lands inside it, which is the rule
  // Xcode uses and the only one that is never surprising.
  await page.getByTestId('group-Sources/Models').click()
  await newFile(page, 'Trail')

  await expect(page.getByTestId('file-rail')).toContainText('Trail.swift')
  await expect(page.getByTestId('jump-bar')).toContainText('Models')
})

// ---------------------------------------------------------------- gate 2

test('gate 2 - a template from the gallery loads and renders cleanly', async ({ page }) => {
  await openStudio(page)

  await page.getByTestId('new-file').click()
  await page.getByTestId('new-file-menu-template').click()
  await page.getByTestId('gallery-source-feature').click()
  await page.getByTestId('template-tasks').click()
  await page.getByTestId('template-confirm').click()

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

  // Edit and Live Preview are a switch, so leaving Edit means choosing the other.
  await page.getByTestId('live-toggle').click()
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
  await setTypeScale(page, 'xxxLarge')
  await expect.poll(() => nodeHeight(page, 'Hello, World!'), { timeout: 5_000 }).toBeGreaterThan(41)
  await expect(preview(page)).toContainText('Count: 2')

  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(preview(page)).toContainText('Count: 2', { timeout: 5_000 })

  await setTypeScale(page, 'large')
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
