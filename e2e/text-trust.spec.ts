import { expect, test, type Locator, type Page } from '@playwright/test'
import { openInDesign } from './designer-helpers'

/**
 * Text and trust (Wave 6a), in Chrome and Safari alike: Markdown in a literal title is
 * drawn formatted, an AttributedString or a symbol variant chain no longer stops the
 * screen, an image among a Text's words is drawn inline, a gradient masked by a Text is
 * gradient text, and a font iOS ships draws without a warning.
 */

const app = (body: string, extra = '') => `import SwiftUI

@main
struct TextApp: App {
    var body: some Scene {
        WindowGroup { HomeScreen() }
    }
}

struct HomeScreen: View {
${extra}    var body: some View {
        VStack(spacing: 12) {
            Text("Notes")
${body}
        }
    }
}
`

const tree = (page: Page) => page.getByTestId('render-tree')
/** A Text on the canvas by the words it draws, which hold no Markdown marks and no "View". */
const drawnText = (page: Page, words: string | RegExp) => tree(page).locator('[data-kind="text"]').filter({ hasText: words })
const basics = (page: Page) => page.getByTestId('settings-basics')
const idle = (page: Page) => expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')

/** The screen is drawn from this source: not the last drawing kept, dimmed, behind an error, and nothing stopped. */
async function notStopped(page: Page) {
  await expect(page.getByTestId('stopped-by')).toHaveCount(0)
  await expect(tree(page).getByText(/stopped/)).toHaveCount(0)
}

/** Problems and output under the canvas, which Design keeps behind More. */
async function openProblems(page: Page) {
  if (!(await page.getByTestId('splitter-debug-area-height').count())) {
    await page.getByTestId('workspace-more').click()
    await page.getByTestId('workspace-more-menu-problems').click()
  }
  await expect(page.getByTestId('console')).toBeVisible()
}

/** Whether the element or a run inside it paints a gradient through its letters. */
const paintsGradientText = (text: Locator) => text.evaluate(element => [element, ...element.querySelectorAll('*')].some(part => {
  const style = getComputedStyle(part)
  const clip = style.backgroundClip === 'text' || style.getPropertyValue('-webkit-background-clip') === 'text'
  return clip && style.backgroundImage.includes('linear-gradient')
}))

/**
 * Whether an inline symbol is painted: its glyph fills or strokes with a paint that shows (a
 * gradient, or a colour that isn't fully transparent), or a gradient shows through its shape
 * as a mask. Under a gradient the words' colour is transparent so the gradient can show
 * through them, and a glyph left in that colour vanishes.
 */
const paintsSymbol = (symbol: Locator) => symbol.evaluate(span => {
  const shows = (paint: string) => {
    if (paint.startsWith('url(')) return true
    const channels = /^rgba?\(([^)]*)\)$/.exec(paint)?.[1]?.split(/[\s,/]+/).filter(Boolean)
    return !!channels && (channels.length < 4 || Number(channels[3]) > 0)
  }
  const glyph = [...span.querySelectorAll('svg, svg *')].filter(part => !part.closest('defs, mask'))
  if (glyph.some(part => { const style = getComputedStyle(part); return shows(style.fill) || shows(style.stroke) })) return true
  return [span, ...span.querySelectorAll('*')].some(part => {
    const style = getComputedStyle(part)
    const masked = [style.getPropertyValue('mask-image'), style.getPropertyValue('-webkit-mask-image')].some(mask => mask && mask !== 'none')
    return masked && style.backgroundImage.includes('gradient')
  })
})

test('Markdown in a literal Text is drawn bold and as a link in Preview, and its field keeps the marks as written', async ({ page }) => {
  await openInDesign(page, app(`            Text("**Bold** and a [link](https://apple.com)")
            Text(verbatim: "**raw**")`), 'Notes')
  const markdown = drawnText(page, 'Bold and a link')
  await expect(markdown).toHaveText('Bold and a link')
  await expect(markdown).not.toContainText('**')
  await expect(markdown).not.toContainText('](')
  // Text(verbatim:) is never Markdown, as on iOS.
  await expect(tree(page).getByText('**raw**', { exact: true })).toBeVisible()

  // The field holds what the code writes, and says the canvas draws it formatted.
  await markdown.click()
  await expect(basics(page).locator('[data-control-id="content"]')).toHaveValue('**Bold** and a [link](https://apple.com)')
  await expect(basics(page)).toContainText('Drawn as Markdown')

  // Previewing, the same button is Stop preview, under its own test id.
  await page.getByTestId('live-toggle').click()
  await expect(page.getByTestId('inspect-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(markdown.getByText('Bold', { exact: true })).toHaveCSS('font-weight', '700')
  // A link is drawn in the accent colour, as iOS draws it.
  await expect(markdown.getByText('link', { exact: true })).toHaveCSS('color', 'rgb(0, 136, 255)')
  await notStopped(page)
})

test('a screen with an AttributedString no longer blanks: it is drawn, with its runs', async ({ page }) => {
  await openInDesign(page, app(`            Text(greeting)
            Text((try? AttributedString(markdown: "Read the **guide**")) ?? AttributedString("Read the guide"))
            Text("Below")`, `    private var greeting: AttributedString {
        var text = AttributedString("Welcome back")
        text.foregroundColor = .blue
        return text
    }
`), 'Welcome back')
  await notStopped(page)
  await expect(tree(page).getByText('Below', { exact: true })).toBeVisible()
  const guide = drawnText(page, 'Read the guide')
  await expect(guide).toHaveText('Read the guide')
  await expect(guide.getByText('guide', { exact: true })).toHaveCSS('font-weight', '700')
})

test('a symbol among a Text’s words is drawn inline, never as "View", and its chip reads as the symbol', async ({ page }) => {
  await openInDesign(page, app(`            Text("Rated \\(Image(systemName: "star.fill")) 4.8")
            Text(Image(systemName: "heart.fill")) + Text(" Favourites")`), 'Notes')
  const rated = drawnText(page, /Rated/)
  await expect(rated.locator('[data-symbol="star.fill"]')).toBeVisible()
  await expect(rated).not.toContainText('View')
  const favourites = drawnText(page, /Favourites/)
  await expect(favourites.locator('[data-symbol="heart.fill"]')).toBeVisible()
  await idle(page)

  // In Design the words stay editable, and the image is a chip by its name. The Text is
  // chosen in Layers, the one Text row named for neither of the others' words.
  await page.getByTestId('logical-layers').locator('[data-source-name="Text"]').filter({ hasNotText: /Notes|Favourites/ }).click()
  const words = basics(page).getByRole('group', { name: 'Text', exact: true })
  await expect(words.getByText('star.fill', { exact: true })).toBeVisible()
  await expect(words).not.toContainText('Image(systemName:')
  await expect(words.getByRole('textbox', { name: 'Text before star.fill', exact: true })).toHaveValue('Rated ')
})

test('.symbolVariant(.fill.circle) no longer stops the screen: it draws the variant symbol', async ({ page }) => {
  await openInDesign(page, app(`            Image(systemName: "star")
                .symbolVariant(.fill.circle)
            Text("After the symbol")`), 'After the symbol')
  await notStopped(page)
  await expect(tree(page).locator('[data-kind="image"] [title^="star.circle.fill ("]')).toBeVisible()
})

test('a gradient masked by a Text is drawn as gradient text, not a gradient rectangle', async ({ page }) => {
  await openInDesign(page, app(`            LinearGradient(colors: [.pink, .orange], startPoint: .leading, endPoint: .trailing)
                .frame(height: 60)
                .mask(Text("Gradient").font(.largeTitle.bold()))`), 'Notes')
  const gradient = drawnText(page, /^Gradient$/)
  await expect(gradient).toBeVisible()
  await expect.poll(() => paintsGradientText(gradient)).toBe(true)
  await notStopped(page)
})

test('a font iOS ships, Avenir Next, draws with no warning in Problems; an unknown family still warns', async ({ page }) => {
  await openInDesign(page, app(`            Text("Avenir")
                .font(.custom("Avenir Next", size: 22))
            Text("Brand")
                .font(.custom("BrandSans", size: 22))`), 'Avenir')
  await expect(tree(page).getByText('Avenir', { exact: true })).toHaveCSS('font-family', /Avenir Next/)
  await openProblems(page)
  const problems = page.getByTestId('console')
  await expect(problems).toContainText('BrandSans')
  await expect(problems).not.toContainText('Avenir Next')
})

test('the Drawn as Markdown note shows on words iOS formats, and not on a name whose underscores iOS draws as written', async ({ page }) => {
  await openInDesign(page, app(`            Text("**Bold**")
            Text("snake_case_name")`), 'snake_case_name')
  const words = basics(page).locator('[data-control-id="content"]')
  await drawnText(page, /^Bold$/).click()
  await expect(words).toHaveValue('**Bold**')
  await expect(basics(page)).toContainText('Drawn as Markdown')

  await drawnText(page, 'snake_case_name').click()
  await expect(words).toHaveValue('snake_case_name')
  await expect(basics(page)).not.toContainText('Drawn as Markdown')
})

test('a Text that is one of two words shows each as a field, with no read-only card of the whole expression', async ({ page }) => {
  await openInDesign(page, app(`            Text(expanded ? "Expanded" : "Collapsed")`, `    @State private var expanded = false
`), 'Collapsed')
  await drawnText(page, /^Collapsed$/).click()
  await expect(basics(page).getByRole('textbox', { name: 'Text · when expanded is true', exact: true })).toHaveValue('Expanded')
  await expect(basics(page).getByRole('textbox', { name: 'Text · otherwise', exact: true })).toHaveValue('Collapsed')
  await idle(page)
  await expect(basics(page).locator('[data-control-id="content:data"]')).toHaveCount(0)
  await expect(basics(page)).not.toContainText('worked out in Swift')
})

test('a symbol among a Text’s words under a gradient foreground is painted, not left transparent with the words', async ({ page }) => {
  await openInDesign(page, app(`            Text("Go \\(Image(systemName: "star.fill")) now")
                .font(.title)
                .foregroundStyle(LinearGradient(colors: [.pink, .orange], startPoint: .leading, endPoint: .trailing))`), 'Notes')
  const go = drawnText(page, /Go.*now/)
  const star = go.locator('[data-symbol="star.fill"]')
  await expect(star).toBeVisible()
  await expect.poll(() => paintsSymbol(star)).toBe(true)
  // The words keep the gradient.
  await expect.poll(() => paintsGradientText(go)).toBe(true)
  await notStopped(page)
})
