import { expect, test, type Locator, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * Charts (Wave 6e), in Chrome and Safari alike: a bar chart draws its bars to scale with
 * the month under each and the values at the trailing edge, a donut draws a sector for
 * each product with a legend below it, and the Chart's own Height in Design writes
 * `.frame(height:)` and redraws the chart at the new size.
 */

const app = (marks: string, height = 200) => `import SwiftUI
import Charts

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { SalesScreen() }
    }
}

struct Sale: Identifiable {
    let id: Int
    var month: String
    var product: String
    var amount: Double
}

struct SalesScreen: View {
    @State private var sales: [Sale] = [
        Sale(id: 1, month: "Jan", product: "Tea", amount: 40),
        Sale(id: 2, month: "Feb", product: "Coffee", amount: 60),
        Sale(id: 3, month: "Mar", product: "Juice", amount: 20),
    ]

    var body: some View {
        VStack(spacing: 16) {
            Text("Sales")
            Chart(sales) { sale in
${marks}
            }
            .frame(height: ${height})
            Text("Below the chart")
            Spacer()
        }
        .padding()
    }
}
`

const BARS = app('                BarMark(x: .value("Month", sale.month), y: .value("Sales", sale.amount))')
const DONUT = app(`                SectorMark(angle: .value("Sales", sale.amount), innerRadius: .ratio(0.6), angularInset: 1.5)
                    .foregroundStyle(by: .value("Product", sale.product))`, 240)

const tree = (page: Page) => page.getByTestId('render-tree')
const inspector = (page: Page) => page.getByTestId('authoring-inspector')
const layers = (page: Page) => page.getByTestId('logical-layers')
const idle = (page: Page) => expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
const screen = (page: Page) => tree(page).locator('[data-node-id="screen"]').first()
const drawn = (page: Page, text: string) => tree(page).getByText(text, { exact: true })

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

type Mark = { fill: string; x: number; y: number; width: number; height: number }
/**
 * The filled marks on the canvas (bars and sectors), in points from the screen's corner,
 * with their paint. Grid lines and rules are strokes with no fill, so they are left out.
 */
async function marks(page: Page): Promise<Mark[]> {
  const scale = await points(page), origin = await boxOf(screen(page))
  const found = await tree(page).locator('[data-kind="shape"], [data-kind="path"]').evaluateAll(elements => elements.flatMap(element => {
    const fill = element.querySelector('svg path')?.getAttribute('fill')
    const rect = element.getBoundingClientRect()
    return fill && fill !== 'none' && rect.width > 0 && rect.height > 0 ? [{ fill, x: rect.x, y: rect.y, width: rect.width, height: rect.height }] : []
  }))
  return found.map(mark => ({ fill: mark.fill, x: (mark.x - origin.x) * scale, y: (mark.y - origin.y) * scale, width: mark.width * scale, height: mark.height * scale }))
    // A legend's 8 pt dots are filled too, and are no marks.
    .filter(mark => Math.max(mark.width, mark.height) > 12)
}
/** Where a drawn text sits, in points from the screen's corner. */
async function placeOf(page: Page, text: string) {
  const scale = await points(page), origin = await boxOf(screen(page)), box = await boxOf(drawn(page, text))
  return { x: (box.x - origin.x) * scale, y: (box.y - origin.y) * scale, width: box.width * scale, height: box.height * scale }
}

test('a bar chart draws its bars to scale, the months under them and the values at the trailing edge, with no labelled box', async ({ page }) => {
  await openInDesign(page, BARS, 'Sales')
  await expect(tree(page).locator('[data-kind="placeholder"]')).toHaveCount(0)
  for (const month of ['Jan', 'Feb', 'Mar']) await expect(drawn(page, month)).toBeVisible()
  for (const value of ['0', '20', '40', '60']) await expect(drawn(page, value)).toBeVisible()
  // One colour, so no legend.
  await expect(drawn(page, 'Tea')).toHaveCount(0)

  const bars = (await marks(page)).sort((a, b) => a.x - b.x)
  expect(bars).toHaveLength(3)
  expect(new Set(bars.map(bar => bar.fill)).size).toBe(1)
  const [jan, feb, mar] = bars as [Mark, Mark, Mark]
  // On one baseline, as tall as their values: 40, 60 and 20.
  expect(jan.y + jan.height).toBeCloseTo(feb.y + feb.height, 0)
  expect(mar.y + mar.height).toBeCloseTo(feb.y + feb.height, 0)
  expect(feb.height / jan.height).toBeCloseTo(60 / 40, 1)
  expect(jan.height / mar.height).toBeCloseTo(40 / 20, 1)
  // Each month is centred under its bar, below the baseline.
  for (const [bar, month] of [[jan, 'Jan'], [feb, 'Feb'], [mar, 'Mar']] as const) {
    const label = await placeOf(page, month)
    expect(label.x + label.width / 2).toBeCloseTo(bar.x + bar.width / 2, 0)
    expect(label.y).toBeGreaterThanOrEqual(bar.y + bar.height)
  }
  // The values are at the trailing edge, past the last bar, with 0 level with the baseline.
  const zero = await placeOf(page, '0')
  expect(zero.x).toBeGreaterThan(mar.x + mar.width)
  expect(zero.y + zero.height / 2).toBeCloseTo(jan.y + jan.height, -1)
})

test('a donut draws a sector for each product in its own colour, with the legend below it', async ({ page }) => {
  await openInDesign(page, DONUT, 'Sales')
  await expect(tree(page).locator('[data-kind="placeholder"]')).toHaveCount(0)
  const sectors = await marks(page)
  expect(sectors).toHaveLength(3)
  expect(new Set(sectors.map(sector => sector.fill)).size).toBe(3)
  // A legend entry for each product, below the ring.
  const bottom = Math.max(...sectors.map(sector => sector.y + sector.height))
  for (const product of ['Tea', 'Coffee', 'Juice']) {
    await expect(drawn(page, product)).toBeVisible()
    expect((await placeOf(page, product)).y).toBeGreaterThan(bottom)
  }
  // No axes on a pie: the months are not drawn.
  await expect(drawn(page, 'Jan')).toHaveCount(0)
  // A ring around the middle, not a filled pie: painted between 0.6 and 1 of the radius, and the screen's own colour at the centre.
  const left = Math.min(...sectors.map(sector => sector.x)), right = Math.max(...sectors.map(sector => sector.x + sector.width))
  const top = Math.min(...sectors.map(sector => sector.y))
  const centre = { x: (left + right) / 2, y: (top + bottom) / 2 }, radius = Math.min(right - left, bottom - top) / 2
  const scale = await points(page), origin = await boxOf(screen(page))
  const clip = { x: Math.floor(origin.x + left / scale), y: Math.floor(origin.y + top / scale), width: Math.ceil((right - left) / scale), height: Math.ceil((bottom - top) / scale) }
  const shot = PNG.sync.read(await page.screenshot({ clip }))
  const ratio = shot.width / clip.width
  const pixel = (x: number, y: number) => {
    const at = (Math.round((origin.y + y / scale - clip.y) * ratio) * shot.width + Math.round((origin.x + x / scale - clip.x) * ratio)) * 4
    return [shot.data[at]!, shot.data[at + 1]!, shot.data[at + 2]!]
  }
  const same = (a: number[], b: number[]) => a.every((channel, index) => Math.abs(channel - b[index]!) < 12)
  const background = pixel(left + 2, top + 2)
  expect(same(pixel(centre.x, centre.y), background)).toBe(true)
  const ring = Array.from({ length: 8 }, (_, step) => step * Math.PI / 4 + Math.PI / 8)
    .map(angle => pixel(centre.x + Math.sin(angle) * radius * 0.8, centre.y - Math.cos(angle) * radius * 0.8))
  expect(ring.filter(colour => !same(colour, background)).length).toBeGreaterThanOrEqual(7)
})

test('the Chart’s Height in Design writes its frame, and the chart redraws at the new size', async ({ page }) => {
  await openInDesign(page, BARS, 'Sales')
  const before = { below: await placeOf(page, 'Below the chart'), jan: await placeOf(page, 'Jan'), tallest: Math.max(...(await marks(page)).map(bar => bar.height)) }

  await layers(page).locator('[data-source-name="Chart"]').click()
  // Drawn, so not locked as code the preview can't draw: its own frame is edited as any view's.
  await expect(inspector(page).getByTestId('locked-block')).toHaveCount(0)
  const layout = inspector(page).getByTestId('layer-layout')
  await expect(layout.getByRole('combobox', { name: 'Height sizing', exact: true })).toHaveValue('Fixed')
  const height = layout.getByRole('textbox', { name: 'Height', exact: true })
  await expect(height).toHaveValue('200')
  await expect(height).toBeEnabled()
  await height.fill('260')
  await height.press('Enter')
  await idle(page)

  // Changed in place, on the Chart's own frame.
  const source = await sourceInCode(page)
  expect(source).toContain('            }\n            .frame(height: 260)\n            Text("Below the chart")')
  expect(source).not.toContain('.frame(height: 200)')
  // The chart is 60 points taller: the view below it and the months move down by 60, and the bars grow.
  await expect.poll(async () => (await placeOf(page, 'Below the chart')).y - before.below.y).toBeCloseTo(60, 0)
  expect((await placeOf(page, 'Jan')).y - before.jan.y).toBeCloseTo(60, 0)
  expect(Math.max(...(await marks(page)).map(bar => bar.height))).toBeGreaterThan(before.tallest + 30)
  await expect(tree(page).locator('[data-kind="placeholder"]')).toHaveCount(0)
})
