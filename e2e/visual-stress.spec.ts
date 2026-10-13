import { expect, test } from '@playwright/test'
import { openCounter } from './designer-helpers'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../tests/fixtures/ios27-visual-stress.swift', import.meta.url), 'utf8')

test('visual stress fixture: alert editing and fixed-height colored sheet', async ({ page }) => {
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  // Code opens with the preview pointing at views; this test taps it as an app.
  await page.getByTestId('live-toggle').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(source)
  const preview = page.getByTestId('render-tree')
  await expect(preview.getByRole('button', { name: 'Present', exact: true })).toBeVisible()
  await page.getByTestId('device-select').click()
  await page.getByTestId('device-select-menu-iphone-18-pro').click()
  await preview.getByRole('button', { name: 'Present', exact: true }).click()
  await preview.getByRole('button', { name: 'Alert with text field', exact: true }).click()
  const field = preview.getByRole('textbox', { name: 'Name', exact: true })
  await expect(field).toHaveValue('Taylor')
  await field.fill('Morgan')
  await preview.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(field).toHaveCount(0)
  await preview.getByRole('button', { name: 'Alert with text field', exact: true }).click()
  await expect(field).toHaveValue('Morgan')
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click()
  await preview.getByRole('button', { name: '200 point sheet', exact: true }).click()
  const sheet = preview.locator('[data-node-id="overlay-surface"]')
  await expect(sheet).toHaveCSS('height', '226px')
  await expect(sheet).toHaveCSS('border-radius', '28px')
  await expect(preview.locator('[data-node-id="overlay-grabber"]')).toHaveCount(0)
  await sheet.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(sheet).toHaveCount(0)
  await preview.getByRole('button', { name: 'Lists', exact: true }).click()
  await expect(preview.getByText('Expanded content', { exact: true })).toBeVisible()
})


test('context-menu gestures preserve button actions and text fields submit', async ({ page }) => {
  await openCounter(page)
  await page.getByTestId('workspace-develop').click()
  // Code opens with the preview pointing at views; this test taps it as an app.
  await page.getByTestId('live-toggle').click()
  const editor = page.getByTestId('editor').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(`import SwiftUI
@main struct TestApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
  @State var count = 0
  @State var name = ""
  @State var submitted = "Nothing sent"
  var body: some View {
    VStack(spacing: 24) {
      Text("Count: \\(count)")
      Button("Tap or hold") { count += 1 }
        .contextMenu { Button("Add ten") { count += 10 } }
      TextField("Email", text: $name).textFieldStyle(.roundedBorder)
        .keyboardType(.emailAddress).submitLabel(.send)
        .onSubmit { submitted = name }
      Text(submitted)
    }.padding()
  }
}`)
  const preview = page.getByTestId('render-tree')
  const button = preview.getByRole('button', { name: 'Tap or hold', exact: true })
  await button.click()
  await expect(preview.getByText('Count: 1', { exact: true })).toBeVisible()
  await button.click({ button: 'right' })
  await preview.getByRole('button', { name: 'Add ten', exact: true }).click()
  await expect(preview.getByText('Count: 11', { exact: true })).toBeVisible()
  await button.click({ delay: 650 })
  await expect(preview.getByRole('button', { name: 'Add ten', exact: true })).toBeVisible()
  const backdrop = preview.getByRole('button', { name: 'Close menu', exact: true })
  const bounds = await backdrop.boundingBox()
  expect(bounds).not.toBeNull()
  // Screen corners are clipped by the bezel; click below the status bar, away from the menu.
  await page.mouse.click(bounds!.x + bounds!.width * 0.15, bounds!.y + bounds!.height * 0.2)
  await expect(backdrop).toHaveCount(0)
  await expect(preview.getByText('Count: 11', { exact: true })).toBeVisible()
  const field = preview.getByRole('textbox', { name: 'Email', exact: true })
  await expect(field).toHaveAttribute('inputmode', 'email')
  await expect(field).toHaveAttribute('enterkeyhint', 'send')
  await field.fill('taylor@example.com')
  await field.press('Enter')
  await expect(preview.getByText('taylor@example.com', { exact: true })).toBeVisible()
})
