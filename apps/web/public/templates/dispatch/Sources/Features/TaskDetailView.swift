import SwiftUI

struct TaskDetailView: View {
    @EnvironmentObject private var workspace: Workspace
    let id: UUID
    var body: some View {
        Form {
            if let item = workspace.item(id) {
                Section {
                    Text(item.title).font(.title2).bold().padding(.vertical, 8)
                    LabeledContent("Project", value: item.project)
                    LabeledContent("Priority", value: item.priority)
                    LabeledContent("Status", value: item.done ? "Completed" : "To do")
                }
                Section("Notes") { Text(item.note.isEmpty ? "No notes yet." : item.note) }
                Section {
                    Button(item.done ? "Reopen task" : "Mark complete") { workspace.toggle(id) }
                }
            }
        }
        .navigationTitle("Task details")
        .navigationBarTitleDisplayMode(.inline)
    }
}
