import { expect, test, type Page } from '@playwright/test'
import { openCounter, replaceSource } from './designer-helpers'

/**
 * What Design writes and shows for the behaviours designers build (D13), in Chrome and
 * Safari alike.
 */

/** A one-file app whose `ContentView` has `body`, with `declarations` after it. */
const app = (body: string, declarations = '') => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
    var body: some View {
${body}
    }
}
${declarations}`

/** Opens the studio on `source`, back in Design once it is drawn. */
async function openSource(page: Page, source: string, drawn: string) {
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  await replaceSource(page, source)
  await page.getByTestId('workspace-design').click()
  await expect(page.getByTestId('render-tree').getByText(drawn, { exact: true }).first()).toBeVisible()
  await expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
}

const currentSource = async (page: Page) => {
  await page.getByTestId('workspace-develop').click()
  const text = await page.getByTestId('editor').locator('.cm-content').innerText()
  await page.getByTestId('workspace-design').click()
  return text
}

test('a toggle added from the library switches in the preview at once (D13)', async ({ page }) => {
  await openSource(page, app('        VStack {\n            Text("Settings")\n        }'), 'Settings')
  await page.getByTestId('render-tree').getByText('Settings', { exact: true }).click()
  await page.getByTestId('add-view').click()
  await page.getByTestId('add-view-search').fill('toggle')
  await page.getByTestId('add-view-toggle').click()
  await expect.poll(() => currentSource(page)).toContain('Toggle("Toggle", isOn: $isOn)')
  expect(await currentSource(page)).toContain('@State private var isOn: Bool = true')

  await page.getByTestId('live-toggle').click()
  const toggle = page.getByTestId('render-tree').getByRole('switch', { name: 'Toggle', exact: true })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
})
