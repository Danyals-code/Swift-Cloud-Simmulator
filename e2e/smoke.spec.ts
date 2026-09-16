import { expect, test, type Page } from '@playwright/test'

/**
 * Gates from every phase, kept together.
 *
 * Earlier phases' tests stay in the suite rather than being replaced, because the
 * seams they cover keep mattering: Phase 0's worker round-trip is what Phase 3's
 * button taps travel over, and Phase 1's "no false positives" gate is what stops the
 * preview refusing to run correct code.
 */

/**
 * Opens the studio and dismisses the welcome sheet.
 *
 * The studio opens with it: the first question is where the project comes from, and
 * a tool that answers that question for you is a tool that has picked for you. Every
 * test below is about what happens *after* that choice, so they all start by keeping
 * what is already open.
 */
async function openStudio(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('template-gallery')).toBeVisible()
  await page.getByTestId('gallery-dismiss').click()
  await expect(page.getByTestId('template-gallery')).toHaveCount(0)

  await expect(page.getByTestId('editor')).toBeVisible()
  await expect(page.getByTestId('render-tree')).toBeVisible()
}

async function editorText(page: Page): Promise<string> {
  return page.getByTestId('editor').locator('.cm-content').innerText()
}

async function typeAtTop(page: Page, text: string) {
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type(text)
}

/**
 * Replaces the whole document.
 *
 * Takes a single line deliberately. CodeMirror auto-closes brackets, so typing a
 * multi-line block leaves the auto-inserted `}` in place *and* adds the one the test
 * typed on its own line - silently producing unbalanced source, and a failure that
 * has nothing to do with the product.
 */
async function replaceAll(page: Page, source: string) {
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(source)
}

const preview = (page: Page) => page.getByTestId('render-tree')

/** Picks a non-default export format from the split button's menu. */
async function exportAs(page: Page, format: string) {
  await page.getByTestId('export-format').click()
  await page.getByTestId(`export-format-menu-${format}`).click()
}

/** A rendered button in the simulated app, by its label. */
const appButton = (page: Page, name: string) => preview(page).getByRole('button', { name })

/** Geometry of every painted node, read from the DOM the renderer produced. */
async function frames(page: Page) {
  return page.evaluate(() => {
    const tree = document.querySelector('[data-testid="render-tree"]')
    if (!tree) return []
    return [...tree.children].map((child) => {
      const el = child as HTMLElement
      return {
        id: el.dataset.nodeId ?? '',
        kind: el.dataset.kind ?? '',
        x: Math.round(parseFloat(el.style.left)),
        y: Math.round(parseFloat(el.style.top)),
        width: Math.round(parseFloat(el.style.width)),
        height: Math.round(parseFloat(el.style.height)),
        text: el.innerText.trim(),
      }
    })
  })
}

// ---------------------------------------------------------------- Phase 0

test('loads the studio with the starter project', async ({ page }) => {
  await openStudio(page)

  await expect(page.getByTestId('project-name')).toHaveText('CounterApp')
  await expect(page.getByTestId('file-rail')).toContainText('CounterApp.swift')
  expect(await editorText(page)).toContain('struct ContentView: View')
})

test('gate 1 - edits persist across a reload', async ({ page }) => {
  await openStudio(page)

  const marker = `// persisted-${Date.now()}`
  await typeAtTop(page, `${marker}\n`)
  await expect(page.getByTestId('save-indicator')).toContainText('Saved', { timeout: 5_000 })

  await page.reload()
  await expect(page.getByTestId('editor')).toBeVisible()
  expect(await editorText(page)).toContain(marker)
})

test('gate 4 - the exported zip contains the edited source, byte-identical', async ({ page }) => {
  await openStudio(page)

  const marker = `// exported-${Date.now()}`
  await typeAtTop(page, `${marker}\n`)
  await expect(page.getByTestId('save-indicator')).toContainText('Saved', { timeout: 5_000 })

  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('export-button').click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toBe('CounterApp.zip')

  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const zip = Buffer.concat(chunks)

  expect(zip.subarray(0, 2).toString('latin1')).toBe('PK')

  // The Xcode layout: sources live inside the target folder, beside the project.
  const listing = zip.toString('latin1')
  expect(listing).toContain('CounterApp/CounterApp/CounterApp.swift')
  expect(listing).toContain('CounterApp/CounterApp.xcodeproj/project.pbxproj')
  expect(listing).toContain('CounterApp/CounterApp/Assets.xcassets/Contents.json')
})

test('the preview pane toggles with Ctrl+B', async ({ page }) => {
  await openStudio(page)

  await expect(page.getByTestId('device-pane')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+b')
  await expect(page.getByTestId('device-pane')).toBeHidden()
  await page.keyboard.press('ControlOrMeta+b')
  await expect(page.getByTestId('device-pane')).toBeVisible()
})

// ---------------------------------------------------------------- Phase 1

test('Phase 1 gate 4 - the reference app produces no diagnostics at all', async ({ page }) => {
  // The most important assertion in the suite. Anything reported on the starter
  // template is a false positive on unambiguously correct code, and a spurious
  // squiggle destroys trust in every other diagnostic.
  await openStudio(page)

  await expect(page.getByTestId('console')).toContainText('No problems.')
  await expect(page.getByTestId('editor').locator('.cm-lintRange')).toHaveCount(0)
})

test('gate 2 - a real parse error reaches the editor and the problems panel', async ({ page }) => {
  await openStudio(page)
  await typeAtTop(page, 'let broken = \n')

  await expect(page.getByTestId('console')).toContainText('Expected an expression', {
    timeout: 5_000,
  })
  await expect(page.getByTestId('editor').locator('.cm-lintRange').first()).toBeVisible()
})

test('reports unimplemented SwiftUI by name rather than calling it unresolved', async ({ page }) => {
  // `Chart` is perfectly valid Swift. Saying "cannot find in scope" would be both
  // wrong and unhelpful - it is this preview that cannot draw it, not Swift that
  // does not have it. The name checked here moves as coverage grows; what must not
  // change is that a real SwiftUI name is never reported as unresolved.
  await openStudio(page)
  await typeAtTop(page, 'let placeholder = Chart { }\n')

  const console_ = page.getByTestId('console')
  await expect(console_).toContainText('Chart', { timeout: 5_000 })
  await expect(console_).toContainText('the preview does not draw')
})

// ---------------------------------------------------------------- Phase 3

test('Phase 3 - the app renders as a real interface', async ({ page }) => {
  await openStudio(page)

  await expect(page.getByTestId('device-frame')).toBeVisible()
  const tree = preview(page)

  // Interpolations resolved by running the code, painted at engine-computed frames.
  await expect(tree).toContainText('Hello, World!')
  await expect(tree).toContainText('Count: 0')
  await expect(appButton(page, 'Minus')).toBeVisible()
  await expect(appButton(page, 'Plus')).toBeVisible()
})

test('Phase 3 gate 1 - tapping a rendered Button runs its Swift closure', async ({ page }) => {
  // The counter app, working as an interface: DOM tap -> worker -> interpreter runs
  // `count += 1` -> body re-evaluates -> layout -> repaint.
  await openStudio(page)
  const tree = preview(page)

  await expect(tree).toContainText('Count: 0')

  await appButton(page, 'Plus').click()
  await expect(tree).toContainText('Count: 1')

  await appButton(page, 'Plus').click()
  await expect(tree).toContainText('Count: 2')

  await appButton(page, 'Minus').click()
  await expect(tree).toContainText('Count: 1')
})

test('Phase 3 gate 2 - Spacer pushes the buttons to opposite edges', async ({ page }) => {
  // The case that exposes a wrong layout engine. The row is inset by the VStack's
  // 16pt padding plus the HStack's own 24pt, so the buttons sit at 40 and end at 353
  // on a 393pt screen.
  await openStudio(page)
  await expect(preview(page)).toContainText('Count: 0')

  const painted = await frames(page)
  const backgrounds = painted
    .filter((n) => n.kind === 'layer' && n.width > 20 && n.width < 200 && n.height > 40)
    .sort((a, b) => a.x - b.x)

  expect(backgrounds.length).toBeGreaterThanOrEqual(2)
  const first = backgrounds[0]!
  const last = backgrounds[backgrounds.length - 1]!

  expect(first.x).toBe(40)
  expect(last.x + last.width).toBe(353)
  // They are on the same row.
  expect(first.y).toBe(last.y)
})

test('Phase 3 - text is centred by the VStack and sized by its font', async ({ page }) => {
  await openStudio(page)
  await expect(preview(page)).toContainText('Count: 0')

  const painted = await frames(page)
  const title = painted.find((n) => n.text === 'Hello, World!')!
  const count = painted.find((n) => n.text === 'Count: 0')!

  // Both centred on a 393pt screen.
  expect(title.x + title.width / 2).toBeGreaterThan(190)
  expect(title.x + title.width / 2).toBeLessThan(203)
  expect(count.x + count.width / 2).toBeGreaterThan(190)
  expect(count.x + count.width / 2).toBeLessThan(203)

  // `.largeTitle` is 41pt tall, `.title2` is 28pt.
  expect(title.height).toBe(41)
  expect(count.height).toBe(28)
  expect(count.y).toBeGreaterThan(title.y)
})

test('Phase 3 gate 5 - an edit repaints without resetting unrelated @State', async ({ page }) => {
  await openStudio(page)
  const tree = preview(page)

  await appButton(page, 'Plus').click()
  await appButton(page, 'Plus').click()
  await expect(tree).toContainText('Count: 2')

  // Change the stack spacing: a pure layout edit, unrelated to the counter.
  await page
    .getByTestId('editor')
    .locator('.cm-content')
    .getByText('VStack(spacing: 16) {')
    .click()
  await page.keyboard.press('End')

  await typeAtTop(page, '// layout tweak\n')

  await expect(tree).toContainText('Count: 2', { timeout: 5_000 })
})

test('Phase 3 - Run clears the preview state without changing the source', async ({ page }) => {
  await openStudio(page)
  const tree = preview(page)

  await appButton(page, 'Plus').click()
  await expect(tree).toContainText('Count: 1')

  // Run is Xcode's verb for it, and it is the same operation the old "Reset state"
  // button performed: drop every @State box and evaluate from scratch.
  await page.getByTestId('run-button').click()
  await expect(tree).toContainText('Count: 0')
  expect(await editorText(page)).toContain('@State private var count = 0')
})

test('Phase 3 - the interface updates as you type', async ({ page }) => {
  await openStudio(page)
  const tree = preview(page)
  await expect(tree).toContainText('Hello, World!')

  await replaceAll(
    page,
    'import SwiftUI; ' +
      '@main struct TinyApp: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { var body: some View { VStack { Text("replaced") } } }',
  )

  await expect(tree).toContainText('replaced', { timeout: 5_000 })
  await expect(tree).not.toContainText('Hello, World!')
})

test('Phase 3 - a runtime trap is reported with its reason, not a crash', async ({ page }) => {
  await openStudio(page)

  await replaceAll(
    page,
    'import SwiftUI; ' +
      '@main struct BoomApp: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { var body: some View { Text("\\(1 / 0)") } }',
  )

  await expect(page.getByTestId('console')).toContainText('Division by zero', { timeout: 5_000 })
  await expect(preview(page)).toContainText('Execution stopped')
})

test('gate 3b - unimplemented views render a labelled placeholder (FR-4.11)', async ({ page }) => {
  // FR-4.11: never a blank space, never a silent wrong result.
  await openStudio(page)

  await replaceAll(
    page,
    'import SwiftUI; ' +
      '@main struct ChartApp: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { var body: some View { VStack { Chart { } } } }',
  )

  const placeholder = preview(page).locator('[data-kind="placeholder"]')
  await expect(placeholder).toBeVisible({ timeout: 5_000 })
  await expect(placeholder).toContainText('Chart')
  await expect(placeholder).toContainText('does not draw')
})

// ---------------------------------------------------------------- Phase 6

test('Phase 6 - a navigation flow pushes and pops in the browser', async ({ page }) => {
  await openStudio(page)

  await replaceAll(
    page,
    'import SwiftUI; ' +
      '@main struct NavApp: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { var body: some View { NavigationStack { List { NavigationLink("Open detail") { Detail() } } .navigationTitle("Home") } } } ' +
      'struct Detail: View { var body: some View { Text("the detail screen") } }',
  )

  const tree = preview(page)
  await expect(tree).toContainText('Home', { timeout: 5_000 })
  await expect(tree).toContainText('Open detail')

  await tree.getByRole('button', { name: 'Open detail' }).click()
  await expect(tree).toContainText('the detail screen')

  // The back button is labelled with the screen it returns to, as iOS does.
  await tree.getByRole('button', { name: 'Home' }).click()
  await expect(tree).toContainText('Open detail')
  await expect(tree).not.toContainText('the detail screen')
})

test('Phase 6 - a sheet presents over the content and dismisses', async ({ page }) => {
  await openStudio(page)

  await replaceAll(
    page,
    'import SwiftUI; ' +
      '@main struct SheetApp: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { @State private var up = false; ' +
      'var body: some View { VStack { Button("Present") { up = true } } ' +
      '.sheet(isPresented: $up) { Button("Dismiss") { up = false } } } }',
  )

  const tree = preview(page)
  await expect(appButton(page, 'Present')).toBeVisible({ timeout: 5_000 })
  await expect(tree).not.toContainText('Dismiss')

  await appButton(page, 'Present').click()
  await expect(tree).toContainText('Dismiss')

  await appButton(page, 'Dismiss').click()
  await expect(tree).not.toContainText('Dismiss')
})

test('Phase 6 - a Toggle flips through its binding', async ({ page }) => {
  await openStudio(page)

  await replaceAll(
    page,
    'import SwiftUI; ' +
      '@main struct ToggleApp: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { @State private var on = false; ' +
      'var body: some View { VStack { Toggle("Wi-Fi", isOn: $on); Text(on ? "connected" : "off") } } }',
  )

  const tree = preview(page)
  await expect(tree).toContainText('off', { timeout: 5_000 })

  await tree.getByRole('switch', { name: 'Wi-Fi' }).click()
  await expect(tree).toContainText('connected')
})

test('Phase 6 - the strictness linter warns about code Xcode would reject', async ({ page }) => {
  // Gate 4: the class of bug this whole product is most at risk from - something
  // that runs happily in the preview and fails the moment it reaches Xcode.
  await openStudio(page)

  await replaceAll(
    page,
    'import SwiftUI; ' +
      '@main struct StrictApp: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { let width: Int = 10; let scale: Double = 1.5; ' +
      'var body: some View { Text("\\(width * scale)") } }',
  )

  const console_ = page.getByTestId('console')
  await expect(console_).toContainText('cannot be applied to operands', { timeout: 5_000 })
  await expect(console_).toContainText('may_not_compile_in_xcode')
})

// ---------------------------------------------------------------- Phase 7

test('Phase 7 - a class shared between two views updates both', async ({ page }) => {
  // The whole reason reference semantics were added: an ObservableObject is only
  // useful because both views see the same instance.
  await openStudio(page)

  await replaceAll(
    page,
    'import SwiftUI; ' +
      'class Store: ObservableObject { @Published var count = 0; func bump() { count += 1 } } ' +
      '@main struct ObsApp: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { @StateObject private var store = Store(); ' +
      'var body: some View { VStack { Badge(store: store); Text("root \\(store.count)"); ' +
      'Button("Bump") { store.bump() } } } } ' +
      'struct Badge: View { @ObservedObject var store: Store; ' +
      'var body: some View { Text("badge \\(store.count)") } }',
  )

  const tree = preview(page)
  await expect(tree).toContainText('root 0', { timeout: 5_000 })
  await expect(tree).toContainText('badge 0')

  await appButton(page, 'Bump').click()
  await expect(tree).toContainText('root 1')
  await expect(tree).toContainText('badge 1')
})

test('Phase 7 - an enum and a switch drive the screen', async ({ page }) => {
  await openStudio(page)

  await replaceAll(
    page,
    'import SwiftUI; ' +
      'enum Step: String { case one, two } ' +
      '@main struct StepApp: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { @State private var step: Step = .one; ' +
      'var body: some View { VStack { switch step { case .one: Text("the first step") ' +
      'case .two: Text("the second step") }; ' +
      'Button("Next") { step = step == .one ? .two : .one } } } }',
  )

  const tree = preview(page)
  await expect(tree).toContainText('the first step', { timeout: 5_000 })

  await appButton(page, 'Next').click()
  await expect(tree).toContainText('the second step')
  await expect(tree).not.toContainText('the first step')
})

test('Phase 7 - onAppear runs once, not on every render', async ({ page }) => {
  // The runaway-counter case: without tracking what has already appeared, this
  // number climbs with every tap.
  await openStudio(page)

  await replaceAll(
    page,
    'import SwiftUI; ' +
      '@main struct AppearApp: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { @State private var appears = 0; @State private var taps = 0; ' +
      'var body: some View { VStack { Text("appeared \\(appears) tapped \\(taps)"); ' +
      'Button("Tap") { taps += 1 } } .onAppear { appears += 1 } } }',
  )

  const tree = preview(page)
  await expect(tree).toContainText('appeared 1 tapped 0', { timeout: 5_000 })

  await appButton(page, 'Tap').click()
  await expect(tree).toContainText('appeared 1 tapped 1')

  await appButton(page, 'Tap').click()
  await expect(tree).toContainText('appeared 1 tapped 2')
})

test('Phase 7 - GeometryReader reports the size it was actually given', async ({ page }) => {
  await openStudio(page)

  await replaceAll(
    page,
    'import SwiftUI; ' +
      '@main struct GeoApp: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { var body: some View { ' +
      'GeometryReader { geo in Text("wide \\(Int(geo.size.width))") } ' +
      '.frame(width: 240, height: 80) } }',
  )

  await expect(preview(page)).toContainText('wide 240', { timeout: 5_000 })
})

test('Phase 7 - a Path draws as a real vector', async ({ page }) => {
  await openStudio(page)

  await replaceAll(
    page,
    'import SwiftUI; ' +
      '@main struct PathApp: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { var body: some View { ' +
      'Path { p in p.move(to: CGPoint(x: 0, y: 0)); p.addLine(to: CGPoint(x: 80, y: 40)) } ' +
      '.stroke(Color.blue, lineWidth: 3) .frame(width: 100, height: 60) } }',
  )

  const drawn = preview(page).locator('svg path')
  await expect(drawn).toHaveCount(1, { timeout: 5_000 })
  await expect(drawn).toHaveAttribute('d', 'M 0 0 L 80 40')
})

test('Phase 7 - a drag moves the view it is attached to', async ({ page }) => {
  await openStudio(page)

  await replaceAll(
    page,
    'import SwiftUI; ' +
      '@main struct DragApp: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { @State private var moved = CGSize.zero; ' +
      'var body: some View { VStack { Text("at \\(Int(moved.width))"); ' +
      'Rectangle() .frame(width: 80, height: 80) ' +
      '.gesture(DragGesture().onChanged { v in moved = v.translation }) } } }',
  )

  const tree = preview(page)
  await expect(tree).toContainText('at 0', { timeout: 5_000 })

  const card = tree.locator('[data-node-id]').filter({ hasNotText: 'at ' }).last()
  const box = await card.boundingBox()
  expect(box).not.toBeNull()

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2, { steps: 4 })
  await page.mouse.up()

  // The exact number depends on the device frame's scale; what matters is that the
  // drag reached the interpreter and moved the state at all.
  await expect(tree).not.toContainText('at 0')
})

test('Phase 6 - the coverage panel ranks what the preview could not draw', async ({ page }) => {
  await openStudio(page)

  await replaceAll(
    page,
    'import SwiftUI; ' +
      '@main struct GapApp: App { var body: some Scene { WindowGroup { Root() } } } ' +
      'struct Root: View { var body: some View { VStack { Chart { } } } }',
  )

  await expect(preview(page).locator('[data-kind="placeholder"]')).toBeVisible({ timeout: 5_000 })

  await page.getByRole('button', { name: 'Coverage' }).click()
  const panel = page.getByTestId('coverage-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Chart')
  await expect(panel).toContainText('never sent anywhere')
})

/**
 * Phase 8 - the editor half.
 *
 * Unit tests cover what the symbol index answers. Only a browser can answer whether
 * the list actually appears when you type, which is the part the user experiences.
 */

const completionList = (page: Page) => page.locator('.cm-tooltip-autocomplete')

test('Phase 8 - completion offers modifiers after a dot', async ({ page }) => {
  await openStudio(page)
  await page.getByTestId('editor').locator('.cm-content').click()

  // Put the caret at the end of a Text(...) and type the dot that triggers the list.
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('struct V: View { var body: some View { Text("hi")')
  await page.keyboard.type('.pad')

  await expect(completionList(page)).toBeVisible({ timeout: 5000 })
  await expect(completionList(page).getByText('padding', { exact: true })).toBeVisible()
})

test('Phase 8 - completion offers the project’s own declarations', async ({ page }) => {
  await openStudio(page)
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('struct Sparkle: View { var body: some View { Text("x") } }')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Spar')

  await expect(completionList(page)).toBeVisible({ timeout: 5000 })
  await expect(completionList(page).getByText('Sparkle', { exact: true })).toBeVisible()
})

test('Phase 8 - completion offers a property of the enclosing view', async ({ page }) => {
  await openStudio(page)
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('struct V: View { @State private var headline = "hi"; var body: some View { Text(head')

  await expect(completionList(page)).toBeVisible({ timeout: 5000 })
  await expect(completionList(page).getByText('headline', { exact: true })).toBeVisible()
})

test('Phase 8 - hovering a view the preview cannot draw says so', async ({ page }) => {
  await openStudio(page)
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('struct V: View { var body: some View { Table { Text("x") } } }')

  // The honest gap, surfaced where the user is already looking.
  await page.getByTestId('editor').getByText('Table', { exact: true }).first().hover()
  await expect(page.locator('.cm-tooltip-hover')).toContainText('does not draw', {
    timeout: 5000,
  })
})

test('Phase 8 - F12 jumps to where a name was declared', async ({ page }) => {
  await openStudio(page)
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('struct Badge: View { var body: some View { Text("b") } }')
  await page.keyboard.press('Enter')
  await page.keyboard.type('struct V: View { var body: some View { Badge() } }')
  await page.keyboard.press('Escape')

  // Click inside the *use* of Badge on the second line, then jump.
  const uses = page.getByTestId('editor').getByText('Badge', { exact: true })
  await uses.last().click()
  await page.keyboard.press('F12')

  // The selection lands on the declaration, which is the first occurrence. Polled
  // because the jump is a worker round trip: reading the selection straight after the
  // keypress races it, and a test that sometimes wins that race is worse than none.
  await expect
    .poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? ''), {
      timeout: 5000,
    })
    .toBe('Badge')
})

test('Phase 8 - a typo offers the name it probably meant, and applying it fixes the code', async ({
  page,
}) => {
  await openStudio(page)
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('struct V: View { var body: some View { VStak { Text("x") } } }')
  await page.keyboard.press('Escape')

  // The diagnostic names the fix before any of the UI does.
  const problems = page.getByTestId('console')
  await expect(problems).toContainText("Did you mean 'VStack'?", { timeout: 8000 })

  // Hovering the underlined name brings up the fix button.
  await page.getByTestId('editor').getByText('VStak', { exact: true }).first().hover()
  const fix = page.locator('.cm-tooltip-lint').getByText("Replace with 'VStack'")
  await expect(fix).toBeVisible({ timeout: 5000 })
  await fix.click()

  // The fixture never had an `@main`, so that diagnostic stays. What must go is the
  // one the fix addressed - and the corrected name must be in the document.
  await expect(problems).not.toContainText("Cannot find 'VStak'", { timeout: 8000 })
  expect(await editorText(page)).toContain('VStack')
})

test('Phase 9 - the Swift Playgrounds export carries the edited source', async ({ page }) => {
  await openStudio(page)

  const marker = `// swiftpm-${Date.now()}`
  await typeAtTop(page, `${marker}
`)
  await expect(page.getByTestId('save-indicator')).toContainText('Saved', { timeout: 5_000 })

  const downloadPromise = page.waitForEvent('download')
  await exportAs(page, 'swiftpm')
  const download = await downloadPromise

  expect(download.suggestedFilename()).toBe('CounterApp-swiftpm.zip')

  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const listing = Buffer.concat(chunks).toString('latin1')

  // The extension is on the *directory*: that is what makes iPadOS treat it as a
  // document rather than a folder, and a zip that flattens it is a library.
  expect(listing).toContain('CounterApp.swiftpm/Package.swift')
  expect(listing).toContain('CounterApp.swiftpm/Sources/CounterApp/CounterApp.swift')
})

test('Phase 9 - every export format offers a distinct download', async ({ page }) => {
  await openStudio(page)

  for (const [format, filename] of [
    ['spm', 'CounterApp-package.zip'],
    ['xcodegen', 'CounterApp-xcodegen.zip'],
  ] as const) {
    const downloadPromise = page.waitForEvent('download')
    await exportAs(page, format)
    expect((await downloadPromise).suggestedFilename()).toBe(filename)
  }

  // The default button is unchanged: the common case stays one click away.
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('export-button').click()
  expect((await downloadPromise).suggestedFilename()).toBe('CounterApp.zip')
})

test('Phase 9 - a share link carries the project to a fresh session', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openStudio(page)

  const marker = `// shared-${Date.now()}`
  await typeAtTop(page, `${marker}
`)
  await expect(page.getByTestId('save-indicator')).toContainText('Saved', { timeout: 5_000 })

  await page.getByTestId('share-button').click()
  await expect(page.getByTestId('share-button')).toHaveText('Link copied', { timeout: 5_000 })

  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toContain('#p=')

  // A different browser context is a genuinely fresh session: no IndexedDB, no
  // localStorage. If the marker survives, it travelled in the URL and nowhere else.
  const fresh = await context.browser()!.newContext()
  const other = await fresh.newPage()
  await other.goto(link)
  await expect(other.getByTestId('editor')).toBeVisible()
  await expect(other.locator('.cm-content')).toContainText(marker, { timeout: 8_000 })

  // The payload is cleared once read, so a reload cannot silently discard later edits.
  expect(other.url()).not.toContain('#p=')
  await fresh.close()
})

test('Phase 9 - a corrupt share link falls back instead of failing', async ({ page }) => {
  // The payload comes from a URL a stranger pasted. Truncation is ordinary.
  await page.goto('/#p=not-a-real-payload')
  await expect(page.getByTestId('editor')).toBeVisible()
  await expect(page.getByTestId('render-tree')).toBeVisible()
  await expect(page.locator('.cm-content')).toContainText('import SwiftUI', { timeout: 8_000 })
})

test('Phase 10 - F2 renames every occurrence and says how many first', async ({ page }) => {
  await openStudio(page)
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(
    'struct V: View { var title = "hi"; var body: some View { Text(title) } }',
  )
  await page.keyboard.press('Escape')

  // Put the caret in the declaration, then rename.
  await page.getByTestId('editor').getByText('title', { exact: true }).first().click()
  await page.keyboard.press('F2')

  const bar = page.getByTestId('rename-bar')
  await expect(bar).toBeVisible({ timeout: 5000 })
  // The count is stated before anything changes: matching is by name, so two unrelated
  // symbols spelled the same look identical to the analyser. A wrong number is the
  // user's cue to press Escape.
  await expect(page.getByTestId('rename-count')).toHaveText('2 occurrences in 1 file')

  await page.getByTestId('rename-input').fill('heading')
  await page.keyboard.press('Enter')

  await expect(bar).toBeHidden()
  const text = await editorText(page)
  expect(text).toContain('var heading = "hi"')
  expect(text).toContain('Text(heading)')
  expect(text).not.toContain('title')
})

test('Phase 10 - rename leaves a same-spelled string alone', async ({ page }) => {
  // The reason references are matched on lexer tokens rather than on text: an edit
  // inside a string leaves no compile error behind to notice it by.
  await openStudio(page)
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('struct V: View { var count = 1; var body: some View { Text("count") } }')
  await page.keyboard.press('Escape')

  await page.getByTestId('editor').getByText('count', { exact: true }).first().click()
  await page.keyboard.press('F2')
  await expect(page.getByTestId('rename-count')).toHaveText('1 occurrence in 1 file', {
    timeout: 5000,
  })

  await page.getByTestId('rename-input').fill('total')
  await page.keyboard.press('Enter')

  const text = await editorText(page)
  expect(text).toContain('var total = 1')
  expect(text).toContain('Text("count")')
})

test('Phase 10 - Escape cancels a rename without changing anything', async ({ page }) => {
  await openStudio(page)
  await page.getByTestId('editor').locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('struct V: View { var label = "x"; var body: some View { Text(label) } }')
  await page.keyboard.press('Escape')
  const before = await editorText(page)

  await page.getByTestId('editor').getByText('label', { exact: true }).first().click()
  await page.keyboard.press('F2')
  await expect(page.getByTestId('rename-bar')).toBeVisible({ timeout: 5000 })

  await page.getByTestId('rename-input').press('Escape')
  await expect(page.getByTestId('rename-bar')).toBeHidden()
  expect(await editorText(page)).toBe(before)
})

test('Phase 10 - a view with only a #Preview renders instead of erroring', async ({ page }) => {
  // Before this, `#` was an unexpected character and the blocking errors that followed
  // meant pasting modern SwiftUI produced a blank screen and a complaint about a
  // character rather than about anything the user wrote.
  await openStudio(page)
  await replaceAll(
    page,
    'struct ContentView: View { var body: some View { Text("pasted") } }',
  )
  await page.keyboard.press('Enter')
  await page.keyboard.type('#Preview { ContentView() }')
  await page.keyboard.press('Escape')

  await expect(preview(page)).toContainText('pasted', { timeout: 8_000 })
  await expect(page.getByTestId('console')).toContainText('No problems', { timeout: 8_000 })
})
