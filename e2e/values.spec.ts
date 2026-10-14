import { expect, test, type Locator, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * Values in real code (doc 18, Concern 2, items 4, 10 and 11, Wave 3b), in Chrome and
 * Safari alike: a constant's chip with its value, changed where it is declared or detached
 * at one view; a drop shadow added and changed from Effects; and a padding a condition
 * chooses, each case its own field. Each is checked on the canvas and in the Swift written.
 */

const app = (body: string, members = '') => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { HomeScreen() }
    }
}

struct HomeScreen: View {
${members}    var body: some View {
        VStack(spacing: 8) {
${body}
            Text("Other").padding(inset)
        }
    }
}
`
const MEMBERS = '    private let inset: CGFloat = 16\n    @State private var selected = false\n'

const inspector = (page: Page) => page.getByTestId('authoring-inspector')
const layout = (page: Page) => inspector(page).getByTestId('layer-layout')
const effects = (page: Page) => inspector(page).getByTestId('layer-effects')
const drawn = (page: Page, text: string) => page.getByTestId('render-tree').getByText(text, { exact: true })
const idle = (page: Page) => expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
const screen = (page: Page) => page.getByTestId('render-tree').locator('[data-node-id="screen"]').first()

/** A drawn element's box, waiting out a redraw in which it briefly has none. */
async function boxOf(locator: Locator) {
  let box: Awaited<ReturnType<Locator['boundingBox']>> = null
  await expect.poll(async () => (box = await locator.boundingBox()) !== null).toBe(true)
  return box!
}

/** The height of the one yellow layer on the screen, in points, so sizes compare however the canvas is zoomed. */
async function yellowHeight(page: Page): Promise<number> {
  const scale = 402 / (await boxOf(screen(page))).width
  const height = await page.getByTestId('render-tree').locator('[data-node-id]').evaluateAll(elements => {
    const fill = elements.find(element => element.getAttribute('data-kind') === 'layer' && getComputedStyle(element).backgroundColor === 'rgb(255, 204, 0)')
    return fill?.getBoundingClientRect().height ?? 0
  })
  return height * scale
}

async function openHello(page: Page, view: string) {
  await openInDesign(page, app(`            ${view}`, MEMBERS), 'Hello')
  await drawn(page, 'Hello').click()
  await expect(layout(page)).toBeVisible()
}

test('Edit at declaration changes the constant for every view that reads it', async ({ page }) => {
  await openHello(page, 'Text("Hello").padding(inset).background(Color.yellow)')
  await expect.poll(() => yellowHeight(page)).toBeGreaterThan(0)
  const before = await yellowHeight(page)
  const chip = layout(page).getByRole('button', { name: 'inset token', exact: true })
  await expect(chip).toHaveText('inset · 16')
  await chip.click()
  const token = page.getByRole('dialog', { name: 'inset', exact: true })
  await expect(token).toContainText('Used in 2 places')
  const value = token.getByRole('textbox', { name: 'Value of inset', exact: true })
  await value.fill('24')
  await value.press('Enter')
  await expect(token).toBeHidden()
  // 8 more points on the top and on the bottom.
  await expect.poll(async () => await yellowHeight(page) - before).toBeCloseTo(16, 0)
  await idle(page)
  await expect(layout(page).getByRole('button', { name: 'inset token', exact: true })).toHaveText('inset · 24')
  const source = await sourceInCode(page)
  expect(source).toContain('    private let inset: CGFloat = 24\n')
  expect(source).toContain('Text("Hello").padding(inset).background(Color.yellow)')
  expect(source).toContain('Text("Other").padding(inset)')
})

test('Detach writes the constant’s value at this view only', async ({ page }) => {
  await openHello(page, 'Text("Hello").padding(inset).background(Color.yellow)')
  await layout(page).getByRole('button', { name: 'inset token', exact: true }).click()
  await page.getByRole('dialog', { name: 'inset', exact: true }).getByRole('button', { name: 'Detach', exact: true }).click()
  await idle(page)
  await expect(layout(page).getByRole('textbox', { name: 'Padding, all sides', exact: true })).toHaveValue('16')
  await expect(layout(page).getByRole('button', { name: 'inset token', exact: true })).toHaveCount(0)
  const source = await sourceInCode(page)
  expect(source).toContain('Text("Hello").padding(16).background(Color.yellow)')
  expect(source).toContain('Text("Other").padding(inset)')
})

test('a drop shadow is added from Effects and its blur changed, each drawn and written plainly', async ({ page }) => {
  await openHello(page, 'Text("Hello").padding(8).background(Color.yellow)')
  /** Whether the canvas draws a shadow anywhere around the yellow layer. */
  const shadowed = () => page.getByTestId('render-tree').locator('[data-node-id]').evaluateAll(elements => elements.some(element => {
    const style = getComputedStyle(element)
    return /rgba\(0, 0, 0, 0\.25\)/.test(`${style.boxShadow} ${style.filter}`)
  }))
  expect(await shadowed()).toBe(false)
  await effects(page).getByRole('button', { name: 'Add drop shadow', exact: true }).click()
  await expect.poll(shadowed).toBe(true)
  await idle(page)
  expect(await sourceInCode(page)).toContain('Text("Hello").padding(8).background(Color.yellow).shadow(color: .black.opacity(0.25), radius: 4, y: 4)')

  await drawn(page, 'Hello').click()
  const blur = effects(page).getByRole('textbox', { name: 'Shadow blur', exact: true })
  await expect(blur).toHaveValue('4')
  await blur.fill('8')
  await blur.press('Enter')
  await idle(page)
  await expect(blur).toHaveValue('8')
  expect(await sourceInCode(page)).toContain('.shadow(color: .black.opacity(0.25), radius: 8, y: 4)')

  await drawn(page, 'Hello').click()
  await effects(page).getByRole('button', { name: 'Remove drop shadow', exact: true }).click()
  await expect.poll(shadowed).toBe(false)
  expect(await sourceInCode(page)).toContain('Text("Hello").padding(8).background(Color.yellow)\n')
})

test('a padding a condition chooses shows both cases, and the one changed is written in place', async ({ page }) => {
  await openHello(page, 'Text("Hello").padding(selected ? 16 : 8).background(Color.yellow)')
  await expect.poll(() => yellowHeight(page)).toBeGreaterThan(0)
  const before = await yellowHeight(page)
  const then = layout(page).getByRole('textbox', { name: 'Padding, all sides, when selected is true', exact: true })
  const otherwise = layout(page).getByRole('textbox', { name: 'Padding, all sides, otherwise', exact: true })
  await expect(then).toHaveValue('16')
  await expect(otherwise).toHaveValue('8')
  await otherwise.fill('12')
  await otherwise.press('Enter')
  // `selected` is false, so the canvas draws the case changed: 4 more points on the top and on the bottom.
  await expect.poll(async () => await yellowHeight(page) - before).toBeCloseTo(8, 0)
  await idle(page)
  await expect(otherwise).toHaveValue('12')
  await expect(then).toHaveValue('16')
  expect(await sourceInCode(page)).toContain('Text("Hello").padding(selected ? 16 : 12).background(Color.yellow)')
})

test('a constant worked out in Swift shows its expression on its chip, with nothing to edit where it is declared', async ({ page }) => {
  await openInDesign(page, app('            Text("Hello").padding(double).background(Color.yellow)', `${MEMBERS}    private let double: CGFloat = 8 * 2\n`), 'Hello')
  await drawn(page, 'Hello').click()
  await expect(layout(page)).toBeVisible()
  const chip = layout(page).getByText('double · 8 * 2', { exact: true })
  await expect(chip).toBeVisible()
  await expect(chip).toHaveAttribute('title', 'Linked to double, worked out in Swift as 8 * 2. Type a number to replace it.')
  await expect(layout(page).getByRole('button', { name: 'double token', exact: true })).toHaveCount(0)
})
