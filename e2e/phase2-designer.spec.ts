import { expect, test, type Page } from '@playwright/test'

async function start(page: Page) {
  await page.goto('/')
  await page.getByTestId('template-blank').click()
  await page.getByTestId('template-confirm').click()
  await expect(page.getByTestId('template-gallery')).toBeHidden()
  await expect(page.getByTestId('add-screen')).toBeEnabled()
  // The blank template's one screen is already called Home.
  await expect(screenButton(page, 'Home')).toBeVisible()
  // The canvas redraws for editing once Design opens; buttons pressed meanwhile are off.
  await expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
}
async function add(page: Page, kind: string) {
  await expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByTestId('add-view')).toBeEnabled()
  await page.getByTestId('add-view').click()
  await page.getByTestId(`add-view-${kind}`).click()
  await expect(page.getByTestId('add-view-palette')).toBeHidden()
  await expect(page.getByTestId('authoring-inspector')).toHaveAttribute('aria-busy', 'false')
}
async function title(page: Page, name: string) {
  const field = page.getByTestId('settings-basics').getByRole('textbox', { name: 'Title', exact: true })
  await field.fill(name); await field.press('Enter')
  await expect(page.getByTestId('render-tree').getByRole('button', { name, exact: true })).toBeVisible()
}
/** Design's left panel: App, its screens and the focused screen's layers, in one tree. */
const navigator = (page: Page) => page.getByRole('navigation', { name: 'Layers', exact: true })
/** A screen's own button in the navigator, which opens it on the canvas. */
const screenButton = (page: Page, name: string) => navigator(page).getByTestId('design-screen').getByRole('button', { name, exact: true })
const phone = (page: Page, name: string) => page.getByTestId('gallery-page').filter({ has: page.getByRole('button', { name: `Edit ${name}`, exact: true }) })
/**
 * A screen's actions menu, which shows on the row the pointer is over.
 *
 * Once the last change has been compiled: until then its actions are disabled, and a
 * press on a disabled row is ignored rather than waited for.
 */
async function screenAction(page: Page, screen: string, action: 'Rename…' | 'Duplicate' | 'Remove screen') {
  await expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
  const row = navigator(page).getByTestId('design-screen').filter({ has: page.getByRole('button', { name: screen, exact: true }) })
  await row.hover()
  await row.getByRole('button', { name: `Actions for ${screen}`, exact: true }).click()
  await expect(page.getByRole('option', { name: action, exact: true })).toBeEnabled()
  await page.getByRole('option', { name: action, exact: true }).click()
}
/** Screens nothing navigates to yet are listed under "Not linked yet", which starts closed. */
async function showUnlinked(page: Page) {
  await navigator(page).getByRole('button', { name: 'Expand Not linked yet', exact: true }).click()
}
/** Guided "When tapped" actions save with the section's own Save button. */
async function saveInteraction(page: Page) {
  await page.getByTestId('settings-basics').getByRole('button', { name: 'Save', exact: true }).click()
}

test('screens create, rename, duplicate, remove and undo entirely in Design', async ({ page }) => {
  await start(page)
  await page.getByTestId('add-screen').click()
  const form = navigator(page).locator('form')
  await form.getByRole('textbox', { name: 'Screen name', exact: true }).fill('Club details')
  await form.getByRole('combobox', { name: 'Screen layout', exact: true }).selectOption('HStack')
  await form.getByRole('button', { name: 'Add screen', exact: true }).click()
  // A new screen is focused on the canvas, and Layers opens "Not linked yet" to show it (D13).
  await expect(phone(page, 'Club details')).toContainText('Editing')
  await expect(screenButton(page, 'Club details')).toBeEnabled()
  await phone(page, 'Club details').getByTestId('render-tree').getByText('Club details', { exact: true }).dblclick()
  await page.getByRole('textbox', { name: 'Canvas text', exact: true }).fill('Campus Design Club')
  await page.getByRole('textbox', { name: 'Canvas text', exact: true }).press('Enter')
  await expect(phone(page, 'Club details').getByTestId('render-tree').getByText('Campus Design Club', { exact: true })).toBeVisible()
  // Renaming the start screen changes its name everywhere Design shows it.
  await screenAction(page, 'Home', 'Rename…')
  await form.getByRole('textbox', { name: 'Screen name', exact: true }).fill('Club home')
  await form.getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(screenButton(page, 'Club home')).toBeEnabled()
  await expect(screenButton(page, 'Home')).toHaveCount(0)
  await screenAction(page, 'Club details', 'Duplicate')
  await expect(screenButton(page, 'Club details copy')).toBeEnabled()
  // Screens are listed in the order the app reaches them, with unlinked ones after
  // in the order they were made; there is no manual reordering any more.
  await expect(navigator(page).getByTestId('design-screen')).toHaveText(['Club home', 'Club details', 'Club details copy'])
  await screenAction(page, 'Club details copy', 'Remove screen')
  await expect(screenButton(page, 'Club details copy')).toHaveCount(0)
  await page.getByTestId('design-undo').click()
  await expect(screenButton(page, 'Club details copy')).toBeEnabled()
  await expect(page.getByTestId('save-indicator')).toContainText('Saved locally')
  await page.reload()
  await page.getByRole('button', { name: 'Close welcome screen', exact: true }).click()
  await expect(screenButton(page, 'Club home')).toBeEnabled()
  await showUnlinked(page)
  await expect(screenButton(page, 'Club details')).toBeEnabled()
  await screenButton(page, 'Club details').click()
  await expect(phone(page, 'Club details')).toContainText('Editing')
  await expect(phone(page, 'Club details').getByTestId('render-tree').getByText('Campus Design Club', { exact: true })).toBeVisible()
})

test('builds a three-screen club flow with custom color, image, navigation, sheet and independent value', async ({ page }) => {
  test.setTimeout(120_000)
  await start(page)
  await add(page, 'text')
  const text = page.getByTestId('settings-basics').getByRole('textbox', { name: 'Text', exact: true })
  await text.fill('Campus Design Club'); await text.press('Enter')
  // A custom colour, saved as a shared colour token and linked in the same place.
  await page.getByRole('button', { name: '+ Text color', exact: true }).click()
  const color = page.locator('[data-testid="modifier-card"][data-modifier-name="foregroundStyle"]')
  await color.getByRole('textbox', { name: 'Custom color hex', exact: true }).fill('#6D28D9')
  await color.getByRole('textbox', { name: 'Custom color hex', exact: true }).press('Enter')
  await expect(page.getByTestId('render-tree').getByText('Campus Design Club', { exact: true })).toHaveCSS('color', 'rgb(109, 40, 217)')
  await color.getByRole('button', { name: 'Save as token…', exact: true }).click()
  await color.getByRole('textbox', { name: 'New token name', exact: true }).fill('clubBrand')
  await color.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(color.getByRole('combobox', { name: 'Text color token', exact: true })).toHaveValue('clubBrand')
  await expect(page.getByTestId('render-tree').getByText('Campus Design Club', { exact: true })).toHaveCSS('color', 'rgb(109, 40, 217)')
  // Images belong to the App, whose settings list the bundled ones.
  await page.getByTestId('level-app').click()
  await expect(page.getByTestId('tokens-color').getByTestId('token-row')).toHaveAttribute('data-token', 'clubBrand')
  await page.getByLabel('Add bundled image', { exact: true }).setInputFiles('tests/fixtures/authoring-photo.png')
  await expect(page.getByTestId('project-resources').getByText(/authoring_photo|authoring-photo/).first()).toBeVisible()
  await add(page, 'image')
  await page.getByRole('combobox', { name: 'Bundled image', exact: true }).selectOption({ index: 1 })
  await expect(page.getByTestId('render-tree').locator('img')).toHaveCount(1)
  await add(page, 'button'); await title(page, 'Details')
  await page.getByRole('combobox', { name: 'On tap', exact: true }).selectOption('navigate')
  await page.getByRole('combobox', { name: 'Interaction screen', exact: true }).selectOption('__new')
  await page.getByRole('textbox', { name: 'Interaction screen name', exact: true }).fill('Club details')
  await saveInteraction(page)
  await expect(screenButton(page, 'Club details')).toBeEnabled()
  await screenButton(page, 'Home').click()
  await add(page, 'button'); await title(page, 'Join')
  await page.getByRole('combobox', { name: 'On tap', exact: true }).selectOption('sheet')
  await page.getByRole('combobox', { name: 'Interaction screen', exact: true }).selectOption('__new')
  await page.getByRole('textbox', { name: 'Interaction screen name', exact: true }).fill('Welcome')
  await saveInteraction(page)
  // A sheet is listed under Sheets, apart from the screens pushed in the stack.
  await navigator(page).getByRole('button', { name: 'Expand Sheets', exact: true }).click()
  await expect(screenButton(page, 'Welcome')).toBeEnabled()
  await screenButton(page, 'Home').click()
  await add(page, 'button'); await title(page, 'Subscribe')
  await page.getByRole('combobox', { name: 'On tap', exact: true }).selectOption('toggle')
  await page.getByRole('combobox', { name: 'Interaction value', exact: true }).selectOption('__new')
  await page.getByRole('textbox', { name: 'Interaction value name', exact: true }).fill('subscribed')
  await page.getByRole('textbox', { name: 'Button label when on', exact: true }).fill('Subscribed')
  await saveInteraction(page)
  await expect(page.getByTestId('settings-basics').getByRole('textbox', { name: /Title · when subscribed/ })).toHaveValue('Subscribed')
  await page.getByTestId('live-toggle').click()
  await expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
  await page.getByTestId('render-tree').getByRole('button', { name: 'Subscribe', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Subscribed', { exact: true })).toBeVisible()
  await page.getByTestId('render-tree').getByRole('button', { name: 'Details', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Club details', { exact: true }).first()).toBeVisible()
  await page.getByTestId('reset-preview').click()
  await page.getByTestId('render-tree').getByRole('button', { name: 'Join', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Welcome', { exact: true }).first()).toBeVisible()
  await page.getByTestId('inspect-toggle').click()
  // Three screens: Home, the one it pushes and the sheet it presents.
  await expect(page.getByTestId('gallery-page')).toHaveCount(3)
  await expect(navigator(page).getByTestId('design-screen')).toHaveText(['Home', 'Club details', 'Welcome'])
})

test('renames, duplicates and groups layers with a visible move destination and undo', async ({ page }) => {
  await start(page)
  await add(page, 'text')
  const tree = page.getByTestId('logical-layers')
  await tree.getByRole('button', { name: 'Actions for Text', exact: true }).click()
  await page.getByRole('option', { name: 'Rename layer…', exact: true }).click()
  await page.getByRole('textbox', { name: 'Layer name', exact: true }).fill('Club heading')
  await page.getByRole('button', { name: 'Save layer name', exact: true }).click()
  // A layer's actions are disabled while the rename is compiled, and a press on a
  // disabled row is ignored rather than waited for; under load that can be a while.
  await expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
  await tree.getByRole('button', { name: 'Actions for Club heading', exact: true }).click()
  // Named with its shortcut: "Duplicate ⌘D".
  await expect(page.getByRole('option', { name: /^Duplicate/ })).toBeEnabled()
  await page.getByRole('option', { name: /^Duplicate/ }).click()
  await expect(tree.locator('[data-source-name="Text"]')).toHaveCount(2)
  await tree.locator('[data-source-name="Text"]').first().click()
  await tree.locator('[data-source-name="Text"]').last().click({ modifiers: ['Shift'] })
  await page.getByRole('button', { name: 'Group in Column', exact: true }).click()
  await expect(tree.locator('[data-source-name="VStack"]')).toHaveCount(2)
  await page.getByTestId('design-undo').click()
  await expect(tree.locator('[data-source-name="VStack"]')).toHaveCount(1)
  await expect(tree.locator('[data-source-name="Text"]')).toHaveCount(2)
  await tree.locator('[data-source-name="Text"]').last().click()
  await add(page, 'hstack')
  await tree.locator('[data-source-name="Text"]').first().click()
  await tree.getByRole('button', { name: 'Actions for Club heading', exact: true }).click()
  await page.getByRole('option', { name: 'Move into…', exact: true }).click()
  await page.getByRole('combobox', { name: 'Destination container', exact: true }).selectOption({ label: 'Row · container 1' })
  await page.getByRole('button', { name: 'Move layers', exact: true }).click()
  await expect(page.getByTestId('design-feedback')).toHaveText('Design updated.')
  await expect(page.getByRole('alert')).not.toContainText('cannot')
  // Collapse and expand all belong to the Layers panel of the three-panel layout.
  await page.getByTestId('navigator-layout-split').click()
  await tree.getByRole('button', { name: 'Collapse all layers', exact: true }).click()
  await tree.getByRole('button', { name: 'Expand all layers', exact: true }).click()
  await expect(tree.getByRole('treeitem', { name: 'Club heading, Text', exact: true })).toHaveAttribute('aria-level', '3')
})
