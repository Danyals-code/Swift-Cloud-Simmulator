import { expect, test, type Page } from '@playwright/test'
import { openCounter, replaceSource } from './designer-helpers'

/** An app whose `ContentView` has these members. */
const app = (members: string) => `import SwiftUI
@main struct CounterApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
${members}
}`

/** Opens the studio on `source` in Code, drawn, with the preview live. */
async function openSource(page: Page, source: string, drawn: string) {
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  await replaceSource(page, source)
  await expect(page.getByTestId('render-tree').getByText(drawn).first()).toBeVisible()
  await page.getByTestId('live-toggle').click()
}

test('the preview draws text it measures on the page in a browser without Intl.Segmenter (F8)', async ({ page }) => {
  // Firefox 115-124 has no Intl.Segmenter.
  await page.addInitScript(() => { delete (Intl as { Segmenter?: unknown }).Segmenter })
  await openSource(page, app('  var body: some View { VStack { Text("Tracked").tracking(2); Text("Digits 0123").monospacedDigit() } }'), 'Tracked')
  await expect(page.getByTestId('render-tree').getByText('Digits 0123')).toBeVisible()
  await expect(page.getByText('Preview stopped')).toHaveCount(0)
  // The hidden span it measures with is removed again.
  expect(await page.evaluate(() => [...document.body.children].filter((el) => el instanceof HTMLSpanElement && el.style.left === '-100000px').length)).toBe(0)
})

/** Presses a preview button at its centre; a stopped phone is dimmed, and a locator click waits on it. */
async function tap(page: Page, name: string) {
  const box = (await page.getByTestId('render-tree').getByRole('button', { name, exact: true }).boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

/** A slider over 400 rows that each read its value, so every move costs the worker a redraw. */
const HEAVY_SLIDER = app(`  @State private var level = 0.0
  var body: some View {
    VStack {
      Text("Level \\(Int(level))")
      Slider(value: $level, in: 0...100)
      ScrollView { VStack { ForEach(0..<400, id: \\.self) { i in Text("Row \\(i) \\(Int(level) * i)") } } }
    }
  }`)

/** Drags the slider from end to end in `steps` moves, a pointer's pace apart, and calls `each` after every one. */
async function dragSlider(page: Page, steps: number, each: () => Promise<void>) {
  const box = (await page.getByTestId('render-tree').locator('input.swiftui-range').boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + 2, y)
  await page.mouse.down()
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(box.x + 2 + (box.width - 4) * step / steps, y)
    await page.waitForTimeout(16)
    await each()
  }
  await page.mouse.up()
}

test('a slider drag on a heavy screen redraws as it goes and lands where it was let go (F2)', async ({ page }) => {
  await openSource(page, HEAVY_SLIDER, 'Level 0')
  const label = page.getByTestId('render-tree').getByText(/^Level /)
  const seen = new Set<string>()
  await dragSlider(page, 60, async () => { seen.add((await label.textContent()) ?? '') })
  expect(seen.size).toBeGreaterThan(3)
  await expect(label).toHaveText('Level 100')
})

test('after the preview stops, the phone says so, and a tap starts it again from the beginning (F5)', async ({ page }) => {
  await openSource(page, app(`  @State private var count = 0
  var body: some View { VStack { Text("Count \\(count)"); Button("Add") { count += 1 } } }`), 'Count 0')
  const tree = page.getByTestId('render-tree')
  await tap(page, 'Add')
  await tap(page, 'Add')
  await expect(tree.getByText('Count 2', { exact: true })).toBeVisible()
  await page.workers()[0]!.evaluate(() => { setTimeout(() => { throw new Error('The compiler worker failed.') }, 0) })
  await expect(page.getByRole('status').filter({ hasText: 'Preview stopped' })).toContainText('Tap the phone')
  // The tap starts the app again; it is not pressed on the fresh app.
  await tap(page, 'Add')
  await expect(tree.getByText('Count 0', { exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Preview stopped' })).toHaveCount(0)
  await tap(page, 'Add')
  await expect(tree.getByText('Count 1', { exact: true })).toBeVisible()
})

test('a reset that fails says so rather than that the preview was reset (F5)', async ({ page }) => {
  await openSource(page, app('  var body: some View { Text("Ready") }'), 'Ready')
  // The worker's next pass, the reset, fails inside it.
  await page.workers()[0]!.evaluate(() => { performance.now = () => { throw new Error('The compiler worker failed.') } })
  await page.getByTestId('reset-preview').click()
  await expect(page.getByText('Could not reset the preview. Try again.')).toBeVisible()
  await expect(page.getByText('Preview reset. Your design is unchanged.')).toHaveCount(0)
})

const ECHO = app(`  @State private var name = ""
  var body: some View {
    VStack {
      TextField("Name", text: $name)
      Text("Echo [\\(name)]")
    }
  }`)

test('fast typing into a preview field keeps every character (F1)', async ({ page }) => {
  await openSource(page, ECHO, 'Echo []')
  const field = page.getByTestId('render-tree').locator('input.swiftui-field')
  await field.click()
  await page.keyboard.type('the quick brown fox jumps over the lazy dog')
  await expect(page.getByTestId('render-tree').getByText('Echo [the quick brown fox jumps over the lazy dog]')).toBeVisible()
  await expect(field).toHaveValue('the quick brown fox jumps over the lazy dog')
})

test('typing keeps every character when a view appears above the field and moves it (F1)', async ({ page }) => {
  await openSource(page, app(`  @State private var name = ""
  var body: some View {
    VStack {
      if !name.isEmpty { Text("Hello \\(name)") }
      TextField("Name", text: $name)
      Text("Say hello")
    }
  }`), 'Say hello')
  const field = page.getByTestId('render-tree').locator('input.swiftui-field')
  await field.click()
  await page.keyboard.type('the quick brown fox')
  await expect(page.getByTestId('render-tree').getByText('Hello the quick brown fox')).toBeVisible()
  await expect(field).toHaveValue('the quick brown fox')
  await expect(field).toBeFocused()
})

test('text an input method composes reaches the app whole (F1)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Composition is driven through the Chrome DevTools Protocol.')
  await openSource(page, ECHO, 'Echo []')
  const field = page.getByTestId('render-tree').locator('input.swiftui-field')
  await field.click()
  await page.keyboard.type('a')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: 'k', selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.insertText', { text: '漢字' })
  await expect(page.getByTestId('render-tree').getByText('Echo [a漢字]')).toBeVisible()
  await expect(field).toHaveValue('a漢字')
})

test("a slider's thumb follows the pointer through a drag on a heavy screen (F1)", async ({ page }) => {
  await openSource(page, HEAVY_SLIDER, 'Level 0')
  const slider = page.getByTestId('render-tree').locator('input.swiftui-range')
  const thumb: number[] = []
  await dragSlider(page, 40, async () => { thumb.push(Number(await slider.inputValue())) })
  // Moving right, it never snaps back to a value the worker drew earlier.
  expect(thumb.filter((value, i) => i > 0 && value < thumb[i - 1]!)).toEqual([])
  expect(thumb.at(-1)).toBeGreaterThan(95)
})
