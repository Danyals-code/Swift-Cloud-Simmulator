import { expect, test, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * The Text and Effects sections (doc 18, Wave 2), in Chrome and Safari alike: a text
 * style, a size that scales with text size, a colour and the layer's opacity, each set
 * the way Figma sets it, drawn on the canvas and written as the plainest Swift.
 */

const app = (view: string) => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { HomeScreen() }
    }
}

struct HomeScreen: View {
    var body: some View {
        VStack(spacing: 8) {
            ${view}
            Text("Other")
        }
    }
}
`

const inspector = (page: Page) => page.getByTestId('authoring-inspector')
const textSection = (page: Page) => inspector(page).getByTestId('layer-text')
const effects = (page: Page) => inspector(page).getByTestId('layer-effects')
const drawn = (page: Page, text: string) => page.getByTestId('render-tree').getByText(text, { exact: true })
const idle = (page: Page) => expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
/** The drawn text's height, 0 while it is being redrawn and has no box, so a poll waits for it. */
const height = async (page: Page, text: string) => (await drawn(page, text).boundingBox())?.height ?? 0

/** How opaque the canvas draws a text: its own opacity and every one around it, multiplied. */
const drawnOpacity = (page: Page, text: string) => drawn(page, text).evaluate(element => {
  let opacity = 1
  for (let at: Element | null = element; at && at.getAttribute('data-testid') !== 'render-tree'; at = at.parentElement) opacity *= Number(getComputedStyle(at).opacity)
  return opacity
})

async function openHello(page: Page) {
  await openInDesign(page, app('Text("Hello")'), 'Hello')
  await drawn(page, 'Hello').click()
  await expect(textSection(page).getByRole('combobox', { name: 'Text style', exact: true })).toHaveValue('body')
}

test('Title 2 draws the text larger, and one undo puts Body back', async ({ page }) => {
  await openHello(page)
  await expect.poll(() => height(page, 'Hello')).toBeGreaterThan(0)
  const body = await height(page, 'Hello')
  await textSection(page).getByRole('combobox', { name: 'Text style', exact: true }).selectOption('title2')
  await expect.poll(async () => await height(page, 'Hello') / body).toBeGreaterThan(1.2)
  expect(await sourceInCode(page)).toContain('Text("Hello").font(.title2)')
  await page.getByTestId('design-undo').click()
  await expect.poll(() => height(page, 'Hello')).toBeCloseTo(body, 0)
  expect(await sourceInCode(page)).toContain('Text("Hello")\n            Text("Other")')
})

test('a custom size of 30 scales with text size, following Title, the style nearest it', async ({ page }) => {
  await openHello(page)
  await expect.poll(() => height(page, 'Hello')).toBeGreaterThan(0)
  const body = await height(page, 'Hello')
  const text = textSection(page)
  /** A new @ScaledMetric moves the view down the file, and the selection goes with it. */
  const stillSelected = async () => { await idle(page); await expect(text).toBeVisible() }
  await text.getByRole('combobox', { name: 'Text style', exact: true }).selectOption('custom')
  await stillSelected()
  await expect(text.getByRole('checkbox', { name: 'Scales with text size', exact: true })).toBeChecked()
  const size = text.getByRole('textbox', { name: 'Font size', exact: true })
  await expect(size).toHaveValue('17')
  await size.fill('30')
  await size.press('Enter')
  await expect.poll(async () => await height(page, 'Hello') / body).toBeGreaterThan(1.6)
  await stillSelected()
  await expect(text.getByRole('combobox', { name: 'Follows text style', exact: true })).toHaveValue('title')
  const source = await sourceInCode(page)
  expect(source).toContain('    @ScaledMetric(relativeTo: .title) private var textSize: CGFloat = 30\n    var body: some View {')
  expect(source).toContain('Text("Hello").font(.system(size: textSize))')
})

test('a text color chosen from the swatches is drawn, and written as a foreground style', async ({ page }) => {
  await openHello(page)
  await textSection(page).getByRole('button', { name: 'Text color', exact: true }).click()
  await page.getByRole('dialog', { name: 'Text colors', exact: true }).getByRole('button', { name: 'Red', exact: true }).click()
  await expect(drawn(page, 'Hello')).toHaveCSS('color', 'rgb(255, 56, 60)')
  await page.keyboard.press('Escape')
  expect(await sourceInCode(page)).toContain('Text("Hello").foregroundStyle(.red)')
  await expect(drawn(page, 'Other')).not.toHaveCSS('color', 'rgb(255, 56, 60)')
})

test('Layer opacity at 50% draws the layer at half opacity, and 100% takes the modifier away', async ({ page }) => {
  await openHello(page)
  const opacity = effects(page).getByRole('textbox', { name: 'Layer opacity', exact: true })
  await expect(opacity).toHaveValue('100')
  await opacity.fill('50')
  await opacity.press('Enter')
  await expect.poll(() => drawnOpacity(page, 'Hello')).toBeCloseTo(0.5, 2)
  expect(await drawnOpacity(page, 'Other')).toBe(1)
  expect(await sourceInCode(page)).toContain('Text("Hello").opacity(0.5)')

  await drawn(page, 'Hello').click()
  await expect(opacity).toHaveValue('50')
  await opacity.fill('100')
  await opacity.press('Enter')
  await expect.poll(() => drawnOpacity(page, 'Hello')).toBe(1)
  expect(await sourceInCode(page)).toContain('Text("Hello")\n            Text("Other")')
})
