import { expect, test } from '@playwright/test'

declare global {
  interface Window { __authoringLatency?: { mode: 'selection' | 'input' | 'edit'; start: number } }
}
const records = Array.from({ length: 100 }, (_, i) => `Item(id: "${i}", title: "Record ${i}")`).join(',\n')
const helpers = Array.from({ length: 180 }, (_, i) => `struct Helper${i}: View {
 var body: some View {
  VStack(spacing: 8) {
   Text("Helper ${i}")
    .font(.body)
    .foregroundStyle(Color.blue)
   Text("Detail")
    .padding(8)
  }
  .padding()
 }
}`).join('\n')
const source = `import SwiftUI
struct Item: Identifiable { let id: String; var title: String }
@main struct LatencyApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
 let items: [Item] = [${records}]
 var body: some View { VStack { Text("Alpha"); Text("Beta"); List(items) { item in Text(item.title) } } }
}
${helpers}`
const p95 = (samples: readonly number[]) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1]!

test('authoring latency: 100 real UI samples after five warmups, 2,000 lines and 100 records', async ({ page }, info) => {
  test.setTimeout(180_000)
  expect(source.split('\n').length).toBeGreaterThan(2000)
  await page.goto('/'); await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(source)
  await expect(page.getByTestId('render-tree').getByText('Alpha', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click(); await page.getByTestId('inspect-toggle').click()
  await page.evaluate(() => {
    window.__authoringLatency = { mode: 'selection', start: 0 }
    document.addEventListener('pointerdown', event => {
      if (window.__authoringLatency?.mode === 'selection' && (event.target as Element).closest('[data-testid="logical-layers"]')) window.__authoringLatency.start = performance.now()
    }, true)
    document.addEventListener('input', event => {
      if (window.__authoringLatency?.mode === 'input' && (event.target as Element).closest('[data-testid="authoring-inspector"]')) window.__authoringLatency.start = performance.now()
    }, true)
    document.addEventListener('keydown', event => {
      if (window.__authoringLatency?.mode === 'edit' && event.key === 'Enter' && (event.target as Element).closest('[data-testid="authoring-inspector"]')) window.__authoringLatency.start = performance.now()
    }, true)
  })
  const settled = () => page.evaluate(() => new Promise<number>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!window.__authoringLatency?.start) throw new Error('No input event was measured.')
    resolve(performance.now() - window.__authoringLatency.start)
  }))))
  const samples = { selection: [] as number[], input: [] as number[], edit: [] as number[] }
  const text = page.getByTestId('authoring-inspector').getByRole('textbox', { name: 'Text', exact: true })
  // Selecting the definition keeps the two root Text layers in a bounded logical tree.
  const rows = page.getByTestId('logical-layers').locator('[data-source-name="Text"][data-source-kind="view"][data-source-owner="ContentView"]')
  for (let i = 0; i < 105; i++) {
    await rows.nth(i % 2).click()
    await expect(text).toHaveValue(i % 2 ? 'Beta' : 'Alpha')
    const elapsed = await settled(); if (i >= 5) samples.selection.push(elapsed)
  }
  await rows.first().click()
  for (let i = 0; i < 105; i++) {
    await page.evaluate(() => { window.__authoringLatency!.mode = 'input'; window.__authoringLatency!.start = 0 })
    await text.fill(`Edited ${i}`); await expect(text).toHaveValue(`Edited ${i}`)
    const input = await settled(); if (i >= 5) samples.input.push(input)
    await page.evaluate(() => { window.__authoringLatency!.mode = 'edit'; window.__authoringLatency!.start = 0 })
    await text.press('Enter')
    await expect(page.getByTestId('render-tree').getByText(`Edited ${i}`, { exact: true })).toBeVisible()
    const edit = await settled(); if (i >= 5) samples.edit.push(edit)
  }
  const report = { browser: await page.evaluate(() => navigator.userAgent), lines: source.split('\n').length, records: 100, warmups: 5, samples, p95: { selection: p95(samples.selection), input: p95(samples.input), edit: p95(samples.edit) }, method: 'Browser event timestamp until asserted visible state and two animation frames; includes automation observation overhead.' }
  await info.attach('authoring-latency.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
  expect(report.p95.selection).toBeLessThanOrEqual(100)
  expect(report.p95.input).toBeLessThanOrEqual(100)
  expect(report.p95.edit).toBeLessThanOrEqual(500)
})
