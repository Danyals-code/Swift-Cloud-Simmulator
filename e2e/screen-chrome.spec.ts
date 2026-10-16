import { expect, test, type Locator, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * Around the screen and iOS 27 chrome (Wave 6c), in Chrome and Safari alike: a floating
 * button beside a NavigationStack and a mini player under a TabView are drawn where iOS draws
 * them, and the button works; a compact popover beside them opens at its source; a search tab
 * is a Search tab at the end of the bar, as iOS 27.0 draws it, and the Search tab switch writes
 * one, with views beside the TabView too; a status item sits in the middle of the bottom bar,
 * and the Placement field moves an item there.
 */

const app = (root: string, declarations: string) => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { ${root}() }
    }
}
${declarations}`

const FLOATING = app('ListsScreen', `
struct ListsScreen: View {
    @State private var added = 0

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            NavigationStack {
                List {
                    Text("Groceries")
                    Text("Added \\(added)")
                }
                .navigationTitle("Lists")
            }
            Button("Add", systemImage: "plus") { added += 1 }
                .labelStyle(.iconOnly)
                .font(.title2)
                .foregroundStyle(.white)
                .padding()
                .background(.blue, in: .circle)
                .padding()
        }
    }
}
`)

/** A compact popover opened from near the top of a stack, with a floating + beside the stack. */
const POPOVER = app('PeopleScreen', `
struct PeopleScreen: View {
    @State private var shown = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            NavigationStack {
                VStack {
                    Button("Details") { shown = true }
                        .popover(isPresented: $shown) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Ada Lovelace")
                                    .font(.headline)
                                Text("First programmer")
                            }
                            .padding()
                            .presentationCompactAdaptation(.popover)
                        }
                    Spacer()
                }
                .navigationTitle("People")
            }
            Button("Add", systemImage: "plus") { }
                .labelStyle(.iconOnly)
                .font(.title2)
                .foregroundStyle(.white)
                .padding()
                .background(.blue, in: .circle)
                .padding()
        }
    }
}
`)

const PLAYER = app('MusicScreen', `
struct MusicScreen: View {
    var body: some View {
        VStack(spacing: 0) {
            TabView {
                Text("Listen Now").tabItem { Label("Listen", systemImage: "house") }
                Text("Library").tabItem { Label("Library", systemImage: "books.vertical") }
            }
            HStack {
                Image(systemName: "music.note")
                Text("Now Playing")
                Spacer()
                Image(systemName: "play.fill")
            }
            .padding()
            .background(.thinMaterial)
        }
    }
}
`)

/** Two tabs written as `Tab`, each showing a screen of its own; `search` adds a tab after them. */
const TABS = (search = '') => app('HomeScreen', `
struct HomeScreen: View {
    var body: some View {
        TabView {
            Tab("Inbox", systemImage: "tray") {
                InboxScreen()
            }
            Tab("Sent", systemImage: "paperplane") {
                SentScreen()
            }${search}
        }
    }
}

struct InboxScreen: View {
    var body: some View {
        NavigationStack {
            List {
                Text("Groceries")
            }
            .navigationTitle("Inbox")
        }
    }
}

struct SentScreen: View {
    var body: some View {
        NavigationStack {
            Text("Nothing sent")
                .navigationTitle("Sent")
        }
    }
}
`)

/** The same tabs with a floating + beside their TabView, in a ZStack. */
const FLOATING_TABS = TABS().replace(`        TabView {
            Tab("Inbox", systemImage: "tray") {
                InboxScreen()
            }
            Tab("Sent", systemImage: "paperplane") {
                SentScreen()
            }
        }`, `        ZStack(alignment: .bottomTrailing) {
            TabView {
                Tab("Inbox", systemImage: "tray") {
                    InboxScreen()
                }
                Tab("Sent", systemImage: "paperplane") {
                    SentScreen()
                }
            }
            Button("Add", systemImage: "plus") { }
                .labelStyle(.iconOnly)
                .padding()
                .background(.blue, in: .circle)
                .padding(.bottom, 80)
        }`)

const SEARCH_TAB = `
            Tab(role: .search) {
                NavigationStack {
                    Text("Find anything")
                        .navigationTitle("Search")
                }
            }`

const STATUS = app('MailScreen', `
struct MailScreen: View {
    var body: some View {
        NavigationStack {
            List {
                Text("Welcome")
            }
            .navigationTitle("Mail")
            .toolbar {
                ToolbarItem(placement: .status) {
                    Text("Updated just now")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Filter") { }
                }
            }
        }
    }
}
`)

/** Why the Search tab switch is read only beside tabs written with `.tabItem`. */
const TAB_ITEM_REASON = 'These tabs are written with .tabItem. Write them as Tab to add a search tab in Code.'

// Every tab's screen draws the same bar and the views beside the TabView, so read the first.
const canvas = (page: Page) => page.getByTestId('render-tree').first()
const drawn = (page: Page, text: string) => canvas(page).getByText(text, { exact: true })
const button = (page: Page, name: string) => canvas(page).getByRole('button', { name, exact: true })
const inspector = (page: Page) => page.getByTestId('authoring-inspector')
const bars = (page: Page) => page.getByTestId('screen-bars')
const placed = (page: Page, name: string) => bars(page).getByRole('group', { name: `${name} toolbar items`, exact: true }).getByRole('button')
const idle = (page: Page) => expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')

/** Screen settings for the screen in focus, at its Bars section. */
async function screenSettings(page: Page) {
  await page.getByTestId('level-screen').click()
  await expect(page.getByTestId('screen-settings')).toBeVisible()
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

/** Where a drawn view's middle sits on its phone's screen, from 0 to 1 across and down. */
async function placeOf(view: Locator, screen: Locator): Promise<{ x: number; y: number }> {
  const [box, frame] = [await boxOf(view), await boxOf(screen)]
  return { x: (box.x + box.width / 2 - frame.x) / frame.width, y: (box.y + box.height / 2 - frame.y) / frame.height }
}

test('a floating + beside a NavigationStack is drawn over the list at the bottom right, and a tap on it runs its action', async ({ page }) => {
  await openInDesign(page, FLOATING, 'Groceries')
  const add = button(page, 'Add')
  await expect(add).toBeVisible()
  const at = await placeOf(add, canvas(page))
  expect(at.x).toBeGreaterThan(0.75)
  expect(at.y).toBeGreaterThan(0.8)
  // The stack is still drawn in full around it: its title at the top, its rows under it.
  expect((await placeOf(drawn(page, 'Lists').first(), canvas(page))).y).toBeLessThan(0.25)
  await expect(drawn(page, 'Added 0')).toBeVisible()

  // Previewing, the button is on top of the list and takes the tap.
  await page.getByTestId('live-toggle').click()
  await add.click()
  await expect(drawn(page, 'Added 1')).toBeVisible()
  await add.click()
  await expect(drawn(page, 'Added 2')).toBeVisible()
})

test('a compact popover on a screen with a floating + opens at the button it comes from, not in the middle', async ({ page }) => {
  await openInDesign(page, POPOVER, 'Details')
  await page.getByTestId('live-toggle').click()
  await expect(button(page, 'Add')).toBeVisible()
  const details = button(page, 'Details')
  await details.click()
  const bubble = canvas(page).locator('[data-node-id="overlay-popover"]')
  await expect(drawn(page, 'Ada Lovelace')).toBeVisible()
  await expect(bubble).toHaveCount(1)
  const [source, shown, screen] = [await boxOf(details), await boxOf(bubble), await boxOf(canvas(page))]
  // Just under the button (or over it), its arrow touching it: never centred on the screen.
  const gap = shown.y >= source.y ? shown.y - (source.y + source.height) : source.y - (shown.y + shown.height)
  expect(gap).toBeGreaterThanOrEqual(-1)
  expect(gap / screen.height).toBeLessThan(0.05)
  expect((await placeOf(bubble, canvas(page))).y).toBeLessThan(0.4)
})

test('a mini player in a VStack under a TabView is drawn under the tab bar, which moves up to make room', async ({ page }) => {
  await openInDesign(page, PLAYER, 'Now Playing')
  const player = drawn(page, 'Now Playing')
  const tab = button(page, 'Listen')
  await expect(player).toBeVisible()
  await expect(tab).toBeVisible()
  const [playerBox, tabBox, screen] = [await boxOf(player), await boxOf(tab), await boxOf(canvas(page))]
  // Under the tab's content and its bar, at the foot of the screen, as a VStack sibling takes its height.
  expect(playerBox.y).toBeGreaterThan(tabBox.y + tabBox.height - 1)
  expect((playerBox.y - screen.y) / screen.height).toBeGreaterThan(0.8)
  await expect(drawn(page, 'Listen Now')).toBeVisible()
})

test('a search tab is drawn as iOS 27.0 draws it: a Search tab with a magnifying glass at the end of the bar, never an empty one', async ({ page }) => {
  await openInDesign(page, TABS(SEARCH_TAB), 'Groceries')
  const [inbox, sent, search] = [button(page, 'Inbox'), button(page, 'Sent'), button(page, 'Search')]
  await expect(search).toBeVisible()
  // The tab's hit target sits over its drawing, so the symbol is found in the bar, not inside the button.
  await expect(canvas(page).locator('[title^="magnifyingglass ("]')).toHaveCount(1)
  await expect(canvas(page).getByRole('button', { name: '_TabItem' })).toHaveCount(0)
  // In the bar after the other tabs, on their row and as wide as each of them.
  const [inboxBox, sentBox, searchBox] = [await boxOf(inbox), await boxOf(sent), await boxOf(search)]
  expect(searchBox.x).toBeGreaterThan(sentBox.x + sentBox.width - 1)
  expect(Math.abs((searchBox.y + searchBox.height / 2) - (sentBox.y + sentBox.height / 2))).toBeLessThan(2)
  expect(Math.abs(searchBox.width - inboxBox.width)).toBeLessThan(2)

  // A tap on it in Preview opens the search tab's screen.
  await page.getByTestId('live-toggle').click()
  await search.click()
  await expect(drawn(page, 'Find anything')).toBeVisible()
})

test('the Search tab switch adds a search tab after the app’s tabs, drawn in the bar, and takes it away again', async ({ page }) => {
  await openInDesign(page, TABS(), 'Groceries')
  await expect(button(page, 'Search')).toHaveCount(0)
  await screenSettings(page)
  const toggle = bars(page).getByRole('switch', { name: 'Search tab', exact: true })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(button(page, 'Search')).toBeVisible()
  await idle(page)
  let source = await sourceInCode(page)
  // The TabView's last tab, at its tabs' indent.
  expect(source).toContain(`            }
            Tab(role: .search) {
                NavigationStack {
                    Text("Search")
                        .navigationTitle("Search")
                }
            }
        }`)

  await screenSettings(page)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(button(page, 'Search')).toHaveCount(0)
  await idle(page)
  source = await sourceInCode(page)
  expect(source).not.toContain('role: .search')
})

test('the Search tab switch is read only, saying why, beside tabs written with .tabItem', async ({ page }) => {
  await openInDesign(page, TABS().replace('Tab("Inbox", systemImage: "tray") {\n                InboxScreen()\n            }', 'InboxScreen()\n                .tabItem { Label("Inbox", systemImage: "tray") }')
    .replace('Tab("Sent", systemImage: "paperplane") {\n                SentScreen()\n            }', 'SentScreen()\n                .tabItem { Label("Sent", systemImage: "paperplane") }'), 'Groceries')
  await screenSettings(page)
  const toggle = bars(page).getByRole('switch', { name: 'Search tab', exact: true })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(toggle).toBeDisabled()
  // Said once, under the switch, as a read-only control says why.
  await expect(bars(page).getByText(TAB_ITEM_REASON, { exact: true })).toHaveCount(1)
  await expect(toggle).not.toHaveAttribute('title')
})

test('the Search tab switch is in Bars with a floating + beside the TabView, and adds a search tab there', async ({ page }) => {
  expect(FLOATING_TABS).toContain('ZStack(alignment: .bottomTrailing) {')
  await openInDesign(page, FLOATING_TABS, 'Groceries')
  await expect(button(page, 'Add')).toBeVisible()
  await screenSettings(page)
  const toggle = bars(page).getByRole('switch', { name: 'Search tab', exact: true })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(toggle).toBeEnabled()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(button(page, 'Search')).toBeVisible()
  await expect(button(page, 'Add')).toBeVisible()
  await idle(page)
  // The TabView's last tab, at its tabs' indent inside the ZStack.
  expect(await sourceInCode(page)).toContain(`                }
                Tab(role: .search) {
                    NavigationStack {
                        Text("Search")
                            .navigationTitle("Search")
                    }
                }
            }
            Button("Add", systemImage: "plus") { }`)
})

test('the Search tab switch is in Bars with a mini player under a TabView of .tabItem tabs, read only, saying why once', async ({ page }) => {
  await openInDesign(page, PLAYER, 'Now Playing')
  await screenSettings(page)
  const toggle = bars(page).getByRole('switch', { name: 'Search tab', exact: true })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(toggle).toBeDisabled()
  await expect(bars(page).getByText(TAB_ITEM_REASON, { exact: true })).toHaveCount(1)
  await expect(toggle).not.toHaveAttribute('title')
})

test('a status item is drawn in the middle of the bottom bar, and the Placement field offers it and Navigation', async ({ page }) => {
  await openInDesign(page, STATUS, 'Welcome')
  const status = drawn(page, 'Updated just now')
  await expect(status).toBeVisible()
  const at = await placeOf(status, canvas(page))
  expect(Math.abs(at.x - 0.5)).toBeLessThan(0.05)
  expect(at.y).toBeGreaterThan(0.85)
  // Not in the trailing capsule at the top, where it was drawn before.
  expect((await placeOf(button(page, 'Filter'), canvas(page))).y).toBeLessThan(0.16)

  // Listed under Status in Bars; the Placement field offers Navigation and Status, and
  // Navigation puts Filter at the leading side of the navigation bar.
  await screenSettings(page)
  await expect(placed(page, 'Status')).toHaveCount(1)
  await placed(page, 'Trailing').click()
  const placement = inspector(page).getByRole('combobox', { name: 'Placement', exact: true })
  await expect(placement.locator('option')).toHaveText(['Leading', 'Trailing', 'Title', 'Bottom', 'Navigation', 'Status', 'Automatic'])
  await placement.selectOption({ label: 'Navigation' })
  await expect.poll(async () => (await placeOf(button(page, 'Filter'), canvas(page))).x).toBeLessThan(0.25)
  expect((await placeOf(button(page, 'Filter'), canvas(page))).y).toBeLessThan(0.16)
  await idle(page)
  expect(await sourceInCode(page)).toContain('ToolbarItem(placement: .navigation) {\n                    Button("Filter") { }')
  await screenSettings(page)
  await expect(placed(page, 'Navigation')).toHaveCount(1)
})
