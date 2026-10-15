import { expect, test, type Page } from '@playwright/test'
import { openInDesign, replaceSource, sourceInCode } from './designer-helpers'

/**
 * Wave 3b-2, screens: every `#Preview` drawn on the Design canvas beside the app, and the
 * last good drawing kept, still selectable, while another file has an error.
 */

const PREVIEWS = `import SwiftUI

@main
struct PreviewsApp: App {
    var body: some Scene {
        WindowGroup { Greeting(name: "App") }
    }
}

struct Greeting: View {
    var name: String
    var body: some View {
        Text("Hello, \\(name)")
    }
}

#Preview("Long name") {
    Greeting(name: "Bartholomew")
}

#Preview {
    VStack {
        Text("Inline preview")
    }
}
`

const HOME = `import SwiftUI

struct HomeScreen: View {
    var body: some View {
        VStack(spacing: 16) {
            Text("Kept title")
            Text("Kept detail")
        }
    }
}

#Preview {
    HomeScreen()
}
`

// `HomeScreen(` is missing its closing parenthesis, which the parser notices on line 8.
const BROKEN_APP = `import SwiftUI

@main
struct MyDesignApp: App {
    var body: some Scene {
        WindowGroup {
            HomeScreen(
        }
    }
}
`

const drawn = (page: Page, text: string) => page.getByTestId('render-tree').getByText(text, { exact: true })
const phones = (page: Page) => page.getByTestId('gallery-page')
/** The selected view's name, as the settings panel heads it. */
const selectedName = (page: Page) => page.getByTestId('authoring-inspector').locator('header strong')

/** Fits the canvas, then parks the pointer on the toolbar, out of the way of the phones. */
async function fit(page: Page) {
  await page.getByTestId('zoom-select').click()
  await page.getByRole('option', { name: /Fit/ }).click()
  await page.getByTestId('toolbar').hover()
}

test('each #Preview is drawn on its own in a Previews lane, and its views are edited where they are written', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await openInDesign(page, PREVIEWS, 'Hello, App')
  // The app's screen, then each preview named by its title, or by its place where it shows no one view.
  await expect(phones(page)).toHaveCount(3)
  await expect(page.locator('[data-testid="gallery-page"][data-page-kind="preview"]')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Edit Long name', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit Preview 2', exact: true })).toBeVisible()
  await expect(page.getByTestId('canvas-lane').filter({ hasText: 'Previews' })).toBeVisible()
  await expect(drawn(page, 'Hello, Bartholomew')).toBeVisible()
  await fit(page)

  // Text edited where it is drawn is written inside its #Preview.
  await drawn(page, 'Inline preview').dblclick()
  const editor = page.getByRole('textbox', { name: 'Canvas text', exact: true })
  await expect(editor).toHaveValue('Inline preview')
  await editor.fill('Edited preview')
  await editor.press('Enter')
  await expect(drawn(page, 'Edited preview')).toBeVisible()
  expect(await sourceInCode(page)).toContain('#Preview {\n    VStack {\n        Text("Edited preview")\n    }\n}')
})

test('a #Preview selected on the canvas is the screen the breadcrumb, Screen settings and Screens list name', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await openInDesign(page, PREVIEWS, 'Hello, App')
  await page.getByRole('button', { name: 'Edit Long name', exact: true }).click()
  await expect(page.getByTestId('level-screen')).toHaveText('Long name')
  const settings = page.getByTestId('screen-settings')
  await expect(settings.locator('strong').first()).toHaveText('Long name')
  await expect(settings).toContainText('A #Preview · drawn on its own, not in the app')
  await expect(page.locator('[data-testid="design-screen"][aria-selected="true"]')).toHaveText('Long name')
  // It is no view's screen: it has no states, and no name of its own to change.
  await expect(settings.getByTestId('screen-states')).toHaveCount(0)
  await expect(settings.getByRole('textbox', { name: 'Screen name', exact: true })).toHaveCount(0)
})

test('a syntax error in another file keeps the last drawing, selectable, and an edit waits for the fix', async ({ page }) => {
  // A designer's project: the app in one file, the Home screen in another.
  await page.goto('/')
  await page.getByTestId('template-blank').click()
  await page.getByTestId('template-confirm').click()
  await expect(page.getByTestId('template-gallery')).toBeHidden()
  await page.getByTestId('workspace-develop').click()
  await page.getByTestId('file-rail').getByText('HomeScreen.swift').click()
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('struct HomeScreen')
  await replaceSource(page, HOME)
  await page.getByTestId('workspace-design').click()
  await expect(drawn(page, 'Kept title')).toBeVisible()

  await page.getByTestId('workspace-develop').click()
  await page.getByTestId('file-rail').getByText('MyDesignApp.swift').click()
  await expect(page.getByTestId('editor').locator('.cm-content')).toContainText('struct MyDesignApp')
  await replaceSource(page, BROKEN_APP)
  await page.getByTestId('workspace-design').click()

  // The drawing stays, dimmed, and so does its screen in the Screens list; one line says why.
  const stoppedBy = page.getByTestId('stopped-by')
  await expect(stoppedBy).toHaveText('Showing the last drawing · MyDesignApp.swift has an error on line 8')
  await expect(phones(page)).toHaveCount(1)
  await expect(drawn(page, 'Kept title')).toBeVisible()
  await expect(page.getByTestId('design-screen').getByRole('button', { name: 'Home', exact: true })).toBeVisible()

  // Its views can still be selected.
  await drawn(page, 'Kept title').click()
  await expect(selectedName(page)).toHaveText('Kept title')

  // An edit waits for the fix, and says where it is.
  await page.keyboard.press('Backspace')
  await expect(page.getByTestId('design-feedback')).toHaveText('MyDesignApp.swift has an error on line 8, so the design can’t be changed until it’s fixed in Code.')
  await expect(drawn(page, 'Kept title')).toBeVisible()

  // The line opens the file at the error.
  await stoppedBy.click()
  await expect(page.getByTestId('editor')).toBeVisible()
  await expect(page.getByTestId('editor').locator('.cm-lineNumbers .cm-activeLineGutter')).toHaveText('8')
})
