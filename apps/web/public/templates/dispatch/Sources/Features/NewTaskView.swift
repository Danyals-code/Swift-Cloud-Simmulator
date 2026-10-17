import SwiftUI

struct NewTaskView: View {
    @EnvironmentObject private var workspace: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var note = ""
    @State private var project = "Website"
    @State private var priority = "Normal"
    var body: some View {
        NavigationStack {
            Form {
                Section("Task") {
                    TextField("Task title", text: $title)
                    TextField("Notes", text: $note)
                }
                Section("Organize") {
                    Picker("Project", selection: $project) {
                        ForEach(workspace.projects, id: \.self) { name in Text(name).tag(name) }
                    }
                    Picker("Priority", selection: $priority) {
                        Text("Normal").tag("Normal")
                        Text("High").tag("High")
                    }
                }
            }
            .navigationTitle("New task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        workspace.add(title: title, project: project, note: note, priority: priority)
                        dismiss()
                    }.disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
