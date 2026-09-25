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
