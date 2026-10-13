import { expect, test, type Page } from '@playwright/test'
import { openCounter } from './designer-helpers'

const SOURCE = `import SwiftUI
struct Item: Identifiable { let id: String; var title: String; var price: Double }
@main struct ReviewApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    @State private var items: [Item] = [Item(id: "one", title: "First", price: 12)]
    var body: some View {
        VStack {
            Text("Catalog")
            ForEach(0..<2, id: \\.self) { i in Text("Row").padding(8) }
            ForEach(0..<2, id: \\.self) { i in Text("Row").padding(8) }
            List(items) { item in Text(item.title) }
        }
    }
}`
async function open(page: Page) {
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(SOURCE)
  await expect(page.getByTestId('render-tree').getByText('Catalog', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()
  await expect(page.getByTestId('logical-layers')).toBeVisible()
}

test('the second identical repeated view keeps its identity across edits', async ({ page }) => {
  await open(page)
  const layers = page.getByTestId('logical-layers')
  await expect(layers.locator('[data-source-kind="template"]')).toHaveCount(0)
  const repeated = layers.locator('[data-source-name="Text"]').filter({ hasText: 'Row' })
  await expect(repeated).toHaveCount(2)
  await repeated.nth(1).click()
  const padding = page.getByTestId('authoring-inspector').getByRole('textbox', { name: 'Padding value', exact: true })
  await padding.fill('24'); await padding.press('Enter')
  await expect(padding).toHaveValue('24')
  await expect(repeated.nth(0)).toHaveAttribute('aria-selected', 'false')
  await expect(repeated.nth(1)).toHaveAttribute('aria-selected', 'true')
  await padding.fill('36'); await padding.press('Enter')
  await expect(padding).toHaveValue('36')
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('editor').locator('.cm-content')).toHaveText(SOURCE.replace('Text("Row").padding(8) }\n            List', 'Text("Row").padding(36) }\n            List'), { useInnerText: true })
})

test('canvas selection reveals collapsed source ancestors and label search finds displayed content', async ({ page }) => {
  await open(page)
  const layers = page.getByTestId('logical-layers')
  // Collapse all is on the Layers panel of the three-panel navigator layout.
  await page.getByTestId('navigator-layout-split').click()
  await page.getByTestId('collapse-layers').click()
  await expect(layers.locator('[data-source-name="Text"]')).toHaveCount(0)
  await page.getByTestId('render-tree').getByText('Catalog', { exact: true }).click()
  await expect(layers.locator('[data-source-name="Text"]').filter({ hasText: 'Catalog' })).toHaveAttribute('aria-selected', 'true')
  // Layer search is the one-tree navigator's "Find a screen or layer" field.
  await page.getByTestId('navigator-layout-merged').click()
  const search = page.getByTestId('design-search')
  await search.fill('  cAtAlOg  ')
  await expect(layers.locator('[data-source-name="Text"]')).toHaveCount(1)
  await expect(layers).toContainText('Catalog')
  await search.press('Escape')
  await expect(search).toHaveValue('')
  await page.getByTestId('render-tree').getByText('Row', { exact: true }).last().click()
  await expect(layers.locator('[data-source-name="Text"][aria-selected="true"]')).toContainText('Row')
})

test('required numeric drafts remain editable, validate on Apply, and write real numbers', async ({ page }) => {
  await open(page)
  await page.getByTestId('logical-layers').locator('[data-source-name="List"]').click()
  const inspector = page.getByTestId('authoring-inspector'), price = inspector.getByLabel('Record price', { exact: true })
  await price.press('ControlOrMeta+a'); await price.press('Backspace')
  await expect(price).toBeEnabled(); await expect(price).toHaveValue('')
  await inspector.getByRole('button', { name: 'Apply preview records', exact: true }).click()
  await expect(inspector.getByRole('alert')).toContainText('price: enter a finite number')
  await price.fill('-'); await expect(price).toHaveValue('-')
  await price.fill('-1.'); await expect(price).toHaveValue('-1.')
  await price.fill('-1.25')
  await inspector.getByLabel('Record edit scope').selectOption('app')
  await inspector.getByRole('button', { name: 'Apply app initial data', exact: true }).click()
  await expect(price).toHaveValue('-1.25')
  await expect(inspector).not.toContainText('Defined in')
  await expect(inspector).not.toContainText('How this changes Swift')
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('editor').locator('.cm-content')).toHaveText(SOURCE.replace('price: 12', 'price: -1.25'), { useInnerText: true })
})
