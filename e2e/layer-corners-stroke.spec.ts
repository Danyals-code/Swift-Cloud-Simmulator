import { expect, test, type Locator, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * The Design panel's Corners and Stroke sections (doc 18, Wave 2): a card rounded, made a
 * capsule or given a radius at each corner, and a stroke added with its colour and width,
 * each checked on the canvas and in the Swift it writes.
 */

const CARD = 'Text("Card").padding(12).background(Color.blue)'
const app = (view: string) => `import SwiftUI
@main struct CornersApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
  var body: some View {
    VStack {
      ${view}
      Text("Other")
    }
  }
}`

const corners = (page: Page) => page.getByTestId('layer-corners')
const stroke = (page: Page) => page.getByTestId('layer-stroke')
const idle = (page: Page) => expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')

async function openCard(page: Page, view = CARD) {
  await openInDesign(page, app(view), 'Card')
  await page.getByTestId('logical-layers').getByRole('treeitem', { name: 'Card, Text', exact: true }).click()
  await expect(corners(page).getByRole('combobox', { name: 'Corner shape', exact: true })).toBeVisible()
}

/** The outline the canvas clips a layer to, as the browser reports it, or null when nothing is clipped. */
const clipped = (page: Page) => page.getByTestId('render-tree').locator('[data-node-id]').evaluateAll(elements =>
  elements.map(element => getComputedStyle(element).clipPath).find(path => !!path && path !== 'none') ?? null)

/** The first stroke the canvas draws: its colour and width. */
const stroked = (page: Page) => page.getByTestId('render-tree').locator('path').evaluateAll(paths => {
  const path = paths.find(element => (element.getAttribute('stroke') ?? 'none') !== 'none')
  return path ? { color: getComputedStyle(path).stroke, width: path.getAttribute('stroke-width') } : null
})

/** Typed into a field and applied with Enter, then the preview is waited for. */
async function type(page: Page, field: Locator, value: string) {
  await field.fill(value)
  await field.press('Enter')
  await idle(page)
}

test('a filled card’s corners are rounded on the canvas, smooth by default, and one undo squares them', async ({ page }) => {
  await openCard(page)
  expect(await clipped(page)).toBeNull()
  await type(page, corners(page).getByRole('textbox', { name: 'Corner radius', exact: true }), '12')
  // Smooth corners are curves; a circular corner would be an arc.
  await expect.poll(() => clipped(page)).toMatch(/^path\(.* C /)
  await expect(corners(page).getByRole('combobox', { name: 'Corner shape', exact: true })).toHaveValue('rounded')
  await expect(corners(page).getByRole('checkbox', { name: 'Smooth corners', exact: true })).toBeChecked()
  expect(await sourceInCode(page)).toContain(`${CARD}.clipShape(.rect(cornerRadius: 12))\n`)

  await page.getByTestId('design-undo').click()
  await expect.poll(() => clipped(page)).toBeNull()
  expect(await sourceInCode(page)).toContain(`${CARD}\n`)
})

test('a rounded card becomes a capsule, and its border follows', async ({ page }) => {
  await openCard(page, `${CARD}.clipShape(.rect(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.gray, lineWidth: 1))`)
  const before = await clipped(page)
  expect(before).toMatch(/^path\(/)
  await corners(page).getByRole('combobox', { name: 'Corner shape', exact: true }).selectOption('capsule')
  await idle(page)
  await expect.poll(() => clipped(page)).not.toBe(before)
  await expect(corners(page).getByRole('textbox', { name: 'Corner radius', exact: true })).toHaveCount(0)
  await expect(stroke(page).getByRole('combobox', { name: 'Stroke position', exact: true })).toHaveValue('inside')
  expect(await sourceInCode(page)).toContain(`${CARD}.clipShape(.capsule).overlay(Capsule().strokeBorder(Color.gray, lineWidth: 1))`)
})

test('a stroke is added, and its color and width set, drawn inside the card’s corners', async ({ page }) => {
  await openCard(page, `${CARD}.clipShape(.rect(cornerRadius: 12))`)
  await stroke(page).getByRole('button', { name: 'Add stroke', exact: true }).click()
  const width = stroke(page).getByRole('textbox', { name: 'Stroke width', exact: true })
  await expect(width).toHaveValue('1')
  await idle(page)
  await type(page, stroke(page).getByRole('textbox', { name: 'Stroke hex', exact: true }), '#FF0000')
  await type(page, stroke(page).getByRole('textbox', { name: 'Stroke width', exact: true }), '3')
  await expect.poll(() => stroked(page)).toEqual({ color: 'rgb(255, 0, 0)', width: '3' })
  expect(await sourceInCode(page)).toContain(`${CARD}.clipShape(.rect(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color(red: 1, green: 0, blue: 0), lineWidth: 3))`)

  await stroke(page).getByRole('button', { name: 'Remove stroke', exact: true }).click()
  await expect.poll(() => stroked(page)).toBeNull()
  await expect(stroke(page).getByRole('button', { name: 'Add stroke', exact: true })).toBeVisible()
})

test('each corner takes its own radius, Start and End, written in the order SwiftUI declares them', async ({ page }) => {
  await openCard(page, `${CARD}.clipShape(.rect(cornerRadius: 12))`)
  const before = await clipped(page)
  await corners(page).getByRole('button', { name: 'Corner radius on each corner', exact: true }).click()
  const topStart = corners(page).getByRole('textbox', { name: 'Corner top start', exact: true })
  await expect(topStart).toHaveValue('12')
  await type(page, topStart, '24')
  await type(page, corners(page).getByRole('textbox', { name: 'Corner bottom end', exact: true }), '0')
  await expect(corners(page).getByRole('textbox', { name: 'Corner top end', exact: true })).toHaveValue('12')
  await expect.poll(() => clipped(page)).not.toBe(before)
  expect(await sourceInCode(page)).toContain(`${CARD}.clipShape(.rect(topLeadingRadius: 24, bottomLeadingRadius: 12, topTrailingRadius: 12))`)

  // Smooth corners off is the one style written out.
  await corners(page).getByRole('checkbox', { name: 'Smooth corners', exact: true }).click()
  await expect(corners(page).getByRole('checkbox', { name: 'Smooth corners', exact: true })).not.toBeChecked()
  await expect.poll(() => clipped(page)).toMatch(/^path\(.* A /)
  expect(await sourceInCode(page)).toContain('topTrailingRadius: 12, style: .circular))')
})
