import { expect, test, type Locator, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * The Layout section (doc 18, Wave 2), in Chrome and Safari alike: Figma's Hug, Fill and
 * Fixed, a chat bubble that hugs up to a maximum, padding inside a fill and a margin
 * outside it, and an offset, each checked on the canvas and in the Swift it writes.
 */

const app = (body: string) => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { HomeScreen() }
    }
}

struct HomeScreen: View {
    var body: some View {
${body}
    }
}
`

const inspector = (page: Page) => page.getByTestId('authoring-inspector')
const layout = (page: Page) => inspector(page).getByTestId('layer-layout')
const drawn = (page: Page, text: string) => page.getByTestId('render-tree').getByText(text, { exact: true })
const idle = (page: Page) => expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')

const screen = (page: Page) => page.getByTestId('render-tree').locator('[data-node-id="screen"]').first()
/** A drawn element's box, waiting out a redraw in which it briefly has none. */
async function boxOf(locator: Locator) {
  let box: Awaited<ReturnType<Locator['boundingBox']>> = null
  await expect.poll(async () => (box = await locator.boundingBox()) !== null).toBe(true)
  return box!
}
/** Points on the phone per pixel on the screen, so sizes compare however the canvas is zoomed. */
async function points(page: Page): Promise<number> {
  return 402 / (await boxOf(screen(page))).width
}

/** The box the one filled layer on the screen is drawn in, in points from the screen's corner. */
async function filled(page: Page) {
  const scale = await points(page), origin = (await boxOf(screen(page)))
  const box = await page.getByTestId('render-tree').locator('[data-node-id]').evaluateAll(elements => {
    const fill = elements.find(element => element.getAttribute('data-kind') === 'layer' && element.getAttribute('data-node-id') !== 'screen' && getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)')
    const rect = fill?.getBoundingClientRect()
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
  })
  return box && { x: (box.x - origin.x) * scale, y: (box.y - origin.y) * scale, width: box.width * scale, height: box.height * scale }
}

async function select(page: Page, text: string) {
  await drawn(page, text).click()
  await expect(layout(page)).toBeVisible()
}

test('two buttons in a row set to Fill share its width, and one undo puts the last back', async ({ page }) => {
  await openInDesign(page, app(`        HStack(spacing: 8) {
            Button("Cancel") { }
                .buttonStyle(.bordered)
            Button("Save") { }
                .buttonStyle(.borderedProminent)
        }
        .padding(16)`), 'Save')
  const tap = (label: string) => page.getByTestId('render-tree').getByRole('button', { name: label, exact: true }).click()
  for (const label of ['Cancel', 'Save']) {
    await tap(label)
    await expect(layout(page)).toBeVisible()
    await layout(page).getByRole('combobox', { name: 'Width sizing', exact: true }).selectOption('Fill')
    await expect(layout(page).getByRole('combobox', { name: 'Width sizing', exact: true })).toHaveValue('Fill')
    await idle(page)
  }
  // The bordered shapes grow with their labels, half the row each.
  const cancel = page.getByTestId('render-tree').locator('[data-node-id$="btnr-clip"]').first(), save = page.getByTestId('render-tree').locator('[data-node-id$="btnr-clip"]').last()
  await expect.poll(async () => Math.abs((await boxOf(cancel)).width - (await boxOf(save)).width)).toBeLessThan(1)
  expect((await boxOf(cancel)).width * await points(page)).toBeGreaterThan(160)
  const source = await sourceInCode(page)
  expect(source).toContain('Button { } label: {\n                Text("Cancel")\n                    .frame(maxWidth: .infinity)\n            }')
  expect(source).toContain('Button { } label: {\n                Text("Save")\n                    .frame(maxWidth: .infinity)\n            }')

  await tap('Save')
  await idle(page)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await boxOf(save)).width * await points(page)).toBeLessThan(100)
  expect((await boxOf(cancel)).width * await points(page)).toBeGreaterThan(200)
  const undone = await sourceInCode(page)
  expect(undone).toContain('Button("Save") { }\n                .buttonStyle(.borderedProminent)')
  expect(undone).toContain('Text("Cancel")\n                    .frame(maxWidth: .infinity)')
})

test('a chat bubble set to Hug up to 260 stays short for short text, and sits at the start', async ({ page }) => {
  await openInDesign(page, app(`        VStack(alignment: .leading, spacing: 8) {
            Text("Hi")
                .padding(12)
                .background(Color.blue)
            Text("Below")
        }
        .frame(maxWidth: .infinity)`), 'Hi')
  await select(page, 'Hi')
  await layout(page).getByRole('button', { name: 'Min / max', exact: true }).click()
  const max = layout(page).getByRole('textbox', { name: 'Maximum width', exact: true })
  await max.fill('260')
  await max.press('Enter')
  await expect(layout(page).getByRole('combobox', { name: 'Width sizing', exact: true })).toHaveValue('Hug')
  await idle(page)
  await layout(page).getByRole('radiogroup', { name: 'Content alignment', exact: true }).getByRole('radio', { name: 'Start', exact: true }).click()
  await idle(page)

  const bubble = await filled(page)
  expect(bubble!.width).toBeLessThan(80)
  expect(bubble!.x).toBeLessThan(80)
  expect(await sourceInCode(page)).toContain('Text("Hi")\n                .padding(12)\n                .background(Color.blue)\n                .frame(maxWidth: 260, alignment: .leading)')
})

test('padding lands inside the fill and a margin outside it', async ({ page }) => {
  await openInDesign(page, app(`        VStack(spacing: 0) {
            Text("Card")
                .background(Color.blue)
            Text("Below")
        }`), 'Card')
  const before = await filled(page)
  await select(page, 'Card')
  const padding = layout(page).getByRole('textbox', { name: 'Padding, all sides', exact: true })
  await padding.fill('12')
  await padding.press('Enter')
  await expect.poll(async () => (await filled(page))!.width).toBeCloseTo(before!.width + 24, 0)
  await idle(page)

  const below = async () => {
    const scale = await points(page), fill = await filled(page), text = await drawn(page, 'Below').boundingBox(), origin = (await boxOf(screen(page)))
    return (text!.y - origin.y) * scale - (fill!.y + fill!.height)
  }
  const gap = await below()
  const margin = layout(page).getByRole('textbox', { name: 'Margin, all sides', exact: true })
  await margin.fill('20')
  await margin.press('Enter')
  await expect.poll(below).toBeCloseTo(gap + 20, 0)
  expect((await filled(page))!.width).toBeCloseTo(before!.width + 24, 0)
  expect(await sourceInCode(page)).toContain('Text("Card")\n                .padding(12)\n                .background(Color.blue)\n                .padding(20)')

  // Fixed starts from the size it is drawn at, so nothing on the canvas moves.
  await select(page, 'Card')
  const drawnWidth = Math.round((await filled(page))!.width)
  await layout(page).getByRole('combobox', { name: 'Width sizing', exact: true }).selectOption('Fixed')
  await expect(layout(page).getByRole('textbox', { name: 'Width', exact: true })).toHaveValue(String(drawnWidth))
  await idle(page)
  expect(Math.abs((await filled(page))!.width - drawnWidth)).toBeLessThan(1)
  expect(await sourceInCode(page)).toContain(`.padding(12)\n                .frame(width: ${drawnWidth})\n                .background(Color.blue)`)
})

test('Offset X and Y move the view, scrubbed or typed, without moving the views around it', async ({ page }) => {
  await openInDesign(page, app(`        VStack(spacing: 8) {
            Text("Move")
            Text("Stay")
        }`), 'Move')
  const place = async (text: string) => {
    const scale = await points(page), box = (await boxOf(drawn(page, text)))
    return { x: box.x * scale, y: box.y * scale }
  }
  const [move, stay] = [await place('Move'), await place('Stay')]
  await select(page, 'Move')
  const x = layout(page).getByRole('textbox', { name: 'Offset X', exact: true })
  await x.fill('30')
  await x.press('Enter')
  await idle(page)
  const y = layout(page).getByRole('textbox', { name: 'Offset Y', exact: true })
  await y.fill('10')
  await y.press('Tab')
  await expect.poll(async () => (await place('Move')).y - move.y).toBeCloseTo(10, 0)
  expect((await place('Move')).x - move.x).toBeCloseTo(30, 0)
  expect(await place('Stay')).toEqual(stay)
  // Written on the chain's own line, as the chain is.
  expect(await sourceInCode(page)).toContain('Text("Move").offset(x: 30, y: 10)')

  // ArrowUp nudges by one, Shift by ten, and Enter applies them as one change.
  await select(page, 'Move')
  await x.press('ArrowUp')
  await x.press('Shift+ArrowUp')
  await expect(x).toHaveValue('41')
  await x.press('Escape')
  await expect(x).toHaveValue('30')
  await x.press('Shift+ArrowDown')
  await x.press('Enter')
  await expect.poll(async () => (await place('Move')).x - move.x).toBeCloseTo(20, 0)
})
