import { expect, test, type Page } from '@playwright/test'
import { addModifier, cards, expandCard, openInDesign, sourceInCode } from './designer-helpers'

/**
 * Reaching the code people write (doc 18, Wave 3a), in Chrome and Safari alike: the words
 * of a text with values in it are typed in Design while each value stays as written, and
 * a view carrying everyday Apple modifiers keeps its Add list and its layer sections.
 */

const APP = `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { HomeScreen() }
    }
}

struct HomeScreen: View {
    @State private var count = 3
    @State private var limit = 5
    var body: some View {
        VStack(spacing: 12) {
            Text("Total: \\(count) of \\(limit)")
            Text("Tap me")
                .contentShape(Rectangle())
                .onTapGesture { count += 1 }
        }
    }
}
`

const drawn = (page: Page, text: string) => page.getByTestId('render-tree').getByText(text, { exact: true })
const basics = (page: Page) => page.getByTestId('settings-basics')
const idle = (page: Page) => expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')

test('the words of a text with values in it change, and the values stay as written', async ({ page }) => {
  await openInDesign(page, APP, 'Total: 3 of 5')
  await drawn(page, 'Total: 3 of 5').click()
  const words = basics(page).getByRole('group', { name: 'Text', exact: true })
  await expect(words).toBeVisible()
  // Each value is a chip showing its Swift, with nothing to type in it.
  await expect(words.getByText('count', { exact: true })).toBeVisible()
  await expect(words.getByText('limit', { exact: true })).toBeVisible()
  await expect(words.getByRole('textbox')).toHaveCount(3)

  const first = words.getByRole('textbox', { name: 'Text before count', exact: true })
  await expect(first).toHaveValue('Total: ')
  await first.fill('Cancelled ')
  await first.press('Escape')
  await expect(first).toHaveValue('Total: ')

  await first.fill('Sum "so far": ')
  await words.getByRole('textbox', { name: 'Text between count and limit', exact: true }).fill(' / ')
  await words.getByRole('textbox', { name: 'Text after limit', exact: true }).press('Enter')
  await expect(drawn(page, 'Sum "so far": 3 / 5')).toBeVisible()
  await idle(page)
  expect(await sourceInCode(page)).toContain('Text("Sum \\"so far\\": \\(count) / \\(limit)")')
})

test('a view with Apple modifiers the preview does not draw keeps its Add list and its layer', async ({ page }) => {
  await openInDesign(page, APP, 'Tap me')
  // On the canvas a tap goes to the view's own action, so it is chosen in Layers.
  await page.getByTestId('logical-layers').locator('[data-source-name="Text"]').filter({ hasText: 'Tap me' }).click()
  await expect(page.getByTestId('authoring-inspector').locator('header strong')).toHaveText('Tap me')
  await expandCard(cards(page, 'contentShape'))
  await expect(cards(page, 'contentShape')).toContainText('Not drawn in the preview')
  await expect(cards(page, 'contentShape')).not.toContainText('A custom modifier from your code.')

  await addModifier(page, 'Opacity', 'opacity')
  await idle(page)
  expect(await sourceInCode(page)).toContain('Text("Tap me")\n                .opacity(1)\n                .contentShape(Rectangle())\n                .onTapGesture { count += 1 }')

  const padding = page.getByTestId('authoring-inspector').getByTestId('layer-layout').getByRole('textbox', { name: 'Padding, all sides', exact: true })
  await padding.fill('8')
  await padding.press('Enter')
  await idle(page)
  expect(await sourceInCode(page)).toContain('Text("Tap me")\n                .padding(8)\n                .opacity(1)\n                .contentShape(Rectangle())')
})
