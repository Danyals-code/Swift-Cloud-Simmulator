import { expect, test, type Page } from '@playwright/test'
import { openCounter, replaceSource } from './designer-helpers'

test('Start designing is the first source, and where a browser with no work yet opens (B6)', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Swift Web Studio')
  const sources = page.getByRole('navigation', { name: 'Source', exact: true }).getByRole('button')
  await expect(sources.nth(0)).toHaveText('Start designing')
  await expect(sources.nth(1)).toHaveText('Your projects')
  await expect(sources.nth(2)).toHaveText('Agentic Coding')
  await expect(sources.nth(3)).toContainText('App templates')
  await expect(page.getByTestId('gallery-source-design')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('template-blank')).toBeVisible()
  await page.getByTestId('gallery-source-app').click()
  await expect(page.getByTestId('template-confirm')).toBeVisible()
  await page.getByTestId('gallery-dismiss').click()
  // The untouched starter is not work yet, so a reload still offers to start designing.
  // With work saved it opens on Your projects (data-safety.spec.ts).
  await page.reload()
  await expect(page.getByTestId('gallery-source-design')).toHaveAttribute('aria-pressed', 'true')
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

/** The left panel's tabs: Layers in Design, Files in Code, and Prompt Editing. */
const sidebarTab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Left panel', exact: true }).getByRole('tab', { name, exact: true })

test('Layers shows nested pages, selects without activating controls, and follows workspace modes', async ({ page }, testInfo) => {
  await openCounter(page)
  await expect(sidebarTab(page, 'Layers')).toHaveAttribute('aria-selected', 'true')
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('navigator-tab-project')).toHaveAttribute('aria-pressed', 'true')
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(source)
  const preview = page.getByTestId('render-tree')
  await expect(preview.getByRole('button', { name: 'Increase', exact: true })).toBeVisible()
  await expect(preview.getByText('Count: 0', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()
  await expect(page.getByTestId('editor')).toBeHidden()
  // Design's Layers selects a view without running it.
  const button = page.getByTestId('logical-layers').getByRole('treeitem', { name: 'Increase, Button', exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-selected', 'true')
  await expect(preview.getByRole('button', { name: 'Increase', exact: true })).toHaveAttribute('data-layer-selected', 'true')
  await expect(preview.getByText('Count: 0', { exact: true })).toBeVisible()
  // Evaluated pages and hover details remain available in developer inspection,
  // which is Code's Layers tab now.
  await page.getByTestId('workspace-develop').click()
  await page.getByTestId('navigator-tab-layers').click()
  await page.getByRole('button', { name: 'Runtime detail', exact: true }).click()
  const layers = page.getByRole('tree', { name: 'App layers' })
  const overview = layers.getByRole('treeitem', { name: 'Overview, Page', exact: true })
  const profile = layers.getByRole('treeitem', { name: 'Profile, Page', exact: true })
  await expect(overview).toBeVisible()
  await expect(profile).toBeVisible()
  const runtimeButton = layers.getByRole('treeitem', { name: 'Increase, Button', exact: true })
  await runtimeButton.click()
  await expect(runtimeButton).toHaveAttribute('aria-selected', 'true')
  await expect(preview.getByText('Count: 0', { exact: true })).toBeVisible()
  await page.getByTestId('live-toggle').click()
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
  await page.getByTestId('workspace-design').click()
  await expect(sidebarTab(page, 'Layers')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('navigation', { name: 'Layers', exact: true })).toBeVisible()
  await testInfo.attach('design-layers-light', { body: await page.screenshot(), contentType: 'image/png' })
  await page.getByTestId('workspace-more').click()
  await page.getByTestId('workspace-more-menu-theme').click()
  await expect(page.locator('html')).toHaveAttribute('data-workspace-theme', 'dark')
  await testInfo.attach('design-layers-dark', { body: await page.screenshot(), contentType: 'image/png' })
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('navigator-tab-project')).toHaveAttribute('aria-pressed', 'true')
  await expect(editor).toBeVisible()
  await expect(preview.getByText('Taylor', { exact: true })).toBeVisible()
  await page.getByTestId('navigator-tab-issues').click()
  await page.getByTestId('workspace-design').click()
  await expect(sidebarTab(page, 'Layers')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('navigation', { name: 'Layers', exact: true })).toBeVisible()
})

test('inspecting the preview follows the pointer in Layers and selects what is clicked', async ({ page }) => {
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(source)
  const preview = page.getByTestId('render-tree')
  await expect(preview.getByText('Count: 0', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()

  // Design opens in Edit, where the preview points at Design's own Layers: the
  // source views, so the interpolated count is the Text layer that draws it.
  await expect(page.getByTestId('live-toggle')).toHaveAttribute('aria-pressed', 'false')
  const layers = page.getByTestId('logical-layers')
  const button = layers.getByRole('treeitem', { name: 'Increase, Button', exact: true })
  const count = layers.getByRole('treeitem', { name: 'Text', exact: true })
  await expect(button).toBeVisible()

  // Hovering names the view without selecting it, and the naming stops when the
  // pointer moves on: it is a pointer, not a choice.
  await preview.getByRole('button', { name: 'Increase', exact: true }).hover()
  await expect(button).toHaveAttribute('data-hovered', 'true')
  await expect(button).toHaveAttribute('aria-selected', 'false')
  await preview.getByText('Count: 0', { exact: true }).hover()
  await expect(button).not.toHaveAttribute('data-hovered', 'true')
  await expect(count).toHaveAttribute('data-hovered', 'true')

  // Clicking chooses it - in Layers, without leaving Design and without running
  // the button it landed on.
  await preview.getByRole('button', { name: 'Increase', exact: true }).click()
  await expect(button).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-mode', 'design')
  await expect(preview.getByText('Count: 0', { exact: true })).toBeVisible()
  await expect(preview.getByRole('button', { name: 'Increase', exact: true })).toHaveAttribute('data-layer-selected', 'true')

  // Leaving the preview leaves the selection where it was put.
  await page.getByTestId('toolbar').hover()
  await expect(button).toHaveAttribute('aria-selected', 'true')
  await expect(button).not.toHaveAttribute('data-hovered', 'true')
})

test('Pages draws every page at once, keeps one live, and opens the one that is clicked', async ({ page }, testInfo) => {
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(source)
  await expect(page.getByTestId('render-tree').getByText('Count: 0', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()

  // The gallery is Edit's: in Live Preview a click hands the phone to the person
  // using it, so the canvas says what the checkbox is for rather than hiding it.
  const showAll = page.getByTestId('show-all-pages')
  await expect(showAll).toBeEnabled()
  await page.getByTestId('live-toggle').click()
  await expect(showAll).toBeDisabled()
  await page.getByTestId('inspect-toggle').click()
  await expect(showAll).toBeEnabled()
  await showAll.check()

  const gallery = page.getByTestId('page-gallery')
  const phones = gallery.getByTestId('gallery-page')
  await expect(phones).toHaveCount(2)
  await expect(phones.first()).toContainText('Overview')
  await expect(phones.first()).toContainText('Editing')
  await expect(phones.nth(1)).toContainText('Profile')

  // Each phone is its own page, composed as that page: the one that is not
  // running still carries its own title and its own content.
  await expect(phones.first().getByText('Count: 0', { exact: true })).toBeVisible()
  await expect(phones.nth(1).getByText('Taylor', { exact: true })).toBeVisible()
  await expect(phones.nth(1).getByText('Count: 0', { exact: true })).toHaveCount(0)
  await testInfo.attach('design-pages', { body: await page.screenshot(), contentType: 'image/png' })

  // A phone that is not live is a picture of the app: pressing it opens the page.
  await phones.nth(1).getByRole('button', { name: 'Edit Profile' }).click()
  await expect(phones.nth(1)).toContainText('Editing')
  await expect(phones.first()).not.toContainText('Editing')

  // Editing a screen does not run the app. Preview resumes its existing tab,
  // while the design gallery keeps its selected screen and checkbox setting.
  await page.getByTestId('live-toggle').click()
  await expect(gallery).toHaveCount(0)
  await expect(showAll).toBeDisabled()
  await expect(page.getByTestId('render-tree').getByText('Count: 0', { exact: true })).toBeVisible()
  await page.getByTestId('render-tree').getByRole('button', { name: 'Profile', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Taylor', { exact: true })).toBeVisible()
  await page.getByTestId('inspect-toggle').click()
  await expect(showAll).toBeChecked()
  await expect(page.getByTestId('page-gallery')).toBeVisible()
})

test('a view written as an argument offers only what it can do on its own (C2)', async ({ page }) => {
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  await replaceSource(page, `import SwiftUI
@main struct CardApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
  var body: some View {
    VStack {
      Text("Card")
        .padding()
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.gray))
      Text("Other")
    }
  }
}`)
  await expect(page.getByTestId('render-tree').getByText('Card', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()
  const layers = page.getByTestId('logical-layers')
  await layers.getByRole('button', { name: 'Expand Card', exact: true }).click()
  const shape = layers.getByRole('treeitem', { name: 'Rounded rectangle', exact: true })
  await shape.click()
  await shape.getByRole('button', { name: 'Actions for Rounded rectangle', exact: true }).click()
  // Everything that would act on its statement is off, and says why; a name is its own.
  for (const action of ['duplicate', 'VStack', 'HStack', 'ZStack', 'reparent', 'hide', 'delete']) {
    const item = page.getByTestId(`source-layer-actions-menu-${action}`)
    await expect(item).toBeDisabled()
    await expect(item).toHaveAttribute('title', 'The overlay is part of the view it is attached to, so it can’t be moved, wrapped, copied, hidden or deleted on its own. Select that view instead.')
  }
  await expect(page.getByTestId('source-layer-actions-menu-rename')).toBeEnabled()
})
