import { expect, test, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * Reuse across screens (D6), refusals that say why (C7), the Swift Design writes (D9)
 * and what the preview says of a view it cannot draw (D12), in Chrome and Safari alike.
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

const drawn = (page: Page, text: string) => page.getByTestId('render-tree').getByText(text, { exact: true })
/** What the design dock says after an edit, a copy or a refusal. */
const note = (page: Page) => page.getByTestId('design-feedback')
const inspector = (page: Page) => page.getByTestId('authoring-inspector')

/** A menu's Copy or Paste, whose name carries its shortcut: "Copy ⌘C". */
const clipboardOption = (page: Page, action: 'Copy' | 'Paste') => page.getByRole('option', { name: new RegExp(`^${action}`) })

async function viewAction(page: Page, action: 'Copy' | 'Paste') {
  await inspector(page).getByRole('button', { name: 'View actions', exact: true }).click()
  await clipboardOption(page, action).click()
}

test('a view pasted onto another screen brings the value it reads (D6)', async ({ page }) => {
  await openInDesign(page, app(), 'Settings body')
  await drawn(page, 'Count 3').click()
  await page.keyboard.press('ControlOrMeta+c')
  await expect(note(page)).toContainText('Copied')

  await drawn(page, 'Settings body').click()
  await page.keyboard.press('ControlOrMeta+v')

  await expect(drawn(page, 'Count 3')).toHaveCount(2)
  expect(await sourceInCode(page)).toContain('struct SettingsScreen: View {\n    @State private var count = 3')
})

test('Copy and Paste are in the settings panel\'s view menu and a layer\'s menu too (D6)', async ({ page }) => {
  await openInDesign(page, app(), 'Settings body')
  await drawn(page, 'Count 3').click()
  await viewAction(page, 'Copy')
  await expect(note(page)).toContainText('Copied')

  await drawn(page, 'Settings body').click()
  await viewAction(page, 'Paste')
  await expect(drawn(page, 'Count 3')).toHaveCount(2)

  const row = page.getByTestId('logical-layers').locator('[data-source-name="Text"]').filter({ hasText: 'Settings body' })
  await row.hover()
  await row.getByRole('button', { name: /^Actions for / }).click()
  await clipboardOption(page, 'Paste').click()
  await expect(drawn(page, 'Count 3')).toHaveCount(3)
})

test('a paste with nothing copied, and a move past the first view, say why (C7)', async ({ page }) => {
  await openInDesign(page, app(), 'Settings body')
  await drawn(page, 'Count 3').click()

  await page.keyboard.press('ControlOrMeta+v')
  await expect(note(page)).toHaveText('Nothing copied yet. Select a view and press ⌘C first.')

  await page.keyboard.press('Alt+ArrowUp')
  await expect(note(page)).toHaveText('This is already the first view here.')
})

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
