import { expect, test, type Page } from '@playwright/test'
import { addModifier, openInDesign, sourceInCode } from './designer-helpers'

/**
 * Reaching the code people write (doc 18, Wave 3a), in Chrome and Safari alike: views in
 * a helper, a computed `some View` or a function, are layers in a group named after it,
 * selected on the canvas and changed where they are written; a Toggle's label is a layer
 * of its own; a row reads like the text it draws.
 */

const APP = `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { HomeScreen() }
    }
}

struct HomeScreen: View {
    @State private var wifi = true
    let items = ["Milk", "Eggs"]

    var body: some View {
        VStack(spacing: 12) {
            header
            stats(title: "Done", count: 3)
            stats(title: "Left", count: 4)
            Toggle(isOn: $wifi) {
                Text("Wi-Fi")
            }
            ForEach(items, id: \\.self) { item in
                Text(item)
            }
            Text("Hello, ") + Text("World").bold()
        }
        .padding()
    }

    var header: some View {
        Text("Welcome")
            .font(.title)
    }

    @ViewBuilder
    func stats(title: String, count: Int) -> some View {
        HStack {
            Text(title)
            Text("\\(count)")
        }
    }
}
`

const drawn = (page: Page, text: string) => page.getByTestId('render-tree').getByText(text, { exact: true })
const inspector = (page: Page) => page.getByTestId('authoring-inspector')
const layers = (page: Page) => page.getByTestId('logical-layers')
const layer = (page: Page, name: string) => layers(page).getByRole('treeitem', { name, exact: true })
/** The selected view's name, as the settings panel heads it. */
const selectedName = (page: Page) => inspector(page).locator('header strong')
const idle = (page: Page) => expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')

test('a view in a helper is a layer in a group named after it, selected on the canvas and changed where it is written', async ({ page }) => {
  await openInDesign(page, APP, 'Welcome')
  await expect(layer(page, 'header, Group')).toBeVisible()

  // A click selects the place the helper is used, outlined as what it draws there, and styles it there.
  await drawn(page, 'Welcome').click()
  await expect(selectedName(page)).toHaveText('header')
  await expect(layer(page, 'header, Group')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('selection-outline')).toHaveCount(1)
  await addModifier(page, 'Opacity', 'opacity')
  await idle(page)

  // ⌘ reaches the view inside the helper, changed where it is written.
  await drawn(page, 'Welcome').click({ modifiers: ['ControlOrMeta'] })
  await expect(selectedName(page)).toHaveText('Welcome')
  await expect(layer(page, 'Welcome, Text')).toHaveAttribute('aria-selected', 'true')
  const content = inspector(page).getByRole('textbox', { name: 'Text', exact: true })
  await content.fill('Hello')
  await content.press('Enter')
  await expect(drawn(page, 'Hello')).toBeVisible()
  await idle(page)
  await addModifier(page, 'Underline', 'underline')
  await idle(page)
  const source = await sourceInCode(page)
  expect(source).toContain('            header.opacity(1)\n')
  expect(source).toContain(`    var header: some View {
        Text("Hello")
            .font(.title)
            .underline()
    }`)
})

test('a helper used in two places lists its views under both, and a change reaches both', async ({ page }) => {
  await openInDesign(page, APP, 'Done')
  const groups = layers(page).getByRole('treeitem', { name: 'stats, Group', exact: true })
  await expect(groups).toHaveCount(2)
  await expect(groups.first()).toContainText('2 places')
  await expect(groups.first().getByTitle('Used in 2 places. A change to its views reaches each of them.')).toBeVisible()

  // A click selects the place clicked, and Layers says what a change there reaches.
  await drawn(page, 'Done').click()
  await expect(selectedName(page)).toHaveText('stats')
  await expect(page.getByTestId('selection-outline')).toHaveCount(1)

  // ⌘ reaches the text, one view drawn in both places, where each reads what it draws there.
  await drawn(page, 'Done').click({ modifiers: ['ControlOrMeta'] })
  await expect(layer(page, 'Done, Text')).toHaveAttribute('aria-selected', 'true')
  await expect(layer(page, 'Left, Text')).toHaveAttribute('aria-selected', 'true')
  // A helper's only view can't go: what would be left would not build.
  await layers(page).getByRole('treeitem', { name: 'Row', exact: true }).first().click()
  await expect(selectedName(page)).toHaveText('Row')
  await page.keyboard.press('Backspace')
  await expect(page.getByTestId('design-feedback')).toContainText('This is the only view here, and this spot can’t be left empty.')
  await expect(drawn(page, 'Done')).toBeVisible()

  await drawn(page, 'Done').click({ modifiers: ['ControlOrMeta'] })
  await addModifier(page, 'Opacity', 'opacity')
  await idle(page)
  expect(await sourceInCode(page)).toContain(`        HStack {
            Text(title).opacity(1)
            Text("\\(count)")
        }`)
})

test('a Toggle’s label is a layer of its own, and a row reads like the text it draws', async ({ page }) => {
  await openInDesign(page, APP, 'Wi-Fi')
  // The switch's tap target is drawn over its label, as on iOS; a click still finds the label under it.
  await drawn(page, 'Wi-Fi').click({ modifiers: ['ControlOrMeta'], force: true })
  await expect(selectedName(page)).toHaveText('Wi-Fi')
  await expect(layer(page, 'Wi-Fi, Text')).toHaveAttribute('aria-selected', 'true')
  const content = inspector(page).getByRole('textbox', { name: 'Text', exact: true })
  await content.fill('Bluetooth')
  await content.press('Enter')
  await expect(drawn(page, 'Bluetooth')).toBeVisible()
  await idle(page)
  expect(await sourceInCode(page)).toContain(`            Toggle(isOn: $wifi) {
                Text("Bluetooth")
            }`)

  // `Text(item)` draws "Milk" in its first row, and its row in Layers says so, as the settings do.
  await expect(layer(page, 'Milk, Text')).toBeVisible()
  await drawn(page, 'Eggs').click()
  await expect(selectedName(page)).toHaveText('Eggs')
})

test('texts joined with + are one Text, whose runs take text styles only', async ({ page }) => {
  await openInDesign(page, APP, 'Hello, World')
  await drawn(page, 'Hello, World').click()
  await expect(selectedName(page)).toHaveText('Hello, World')
  await layers(page).getByRole('button', { name: 'Expand Hello, World', exact: true }).click()
  await layer(page, 'World, Text').click()
  await expect(selectedName(page)).toHaveText('World')
  // Only the Text section: a size or a padding would make the run a view, which Swift can't join.
  await expect(inspector(page).getByTestId('layer-layout')).toHaveCount(0)
  await addModifier(page, 'Underline', 'underline')
  await idle(page)
  expect(await sourceInCode(page)).toContain('            Text("Hello, ") + Text("World").bold().underline()\n')
})

test('a helper nothing calls any more is listed as not used, its views still change, and it can be removed', async ({ page }) => {
  await openInDesign(page, APP, 'Welcome')
  await layer(page, 'header, Group').click()
  await page.keyboard.press('Backspace')
  await expect(drawn(page, 'Welcome')).toHaveCount(0)
  await idle(page)

  // The helper stays in the code, and Layers lists it under its view rather than nowhere.
  const unused = layer(page, 'header, Not used')
  await expect(unused).toBeVisible()
  await unused.click()
  await expect(selectedName(page)).toHaveText('header')
  await expect(inspector(page).getByText('Not used anywhere yet.', { exact: true })).toBeVisible()

  // Its views are selected and changed where they are written.
  await layers(page).getByRole('button', { name: 'Expand header', exact: true }).click()
  await layer(page, 'Welcome, Text').click()
  await expect(selectedName(page)).toHaveText('Welcome')
  const content = inspector(page).getByRole('textbox', { name: 'Text', exact: true })
  await content.fill('Hello')
  await content.press('Enter')
  await idle(page)
  expect(await sourceInCode(page)).toContain(`    var header: some View {
        Text("Hello")
            .font(.title)
    }`)

  // It opens in Code, and goes from Design once nothing reads it.
  await layer(page, 'header, Not used').click()
  await inspector(page).getByRole('button', { name: 'View actions', exact: true }).click()
  await page.getByRole('option', { name: 'Open in Code', exact: true }).click()
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('var header: some View {')
  await page.getByTestId('workspace-design').click()
  await layer(page, 'header, Not used').getByRole('button', { name: 'Actions for header', exact: true }).click()
  await page.getByRole('option', { name: 'Remove header', exact: true }).click()
  await expect(layer(page, 'header, Not used')).toHaveCount(0)
  await idle(page)
  expect(await sourceInCode(page)).not.toContain('var header')
})

test('text a helper is given says where to change it', async ({ page }) => {
  await openInDesign(page, APP, 'Done')
  await drawn(page, 'Done').click({ modifiers: ['ControlOrMeta'] })
  await expect(layer(page, 'Done, Text')).toHaveAttribute('aria-selected', 'true')
  await expect(inspector(page).getByText('This text is set where this helper is used. Change it there.', { exact: true })).toBeVisible()
})

const CARD = `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { HomeScreen() }
    }
}

struct HomeScreen: View {
    var body: some View {
        VStack {
            Card(title: "Settings") {
                Text("Inside")
            }
        }
    }
}

struct Card<Content: View>: View {
    let title: String
    let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack {
            Text(title)
            content
        }
    }
}
`

test('a container with an init of its own has its content as layers and its title as a field where it is used', async ({ page }) => {
  await openInDesign(page, CARD, 'Settings')
  const card = layer(page, 'Card, Component')
  await card.click()
  const title = inspector(page).getByRole('textbox', { name: 'title', exact: true })
  await expect(title).toHaveValue('Settings')
  await title.fill('Account')
  await title.press('Enter')
  await expect(drawn(page, 'Account')).toBeVisible()
  await idle(page)
  expect(await sourceInCode(page)).toContain('Card(title: "Account") {')

  await layers(page).getByRole('button', { name: 'Expand Card', exact: true }).click()
  await layer(page, 'Inside, Text').click()
  await expect(selectedName(page)).toHaveText('Inside')
})
