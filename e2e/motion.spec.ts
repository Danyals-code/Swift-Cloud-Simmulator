import { expect, test, type Locator, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * States and motion (Wave 5a): Shown when writes an `if`, a view hidden in this state stays
 * in Layers, dimmed, with Show it; a view's transition, a tap's animation, rolling digits and
 * a view that moves with another between two states are set in Design, and play in Preview.
 */
const SOURCE = `import SwiftUI

@main
struct MotionApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
    @State private var showBanner = true
    @State private var big = false
    @State private var count = 9

    var body: some View {
        VStack(spacing: 16) {
            Text("Check-in opens soon")
            if showBanner {
                Text("Banner")
            }
            Text("\\(count)")
                .font(.largeTitle)
            if big {
                RoundedRectangle(cornerRadius: 24)
                    .fill(.blue)
                    .frame(width: 240, height: 160)
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .fill(.blue)
                    .frame(width: 60, height: 60)
            }
            Button("Toggle banner") {
                showBanner.toggle()
            }
            Button("Add one") {
                withAnimation(.linear(duration: 2)) {
                    count += 1
                }
            }
            Button("Grow") {
                withAnimation(.linear(duration: 2)) {
                    big.toggle()
                }
            }
        }
    }
}`

const layers = (page: Page) => page.getByTestId('logical-layers')
const row = (page: Page, name: string, text?: string) => text ? layers(page).locator(`[data-source-name="${name}"]`).filter({ hasText: text }) : layers(page).locator(`[data-source-name="${name}"]`)
const inspector = (page: Page) => page.getByTestId('authoring-inspector')
const visibility = (page: Page) => inspector(page).getByTestId('settings-visibility')
const canvas = (page: Page) => page.getByTestId('render-tree')
const control = (page: Page, id: string) => visibility(page).locator(`[data-control-id="${id}"]`)

/** Picks the option of `select` whose words match `label`, whatever value it carries. */
async function choose(select: Locator, label: RegExp) {
  const option = select.locator('option').filter({ hasText: label }).first()
  await expect(option).toHaveCount(1)
  await select.selectOption(await option.getAttribute('value') ?? '')
}

/** Waits for the edit to be drawn and the panel to settle. */
async function idle(page: Page) {
  await expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
}

/** The Swift, read in Code until the edit has landed and it holds `expected` (or, with `absent`, no longer does). */
async function swiftHas(page: Page, expected: string | RegExp, absent = false) {
  await idle(page)
  const has = async () => { const swift = await sourceInCode(page); return typeof expected === 'string' ? swift.includes(expected) : expected.test(swift) }
  await expect.poll(has).toBe(!absent)
}

/** Whether the element, or one inside it, is playing a CSS animation or transition right now. */
function moving(locator: Locator): Promise<boolean> {
  return locator.evaluate(element => [element, ...Array.from(element.querySelectorAll('*'))].some(item => item.getAnimations().some(animation => animation.playState === 'running')))
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await openInDesign(page, SOURCE, 'Check-in opens soon')
})

test('Shown when writes an if around a view, a hidden view stays in Layers dimmed, and Show it draws it', async ({ page }) => {
  await row(page, 'Text', 'Check-in opens soon').click()
  const shownWhen = visibility(page).getByLabel('Shown when', { exact: true })
  await expect(shownWhen).toHaveValue('')
  await choose(shownWhen, /^\+ New on\/off switch/)
  await visibility(page).getByLabel('New switch name', { exact: true }).fill('showsNote')
  // A new switch starts on, so nothing vanishes while it is designed.
  await expect(visibility(page).getByLabel('New switch starts as', { exact: true })).toHaveValue('true')
  await visibility(page).getByRole('button', { name: 'Create switch', exact: true }).click()
  await swiftHas(page, /if showsNote \{\n\s+Text\("Check-in opens soon"\)\n\s+\}/)
  expect(await sourceInCode(page)).toContain('@State private var showsNote = true')
  await expect(canvas(page).getByText('Check-in opens soon', { exact: true })).toBeVisible()

  // Shown only while the switch is off: hidden now, and listed dimmed rather than dropped.
  await row(page, 'Text', 'Check-in opens soon').click()
  await choose(visibility(page).getByLabel('Shown when', { exact: true }), /Shows note is off$/)
  await swiftHas(page, 'if !showsNote {')
  await expect(canvas(page).getByText('Check-in opens soon', { exact: true })).toHaveCount(0)
  const hidden = row(page, 'Text', 'Check-in opens soon')
  await expect(hidden).toHaveAttribute('data-inactive', 'true')
  // Said in its own words, never the ", hidden" of a view hidden with Hide (Wave 5a).
  await expect(hidden).toHaveAttribute('aria-label', /, hidden while Shows note is on$/)
  await hidden.click()
  await expect(visibility(page)).toContainText(/Hidden while Shows note is on\./)

  // Show it switches to a state that draws it; the Swift is left as it is.
  const swift = await sourceInCode(page)
  await hidden.getByRole('button', { name: 'Show it', exact: true }).click()
  await expect(canvas(page).getByText('Check-in opens soon', { exact: true })).toBeVisible()
  await expect(row(page, 'Text', 'Check-in opens soon')).not.toHaveAttribute('data-inactive', 'true')
  expect(await sourceInCode(page)).toBe(swift)

  // Always takes the if away again.
  await row(page, 'Text', 'Check-in opens soon').click()
  await visibility(page).getByLabel('Shown when', { exact: true }).selectOption('')
  await swiftHas(page, 'if !showsNote', true)
})

test('a transition is set beside Shown when, changed, faded too and taken off', async ({ page }) => {
  await row(page, 'Text', 'Banner').click()
  // Shown when and Transition sit together; Advanced no longer offers an appear animation.
  await expect(inspector(page).getByText('Appear animation', { exact: true })).toHaveCount(0)
  await choose(control(page, 'motion:transition'), /^Slide$/)
  await swiftHas(page, '.transition(.slide)')
  await row(page, 'Text', 'Banner').click()
  await choose(control(page, 'motion:transition'), /^Scale$/)
  await swiftHas(page, '.transition(.scale')
  expect(await sourceInCode(page)).not.toContain('.transition(.slide)')
  await row(page, 'Text', 'Banner').click()
  await control(page, 'motion:fades').click()
  await swiftHas(page, '.combined(with: .opacity)')
  await row(page, 'Text', 'Banner').click()
  await choose(control(page, 'motion:transition'), /^None$/)
  await swiftHas(page, '.transition(', true)
  // A view that is always shown has no transition to set.
  await row(page, 'Text', 'Check-in opens soon').click()
  await expect(control(page, 'motion:transition')).toHaveCount(0)
})

test('Animate this change wraps a tap in withAnimation, reads back, and Preview animates the change', async ({ page }) => {
  await row(page, 'Button', 'Toggle banner').click()
  const animate = inspector(page).getByRole('checkbox', { name: 'Animate this change', exact: true })
  await expect(animate).not.toBeChecked()
  await animate.check()
  await swiftHas(page, /withAnimation\(\.smooth\) \{\n\s+showBanner\.toggle\(\)\n\s+\}/)
  await row(page, 'Button', 'Toggle banner').click()
  await expect(inspector(page)).toContainText('animated, Smooth')
  await expect(inspector(page)).toContainText('Switches Show Banner on / off')
  await inspector(page).getByLabel('Animation style', { exact: true }).selectOption('linear')
  await swiftHas(page, 'withAnimation(.linear(')
  await row(page, 'Button', 'Toggle banner').click()
  const duration = inspector(page).getByLabel('Animation duration', { exact: true })
  await duration.fill('2')
  await duration.press('Enter')
  await swiftHas(page, 'withAnimation(.linear(duration: 2)) {')

  // In Preview the banner fades out over the change, as iOS's default transition does.
  await page.getByTestId('live-toggle').click()
  await canvas(page).getByRole('button', { name: 'Toggle banner', exact: true }).click()
  const leaving = canvas(page).locator('[data-transition-exit="true"]').filter({ hasText: 'Banner' })
  await expect(leaving).toHaveCount(1)
  await expect.poll(() => moving(leaving)).toBe(true)
  await expect(leaving).toHaveCount(0, { timeout: 5000 })

  // Switching it off unwraps the action and keeps what it does. "Stop preview" brings Design's canvas back.
  await page.getByTestId('inspect-toggle').click()
  await row(page, 'Button', 'Toggle banner').click()
  await inspector(page).getByRole('checkbox', { name: 'Animate this change', exact: true }).uncheck()
  await swiftHas(page, /Button\("Toggle banner"\) \{\n\s+showBanner\.toggle\(\)\n\s+\}/)
})

test('Rolls digits on a Text showing a number writes numeric text, and the digits roll in Preview', async ({ page }) => {
  // The number is selected where it is drawn.
  await canvas(page).getByText('9', { exact: true }).click()
  await expect(inspector(page)).toBeVisible()
  const rolls = control(page, 'motion:rolls-digits')
  await expect(rolls).toHaveAttribute('aria-checked', 'false')
  await rolls.click()
  // The Counter targets iOS 27, so the value is passed, as iOS 17 can take it (Wave 5a).
  await swiftHas(page, '.contentTransition(.numericText(value: Double(count)))')
  await canvas(page).getByText('9', { exact: true }).click()
  await expect(control(page, 'motion:rolls-digits')).toHaveAttribute('aria-checked', 'true')

  await page.getByTestId('live-toggle').click()
  const id = await canvas(page).locator('[data-node-id]').filter({ hasText: /^9$/ }).last().getAttribute('data-node-id')
  await canvas(page).getByRole('button', { name: 'Add one', exact: true }).click()
  await expect.poll(() => moving(canvas(page).locator(`[data-node-id="${id}"]`))).toBe(true)
  await expect(canvas(page).getByText('10', { exact: true })).toBeVisible({ timeout: 5000 })
})

test('Moves with marks two views of an if and else as one, and it morphs between the two states', async ({ page }) => {
  // The big card is hidden while big is off: listed dimmed, before the small one it replaces.
  const cards = row(page, 'RoundedRectangle')
  await expect(cards).toHaveCount(2)
  await expect(cards.nth(0)).toHaveAttribute('data-inactive', 'true')
  await cards.nth(1).click()
  const movesWith = control(page, 'motion:moves-with')
  await expect(movesWith.locator('option')).toHaveCount(2)
  await movesWith.selectOption({ index: 1 })
  await swiftHas(page, '@Namespace private var namespace')
  const swift = await sourceInCode(page)
  expect(swift.match(/\.matchedGeometryEffect\(id: /g)).toHaveLength(2)

  // Show it switches to the state that draws the big card, and the small one is then the hidden one.
  await row(page, 'RoundedRectangle').nth(0).getByRole('button', { name: 'Show it', exact: true }).click()
  await expect(row(page, 'RoundedRectangle').nth(0)).not.toHaveAttribute('data-inactive', 'true')
  await expect(row(page, 'RoundedRectangle').nth(1)).toHaveAttribute('data-inactive', 'true')
  await page.getByTestId('level-screen').click()
  await page.getByTestId('screen-states').getByRole('button', { name: /^Default/ }).click()
  await expect(row(page, 'RoundedRectangle').nth(1)).not.toHaveAttribute('data-inactive', 'true')

  // In Preview the card grows into its place instead of fading.
  await page.getByTestId('live-toggle').click()
  await canvas(page).getByRole('button', { name: 'Grow', exact: true }).click()
  // The card is the drawing with no words in it.
  await expect.poll(() => canvas(page).evaluate(root => Array.from(root.querySelectorAll('[data-node-id]')).filter(node => !node.textContent?.trim() && !node.closest('button, [role="button"]'))
    .some(node => node.getAnimations().some(animation => animation.playState === 'running')))).toBe(true)
})
