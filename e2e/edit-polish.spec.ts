import { expect, test } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * The Swift Design writes (D9), in Chrome and Safari alike.
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

test('a screen\'s Text color override is written as current SwiftUI writes it (D9)', async ({ page }) => {
  await openInDesign(page, app(), 'Settings body')
  await page.getByTestId('design-screen').first().locator('[data-outline-row]').click()
  await page.getByTestId('screen-settings').getByText('Text color', { exact: true }).locator('xpath=..').getByRole('button', { name: 'From App · Override', exact: true }).click()

  await expect.poll(() => sourceInCode(page)).toContain('.foregroundStyle(Color.primary)')
})
