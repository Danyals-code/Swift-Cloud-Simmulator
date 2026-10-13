import { expect, test, type Page } from '@playwright/test'

const generated = {
  name: 'ReadingApp', summary: 'A quiet place for your reading goals.',
  pages: [{ title: 'Reading', file: 'Sources/ReadingApp.swift' }],
  files: [{ path: 'Sources/ReadingApp.swift', code: 'import SwiftUI\n@main\nstruct ReadingApp: App { var body: some Scene { WindowGroup { NavigationStack { Text("A chapter a day").navigationTitle("Reading") } } } }' }],
}

test('prompt draft can be reviewed and opened without saving the API key', async ({ page }) => {
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
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('')
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
  await expect(page.getByTestId('project-name')).toHaveText('CounterApp')
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

const heritageEntry = 'import SwiftUI\n@main\nstruct HeritageApp: App { var body: some Scene { WindowGroup { HomeView() } } }\nstruct HomeView: View {\n    @State private var adding = false\n    var body: some View {\n        NavigationStack {\n            List { Button("Add site") { adding = true } }\n                .navigationTitle("Sites")\n                .sheet(isPresented: $adding) { AddSiteView() }\n        }\n    }\n}'
const addSite = (expression: string) => `import SwiftUI\nstruct AddSiteView: View {\n    let regions = ["North": 2, "South": 1]\n    var body: some View { Text(${expression}) }\n}`
const heritage = {
  name: 'HeritageApp', summary: 'Heritage sites to visit.', pages: [{ title: 'Sites', file: 'Sources/HeritageApp.swift' }],
  files: [{ path: 'Sources/HeritageApp.swift', code: heritageEntry }, { path: 'Sources/AddSiteView.swift', code: addSite('regions.first?.key ?? ""') }],
}
const repairEdit = (reply: string, expression: string) => ({ json: { edit: { reply, files: [{ path: 'Sources/AddSiteView.swift', code: addSite(expression) }], deletedFiles: [] } } })

async function generateHeritage(page: Page) {
  await page.route('**/api/generate', route => route.fulfill({ json: { app: heritage } }))
  await page.goto('/')
  await page.getByTestId('gallery-source-prompt').click()
  await page.getByLabel('App description', { exact: true }).fill('A guide to heritage sites with a form to add one.')
  await page.getByRole('combobox', { name: 'Pages', exact: true }).selectOption('1')
  await page.getByLabel('API key', { exact: true }).fill('sk-test-repair-key-123456')
  await page.getByRole('button', { name: 'Generate app', exact: true }).click()
}

test('a draft whose sheet fails in the preview is repaired automatically, with one AI request, before opening', async ({ page }) => {
  let repairs = 0
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/edit', async route => {
    repairs++
    const body = route.request().postDataJSON()
    expect(body.prompt).toContain('previewProblems')
    expect(body.previewProblems[0]).toMatchObject({ severity: 'error', file: 'Sources/AddSiteView.swift' })
    expect(body.previewProblems[0].message).toContain("has no member 'first'")
    expect(body.files.map((file: { id: string }) => file.id)).toEqual(['Sources/HeritageApp.swift', 'Sources/AddSiteView.swift'])
    expect(body.history[0].content).toContain('A guide to heritage sites with a form to add one.')
    expect(route.request().headers().authorization).toBe('Bearer sk-test-repair-key-123456')
    await held
    await route.fulfill(repairEdit('Read the first region from the sorted keys.', 'regions.keys.sorted().first ?? ""'))
  })
  await generateHeritage(page)

  // The draft and its error show while the repair works, with no click needed.
  const review = page.getByTestId('generated-review')
  await expect(review.getByRole('status')).toHaveText(/This draft has 1 preview error/)
  await expect(review.getByRole('listitem')).toHaveText(/AddSiteView\.swift:4 · Swift runtime failure: .*has no member 'first'.*opening the sheet/)
  await expect(page.getByTestId('repair-generated')).toHaveText('Fixing…')
  await expect(page.getByTestId('repair-generated')).toBeDisabled()
  await expect(page.getByTestId('repair-note')).toHaveText(/Fixing this error with one request to OpenAI/)
  release()

  await expect(review.getByRole('status')).toHaveText('Every screen passed the preview check. Review the flows after opening.')
  await expect(page.getByTestId('repair-reply')).toHaveText('AI repair: Read the first region from the sorted keys.')
  await expect(page.getByTestId('repair-generated')).toHaveCount(0)
  await expect(page.getByTestId('open-generated')).toHaveText('Open project')
  expect(repairs).toBe(1)
  await page.getByTestId('open-generated').click()
  await expect(page.getByTestId('template-gallery')).toHaveCount(0)
  await expect(page.getByTestId('render-tree').first()).toContainText('Add site')
})

test('the automatic repair runs once; another is the person’s choice', async ({ page }) => {
  let repairs = 0
  await page.route('**/api/edit', async route => {
    repairs++
    await route.fulfill(repairs === 1
      ? repairEdit('Showed the first region’s count.', 'String(regions.first?.value ?? 0)')
      : repairEdit('Read the first region from the sorted keys.', 'regions.keys.sorted().first ?? ""'))
  })
  await generateHeritage(page)

  const review = page.getByTestId('generated-review')
  await expect(page.getByTestId('repair-generated')).toHaveText('Try again with AI')
  await expect(page.getByTestId('repair-generated')).toBeEnabled()
  await expect(review.getByRole('status')).toHaveText(/This draft has 1 preview error/)
  await expect(page.getByTestId('repair-note')).toHaveText(/^Errors remain after the repair\. Sends the files/)
  await expect(page.getByTestId('repair-reply')).toHaveText('AI repair: Showed the first region’s count.')
  expect(repairs).toBe(1)

  await page.getByTestId('repair-generated').click()
  await expect(review.getByRole('status')).toHaveText('Every screen passed the preview check. Review the flows after opening.')
  expect(repairs).toBe(2)
})

test('cancelling the automatic repair keeps the draft as it was generated', async ({ page }) => {
  await page.route('**/api/edit', () => { /* never answers */ })
  await generateHeritage(page)
  const review = page.getByTestId('generated-review')
  await expect(page.getByTestId('repair-generated')).toHaveText('Fixing…')
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByTestId('repair-generated')).toHaveText('Try again with AI')
  await expect(review.getByRole('status')).toHaveText(/This draft has 1 preview error/)
  await expect(review.getByRole('alert')).toHaveCount(0)
  await expect(review.getByLabel('Generated Swift source')).toBeVisible()
  await page.getByRole('button', { name: 'AddSiteView.swift' }).click()
  await expect(review.getByLabel('Generated Swift source')).toContainText('regions.first?.key')
  await expect(page.getByTestId('open-generated')).toHaveText('Open draft')
})
