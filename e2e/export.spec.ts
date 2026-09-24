import { expect, test, type Download, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
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
