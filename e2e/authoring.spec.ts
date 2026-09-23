import { expect, test, type Page } from '@playwright/test'
import { cards, expandCard, openCounter } from './designer-helpers'

/**
 * Adds a modifier from the catalog by its exact label. Entries are named
 * "<label> <description>", and several can share a first word (Font, Font weight,
 * Font design), so the entry is matched on its label rather than a name prefix.
 */
async function addModifier(page: Page, label: string, name: string) {
  const count = await cards(page, name).count()
  await page.getByTestId('modifier-stack').getByRole('button', { name: /Add modifier/ }).click()
  const picker = page.getByRole('dialog', { name: 'Add modifier', exact: true })
  await picker.getByRole('textbox', { name: 'Search modifiers', exact: true }).fill(label)
  await picker.getByRole('button').filter({ has: page.getByText(label, { exact: true }) }).click()
  await expect(cards(page, name)).toHaveCount(count + 1)
  await expect(picker).toHaveCount(0)
  await expandCard(cards(page, name).last())
}

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
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(source)
  await expect(page.getByTestId('render-tree').getByText('Beta', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()
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
  // The "Code details" property list (Literal / From parent badges) was removed.
  // Where the view comes from now reads as its owning screen (ContentView is shown
  // as "Content") in the settings path, and its parent in the selection path.
  await expect(page.getByTestId('level-screen')).toHaveText('Content')
  await expect(page.getByTestId('level-view')).toHaveText('Beta')
  await expect(inspector.getByRole('navigation', { name: 'Selection path' })).toContainText('Vertical Stack')
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
  await expect(page.getByTestId('level-view')).toHaveText('Text')
  // Computed content has no editable Text field (the "Expression" badge went with
  // the removed Code details section); the source is reached through View actions.
  await expect(inspector.getByRole('textbox', { name: 'Text', exact: true })).toHaveCount(0)
  await inspector.getByRole('button', { name: 'View actions', exact: true }).click()
  await page.getByRole('option', { name: 'Open in Code', exact: true }).click()
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
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(editor).toContainText('Design edit')
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(editor).toContainText('// code edit')
})

test('numeric intermediate values never corrupt source and blur commits a valid value', async ({ page }) => {
  await openSource(page)
  await selectBeta(page)
  const inspector = page.getByTestId('authoring-inspector')
  const padding = inspector.getByRole('textbox', { name: 'Padding value', exact: true })
  await padding.fill('-')
  await padding.press('Enter')
  await expect(inspector.getByRole('alert')).toContainText('finite number')
  await expect(page.getByTestId('render-tree').getByText('Beta', { exact: true })).toBeVisible()
  await padding.press('Escape')
  await expect(padding).toHaveValue('8')
  await padding.fill('24')
  await padding.press('Tab')
  await expect(inspector.getByRole('textbox', { name: 'Padding value', exact: true })).toHaveValue('24')
  await page.getByTestId('workspace-develop').click()
  expect(await currentSource(page)).toBe(SOURCE.replace('padding(8)', 'padding(24)'))
})

test('restyles a card through supported fields without replacing computed content', async ({ page }) => {
  await openSource(page)
  await page.getByTestId('render-tree').getByText('Count 0', { exact: true }).click()
  await addModifier(page, 'Font', 'font')
  // The catalog's Font now starts as a text style (.font(.body)) rather than a
  // fixed size, so the supported field to restyle it is the text style picker.
  const textStyle = cards(page, 'font').getByRole('combobox', { name: 'Text style value', exact: true })
  await expect(textStyle).toHaveValue('body')
  await textStyle.selectOption('title')
  await expect(cards(page, 'font').getByRole('combobox', { name: 'Text style value', exact: true })).toHaveValue('title')
  await addModifier(page, 'Background', 'background')
  await cards(page, 'background').getByRole('combobox', { name: 'Color value', exact: true }).selectOption('blue')
  await expect(cards(page, 'background').getByRole('combobox', { name: 'Color value', exact: true })).toHaveValue('blue')
  await addModifier(page, 'Size', 'frame')
  await expect(cards(page, 'frame').getByRole('textbox', { name: 'Width value', exact: true })).toHaveValue('100')
  await page.getByTestId('workspace-develop').click()
  // New modifiers are placed where they usually belong, so Size lands before Background.
  expect(await currentSource(page)).toContain('Text("Count \\(count)").font(.title).frame(width: 100, height: 100).background(Color.blue)')
})

test('an opacity drag is one undo step and Escape cancels the whole drag', async ({ page, browserName }) => {
  test.fixme(browserName === 'webkit', 'Product bug in WebKit/Safari: mousedown on the range blurs it (form controls are not mouse-focusable), so onBlur commits the first drag value (PropertyControl.tsx:86) and Escape never reaches the slider')
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
