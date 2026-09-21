import { expect, test, type Locator, type Page } from '@playwright/test'

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
  await expect(page.getByTestId('logical-layers')).toBeVisible()
}
const sourceRow = (page: Page, name: string) => page.getByTestId('logical-layers').locator(`[data-source-name="${name}"]`)
const inspector = (page: Page) => page.getByTestId('authoring-inspector')
/** Opens a collapsed <details> section by its summary text, leaving an open one open. */
async function openSection(scope: Locator, summary: string) {
  const toggle = scope.locator('summary').filter({ hasText: new RegExp(`^${summary}$`) })
  const details = toggle.locator('xpath=..')
  if (await details.getAttribute('open') === null) await toggle.click()
  await expect(details).toHaveAttribute('open', '')
}
/** Scripted actions and appear animations sit in the view's collapsed Advanced section. */
async function advanced(page: Page, part: 'Other actions' | 'Appear animation') {
  const section = page.getByTestId('settings-advanced')
  await openSection(section, 'Advanced')
  await openSection(section, part)
  return section
}
/** Preview scenarios are the screen's States, in Screen settings (nothing selected). */
async function screenStates(page: Page) {
  await page.getByTestId('level-screen').click()
  const states = page.getByTestId('screen-states')
  await expect(states).toBeVisible()
  return states
}

test('row design opens from List settings, supports keyboard entry and keeps source selection', async ({ page }) => {
  await open(page)
  await expect(sourceRow(page, 'Row template')).toHaveCount(0)
  await sourceRow(page, 'List').focus(); await page.keyboard.press('Enter')
  const enter = page.getByTestId('settings-data').getByRole('button', { name: 'Edit row design', exact: true })
  await enter.focus(); await enter.press('Enter')
  await expect(page.getByTestId('logical-layers')).toContainText('Changes affect all rows using this design.')
  await inspector(page).getByRole('button', { name: 'Add element to row template', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('New element', { exact: true })).toHaveCount(2)
  // Collapse all is on the Layers panel of the three-panel navigator layout.
  await page.getByTestId('navigator-layout-split').click()
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
  // Back to the app's own data: the "Default" state of the screen.
  const states = await screenStates(page)
  await states.getByRole('button', { name: /^Default/ }).click()
  await expect(states.getByRole('button', { name: /^Default/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('render-tree').getByText('First', { exact: true }).first()).toBeVisible()
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
  // A component's shared definition is now called its Main.
  await inspector(page).getByRole('button', { name: 'Edit the Main…', exact: true }).click()
  await expect(inspector(page)).toContainText('Editing the Main changes all 2 copies')
  await expect(inspector(page).getByRole('button', { name: /^ContentView · copy \d$/ })).toHaveCount(2)
  await inspector(page).getByRole('button', { name: 'Open the Main', exact: true }).click()
  await expect(inspector(page).getByRole('heading', { name: 'The Main', exact: true })).toBeVisible()
  await expect(inspector(page)).toContainText('Changes here reach all 2 copies of Card.')
})

test('configured actions stay idle in design and execute in live preview', async ({ page }) => {
  await open(page)
  await sourceRow(page, 'Button').click()
  const actions = await advanced(page, 'Other actions')
  await actions.getByLabel('Action type').selectOption('toggle')
  await actions.getByLabel('Behavior state').first().selectOption('on')
  await actions.getByRole('button', { name: 'Apply action', exact: true }).click()
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
  const states = await screenStates(page)
  await states.getByRole('button', { name: 'Add state', exact: true }).click()
  await states.getByLabel('State name', { exact: true }).fill('Loading')
  await states.getByLabel('State input', { exact: true }).selectOption('ContentView.loading')
  await states.getByLabel('State value', { exact: true }).selectOption('true')
  await states.getByRole('button', { name: 'Save state', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Loading', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('editor').locator('.cm-content')).toHaveText(SOURCE, { useInnerText: true })
  await expect(page.getByTestId('save-indicator')).toContainText('Saved locally')
  await page.reload()
  // Reload starts from app defaults; the saved scenario remains explicitly selectable.
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-design').click()
  await (await screenStates(page)).getByRole('button', { name: /^Loading/ }).click()
  await expect(page.getByTestId('render-tree').getByText('Loading', { exact: true })).toBeVisible()
})

test('reduced motion disables preview transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  await sourceRow(page, 'Button').click()
  const animation = await advanced(page, 'Appear animation')
  await animation.getByLabel('Behavior state').last().selectOption('on')
  await animation.getByRole('button', { name: 'Add transition', exact: true }).click()
  await expect(inspector(page).locator('[data-modifier-name="transition"]')).toHaveCount(1)
  const nodes = page.getByTestId('render-tree').locator('[data-node-id]')
  expect(await nodes.evaluateAll(elements => elements.every(e => getComputedStyle(e).animationName === 'none' && getComputedStyle(e).transitionDuration === '0s'))).toBe(true)
})

test('row field binding writes real Swift storage and toggles only the selected record', async ({ page }) => {
  const source = SOURCE.replace('var title: String }', 'var title: String; var featured: Bool = false }').replace('List(items) { item in Text(item.title) }', 'List(items) { item in VStack { Text(item.title); Toggle(item.title, isOn: .constant(false)) } }')
  await open(page, source)
  // Only top-level layers start expanded; the Toggle is inside the List's row design.
  const layers = page.getByTestId('logical-layers')
  await layers.getByRole('button', { name: 'Expand List', exact: true }).click()
  await layers.getByRole('button', { name: 'Expand Vertical Stack', exact: true }).click()
  await sourceRow(page, 'Toggle').click()
  await inspector(page).getByLabel('Row field', { exact: true }).selectOption('featured')
  await inspector(page).getByRole('button', { name: 'Use this field in every row', exact: true }).click()
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
  const animation = await advanced(page, 'Appear animation')
  await animation.getByLabel('Behavior state').selectOption('on')
  await animation.getByLabel('Duration in seconds').fill('1')
  await animation.getByRole('button', { name: 'Add transition', exact: true }).click()
  await expect(inspector(page).locator('[data-modifier-name="transition"]')).toHaveCount(1)
  await sourceRow(page, 'Button').click()
  const actions = await advanced(page, 'Other actions')
  await actions.getByLabel('Action type').selectOption('toggle')
  await actions.getByLabel('Behavior state').first().selectOption('on')
  await actions.getByRole('button', { name: 'Apply action', exact: true }).click()
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
