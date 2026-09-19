import { expect, test, type Page } from '@playwright/test'
import { addModifier, cards } from './designer-helpers'

const SOURCE = `import SwiftUI
enum Style { static let gap: CGFloat = 12 }
@main struct AuthoringApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    @State private var count = 0
    var body: some View {
        VStack(spacing: Style.gap) {
            Text("Alpha").font(.title)
            Text("Beta").padding(8)
            Text("Count \\(count)")
            Button("Increment") { count += 1 }
        }
    }
}`

async function openSource(page: Page, source = SOURCE) {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(source)
  await expect(page.getByTestId('render-tree').getByText('Beta', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()
  await page.getByTestId('inspect-toggle').click()
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true')
}

async function selectBeta(page: Page) {
  await page.getByTestId('render-tree').getByText('Beta', { exact: true }).click()
  await expect(page.getByTestId('authoring-inspector').getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('Beta')
}

test('inspects source provenance without changing the document', async ({ page }) => {
  await openSource(page)
  await selectBeta(page)
  const inspector = page.getByTestId('authoring-inspector')
  await inspector.getByText('Code details', { exact: true }).click()
  await expect(inspector).toContainText('Literal')
  await expect(inspector).toContainText('From parent')
  await expect(inspector).toContainText('ContentView')
  await expect(inspector.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('Beta')
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('editor').locator('.cm-content')).toHaveText(SOURCE, { useInnerText: true })
})

test('selection survives source inserted before the selected node', async ({ page }) => {
  await openSource(page)
  await selectBeta(page)
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.insertText('// inserted before selection\n')
  await page.getByTestId('workspace-design').click()
  await expect(page.getByTestId('authoring-inspector').getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('Beta')
  await expect(page.getByTestId('logical-layers').locator('[data-source-name="Text"]').filter({ hasText: 'Beta' })).toHaveAttribute('aria-selected', 'true')
})

test('computed content stays read-only and source reveal opens the corresponding code', async ({ page }) => {
  await openSource(page)
  await page.getByTestId('render-tree').getByText('Count 0', { exact: true }).click()
  const inspector = page.getByTestId('authoring-inspector')
  await inspector.getByText('Code details', { exact: true }).click()
  await expect(inspector).toContainText('Expression')
  await expect(inspector.getByRole('textbox', { name: 'Text', exact: true })).toHaveCount(0)
  await inspector.getByRole('button', { name: 'Show source for content', exact: true }).click()
  await expect(page.getByTestId('editor')).toBeVisible()
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('Text("Count \\(count)")')
})

test('design-mode selection never runs a button action', async ({ page }) => {
  await openSource(page)
  await page.getByTestId('render-tree').getByRole('button', { name: 'Increment', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Count 0', { exact: true })).toBeVisible()
  await expect(page.getByTestId('authoring-inspector').getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Increment')
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('editor').locator('.cm-content')).toHaveText(SOURCE, { useInnerText: true })
})

async function currentSource(page: Page): Promise<string> {
  return page.getByTestId('editor').locator('.cm-content').innerText()
}

test('designer content edits update Swift, preview and layers; Escape cancels a draft', async ({ page }) => {
  await openSource(page)
  await selectBeta(page)
  const inspector = page.getByTestId('authoring-inspector')
  const content = inspector.getByRole('textbox', { name: 'Text', exact: true })
  await content.fill('Cancelled')
  await content.press('Escape')
  await expect(content).toHaveValue('Beta')
  await content.fill('Designer card')
  await content.press('Enter')
  await expect(page.getByTestId('render-tree').getByText('Designer card', { exact: true })).toBeVisible()
  await expect(page.getByTestId('logical-layers').locator('[data-source-name="Text"]').filter({ hasText: 'Designer card' })).toHaveAttribute('aria-selected', 'true')
  await expect(inspector.getByRole('textbox', { name: 'Text', exact: true })).toBeFocused()
  await page.getByTestId('workspace-develop').click()
  expect(await currentSource(page)).toBe(SOURCE.replace('Text("Beta")', 'Text("Designer card")'))
})

test('visual and code edits share undo and redo, including after a mode switch', async ({ page }) => {
  await openSource(page)
  await selectBeta(page)
  const content = page.getByTestId('authoring-inspector').getByRole('textbox', { name: 'Text', exact: true })
  await content.fill('Design edit')
  await content.press('Enter')
  await expect(page.getByTestId('render-tree').getByText('Design edit', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.insertText('// code edit\n')
  await expect(editor).toContainText('// code edit')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editor).not.toContainText('// code edit')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editor).toHaveText(SOURCE, { useInnerText: true })
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(editor).toContainText('Design edit')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(editor).toContainText('// code edit')
})

test('numeric intermediate values never corrupt source and blur commits a valid value', async ({ page }) => {
  await openSource(page)
  await selectBeta(page)
  const inspector = page.getByTestId('authoring-inspector')
  const padding = inspector.getByRole('textbox', { name: 'Padding', exact: true })
  await padding.fill('-')
  await padding.press('Enter')
  await expect(inspector.getByRole('alert')).toContainText('finite number')
  await expect(page.getByTestId('render-tree').getByText('Beta', { exact: true })).toBeVisible()
  await padding.press('Escape')
  await expect(padding).toHaveValue('8')
  await padding.fill('24')
  await padding.press('Tab')
  await expect(inspector.getByRole('textbox', { name: 'Padding', exact: true })).toHaveValue('24')
  await page.getByTestId('workspace-develop').click()
  expect(await currentSource(page)).toBe(SOURCE.replace('padding(8)', 'padding(24)'))
})

test('restyles a card through supported fields without replacing computed content', async ({ page }) => {
  await openSource(page)
  await page.getByTestId('render-tree').getByText('Count 0', { exact: true }).click()
  const inspector = page.getByTestId('authoring-inspector')
  await addModifier(page, 'Font', 'font')
  await inspector.getByRole('textbox', { name: 'Font size', exact: true }).fill('24')
  await inspector.getByRole('textbox', { name: 'Font size', exact: true }).press('Enter')
  await expect(inspector.getByRole('textbox', { name: 'Font size', exact: true })).toHaveValue('24')
  await addModifier(page, 'Background', 'background')
  await cards(page, 'background').getByRole('combobox', { name: 'Color', exact: true }).selectOption('blue')
  await expect(cards(page, 'background').getByRole('combobox', { name: 'Color', exact: true })).toHaveValue('blue')
  await addModifier(page, 'Size', 'frame')
  await expect(cards(page, 'frame').getByRole('textbox', { name: 'Width', exact: true })).toHaveValue('100')
  await page.getByTestId('workspace-develop').click()
  expect(await currentSource(page)).toContain('Text("Count \\(count)").font(.system(size: 24)).background(Color.blue).frame(width: 100, height: 100)')
})

test('an opacity drag is one undo step and Escape cancels the whole drag', async ({ page }) => {
  await openSource(page)
  await selectBeta(page)
  const inspector = page.getByTestId('authoring-inspector')
  await addModifier(page, 'Opacity', 'opacity')
  const slider = cards(page, 'opacity').getByRole('slider', { name: 'Opacity slider', exact: true })
  const bounds = (await slider.boundingBox())!
  await slider.focus()
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.4, bounds.y + bounds.height / 2, { steps: 5 })
  await page.keyboard.press('Escape')
  await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height / 2)
  await page.mouse.up()
  await expect(inspector.getByRole('textbox', { name: 'Opacity', exact: true })).toHaveValue('1')
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(inspector.getByRole('textbox', { name: 'Opacity', exact: true })).not.toHaveValue('1')
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editor).toHaveText(SOURCE.replace('Text("Beta").padding(8)', 'Text("Beta").padding(8).opacity(1)'), { useInnerText: true })
})
