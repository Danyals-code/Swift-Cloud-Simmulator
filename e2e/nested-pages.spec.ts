import { expect, test, type Page } from '@playwright/test'
import { assertSource } from './designer-helpers'

const SOURCE = `import SwiftUI
@main struct PagesApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    @State private var showingForm = false
    @State private var count = 0
    var body: some View {
        TabView {
            NavigationStack {
                VStack {
                    Text("Library heading")
                    NavigationLink {
                        VStack {
                            Text("Detail heading")
                            Button("Change count") { count += 1 }
                            Text("Count: \\(count)")
                        }.navigationTitle("Book details")
                    } label: { Text("Open detail") }
                    Button("Add book") { showingForm = true }
                    Text("Root count: \\(count)")
                }
                .sheet(isPresented: $showingForm) {
                    NavigationStack { Text("Form heading").navigationTitle("Add a book") }
                }
            }.tabItem { Text("Library") }
            Text("Settings page").tabItem { Text("Settings") }
        }
    }
}`

const phones = (page: Page) => page.getByTestId('gallery-page')
const rootPhone = (page: Page) => phones(page).filter({ has: page.getByRole('button', { name: 'Edit Library', exact: true }) })
const layer = (page: Page, name: string) => page.getByTestId('logical-layers').getByRole('treeitem', { name, exact: true })

/**
 * Fits the canvas, then parks the pointer on the toolbar: in Edit, the phone under
 * the pointer becomes the focused screen, and the zoom menu closes over the canvas.
 */
async function fit(page: Page) {
  await page.getByTestId('zoom-select').click()
  await page.getByRole('option', { name: /Fit/ }).click()
  await page.getByTestId('toolbar').hover()
}
/**
 * The left panel as three panels, where Layers is its own panel headed with the
 * focused screen's name ("Book details layers"). The default one-tree outline nests
 * the same layers under the screen's row instead.
 */
async function threePanels(page: Page) {
  await page.getByTestId('navigator-layout-split').click()
  await expect(page.getByTestId('design-navigator')).toHaveAttribute('data-layout', 'split')
}
async function open(page: Page) {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  await page.getByTestId('editor').locator('.cm-content').fill(SOURCE)
  await expect(page.getByTestId('render-tree').getByText('Library heading', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()
  // Design opens in Edit with every screen drawn: Library, the detail it pushes and
  // the sheet it presents, and the Settings tab.
  await expect(phones(page)).toHaveCount(4)
  await threePanels(page)
  await fit(page)
}

test('tabs stay horizontal and related screens stack under their owning tab', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1200 })
  await page.goto('/')
  await page.getByTestId('gallery-source-app').click()
  await page.getByTestId('template-folio').click()
  await page.getByTestId('template-confirm').click()
  // Book details draws a sample book too, so the list is read from the Library phone.
  await expect(rootPhone(page).getByTestId('render-tree').getByText('The Secret Garden', { exact: true })).toBeVisible()
  await threePanels(page)
  // Every screen is drawn from the start: the Add a book sheet both lists open is
  // one screen, drawn once, so six pages are five phones.
  await expect(phones(page)).toHaveCount(5)
  await expect(page.getByRole('region', { name: 'Preview', exact: true })).toContainText('5 of 6 screens')
  await page.getByRole('button', { name: 'Edit Library', exact: true }).click()
  await expect(page.getByTestId('logical-layers')).toContainText('Library layers')
  await expect(page.getByTestId('logical-layers').getByRole('treeitem')).toHaveCount(3)
  // The row is one design that every book uses.
  await expect(layer(page, 'Book row, Component')).toContainText('One design')
  await expect(layer(page, 'Book row, Component')).toHaveAttribute('data-shared-design', 'true')
  // Narrowing the canvas to the focused lane leaves Library with its two related screens.
  await page.getByTestId('show-all-pages').uncheck()
  await expect(phones(page)).toHaveCount(3)
  await page.getByTestId('show-all-pages').check()
  await expect(phones(page)).toHaveCount(5)
  await fit(page)
  const slots = await phones(page).evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect()
    return { id: element.getAttribute('data-page-id'), parent: element.getAttribute('data-parent-page'), x: rect.x, y: rect.y }
  }))
  // Each tab is a lane, one under the other in tab order, starting at the same edge.
  const roots = slots.filter(slot => !slot.parent)
  expect(roots).toHaveLength(3)
  for (const root of roots) expect(Math.abs(root.x - roots[0]!.x)).toBeLessThan(1)
  expect(roots[0]!.y).toBeLessThan(roots[1]!.y)
  expect(roots[1]!.y).toBeLessThan(roots[2]!.y)
  // A related screen sits a navigation step to the right of the screen it is reached
  // from, inside its owning tab's lane.
  const related = slots.filter(slot => slot.parent)
  expect(related).toHaveLength(2)
  for (const child of related) {
    const parent = slots.find(slot => slot.id === child.parent)!
    let owner = parent
    while (owner.parent) owner = slots.find(slot => slot.id === owner.parent)!
    const next = roots[roots.indexOf(owner) + 1]
    expect(child.x).toBeGreaterThan(parent.x)
    expect(child.y).toBeGreaterThan(parent.y - 1)
    if (next) expect(child.y).toBeLessThan(next.y)
  }
  const path = testInfo.outputPath('tabs-and-related-screens.png')
  await page.screenshot({ path })
  await testInfo.attach('tabs and related screens', { path, contentType: 'image/png' })
  await page.getByRole('button', { name: 'Edit Settings', exact: true }).click()
  const settingsPhone = phones(page).filter({ has: page.getByRole('button', { name: 'Edit Settings', exact: true }) })
  const settingsBefore = await settingsPhone.boundingBox()
  await page.getByTestId('show-all-pages').uncheck()
  await expect(phones(page)).toHaveCount(1)
  const settingsAfter = await settingsPhone.boundingBox()
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(settingsAfter![key]).toBeCloseTo(settingsBefore![key], 1)
  await page.getByTestId('show-all-pages').check()
  await expect(phones(page)).toHaveCount(5)
  await fit(page)
  await page.getByRole('button', { name: 'Edit Book details', exact: true }).click()
  await expect(page.getByTestId('logical-layers')).toContainText('Book details layers')
  await expect(layer(page, 'Book row, Component')).toHaveCount(0)
  await page.getByTestId('live-toggle').click()
  await expect(page.getByTestId('render-tree')).toHaveCount(1)
  await expect(page.getByTestId('render-tree').getByText('The Time Machine', { exact: true })).toBeVisible()
  await expect(page.getByTestId('render-tree').getByRole('button', { name: 'Save to reading list', exact: true })).toHaveCount(0)
})

test('editing detail and sheet Layers updates exact Swift and keeps page selection stable', async ({ page }) => {
  await open(page)
  await expect(layer(page, 'Library heading, Text')).toBeVisible()
  await expect(layer(page, 'Detail heading, Text')).toHaveCount(0)
  await expect(layer(page, 'Form heading, Text')).toHaveCount(0)
  await page.getByRole('button', { name: 'Edit Book details', exact: true }).click()
  await layer(page, 'Detail heading, Text').click()
  const text = page.getByTestId('settings-basics').getByRole('textbox', { name: 'Text', exact: true })
  await text.fill('Updated detail heading')
  await text.press('Enter')
  await expect(page.locator('[data-page-kind="destination"]').getByText('Updated detail heading', { exact: true })).toBeVisible()
  await expect(page.getByTestId('logical-layers')).toContainText('Book details layers')
  await expect(rootPhone(page).getByText('Library heading', { exact: true })).toBeVisible()
  let source = SOURCE.replace('Text("Detail heading")', 'Text("Updated detail heading")')
  await assertSource(page, source)
  await fit(page)
  await page.getByRole('button', { name: 'Edit Add a book', exact: true }).click()
  await layer(page, 'Form heading, Text').click()
  await text.fill('New book form')
  await text.press('Enter')
  await expect(page.locator('[data-page-kind="sheet"]').getByText('New book form', { exact: true })).toBeVisible()
  await expect(page.getByTestId('logical-layers')).toContainText('Add a book layers')
  source = source.replace('Text("Form heading")', 'Text("New book form")')
  await assertSource(page, source)
  await page.getByTestId('live-toggle').click()
  await expect(page.getByTestId('render-tree').getByText('Root count: 0', { exact: true })).toBeVisible()
  await expect(page.getByTestId('render-tree').getByText('New book form', { exact: true })).toHaveCount(0)
})

test('canvas scrolling explores phones and child hover selects the right Layers context without running actions', async ({ page }) => {
  await open(page)
  const detail = page.locator('[data-page-kind="destination"]')
  const action = detail.getByRole('button', { name: 'Change count', exact: true })
  await action.hover()
  await expect(page.getByTestId('logical-layers')).toContainText('Book details layers')
  await expect(layer(page, 'Change count, Button')).toHaveAttribute('data-hovered', 'true')
  await action.click()
  await expect(detail.getByText('Count: 0', { exact: true })).toBeVisible()
  await layer(page, 'Detail heading, Text').hover()
  await expect(detail.getByTestId('inspect-highlight')).toHaveCount(1)
  await expect(rootPhone(page).getByTestId('inspect-highlight')).toHaveCount(0)
  const canvas = page.getByTestId('device-pane')
  const before = await detail.boundingBox()
  const bounds = await canvas.boundingBox()
  await page.mouse.move(bounds!.x + 30, bounds!.y + 100)
  await page.mouse.wheel(0, 120)
  await expect.poll(async () => (await detail.boundingBox())!.y).toBeLessThan(before!.y - 50)
  await page.getByTestId('live-toggle').click()
  await expect(page.getByTestId('render-tree').getByText('Root count: 0', { exact: true })).toBeVisible()
  await page.getByTestId('render-tree').getByRole('button', { name: 'Open detail', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Detail heading', { exact: true })).toBeVisible()
  await page.getByTestId('render-tree').getByRole('button', { name: 'Change count', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Count: 1', { exact: true })).toBeVisible()
})


test('Add without a selection inserts into the focused child phone', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Edit Book details', exact: true }).click()
  await page.getByTestId('add-view').click()
  await expect(page.getByTestId('add-view-target')).toHaveText('Into this screen')
  await page.getByTestId('add-view-text').click()
  const detail = page.locator('[data-page-kind="destination"]')
  await expect(detail.getByText('Text', { exact: true })).toBeVisible()
  await expect(rootPhone(page).getByText('Text', { exact: true })).toHaveCount(0)
  await page.getByTestId('workspace-develop').click()
  const source = await page.getByTestId('editor').locator('.cm-content').innerText()
  expect(source.indexOf('Text("Text")')).toBeGreaterThan(source.indexOf('Text("Detail heading")'))
  expect(source.indexOf('Text("Text")')).toBeLessThan(source.indexOf('.navigationTitle("Book details")'))
})
