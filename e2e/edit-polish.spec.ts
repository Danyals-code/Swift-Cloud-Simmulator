import { expect, test, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * The Swift Design writes (D9) and what the preview says of a view it cannot draw
 * (D12), in Chrome and Safari alike.
 */

/** Home, which shows a count and pushes Settings, with `declarations` after them. */
const app = (declarations = '', home = '') => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { HomeScreen() }
    }
}

struct HomeScreen: View {
    @State private var count = 3
    var body: some View {
        NavigationStack {
            VStack {
                Text("Count \\(count)")
                NavigationLink("Settings") { SettingsScreen() }${home}
            }
            .navigationTitle("Home")
        }
    }
}

struct SettingsScreen: View {
    var body: some View {
        VStack {
            Text("Settings body")
        }
        .navigationTitle("Settings")
    }
}
${declarations}`

const inspector = (page: Page) => page.getByTestId('authoring-inspector')

test('a screen\'s Text color override is written as current SwiftUI writes it (D9)', async ({ page }) => {
  await openInDesign(page, app(), 'Settings body')
  await page.getByTestId('design-screen').first().locator('[data-outline-row]').click()
  await page.getByTestId('screen-settings').getByText('Text color', { exact: true }).locator('xpath=..').getByRole('button', { name: 'From App · Override', exact: true }).click()

  await expect.poll(() => sourceInCode(page)).toContain('.foregroundStyle(Color.primary)')
})

test('a view the preview cannot draw says so, on the canvas and in its settings (D12)', async ({ page }) => {
  await openInDesign(page, app('', '\n                EditButton()'), 'Settings body')
  const placeholder = page.getByTestId('render-tree').locator('[data-kind="placeholder"]')
  await expect(placeholder).toContainText('Edit button')
  await expect(placeholder).toContainText('Not drawn in the preview yet. Xcode draws it as written.')

  await placeholder.click()
  await expect(inspector(page).getByTestId('locked-block')).toContainText('The preview doesn’t draw it yet')
})
