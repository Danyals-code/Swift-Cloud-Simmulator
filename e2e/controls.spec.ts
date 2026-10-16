import { expect, test, type Locator, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * Controls, scroll and paint (Wave 6d), in Chrome and Safari alike: a DatePicker's Style
 * writes its modifier and the canvas redraws it as iOS 27 does (grey pills, a month
 * calendar, spinning columns), a carousel's Peek writes its content margins and the next
 * card shows beside the first, and a MeshGradient paints at the size its frame gives it.
 */

const app = (screen: string, body: string, state = '') => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { ${screen}() }
    }
}

struct ${screen}: View {
${state}    var body: some View {
${body}
    }
}
`

const PLANNER = app('PlannerScreen', `        VStack(spacing: 16) {
            Text("Plans")
            DatePicker("Starts", selection: $date)
        }
        .padding()`, `    @State private var date = Date()
`)

const CARDS = app('CardsScreen', `        VStack(spacing: 16) {
            Text("Featured")
            ScrollView(.horizontal) {
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(.orange)
                        .frame(width: 300, height: 160)
                    RoundedRectangle(cornerRadius: 16)
                        .fill(.blue)
                        .frame(width: 300, height: 160)
                    RoundedRectangle(cornerRadius: 16)
                        .fill(.green)
                        .frame(width: 300, height: 160)
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
        }`)

const MESH = app('HeroScreen', `        VStack(spacing: 16) {
            MeshGradient(width: 3, height: 3, points: [
                [0, 0], [0.5, 0], [1, 0],
                [0, 0.5], [0.5, 0.5], [1, 0.5],
                [0, 1], [0.5, 1], [1, 1]
            ], colors: [.red, .purple, .indigo, .orange, .white, .blue, .yellow, .green, .mint])
            .frame(height: 200)
            Text("Below the mesh")
            Spacer()
        }`)

const tree = (page: Page) => page.getByTestId('render-tree')
const inspector = (page: Page) => page.getByTestId('authoring-inspector')
const layers = (page: Page) => page.getByTestId('logical-layers')
const idle = (page: Page) => expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
const screen = (page: Page) => tree(page).locator('[data-node-id="screen"]').first()

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

/** Selects the DatePicker in Layers, chooses `label` in its Style, and waits for the redraw. */
async function chooseStyle(page: Page, label: string) {
  await layers(page).locator('[data-source-name="DatePicker"]').click()
  const style = inspector(page).getByRole('combobox', { name: 'Style', exact: true })
  await style.selectOption({ label })
  await expect(style).toHaveValue(label)
  await idle(page)
}

test('a DatePicker’s Style writes its modifier, and the canvas redraws it as pills, a calendar and a wheel', async ({ page }) => {
  await openInDesign(page, PLANNER, 'Plans')
  const drawn = (text: string) => tree(page).getByText(text, { exact: true })
  await layers(page).locator('[data-source-name="DatePicker"]').click()
  await expect(inspector(page).getByRole('combobox', { name: 'Style', exact: true })).toHaveValue('Automatic')
  // Compact, iOS's default: the title, then the date and the time on grey capsules, with no menu chevron.
  await expect(drawn('Starts')).toBeVisible()
  await expect(tree(page).locator('[title^="chevron.up.chevron.down ("]')).toHaveCount(0)
  await expect(drawn('SUN')).toHaveCount(0)

  // Written after a view with no modifiers on its line, as Design's other settings write them.
  await chooseStyle(page, 'Graphical')
  expect(await sourceInCode(page)).toContain('            DatePicker("Starts", selection: $date).datePickerStyle(.graphical)\n')
  // The month in place, under its weekdays, and without the title, as iOS 27 draws it.
  await expect(drawn('SUN')).toBeVisible()
  await expect(drawn('SAT')).toBeVisible()
  await expect(drawn('Starts')).toHaveCount(0)

  await chooseStyle(page, 'Wheel')
  const wheel = await sourceInCode(page)
  expect(wheel).toContain('            DatePicker("Starts", selection: $date).datePickerStyle(.wheel)\n')
  expect(wheel).not.toContain('.graphical')
  // Spinning columns beside the title: the day, the hour, the minute, and AM above PM.
  await expect(drawn('Starts')).toBeVisible()
  await expect(drawn('Today')).toBeVisible()
  await expect(drawn('AM')).toBeVisible()
  await expect(drawn('PM')).toBeVisible()
  await expect(drawn('SUN')).toHaveCount(0)

  // Automatic takes the modifier away, and the capsules come back.
  await chooseStyle(page, 'Automatic')
  expect(await sourceInCode(page)).not.toContain('.datePickerStyle')
  await expect(drawn('Today')).toHaveCount(0)
  await expect(drawn('Starts')).toBeVisible()
})

test('a carousel’s Peek writes its content margins, and the next card shows beside the first', async ({ page }) => {
  await openInDesign(page, CARDS, 'Featured')
  const cards = tree(page).locator('[data-kind="shape"]')
  const scale = await points(page)
  const scroller = await boxOf(screen(page))
  const first = await boxOf(cards.nth(0))
  expect((first.x - scroller.x) * scale).toBeCloseTo(0, 0)

  await layers(page).locator('[data-source-name="ScrollView"]').click()
  const peek = inspector(page).getByRole('textbox', { name: 'Peek', exact: true })
  await expect(peek).toHaveValue('0')
  await peek.fill('24')
  await peek.press('Enter')
  await idle(page)
  expect(await sourceInCode(page)).toContain('            .scrollTargetBehavior(.viewAligned)\n            .contentMargins(.horizontal, 24, for: .scrollContent)\n')

  // The first card starts 24 points in, and the second shows in the space left beside it.
  await expect.poll(async () => ((await boxOf(cards.nth(0))).x - scroller.x) * scale).toBeCloseTo(24, 0)
  const second = await boxOf(cards.nth(1))
  expect(second.x).toBeLessThan(scroller.x + scroller.width)
  expect((second.x - scroller.x) * scale).toBeCloseTo(24 + 300 + 12, 0)

  // 0 takes the margins away.
  await layers(page).locator('[data-source-name="ScrollView"]').click()
  await expect(peek).toHaveValue('24')
  await peek.fill('0')
  await peek.press('Enter')
  await idle(page)
  expect(await sourceInCode(page)).not.toContain('.contentMargins')
})

test('a MeshGradient paints its colours at the height its frame gives it, with no labelled box', async ({ page }) => {
  await openInDesign(page, MESH, 'Below the mesh')
  await expect(tree(page).locator('[data-kind="placeholder"]')).toHaveCount(0)
  const mesh = tree(page).locator('canvas[data-mesh]')
  await expect(mesh).toBeVisible()
  const scale = await points(page)
  expect((await boxOf(mesh)).height * scale).toBeCloseTo(200, 0)
  expect((await boxOf(mesh)).width * scale).toBeCloseTo(402, 0)
  // Painted: the corners are the mesh's red and mint, not a blank or grey box.
  const corners = await mesh.evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')!
    const at = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data]
    return { topLeft: at(0, 0), bottomRight: at(canvas.width - 1, canvas.height - 1) }
  })
  expect(corners.topLeft[0]).toBeGreaterThan(200)
  expect(corners.topLeft[1]).toBeLessThan(80)
  expect(corners.bottomRight[1]).toBeGreaterThan(150)
})
