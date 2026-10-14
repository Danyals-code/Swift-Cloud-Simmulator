import { expect, test, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * The Design panel's Fill section (doc 18, Wave 2): a colour, gradient or material set
 * the way Figma sets one, written as the plainest Swift, drawn on the canvas, and taken
 * back with one undo.
 */

const CARD = 'Text("Card").padding(12).background(Color.blue)'
const app = (view: string) => `import SwiftUI
@main struct FillApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
  var body: some View {
    VStack {
      ${view}
      Text("Other")
    }
  }
}`

async function openCard(page: Page) {
  await openInDesign(page, app(CARD), 'Card')
  await page.getByTestId('logical-layers').getByRole('treeitem', { name: 'Card, Text', exact: true }).click()
  const fill = page.getByTestId('layer-fill')
  await expect(fill.getByRole('combobox', { name: 'Fill type', exact: true })).toHaveValue('color')
  return fill
}

/** What the canvas paints behind the card: the first layer with a colour or an image behind it. */
const painted = (page: Page) => page.getByTestId('render-tree').locator('[data-node-id]').evaluateAll(elements => {
  const layer = elements.find(element => element.getAttribute('data-kind') === 'layer' && element.getAttribute('data-node-id') !== 'screen'
    && (getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)' || getComputedStyle(element).backgroundImage !== 'none'))
  return layer ? { color: getComputedStyle(layer).backgroundColor, image: getComputedStyle(layer).backgroundImage } : null
})

test('a hex with its alpha fills translucent, and one undo puts the colour back', async ({ page }) => {
  const fill = await openCard(page)
  const hex = fill.getByRole('textbox', { name: 'Fill hex', exact: true })
  await hex.fill('#ff000080')
  await hex.press('Enter')
  await expect.poll(async () => (await painted(page))?.color).toMatch(/^rgba\(255, 0, 0, 0\.5\d*\)$/)
  await expect(fill.getByRole('textbox', { name: 'Fill opacity', exact: true })).toHaveValue('50.2')
  await expect(fill.getByRole('textbox', { name: 'Fill hex', exact: true })).toHaveValue('#FF0000')
  await page.getByTestId('design-undo').click()
  await expect.poll(async () => (await painted(page))?.color).toBe('rgb(0, 136, 255)')
  expect(await sourceInCode(page)).toContain(CARD)
})

test('a solid fill becomes a two-stop gradient the canvas draws, and turns by its angle', async ({ page }) => {
  const fill = await openCard(page)
  await fill.getByRole('combobox', { name: 'Fill type', exact: true }).selectOption('gradient')
  await expect(fill.getByTestId('gradient-stop')).toHaveCount(2)
  await expect.poll(async () => (await painted(page))?.image).toContain('linear-gradient')
  expect(await sourceInCode(page)).toContain('Text("Card").padding(12).background(LinearGradient(colors: [Color.blue, Color.blue.opacity(0)], startPoint: .top, endPoint: .bottom))')
  const angle = page.getByTestId('layer-fill').getByRole('textbox', { name: 'Gradient angle', exact: true })
  await angle.fill('270')
  await angle.press('Enter')
  await expect.poll(() => sourceInCode(page)).toContain('startPoint: .leading, endPoint: .trailing))')
})

test('a material is chosen, and its thickness changed, in the background it was', async ({ page }) => {
  const fill = await openCard(page)
  await fill.getByRole('combobox', { name: 'Fill type', exact: true }).selectOption('material')
  const thickness = fill.getByRole('combobox', { name: 'Material thickness', exact: true })
  await expect(thickness).toHaveValue('regular')
  expect(await sourceInCode(page)).toContain('Text("Card").padding(12).background(.regularMaterial)')
  await page.getByTestId('layer-fill').getByRole('combobox', { name: 'Material thickness', exact: true }).selectOption('thin')
  await expect.poll(() => sourceInCode(page)).toContain('Text("Card").padding(12).background(.thinMaterial)')
})

test('the fill is taken away, and can be added again', async ({ page }) => {
  const fill = await openCard(page)
  await fill.getByRole('button', { name: 'Remove fill', exact: true }).click()
  await expect(fill.getByRole('button', { name: 'Add fill', exact: true })).toBeVisible()
  await expect.poll(() => painted(page)).toBeNull()
  expect(await sourceInCode(page)).toContain('Text("Card").padding(12)\n')
  await page.getByTestId('layer-fill').getByRole('button', { name: 'Add fill', exact: true }).click()
  await expect(page.getByTestId('layer-fill').getByRole('combobox', { name: 'Fill type', exact: true })).toHaveValue('color')
  expect(await sourceInCode(page)).toContain('Text("Card").padding(12).background(Color(.systemGray5))')
})

test('the swatch opens the system colours, and the eyedropper only where the browser has one', async ({ page }) => {
  const fill = await openCard(page)
  await fill.getByRole('button', { name: 'Fill color', exact: true }).click()
  const colors = page.getByRole('dialog', { name: 'Fill colors', exact: true })
  const dropper = await page.evaluate(() => 'EyeDropper' in window)
  await expect(colors.getByRole('button', { name: 'Pick a color on screen', exact: true })).toHaveCount(dropper ? 1 : 0)
  await colors.getByRole('button', { name: 'Red', exact: true }).click()
  await expect.poll(async () => (await painted(page))?.color).toBe('rgb(255, 56, 60)')
  await page.keyboard.press('Escape')
  await expect(colors).toHaveCount(0)
  expect(await sourceInCode(page)).toContain('Text("Card").padding(12).background(.red)')
})
