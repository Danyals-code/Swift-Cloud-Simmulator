import { expect, test, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * Tappable cards and rows (D16), in Chrome and Safari alike: any view can be given a
 * tap, in one step from When tapped or from its layer's menu, and keeps its look.
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
            .padding()
        }
    }
}
`

const drawn = (page: Page, text: string) => page.getByTestId('render-tree').getByText(text, { exact: true })
const inspector = (page: Page) => page.getByTestId('authoring-inspector')

test('a card pushes a new screen when tapped, set up in one step (D16)', async ({ page }) => {
  await openInDesign(page, APP, 'Mia')
  await drawn(page, 'Mia').click()
  // Folded away on a view that takes no tap yet.
  await inspector(page).getByTestId('when-tapped').locator('summary').click()
  await expect(inspector(page)).toContainText('Choosing what a tap does makes it tappable')
  await inspector(page).getByRole('combobox', { name: 'On tap', exact: true }).selectOption('navigate')
  await inspector(page).getByRole('textbox', { name: 'Interaction screen name', exact: true }).fill('Member')
  await inspector(page).getByRole('button', { name: 'Save', exact: true }).click()

  // The card stays selected, and says where it goes.
  await expect(inspector(page).getByTestId('navigate-to')).toContainText('Navigate to · Push')
  const source = await sourceInCode(page)
  expect(source).toContain(`NavigationLink { MemberScreen() } label: {
                    VStack(alignment: .leading) {
                        Text("Mia")
                        Text("Designer")
                    }
                    .padding()
                }
                .buttonStyle(.plain)`)

  await page.getByTestId('live-toggle').click()
  await page.getByTestId('render-tree').getByRole('button', { name: /^Mia/ }).first().click()
  await expect(page.getByTestId('render-tree').getByText('Member', { exact: true }).first()).toBeVisible()
})

test('Make tappable in a layer\'s menu writes a Button that keeps the view\'s look (D16)', async ({ page }) => {
  await openInDesign(page, APP, 'Mia')
  const card = page.getByTestId('logical-layers').locator('[data-source-name="VStack"]').nth(1)
  await card.click()
  await card.getByTestId('source-layer-actions').click()
  await page.getByTestId('source-layer-actions-menu-tappable').click()
  await expect(inspector(page).locator('header strong')).toHaveText('Button')
  await expect(inspector(page)).toContainText('Now: Nothing yet')
  expect(await sourceInCode(page)).toContain(`            Button {
            } label: {
                VStack(alignment: .leading) {`)
  // The screen itself cannot be tapped as a whole, and says so.
  const screen = page.getByTestId('logical-layers').locator('[data-source-name="VStack"]').first()
  await screen.click()
  await screen.getByTestId('source-layer-actions').click()
  await expect(page.getByTestId('source-layer-actions-menu-tappable')).toBeDisabled()
})
