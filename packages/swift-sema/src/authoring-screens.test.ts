import { describe, expect, it } from 'vitest'
import type { SourceFile } from '@studio/shared'
import { buildAuthoringModel } from './authoring'
import { planDesignEdit } from './design-edit'

/**
 * Removing a screen from its settings. What cannot go from there says where it goes
 * instead, in a designer's words.
 */
const TABS = `import SwiftUI

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
            NavigationLink("Preferences") { PreferencesView() }
        }
    }
}

struct ActivityView: View {
    @EnvironmentObject private var workspace: Workspace
    var body: some View {
        Text("Activity")
    }
}

struct PreferencesView: View {
    @EnvironmentObject private var workspace: Workspace
    var body: some View {
        Text("Preferences")
    }
}

struct ArchiveView: View {
    @EnvironmentObject private var workspace: Workspace
    var body: some View {
        Text("Archive")
    }
}
`
const STACK = `import SwiftUI

@main
struct NotesApp: App {
    var body: some Scene { WindowGroup { HomeScreen() } }
}

struct HomeScreen: View {
    var body: some View {
        Text("Home")
    }
}
`
const files = (text: string): SourceFile[] => [{ id: 'Sources/App.swift', text }]
function remove(text: string, view: string) {
  const node = buildAuthoringModel({ projectId: 'screens', revision: 1, files: files(text), deploymentTarget: '17.0' }).nodes.find(n => n.kind === 'definition' && n.name === view)!
  return planDesignEdit({ projectId: 'screens', baseRevision: 1, files: files(text), deploymentTarget: '17.0', scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'screen-remove' } })
}
const refusal = (text: string, view: string) => { const plan = remove(text, view); return plan.ok ? undefined : plan.reason }

describe('removing a screen', () => {
  it('sends a tab to App › Navigation', () => {
    expect(refusal(TABS, 'ActivityView')).toBe('Tabs are removed in App › Navigation.')
  })

  it('keeps the screen the app starts on', () => {
    expect(refusal(STACK, 'HomeScreen')).toBe('The app starts on this screen, so it cannot be removed.')
    expect(refusal(TABS, 'DispatchRoot')).toBe('The app starts on this screen, so it cannot be removed.')
  })

  it('asks for what opens a screen to go first, whatever the screen reads', () => {
    expect(refusal(TABS, 'PreferencesView')).toBe('This screen is used by the app or another screen. Remove what opens it first.')
  })

  it('removes a screen nothing opens, even one that reads from its surroundings', () => {
    const plan = remove(TABS, 'ArchiveView')
    const after = plan.ok ? plan.changes[0]?.after : plan.reason
    expect(after).toContain('struct PreferencesView: View {')
    expect(after).not.toContain('ArchiveView')
  })

  it('says in plain words why a screen that needs values is copied in Code', () => {
    const node = buildAuthoringModel({ projectId: 'screens', revision: 1, files: files(TABS), deploymentTarget: '17.0' }).nodes.find(n => n.kind === 'definition' && n.name === 'ActivityView')!
    const plan = planDesignEdit({ projectId: 'screens', baseRevision: 1, files: files(TABS), deploymentTarget: '17.0', scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'screen-duplicate', name: 'ActivityCopyView' } })
    expect(plan.ok ? undefined : plan.reason).toBe('This screen needs values from where it is opened. Duplicate it in Code.')
  })
})
