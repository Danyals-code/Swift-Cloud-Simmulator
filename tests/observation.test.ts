import { beforeEach, describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult, RenderNode, RenderTree } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * Observation - `ObservableObject`, `@StateObject`, `@EnvironmentObject`, and the
 * `@Environment` values.
 *
 * The reason this needed classes: an observable object's whole job is to be *shared*.
 * A struct copied into three views gives three independent counters, and every test
 * here would pass while the feature was useless.
 */

const device = DEVICES['iphone-15']
let revision = 1

function request(source: string, colorScheme: 'light' | 'dark' = 'light'): CompileRequest {
  return {
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme,
    revision: revision++,
  }
}

function run(source: string, colorScheme: 'light' | 'dark' = 'light'): CompileResult {
  resetPipelineState()
  const result = compile(request(source, colorScheme))
  expect(result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([])
  return result
}

function texts(tree: RenderTree | null): string[] {
  return (tree?.nodes ?? []).flatMap((n) => n.text?.runs.map((r) => r.text) ?? [])
}

function control(tree: RenderTree | null, label: string): RenderNode {
  const found = (tree?.nodes ?? []).find((n) => n.hitTarget && n.a11y?.label === label)
  expect(found, `no control labelled "${label}"`).toBeDefined()
  return found!
}

function tap(tree: RenderTree | null, label: string): CompileResult {
  const target = control(tree, label)
  applyEvent({ kind: 'tap', handlerId: target.hitTarget!.handlerId, location: { x: 0, y: 0 } })
  return rerender(revision++)
}

beforeEach(() => {
  resetPipelineState()
})

describe('ObservableObject', () => {
  const SOURCE = `import SwiftUI

class Store: ObservableObject {
    @Published var count = 0

    func bump() {
        count += 1
    }
}

@main
struct ObserveApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @StateObject private var store = Store()

    var body: some View {
        VStack {
            Header(store: store)
            Text("root \\(store.count)")
            Button("Bump") {
                store.bump()
            }
        }
    }
}

struct Header: View {
    @ObservedObject var store: Store

    var body: some View {
        Text("header \\(store.count)")
    }
}
`

  it('shares one object between a parent and its child', () => {
    // The whole point: both views read the same instance, so both change together.
    let result = run(SOURCE)
    expect(texts(result.renderTree)).toContain('root 0')
    expect(texts(result.renderTree)).toContain('header 0')

    result = tap(result.renderTree, 'Bump')
    expect(texts(result.renderTree)).toContain('root 1')
    expect(texts(result.renderTree)).toContain('header 1')
  })

  it('keeps the object across re-renders', () => {
    // `@StateObject` is created once per view identity. If it were rebuilt on every
    // pass the count would reset to zero and the previous test would still pass.
    let result = run(SOURCE)
    result = tap(result.renderTree, 'Bump')
    result = tap(result.renderTree, 'Bump')
    expect(texts(result.renderTree)).toContain('root 2')

    result = rerender(revision++)
    expect(texts(result.renderTree)).toContain('root 2')
  })
})

describe('@EnvironmentObject', () => {
  it('reaches a view that was given the object by an ancestor', () => {
    const result = run(`import SwiftUI

class Session: ObservableObject {
    @Published var user = "Ada"
}

@main
struct EnvApp: App {
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(Session())
        }
    }
}

struct RootView: View {
    @EnvironmentObject var session: Session

    var body: some View {
        Text("signed in as \\(session.user)")
    }
}
`)
    expect(texts(result.renderTree)).toContain('signed in as Ada')
  })
})

describe('@Environment values', () => {
  it('reports the colour scheme the preview is set to', () => {
    const source = `import SwiftUI

@main
struct SchemeApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @Environment(\\.colorScheme) private var scheme

    var body: some View {
        Text(scheme == .dark ? "dark mode" : "light mode")
    }
}
`
    expect(texts(run(source, 'light').renderTree)).toContain('light mode')
    expect(texts(run(source, 'dark').renderTree)).toContain('dark mode')
  })

  it('supplies a dismiss action that closes the sheet it is read in', () => {
    const source = `import SwiftUI

@main
struct DismissApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @State private var showing = false

    var body: some View {
        VStack {
            Button("Open") {
                showing = true
            }
        }
        .sheet(isPresented: $showing) {
            SheetView()
        }
    }
}

struct SheetView: View {
    @Environment(\\.dismiss) private var dismiss

    var body: some View {
        VStack {
            Text("the sheet")
            Button("Close") {
                dismiss()
            }
        }
    }
}
`
    let result = run(source)
    expect(texts(result.renderTree)).not.toContain('the sheet')

    result = tap(result.renderTree, 'Open')
    expect(texts(result.renderTree)).toContain('the sheet')

    result = tap(result.renderTree, 'Close')
    expect(texts(result.renderTree)).not.toContain('the sheet')
  })
})

describe('enums driving a view', () => {
  it('switches content on the selected case', () => {
    const source = `import SwiftUI

enum Filter: String {
    case all, active, done

    var title: String {
        switch self {
        case .all:
            return "Everything"
        case .active:
            return "In progress"
        case .done:
            return "Finished"
        }
    }
}

@main
struct FilterApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @State private var filter: Filter = .all

    var body: some View {
        VStack {
            Text(filter.title)
            Button("Next") {
                switch filter {
                case .all:
                    filter = .active
                case .active:
                    filter = .done
                case .done:
                    filter = .all
                }
            }
        }
    }
}
`
    let result = run(source)
    expect(texts(result.renderTree)).toContain('Everything')

    result = tap(result.renderTree, 'Next')
    expect(texts(result.renderTree)).toContain('In progress')

    result = tap(result.renderTree, 'Next')
    expect(texts(result.renderTree)).toContain('Finished')

    result = tap(result.renderTree, 'Next')
    expect(texts(result.renderTree)).toContain('Everything')
  })

  it('selects a tab through an enum-tagged TabView', () => {
    const source = `import SwiftUI

enum Tab: String {
    case home, profile
}

@main
struct TabApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @State private var tab: Tab = .home

    var body: some View {
        TabView(selection: $tab) {
            Text("the home screen")
                .tabItem {
                    Text("Home")
                }
                .tag(Tab.home)

            Text("the profile screen")
                .tabItem {
                    Text("Profile")
                }
                .tag(Tab.profile)
        }
    }
}
`
    let result = run(source)
    expect(texts(result.renderTree)).toContain('the home screen')

    result = tap(result.renderTree, 'Profile')
    expect(texts(result.renderTree)).toContain('the profile screen')
    expect(texts(result.renderTree)).not.toContain('the home screen')
  })
})

describe('guard and optional binding in a view body', () => {
  it('renders the unwrapped value', () => {
    const result = run(`import SwiftUI

@main
struct OptionalApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @State private var selected: String? = "Kyoto"

    var body: some View {
        VStack {
            if let selected {
                Text("showing \\(selected)")
            } else {
                Text("nothing selected")
            }
        }
    }
}
`)
    expect(texts(result.renderTree)).toContain('showing Kyoto')
  })
})
