import { expect, test, type Locator, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * Content structures and the Add palette (doc 18, Wave 4c), in Chrome and Safari alike: a
 * carousel drawn in place among the views beside it, with dots that switch its pages, and a
 * dots background it takes from around it read as such, a new screen that starts as a Form, a
 * view wrapped in a List and unwrapped again, with what the planner refuses off, a view
 * extended under the status bar, and views the palette couldn't add before, each written as
 * the plainest Swift.
 */

const app = (screen: string, body: string) => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { ${screen}() }
    }
}

struct ${screen}: View {
    var body: some View {
${body}
    }
}
`

const WELCOME = app('WelcomeScreen', `        VStack(spacing: 16) {
            Text("Welcome")
            Button("Continue") { }
        }`)

const ERRANDS = app('ErrandsScreen', `        VStack(spacing: 16) {
            Text("Groceries")
            Text("Errands")
        }`)

const canvas = (page: Page) => page.getByTestId('render-tree')
const drawn = (page: Page, text: string) => canvas(page).getByText(text, { exact: true })
const inspector = (page: Page) => page.getByTestId('authoring-inspector')
const layers = (page: Page) => page.getByTestId('logical-layers')
const navigator = (page: Page) => page.getByRole('navigation', { name: 'Layers', exact: true })
const idle = (page: Page) => expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
/** A screen's phone on the canvas, by the name its Edit button carries. */
const phone = (page: Page, name: string) => page.getByTestId('gallery-page').filter({ has: page.getByRole('button', { name: `Edit ${name}`, exact: true }) })

/** Adds the palette's entry `id`, found by typing `query`, after whatever is selected. */
async function addFromPalette(page: Page, query: string, id: string) {
  await idle(page)
  await page.getByTestId('add-view').click()
  await page.getByTestId('add-view-search').fill(query)
  await page.getByTestId(`add-view-${id}`).click()
  await expect(page.getByTestId('add-view-palette')).toBeHidden()
}

/** Chooses `action` in the actions menu of the layer row `row`, once the last change is drawn. */
async function layerAction(page: Page, row: Locator, action: string) {
  await idle(page)
  await row.hover()
  await row.getByRole('button', { name: /^Actions for / }).click()
  await expect(page.getByRole('option', { name: action, exact: true })).toBeEnabled()
  await page.getByRole('option', { name: action, exact: true }).click()
}

test('a carousel from the palette is drawn in place among its neighbours, and its dots switch its pages', async ({ page }) => {
  await openInDesign(page, WELCOME, 'Welcome')
  await drawn(page, 'Welcome').click()
  await addFromPalette(page, 'carousel', 'carousel')
  // Its first page, in place: the views beside it are still drawn, not taken over by it.
  await expect(drawn(page, 'Page 1')).toBeVisible()
  await expect(drawn(page, 'Welcome')).toBeVisible()
  await expect(canvas(page).getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
  await expect(drawn(page, 'Page 2')).toBeHidden()
  await idle(page)
  const source = await sourceInCode(page)
  expect(source).toContain('            TabView {\n                Text("Page 1")\n                Text("Page 2")\n                Text("Page 3")\n            }\n            .tabViewStyle(.page(indexDisplayMode: .always))\n            .indexViewStyle(.page(backgroundDisplayMode: .always))\n            .frame(height: 240)\n')

  // A dot is the way to its page in the preview, which has no swipe. The dots are buttons named
  // Page 1 to Page 3, there before and after; whether a page is drawn is read from its own text.
  await page.getByTestId('live-toggle').click()
  await canvas(page).getByRole('button', { name: 'Page 2', exact: true }).click()
  await expect(drawn(page, 'Page 2')).toBeVisible()
  await expect(drawn(page, 'Page 1')).toBeHidden()
  await expect(drawn(page, 'Welcome')).toBeVisible()
})

test('a carousel’s Dots background set on the column around it reads on, read only, and says where it is set', async ({ page }) => {
  await openInDesign(page, app('PagesScreen', `        VStack(spacing: 16) {
            TabView {
                Text("Page 1")
                Text("Page 2")
            }
            .tabViewStyle(.page)
            .frame(height: 240)
        }
        .indexViewStyle(.page(backgroundDisplayMode: .always))`), 'Page 1')
  await layers(page).locator('[data-source-name="TabView"]').click()
  // The canvas draws the backing the column gives it, so the field shows it on, as the column sets it (Wave 4c).
  const field = inspector(page).getByRole('switch', { name: 'Dots background', exact: true })
  await expect(field).toHaveAttribute('aria-checked', 'true')
  await expect(field).toBeDisabled()
  await expect(inspector(page).getByText('Set on the Column around it. Change it there.', { exact: true })).toBeVisible()
})

test('a new screen can start as a Form: its rows edge to edge under its title, with no padding or frame', async ({ page }) => {
  await openInDesign(page, WELCOME, 'Welcome')
  await idle(page)
  await page.getByTestId('add-screen').click()
  const form = navigator(page).locator('form')
  await form.getByRole('textbox', { name: 'Screen name', exact: true }).fill('Settings')
  await form.getByRole('combobox', { name: 'Screen layout', exact: true }).selectOption('Form')
  await form.getByRole('button', { name: 'Add screen', exact: true }).click()
  await expect(phone(page, 'Settings').getByTestId('render-tree').getByText('Row', { exact: true })).toBeVisible()
  await idle(page)
  const source = await sourceInCode(page)
  const screen = source.slice(source.indexOf('struct SettingsScreen: View {'))
  expect(screen).toContain('        Form {\n            Section("Section") {\n                Text("Row")\n            }\n        }\n        .navigationTitle("Settings")\n')
  expect(screen).not.toContain('.padding(')
  expect(screen).not.toContain('.frame(')
})

test('Group in List puts a view in a List, and is off in one; Unwrap puts it back, or says why it can’t', async ({ page }) => {
  await openInDesign(page, ERRANDS, 'Groceries')
  const text = layers(page).locator('[data-source-name="Text"]').filter({ hasText: 'Groceries' })
  await layerAction(page, text, 'Group in List')
  const list = layers(page).locator('[data-source-name="List"]')
  await expect(list).toHaveCount(1)
  await idle(page)
  expect(await sourceInCode(page)).toContain('        VStack(spacing: 16) {\n            List {\n                Text("Groceries")\n            }\n            Text("Errands")\n        }')

  // In a List, a List or a Form would have no height, so iOS would show none of it: both are off, and say why (Wave 4c).
  // The List's row is opened from the keyboard first, which lists the view in it whether or not it was open.
  await idle(page)
  await list.focus()
  await page.keyboard.press('ArrowRight')
  await expect(text).toBeVisible()
  await text.hover()
  await text.getByRole('button', { name: /^Actions for / }).click()
  for (const layout of ['List', 'Form']) {
    const wrap = page.getByRole('option', { name: `Group in ${layout}`, exact: true })
    await expect(wrap).toBeDisabled()
    await expect(wrap).toHaveAttribute('title', `A ${layout} inside a scroll view or a list has no height of its own, so iOS would show none of it. Wrap what holds it instead.`)
  }
  await expect(page.getByRole('option', { name: /^Group in Column\b/ })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('option', { name: /^Group in Column\b/ })).toBeHidden()

  await layerAction(page, list, 'Unwrap')
  await expect(list).toHaveCount(0)
  await idle(page)
  expect(await sourceInCode(page)).toContain('        VStack(spacing: 16) {\n            Text("Groceries")\n            Text("Errands")\n        }')

  // The screen's root shows one view, so its two can't take its place: Unwrap is off there, and says why.
  const root = layers(page).locator('[data-source-name="VStack"]')
  await root.hover()
  await root.getByRole('button', { name: /^Actions for / }).click()
  const unwrap = page.getByRole('option', { name: 'Unwrap', exact: true })
  await expect(unwrap).toBeDisabled()
  await expect(unwrap).toHaveAttribute('title', 'What holds it shows one view, so its views can’t all go there. Keep it, or change this in Code.')
})

test('Safe area set to Extend to top reaches a view under the status bar, written as ignoresSafeArea and read back', async ({ page }) => {
  await openInDesign(page, app('HeroScreen', `        VStack(spacing: 16) {
            Rectangle()
                .fill(.orange)
                .frame(height: 200)
            Text("Hero")
            Spacer()
        }`), 'Hero')
  await layers(page).locator('[data-source-name="Rectangle"]').click()
  const field = inspector(page).getByRole('combobox', { name: 'Safe area', exact: true })
  await expect(field).toHaveValue('Respect')
  await field.selectOption({ label: 'Extend to top' })
  await expect(field).toHaveValue('Extend to top')
  await idle(page)
  expect(await sourceInCode(page)).toContain('                .frame(height: 200)\n                .ignoresSafeArea(edges: .top)\n')
})

test('a gauge and a menu from the palette are drawn where they are added, as the plainest Swift', async ({ page }) => {
  await openInDesign(page, ERRANDS, 'Groceries')
  await drawn(page, 'Errands').click()
  await addFromPalette(page, 'gauge', 'gauge')
  await expect(drawn(page, 'Gauge')).toBeVisible()
  await drawn(page, 'Errands').click()
  await addFromPalette(page, 'menu', 'menu')
  await expect(canvas(page).getByRole('button', { name: 'Menu', exact: true })).toBeVisible()
  await idle(page)
  const source = await sourceInCode(page)
  expect(source).toContain('            Gauge(value: 0.5) {\n                Text("Gauge")\n            }\n')
  expect(source).toContain('            Menu("Menu") {\n                Button("Action") { }\n            }\n')
  // Each lands after the view selected: the menu right after Errands, then the gauge.
  expect(source.indexOf('Text("Errands")')).toBeLessThan(source.indexOf('Menu("Menu")'))
  expect(source.indexOf('Menu("Menu")')).toBeLessThan(source.indexOf('Gauge(value: 0.5)'))
})
