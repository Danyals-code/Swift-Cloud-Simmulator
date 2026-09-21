import { expect, test, type Locator, type Page } from '@playwright/test'
import { addModifier, assertSource, cardAction, cards, expandCard } from './designer-helpers'

const SOURCE = `import SwiftUI
@main struct DesignerApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Card").padding(8).background(Color.blue).padding(8)
            Text("Unchanged")
        }
    }
}`
const DATA_SOURCE = `import SwiftUI
struct Item: Identifiable { let id: String; var title: String }
@main struct DesignerApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    @State private var items: [Item] = [Item(id: "one", title: "First"), Item(id: "two", title: "Second")]
    @State private var done = false
    var body: some View {
        VStack {
            List(items) { item in Text(item.title).padding(8) }
            Text(done ? "Done" : "Waiting")
            Button("Complete") { }
        }
    }
}`
async function open(page: Page, source = SOURCE, visible = 'Card') {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(source)
  await expect(page.getByTestId('render-tree').getByText(visible, { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()
  await expect(page.getByTestId('logical-layers')).toBeVisible()
}
async function selectText(page: Page, label: string) {
  await page.getByTestId('logical-layers').locator('[data-source-name="Text"]').filter({ hasText: label }).click()
  await expect(page.getByTestId('settings-basics').getByRole('textbox', { name: 'Text', exact: true })).toHaveValue(label)
}
const order = (page: Page) => page.getByTestId('modifier-stack').getByTestId('modifier-card').evaluateAll(elements => elements.map(element => element.getAttribute('data-modifier-name')))
/** Opens a collapsed <details> section by its summary text, leaving an open one open. */
async function openSection(scope: Locator, summary: string) {
  const toggle = scope.locator('summary').filter({ hasText: new RegExp(`^${summary}$`) })
  const details = toggle.locator('xpath=..')
  if (await details.getAttribute('open') === null) await toggle.click()
  await expect(details).toHaveAttribute('open', '')
}

test('Basics edits preview, layer label and Swift while preserving the ordered stack', async ({ page }) => {
  await open(page)
  await selectText(page, 'Card')
  const content = page.getByTestId('settings-basics').getByRole('textbox', { name: 'Text', exact: true })
  await content.fill('Cancelled')
  await content.press('Escape')
  await expect(content).toHaveValue('Card')
  await content.fill('Weekend plans')
  for (let i = 0; i < 5; i++) await content.press('ArrowLeft')
  await page.keyboard.insertText('great ')
  await content.press('Enter')
  await expect(page.getByTestId('render-tree').getByText('Weekend great plans', { exact: true })).toBeVisible()
  await expect(content).toBeFocused()
  expect(await content.evaluate(element => (element as HTMLInputElement).selectionStart)).toBe(14)
  await expect(page.getByTestId('logical-layers').locator('[aria-selected="true"]')).toContainText('Weekend great plans')
  await expect.poll(() => order(page)).toEqual(['padding', 'background', 'padding'])
  await expect(page.getByTestId('settings-basics')).not.toContainText('Padding')
  await assertSource(page, SOURCE.replace('Text("Card")', 'Text("Weekend great plans")'))
})

test('repeated modifier occurrences edit independently, reorder, duplicate, remove and replay exactly', async ({ page }) => {
  test.setTimeout(60_000)
  await open(page)
  await selectText(page, 'Card')
  await expandCard(cards(page, 'padding').nth(1))
  const value = cards(page, 'padding').nth(1).getByRole('textbox', { name: 'Padding value', exact: true })
  await value.fill('24')
  await value.press('Enter')
  let expected = SOURCE.replace('.background(Color.blue).padding(8)', '.background(Color.blue).padding(24)')
  await assertSource(page, expected)
  await cardAction(cards(page, 'padding').nth(1), 'Padding', 'Move up')
  expected = expected.replace('.padding(8).background(Color.blue).padding(24)', '.padding(8).padding(24).background(Color.blue)')
  await assertSource(page, expected)
  await expect.poll(() => order(page)).toEqual(['padding', 'padding', 'background'])
  await cardAction(cards(page, 'padding').nth(1), 'Padding', 'Duplicate')
  expected = expected.replace('.padding(24).background', '.padding(24).padding(24).background')
  await assertSource(page, expected)
  await expect(cards(page, 'padding')).toHaveCount(3)
  const beforeRemove = expected
  await cardAction(cards(page, 'padding').nth(0), 'Padding', 'Remove')
  expected = expected.replace('.padding(8)', '')
  await assertSource(page, expected, false)
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editor).toHaveText(beforeRemove, { useInnerText: true })
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(editor).toHaveText(expected, { useInnerText: true })
  await expect(page.getByTestId('render-tree').getByText('Unchanged', { exact: true })).toBeVisible()
})

test('dragging a modifier changes Swift order without losing repeated cards', async ({ page }) => {
  await open(page)
  await selectText(page, 'Card')
  const backgroundWidth = () => page.getByTestId('render-tree').locator('[data-node-id]').evaluateAll(elements => {
    const background = elements.find(element => element.getAttribute('data-kind') === 'layer' && element.getAttribute('data-node-id') !== 'screen' && getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)') as HTMLElement | undefined
    return background ? parseFloat(background.style.width) : null
  })
  const before = await backgroundWidth()
  expect(before).not.toBeNull()
  // A drop lands before a card when the pointer is over its upper half, after it
  // otherwise, so aim at the top edge of the first Padding card.
  await cards(page, 'background').locator('[title="Drag to reorder"]').dragTo(cards(page, 'padding').first(), { targetPosition: { x: 24, y: 4 } })
  await expect.poll(() => order(page)).toEqual(['background', 'padding', 'padding'])
  await expect.poll(backgroundWidth).toBeCloseTo(before! - 16, 3)
  await assertSource(page, SOURCE.replace('.padding(8).background(Color.blue).padding(8)', '.background(Color.blue).padding(8).padding(8)'))
})

test('the searchable catalog appends a visible modifier and numeric validation preserves Swift', async ({ page }) => {
  await open(page)
  await selectText(page, 'Unchanged')
  await addModifier(page, 'Opacity', 'opacity')
  const opacity = cards(page, 'opacity').getByRole('textbox', { name: 'Opacity', exact: true })
  const added = SOURCE.replace('Text("Unchanged")', 'Text("Unchanged").opacity(1)')
  await assertSource(page, added)
  await opacity.fill('-')
  await opacity.press('Enter')
  await expect(cards(page, 'opacity').getByRole('alert')).toContainText('finite number')
  await expect(opacity).toBeFocused()
  await opacity.press('Escape')
  await expect(opacity).toHaveValue('1')
  await expect(opacity).toBeFocused()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText('0.4')
  await opacity.press('Enter')
  await expect(opacity).toHaveValue('0.4')
  await assertSource(page, added.replace('.opacity(1)', '.opacity(0.4)'))
  await cardAction(cards(page, 'opacity'), 'Opacity', 'Remove')
  await assertSource(page, SOURCE)
})

test('a custom modifier remains visible and byte-preserved during nearby supported edits', async ({ page }) => {
  const source = SOURCE.replace('Text("Card").padding(8).background(Color.blue).padding(8)', 'Text("Card").reviewStyle().padding(8)') + '\nextension View { func reviewStyle() -> some View { padding(3) } }\n// Keep this developer comment exactly.\n'
  await open(page, source)
  await selectText(page, 'Card')
  await expect(cards(page, 'reviewStyle')).toHaveCount(1)
  await expandCard(cards(page, 'reviewStyle'))
  await expect(cards(page, 'reviewStyle')).toContainText('A custom modifier from your code.')
  await expandCard(cards(page, 'padding'))
  const padding = cards(page, 'padding').getByRole('textbox', { name: 'Padding value', exact: true })
  await padding.fill('16')
  await padding.press('Enter')
  await assertSource(page, source.replace('.reviewStyle().padding(8)', '.reviewStyle().padding(16)'))
  await expect(cards(page, 'reviewStyle')).toHaveCount(1)
})

test('List records and button actions live below Modifiers and update actual data and behavior', async ({ page }) => {
  test.setTimeout(60_000)
  await open(page, DATA_SOURCE, 'First')
  const layers = page.getByTestId('logical-layers')
  await layers.locator('[data-source-name="List"]').click()
  const data = page.getByTestId('settings-data')
  await expect(data).toBeVisible()
  await expect(layers).not.toContainText('First')
  await expect(layers).not.toContainText('Second')
  expect(await page.getByTestId('authoring-inspector').evaluate(element => {
    const stack = element.querySelector('[data-testid="modifier-stack"]')!
    const data = element.querySelector('[data-testid="settings-data"]')!
    return !!(stack.compareDocumentPosition(data) & Node.DOCUMENT_POSITION_FOLLOWING)
  })).toBe(true)
  await data.getByLabel('Record edit scope').selectOption('app')
  await data.getByLabel('Record title', { exact: true }).fill('Edited record')
  await data.getByRole('button', { name: 'Apply app initial data', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Edited record', { exact: true })).toBeVisible()
  await expect(page.getByTestId('render-tree').getByText('Second', { exact: true })).toBeVisible()
  await layers.locator('[data-source-name="Button"]').click()
  // The Behavior section was removed: scripted button actions are in the
  // Advanced section (under "Other actions"), which also sits below Modifiers.
  const behavior = page.getByTestId('settings-advanced')
  await expect(behavior).toBeVisible()
  expect(await page.getByTestId('authoring-inspector').evaluate(element => {
    const stack = element.querySelector('[data-testid="modifier-stack"]')!
    const behavior = element.querySelector('[data-testid="settings-advanced"]')!
    return !!(stack.compareDocumentPosition(behavior) & Node.DOCUMENT_POSITION_FOLLOWING)
  })).toBe(true)
  await openSection(behavior, 'Advanced')
  await openSection(behavior, 'Other actions')
  await behavior.getByLabel('Action type').selectOption('toggle')
  await behavior.getByLabel('Behavior state').first().selectOption('done')
  await behavior.getByRole('button', { name: 'Apply action', exact: true }).click()
  await expect(behavior).toContainText('done.toggle()')
  await expect(page.getByTestId('render-tree').getByText('Waiting', { exact: true })).toBeVisible()
  await page.getByTestId('render-tree').getByRole('button', { name: 'Complete', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Waiting', { exact: true })).toBeVisible()
  await page.getByTestId('live-toggle').click()
  await page.getByTestId('render-tree').getByRole('button', { name: 'Complete', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Done', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('title: "Edited record"')
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('done.toggle()')
})

test('one row design edits every rendered row without replacing their data bindings', async ({ page }) => {
  await open(page, DATA_SOURCE, 'First')
  const layers = page.getByTestId('logical-layers')
  await expect(layers.locator('[data-source-kind="template"]')).toHaveCount(0)
  await layers.locator('[data-source-name="List"]').click()
  await page.getByTestId('settings-data').getByRole('button', { name: 'Edit row design', exact: true }).click()
  await layers.locator('[data-source-name="Text"]').click()
  await expect(page.getByTestId('authoring-inspector')).toContainText('Row design · changes apply to every row')
  await expandCard(cards(page, 'padding'))
  const padding = cards(page, 'padding').getByRole('textbox', { name: 'Padding value', exact: true })
  await padding.fill('20')
  await padding.press('Enter')
  await expect(page.getByTestId('render-tree').getByText('First', { exact: true })).toBeVisible()
  await expect(page.getByTestId('render-tree').getByText('Second', { exact: true })).toBeVisible()
  await expect(layers.getByRole('button', { name: 'Main page', exact: true })).toBeVisible()
  await assertSource(page, DATA_SOURCE.replace('Text(item.title).padding(8)', 'Text(item.title).padding(20)'))
})


test('the primary Layers tree reorders views and restores a hidden view without source loss', async ({ page }) => {
  test.setTimeout(60_000)
  await open(page)
  const layers = page.getByTestId('logical-layers')
  const card = layers.locator('[data-source-name="Text"]').filter({ hasText: 'Card' })
  await card.click()
  await card.getByRole('button', { name: 'Actions for Card', exact: true }).click()
  await page.getByTestId('source-layer-actions-menu-hide').click()
  await expect(page.getByTestId('render-tree').getByText('Card', { exact: true })).toHaveCount(0)
  await expect(layers.getByTestId('hidden-layer')).toHaveCount(1)
  await layers.getByTestId('hidden-layer').getByTestId('layer-show').click()
  await expect(page.getByTestId('render-tree').getByText('Card', { exact: true })).toBeVisible()
  await expect(layers.getByTestId('hidden-layer')).toHaveCount(0)
  await assertSource(page, SOURCE)
  const other = layers.locator('[data-source-name="Text"]').filter({ hasText: 'Unchanged' })
  await other.click()
  await other.getByRole('button', { name: 'Actions for Unchanged', exact: true }).click()
  await page.getByTestId('source-layer-actions-menu-up').click()
  await expect(layers.locator('[data-source-name="Text"]').first()).toContainText('Unchanged')
  await assertSource(page, SOURCE.replace('            Text("Card").padding(8).background(Color.blue).padding(8)\n            Text("Unchanged")', '            Text("Unchanged")\n            Text("Card").padding(8).background(Color.blue).padding(8)'))
})

test('a task modifier appears in Behavior and keeps its source position during appearance edits', async ({ page }) => {
  const source = SOURCE.replace('.padding(8).background(Color.blue).padding(8)', '.padding(8).task { }.opacity(0.7)')
  await open(page, source)
  await selectText(page, 'Card')
  await expect(page.getByTestId('logical-layers').locator('[data-source-name="task"]')).toHaveCount(0)
  // There is no separate Behavior section any more: behavior modifiers are cards in
  // the one modifier stack, at their real source position.
  await expect.poll(() => order(page)).toEqual(['padding', 'task', 'opacity'])
  await expect(page.getByTestId('modifier-stack').locator('[data-modifier-name="task"]')).toHaveCount(1)
  await expandCard(cards(page, 'padding'))
  const padding = cards(page, 'padding').getByRole('textbox', { name: 'Padding value', exact: true })
  await padding.fill('12')
  await padding.press('Enter')
  await assertSource(page, source.replace('.padding(8).task', '.padding(12).task'))
})

test('multiline Basics content round-trips quotes, newlines and backslashes through Swift', async ({ page }) => {
  await open(page)
  await selectText(page, 'Card')
  const content = page.getByTestId('settings-basics').getByRole('textbox', { name: 'Text', exact: true })
  await content.fill('First line')
  await content.press('Shift+Enter')
  await page.keyboard.insertText('"Quoted" \\ path')
  await expect(content).toHaveValue('First line\n"Quoted" \\ path')
  await content.press('Enter')
  await assertSource(page, SOURCE.replace('Text("Card")', 'Text("First line\\n\\"Quoted\\" \\\\ path")'))
  await expect(content).toHaveValue('First line\n"Quoted" \\ path')
  await expect(page.getByTestId('render-tree').getByText('"Quoted" \\ path', { exact: false })).toBeVisible()
})
