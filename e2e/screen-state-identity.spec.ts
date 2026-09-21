import { expect, test } from '@playwright/test'

const source = `import SwiftUI
@main struct DemoApp: App {
  var body: some Scene { WindowGroup { TabView {
    FirstScreen().tabItem { Label("First", systemImage: "house") }
    SecondScreen().tabItem { Label("Second", systemImage: "star") }
  } } }
}
struct FirstScreen: View {
  @State var empty = false
  var body: some View { Text(empty ? "First empty" : "First full") }
}
struct SecondScreen: View {
  @State var empty = false
  var body: some View { Text(empty ? "Second empty" : "Second full") }
}`

test('same-named screen states are saved, selected and deleted independently', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()
  await page.getByTestId('workspace-develop').click()
  await page.getByTestId('editor').locator('.cm-content').fill(source)
  await page.getByTestId('workspace-design').click()
  const states = page.getByRole('region', { name: 'States', exact: true })
  const empty = states.getByRole('button', { name: /^Empty\s*empty: true$/ })
  const navigator = page.getByRole('navigation', { name: 'Layers', exact: true })

  for (const screen of ['First', 'Second']) {
    await navigator.getByRole('button', { name: screen, exact: true }).click()
    await states.getByRole('button', { name: 'Add state', exact: true }).click()
    await states.getByRole('combobox', { name: 'State input', exact: true }).selectOption({ label: 'empty' })
    await states.getByRole('combobox', { name: 'State value', exact: true }).selectOption('true')
    await states.getByRole('button', { name: 'Save state', exact: true }).click()
    await expect(empty).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(`${screen} empty`, { exact: true })).toBeVisible()
  }
  await expect(page.getByText('First full', { exact: true })).toBeVisible()
  await navigator.getByRole('button', { name: 'First', exact: true }).click()
  await expect(empty).toHaveAttribute('aria-pressed', 'false')
  await empty.click()
  await expect(page.getByText('First empty', { exact: true })).toBeVisible()
  await expect(page.getByText('Second full', { exact: true })).toBeVisible()

  await navigator.getByRole('button', { name: 'Second', exact: true }).click()
  await states.getByRole('button', { name: 'Delete state Empty', exact: true }).click()
  await expect(empty).toHaveCount(0)
  await navigator.getByRole('button', { name: 'First', exact: true }).click()
  await expect(empty).toHaveCount(1)
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible()

  await page.reload()
  await page.getByTestId('gallery-dismiss').click()
  await navigator.getByRole('button', { name: 'First', exact: true }).click()
  await empty.click()
  await expect(page.getByText('First empty', { exact: true })).toBeVisible()
  await navigator.getByRole('button', { name: 'Second', exact: true }).click()
  await expect(empty).toHaveCount(0)
})
