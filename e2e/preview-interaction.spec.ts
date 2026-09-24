import { expect, test, type Page } from '@playwright/test'
import { openCounter, replaceSource } from './designer-helpers'

/** An app whose `ContentView` has these members. */
const app = (members: string) => `import SwiftUI
@main struct CounterApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
${members}
}`

/** Opens the studio on `source` in Code, drawn, with the preview live. */
async function openSource(page: Page, source: string, drawn: string) {
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  await replaceSource(page, source)
  await expect(page.getByTestId('render-tree').getByText(drawn).first()).toBeVisible()
  await page.getByTestId('live-toggle').click()
}

test('the preview draws text it measures on the page in a browser without Intl.Segmenter (F8)', async ({ page }) => {
  // Firefox 115-124 has no Intl.Segmenter.
  await page.addInitScript(() => { delete (Intl as { Segmenter?: unknown }).Segmenter })
  await openSource(page, app('  var body: some View { VStack { Text("Tracked").tracking(2); Text("Digits 0123").monospacedDigit() } }'), 'Tracked')
  await expect(page.getByTestId('render-tree').getByText('Digits 0123')).toBeVisible()
  await expect(page.getByText('Preview stopped')).toHaveCount(0)
  // The hidden span it measures with is removed again.
  expect(await page.evaluate(() => [...document.body.children].filter((el) => el instanceof HTMLSpanElement && el.style.left === '-100000px').length)).toBe(0)
})
