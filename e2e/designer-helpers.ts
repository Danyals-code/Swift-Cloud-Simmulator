import { expect, type Locator, type Page } from '@playwright/test'

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
