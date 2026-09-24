import { expect, type Locator, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'

/** The event log an archive carries: its text, its header line, and its events (G5). */
export function eventLogIn(zip: Uint8Array): { text: string; header: Record<string, unknown>; events: Record<string, unknown>[] } {
  const entry = Object.entries(unzipSync(zip)).find(([path]) => path.endsWith('/.swiftstudio/events.jsonl'))?.[1]
  const text = entry ? new TextDecoder().decode(entry) : ''
  const [header = {}, ...events] = text.trimEnd().split('\n').filter(Boolean).map(line => JSON.parse(line))
  return { text, header, events }
}

/**
 * Replaces the whole open file through CodeMirror's own select-all.
 *
 * `fill()` selects with the DOM, which only covers the lines CodeMirror has drawn -
 * and while the Code pane is still being laid out that can be a few of them, leaving
 * the rest of the old file beside the new one.
 */
export async function replaceSource(page: Page, source: string) {
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(source)
}

/**
 * Opens the studio on the Counter example: one file, with state and two buttons.
 *
 * A fresh browser starts on the blank screen (B6). Tests written against the Counter
 * choose it from Features, the way anybody would.
 */
export async function openCounter(page: Page) {
  await page.goto('/')
  await page.getByTestId('gallery-source-feature').click()
  await page.getByTestId('template-counter').click()
  await page.getByTestId('template-confirm').click()
  await expect(page.getByTestId('template-gallery')).toHaveCount(0)
  await expect(page.getByTestId('project-name')).toHaveText('CounterApp')
  // Drawn, and idle: until then the canvas and Layers are still settling on the new
  // project, and a click can land on what was open before or be undone by the redraw.
  await expect(page.getByTestId('render-tree').getByText('Hello, World!', { exact: true }).first()).toBeVisible()
  await expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
}

export function cards(page: Page, name: string): Locator {
  return page.getByTestId('authoring-inspector').locator(`[data-testid="modifier-card"][data-modifier-name="${name}"]`)
}

export async function expandCard(card: Locator) {
  const toggle = card.locator('button[aria-expanded]').first()
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click()
}

export async function addModifier(page: Page, label: string, name: string) {
  const count = await cards(page, name).count()
  await page.getByTestId('modifier-stack').getByRole('button', { name: /Add modifier/ }).click()
  const picker = page.getByRole('dialog', { name: 'Add modifier', exact: true })
  await picker.getByRole('textbox', { name: 'Search modifiers', exact: true }).fill(label)
  await picker.getByRole('button', { name: new RegExp(`^${label}\\b`) }).click()
  await expect(cards(page, name)).toHaveCount(count + 1)
  await expect(picker).toHaveCount(0)
  await expandCard(cards(page, name).last())
}

export async function cardAction(card: Locator, label: string, action: 'Move up' | 'Move down' | 'Duplicate' | 'Remove') {
  await card.getByRole('button', { name: `${label} actions`, exact: true }).click()
  await card.page().getByRole('option', { name: action, exact: true }).click()
}

export async function assertSource(page: Page, source: string, returnToDesign = true) {
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('editor').locator('.cm-content')).toHaveText(source, { useInnerText: true })
  if (returnToDesign) await page.getByTestId('workspace-design').click()
}
