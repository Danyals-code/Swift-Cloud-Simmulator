import { expect, test } from '@playwright/test'

const generated = {
  name: 'ReadingApp', summary: 'A quiet place for your reading goals.',
  pages: [{ title: 'Reading', file: 'Sources/ReadingApp.swift' }],
  files: [{ path: 'Sources/ReadingApp.swift', code: 'import SwiftUI\n@main\nstruct ReadingApp: App { var body: some Scene { WindowGroup { NavigationStack { Text("A chapter a day").navigationTitle("Reading") } } } }' }],
}

test('prompt draft can be reviewed and opened, with the API key kept for this tab and nowhere else (G3)', async ({ page }) => {
  await page.route('**/api/generate', async route => {
    expect(route.request().postDataJSON()).toMatchObject({ pageCount: 1, provider: 'openai' })
    await route.fulfill({ json: { app: generated } })
  })
  await page.goto('/')
  await page.getByTestId('gallery-source-prompt').click()
  await page.getByLabel('App description', { exact: true }).fill('A quiet place to track daily reading goals.')
  await page.getByRole('combobox', { name: 'Pages', exact: true }).selectOption('1')
  await page.getByLabel('API key', { exact: true }).fill('sk-test-never-persist-this-value')
  await page.getByRole('button', { name: 'Generate app', exact: true }).click()
  await expect(page.getByTestId('generated-review')).toBeVisible()
  await expect(page.getByLabel('Generated Swift source')).toContainText('A chapter a day')
  await expect(page.getByTestId('project-name')).not.toHaveText('ReadingApp')
  await page.getByTestId('open-generated').click()
  await expect(page.getByTestId('template-gallery')).toHaveCount(0)
  await expect(page.getByTestId('render-tree')).toContainText('A chapter a day')
  await page.getByTestId('app-icon').click()
  await page.getByTestId('gallery-source-prompt').click()
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('sk-test-never-persist-this-value')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByRole('tab', { name: 'Prompt Editing', exact: true }).click()
  await page.getByRole('button', { name: 'AI connection settings', exact: true }).click()
  await expect(page.getByTestId('prompt-editor').getByLabel('API key', { exact: true })).toHaveValue('sk-test-never-persist-this-value')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('never-persist-this-value')
})

test('provider errors keep the prompt and existing project intact', async ({ page }) => {
  await page.route('**/api/generate', route => route.fulfill({ status: 401, json: { error: 'Check your API key.' } }))
  await page.goto('/')
  await page.getByTestId('gallery-source-prompt').click()
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('anthropic')
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('claude-sonnet-5')
  await page.getByLabel('App description', { exact: true }).fill('A project planner with tasks and weekly summaries.')
  await page.getByLabel('API key', { exact: true }).fill('sk-ant-test-not-a-real-key')
  await page.getByRole('button', { name: 'Generate app', exact: true }).click()
  await expect(page.getByTestId('prompt-creator').getByRole('alert')).toHaveText('Check your API key.')
  await expect(page.getByLabel('App description', { exact: true })).toHaveValue('A project planner with tasks and weekly summaries.')
  await expect(page.getByTestId('project-name')).toHaveText('MyDesignApp')
})

test('generation can be cancelled without opening a project', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/generate', async route => { await pending; await route.abort().catch(() => {}) })
  await page.goto('/')
  await page.getByTestId('gallery-source-prompt').click()
  await page.getByLabel('App description', { exact: true }).fill('A simple tracker with an overview and history page.')
  await page.getByLabel('API key', { exact: true }).fill('sk-test-not-a-real-key-123456')
  await page.getByRole('button', { name: 'Generate app', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel generation', exact: true }).click()
  release()
  await expect(page.getByRole('button', { name: 'Generate app', exact: true })).toBeEnabled()
  await expect(page.getByTestId('generated-review')).toHaveCount(0)
})

test('both AI panels share one connection for the tab, whichever was open first (G3)', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('gallery-cancel').click()
  await page.getByRole('tab', { name: 'Prompt Editing', exact: true }).click()
  await page.getByRole('button', { name: 'AI connection settings', exact: true }).click()
  const editing = page.getByTestId('prompt-editor')
  await expect(editing.getByLabel('API key', { exact: true })).toHaveValue('')

  await page.getByTestId('app-icon').click()
  await page.getByTestId('gallery-source-prompt').click()
  // Prompt Editing's fields carry the same names behind the sheet, so these are Create with AI's.
  const creating = page.getByTestId('prompt-creator')
  await creating.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('anthropic')
  await creating.getByLabel('API key', { exact: true }).fill('sk-ant-test-not-a-real-key')
  await page.getByTestId('gallery-dismiss').click()

  await expect(editing.getByRole('combobox', { name: 'Provider', exact: true })).toHaveValue('anthropic')
  await expect(editing.getByLabel('API key', { exact: true })).toHaveValue('sk-ant-test-not-a-real-key')
})
