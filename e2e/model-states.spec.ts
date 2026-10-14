import { expect, test } from '@playwright/test'
import { openInDesign } from './designer-helpers'

/**
 * View-model states (Wave 3b): a screen that draws from an @Observable model, as the AI
 * writes it, offers its loading, error and empty branches as States by name, and the
 * canvas draws each one though the model loads as the screen appears. The Swift never
 * changes.
 */
const SOURCE = `import SwiftUI

struct Article: Identifiable {
    let id: Int
    var title: String
}

@Observable
final class FeedModel {
    var articles: [Article] = []
    var isLoading = false
    var errorMessage: String?

    func load() async {
        isLoading = true
        errorMessage = nil
        try? await Task.sleep(for: .seconds(1))
        articles = [Article(id: 1, title: "Hello"), Article(id: 2, title: "World")]
        isLoading = false
    }

    func canRefresh() -> Bool { true }
}

@main
struct FeedApp: App {
    @State private var model = FeedModel()

    var body: some Scene {
        WindowGroup {
            FeedScreen()
                .environment(model)
        }
    }
}

struct FeedScreen: View {
    @Environment(FeedModel.self) private var model

    var body: some View {
        NavigationStack {
            VStack {
                if model.canRefresh() {
                    Button("Refresh") { }
                }
                Group {
                    if model.isLoading {
                        ProgressView("Loading articles")
                    } else if let message = model.errorMessage {
                        VStack {
                            Text("Couldn't load")
                            Text(message)
                        }
                    } else if model.articles.isEmpty {
                        ContentUnavailableView("No articles", systemImage: "newspaper")
                    } else {
                        List(model.articles) { article in
                            Text(article.title)
                        }
                    }
                }
            }
            .navigationTitle("Feed")
            .task { await model.load() }
        }
    }
}`

test('a model’s loading, error and empty states are offered by name and drawn on the canvas', async ({ page }) => {
  await openInDesign(page, SOURCE, 'Hello')
  await page.getByTestId('level-screen').click()
  const states = page.getByTestId('screen-states'), canvas = page.getByTestId('render-tree')
  const suggested = states.getByTestId('state-suggestions')
  await expect(suggested.getByRole('button')).toHaveCount(4)
  for (const [index, name] of ['Loading', 'Error', 'Empty', 'Has items'].entries()) await expect(suggested.getByRole('button').nth(index)).toHaveAccessibleName(`Add ${name} state`)
  // What the preview can't set is said, not offered.
  await expect(states.getByTestId('states-not-offered')).toContainText('model.canRefresh()')

  await suggested.getByRole('button', { name: 'Add Loading state', exact: true }).click()
  await expect(states.getByRole('button', { name: /^Loading/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas.getByText('Loading articles', { exact: true })).toBeVisible()
  await expect(canvas.getByText('Hello', { exact: true })).toHaveCount(0)

  await suggested.getByRole('button', { name: 'Add Empty state', exact: true }).click()
  await expect(states.getByRole('button', { name: /^Empty/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas.getByText('No articles', { exact: true })).toBeVisible()

  await suggested.getByRole('button', { name: 'Add Error state', exact: true }).click()
  await expect(canvas.getByText('Something went wrong.', { exact: true })).toBeVisible()
  await expect(canvas.getByText('Couldn\'t load', { exact: true })).toBeVisible()

  // Added states are no longer offered, and the app's own content is a click away.
  await expect(suggested.getByRole('button')).toHaveCount(1)
  await states.getByRole('button', { name: /^Default/ }).click()
  await expect(canvas.getByText('Hello', { exact: true })).toBeVisible()
  await states.getByRole('button', { name: /^Loading/ }).click()
  await expect(canvas.getByText('Loading articles', { exact: true })).toBeVisible()

  // Only the preview changed.
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('editor').locator('.cm-content')).toHaveText(SOURCE, { useInnerText: true })
})

/** A screen with a value of its own and a list on a model that loads as it appears, each with a button that changes it. */
const TAPPED = `import SwiftUI

@Observable
final class Basket {
    var items: [String] = ["Milk", "Eggs", "Bread"]

    func load() async {
        items = ["Tea"]
    }
}

@main
struct BasketApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
    @State private var basket = Basket()
    @State private var isSignedIn = false

    var body: some View {
        VStack {
            if isSignedIn {
                Text("Welcome back")
            } else {
                Button("Sign in") { isSignedIn = true }
            }
            if basket.items.isEmpty {
                Text("Empty basket")
            } else {
                ForEach(basket.items, id: \\.self) { item in
                    Text(item)
                }
            }
            Button("Remove first") { basket.items.removeFirst() }
        }
        .task { await basket.load() }
    }
}`

test('a state holds what it shows until the first tap in the live preview, which acts on what it drew', async ({ page }) => {
  await openInDesign(page, TAPPED, 'Tea')
  await page.getByTestId('level-screen').click()
  const states = page.getByTestId('screen-states'), canvas = page.getByTestId('render-tree')
  const suggested = states.getByTestId('state-suggestions')
  await suggested.getByRole('button', { name: 'Add Not signed in state', exact: true }).click()
  await suggested.getByRole('button', { name: 'Add Has items state', exact: true }).click()
  await expect(states.getByRole('button', { name: /^Has items/ })).toHaveAttribute('aria-pressed', 'true')
  // Held against the load that runs as the screen appears.
  for (const item of ['Milk', 'Eggs', 'Bread']) await expect(canvas.getByText(item, { exact: true })).toBeVisible()
  await expect(canvas.getByText('Tea', { exact: true })).toHaveCount(0)

  // The first tap ends the hold and acts on the rows the state drew.
  await page.getByTestId('live-toggle').click()
  await canvas.getByRole('button', { name: 'Remove first', exact: true }).click()
  await expect(canvas.getByText('Milk', { exact: true })).toHaveCount(0)
  await expect(canvas.getByText('Eggs', { exact: true })).toBeVisible()
  await expect(canvas.getByText('Bread', { exact: true })).toBeVisible()

  // A screen's own value: the state shows it signed out, and its own button still signs in.
  await states.getByRole('button', { name: /^Not signed in/ }).click()
  await expect(canvas.getByText('Welcome back', { exact: true })).toHaveCount(0)
  await canvas.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(canvas.getByText('Welcome back', { exact: true })).toBeVisible()

  // Only the preview changed.
  await page.getByTestId('workspace-develop').click()
  await expect(page.getByTestId('editor').locator('.cm-content')).toHaveText(TAPPED, { useInnerText: true })
})
