import SwiftUI

struct ProjectsView: View {
    @EnvironmentObject private var workspace: Workspace
    @State private var query = ""
    var body: some View {
        NavigationStack {
            List {
                ForEach(workspace.projects, id: \.self) { project in
                    Section(project) {
                        ForEach(workspace.tasks.filter { item in
                            item.project == project && (workspace.showCompleted || !item.done)
                                && (query.isEmpty || item.title.lowercased().contains(query.lowercased()))
                        }) { item in
                            NavigationLink { TaskDetailView(id: item.id) } label: { TaskRow(item: item) }
                        }
                    }
                }
                if !query.isEmpty && workspace.tasks.filter({ $0.title.lowercased().contains(query.lowercased()) }).isEmpty {
                    Text("No matching tasks. Try another word.").foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Projects")
            .searchable(text: $query, prompt: "Search tasks")
        }
    }
}
