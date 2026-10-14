import { expect, test, type Locator, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * Editing on the canvas (Wave 2b), in Chrome and Safari alike: Figma's handles on the
 * selected view. Each drag shows a draft while the pointer moves, and letting go writes
 * the Swift the Layout section would, as one undo step; Escape leaves the file as it was.
 */

const app = (body: string, declarations = '') => `import SwiftUI

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
${declarations}`

const CARD = app(`        VStack(spacing: 8) {
            Text("Alpha")
                .padding(12)
                .background(Color.blue)
            Text("Beta")
        }`)

const drawn = (page: Page, text: string) => page.getByTestId('render-tree').getByText(text, { exact: true })
const idle = (page: Page) => expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
const resize = (page: Page, edge: string) => page.locator(`[data-testid="resize-handle"][data-edge="${edge}"]`)
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
/** The box the one filled layer on the screen is drawn in, in points. */
async function filled(page: Page) {
  const scale = await points(page)
  const box = await page.getByTestId('render-tree').locator('[data-node-id]').evaluateAll(elements => {
    const fill = elements.find(element => element.getAttribute('data-kind') === 'layer' && element.getAttribute('data-node-id') !== 'screen' && getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)')
    const rect = fill?.getBoundingClientRect()
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
  })
  return box && { x: box.x * scale, y: box.y * scale, width: box.width * scale, height: box.height * scale }
}

async function select(page: Page, text: string) {
  await drawn(page, text).click()
  await expect(page.getByTestId('authoring-inspector').getByTestId('layer-layout')).toBeVisible()
  await idle(page)
}

/** Presses `from` at its middle, moves by `by` pixels in `steps`, and leaves the button down. */
async function press(page: Page, from: Locator, by: { x: number; y: number }, steps = 8) {
  const box = await boxOf(from)
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + by.x, y + by.y, { steps })
}

test('a corner gives a Fixed width and height, drawn as it is dragged, and one undo takes it back', async ({ page }) => {
  await openInDesign(page, CARD, 'Alpha')
  await select(page, 'Alpha')
  const before = (await filled(page))!
  const scale = await points(page)
  await expect(resize(page, 'bottomTrailing')).toBeVisible()

  await press(page, resize(page, 'bottomTrailing'), { x: 40, y: 24 })
  // The draft: the card grows while the pointer is still down, before anything is written.
  await expect.poll(async () => (await filled(page))!.width).toBeGreaterThan(before.width + 20)
  await page.mouse.up()
  await idle(page)
  // The same view stays selected, now a Fixed size.
  await expect(page.getByTestId('authoring-inspector').getByRole('combobox', { name: 'Width sizing', exact: true })).toHaveValue('Fixed')
  await expect(resize(page, 'bottomTrailing')).toBeVisible()

  const width = Math.round(before.width + 40 * scale), height = Math.round(before.height + 24 * scale)
  const source = await sourceInCode(page)
  const frame = source.match(/Text\("Alpha"\)\n {16}\.padding\(12\)\n {16}\.frame\(width: (\d+), height: (\d+)\)\n {16}\.background\(Color\.blue\)/)
  expect(frame, source).not.toBeNull()
  expect(Math.abs(Number(frame![1]) - width)).toBeLessThanOrEqual(1)
  expect(Math.abs(Number(frame![2]) - height)).toBeLessThanOrEqual(1)
  await expect.poll(async () => Math.round((await filled(page))!.width)).toBe(Number(frame![1]))

  // One undo puts the hugging card back.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => Math.abs((await filled(page))!.width - before.width)).toBeLessThan(1)
  expect(await sourceInCode(page)).not.toContain('.frame(')
})

test('the selection outline is the handles’ box, padding and fill included, and follows a drag', async ({ page }) => {
  await openInDesign(page, CARD, 'Alpha')
  await select(page, 'Alpha')
  const outline = page.getByTestId('selection-outline')
  await expect(outline).toHaveCount(1)
  // Drawn by the handles, at their box, rather than by the render tree around the text.
  await expect(outline).toHaveAttribute('data-outline', 'handles')
  /** The handles' box: each corner handle's square is centred on a corner; its grab area leans 2 px outside. */
  const handlesBox = async () => {
    const corner = async (edge: string, dx: number, dy: number) => {
      const box = await boxOf(resize(page, edge))
      return { x: box.x + box.width / 2 - dx * 2, y: box.y + box.height / 2 - dy * 2 }
    }
    const from = await corner('topLeading', -1, -1), to = await corner('bottomTrailing', 1, 1)
    return { x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y }
  }
  const same = async () => {
    const drawnBox = await boxOf(outline), handles = await handlesBox()
    return Math.max(Math.abs(drawnBox.x - handles.x), Math.abs(drawnBox.y - handles.y), Math.abs(drawnBox.width - handles.width), Math.abs(drawnBox.height - handles.height))
  }
  expect(await same()).toBeLessThanOrEqual(1)
  // Around the fill, which the padding is inside of, not around the text.
  const fill = await page.getByTestId('render-tree').locator('[data-node-id]').evaluateAll(elements => {
    const rect = elements.find(element => element.getAttribute('data-kind') === 'layer' && element.getAttribute('data-node-id') !== 'screen' && getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)')!.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
  const drawnBox = await boxOf(outline)
  expect(Math.abs(drawnBox.width - fill.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(drawnBox.height - fill.height)).toBeLessThanOrEqual(1)

  await press(page, resize(page, 'trailing'), { x: 40, y: 0 })
  await expect.poll(async () => (await boxOf(outline)).width).toBeGreaterThan(drawnBox.width + 30)
  expect(await same()).toBeLessThanOrEqual(1)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect.poll(async () => Math.abs((await boxOf(outline)).width - drawnBox.width)).toBeLessThan(1)
  await expect(outline).toHaveCount(1)
})

test('Escape during a drag puts the view back and leaves the Swift as it was', async ({ page }) => {
  await openInDesign(page, CARD, 'Alpha')
  const original = await sourceInCode(page)
  await select(page, 'Alpha')
  const before = (await filled(page))!

  await press(page, resize(page, 'trailing'), { x: 50, y: 0 })
  await expect.poll(async () => (await filled(page))!.width).toBeGreaterThan(before.width + 20)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect.poll(async () => Math.abs((await filled(page))!.width - before.width)).toBeLessThan(1)
  // Escape ended the drag only: the view is still the selection.
  await expect(page.getByTestId('authoring-inspector').getByTestId('layer-layout')).toBeVisible()
  expect(await sourceInCode(page)).toBe(original)
})

test('a padding band dragged in with Alt gives both sides more padding', async ({ page }) => {
  await openInDesign(page, CARD, 'Alpha')
  await select(page, 'Alpha')
  const scale = await points(page)
  // The bands show while the pointer is over the view.
  await drawn(page, 'Alpha').hover()
  const leading = page.locator('[data-testid="padding-handle"][data-side="leading"]')
  await expect(leading).toBeVisible()

  await page.keyboard.down('Alt')
  await press(page, leading, { x: 16, y: 0 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  await idle(page)

  const sides = Math.round(12 + 16 * scale)
  const source = await sourceInCode(page)
  expect(source).toContain(`Text("Alpha")\n                .padding(.horizontal, ${sides})\n                .padding(.vertical, 12)\n                .background(Color.blue)`)
})

test('a gap between a Column’s views sets its spacing', async ({ page }) => {
  await openInDesign(page, CARD, 'Alpha')
  await select(page, 'Alpha')
  // Escape selects the Column around it.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('authoring-inspector').locator('header strong')).toHaveText('Column')
  await idle(page)
  const scale = await points(page)
  await drawn(page, 'Alpha').hover()
  const gap = page.locator('[data-testid="spacing-handle"]')
  await expect(gap).toHaveCount(1)

  await press(page, gap, { x: 0, y: 12 })
  await page.mouse.up()
  await idle(page)
  expect(await sourceInCode(page)).toContain(`VStack(spacing: ${Math.round(8 + 12 * scale)}) {`)
})

test('the arrow keys move a view in an Overlap by its offset, one edit for each burst', async ({ page }) => {
  await openInDesign(page, app(`        ZStack {
            Color.yellow
                .frame(width: 300, height: 300)
            Text("Badge")
                .padding(8)
                .background(Color.red)
        }`), 'Badge')
  await select(page, 'Badge')
  const before = (await boxOf(drawn(page, 'Badge')))
  const scale = await points(page)

  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  // Drawn as it is nudged, and written once the keys stop.
  await expect.poll(async () => ((await boxOf(drawn(page, 'Badge'))).y - before.y) * scale).toBeCloseTo(10, 0)
  await idle(page)
  await expect.poll(() => sourceInCode(page)).toContain('Text("Badge")\n                .padding(8)\n                .background(Color.red)\n                .offset(x: 3, y: 10)')
  expect(((await boxOf(drawn(page, 'Badge'))).x - before.x) * scale).toBeCloseTo(3, 0)

  // The burst was one edit: one undo takes all of it back.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => sourceInCode(page)).not.toContain('.offset(')
})

test('a selected view in a Column is still dragged to a new place in it', async ({ page }) => {
  await openInDesign(page, CARD, 'Alpha')
  await select(page, 'Alpha')
  const beta = await boxOf(drawn(page, 'Beta'))
  const alpha = await boxOf(drawn(page, 'Alpha'))
  await page.mouse.move(alpha.x + alpha.width / 2, alpha.y + alpha.height / 2)
  await page.mouse.down()
  await page.mouse.move(beta.x + beta.width / 2, beta.y + beta.height / 2, { steps: 6 })
  await page.mouse.move(beta.x + beta.width / 2, beta.y + beta.height - 1)
  await expect(page.getByTestId('device-pane')).toHaveAttribute('data-dragging', 'true')
  await page.mouse.up()
  await expect.poll(() => sourceInCode(page)).toMatch(/Text\("Beta"\)\n\s*Text\("Alpha"\)/)
})

test('in a Column the arrows along it move the view, and the arrows across it do nothing', async ({ page }) => {
  await openInDesign(page, CARD, 'Alpha')
  const original = await sourceInCode(page)
  await select(page, 'Alpha')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => sourceInCode(page)).toMatch(/Text\("Beta"\)\n\s*Text\("Alpha"\)/)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => sourceInCode(page)).toBe(original)
})

test('double-clicking a handle sets that axis back to Hug', async ({ page }) => {
  await openInDesign(page, app(`        VStack(spacing: 8) {
            Text("Alpha")
                .frame(width: 200)
                .background(Color.blue)
            Text("Beta")
        }`), 'Alpha')
  await select(page, 'Alpha')
  await expect.poll(async () => Math.round((await filled(page))!.width)).toBe(200)
  await resize(page, 'trailing').dblclick()
  await expect.poll(async () => (await filled(page))!.width).toBeLessThan(100)
  const source = await sourceInCode(page)
  expect(source).not.toContain('.frame(')
  expect(source).toContain('Text("Alpha")\n                .background(Color.blue)')
})

/** A Badge over a yellow 300 by 200 card in an Overlap that hugs them; `chain` goes on the Badge. */
const OVERLAP = (chain = '') => app(`        ZStack {
            Color.yellow
                .frame(width: 300, height: 200)
            Text("Badge")
                .padding(8)
                .background(Color.red)${chain}
        }`, `
enum Layout {
    static let nudge: CGFloat = 20
}
`)
const note = (page: Page) => page.getByTestId('design-feedback')

test('in an Overlap, the view’s body drags it by its offset, as one undo', async ({ page }) => {
  await openInDesign(page, OVERLAP(), 'Badge')
  await select(page, 'Badge')
  const scale = await points(page)
  const before = await boxOf(drawn(page, 'Badge'))
  await press(page, drawn(page, 'Badge'), { x: 30, y: 20 })
  // The draft moves it before anything is written.
  await expect.poll(async () => (await boxOf(drawn(page, 'Badge'))).x - before.x).toBeGreaterThan(20)
  await page.mouse.up()
  await idle(page)
  await expect.poll(() => sourceInCode(page)).toContain(`                .background(Color.red)\n                .offset(x: ${Math.round(30 * scale)}, y: ${Math.round(20 * scale)})`)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => sourceInCode(page)).not.toContain('.offset(')
})

test('in an Overlap, ⌘-drag still moves the view in the file', async ({ page }) => {
  await openInDesign(page, app(`        ZStack(alignment: .topLeading) {
            Text("Back")
                .padding(40)
                .background(Color.yellow)
            Text("Front")
                .padding(8)
                .background(Color.red)
        }`), 'Front')
  await select(page, 'Front')
  // Onto the top of the yellow card, past the Front over its corner: before the Back in the file.
  const pad = 40 / await points(page)
  const back = await boxOf(drawn(page, 'Back')), front = await boxOf(drawn(page, 'Front'))
  const to = { x: back.x + back.width + pad - 6, y: back.y - pad + 6 }
  await page.keyboard.down('ControlOrMeta')
  await page.mouse.move(front.x + front.width / 2, front.y + front.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y + 4, { steps: 6 })
  await page.mouse.move(to.x, to.y)
  await expect(page.getByTestId('device-pane')).toHaveAttribute('data-dragging', 'true')
  await page.mouse.up()
  await page.keyboard.up('ControlOrMeta')
  await expect.poll(() => sourceInCode(page)).toMatch(/Text\("Front"\)[\s\S]*Text\("Back"\)/)
  expect(await sourceInCode(page)).not.toContain('.offset(')
})

test('a view with no padding gets some from a grip at its edge', async ({ page }) => {
  await openInDesign(page, app(`        VStack(spacing: 8) {
            Text("Alpha")
                .background(Color.blue)
            Text("Beta")
        }`), 'Alpha')
  await select(page, 'Alpha')
  const scale = await points(page)
  // The grip shows as the pointer comes to the edge, inside the view.
  const alpha = await boxOf(drawn(page, 'Alpha'))
  await page.mouse.move(alpha.x + alpha.width / 2, alpha.y + alpha.height / 2)
  const leading = page.locator('[data-testid="padding-handle"][data-side="leading"]')
  await expect(leading).toHaveCount(0)
  await page.mouse.move(alpha.x + 2, alpha.y + alpha.height / 2)
  await expect(leading).toBeVisible()
  await press(page, leading, { x: 12, y: 0 })
  await page.mouse.up()
  await idle(page)
  await expect.poll(() => sourceInCode(page)).toContain(`Text("Alpha")\n                .padding(.leading, ${Math.round(12 * scale)})\n                .background(Color.blue)`)
})

test('the 9-dot pin on the canvas pins the view, once the Overlap is given its size', async ({ page }) => {
  await openInDesign(page, OVERLAP(), 'Badge')
  await select(page, 'Badge')
  const canvas = page.getByTestId('device-pane')
  const offer = canvas.getByRole('button', { name: 'Give the Overlap its current size', exact: true })
  // An Overlap that hugs can't take a pin: offered here, and beside the pin's reason in the Layout section.
  await expect(offer).toBeVisible()
  await expect(page.getByTestId('authoring-inspector').getByTestId('layer-layout').getByRole('button', { name: 'Give the Overlap its current size', exact: true })).toBeVisible()
  await offer.click()
  await idle(page)
  const pins = canvas.getByRole('radiogroup', { name: 'Pin on canvas', exact: true })
  await expect(pins).toBeVisible()
  // Still the Badge that is selected, in an Overlap of its drawn size.
  await expect(page.getByTestId('authoring-inspector').locator('header strong')).toHaveText('Badge')
  await pins.getByRole('radio', { name: 'Top start', exact: true }).click()
  await idle(page)
  await expect(pins.getByRole('radio', { name: 'Top start', exact: true })).toHaveAttribute('aria-checked', 'true')
  const source = await sourceInCode(page)
  expect(source).toMatch(/\}\n {8}\.frame\(width: 300, height: 200\)/)
  expect(source).toContain('                .background(Color.red)\n                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)')


})

test('a view whose offset is a token says why it can’t be dragged or nudged', async ({ page }) => {
  await openInDesign(page, OVERLAP('\n                .offset(x: Layout.nudge, y: 0)'), 'Badge')
  await select(page, 'Badge')
  await page.keyboard.press('ArrowRight')
  await expect(note(page)).toHaveText('This view’s offset is a token. Change it in the Layout section or in Code.')
  // Selecting it again clears what was said, so the drag below says it afresh.
  await page.getByTestId('render-tree').getByText('Badge', { exact: true }).click()
  await expect(page.getByText('This view’s offset is a token. Change it in the Layout section or in Code.', { exact: true })).toHaveCount(0)
  await press(page, drawn(page, 'Badge'), { x: 30, y: 0 })
  await page.mouse.up()
  await expect(note(page)).toHaveText('This view’s offset is a token. Change it in the Layout section or in Code.')
  expect(await sourceInCode(page)).toContain('                .background(Color.red)\n                .offset(x: Layout.nudge, y: 0)\n        }')
})

/** The `layer-draft` timings the canvas records, in milliseconds. */
const draftTimings = (page: Page) => page.evaluate(() => performance.getEntriesByName('layer-draft').map(entry => entry.duration))
const p95 = (samples: readonly number[]) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1]!

// A benchmark beside the behaviour checks: `npm run e2e:perf` runs it on its own.
test('a drag on a template screen comes back from each draft quickly', { tag: '@perf' }, async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Draft timings are calibrated for Chromium')
  await page.goto('/')
  await page.getByTestId('gallery-source-app').click()
  await page.getByTestId('template-folio').click()
  await page.getByTestId('template-confirm').click()
  // Book details draws a sample book too, so the list is read from the Library phone.
  const library = page.locator('[data-page-id][data-active]').getByTestId('render-tree')
  await expect(library.getByText('The Secret Garden', { exact: true })).toBeVisible()
  await idle(page)
  // ⌘-click goes straight to the title's own Text, a view drawn once in each row; the
  // row's tap target is drawn over it, and the click goes through to what is under it.
  await library.getByText('The Secret Garden', { exact: true }).click({ modifiers: ['ControlOrMeta'], force: true })
  await idle(page)
  const handle = resize(page, 'trailing')
  await expect(handle).toBeVisible()
  await page.evaluate(() => performance.clearMeasures('layer-draft'))

  const box = await boxOf(handle)
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let move = 1; move <= 30; move++) {
    await page.mouse.move(x - move * 2, y)
    // A frame between moves, as a hand gives: one draft a frame is what the canvas sends.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  }
  await page.mouse.up()
  await idle(page)

  const timings = await draftTimings(page)
  const at95 = p95(timings)
  console.log(`layer drafts: ${timings.length} laid out, p95 ${at95.toFixed(1)} ms, median ${[...timings].sort((a, b) => a - b)[Math.floor(timings.length / 2)]!.toFixed(1)} ms`)
  expect(timings.length).toBeGreaterThan(10)
  expect(at95).toBeLessThan(50)
})
