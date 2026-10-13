import { expect, test, type Page } from '@playwright/test'

/**
 * Moving views on the canvas, and the hover that goes with it.
 *
 * The bar that shows where a view will land has to agree with where it lands, in a
 * row as much as in a column, and a move that is called off must leave the file as
 * it was. Hovering is pointing: it must never rearrange the panel beside the canvas.
 */

const ROW = `import SwiftUI
@main struct MoveApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        VStack(spacing: 24) {
            HStack(spacing: 16) {
                Text("Left")
                Text("Middle")
                Text("Right")
            }
            Text("Below")
        }
    }
}`

const PUSHED = `import SwiftUI
@main struct PushApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text("Home title")
                NavigationLink("Open details") { DetailView() }
            }
        }
    }
}
struct DetailView: View {
    var body: some View {
        VStack { Text("Detail body") }
    }
}`

const FORM = `import SwiftUI
@main struct FormApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        Form {
            Section("First") {
                Text("Apples")
                Text("Pears")
            }
            Section("Second") {
                Text("Plums")
            }
        }
    }
}`

async function open(page: Page, source: string) {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(source)
  await expect(page.getByTestId('render-tree').first()).toBeVisible()
  await page.getByTestId('workspace-design').click()
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true')
}

async function source(page: Page): Promise<string> {
  await page.getByTestId('workspace-develop').click()
  const text = await page.getByTestId('editor').locator('.cm-content').innerText()
  await page.getByTestId('workspace-design').click()
  return text
}

const word = (page: Page, text: string) => page.getByTestId('render-tree').getByText(text, { exact: true })
/** Where a word is drawn, once it is: switching modes redraws the canvas. */
const centre = async (page: Page, text: string) => {
  let box: { x: number; y: number; width: number; height: number } | null = null
  // Visible, then redrawn under a compile that finishes a moment later: ask until it holds still.
  await expect.poll(async () => (box = await word(page, text).boundingBox()) !== null).toBe(true)
  const found = box!
  return { x: found.x + found.width / 2, y: found.y + found.height / 2, box: found }
}

test('a view dragged along a row lands where the bar shows, and Escape calls a move off', async ({ page }) => {
  await open(page, ROW)
  const left = await centre(page, 'Left'), right = await centre(page, 'Right')

  // Past the middle of the last item in a row: the bar stands upright after it.
  await page.mouse.move(left.x, left.y)
  await page.mouse.down()
  await page.mouse.move(right.x + right.box.width / 2 - 1, right.y, { steps: 6 })
  const line = page.getByTestId('move-line'), target = page.getByTestId('move-target')
  await expect(line).toBeVisible()
  await expect(target).toBeVisible()
  const bar = (await line.boundingBox())!
  expect(bar.height).toBeGreaterThan(bar.width)
  expect(bar.x).toBeGreaterThan(right.box.x + right.box.width - 4)
  await expect(page.getByTestId('device-pane')).toHaveAttribute('data-dragging', 'true')
  await page.mouse.up()
  await expect(line).toBeHidden()
  await expect.poll(async () => (await source(page)).replace(/\s+/g, ' ')).toContain('Text("Middle") Text("Right") Text("Left")')
  // The view that moved is what is selected, not whatever the release landed on.
  await expect(page.getByTestId('logical-layers').getByRole('treeitem', { name: 'Left, Text', exact: true })).toHaveAttribute('aria-selected', 'true')

  // Escape mid-drag puts everything back and writes nothing.
  const before = await source(page)
  const middle = await centre(page, 'Middle'), below = await centre(page, 'Below')
  await page.mouse.move(middle.x, middle.y)
  await page.mouse.down()
  await page.mouse.move(below.x, below.y + below.box.height / 2 - 1, { steps: 6 })
  await expect(line).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(line).toBeHidden()
  await expect(page.getByTestId('move-ghost')).toBeHidden()
  await page.mouse.up()
  expect(await source(page)).toBe(before)
})

test('a press without a drag selects, and moves nothing', async ({ page }) => {
  await open(page, ROW)
  const before = await source(page)
  const middle = await centre(page, 'Middle')
  await page.mouse.move(middle.x, middle.y)
  await page.mouse.down()
  await page.mouse.move(middle.x + 2, middle.y + 1)
  await page.mouse.up()
  await expect(page.getByTestId('move-line')).toBeHidden()
  await expect(page.getByTestId('logical-layers').getByRole('treeitem', { name: 'Middle, Text', exact: true })).toHaveAttribute('aria-selected', 'true')
  expect(await source(page)).toBe(before)
})

test('hovering another screen leaves the open screen and its layers where they are', async ({ page }) => {
  await open(page, PUSHED)
  // Every screen on the canvas at once, which is where the pointer crosses between them.
  const all = page.getByTestId('show-all-pages')
  if (!(await all.isChecked())) await all.check()
  await expect(word(page, 'Detail body')).toBeVisible()
  const expanded = page.getByTestId('design-screen-layers')
  await expect(expanded.getByRole('treeitem', { name: 'Home title, Text', exact: true })).toBeVisible()
  // Across the pushed screen's phone and around in it, as a pointer actually travels.
  const detail = await centre(page, 'Detail body')
  await page.mouse.move(detail.x, detail.y, { steps: 8 })
  await page.mouse.move(detail.x + 10, detail.y + 20, { steps: 4 })
  await page.waitForTimeout(300)
  await expect(expanded).toHaveCount(1)
  await expect(expanded.getByRole('treeitem', { name: 'Home title, Text', exact: true })).toBeVisible()
  await expect(page.getByTestId('design-screen-layers').getByRole('treeitem', { name: 'Detail body, Text', exact: true })).toHaveCount(0)
  // A click is what moves the focus.
  await word(page, 'Detail body').click()
  await expect(page.getByTestId('design-screen-layers').getByRole('treeitem', { name: 'Detail body, Text', exact: true })).toBeVisible()
})

test('a row carried from one section of a form to another lands there', async ({ page }) => {
  await open(page, FORM)
  const apples = await centre(page, 'Apples'), plums = await centre(page, 'Plums')
  await page.mouse.move(apples.x, apples.y)
  await page.mouse.down()
  await page.mouse.move(plums.x, plums.y + plums.box.height / 2 - 1, { steps: 8 })
  await expect(page.getByTestId('move-line')).toBeVisible()
  await page.mouse.up()
  await expect.poll(async () => (await source(page)).replace(/\s+/g, ' ')).toContain('Section("Second") { Text("Plums") Text("Apples") }')
})

test('a drag over somewhere it cannot land says so, and the view goes back when released', async ({ page }) => {
  await open(page, ROW)
  const before = await source(page)
  const left = await centre(page, 'Left')
  const canvas = (await page.getByTestId('device-pane').boundingBox())!
  await page.mouse.move(left.x, left.y)
  await page.mouse.down()
  // Off the phone, onto empty canvas.
  await page.mouse.move(canvas.x + 20, canvas.y + canvas.height / 2, { steps: 8 })
  await expect(page.getByTestId('device-pane')).toHaveAttribute('data-blocked', 'true')
  await expect(page.getByTestId('move-ghost')).toHaveAttribute('data-blocked', '')
  await expect(page.getByTestId('move-line')).toBeHidden()
  await expect(page.getByText(/Can't drop Left here/)).toBeVisible()
  await page.mouse.up()
  await expect(page.getByTestId('move-ghost')).toBeHidden()
  expect(await source(page)).toBe(before)
})
