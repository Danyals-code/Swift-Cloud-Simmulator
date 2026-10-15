import { expect, test, type Locator, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * Bars, search and sheets (doc 18, Wave 4b), in Chrome and Safari alike: toolbar items added
 * from the Bars section of Screen settings and drawn where iOS draws them, a search field
 * switched on and off, a sheet drawn over the screen that opens it at its height, and an
 * empty state from the Add palette, each written as the plainest Swift.
 */

const app = (screen: string, body: string, state = '', more = '') => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { ${screen}() }
    }
}

struct ${screen}: View {
${state}    var body: some View {
${body}
    }
}
${more}`

const INBOX = app('InboxScreen', `        NavigationStack {
            List {
                Text("Groceries")
                Text("Errands")
            }
            .navigationTitle("Inbox")
        }`)

const NOTES = app('NotesScreen', `        NavigationStack {
            VStack {
                Text("All notes")
                Button("New note") { composing = true }
            }
            .navigationTitle("Notes")
            .sheet(isPresented: $composing) {
                ComposeScreen()
            }
        }`, '    @State private var composing = false\n\n', `
struct ComposeScreen: View {
    var body: some View {
        NavigationStack {
            Text("Write something")
                .navigationTitle("Compose")
        }
    }
}
`)

const canvas = (page: Page) => page.getByTestId('render-tree')
const drawn = (page: Page, text: string) => canvas(page).getByText(text, { exact: true })
const phone = (page: Page, kind: string) => page.locator(`[data-testid="gallery-page"][data-page-kind="${kind}"]`)
const inspector = (page: Page) => page.getByTestId('authoring-inspector')
const bars = (page: Page) => page.getByTestId('screen-bars')
const placed = (page: Page, name: string) => bars(page).getByRole('group', { name: `${name} toolbar items`, exact: true }).getByRole('button')
const idle = (page: Page) => expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')

/** Screen settings for the screen in focus, at its Bars section. */
async function screenSettings(page: Page) {
  await page.getByTestId('level-screen').click()
  await expect(page.getByTestId('screen-settings')).toBeVisible()
}

/** What a toolbar item's row in the Bars section says it shows, without the Group tag a group's row has. */
async function rowLabel(row: Locator): Promise<string> {
  return (await row.innerText()).split('\n')[0]!.trim()
}

/**
 * A drawn view's box, waiting out a redraw in which it briefly has none: an edit draws every
 * phone again from the start, so a box read across that redraw is of a view no longer drawn.
 */
async function boxOf(view: Locator) {
  let box: Awaited<ReturnType<Locator['boundingBox']>> = null
  await expect.poll(async () => (box = await view.boundingBox()) !== null).toBe(true)
  return box!
}

/** How far down its phone's screen a drawn view's middle sits: 0 at the top, 1 at the bottom. */
async function downTheScreen(view: Locator, screen: Locator): Promise<number> {
  const [box, frame] = [await boxOf(view), await boxOf(screen)]
  return (box.y + box.height / 2 - frame.y) / frame.height
}

/** The share of its phone's screen a drawn view's height takes. */
async function heightOf(view: Locator, screen: Locator): Promise<number> {
  const [box, frame] = [await boxOf(view), await boxOf(screen)]
  return box.height / frame.height
}

test('+ Trailing adds a button to the navigation bar, listed under Trailing and drawn in the bar', async ({ page }) => {
  await openInDesign(page, INBOX, 'Groceries')
  await screenSettings(page)
  await bars(page).getByRole('button', { name: '+ Trailing', exact: true }).click()
  await expect(placed(page, 'Trailing')).toHaveCount(1)
  const label = await rowLabel(placed(page, 'Trailing'))
  // Drawn in the navigation bar, at the top of the screen.
  const button = canvas(page).getByRole('button', { name: label, exact: true })
  await expect(button).toBeVisible()
  expect(await downTheScreen(button, canvas(page))).toBeLessThan(0.16)
  await idle(page)
  const source = await sourceInCode(page)
  expect(source).toContain('.toolbar {')
  expect(source).toContain('ToolbarItem(placement: .topBarTrailing) {')
  // On the screen's content, beside its title, not on the stack around it, where iOS shows nothing.
  expect(source).toContain('\n            .toolbar {\n')

  // Its row selects the item, whose Placement is set there.
  await screenSettings(page)
  await placed(page, 'Trailing').click()
  await expect(inspector(page).getByRole('combobox', { name: 'Placement', exact: true })).toBeVisible()
})

test('+ Bottom adds a bar at the bottom of the screen, drawn above the home indicator', async ({ page }) => {
  await openInDesign(page, INBOX, 'Groceries')
  await screenSettings(page)
  await bars(page).getByRole('button', { name: '+ Bottom', exact: true }).click()
  await expect(placed(page, 'Bottom')).toHaveCount(1)
  const label = await rowLabel(placed(page, 'Bottom'))
  const button = canvas(page).getByRole('button', { name: label, exact: true })
  await expect(button).toBeVisible()
  expect(await downTheScreen(button, canvas(page))).toBeGreaterThan(0.85)
  await idle(page)
  expect(await sourceInCode(page)).toContain('(placement: .bottomBar) {')
})

test('the Search field switch adds a search field with its prompt, and takes it away again', async ({ page }) => {
  await openInDesign(page, INBOX, 'Groceries')
  await screenSettings(page)
  const search = bars(page).getByRole('switch', { name: 'Search field', exact: true })
  await expect(search).toHaveAttribute('aria-checked', 'false')
  await search.click()
  await expect(search).toHaveAttribute('aria-checked', 'true')
  await expect(canvas(page).getByPlaceholder('Search', { exact: true })).toHaveCount(1)

  const prompt = bars(page).getByRole('textbox', { name: 'Prompt', exact: true })
  await expect(prompt).toHaveValue('Search')
  await prompt.fill('Find a list')
  await prompt.press('Enter')
  await expect(canvas(page).getByPlaceholder('Find a list', { exact: true })).toHaveCount(1)
  await idle(page)
  let source = await sourceInCode(page)
  expect(source).toContain('    @State private var searchText = ""\n')
  expect(source).toContain('.searchable(text: $searchText, prompt: "Find a list")')

  await screenSettings(page)
  await search.click()
  await expect(search).toHaveAttribute('aria-checked', 'false')
  await expect(canvas(page).getByPlaceholder('Find a list', { exact: true })).toHaveCount(0)
  await idle(page)
  source = await sourceInCode(page)
  // Nothing else reads the text it searched, so its state goes too.
  expect(source).not.toContain('.searchable')
  expect(source).not.toContain('searchText')
})

test('a search field written with no prompt shows iOS’s own, Search, as the Prompt’s placeholder, and the Prompt writes one', async ({ page }) => {
  await openInDesign(page, app('MailScreen', `        NavigationStack {
            List {
                Text("Welcome")
            }
            .navigationTitle("Mail")
            .searchable(text: $query)
        }`, '    @State private var query = ""\n\n'), 'Welcome')
  await expect(canvas(page).getByPlaceholder('Search', { exact: true })).toHaveCount(1)
  await screenSettings(page)
  const prompt = bars(page).getByRole('textbox', { name: 'Prompt', exact: true })
  await expect(prompt).toHaveValue('')
  await expect(prompt).toHaveAttribute('placeholder', 'Search')
  await prompt.fill('Find mail')
  await prompt.press('Enter')
  await expect(canvas(page).getByPlaceholder('Find mail', { exact: true })).toHaveCount(1)
  await idle(page)
  expect(await sourceInCode(page)).toContain('.searchable(text: $query, prompt: "Find mail")')
})

test('a sheet is drawn over the screen that opens it, its views are selected there, and Medium draws it at half height', async ({ page }) => {
  await openInDesign(page, NOTES, 'All notes')
  const sheet = phone(page, 'sheet'), screen = sheet.getByTestId('render-tree')
  // The opener is drawn behind it, and the sheet takes most of the screen at its usual height.
  await expect(screen.getByText('Write something', { exact: true })).toBeVisible()
  await expect(screen.getByText('All notes', { exact: true })).toHaveCount(1)
  const surface = sheet.locator('[data-node-id="overlay-surface"]')
  await expect(surface).toHaveCount(1)
  await expect.poll(() => heightOf(surface, screen)).toBeGreaterThan(0.8)
  // Listed under the screen it is shown over, which is open as the screen in focus.
  await expect(page.getByTestId('design-screen').getByRole('button', { name: 'Collapse Notes', exact: true })).toBeVisible()
  await expect(page.getByTestId('design-screen').getByRole('button', { name: 'Compose', exact: true })).toBeVisible()

  // A click on one of its views selects that view, as on any screen.
  await screen.getByText('Write something', { exact: true }).click()
  await expect(inspector(page).getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('Write something')

  await screenSettings(page)
  const height = page.getByTestId('screen-sheet').getByRole('combobox', { name: 'Height', exact: true })
  await height.selectOption({ label: 'Medium' })
  await expect.poll(() => heightOf(surface, screen)).toBeLessThan(0.6)
  await expect.poll(() => heightOf(surface, screen)).toBeGreaterThan(0.35)
  await idle(page)
  const source = await sourceInCode(page)
  // Written where the sheet is opened, on the view it shows, never inside that view's body.
  expect(source).toContain('.presentationDetents([.medium])')
  expect(source.indexOf('.presentationDetents([.medium])')).toBeGreaterThan(source.indexOf('ComposeScreen()'))
  expect(source.indexOf('.presentationDetents([.medium])')).toBeLessThan(source.indexOf('struct ComposeScreen'))
})

test('an empty state from the palette is drawn with its symbol, title and description', async ({ page }) => {
  await openInDesign(page, app('ResultsScreen', `        VStack {
            Text("Results")
        }`), 'Results')
  await drawn(page, 'Results').click()
  await page.getByTestId('add-view').click()
  await page.getByTestId('add-view-search').fill('empty')
  await page.getByTestId('add-view-empty-state').click()
  await expect(page.getByTestId('add-view-palette')).toBeHidden()
  await expect(drawn(page, 'No Results')).toBeVisible()
  await expect(drawn(page, 'Try a different search.')).toBeVisible()
  await idle(page)
  expect(await sourceInCode(page)).toContain('ContentUnavailableView("No Results", systemImage: "magnifyingglass", description: Text("Try a different search."))')
})
