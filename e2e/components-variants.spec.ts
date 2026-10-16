import { expect, test, type Locator, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * Components beyond text (Wave 5b): a Main's symbol, colour and whether a view is shown
 * become inputs each copy sets with the right control; a variant property each copy picks,
 * with a value of the Main that differs by it; and a copy that swaps to another component
 * or detaches into the views it shows.
 */
const SOURCE = `import SwiftUI

@main
struct PillsApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct Pill: View {
    var title: String

    var body: some View {
        HStack {
            Image(systemName: "star")
            Text(title)
        }
        .padding(8)
        .foregroundStyle(Color.white)
        .background(Color.blue)
    }
}

struct Badge: View {
    var title: String

    var body: some View {
        Text(title)
            .padding(4)
            .background(Color.orange)
    }
}

struct Tally: View {
    var label: String

    var body: some View {
        Text(label)
            .bold()
    }
}

struct Meter: View {
    @State private var level = 0.5

    var body: some View {
        Slider(value: $level)
    }
}

struct Stamp: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
    }
}

struct ContentView: View {
    var body: some View {
        VStack(spacing: 16) {
            Text("Pills")
            Pill(title: "First")
            Pill(title: "Second")
            Badge(title: "Badge")
            Tally(label: "Tally")
            Meter()
            Stamp("Stamp")
        }
    }
}`

const layers = (page: Page) => page.getByTestId('logical-layers')
const row = (page: Page, name: string) => layers(page).locator(`[data-source-name="${name}"]`)
const copies = (page: Page, name: string) => layers(page).locator(`[data-source-name="${name}"][data-source-kind="component"]`)
const inspector = (page: Page) => page.getByTestId('authoring-inspector')
const basics = (page: Page) => page.getByTestId('settings-basics')

/** Waits for the edit to be drawn and the panel to settle. A selected screen shows its own settings, with no inspector to wait for. */
async function idle(page: Page) {
  await expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('[data-testid="authoring-inspector"][aria-busy="true"]')).toHaveCount(0)
}

/** The Swift, read in Code until the edit has landed and it holds `expected` (or, with `absent`, no longer does). */
async function swiftHas(page: Page, expected: string | RegExp, absent = false) {
  await idle(page)
  const has = async () => { const swift = await sourceInCode(page); return typeof expected === 'string' ? swift.includes(expected) : expected.test(swift) }
  await expect.poll(has).toBe(!absent)
}

/** Picks the option of `select` whose words match `label`, whatever value it carries. */
async function choose(select: Locator, label: RegExp) {
  const option = select.locator('option').filter({ hasText: label }).first()
  await expect(option).toHaveCount(1)
  await select.selectOption(await option.getAttribute('value') ?? '')
}

/** Opens a disclosure section, whichever state the last selection left it in. */
async function expand(details: Locator) {
  if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await details.locator('summary').first().click()
  await expect(details).toHaveAttribute('open', '')
}

/** The screen's layers again, after editing a Main. */
async function backToScreen(page: Page) {
  await page.getByTestId('design-screen').first().locator('[data-outline-row]').click()
  await idle(page)
}

/** Opens Pill's Main from its first copy. */
async function openMain(page: Page, name = 'Pill') {
  await backToScreen(page)
  await copies(page, name).first().click(); await idle(page)
  await basics(page).getByRole('button', { name: 'Edit the Main…', exact: true }).click()
  await basics(page).getByRole('button', { name: 'Open the Main', exact: true }).click()
  await expect(inspector(page)).toContainText('The Main · changes apply to every copy')
}

/** Makes a value of the selected view in the Main changeable per copy. */
async function makeChangeable(page: Page, value: RegExp, name: string, button: string) {
  const section = basics(page).getByTestId('changeable-per-copy')
  await expand(section)
  await choose(section.getByLabel('Value each copy sets', { exact: true }), value)
  await section.getByLabel('Component input name', { exact: true }).fill(name)
  await section.getByRole('button', { name: button, exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await openInDesign(page, SOURCE, 'Pills')
})

test('a symbol becomes changeable per copy, and a copy picks its own with the symbol picker', async ({ page }) => {
  await openMain(page)
  await row(page, 'Image').first().click(); await idle(page)
  await makeChangeable(page, /^Symbol · star$/, 'icon', 'Make symbol changeable per copy')
  await swiftHas(page, 'var icon: String = "star"')
  expect(await sourceInCode(page)).toContain('Image(systemName: icon)')

  await backToScreen(page)
  await copies(page, 'Pill').first().click(); await idle(page)
  // A symbol input is the symbol picker, never a name to type.
  const input = basics(page).locator('[data-testid="copy-input"][data-input-kind="symbol"]')
  await expect(input).toHaveCount(1)
  await input.getByText('Choose a symbol', { exact: true }).click()
  await input.getByLabel('Search symbols', { exact: true }).fill('heart')
  await input.getByRole('button', { name: 'Use symbol heart', exact: true }).click()
  await swiftHas(page, 'Pill(title: "First", icon: "heart")')
  expect(await sourceInCode(page)).toContain('Pill(title: "Second")')
})

test('a colour becomes changeable per copy, and a copy sets its own with the colour field', async ({ page }) => {
  await openMain(page)
  await row(page, 'HStack').first().click(); await idle(page)
  await makeChangeable(page, /^Color · background$/, 'tint', 'Make color changeable per copy')
  await swiftHas(page, /var tint: Color = (Color)?\.blue/)
  expect(await sourceInCode(page)).toContain('.background(tint)')

  await backToScreen(page)
  await copies(page, 'Pill').first().click(); await idle(page)
  const input = basics(page).locator('[data-testid="copy-input"][data-input-kind="color"]')
  await expect(input.getByRole('button', { name: 'tint color', exact: true })).toBeVisible()
  const hex = input.getByRole('textbox', { name: 'tint hex', exact: true })
  await hex.fill('green'); await hex.press('Enter')
  await swiftHas(page, /Pill\(title: "First", tint: (Color)?\.green\)/)
  expect(await sourceInCode(page)).toContain('Pill(title: "Second")')
})

test('Shown per copy hides an icon in one copy and keeps it in the other', async ({ page }) => {
  await openMain(page)
  await row(page, 'Image').first().click(); await idle(page)
  await makeChangeable(page, /^Shown$/, 'showsIcon', 'Let each copy show or hide it')
  await swiftHas(page, 'var showsIcon: Bool = true')
  expect(await sourceInCode(page)).toMatch(/if showsIcon \{\n\s+Image\(systemName: "star"\)\n\s+\}/)

  await backToScreen(page)
  await copies(page, 'Pill').last().click(); await idle(page)
  const shows = basics(page).getByRole('switch', { name: 'showsIcon', exact: true })
  await expect(shows).toHaveAttribute('aria-checked', 'true')
  await shows.click()
  await swiftHas(page, 'Pill(title: "Second", showsIcon: false)')
  expect(await sourceInCode(page)).toContain('Pill(title: "First")')
})

test('a variant property on a Main, a background that differs by it, and a copy that picks Secondary', async ({ page }) => {
  await openMain(page)
  const variants = basics(page).getByTestId('component-variant-properties')
  await expand(variants.locator('details').filter({ hasText: 'Add variant property' }))
  await expect(variants.getByLabel('Variant property name', { exact: true })).toHaveValue('Style')
  await expect(variants.getByLabel('First variant value', { exact: true })).toHaveValue('Primary')
  await expect(variants.getByLabel('Second variant value', { exact: true })).toHaveValue('Secondary')
  await variants.getByRole('button', { name: 'Add variant property', exact: true }).click()
  await swiftHas(page, /enum Style \{\n\s+case primary, secondary\n\s+\}/)
  expect(await sourceInCode(page)).toContain('var style: Style = .primary')

  await openMain(page)
  await row(page, 'HStack').first().click(); await idle(page)
  await choose(basics(page).getByLabel('Value that differs', { exact: true }), /^background$/)
  await basics(page).getByRole('button', { name: 'Differs by Style', exact: true }).click()
  await swiftHas(page, '.background(style == .primary ? Color.blue : Color.blue)')
  // Both sides read back on the view still selected, named by their cases rather than as true and otherwise.
  await idle(page)
  await expect(inspector(page).getByText('When Primary', { exact: true }).first()).toBeVisible()
  await expect(inspector(page).getByText('When Secondary', { exact: true }).first()).toBeVisible()
  const secondary = inspector(page).getByRole('textbox', { name: 'Fill, when Secondary hex', exact: true })
  await secondary.fill('green'); await secondary.press('Enter')
  await swiftHas(page, /\.background\(style == \.primary \? Color\.blue : (Color)?\.green\)/)

  await backToScreen(page)
  await copies(page, 'Pill').last().click(); await idle(page)
  await basics(page).getByRole('combobox', { name: 'style', exact: true }).selectOption('secondary')
  await swiftHas(page, /Pill\(title: "Second", style: (Pill\.)?(Style)?\.secondary\)/)
  expect(await sourceInCode(page)).toContain('Pill(title: "First")')
})

test('a copy swaps to another component, and one that does not fit is listed disabled with the reason', async ({ page }) => {
  await copies(page, 'Badge').first().click(); await idle(page)
  const swap = basics(page).getByLabel('Swap component', { exact: true })
  // An option's own state: toBeDisabled reads the labelled select instead.
  await expect(swap.locator('option', { hasText: /^Pill$/ })).toHaveJSProperty('disabled', false)
  // Stamp has an init of its own, so a copy's inputs can't be matched to it.
  await expect(swap.locator('option', { hasText: /^Stamp/ })).toHaveJSProperty('disabled', true)
  await expect(basics(page).getByTestId('copy-actions').locator('p').filter({ hasText: 'Stamp has an init of its own' })).toBeVisible()
  // A screen is no component to swap to.
  await expect(swap.locator('option', { hasText: /^ContentView/ })).toHaveCount(0)
  await swap.selectOption('Pill')
  await swiftHas(page, 'Pill(title: "Badge")')
  // The Main it was a copy of stays.
  expect(await sourceInCode(page)).toContain('struct Badge: View')
  await expect(page.getByTestId('render-tree').getByText('Badge', { exact: true })).toBeVisible()
})

test('a copy detaches into the views it shows, and a Main with state of its own refuses with the reason', async ({ page }) => {
  await copies(page, 'Tally').first().click(); await idle(page)
  await basics(page).getByRole('button', { name: 'Detach copy', exact: true }).click()
  await swiftHas(page, 'Tally(label: "Tally")', true)
  const swift = await sourceInCode(page)
  expect(swift).toMatch(/Text\("Tally"\)\n\s+\.bold\(\)/)
  expect(swift).toContain('struct Tally: View')
  await expect(page.getByTestId('render-tree').getByText('Tally', { exact: true })).toBeVisible()

  await backToScreen(page)
  await copies(page, 'Meter').first().click(); await idle(page)
  const actions = basics(page).getByTestId('copy-actions')
  await expect(actions.getByRole('button', { name: 'Detach copy', exact: true })).toBeDisabled()
  await expect(actions.locator('p').last()).not.toBeEmpty()
})
