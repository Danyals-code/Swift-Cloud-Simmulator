import { expect, test, type Page } from '@playwright/test'
import { openCounter, openInDesign, replaceSource, sourceInCode } from './designer-helpers'

/**
 * Every way SwiftUI presents or pushes a screen is a screen in Design (doc 18, Wave 3b):
 * an alert, a dialog and a sheet (Wave 4b) are drawn over the screen that shows them and
 * listed under it, a sheet opened with an item is drawn with a record the screen holds,
 * and one the canvas can't draw says what it needs.
 */

const APP = `import SwiftUI

@main
struct InboxApp: App {
    var body: some Scene {
        WindowGroup { InboxScreen() }
    }
}

struct Draft: Identifiable {
    let id: Int
    let title: String
}

struct InboxScreen: View {
    @State private var drafts = [Draft(id: 1, title: "Notes")]
    @State private var opened: Draft?
    @State private var confirming = false
    @State private var archiving = false

    var body: some View {
        NavigationStack {
            List(drafts) { draft in
                Button(draft.title) { opened = draft }
            }
            .navigationTitle("Inbox")
            .sheet(item: $opened) { draft in
                DraftScreen(draft: draft)
            }
            .alert("Delete the draft?", isPresented: $confirming) {
                Button("Delete", role: .destructive) { }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("This can't be undone.")
            }
            .confirmationDialog("Archive the list?", isPresented: $archiving, titleVisibility: .visible) {
                Button("Archive all") { }
            }
        }
    }
}

struct DraftScreen: View {
    let draft: Draft

    var body: some View {
        Text("Editing \\(draft.title)")
    }
}
`

const phones = (page: Page) => page.getByTestId('gallery-page')
const phone = (page: Page, kind: string) => page.locator(`[data-testid="gallery-page"][data-page-kind="${kind}"]`)
const screenRow = (page: Page, name: string) => page.getByTestId('design-screen').getByRole('button', { name, exact: true })
const inspector = (page: Page) => page.getByTestId('authoring-inspector')
/** Opens a screen's row in the outline, to list the screens it pushes and presents. */
async function expandScreen(page: Page, name: string) {
  const toggle = page.getByTestId('design-screen').getByRole('button', { name: `Expand ${name}`, exact: true })
  if (await toggle.count()) await toggle.click()
}
const idle = (page: Page) => expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')

test('an alert, a dialog and a sheet opened with an item are screens under the screen that shows them', async ({ page }) => {
  await openInDesign(page, APP, 'Notes')
  // The list, the sheet drawn with the first draft, the alert and the dialog.
  await expect(phones(page)).toHaveCount(4)
  await expect(phone(page, 'sheet').getByTestId('render-tree')).toContainText('Editing Notes')
  // The sheet is up over the list that opens it, which is drawn behind it (Wave 4b).
  await expect(phone(page, 'sheet').locator('[data-node-id="overlay-surface"]')).toHaveCount(1)
  await expect(phone(page, 'sheet').getByTestId('render-tree')).toContainText('Inbox')
  await expect(phone(page, 'alert').getByTestId('render-tree')).toContainText('This can\'t be undone.')
  await expect(phone(page, 'dialog').getByTestId('render-tree')).toContainText('Archive all')
  await expandScreen(page, 'Inbox')
  await expect(screenRow(page, 'DraftScreen')).toBeVisible()
  await expect(screenRow(page, 'Delete the draft?')).toBeVisible()
  await expect(screenRow(page, 'Archive the list?')).toBeVisible()
  await expect(page.getByTestId('pages-not-drawn')).toHaveCount(0)
})

test('an alert’s title is selected on its page and changed where it is written', async ({ page }) => {
  await openInDesign(page, APP, 'Notes')
  await phone(page, 'alert').locator('figcaption button').click()
  // The alert's outline is drawn over the whole card; a click still finds the title under it.
  await phone(page, 'alert').getByTestId('render-tree').getByText('Delete the draft?', { exact: true }).click({ force: true })
  const words = inspector(page).getByRole('textbox', { name: 'Text', exact: true })
  await expect(words).toHaveValue('Delete the draft?')
  await words.fill('Discard the draft?')
  await words.press('Enter')
  await expect(phone(page, 'alert').getByTestId('render-tree').getByText('Discard the draft?', { exact: true })).toBeVisible()
  await idle(page)
  expect(await sourceInCode(page)).toContain('            .alert("Discard the draft?", isPresented: $confirming) {\n')
})

test('a sheet opened with an item says what it needs when the screen holds none', async ({ page }) => {
  await openInDesign(page, APP.replace('@State private var drafts = [Draft(id: 1, title: "Notes")]', '@State private var drafts: [Draft] = []'), 'Inbox')
  await expect(phones(page)).toHaveCount(3)
  await expect(page.getByTestId('pages-not-drawn')).toHaveText('1 not drawn')
  await expect(page.getByTestId('pages-not-drawn')).toHaveAttribute('title', /it needs a Draft to show, and the view holds no \[Draft\] to take one from/)
})

const ROUTES = `import SwiftUI

@main
struct LibraryApp: App {
    var body: some Scene {
        WindowGroup { LibraryScreen() }
    }
}

struct LibraryScreen: View {
    @State private var path: [String] = []
    private let recent = ["Emma"]

    var body: some View {
        NavigationStack(path: $path) {
            Button("Open Emma") { path.append("Emma") }
                .navigationTitle("Library")
                .navigationDestination(for: String.self) { title in
                    Text("Reading \\(title)")
                        .navigationTitle(title)
                }
        }
    }
}
`

test('a stack bound to a path pushes what is appended to it, and Design draws where it leads', async ({ page }) => {
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  await replaceSource(page, ROUTES)
  const preview = page.getByTestId('render-tree')
  await expect(preview.getByText('Open Emma', { exact: true })).toBeVisible()
  await page.getByTestId('live-toggle').click()
  await preview.getByRole('button', { name: 'Open Emma' }).click()
  await expect(preview.getByText('Reading Emma', { exact: true })).toBeVisible()

  await page.getByTestId('workspace-design').click()
  // The preview keeps running across the switch; stopping it shows every screen.
  await page.getByTestId('inspect-toggle').click()
  await expect(phone(page, 'destination').getByTestId('render-tree')).toContainText('Reading Emma')
  await expandScreen(page, 'Library')
  await expect(screenRow(page, 'Emma')).toBeVisible()
})
