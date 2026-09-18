import { expect, test, type Page } from '@playwright/test'

/**
 * Designing on the canvas.
 *
 * Every test here ends by asserting on the *source*, because that is the whole
 * claim: a view moved, added or deleted on the canvas is an edit to the Swift the
 * user wrote, and the preview is downstream of it. A test that only checked the
 * preview would pass just as well against a studio that kept a model beside the
 * file and drifted from it.
 */

const SOURCE = `import SwiftUI
@main struct DesignApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Alpha")
                .font(.title)
            Text("Beta")
            Text("Gamma")
        }
    }
}`

const TABS = `import SwiftUI
@main struct DesignApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        TabView {
            Text("One").tabItem { Label("One", systemImage: "1.circle") }
            Text("Two").tabItem { Label("Two", systemImage: "2.circle") }
            Text("Three").tabItem { Label("Three", systemImage: "3.circle") }
        }
    }
}`

const SCROLLING = `import SwiftUI
@main struct DesignApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        ScrollView {
            VStack {
                ForEach(0..<40, id: \\.self) { index in
                    Text("Row \\(index)").padding()
                }
            }
        }
    }
}`

const NESTED = `import SwiftUI
@main struct DesignApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        VStack {
            Text("Alpha")
            HStack {
                Text("Inner")
            }
        }
    }
}`

/** Opens the studio on a known screen, in Design with the Edit tool. */
async function openDesign(page: Page) {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(SOURCE)
  await expect(page.getByTestId('render-tree').getByText('Alpha', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()
  await page.getByTestId('inspect-toggle').click()
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true')
  // The canvas bar reports from inside the debug panel, so these tests open the
  // panel exactly as somebody watching what they are editing would.
  if (await page.getByTestId('pane-toggle-debug').getAttribute('aria-pressed') === 'false') {
    await page.getByTestId('pane-toggle-debug').click()
  }
  await expect(page.getByTestId('canvas-bar')).toBeVisible()
}

/** Where the canvas is looking: the world's own transform, in screen pixels. */
async function canvasView(page: Page): Promise<{ x: number; y: number; scale: number }> {
  return page.locator('[data-world]').evaluate((world) => {
    const matrix = new DOMMatrix(getComputedStyle(world).transform)
    return { x: matrix.e, y: matrix.f, scale: matrix.a }
  })
}

/** The order the stack draws its children in, top to bottom. */
async function order(page: Page): Promise<string[]> {
  return page.getByTestId('render-tree').evaluate((tree) =>
    [...tree.querySelectorAll<HTMLElement>('[data-kind="text"]')]
      .filter((node) => ['Alpha', 'Beta', 'Gamma', 'Text'].includes(node.textContent?.trim() ?? ''))
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
      .map((node) => node.textContent?.trim() ?? ''),
  )
}

async function source(page: Page): Promise<string> {
  await page.getByTestId('workspace-develop').click()
  const text = await page.getByTestId('editor').locator('.cm-content').innerText()
  await page.getByTestId('workspace-design').click()
  return text
}

test('selecting a view on the canvas names it in Layers, in Settings and in the bar', async ({ page }) => {
  await openDesign(page)

  await page.getByTestId('render-tree').getByText('Beta', { exact: true }).click()
  await expect(page.getByRole('tree', { name: 'App layers' }).getByRole('treeitem', { name: 'Beta, Text' }))
    .toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('selection-controls')).toContainText('Beta')
  // Design opens the rail on Settings, and Settings names what is selected.
  await expect(page.getByTestId('inspector-tab-settings')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('inspector-settings')).toContainText('Beta')
})

test('moving a view on the canvas rewrites the file and keeps the view selected', async ({ page }) => {
  await openDesign(page)
  expect(await order(page)).toEqual(['Alpha', 'Beta', 'Gamma'])

  await page.getByTestId('render-tree').getByText('Alpha', { exact: true }).click()
  // First in the stack, so up is refused and says so rather than doing nothing.
  await expect(page.getByTestId('move-up')).toBeDisabled()
  await page.getByTestId('move-down').click()

  await expect.poll(() => order(page)).toEqual(['Beta', 'Alpha', 'Gamma'])
  // The selection followed the view, not the position it left.
  await expect(page.getByTestId('selection-controls')).toContainText('Alpha')
  await expect(page.getByTestId('move-up')).toBeEnabled()

  const text = await source(page)
  expect(text).toContain('Text("Beta")')
  // The modifier moved with it, which is the thing a line-based edit gets wrong.
  expect(text.indexOf('Text("Beta")')).toBeLessThan(text.indexOf('Text("Alpha")'))
  expect(text).toMatch(/Text\("Alpha"\)\s*\n\s*\.font\(\.title\)/)
  // The file the edit produced compiles: Issues would badge a count otherwise.
  await expect(page.getByTestId('navigator-tab-issues')).toHaveText('Issues')
})

test('dragging a row in Layers moves the view in the file', async ({ page }) => {
  await openDesign(page)
  const layers = page.getByRole('tree', { name: 'App layers' })
  const gamma = layers.getByRole('treeitem', { name: 'Gamma, Text' })
  const alpha = layers.getByRole('treeitem', { name: 'Alpha, Text' })

  // Dropped on the top half of the first row, which is what "before it" means.
  const from = (await gamma.boundingBox())!
  const to = (await alpha.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + 6)
  await page.mouse.move(to.x + to.width / 2, to.y + 3)
  await expect(alpha).toHaveAttribute('data-drop', 'before')
  await page.mouse.up()

  await expect.poll(() => order(page)).toEqual(['Gamma', 'Alpha', 'Beta'])
  expect(await source(page)).toMatch(/Text\("Gamma"\)[\s\S]*Text\("Alpha"\)/)
})

test('dragging a view on the canvas moves it in the file', async ({ page }) => {
  await openDesign(page)
  const preview = page.getByTestId('render-tree')
  const alpha = preview.getByText('Alpha', { exact: true })
  const gamma = preview.getByText('Gamma', { exact: true })

  const from = (await alpha.boundingBox())!
  const to = (await gamma.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2)
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 1)
  // The canvas says what the drop will do before it happens.
  await expect(page.getByTestId('device-pane')).toHaveAttribute('data-dragging', 'true')
  await page.mouse.up()

  await expect.poll(() => order(page)).toEqual(['Beta', 'Gamma', 'Alpha'])
  const text = await source(page)
  expect(text.indexOf('Text("Gamma")')).toBeLessThan(text.indexOf('Text("Alpha")'))
  expect(text).toMatch(/Text\("Alpha"\)\s*\n\s*\.font\(\.title\)/)
})

test('a drag can carry a view into another container', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(NESTED)
  await expect(page.getByTestId('render-tree').getByText('Inner', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()
  await page.getByTestId('inspect-toggle').click()

  const layers = page.getByRole('tree', { name: 'App layers' })
  const alpha = layers.getByRole('treeitem', { name: 'Alpha, Text' })
  const inner = layers.getByRole('treeitem', { name: 'Inner, Text' })
  const from = (await alpha.boundingBox())!
  const to = (await inner.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2)
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 2)
  await page.mouse.up()

  // It is inside the stack now, in the file and in the tree.
  await expect.poll(() => source(page)).toMatch(/HStack \{[\s\S]*Text\("Inner"\)[\s\S]*Text\("Alpha"\)[\s\S]*\}/)
  await expect(layers.getByRole('treeitem', { name: 'Alpha, Text' })).toHaveAttribute('aria-level', '4')
})

test('a selected container is dragged from anywhere inside it', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(NESTED)
  await expect(page.getByTestId('render-tree').getByText('Inner', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()
  await page.getByTestId('inspect-toggle').click()

  // Choose the stack in Layers, then drag it by one of its children: the drag moves
  // what is selected, which is how a whole section is carried rather than a word.
  await page.getByRole('tree', { name: 'App layers' }).getByRole('treeitem', { name: 'HStack, HStack' }).click()
  const inner = (await page.getByTestId('render-tree').getByText('Inner', { exact: true }).boundingBox())!
  const alpha = (await page.getByTestId('render-tree').getByText('Alpha', { exact: true }).boundingBox())!
  await page.mouse.move(inner.x + inner.width / 2, inner.y + inner.height / 2)
  await page.mouse.down()
  await page.mouse.move(alpha.x + alpha.width / 2, alpha.y + alpha.height / 2)
  await page.mouse.move(alpha.x + alpha.width / 2, alpha.y + 1)
  await page.mouse.up()

  await expect.poll(() => source(page)).toMatch(/HStack \{[\s\S]*\}[\s\S]*Text\("Alpha"\)/)
})

test('the eye hides a view out of the app and back into it', async ({ page }) => {
  await openDesign(page)
  const layers = page.getByRole('tree', { name: 'App layers' })
  const beta = layers.getByRole('treeitem', { name: 'Beta, Text' })
  await beta.hover()
  await beta.getByTestId('layer-hide').click()

  await expect.poll(() => order(page)).toEqual(['Alpha', 'Gamma'])
  const hiddenText = await source(page)
  expect(hiddenText).toContain('hidden by Swift Web Studio')
  expect(hiddenText).toContain('// Text("Beta")')

  // Still in the tree, where it was, with the switch that brings it back.
  const hiddenRow = page.getByTestId('hidden-layer')
  await expect(hiddenRow).toContainText('Beta')
  await hiddenRow.getByTestId('layer-show').click()
  await expect.poll(() => order(page)).toEqual(['Alpha', 'Beta', 'Gamma'])
  expect(await source(page)).not.toContain('hidden by Swift Web Studio')
})

test('undo and redo walk back through the canvas edits', async ({ page }) => {
  await openDesign(page)
  await page.getByTestId('render-tree').getByText('Alpha', { exact: true }).click()
  await page.getByTestId('move-down').click()
  await expect.poll(() => order(page)).toEqual(['Beta', 'Alpha', 'Gamma'])

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => order(page)).toEqual(['Alpha', 'Beta', 'Gamma'])
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => order(page)).toEqual(['Beta', 'Alpha', 'Gamma'])

  // A delete comes back too, with the text it took away.
  await page.getByTestId('render-tree').getByText('Gamma', { exact: true }).click()
  await page.keyboard.press('Backspace')
  await expect.poll(() => order(page)).toEqual(['Beta', 'Alpha'])
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => order(page)).toEqual(['Beta', 'Alpha', 'Gamma'])
  expect(await source(page)).toContain('Text("Gamma")')
})

test('copy and paste put a second one of something beside it', async ({ page }) => {
  await openDesign(page)
  await page.getByTestId('render-tree').getByText('Alpha', { exact: true }).click()
  await page.keyboard.press('ControlOrMeta+c')
  await expect(page.getByTestId('edit-note')).toContainText('Copied Alpha')

  await page.getByTestId('render-tree').getByText('Gamma', { exact: true }).click()
  await page.keyboard.press('ControlOrMeta+v')

  await expect.poll(() => order(page)).toEqual(['Alpha', 'Beta', 'Gamma', 'Alpha'])
  // The copy carried the modifier that was written on it.
  expect((await source(page)).match(/\.font\(\.title\)/g)).toHaveLength(2)
})

test('Tab switches the canvas and the backquote switches the workspace', async ({ page }) => {
  await openDesign(page)
  await expect(page.getByTestId('inspect-toggle')).toHaveAttribute('aria-pressed', 'true')

  await page.keyboard.press('Tab')
  await expect(page.getByTestId('live-toggle')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('inspect-toggle')).toHaveAttribute('aria-pressed', 'true')

  await page.keyboard.press('`')
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-mode', 'develop')
  await page.keyboard.press('`')
  await expect(page.getByTestId('workspace')).toHaveAttribute('data-mode', 'design')
})

test('the canvas keeps its size when the switch is thrown', async ({ page }) => {
  await openDesign(page)
  const frame = () => page.getByTestId('device-frame').evaluate((el) => Math.round(el.getBoundingClientRect().width))

  const designing = await frame()
  await page.getByTestId('live-toggle').click()
  await expect(page.getByTestId('live-toggle')).toHaveAttribute('aria-pressed', 'true')
  expect(await frame()).toBe(designing)
  await page.getByTestId('inspect-toggle').click()
  expect(await frame()).toBe(designing)
})

test('the keyboard moves and deletes the selection', async ({ page }) => {
  await openDesign(page)
  await page.getByTestId('render-tree').getByText('Gamma', { exact: true }).click()

  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(() => order(page)).toEqual(['Alpha', 'Gamma', 'Beta'])

  await page.keyboard.press('Backspace')
  await expect.poll(() => order(page)).toEqual(['Alpha', 'Beta'])
  expect(await source(page)).not.toContain('Gamma')
  // Nothing is selected once the thing that was selected has gone.
  await expect(page.getByTestId('selection-controls')).toHaveCount(0)
})

test('Add opens a palette that says where the view will land, and puts it there', async ({ page }) => {
  await openDesign(page)
  await page.getByTestId('render-tree').getByText('Alpha', { exact: true }).click()

  await page.getByTestId('add-view').click()
  await expect(page.getByTestId('add-view-target')).toHaveText('After Alpha')

  // The search is a search, not a filter over names alone.
  await page.getByTestId('add-view-search').fill('switch')
  await expect(page.getByTestId('add-view-toggle')).toBeVisible()

  await page.getByTestId('add-view-search').fill('text')
  await page.getByTestId('add-view-text').click()
  await expect(page.getByTestId('add-view-palette')).toHaveCount(0)

  await expect.poll(() => order(page)).toEqual(['Alpha', 'Text', 'Beta', 'Gamma'])
  const text = await source(page)
  expect(text).toContain('Text("Text")')
  expect(text.indexOf('Text("Alpha")')).toBeLessThan(text.indexOf('Text("Text")'))
  await expect(page.getByTestId('navigator-tab-issues')).toHaveText('Issues')
  // What was added is what is selected, ready to be moved or deleted.
  await expect(page.getByTestId('selection-controls')).toContainText('Text')
})

test('Add puts a view inside the container that is selected', async ({ page }) => {
  await openDesign(page)
  await page.getByRole('tree', { name: 'App layers' }).getByRole('treeitem', { name: 'VStack, VStack' }).click()

  await page.getByTestId('add-view').click()
  await expect(page.getByTestId('add-view-target')).toHaveText('Into VStack')
  await page.getByTestId('add-view-search').fill('divider')
  await page.keyboard.press('Enter')

  await expect.poll(() => source(page)).toContain('Divider()')
  const text = await source(page)
  expect(text.indexOf('Text("Gamma")')).toBeLessThan(text.indexOf('Divider()'))
})

test('the Delete tool takes out the view that is clicked', async ({ page }) => {
  await openDesign(page)
  await page.getByTestId('tool-delete').click()
  await expect(page.getByTestId('device-pane')).toHaveAttribute('data-tool', 'delete')

  await page.getByTestId('render-tree').getByText('Beta', { exact: true }).click()
  await expect.poll(() => order(page)).toEqual(['Alpha', 'Gamma'])
  expect(await source(page)).not.toContain('Beta')

  // It stays armed, because deleting two things is one decision made twice.
  await expect(page.getByTestId('tool-delete')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('tool-select').click()
  await expect(page.getByTestId('device-pane')).toHaveAttribute('data-tool', 'select')
})

test('an edit that cannot be made says so and changes nothing', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(`import SwiftUI
@main struct DesignApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        Text("Only")
    }
}`)
  await expect(page.getByTestId('render-tree').getByText('Only', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()
  await page.getByTestId('inspect-toggle').click()
  if (await page.getByTestId('pane-toggle-debug').getAttribute('aria-pressed') === 'false') {
    await page.getByTestId('pane-toggle-debug').click()
  }

  await page.getByTestId('render-tree').getByText('Only', { exact: true }).click()
  await expect(page.getByTestId('move-up')).toBeDisabled()
  await expect(page.getByTestId('move-down')).toBeDisabled()
  // Deleting the body's only view would leave a `some View` that returns nothing.
  await expect(page.getByTestId('delete-selection')).toBeDisabled()

  await page.keyboard.press('Backspace')
  await expect(page.getByTestId('edit-note')).toContainText('delete it in the code')
  await expect(page.getByTestId('render-tree').getByText('Only', { exact: true })).toBeVisible()
})

test('the canvas zooms with the wheel and can be dragged anywhere, at any zoom', async ({ page }) => {
  await openDesign(page)
  const pane = page.getByTestId('device-pane')

  const before = await canvasView(page)
  await pane.hover({ position: { x: 40, y: 40 } })
  await page.mouse.wheel(0, -240)
  await expect.poll(async () => (await canvasView(page)).scale).toBeGreaterThan(before.scale + 0.02)

  // Panning does not need something to scroll: it works zoomed out, where the whole
  // world already fits, which is where the scrolling version did nothing at all.
  await page.mouse.wheel(0, 600)
  const out = await canvasView(page)
  expect(out.scale).toBeLessThan(before.scale)

  const box = (await pane.boundingBox())!
  await page.mouse.move(box.x + 12, box.y + 12)
  await page.mouse.down()
  await page.mouse.move(box.x + 92, box.y + 132)
  await page.mouse.move(box.x + 112, box.y + 152)
  await page.mouse.up()

  const moved = await canvasView(page)
  expect(Math.round(moved.x - out.x)).toBe(100)
  expect(Math.round(moved.y - out.y)).toBe(140)
  expect(moved.scale).toBe(out.scale)
})

test('choosing a page in Layers brings it into view', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(`import SwiftUI
@main struct DesignApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        TabView {
            Text("One").tabItem { Label("One", systemImage: "1.circle") }
            Text("Two").tabItem { Label("Two", systemImage: "2.circle") }
            Text("Three").tabItem { Label("Three", systemImage: "3.circle") }
        }
    }
}`)
  await expect(page.getByTestId('render-tree').getByText('One', { exact: true }).first()).toBeVisible()
  await page.getByTestId('workspace-design').click()
  await page.getByTestId('inspect-toggle').click()
  await page.getByTestId('show-all-pages').check()
  await expect(page.getByTestId('gallery-page')).toHaveCount(3)

  const pane = page.getByTestId('device-pane')
  await pane.hover({ position: { x: 30, y: 30 } })
  await page.mouse.wheel(0, -500)

  // The third page is off to the right; choosing it brings it to the middle.
  const third = page.getByTestId('gallery-page').nth(2)
  const paneBox = (await pane.boundingBox())!
  const centreOf = async () => {
    const box = (await third.boundingBox())!
    return box.x + box.width / 2 - (paneBox.x + paneBox.width / 2)
  }
  // Polled, not asserted once: the zoom that pushes it off-centre is applied on the
  // next frame, and a loaded machine takes its time about that.
  await expect.poll(async () => Math.abs(await centreOf())).toBeGreaterThan(80)

  await page.getByRole('tree', { name: 'App layers' }).getByRole('treeitem', { name: 'Three, Page' }).click()
  await expect.poll(async () => Math.abs(await centreOf())).toBeLessThan(20)
})

test('the dock is two rows of one width, and the status sits with the canvas', async ({ page }) => {
  await openDesign(page)

  const tools = page.getByTestId('tool-select')
  const modes = page.getByTestId('inspect-toggle')
  const width = async (name: string) => {
    const boxes = await page.locator(`[aria-label="Preview tools"] > div:nth-child(${name === 'tools' ? 1 : 2})`).boundingBox()
    return Math.round(boxes!.width)
  }
  expect(await width('tools')).toBe(await width('modes'))
  // Three over two, and the pair below is the wider pair.
  expect((await tools.boundingBox())!.width).toBeLessThan((await modes.boundingBox())!.width)

  // The status is a state of the preview, so it is drawn with the preview.
  await expect(page.getByTestId('status-view')).toBeVisible()
  await expect(page.locator('[aria-label="Preview tools"]').getByTestId('status-view')).toHaveCount(0)
  await expect(page.getByTestId('status-view')).toContainText('Editing')
  await page.getByTestId('live-toggle').click()
  await expect(page.getByTestId('status-view')).toContainText('Live preview')
})

test('the canvas bar is one line, inside the panel that reports on the app', async ({ page }) => {
  await openDesign(page)
  const bar = page.getByTestId('canvas-bar')
  const oneLine = (await bar.boundingBox())!.height

  // Selected and hovered at once is the state that used to wrap it onto two lines.
  await page.getByTestId('render-tree').getByText('Alpha', { exact: true }).click()
  await page.getByTestId('render-tree').getByText('Gamma', { exact: true }).hover()
  await expect(page.getByTestId('selection-controls')).toBeVisible()
  expect((await bar.boundingBox())!.height).toBe(oneLine)

  // It belongs to the debug panel, so it comes and goes with it.
  const console = (await page.getByTestId('console').boundingBox())!
  const box = (await bar.boundingBox())!
  expect(box.y).toBeLessThan(console.y)
  expect(box.y + box.height).toBeLessThanOrEqual(console.y + 1)
  await page.getByTestId('pane-toggle-debug').click()
  await expect(bar).toHaveCount(0)
})

test('the wheel belongs to the canvas while designing and to the app while previewing', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(`import SwiftUI
@main struct DesignApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        ScrollView {
            VStack {
                ForEach(0..<40, id: \\.self) { index in
                    Text("Row \\(index)")
                        .padding()
                }
            }
        }
    }
}`)
  await expect(page.getByTestId('render-tree').getByText('Row 0', { exact: true })).toBeVisible()
  await page.getByTestId('workspace-design').click()

  const appScroll = () => page.getByTestId('render-tree').evaluate((tree) => {
    const scroller = [...tree.querySelectorAll<HTMLElement>('*')]
      .find((el) => el.scrollHeight > el.clientHeight + 20 && getComputedStyle(el).overflowY !== 'visible')
    return scroller?.scrollTop ?? -1
  })
  const frame = () => page.getByTestId('device-frame').evaluate((el) => el.getBoundingClientRect().width)

  // Live Preview: the app takes the wheel, and the canvas does not move.
  await page.getByTestId('live-toggle').click()
  const size = await frame()
  await page.getByTestId('render-tree').hover()
  await page.mouse.wheel(0, 300)
  await expect.poll(appScroll).toBeGreaterThan(20)
  expect(await frame()).toBe(size)

  // Design: the canvas takes it, and the app underneath stays where it was.
  await page.getByTestId('inspect-toggle').click()
  const scrolled = await appScroll()
  await page.getByTestId('render-tree').hover()
  await page.mouse.wheel(0, 300)
  await expect.poll(frame).toBeLessThan(size)
  expect(await appScroll()).toBe(scrolled)

  // And one notch is a nudge rather than a jump: a dial, not a gear change.
  const before = await frame()
  await page.mouse.wheel(0, -120)
  await expect.poll(frame).toBeGreaterThan(before)
  expect(await frame()).toBeLessThan(before * 1.25)
})

test('leaving Edit with the gallery open leaves the live page exactly where it was', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(TABS)
  await expect(page.getByTestId('render-tree').getByText('One', { exact: true }).first()).toBeVisible()
  await page.getByTestId('workspace-design').click()
  await page.getByTestId('inspect-toggle').click()
  await page.getByTestId('show-all-pages').check()
  await expect(page.getByTestId('gallery-page')).toHaveCount(3)

  const live = page.locator('[data-page-id][data-active]')
  const before = (await live.boundingBox())!

  await page.getByTestId('live-toggle').click()
  await expect(page.getByTestId('gallery-page')).toHaveCount(0)
  const after = (await page.locator('[data-canvas-phone]').boundingBox())!

  // The others vanish; the one being looked at does not move or change size.
  expect(Math.round(after.x)).toBe(Math.round(before.x))
  expect(Math.round(after.y)).toBe(Math.round(before.y))
  expect(Math.round(after.width)).toBe(Math.round(before.width))
})

test('the simulated app scrolls without a scrollbar down the side of the phone', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(SCROLLING)
  await expect(page.getByTestId('render-tree').getByText('Row 0', { exact: true })).toBeVisible()

  const scrollers = () => page.getByTestId('render-tree').evaluate((tree) =>
    [...tree.querySelectorAll<HTMLElement>('*')]
      .filter((el) => el.scrollHeight > el.clientHeight + 10)
      .map((el) => ({ bar: getComputedStyle(el).scrollbarWidth, scrolls: el.scrollHeight > el.clientHeight })))

  const found = await scrollers()
  expect(found.length).toBeGreaterThan(0)
  // It still scrolls; it just has no rail down the side of the phone.
  expect(found.every((el) => el.scrolls && el.bar === 'none')).toBe(true)
})
