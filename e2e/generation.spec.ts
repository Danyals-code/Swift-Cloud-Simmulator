import { expect, test, type Page } from '@playwright/test'
import { openCounter, replaceSource } from './designer-helpers'

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

type Sent = Record<string, unknown> & { readonly files?: readonly { id: string; text: string }[]; readonly previousAttempt?: { readonly problems: readonly { message: string }[] } }

/** Answers the AI route at `path` with each of `answers` in turn, and keeps what each request sent. */
async function answerInTurn(page: Page, path: string, answers: readonly ((sent: Sent) => unknown)[]) {
  const sent: Sent[] = []
  await page.route(path, async route => {
    const body = route.request().postDataJSON() as Sent
    sent.push(body)
    await route.fulfill({ json: answers[sent.length - 1]!(body) })
  })
  return sent
}

/** An edit of the counter's source: `change` is given the file that shows the count. */
const counterEdit = (change: (text: string) => string) => (sent: Sent) => {
  const file = sent.files!.find(f => f.text.includes('Count: '))!
  return { edit: { reply: 'Relabelled the count.', files: [{ path: file.id, code: change(file.text) }], deletedFiles: [] } }
}
const relabel = (text: string) => text.replace('Count: ', 'Taps so far: ')
/** A view that names something no one declared: an error the preview reports. */
const BROKEN_VIEW = '\nstruct TallyView: View {\n    var body: some View { Text(tallyLabel) }\n}\n'

/** Answers /api/edit once `answer` is called, relabelling the counter; `refuse` instead fails it. */
async function editWhenAnswered(page: Page) {
  let answer!: () => void, refuse!: () => void
  const decided = new Promise<'answer' | 'refuse'>(resolve => { answer = () => resolve('answer'); refuse = () => resolve('refuse') })
  await page.route('**/api/edit', async route => {
    const sent = route.request().postDataJSON() as Sent
    if (await decided === 'refuse') return route.abort().catch(() => {})
    await route.fulfill({ json: counterEdit(relabel)(sent) })
  })
  return { answer, refuse }
}

/** Sends a prompt from Prompt Editing, with a key for the tab. */
async function sendPrompt(page: Page) {
  await page.getByRole('tab', { name: 'Prompt Editing', exact: true }).click()
  await page.getByRole('button', { name: 'AI connection settings', exact: true }).click()
  await page.getByTestId('prompt-editor').getByLabel('API key', { exact: true }).fill('sk-test-not-a-real-key-123456')
  await page.getByLabel('Describe a change', { exact: true }).fill('Call the count taps.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

test('an AI edit holds the project until its answer lands, even with the panel collapsed (G12)', async ({ page }) => {
  const { answer } = await editWhenAnswered(page)
  await openCounter(page)
  // Something to undo, so that Undo turning off is the hold's doing.
  await page.getByTestId('workspace-develop').click()
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.insertText('// Tried in the study\n')
  await page.getByTestId('workspace-design').click()
  await expect(page.getByTestId('design-undo')).toBeEnabled()
  await sendPrompt(page)

  const banner = page.getByTestId('ai-edit-banner')
  await expect(banner).toContainText('The AI is editing this project.')
  await expect(page.getByTestId('design-undo')).toBeDisabled()
  await page.getByTestId('pane-toggle-navigator').click()
  await expect(banner).toBeVisible()
  answer()

  await expect(page.getByTestId('render-tree').getByText('Taps so far: 0', { exact: true })).toBeVisible()
  await expect(banner).toHaveCount(0)
  await expect(page.getByTestId('design-undo')).toBeEnabled()
})

test('Stop ends an AI edit at once, and its answer changes nothing (G12)', async ({ page }) => {
  const { refuse } = await editWhenAnswered(page)
  await openCounter(page)
  await sendPrompt(page)
  const banner = page.getByTestId('ai-edit-banner')
  await expect(banner).toBeVisible()

  await banner.getByRole('button', { name: 'Stop', exact: true }).click()
  refuse()

  await expect(banner).toHaveCount(0)
  await expect(page.getByTestId('prompt-editor')).toContainText('Cancelled. No changes applied.')
  await expect(page.getByTestId('render-tree').getByText('Count: 0', { exact: true })).toBeVisible()
})

test('a generated draft is kept for the tab until it is opened or thrown away, which asks first (G13)', async ({ page }) => {
  await page.route('**/api/generate', route => route.fulfill({ json: { app: generated } }))
  await page.goto('/')
  await page.getByTestId('gallery-source-prompt').click()
  await page.getByLabel('App description', { exact: true }).fill('A quiet place to track daily reading goals.')
  await page.getByRole('combobox', { name: 'Pages', exact: true }).selectOption('1')
  await page.getByLabel('API key', { exact: true }).fill('sk-test-not-a-real-key-123456')
  await page.getByRole('button', { name: 'Generate app', exact: true }).click()
  const review = page.getByTestId('generated-review')
  await expect(review).toBeVisible()

  // A click beside the sheet no longer closes it; closing it keeps the draft.
  await page.mouse.click(5, 5)
  await expect(review).toBeVisible()
  await page.getByTestId('gallery-dismiss').click()
  await expect(page.getByTestId('template-gallery')).toHaveCount(0)
  await page.getByTestId('app-icon').click()
  await page.getByTestId('gallery-source-prompt').click()
  await expect(review).toBeVisible()
  await page.reload()
  await page.getByTestId('gallery-source-prompt').click()
  await expect(review).toContainText('ReadingApp')

  await review.getByRole('button', { name: 'Back to prompt', exact: true }).click()
  await page.getByTestId('discard-draft-confirm-cancel').click()
  await expect(review).toBeVisible()
  await review.getByRole('button', { name: 'Back to prompt', exact: true }).click()
  await page.getByTestId('discard-draft-confirm-button').click()
  await expect(review).toHaveCount(0)
  await expect(page.getByLabel('App description', { exact: true })).toBeVisible()
})

test('an AI edit that breaks the preview is asked for once more, with its error, and the fixed one applies (G2)', async ({ page }) => {
  const sent = await answerInTurn(page, '**/api/edit', [counterEdit(text => relabel(text) + BROKEN_VIEW), counterEdit(relabel)])
  await openCounter(page)
  await sendPrompt(page)

  await expect(page.getByTestId('render-tree').getByText('Taps so far: 0', { exact: true })).toBeVisible()
  await expect(page.getByTestId('prompt-editor')).toContainText('Relabelled the count.')
  expect(sent).toHaveLength(2)
  expect(sent[0]!.previousAttempt).toBeUndefined()
  expect(sent[1]!.previousAttempt!.problems[0]!.message).toContain('tallyLabel')
})

test('an AI edit still broken after its second try changes nothing, and says why (G2)', async ({ page }) => {
  const sent = await answerInTurn(page, '**/api/edit', [counterEdit(text => relabel(text) + BROKEN_VIEW), counterEdit(text => relabel(text) + BROKEN_VIEW)])
  await openCounter(page)
  await sendPrompt(page)

  const editing = page.getByTestId('prompt-editor')
  await expect(editing).toContainText('still had an error after a second try, so nothing was changed')
  await expect(editing).toContainText('tallyLabel')
  await expect(page.getByTestId('render-tree').getByText('Count: 0', { exact: true })).toBeVisible()
  expect(sent).toHaveLength(2)
})

test('an error the project already had does not stop an AI edit (G2)', async ({ page }) => {
  const sent = await answerInTurn(page, '**/api/edit', [counterEdit(relabel)])
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText(BROKEN_VIEW)
  await sendPrompt(page)

  await expect(page.getByTestId('prompt-editor')).toContainText('Relabelled the count.')
  await expect(page.getByTestId('editor')).toContainText('Taps so far: ')
  expect(sent).toHaveLength(1)
})

test('an AI edit that adds a property to the app\'s data draws it at once, without Reset', async ({ page }) => {
  const addGoal = (text: string) => text
    .replace('var count = 0', 'var count = 0\n    var goal = 10')
    .replace('Text("Count: \\(tally.count)")', 'Text("Count: \\(tally.count)")\n            Text("Goal: \\(tally.goal)")')
  await answerInTurn(page, '**/api/edit', [counterEdit(addGoal)])
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  await replaceSource(page, `import SwiftUI
@Observable final class Tally {
    var count = 0
}
@main
struct CounterApp: App {
    @State private var tally = Tally()
    var body: some Scene { WindowGroup { ContentView().environment(tally) } }
}
struct ContentView: View {
    @Environment(Tally.self) private var tally
    var body: some View {
        VStack {
            Text("Count: \\(tally.count)")
            Button("Add") { tally.count += 1 }
        }
    }
}
`)
  await page.getByTestId('workspace-design').click()
  await expect(page.getByTestId('render-tree').getByText('Count: 0', { exact: true })).toBeVisible()
  await sendPrompt(page)

  // The tally the preview already held was made before `goal` existed. Drawn from it,
  // every view reading `goal` stopped until Reset, though the edit said Applied.
  await expect(page.getByTestId('render-tree').getByText('Goal: 10', { exact: true })).toBeVisible()
  await expect(page.getByTestId('render-tree').getByText(/stopped/)).toHaveCount(0)
})

test('a request the Vercel Firewall turns away says to wait, in plain words (G4)', async ({ page }) => {
  await page.route('**/api/edit', route => route.fulfill({ status: 429, contentType: 'text/html', body: '<html><body>Too Many Requests</body></html>' }))
  await openCounter(page)
  await sendPrompt(page)

  await expect(page.getByTestId('prompt-editor')).toContainText('Too many AI requests came from this network. Wait a few minutes, then try again.')
})

/** Starts Create with AI with a description and a key, for the one-page reading app. */
async function describeApp(page: Page) {
  await page.goto('/')
  await page.getByTestId('gallery-source-prompt').click()
  await page.getByLabel('App description', { exact: true }).fill('A quiet place to track daily reading goals.')
  const pages = page.getByRole('combobox', { name: 'Pages', exact: true })
  await expect(pages).toHaveValue('3')
  await pages.selectOption('1')
  await page.getByLabel('API key', { exact: true }).fill('sk-test-not-a-real-key-123456')
}
/** The reading app with its screen naming a value no one declared. */
const brokenDraft = { ...generated, files: [{ ...generated.files[0]!, code: generated.files[0]!.code.replace('Text("A chapter a day")', 'Text(chapterGoal)') }] }

test('Create with AI asks for 3 pages at first, and asks once more for a draft whose screens have an error (G2)', async ({ page }) => {
  const sent = await answerInTurn(page, '**/api/generate', [() => ({ app: brokenDraft }), () => ({ app: generated })])
  await describeApp(page)
  await page.getByRole('button', { name: 'Generate app', exact: true }).click()

  const review = page.getByTestId('generated-review')
  await expect(review).toContainText('Every screen passed the preview check.')
  await expect(page.getByLabel('Generated Swift source')).toContainText('A chapter a day')
  expect(sent).toHaveLength(2)
  expect(sent[1]!.previousAttempt!.problems[0]!.message).toContain('chapterGoal')
})

test('a draft still broken after its second try is shown with its problems, and can still be opened (G2)', async ({ page }) => {
  await answerInTurn(page, '**/api/generate', [() => ({ app: brokenDraft }), () => ({ app: brokenDraft })])
  await describeApp(page)
  await page.getByRole('button', { name: 'Generate app', exact: true }).click()

  const review = page.getByTestId('generated-review')
  await expect(review).toContainText('The preview found problems in this draft.')
  await expect(review.getByRole('listitem')).toContainText(["Cannot find 'chapterGoal' in scope (ReadingApp.swift, line 3)."])
  await expect(page.getByTestId('open-generated')).toBeEnabled()
})

test('a draft whose second request is turned away is kept, saying why, since it was paid for (G2)', async ({ page }) => {
  let requests = 0
  await page.route('**/api/generate', route => ++requests === 1
    ? route.fulfill({ json: { app: brokenDraft } })
    : route.fulfill({ status: 429, contentType: 'text/html', body: '<html><body>Too Many Requests</body></html>' }))
  await describeApp(page)
  await page.getByRole('button', { name: 'Generate app', exact: true }).click()

  const review = page.getByTestId('generated-review')
  await expect(review.getByRole('listitem')).toContainText([
    "Cannot find 'chapterGoal' in scope (ReadingApp.swift, line 3).",
    'The AI could not be asked to fix this: Too many AI requests came from this network. Wait a few minutes, then try again.',
  ])
  await expect(page.getByTestId('open-generated')).toBeEnabled()
  expect(requests).toBe(2)
})
