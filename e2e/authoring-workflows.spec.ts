import { expect, test, type Page } from '@playwright/test'

const SOURCE = `import SwiftUI
struct Item: Identifiable { let id: String; var title: String }
struct Card: View { var title: String = "Card"; var body: some View { Text(title) } }
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    @State private var items: [Item] = [Item(id: "one", title: "First"), Item(id: "two", title: "Second")]
    @State private var loading = false
    @State private var on = false
    var body: some View {
        VStack {
            if loading { Text("Loading") } else {
                List(items) { item in Text(item.title) }
            }
            Card(title: "Primary")
            Card(title: "Secondary")
            Text(on ? "Enabled" : "Disabled")
            Button("Change") { }
        }
    }
}`
async function open(page: Page, source = SOURCE) {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(source)
  await expect(page.getByTestId('render-tree').getByText('First', { exact: true }).first()).toBeVisible()
  await page.getByTestId('workspace-design').click()
  await page.getByTestId('inspect-toggle').click()
  await expect(page.getByTestId('logical-layers')).toBeVisible()
}
const sourceRow = (page: Page, name: string) => page.getByTestId('logical-layers').locator(`[data-source-name="${name}"]`)
const inspector = (page: Page) => page.getByTestId('authoring-inspector')

test('one logical template, explicit keyboard entry, collapse keeps source selection', async ({ page }) => {
  await open(page)
  await expect(sourceRow(page, 'Row template')).toHaveCount(1)
  await sourceRow(page, 'Row template').focus(); await page.keyboard.press('Enter')
  await sourceRow(page, 'Row template').getByRole('button', { name: 'Actions for Row design', exact: true }).press('Enter')
  await expect(page.getByTestId('source-layer-actions-menu')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('logical-layers')).toContainText('Changes affect all rows using this design.')
  await inspector(page).getByRole('button', { name: 'Add element to row template', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('New element', { exact: true })).toHaveCount(2)
  await page.getByTestId('collapse-layers').click()
  await expect(inspector(page)).toBeVisible()
})

test('preview record edits and production edits have separate effects', async ({ page }) => {
  await open(page)
  await sourceRow(page, 'List').click()
  await inspector(page).getByLabel('Record title', { exact: true }).fill('Preview only')
  await inspector(page).getByRole('button', { name: 'Apply preview records', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Preview only', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('editor').locator('.cm-content')).toHaveText(SOURCE, { useInnerText: true })
  await page.getByTestId('workspace-design').click()
  await page.getByTestId('inspector-tab-preview').click()
  await page.getByTestId('preview-scenarios').getByText('Preview scenarios', { exact: true }).click()
  await page.getByLabel('Preview scenario', { exact: true }).selectOption('')
  await expect(page.getByTestId('render-tree').getByText('First', { exact: true }).first()).toBeVisible()
  await page.getByTestId('inspector-tab-settings').click()
  await sourceRow(page, 'List').click()
  await inspector(page).getByLabel('Record edit scope').selectOption('app')
  await inspector(page).getByLabel('Record title', { exact: true }).fill('App data')
  await inspector(page).getByRole('button', { name: 'Apply app initial data', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('App data', { exact: true })).toBeVisible()
})

test('component instance edits stay independent and shared editing names affected sites', async ({ page }) => {
  await open(page)
  await page.getByTestId('logical-layers').locator('[data-source-name="Card"][data-source-kind="component"]').first().click()
  const title = inspector(page).getByRole('textbox', { name: 'title', exact: true })
  await title.fill('Customized'); await title.press('Enter')
  await expect(page.getByTestId('render-tree').getByText('Customized', { exact: true })).toBeVisible()
  await expect(page.getByTestId('render-tree').getByText('Secondary', { exact: true })).toBeVisible()
  await inspector(page).getByRole('button', { name: 'Edit main component…' }).click()
  await expect(inspector(page)).toContainText('2 source call sites')
  await inspector(page).getByRole('button', { name: 'Enter main component' }).click()
  await expect(inspector(page)).toContainText('Shared definition')
})

test('configured actions stay idle in design and execute in live preview', async ({ page }) => {
  await open(page)
  await sourceRow(page, 'Button').click()
  await inspector(page).getByLabel('Action type').selectOption('toggle')
  await inspector(page).getByLabel('Behavior state').first().selectOption('on')
  await inspector(page).getByRole('button', { name: 'Apply action', exact: true }).click()
  await expect(inspector(page)).toContainText('on.toggle()')
  await expect(page.getByTestId('render-tree').getByText('Disabled', { exact: true })).toBeVisible()
  await page.getByTestId('render-tree').getByRole('button', { name: 'Change', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Disabled', { exact: true })).toBeVisible()
  await page.getByTestId('live-toggle').click()
  await page.getByTestId('render-tree').getByRole('button', { name: 'Change', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Enabled', { exact: true })).toBeVisible()
})

test('scenarios survive reload and source stays unchanged', async ({ page }) => {
  await open(page)
  await page.getByTestId('inspector-tab-preview').click()
  const scenarios = page.getByTestId('preview-scenarios')
  await scenarios.getByText('Preview scenarios', { exact: true }).click()
  await scenarios.getByLabel('Scenario name', { exact: true }).fill('Loading')
  await scenarios.getByLabel('Scenario input', { exact: true }).selectOption('ContentView.loading')
  await scenarios.getByLabel('Scenario value', { exact: true }).selectOption('true')
  await scenarios.getByRole('button', { name: 'Save and preview scenario' }).click()
  await expect(page.getByTestId('render-tree').getByText('Loading', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('editor').locator('.cm-content')).toHaveText(SOURCE, { useInnerText: true })
  await expect(page.getByTestId('save-indicator')).toContainText('Saved locally')
  await page.reload()
  // Reload starts from app defaults; the saved scenario remains explicitly selectable.
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-design').click()
  await page.getByTestId('inspector-tab-preview').click()
  await page.getByTestId('preview-scenarios').getByText('Preview scenarios', { exact: true }).click()
  await page.getByLabel('Preview scenario', { exact: true }).selectOption('Loading')
  await expect(page.getByTestId('render-tree').getByText('Loading', { exact: true })).toBeVisible()
})

test('reduced motion disables preview transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  await sourceRow(page, 'Button').click()
  await inspector(page).getByText('Transition', { exact: true }).click()
  await inspector(page).getByLabel('Behavior state').last().selectOption('on')
  await inspector(page).getByRole('button', { name: 'Add transition', exact: true }).click()
  await expect(inspector(page).locator('[data-modifier-name="transition"]')).toHaveCount(1)
  const nodes = page.getByTestId('render-tree').locator('[data-node-id]')
  expect(await nodes.evaluateAll(elements => elements.every(e => getComputedStyle(e).animationName === 'none' && getComputedStyle(e).transitionDuration === '0s'))).toBe(true)
})

test('row field binding writes real Swift storage and toggles only the selected record', async ({ page }) => {
  const source = SOURCE.replace('var title: String }', 'var title: String; var featured: Bool = false }').replace('List(items) { item in Text(item.title) }', 'List(items) { item in VStack { Text(item.title); Toggle(item.title, isOn: .constant(false)) } }')
  await open(page, source)
  await sourceRow(page, 'Row template').dblclick()
  await sourceRow(page, 'Toggle').click()
  await inspector(page).getByLabel('Row field', { exact: true }).selectOption('featured')
  await inspector(page).getByRole('button', { name: 'Bind to field · all rows', exact: true }).click()
  await expect(inspector(page)).toContainText('$item.featured')
  await page.getByTestId('live-toggle').click()
  const first = page.getByTestId('render-tree').getByRole('switch', { name: 'First', exact: true })
  await first.click()
  await expect(first).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('render-tree').getByRole('switch', { name: 'Second', exact: true })).toHaveAttribute('aria-checked', 'false')
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await expect(editor).toContainText('List($items) { $item in')
  await expect(editor).toContainText('isOn: $item.featured')
})

test('conditional transitions retain exits, cancel on reentry and finish without active stale controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await open(page, SOURCE.replace('Card(title: "Primary")', 'if !on { Text("Animated") }; Card(title: "Primary")'))
  await sourceRow(page, 'Text').filter({ hasText: 'Animated' }).click()
  await inspector(page).getByText('Transition', { exact: true }).click()
  await inspector(page).getByLabel('Behavior state').selectOption('on')
  await inspector(page).getByLabel('Duration in seconds').fill('1')
  await inspector(page).getByRole('button', { name: 'Add transition', exact: true }).click()
  await expect(inspector(page).locator('[data-modifier-name="transition"]')).toHaveCount(1)
  await sourceRow(page, 'Button').click()
  await inspector(page).getByLabel('Action type').selectOption('toggle')
  await inspector(page).getByLabel('Behavior state').first().selectOption('on')
  await inspector(page).getByRole('button', { name: 'Apply action', exact: true }).click()
  await expect(inspector(page)).toContainText('on.toggle()')
  await page.getByTestId('live-toggle').click()
  const preview = page.getByTestId('render-tree'), change = preview.getByRole('button', { name: 'Change', exact: true })
  await change.click()
  const exiting = preview.locator('[data-transition-exit="true"]').filter({ hasText: 'Animated' })
  await expect(exiting).toHaveCount(1)
  await expect(exiting).toHaveAttribute('inert', '')
  await expect(exiting).toHaveCSS('animation-name', 'studio-opacity-exit')
  await change.click()
  await expect(exiting).toHaveCount(0)
  await expect(preview.getByText('Animated', { exact: true })).toHaveCount(1)
  await change.click()
  await expect(exiting).toHaveCount(1)
  await expect(exiting).toHaveCount(0, { timeout: 2500 })
  await expect(preview.getByText('Animated', { exact: true })).toHaveCount(0)
})
