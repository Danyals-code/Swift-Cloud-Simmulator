import { expect, test, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * A designer's habits from Figma, in Chrome and Safari alike: the keys (D5), the
 * words for sizing (D2), grouping into a Column, Row or Overlap (D3), and aligning and
 * spreading a stack's views out (D4).
 */

const APP = `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { HomeScreen() }
    }
}

struct HomeScreen: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Alpha")
            Text("Beta")
            Text("Gamma")
        }
    }
}
`

const drawn = (page: Page, text: string) => page.getByTestId('render-tree').getByText(text, { exact: true })
const note = (page: Page) => page.getByTestId('design-feedback')
const inspector = (page: Page) => page.getByTestId('authoring-inspector')

test('⌘D duplicates the selected view and ⇧⌘H hides it (D5)', async ({ page }) => {
  await openInDesign(page, APP, 'Beta')
  await drawn(page, 'Beta').click()

  await page.keyboard.press('ControlOrMeta+d')
  await expect(drawn(page, 'Beta')).toHaveCount(2)

  await page.keyboard.press('ControlOrMeta+Shift+H')
  await expect(drawn(page, 'Beta')).toHaveCount(1)
  await expect(page.getByTestId('logical-layers').getByTestId('hidden-layer')).toHaveCount(1)
})

test('keys pressed while typing in a field stay in the field (D5)', async ({ page }) => {
  await openInDesign(page, APP, 'Beta')
  await drawn(page, 'Beta').click()
  const text = inspector(page).getByRole('textbox', { name: 'Text', exact: true })
  await text.click()
  await text.press('End')
  await page.keyboard.type(' two')

  // ⌘B used to hide the settings and throw this away; ⌘0 hid Layers; D armed Delete.
  await page.keyboard.press('ControlOrMeta+b')
  await page.keyboard.press('ControlOrMeta+0')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('d')
  await expect(text).toHaveValue('Beta twd')
  await expect(page.getByTestId('logical-layers')).toBeVisible()
  await expect(page.getByTestId('device-pane')).toHaveAttribute('data-tool', 'select')

  await page.keyboard.press('Enter')
  await expect(drawn(page, 'Beta twd')).toBeVisible()
})

test('a dropdown keeps its keys, and Tab moves on from it (D5)', async ({ page }) => {
  await openInDesign(page, APP, 'Beta')
  await drawn(page, 'Beta').click()
  const sizing = inspector(page).getByRole('combobox', { name: 'Width sizing', exact: true })
  // Figma's word for a view as big as its content (D2).
  await expect(sizing).toHaveValue('Hug')
  await sizing.focus()

  // Backspace on a dropdown used to delete the view, and WebKit went back a page with it.
  await page.keyboard.press('Backspace')
  await expect(drawn(page, 'Beta')).toBeVisible()
  await expect(sizing).toBeFocused()

  // Tab used to switch the canvas to Preview and keep the focus where it was.
  await page.keyboard.press('Tab')
  await expect(sizing).not.toBeFocused()
  await expect(page.getByTestId('device-pane')).toHaveAttribute('data-tool', 'select')
})

test('⌘S says the work is saved (D5)', async ({ page }) => {
  await openInDesign(page, APP, 'Beta')
  await drawn(page, 'Beta').click()
  await page.keyboard.press('ControlOrMeta+s')
  await expect(note(page)).toHaveText('Saved. Your work also saves as you go.')
})

test('⌘G groups the layers selected together the way they sit, in Figma\'s words (D3)', async ({ page }) => {
  await openInDesign(page, APP, 'Beta')
  const layers = page.getByTestId('logical-layers')
  const row = (text: string) => layers.locator('[data-source-name="Text"]').filter({ hasText: text })

  await row('Gamma').hover()
  await row('Gamma').getByRole('button', { name: /^Actions for / }).click()
  await expect(page.getByRole('option', { name: /^Group in Column/ })).toContainText('⌘G')
  await expect(page.getByRole('option', { name: /^Group in Row/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /^Group in Overlap/ })).toBeVisible()
  await page.keyboard.press('Escape')

  // Escape lets go of layers selected together, as it does of one.
  const group = layers.getByRole('button', { name: 'Group in Column', exact: true })
  await row('Alpha').click()
  await row('Beta').click({ modifiers: ['Shift'] })
  await expect(group).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(group).toHaveCount(0)

  await row('Alpha').click()
  await row('Beta').click({ modifiers: ['Shift'] })
  await expect(group).toBeVisible()
  await page.keyboard.press('ControlOrMeta+g')

  // Into a column with the column's own spacing, so nothing on the canvas moves.
  await expect.poll(() => sourceInCode(page)).toContain('VStack(spacing: 12) {\n            VStack(spacing: 12) {\n                Text("Alpha")\n                Text("Beta")\n            }\n            Text("Gamma")')
})

test('a Row lines its views up with icons, Auto spreads them out, and a view in it says where that is set (D4)', async ({ page }) => {
  await openInDesign(page, APP.replace('VStack(spacing: 12)', 'HStack(spacing: 12)'), 'Beta')
  await drawn(page, 'Beta').click()
  await expect(inspector(page).getByTestId('alignment-hint')).toContainText('Aligned and spaced by its Row.')
  await inspector(page).getByRole('button', { name: 'Select Row', exact: true }).click()

  await expect(inspector(page).getByRole('radiogroup', { name: 'Layout', exact: true }).getByRole('radio', { name: 'Row', exact: true })).toHaveAttribute('aria-checked', 'true')
  const top = inspector(page).getByRole('radiogroup', { name: 'Alignment', exact: true }).getByRole('radio', { name: 'Top', exact: true })
  await top.click()
  await expect(top).toHaveAttribute('aria-checked', 'true')

  const auto = inspector(page).getByRole('button', { name: 'Auto', exact: true })
  await auto.click()
  await expect(auto).toHaveAttribute('aria-pressed', 'true')
  // Measured once the canvas has drawn the spread: while it redraws, a view has no box.
  const gap = async () => {
    const alpha = await drawn(page, 'Alpha').boundingBox(), beta = await drawn(page, 'Beta').boundingBox()
    return alpha && beta ? beta.x - (alpha.x + alpha.width) : 0
  }
  await expect.poll(gap).toBeGreaterThan(60)

  const source = await sourceInCode(page)
  expect(source).toContain('HStack(alignment: .top, spacing: 12) {\n            Text("Alpha")\n            Spacer()\n            Text("Beta")\n            Spacer()\n            Text("Gamma")\n        }.frame(maxWidth: .infinity)')
})
