import { describe, expect, it } from 'vitest'
import type { SourceFile } from '@studio/shared'
import { buildAuthoringModel } from './authoring'
import { planDesignEdit } from './design-edit'

/**
 * The screens When tapped offers a button: the ones a tap can open from where it is.
 * Never the view the app's window shows, which holds every screen, and never the
 * screen the button is on.
 */
const DISPATCH = `import SwiftUI

@main
struct DispatchApp: App {
    var body: some Scene { WindowGroup { DispatchRoot() } }
}

struct DispatchRoot: View {
    @StateObject private var workspace = Workspace()
    var body: some View {
        TabView {
            OverviewView().tabItem { Label("Overview", systemImage: "square.grid.2x2") }
            ActivityView().tabItem { Label("Activity", systemImage: "clock") }
        }
        .environmentObject(workspace)
    }
}

final class Workspace: ObservableObject {
    @Published var count = 0
}

struct OverviewView: View {
    @EnvironmentObject private var workspace: Workspace
    var body: some View {
        NavigationStack {
            List {
                Button("Open") {
                }
            }
        }
    }
}

struct ActivityView: View {
    @EnvironmentObject private var workspace: Workspace
    var body: some View {
        Text("Activity")
    }
}

struct TaskDetailView: View {
    let id: UUID
    var body: some View {
        Text("Task")
    }
}

struct PreferencesView: View {
    @EnvironmentObject private var workspace: Workspace
    @AppStorage("notifications") private var notifications = true
    var body: some View {
        Form {
            Toggle("Notifications", isOn: $notifications)
        }
    }
}

struct AboutView: View {
    var body: some View {
        Button("Close") {
        }
    }
}
`
const files = (text: string): SourceFile[] => [{ id: 'Sources/DispatchApp.swift', text }]
const model = (text: string) => buildAuthoringModel({ projectId: 'tap', revision: 1, files: files(text), deploymentTarget: '17.0' })
const button = (text: string, owner: string) => model(text).nodes.find(node => node.name === 'Button' && node.owner === owner)!

describe('the screens a tap can open', () => {
  it('leaves out the app root and the screen the button is on', () => {
    const destinations = button(DISPATCH, 'OverviewView').behavior?.destinations
    expect(destinations).not.toContain('DispatchRoot')
    expect(destinations).not.toContain('OverviewView')
  })

  it('offers a screen that reads what this one reads from its surroundings, and not one that needs a value', () => {
    expect(button(DISPATCH, 'OverviewView').behavior?.destinations).toEqual(['ActivityView', 'PreferencesView', 'AboutView'])
    // A screen that does not have the workspace around it cannot open one that needs it.
    expect(button(DISPATCH, 'AboutView').behavior?.destinations).toEqual([])
  })

  it('pushes a screen it offers, and refuses to push the app root onto itself', () => {
    const push = (destination: string) => {
      const node = button(DISPATCH, 'OverviewView')
      return planDesignEdit({ projectId: 'tap', baseRevision: 1, files: files(DISPATCH), deploymentTarget: '17.0', scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'guided-action', action: { type: 'navigate', destination }, replace: false } })
    }
    const pushed = push('PreferencesView')
    expect(pushed.ok && pushed.changes[0]?.after).toContain('NavigationLink("Open", destination: PreferencesView())')
    expect(push('DispatchRoot').ok).toBe(false)
  })
})

describe('the screens a link can be pointed at', () => {
  it('never offers the app root, which holds every screen', () => {
    const linked = DISPATCH.replace('Button("Open") {\n                }', 'NavigationLink("Open") { PreferencesView() }')
    const link = model(linked).nodes.find(node => node.name === 'NavigationLink' && node.owner === 'OverviewView')!
    const offered = link.navigation?.destinations.map(destination => destination.viewName)
    expect(offered).toContain('PreferencesView')
    expect(offered).not.toContain('DispatchRoot')
  })
})
