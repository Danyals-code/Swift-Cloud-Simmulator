import { expect, test, type Page } from '@playwright/test'
import { openInDesign } from './designer-helpers'

/**
 * A designer's habits from Figma, in Chrome and Safari alike: the keys (D5) and the
 * words for sizing (D2).
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
