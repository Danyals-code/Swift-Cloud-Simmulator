import { expect, test, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * Selecting on the canvas as Figma does (D1), in Chrome and Safari alike: a click selects
 * what sits in the screen's stack, a whole card; a double-click goes in, or edits text;
 * Escape comes back out; ⌘ reaches the innermost view and Shift adds to the selection.
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
            Text("Club")
            VStack(alignment: .leading) {
                Text("Mia")
                Text("Designer")
            }
            VStack(alignment: .leading) {
                Text("Leo")
                Text("Engineer")
            }
            Badge(title: "New")
        }
    }
}

struct Badge: View {
    let title: String
    var body: some View {
        Text(title)
            .padding(8)
    }
}
`

const drawn = (page: Page, text: string) => page.getByTestId('render-tree').getByText(text, { exact: true })
const inspector = (page: Page) => page.getByTestId('authoring-inspector')
const layers = (page: Page) => page.getByTestId('logical-layers')
const selectedRows = (page: Page) => layers(page).locator('[role="treeitem"][aria-selected="true"]')
/** The selected view's name, as the settings panel heads it. */
const selectedName = (page: Page) => inspector(page).locator('header strong')

test('a click selects a whole card, a double-click goes in, and Escape comes back out (D1)', async ({ page }) => {
  await openInDesign(page, APP, 'Mia')
  await drawn(page, 'Mia').click()
  await expect(selectedName(page)).toHaveText('Column')
  await expect(selectedRows(page)).toHaveCount(1)
  const card = Number(await selectedRows(page).getAttribute('aria-level'))
  // One box around the card, not one for each line in it.
  await expect(page.getByTestId('selection-outline')).toHaveCount(1)

  // Text is edited where it is, as it always was, and is then the selection.
  await drawn(page, 'Designer').dblclick()
  const editor = page.getByRole('textbox', { name: 'Canvas text', exact: true })
  await expect(editor).toHaveValue('Designer')
  await editor.press('Escape')
  await expect(selectedName(page)).toHaveText('Designer')

  // Inside the card, a click selects at that depth; outside it, whole cards again.
  await drawn(page, 'Mia').click()
  await expect(selectedName(page)).toHaveText('Mia')
  await drawn(page, 'Leo').click()
  await expect(selectedName(page)).toHaveText('Column')
  await expect(inspector(page).getByTestId('alignment-hint')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect.poll(async () => Number(await selectedRows(page).getAttribute('aria-level'))).toBe(card - 1)
  await page.keyboard.press('Escape')
  await expect(selectedRows(page)).toHaveCount(0)
})

test('⌘ reaches the innermost view, and Shift adds cards to group with ⌘G (D1)', async ({ page }) => {
  await openInDesign(page, APP, 'Mia')
  await drawn(page, 'Mia').click({ modifiers: ['ControlOrMeta'] })
  await expect(selectedName(page)).toHaveText('Mia')

  await drawn(page, 'Club').click()
  await drawn(page, 'Mia').click()
  await expect(selectedName(page)).toHaveText('Column')
  await drawn(page, 'Leo').click({ modifiers: ['Shift'] })
  await expect(layers(page)).toContainText('2 layers selected')
  await expect(page.getByTestId('selection-outline')).toHaveCount(2)

  await page.keyboard.press('ControlOrMeta+g')
  await expect(page.getByTestId('design-undo')).toBeEnabled()
  expect(await sourceInCode(page)).toContain(`        VStack(spacing: 12) {
            Text("Club")
            VStack(spacing: 12) {
                VStack(alignment: .leading) {
                    Text("Mia")
                    Text("Designer")
                }
                VStack(alignment: .leading) {
                    Text("Leo")
                    Text("Engineer")
                }
            }`)
})

test('a copy of a component is selected whole, and Delete takes out that copy, not its Main (D1)', async ({ page }) => {
  await openInDesign(page, APP, 'New')
  await drawn(page, 'New').click()
  await expect(selectedName(page)).toHaveText('Badge')
  await page.keyboard.press('Backspace')
  await expect(drawn(page, 'New')).toHaveCount(0)
  const source = await sourceInCode(page)
  expect(source).not.toContain('Badge(title: "New")')
  expect(source).toContain(`    var body: some View {
        Text(title)
            .padding(8)
    }`)
})

test('a card drags as a whole card, and lands beside another (D1)', async ({ page }) => {
  await openInDesign(page, APP, 'Leo')
  const from = (await drawn(page, 'Engineer').boundingBox())!
  const to = (await drawn(page, 'Mia').boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + 2, { steps: 6 })
  await expect(page.getByText('Drop before Column', { exact: true })).toBeVisible()
  await page.mouse.up()
  await expect(page.getByTestId('design-undo')).toBeEnabled()
  expect(await sourceInCode(page)).toContain(`            Text("Club")
            VStack(alignment: .leading) {
                Text("Leo")
                Text("Engineer")
            }
            VStack(alignment: .leading) {
                Text("Mia")`)
})

test('a narrow window selects the same way, with Layers over the canvas closed (D1)', async ({ page }) => {
  // Half of a laptop screen, as with the instructions tiled beside the studio.
  await page.setViewportSize({ width: 760, height: 700 })
  await openInDesign(page, APP, 'Mia')
  await drawn(page, 'Mia').click()
  await expect(selectedName(page)).toHaveText('Column')
  await expect(page.getByTestId('layers-over')).toHaveCount(0)
  await drawn(page, 'Mia').dblclick()
  await page.getByRole('textbox', { name: 'Canvas text', exact: true }).press('Escape')
  await expect(selectedName(page)).toHaveText('Mia')
  await page.keyboard.press('Escape')
  await expect(selectedName(page)).toHaveText('Column')
})
