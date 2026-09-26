import { expect, test, type Download, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { PNG } from 'pngjs'
import { addModifier, cards, eventLogIn, openCounter, replaceSource } from './designer-helpers'

/** Presses Export, the complete bundle, and waits for the file. */
async function exportComplete(page: Page): Promise<Download> {
  await expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
  const waiting = page.waitForEvent('download')
  await page.getByTestId('export-button').click()
  return waiting
}

async function entriesOf(download: Download): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(readFileSync((await download.path())!)))
}

test('the exported screen images are drawn at their full size (G8)', async ({ page }) => {
  await openCounter(page)

  const download = await exportComplete(page)

  const screens = Object.entries(await entriesOf(download)).filter(([path]) => /\/Studio Report\/Screens\/[^/]+\.png$/.test(path))
  expect(screens.length).toBeGreaterThan(0)
  for (const [path, bytes] of screens) {
    const png = PNG.sync.read(Buffer.from(bytes))
    // The screen's background covers the whole image, so its far corner is drawn. An
    // image made at half its size fills only the top-left quarter and leaves it empty.
    const corner = ((png.height - 2) * png.width + png.width - 2) * 4
    expect(png.data[corner + 3], `the bottom-right corner of ${path}`).toBe(255)
  }
})

test('a text field\'s placeholder is as light in the exported screen as in the preview', async ({ page }) => {
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  await replaceSource(page, `import SwiftUI
@main struct CounterApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    @State private var name = ""
    var body: some View {
        TextField("Placeholder", text: $name)
            .padding(24)
    }
}
`)
  const field = page.getByTestId('render-tree').getByPlaceholder('Placeholder', { exact: true })
  await expect(field).toBeVisible()
  expect(await field.evaluate(input => getComputedStyle(input, '::placeholder').color)).toBe('rgba(60, 60, 67, 0.3)')
  await page.getByTestId('workspace-design').click()

  const download = await exportComplete(page)

  const [, bytes] = Object.entries(await entriesOf(download)).find(([path]) => /\/Studio Report\/Screens\/[^/]+\.png$/.test(path))!
  const png = PNG.sync.read(Buffer.from(bytes))
  // The placeholder is the only ink on the screen, and where it covers a pixel whole
  // it is iOS's placeholder colour over white: 60, 60, 67 at 30% makes 197, 197, 199.
  // Drawn black, or as strong as a label, it went far darker.
  let darkest = 255
  for (let i = 0; i < png.data.length; i += 4) darkest = Math.min(darkest, png.data[i]!, png.data[i + 1]!)
  expect(darkest).toBeGreaterThanOrEqual(190)
  expect(darkest).toBeLessThan(215)
})

test('the Export button still downloads the project while its code has an error (G6)', async ({ page }) => {
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  const broken = 'import SwiftUI\n@main struct CounterApp: App { var body: some Scene { WindowGroup { Text("Hello" } } }\n'
  await replaceSource(page, broken)
  await page.getByTestId('workspace-design').click()
  await expect(page.getByTestId('status-view')).toContainText('1 error')

  const download = await exportComplete(page)

  expect(download.suggestedFilename()).toMatch(/^CounterApp-\d{8}-\d{4}-complete\.zip$/)
  const entries = await entriesOf(download)
  const text = (suffix: string) => new TextDecoder().decode(Object.entries(entries).find(([path]) => path.endsWith(suffix))?.[1])
  expect(text('/CounterApp.swift')).toBe(broken)
  expect(text('/Studio Report/report.md')).toContain('The preview has 1 error, so no screen could be drawn')
})

test('the export carries the project’s event log, and none of the words the designer wrote (G5)', async ({ page }) => {
  // Opening the Counter replaces the untouched starter, whose events it takes over.
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  await replaceSource(page, `import SwiftUI
@main struct CounterApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        VStack {
            Text("Zanzibar")
            Text("Unchanged")
        }
    }
}
`)
  await expect(page.getByTestId('render-tree').getByText('Zanzibar', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()
  await page.getByTestId('logical-layers').locator('[data-source-name="Text"]').filter({ hasText: 'Zanzibar' }).click()
  const content = page.getByTestId('settings-basics').getByRole('textbox', { name: 'Text', exact: true })
  await expect(content).toHaveValue('Zanzibar')
  await content.fill('Quixotic')
  await content.press('Enter')
  await expect(page.getByTestId('render-tree').getByText('Quixotic', { exact: true })).toBeVisible()
  await addModifier(page, 'Opacity', 'opacity')
  await page.getByTestId('design-undo').click()
  await expect(cards(page, 'opacity')).toHaveCount(0)
  const layers = page.getByTestId('logical-layers'), unchanged = layers.locator('[data-source-name="Text"]').filter({ hasText: 'Unchanged' })
  await unchanged.click()
  await unchanged.getByRole('button', { name: 'Actions for Unchanged', exact: true }).click()
  await page.getByTestId('source-layer-actions-menu-hide').click()
  await expect(layers.getByTestId('hidden-layer')).toHaveCount(1)
  await layers.getByTestId('hidden-layer').getByTestId('layer-show').click()
  await expect(layers.getByTestId('hidden-layer')).toHaveCount(0)

  const download = await exportComplete(page)

  const { text: log, header, events: lines } = eventLogIn(readFileSync((await download.path())!))
  expect(log).not.toMatch(/Zanzibar|Quixotic|Unchanged/)
  expect(header).toMatchObject({ format: 'swift-web-studio-events', version: 1, events: lines.length, dropped: 0 })
  const events = lines.map(({ t: _t, session: _session, seq: _seq, ...event }) => event)
  expect(events).toEqual(expect.arrayContaining([
    { type: 'session', action: 'loaded', origin: 'fresh', build: expect.any(String) },
    { type: 'project', action: 'created', template: 'counter' },
    { type: 'mode', mode: 'code', preview: false },
    { type: 'code', file: expect.stringMatching(/CounterApp\.swift$/), inserted: expect.any(Number), removed: expect.any(Number), ms: expect.any(Number) },
    { type: 'design', op: 'property', layer: 'Text', control: 'content' },
    { type: 'design', op: 'modifier-add', layer: 'Text', modifier: 'opacity' },
    { type: 'history', direction: 'undo' },
    { type: 'design', op: 'hide', layer: 'Text' },
    { type: 'design', op: 'show', layer: 'Text' },
  ]))
  expect(events.at(-1)).toEqual({ type: 'export', format: 'complete' })
  const times = lines.map(line => Date.parse(String(line.t)))
  expect(times).toEqual([...times].sort((a, b) => a - b))
})
