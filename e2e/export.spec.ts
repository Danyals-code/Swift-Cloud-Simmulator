import { expect, test, type Download, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { PNG } from 'pngjs'
import { openCounter, replaceSource } from './designer-helpers'

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
