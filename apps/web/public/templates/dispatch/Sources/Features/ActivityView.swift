import SwiftUI

struct ActivityView: View {
    @EnvironmentObject private var workspace: Workspace
    var body: some View {
        NavigationStack {
            List {
                Section("Recent updates") {
                    ForEach(workspace.activity) { entry in
                        Label(entry.title, systemImage: "clock").padding(.vertical, 6)
                    }
                }
            }.navigationTitle("Activity")
        }
    }
}

struct PreferencesView: View {
    @EnvironmentObject private var workspace: Workspace
    @AppStorage("dispatch.notifications") private var notifications = true
    var body: some View {
        Form {
            Section("Project lists") { Toggle("Show completed tasks", isOn: $workspace.showCompleted) }
            Section("Preferences") { Toggle("Daily reminder preference", isOn: $notifications) }
            Section { Text("This workspace uses local example data. Reminder delivery requires a notification service.").font(.footnote).foregroundStyle(.secondary) }
        }.navigationTitle("Preferences")
    }
}
