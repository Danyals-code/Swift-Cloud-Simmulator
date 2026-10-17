import { expect, test, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * Symbols (Wave 6b), in Chrome and Safari alike: everyday SF Symbols that drew a question
 * mark now draw a look-alike, the symbol picker searches the larger set and shows it by
 * category, and a symbol's Rendering and Filled write their Swift and redraw the canvas.
 */

const app = (body: string) => `import SwiftUI

@main
struct SymbolsApp: App {
    var body: some Scene {
        WindowGroup { HomeScreen() }
    }
}

struct HomeScreen: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Symbols")
${body}
        }
    }
}
`

const tree = (page: Page) => page.getByTestId('render-tree')
const basics = (page: Page) => page.getByTestId('settings-basics')
const idle = (page: Page) => expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
/** A symbol on the canvas by its name, as the image's title gives it: "heart (Ionicons approximation)". */
const drawnSymbol = (page: Page, name: string) => tree(page).locator(`[data-kind="image"] [title^="${name} ("]`)

/** Problems and output under the canvas, which Design keeps behind More. */
async function openProblems(page: Page) {
  if (!(await page.getByTestId('splitter-debug-area-height').count())) {
    await page.getByTestId('workspace-more').click()
    await page.getByTestId('workspace-more-menu-problems').click()
  }
  await expect(page.getByTestId('console')).toBeVisible()
}

test('everyday symbols that drew a question mark draw a look-alike, with no warning in Problems', async ({ page }) => {
  const names = ['person.crop.circle', 'chevron.forward', 'message', 'phone', 'mappin', 'fork.knife', 'checklist', 'trophy']
  await openInDesign(page, app(names.map(name => `            Image(systemName: "${name}")`).join('\n')), 'Symbols')
  for (const name of names) {
    const symbol = drawnSymbol(page, name)
    await expect(symbol, name).toBeVisible()
    await expect(symbol, name).toHaveAttribute('title', /approximation\)$/)
  }
  await expect(tree(page).locator('[data-kind="image"] [title$="(unsupported symbol)"]')).toHaveCount(0)
  await openProblems(page)
  await expect(page.getByTestId('console')).not.toContainText('question mark')
})

test('the symbol picker searches every symbol the preview draws, and shows one category at a time', async ({ page }) => {
  await openInDesign(page, app(`            Image(systemName: "star")`), 'Symbols')
  await drawnSymbol(page, 'star').click()
  await idle(page)
  await basics(page).getByText('Choose a symbol', { exact: true }).click()
  const search = basics(page).getByLabel('Search symbols', { exact: true })
  const category = basics(page).getByRole('combobox', { name: 'Symbol category', exact: true })

  // Words match the start of each part of a name, and an everyday word finds its symbol.
  await search.fill('fork')
  await expect(basics(page).getByRole('button', { name: 'Use symbol fork.knife', exact: true })).toBeVisible()
  await search.fill('settings')
  await expect(basics(page).getByRole('button', { name: 'Use symbol gearshape', exact: true })).toBeVisible()

  // A category shows its own symbols only.
  await search.fill('')
  await category.selectOption('Weather & Nature')
  await expect(basics(page).getByRole('button', { name: 'Use symbol snowflake', exact: true })).toBeVisible()
  await expect(basics(page).getByRole('button', { name: 'Use symbol house', exact: true })).toHaveCount(0)
  // And a search within it stays within it.
  await search.fill('circle')
  await expect(basics(page).getByRole('button', { name: 'Use symbol person.circle', exact: true })).toHaveCount(0)

  // Choosing one writes it and draws it.
  await search.fill('')
  await basics(page).getByRole('button', { name: 'Use symbol snowflake', exact: true }).click()
  await expect(drawnSymbol(page, 'snowflake')).toBeVisible()
  await idle(page)
  expect(await sourceInCode(page)).toContain('Image(systemName: "snowflake")')
})

test('Filled writes .symbolVariant(.fill) and draws the filled symbol; switched off, it removes it', async ({ page }) => {
  await openInDesign(page, app(`            Image(systemName: "heart")`), 'Symbols')
  await drawnSymbol(page, 'heart').click()
  await idle(page)
  const fill = basics(page).getByRole('switch', { name: 'Filled', exact: true })
  await expect(fill).toHaveAttribute('aria-checked', 'false')
  await fill.click()
  await expect(drawnSymbol(page, 'heart.fill')).toBeVisible()
  await idle(page)
  expect(await sourceInCode(page)).toContain('.symbolVariant(.fill)')

  await drawnSymbol(page, 'heart.fill').click()
  await idle(page)
  await expect(basics(page).getByRole('switch', { name: 'Filled', exact: true })).toHaveAttribute('aria-checked', 'true')
  await basics(page).getByRole('switch', { name: 'Filled', exact: true }).click()
  await expect(drawnSymbol(page, 'heart')).toBeVisible()
  await idle(page)
  expect(await sourceInCode(page)).not.toContain('symbolVariant')
})

test('Rendering writes .symbolRenderingMode, Palette with its two colours, and the canvas draws the layers', async ({ page }) => {
  await openInDesign(page, app(`            Image(systemName: "checkmark.circle.fill")
                .font(.largeTitle)
                .foregroundStyle(.blue)
            Image(systemName: "heart.fill")`), 'Symbols')
  const symbol = drawnSymbol(page, 'checkmark.circle.fill')
  /** The drawing's mode, which a monochrome symbol doesn't name. */
  const mode = symbol.locator('svg[data-symbol-mode]')
  await expect(mode).toHaveCount(0)
  await symbol.click()
  await idle(page)
  const rendering = basics(page).getByRole('combobox', { name: 'Rendering', exact: true })
  await expect(rendering).toHaveValue('Automatic')

  // Hierarchical paints the disc as a second layer, in the glyph's colour at a lower opacity.
  await rendering.selectOption('Hierarchical')
  await expect(mode).toHaveAttribute('data-symbol-mode', 'hierarchical')
  await idle(page)
  expect(await sourceInCode(page)).toContain('.symbolRenderingMode(.hierarchical)')

  // Palette writes its two colours, and paints the disc in the second.
  await symbol.click()
  await idle(page)
  await basics(page).getByRole('combobox', { name: 'Rendering', exact: true }).selectOption('Palette')
  await expect(mode).toHaveAttribute('data-symbol-mode', 'palette')
  await idle(page)
  const palette = await sourceInCode(page)
  expect(palette).toContain('.symbolRenderingMode(.palette)')
  expect(palette).toMatch(/\.foregroundStyle\(\.blue, [^,()]+\)/)
  await symbol.click()
  await idle(page)
  await basics(page).getByRole('combobox', { name: 'Secondary color', exact: true }).selectOption('red')
  await expect.poll(() => mode.evaluate(svg => getComputedStyle(svg).getPropertyValue('--symbol-3').trim())).toMatch(/^rgb\(255 56 60/)
  await idle(page)

  // Automatic is iOS's own choice: nothing written, and one colour again.
  await basics(page).getByRole('combobox', { name: 'Rendering', exact: true }).selectOption('Automatic')
  await expect(mode).toHaveCount(0)
  await idle(page)
  expect(await sourceInCode(page)).not.toContain('symbolRenderingMode')

  // Multicolor draws a heart in its own red, whatever the foreground.
  const heart = drawnSymbol(page, 'heart.fill')
  await heart.click()
  await idle(page)
  await basics(page).getByRole('combobox', { name: 'Rendering', exact: true }).selectOption('Multicolor')
  await expect(heart.locator('svg[data-symbol-mode]')).toHaveAttribute('data-symbol-mode', 'multicolor')
  await expect(heart).toHaveCSS('color', 'rgb(255, 56, 60)')
  await idle(page)
  expect(await sourceInCode(page)).toContain('.symbolRenderingMode(.multicolor)')
})
