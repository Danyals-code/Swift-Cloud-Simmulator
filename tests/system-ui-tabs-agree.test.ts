import { describe, expect, it } from 'vitest'
import type { SourceFile } from '@studio/shared'
import { buildAuthoringModel } from '@studio/swift-sema'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { templateById } from '@studio/project-model/templates'

/**
 * The app's tabs, decided once (Wave 4c): only the TabView at the root of the app's first screen,
 * what its WindowGroup shows, looking through a Group and up to three of the project's own views
 * there, is the app's tabs in the page style; a page-style TabView anywhere else is a carousel,
 * drawn in place. App navigation
 * (`buildAuthoringModel`'s `navigation`) and the gallery (`compile` with `allPages`) say the same.
 */

const app = (body: string, more = '') => `import SwiftUI

@main
struct ProbeApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct RootView: View {
    var body: some View {
${body}
    }
}
${more}`

const PAGES = `TabView {
                    Color.red
                    Color.green
                    Color.blue
                }
                .tabViewStyle(.page)
                .frame(height: 200)`

/** The style App navigation shows. */
const style = (files: readonly SourceFile[]) => buildAuthoringModel({ projectId: 'agree', revision: 1, files: [...files] }).navigation?.style

/** The gallery's root pages, one per tab for an app of tabs, and one for an app of one screen. */
function rootPages(files: readonly SourceFile[]): string[] {
  resetPipelineState()
  const result = compile({ files: [...files], revision: 1, allPages: true, canvas: { width: 402, height: 874 }, colorScheme: 'light', safeArea: { top: 62, bottom: 34, leading: 0, trailing: 0 } })
  expect(result.diagnostics.filter(d => d.severity === 'error').map(d => d.message)).toEqual([])
  return result.pages?.filter(page => page.kind === 'root').map(page => page.name) ?? []
}

const one = (text: string): SourceFile[] => [{ id: 'App.swift', text }]

const APPS: readonly [string, SourceFile[], 'tabs' | 'stack'][] = [
  ['a carousel written in a screen', one(app(`        NavigationStack {
            VStack {
                Text("Top")
                ${PAGES}
                Text("Bottom")
            }
            .navigationTitle("Home")
        }`)), 'stack'],
  ['a carousel that is a view of its own, in a screen', one(app(`        NavigationStack {
            VStack {
                Text("Top")
                Carousel()
                Text("Bottom")
            }
            .navigationTitle("Home")
        }`, `
struct Carousel: View {
    var body: some View {
        ${PAGES}
    }
}
`)), 'stack'],
  ['a page-style TabView in a Group at the screen\'s root', one(app(`        Group {
            TabView {
                Color.red
                Color.green
            }
            .tabViewStyle(.page)
        }`)), 'tabs'],
  ['the Tabs template', templateById('tabs')!.files.map(file => ({ id: file.id, text: file.text })), 'tabs'],
  ['a page-style TabView that is the screen', one(app(`        TabView {
            Color.red
            Color.green
            Color.blue
        }
        .tabViewStyle(.page)`)), 'tabs'],
  ['a page-style TabView written in the WindowGroup', one(app('        Text("Unused")').replace('RootView()', `TabView {
                Color.red
                Color.green
            }
            .tabViewStyle(.page(indexDisplayMode: .always))`)), 'tabs'],
  ['a page-style TabView of a view the screen\'s root calls, in a Group', one(app(`        Group {
            Pages()
        }`, `
struct Pages: View {
    var body: some View {
        TabView {
            Color.red
            Color.green
        }
        .tabViewStyle(.page)
    }
}
`)), 'tabs'],
  ['a page-style TabView three of the project\'s views in', one(app('        First()', `
struct First: View {
    var body: some View {
        Second()
    }
}

struct Second: View {
    var body: some View {
        TabView {
            Color.red
            Color.green
        }
        .tabViewStyle(.page)
    }
}
`)), 'tabs'],
  ['a page-style TabView four of the project\'s views in, past where the root is looked for', one(app('        First()', `
struct First: View {
    var body: some View {
        Second()
    }
}

struct Second: View {
    var body: some View {
        Third()
    }
}

struct Third: View {
    var body: some View {
        TabView {
            Color.red
            Color.green
        }
        .tabViewStyle(.page)
    }
}
`)), 'stack'],
  ['a carousel inside a tab', one(app(`        TabView {
            VStack {
                Text("Featured")
                ${PAGES}
            }
            .tabItem { Label("Home", systemImage: "house") }
            Text("Settings")
                .tabItem { Label("Settings", systemImage: "gear") }
        }`)), 'tabs'],
  ['a carousel in the older spelling, in a screen', one(app(`        VStack {
            Text("Top")
            TabView {
                Color.red
                Color.green
            }
            .tabViewStyle(PageTabViewStyle())
            .frame(height: 200)
        }`)), 'stack'],
  ['a TabView of tabs inside a screen', one(app(`        VStack {
            TabView {
                Text("Home").tabItem { Label("Home", systemImage: "house") }
                Text("Settings").tabItem { Label("Settings", systemImage: "gear") }
            }
        }`)), 'tabs'],
]

describe('the app’s tabs, in App navigation and in the gallery', () => {
  for (const [name, files, expected] of APPS) {
    it(`agree for ${name}: ${expected}`, () => {
      const pages = rootPages(files)
      expect(style(files)).toBe(expected)
      // A gallery of tabs has a root page for each; an app of one screen has one.
      expect(pages.length > 1 ? 'tabs' : 'stack', pages.join(', ')).toBe(expected)
    })
  }
})
