import { expect, test, type Locator, type Page } from '@playwright/test'
import { assertSource, openCounter, replaceSource } from './designer-helpers'

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

async function open(page: Page, source = SOURCE, expandList = true) {
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  await replaceSource(page, source)
  await expect(mainPreview(page).getByText('First book', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true')
  if (expandList) await expandBooks(page)
}

const mainPreview = (page: Page) => page.locator('[data-page-kind="root"], [data-canvas-phone]').first().getByTestId('render-tree')
const layers = (page: Page) => page.getByTestId('logical-layers')
const row = (page: Page, name: string) => layers(page).locator(`[data-source-name="${name}"]`)
const books = (page: Page) => row(page, 'Section').filter({ hasText: 'Books' })
/**
 * Reveals the shared BookRow layer. A titled Section draws its header, so it is a
 * layer of its own between the List and the row; both start collapsed.
 */
async function expandBooks(page: Page) {
  if (await row(page, 'List').getAttribute('aria-expanded') !== 'true') await layers(page).getByRole('button', { name: 'Expand List', exact: true }).click()
  if (await books(page).getAttribute('aria-expanded') !== 'true') await layers(page).getByRole('button', { name: 'Expand Books', exact: true }).click()
  await expect(row(page, 'BookRow')).toHaveCount(1)
}
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
  for (const part of parts) await expect(part).toBeVisible()
  const contains = (outer: { x: number; y: number; width: number; height: number }, inner: typeof outer) => outer.x <= inner.x + 2 && outer.y <= inner.y + 2 && outer.x + outer.width >= inner.x + inner.width - 2 && outer.y + outer.height >= inner.y + inner.height - 2
  // Text calibration can move both content and overlays. Compare fresh geometry
  // on every poll instead of keeping rectangles from an earlier layout frame.
  await expect.poll(async () => {
    const frames = await highlights(page).evaluateAll(elements => elements.map(element => {
      const bounds = element.getBoundingClientRect()
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    }))
    const rowFrames = await Promise.all((await rows.all()).map(element => element.boundingBox()))
    const partFrames = await Promise.all(parts.map(element => element.boundingBox()))
    // Transparent stacks may outline painted children separately. Every part
    // must be covered, with no unrelated row outlined.
    return frames.length > 0 && partFrames.every(bounds => bounds && frames.some(frame => contains(frame, bounds)))
      && frames.every(frame => rowFrames.some(bounds => bounds && contains(bounds, frame)))
  }).toBe(true)
}

test('primary Layers keeps shared designs compact and collection/navigation settings editable', async ({ page }) => {
  await open(page, SOURCE, false)
  await expect(row(page, 'List')).toHaveAttribute('aria-expanded', 'false')
  await expect(row(page, 'BookRow')).toHaveCount(0)
  await expandBooks(page)
  await expect(layers(page).locator('[data-source-kind="definition"], [data-source-kind="template"], [data-source-kind="branch"]')).toHaveCount(0)
  for (const name of ['ForEach', 'NavigationLink', 'NavigationStack', 'WindowGroup']) await expect(row(page, name)).toHaveCount(0)
  // The titled Section("Books") header is drawn on screen, so it is one visible layer.
  await expect(row(page, 'Section')).toHaveCount(1)
  await expect(books(page)).toHaveAttribute('aria-label', 'Books, Section')
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
  await expect(mainPreview(page).getByText('Edited book', { exact: true })).toBeVisible()
  await expect(mainPreview(page).getByText('Second book', { exact: true })).toBeVisible()
  await row(page, 'BookRow').click()
  // A repeated row points back to its list's data, and the link around it is its
  // "Navigate to" card (the separate context section was removed).
  const inspector = page.getByTestId('authoring-inspector')
  await expect(inspector).toContainText('Part of a repeated row.')
  await expect(inspector.getByRole('button', { name: 'Edit the list', exact: true })).toBeVisible()
  const navigate = inspector.getByTestId('navigate-to')
  await expect(navigate).toContainText('Navigate to · Push')
  await expect(navigate.getByRole('combobox', { name: 'How it opens', exact: true })).toBeEnabled()
  const extra = row(page, 'Text').filter({ hasText: 'Extra detail' })
  await expect(extra).toHaveCount(0)
  await expect(row(page, 'BookRow')).toHaveAttribute('data-shared-design', 'true')
  await assertSource(page, SOURCE.replace('title: "First book"', 'title: "Edited book"'))
})

test('Arrange hover connects canvas and primary Layers without selecting or running actions', async ({ page }) => {
  await open(page)
  const preview = mainPreview(page)
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
  const preview = mainPreview(page)
  await book.hover()
  await expect(book).toHaveAttribute('data-hovered', 'true')
  const icons = preview.getByRole('img', { name: 'Image(systemName: "book")', exact: true })
  await expect(icons).toHaveCount(2)
  await expectRowHighlights(page, preview.getByRole('button', { name: /First book|Second book/ }), [
    preview.getByText('First book', { exact: true }), preview.getByText('Second book', { exact: true }),
    ...await icons.all(),
  ])
  // On the canvas a row is part of its list, as a click picks what sits in the screen (D1)...
  await preview.getByRole('button', { name: /First book/ }).hover()
  await expect(row(page, 'List')).toHaveAttribute('data-hovered', 'true')
  // ...and once a row is selected, either row is picked at that depth.
  await book.click()
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

test('hover clears when filtering Layers and unrendered conditional views stay out of the tree', async ({ page }) => {
  await open(page)
  await title(page).hover()
  await expect(highlights(page)).toHaveCount(1)
  // Layers are filtered from the navigator's "Find a screen or layer" field.
  const search = page.getByTestId('design-search')
  await search.fill('Extra detail')
  const extra = row(page, 'Text').filter({ hasText: 'Extra detail' })
  await expect(extra).toHaveCount(0)
  await expect(layers(page)).toContainText('No matching layers.')
  await expect(highlights(page)).toHaveCount(0)
  await search.press('Escape')
  await expect(search).toHaveValue('')
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
  const preview = mainPreview(page)
  await preview.getByRole('button', { name: /First book/ }).click()
  await expect(preview.getByText('Book detail', { exact: true })).toBeVisible()
  await page.getByTestId('inspect-toggle').click()
  const detail = page.locator('[data-testid="gallery-page"][data-page-kind="destination"]').first()
  await detail.locator('figcaption button').click()
  await expect(row(page, 'BookRow')).toHaveCount(0)
  await expect(layers(page)).toContainText('Book detail')
  await expect(highlights(page)).toHaveCount(0)
  await page.getByTestId('workspace-develop').click()
  await replaceSource(page, SOURCE.replace('Library heading', 'Updated heading'))
  await page.getByTestId('workspace-design').click()
  await expect(highlights(page)).toHaveCount(0)
  await expect(hovered(page)).toHaveCount(0)
  await expect(row(page, 'Text').filter({ hasText: 'Library heading' })).toHaveCount(0)
})

test('Folio opens with its main phone elements and connects the shared Book row to all four books', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByTestId('gallery-source-app').click()
  await page.getByTestId('template-folio').click()
  await page.getByTestId('template-confirm').click()
  const preview = mainPreview(page)
  await expect(preview.getByText('The Secret Garden', { exact: true })).toBeVisible()
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true')
  await expect(row(page, 'RootView')).toHaveCount(0)
  await expect(row(page, 'MainTabs')).toHaveCount(0)
  await expect(row(page, 'TabView')).toHaveCount(0)
  await expect(row(page, 'LibraryView')).toHaveCount(0)
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
  // Collapse all is on the Layers panel of the three-panel navigator layout.
  await page.getByTestId('navigator-layout-split').click()
  await page.getByTestId('collapse-layers').click()
  await expect(title(page)).toHaveCount(0)
  await mainPreview(page).getByText('Library heading', { exact: true }).hover()
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
  const preview = mainPreview(page)
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
  await expandBooks(page)
  await expect.poll(async () => (await scrollState())?.scrollTop ?? 0).toBeGreaterThan(200)
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
  // With a row selected, the canvas picks rows (D1): the row's own views, outlined as one box in it.
  await row(page, 'BookRow').click()
  const target = preview.getByRole('button', { name: visibleTitle!, exact: true })
  await target.hover()
  await expect(row(page, 'BookRow')).toHaveAttribute('data-hovered', 'true')
  await expect(highlights(page)).toHaveCount(1)
  await expectRowHighlights(page, target, [preview.getByText(visibleTitle!, { exact: true })])
})
