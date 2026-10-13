import { expect, test } from '@playwright/test'
import { addModifier, cards, expandCard, openInDesign, sourceInCode } from './designer-helpers'

const app = (body: string) => `import SwiftUI
@main struct CardApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
  var body: some View {
    VStack {
${body}
      Text("Other")
    }
  }
}`

const CARD = `      Text("Club")
        .padding()
        .background(Color.white)
        .clipShape(.rect(cornerRadius: 12))`

test('a border follows the card\'s corners, inside the edge or outside it, and is no layer of its own (D8)', async ({ page }) => {
  await openInDesign(page, app(CARD), 'Club')
  const layers = page.getByTestId('logical-layers')
  await layers.getByRole('treeitem', { name: 'Club, Text', exact: true }).click()
  await addModifier(page, 'Border', 'border')
  expect(await sourceInCode(page)).toContain(`${CARD.split('\n').at(-1)}
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Color.gray, lineWidth: 1)
        }`)
  await expandCard(cards(page, 'border'))
  await cards(page, 'border').getByRole('combobox', { name: 'Position', exact: true }).selectOption('outside')
  await expect(cards(page, 'border').getByRole('combobox', { name: 'Position', exact: true })).toHaveValue('outside')
  expect(await sourceInCode(page)).toContain(`        .overlay {
            RoundedRectangle(cornerRadius: 13)
                .strokeBorder(Color.gray, lineWidth: 1)
                .padding(-1)
        }`)
  await expect(layers.getByRole('treeitem', { name: /Rounded rectangle/ })).toHaveCount(0)
  await expect(page.getByTestId('status-view')).not.toContainText('error')
})

test('the canvas says its warnings in plain words, and finds the layer each is on (D11)', async ({ page }) => {
  await openInDesign(page, app(''), 'Other')
  const layers = page.getByTestId('logical-layers')
  await layers.getByRole('treeitem', { name: 'Other, Text', exact: true }).click()
  await page.getByTestId('add-view').click()
  await page.getByTestId('add-view-search').fill('link')
  await page.getByTestId('add-view-link').click()
  const warnings = page.getByTestId('design-warnings')
  await expect(warnings).toHaveText('1 warning')
  await expect(page.getByTestId('status-view')).toHaveText('Editing')
  await warnings.click()
  const list = page.getByRole('dialog', { name: 'Warnings', exact: true })
  await expect(list).toContainText('Only the preview differs')
  await expect(list).toContainText('Tapping it opens nothing in the preview. In the app it opens the link.')
  await layers.getByRole('treeitem', { name: 'Other, Text', exact: true }).click()
  await warnings.click()
  await list.getByRole('button', { name: 'Find layer', exact: true }).click()
  await expect(list).toHaveCount(0)
  await expect(layers.locator('[aria-selected="true"]')).toHaveAccessibleName('Link')
})

test('Find layer goes to the screen a warning is on (D11)', async ({ page }) => {
  await openInDesign(page, `import SwiftUI
@main struct CardApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }
struct HomeScreen: View {
  var body: some View {
    NavigationStack {
      VStack {
        Text("Welcome")
        NavigationLink("Help") { HelpScreen() }
      }
      .navigationTitle("Home")
    }
  }
}
struct HelpScreen: View {
  var body: some View {
    VStack {
      Text("Questions")
      Link("Contact", destination: URL(string: "https://example.com")!)
    }
    .navigationTitle("Help")
  }
}`, 'Welcome')
  await page.getByTestId('design-warnings').click()
  const list = page.getByRole('dialog', { name: 'Warnings', exact: true })
  await expect(list).toContainText('Help · Contact')
  await list.getByRole('button', { name: 'Find layer', exact: true }).click()
  await expect(page.getByTestId('logical-layers').locator('[aria-selected="true"]')).toHaveAccessibleName('Contact, Link')
})

test('the warnings list is whole over the panes around the canvas, however short the canvas (D11)', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 560 })
  const links = Array.from({ length: 8 }, (_, i) => `      Link("Help ${i + 1}", destination: URL(string: "https://example.com")!)`).join('\n')
  await openInDesign(page, app(links), 'Other')
  // Problems and output, under the canvas, leave it short.
  await page.getByTestId('workspace-more').click()
  await page.getByTestId('workspace-more-menu-problems').click()
  await expect(page.getByTestId('console')).toBeVisible()
  await page.getByTestId('design-warnings').click()
  await expect(page.getByRole('dialog', { name: 'Warnings', exact: true })).toBeInViewport({ ratio: 1 })
})
