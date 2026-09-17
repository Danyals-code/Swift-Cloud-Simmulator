import { expect, test } from '@playwright/test'

test('Agentic Coding is the second source and opens by default on fresh and restored projects', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Swift Web Studio')
  const sources = page.getByRole('navigation', { name: 'Source', exact: true }).getByRole('button')
  await expect(sources.nth(0)).toHaveText('Your projects')
  await expect(sources.nth(1)).toHaveText('Agentic Coding')
  await expect(sources.nth(2)).toContainText('App templates')
  await expect(page.getByTestId('gallery-source-prompt')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('App description', { exact: true })).toBeVisible()
  await page.getByTestId('gallery-source-app').click()
  await expect(page.getByTestId('template-confirm')).toBeVisible()
  await page.getByTestId('gallery-dismiss').click()
  await page.reload()
  await expect(page.getByTestId('gallery-source-prompt')).toHaveAttribute('aria-pressed', 'true')
})

const source = `import SwiftUI
@main struct LayersApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
  @State var count = 0
  var body: some View {
    TabView {
      NavigationStack { VStack(spacing: 20) {
        Text("Count: \\(count)")
        Button("Increase") { count += 1 }
      }.navigationTitle("Overview") }.tabItem { Label("Overview", systemImage: "house") }
      NavigationStack { Form { Section("Account") { Text("Taylor"); Text("Member") } }.navigationTitle("Profile") }.tabItem { Label("Profile", systemImage: "person") }
    }
  }
}`

test('Layers shows nested pages, selects without activating controls, and follows workspace modes', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await expect(page.getByTestId('navigator-tab-layers')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('navigator-tab-project')).toHaveAttribute('aria-pressed', 'true')
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(source)
  const preview = page.getByTestId('render-tree')
  await expect(preview.getByText('Count: 0', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()
  await expect(page.getByTestId('editor')).toBeHidden()
  const layers = page.getByRole('tree', { name: 'App layers' })
  const overview = layers.getByRole('treeitem', { name: 'Overview, Page', exact: true })
  const profile = layers.getByRole('treeitem', { name: 'Profile, Page', exact: true })
  await expect(overview).toBeVisible()
  await expect(profile).toBeVisible()
  const button = layers.getByRole('treeitem', { name: 'Increase, Button', exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-selected', 'true')
  await expect(preview.getByRole('button', { name: 'Increase', exact: true })).toHaveAttribute('data-layer-selected', 'true')
  await expect(preview.getByText('Count: 0', { exact: true })).toBeVisible()
  await preview.getByRole('button', { name: 'Increase', exact: true }).click()
  await expect(layers.getByRole('treeitem', { name: 'Count: 1, Text', exact: true })).toBeVisible()
  await profile.click()
  await expect(preview.getByText('Taylor', { exact: true })).toBeVisible()
  await page.getByLabel('Filter layers').fill('Taylor')
  await expect(layers.getByRole('treeitem', { name: 'Taylor, Text', exact: true })).toBeVisible()
  await expect(overview).toHaveCount(0)
  await page.getByLabel('Filter layers').press('Escape')
  await layers.getByRole('button', { name: 'Collapse Profile', exact: true }).click()
  await expect(layers.getByRole('treeitem', { name: 'Taylor, Text', exact: true })).toHaveCount(0)
  await profile.focus()
  await profile.press('ArrowRight')
  await expect(layers.getByRole('treeitem', { name: 'Taylor, Text', exact: true })).toBeVisible()
  await testInfo.attach('design-layers-light', { body: await page.screenshot(), contentType: 'image/png' })
  await page.getByTestId('workspace-theme').click()
  await testInfo.attach('design-layers-dark', { body: await page.screenshot(), contentType: 'image/png' })
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('navigator-tab-project')).toHaveAttribute('aria-pressed', 'true')
  await expect(editor).toBeVisible()
  await expect(preview.getByText('Taylor', { exact: true })).toBeVisible()
  await page.getByTestId('navigator-tab-issues').click()
  await page.getByTestId('workspace-design').click()
  await expect(page.getByTestId('navigator-tab-layers')).toHaveAttribute('aria-pressed', 'true')
})
