import { expect, test, type Locator, type Page } from '@playwright/test'
import { assertSource } from './designer-helpers'

const SOURCE = `import SwiftUI
struct Book: Identifiable { let id: String; let title: String }
@main struct LayersApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    @State private var books: [Book] = [Book(id: "one", title: "First book"), Book(id: "two", title: "Second book")]
    @State private var count = 0
    @State private var showExtra = false
    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Text("Library heading")
                Text("Count: \\(count)")
                Button("Increase") { count += 1 }
                List {
                    Section("Books") {
                        ForEach(books) { book in
                            NavigationLink { Text("Book detail") } label: {
                                BookRow(title: book.title)
                            }
                        }
                    }
                }
                if showExtra { Text("Extra detail") }
            }
            .navigationTitle("Library")
        }
    }
}
struct BookRow: View {
    let title: String
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "book")
            Text(title).padding(6)
        }
    }
}`

async function open(page: Page, source = SOURCE) {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.fill(source)
  await expect(page.getByTestId('render-tree').getByText('First book', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()
  await page.getByTestId('inspect-toggle').click()
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true')
}

const layers = (page: Page) => page.getByTestId('logical-layers')
const row = (page: Page, name: string) => layers(page).locator(`[data-source-name="${name}"]`)
const title = (page: Page) => row(page, 'Text').filter({ hasText: 'Library heading' })
const hovered = (page: Page) => layers(page).locator('[data-hovered="true"]')
const highlights = (page: Page) => page.getByTestId('inspect-highlight')

async function expectOverlayMatches(overlay: Locator, target: Locator) {
  const rect = await target.boundingBox()
  expect(rect).not.toBeNull()
  await expect.poll(async () => {
    const frame = await overlay.boundingBox()
    return !!frame && !!rect && ['x', 'y', 'width', 'height'].every(key => Math.abs(frame[key as keyof typeof frame] - rect[key as keyof typeof rect]) < 2)
  }).toBe(true)
}

async function expectRowHighlights(page: Page, rows: Locator, parts: readonly Locator[]) {
  await expect.poll(() => highlights(page).count()).toBeGreaterThan(0)
  const frames = await highlights(page).evaluateAll(elements => elements.map(element => {
    const bounds = element.getBoundingClientRect()
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  }))
  const rowFrames = await Promise.all((await rows.all()).map(element => element.boundingBox()))
  const contains = (outer: { x: number; y: number; width: number; height: number }, inner: typeof outer) => outer.x <= inner.x + 2 && outer.y <= inner.y + 2 && outer.x + outer.width >= inner.x + inner.width - 2 && outer.y + outer.height >= inner.y + inner.height - 2
  // A transparent stack can draw separate outlines around its painted children.
  // All of its visible content must be covered, with no unrelated row outlined.
  for (const part of parts) {
    await expect(part).toBeVisible()
    const bounds = await part.boundingBox()
    expect(bounds).not.toBeNull()
    expect(frames.some(frame => contains(frame, bounds!))).toBe(true)
  }
  for (const frame of frames) expect(rowFrames.some(bounds => bounds && contains(bounds, frame))).toBe(true)
}

test('primary Layers contains visual views while repetition, navigation and visibility stay in Settings', async ({ page }) => {
  await open(page)
  await expect(layers(page).locator('[data-source-kind="definition"], [data-source-kind="template"], [data-source-kind="branch"]')).toHaveCount(0)
  for (const name of ['ForEach', 'Section', 'NavigationLink', 'NavigationStack', 'WindowGroup']) await expect(row(page, name)).toHaveCount(0)
  await expect(row(page, 'List')).toHaveCount(1)
  await expect(row(page, 'BookRow')).toHaveCount(1)
  await expect(title(page)).toBeVisible()
  await expect(layers(page)).not.toContainText('Components')
  await expect(layers(page)).not.toContainText('First book')
  await expect(layers(page)).not.toContainText('Second book')

  await row(page, 'List').click()
  await expect(page.getByTestId('settings-data')).toContainText('Repeat for each item')
  await expect(page.getByTestId('settings-data').getByRole('button', { name: 'Edit row design', exact: true })).toBeVisible()
  const data = page.getByTestId('settings-data')
  await data.getByLabel('Record edit scope').selectOption('app')
  await data.getByLabel('Record title', { exact: true }).fill('Edited book')
  await data.getByRole('button', { name: 'Apply app initial data', exact: true }).click()
  await expect(page.getByTestId('render-tree').getByText('Edited book', { exact: true })).toBeVisible()
  await expect(page.getByTestId('render-tree').getByText('Second book', { exact: true })).toBeVisible()
  await row(page, 'BookRow').click()
  await expect(page.getByTestId('settings-data')).toContainText('Repeat for each item')
  await expect(page.getByTestId('settings-context')).toContainText('Navigation')
  const extra = row(page, 'Text').filter({ hasText: 'Extra detail' })
  await extra.click()
  await expect(page.getByTestId('settings-context')).toContainText('Visibility')
  await expect(page.getByTestId('settings-context')).toContainText('showExtra')
  await assertSource(page, SOURCE.replace('title: "First book"', 'title: "Edited book"'))
})

test('Arrange hover connects canvas and primary Layers without selecting or running actions', async ({ page }) => {
  await open(page)
  const preview = page.getByTestId('render-tree')
  const button = row(page, 'Button')
  await title(page).click()
  await preview.getByRole('button', { name: 'Increase', exact: true }).hover()
  await expect(button).toHaveAttribute('data-hovered', 'true')
  await expect(button).toHaveAttribute('aria-selected', 'false')
  await expect(title(page)).toHaveAttribute('aria-selected', 'true')
  await expect(highlights(page)).toHaveCount(1)
  await expectOverlayMatches(highlights(page), preview.getByRole('button', { name: 'Increase', exact: true }))

  await button.hover()
  await expect(highlights(page)).toHaveCount(1)
  await expectOverlayMatches(highlights(page), preview.getByRole('button', { name: 'Increase', exact: true }))
  await expect(button).toHaveAttribute('data-hovered', 'true')
  await expect(preview.getByText('Count: 0', { exact: true })).toBeVisible()
  await expect(page.getByTestId('settings-basics').getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('Library heading')
  await page.getByTestId('toolbar').hover()
  await expect(hovered(page)).toHaveCount(0)
  await expect(highlights(page)).toHaveCount(0)
  await expect(title(page)).toHaveAttribute('aria-selected', 'true')
  await assertSource(page, SOURCE)
})

test('a repeated visual component highlights every rendered row and either row resolves back to it', async ({ page }) => {
  await open(page)
  const book = row(page, 'BookRow')
  const preview = page.getByTestId('render-tree')
  await book.hover()
  await expect(book).toHaveAttribute('data-hovered', 'true')
  const icons = preview.getByRole('img', { name: 'Image(systemName: "book")', exact: true })
  await expect(icons).toHaveCount(2)
  await expectRowHighlights(page, preview.getByRole('button', { name: /First book|Second book/ }), [
    preview.getByText('First book', { exact: true }), preview.getByText('Second book', { exact: true }),
    ...await icons.all(),
  ])
  for (const name of ['First book', 'Second book']) {
    await preview.getByRole('button', { name: new RegExp(name) }).hover()
    await expect(book).toHaveAttribute('data-hovered', 'true')
    await expect(hovered(page)).toHaveCount(1)
  }
  await page.getByTestId('toolbar').hover()
  await expect(highlights(page)).toHaveCount(0)
  await expect(hovered(page)).toHaveCount(0)
  await assertSource(page, SOURCE)
})

test('hover clears when leaving Layers and does not outline an unrendered conditional view', async ({ page }) => {
  await open(page)
  await title(page).hover()
  await expect(highlights(page)).toHaveCount(1)
  await page.getByLabel('Filter design layers').fill('Extra detail')
  const extra = row(page, 'Text').filter({ hasText: 'Extra detail' })
  await extra.hover()
  await expect(highlights(page)).toHaveCount(0)
  await page.getByLabel('Filter design layers').press('Escape')
  await title(page).hover()
  await expect(highlights(page)).toHaveCount(1)
  await page.getByTestId('live-toggle').click()
  await expect(highlights(page)).toHaveCount(0)
  await expect(hovered(page)).toHaveCount(0)
  await title(page).hover()
  await expect(highlights(page)).toHaveCount(0)
  await page.getByTestId('inspect-toggle').click()
  await expect(highlights(page)).toHaveCount(0)
})

test('navigation and source replacement discard hover targets from the previous preview', async ({ page }) => {
  await open(page)
  await row(page, 'BookRow').hover()
  await expect.poll(() => highlights(page).count()).toBeGreaterThan(0)
  await page.getByTestId('live-toggle').click()
  const preview = page.getByTestId('render-tree')
  await preview.getByRole('button', { name: /First book/ }).click()
  await expect(preview.getByText('Book detail', { exact: true })).toBeVisible()
  await page.getByTestId('inspect-toggle').click()
  await row(page, 'BookRow').hover()
  await expect(highlights(page)).toHaveCount(0)
  await page.getByTestId('workspace-develop').click()
  await page.getByTestId('editor').locator('.cm-content').fill(SOURCE.replace('Library heading', 'Updated heading'))
  await page.getByTestId('workspace-design').click()
  await expect(highlights(page)).toHaveCount(0)
  await expect(hovered(page)).toHaveCount(0)
  await expect(row(page, 'Text').filter({ hasText: 'Library heading' })).toHaveCount(0)
})

test('Folio opens with views only and connects the shared Book row to all four books', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByTestId('gallery-source-app').click()
  await page.getByTestId('template-folio').click()
  await page.getByTestId('template-confirm').click()
  const preview = page.getByTestId('render-tree')
  await expect(preview.getByText('The Secret Garden', { exact: true })).toBeVisible()
  await page.getByTestId('inspect-toggle').click()
  await expect(row(page, 'RootView')).toHaveCount(0)
  await expect(row(page, 'MainTabs')).toHaveCount(0)
  await expect(row(page, 'TabView')).toHaveCount(1)
  await expect(row(page, 'LibraryView')).toHaveCount(2)
  await row(page, 'LibraryView').first().dblclick()
  await expect(row(page, 'List')).toHaveCount(1)
  await expect(row(page, 'BookRow')).toHaveCount(1)
  await expect(layers(page).locator('[data-source-kind="definition"], [data-source-kind="template"], [data-source-kind="branch"]')).toHaveCount(0)
  for (const name of ['ForEach', 'Section', 'NavigationLink', 'NavigationStack']) await expect(row(page, name)).toHaveCount(0)
  await row(page, 'BookRow').hover()
  const titles = ['The Secret Garden', 'A Room of One’s Own', 'Around the World in Eighty Days', 'The Time Machine']
  const authors = ['Frances Hodgson Burnett', 'Virginia Woolf', 'Jules Verne', 'H. G. Wells']
  const icons = preview.getByRole('img', { name: /Image\(systemName: "(leaf|pencil|globe|clock)"\)/ })
  await expect(icons).toHaveCount(4)
  await expectRowHighlights(page, preview.getByRole('button', { name: /The Secret Garden|A Room of One’s Own|Around the World in Eighty Days|The Time Machine/ }), [
    ...[...titles, ...authors].map(name => preview.getByLabel(name, { exact: true })),
    ...await icons.all(),
  ])
  await expect(row(page, 'BookRow')).toHaveAttribute('data-hovered', 'true')
  await row(page, 'BookRow').click()
  await row(page, 'BookRow').hover()
  const screenshot = testInfo.outputPath('folio-layers-hover.png')
  await page.screenshot({ path: screenshot })
  await testInfo.attach('folio-visual-layers-hover', { path: screenshot, contentType: 'image/png' })
  await preview.getByRole('button', { name: /The Secret Garden/ }).hover()
  await expect(row(page, 'BookRow')).toHaveAttribute('data-hovered', 'true')
  await page.getByTestId('toolbar').hover()
  await expect(highlights(page)).toHaveCount(0)
})

test('a canvas hover identifies the visible ancestor when its layer is collapsed', async ({ page }) => {
  await open(page)
  await page.getByTestId('collapse-layers').click()
  await expect(title(page)).toHaveCount(0)
  await page.getByTestId('render-tree').getByText('Library heading', { exact: true }).hover()
  await expect(row(page, 'VStack')).toHaveAttribute('data-hovered', 'true')
  await expect(hovered(page)).toHaveCount(1)
  await expect(layers(page).locator('[aria-selected="true"]')).toHaveCount(0)
  await expect(highlights(page)).toHaveCount(1)
  await page.getByTestId('toolbar').hover()
  await expect(highlights(page)).toHaveCount(0)
  await expect(hovered(page)).toHaveCount(0)
})

test('hover outlines track a scrolled List and remain clipped to its visible viewport', async ({ page }) => {
  const books = ['Book(id: "one", title: "First book")', ...Array.from({ length: 39 }, (_, i) => `Book(id: "book-${i + 2}", title: "Book ${i + 2}")`)].join(', ')
  await open(page, SOURCE.replace('Book(id: "one", title: "First book"), Book(id: "two", title: "Second book")', books))
  const preview = page.getByTestId('render-tree')
  await page.getByTestId('live-toggle').click()
  await preview.getByRole('button', { name: /First book/ }).hover()
  await page.mouse.wheel(0, 440)
  const scrollState = () => preview.evaluate(tree => {
    const scroll = [...tree.querySelectorAll<HTMLElement>('*')].find(element => element.scrollHeight > element.clientHeight + 20 && getComputedStyle(element).overflowY === 'auto')
    if (!scroll) return null
    const bounds = scroll.getBoundingClientRect()
    return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right, scrollTop: scroll.scrollTop }
  })
  await expect.poll(async () => (await scrollState())?.scrollTop ?? 0).toBeGreaterThan(200)
  await page.getByTestId('inspect-toggle').click()
  await row(page, 'BookRow').hover()
  const viewport = await scrollState()
  expect(viewport).not.toBeNull()
  const visible = page.locator('[data-testid="inspect-highlight"]:visible')
  await expect.poll(() => visible.count()).toBeGreaterThan(0)
  expect(await visible.count()).toBeLessThan(40)
  for (const outline of await visible.all()) {
    const bounds = await outline.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(viewport!.left - 2)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.right + 2)
    expect(bounds!.y).toBeGreaterThanOrEqual(viewport!.top - 2)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.bottom + 2)
  }
  const visibleTitle = await preview.getByRole('button').evaluateAll((elements, viewport) => elements.find(element => {
    const bounds = element.getBoundingClientRect()
    return /^Book \d+$/.test(element.getAttribute('aria-label') ?? '') && bounds.top > viewport!.top + 3 && bounds.bottom < viewport!.bottom - 3
  })?.getAttribute('aria-label'), viewport)
  expect(visibleTitle).toBeTruthy()
  const target = preview.getByRole('button', { name: visibleTitle!, exact: true })
  await target.hover()
  await expect(row(page, 'BookRow')).toHaveAttribute('data-hovered', 'true')
  await expect(highlights(page)).toHaveCount(1)
  await expectOverlayMatches(highlights(page), target)
})
