import SwiftUI

struct OverviewView: View {
    @EnvironmentObject private var workspace: Workspace
    @State private var adding = false
    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("A little focus goes a long way.").font(.title2).bold()
                        Text("Your team's work, one clear next step at a time.").foregroundStyle(.secondary)
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("\(workspace.remaining)").font(.largeTitle).bold()
                                Text("To do").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            VStack(alignment: .leading, spacing: 4) {
                                Text("\(workspace.completed)").font(.largeTitle).bold()
                                Text("Completed").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                        ProgressView(value: Double(workspace.completed), total: Double(workspace.tasks.count))
                    }.padding(.vertical, 12)
                }
                Section("Next up") {
                    ForEach(workspace.urgent) { item in
                        NavigationLink { TaskDetailView(id: item.id) } label: { TaskRow(item: item) }
                    }
                    if workspace.urgent.isEmpty { Text("All high-priority work is complete.").foregroundStyle(.secondary) }
                }
                Section("Workspace") {
                    NavigationLink("Preferences") { PreferencesView() }
                }
            }
            .navigationTitle("Overview")
            .toolbar { Button("New task") { adding = true } }
            .sheet(isPresented: $adding) { NewTaskView() }
        }
    }
}
