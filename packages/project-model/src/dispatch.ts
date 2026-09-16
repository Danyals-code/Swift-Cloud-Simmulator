import type { SourceFile } from '@studio/shared'

export const DISPATCH_FILES: readonly SourceFile[] = [
  { id: 'Sources/DispatchApp.swift', text: String.raw`import SwiftUI

@main
struct DispatchApp: App {
    var body: some Scene { WindowGroup { DispatchRoot() } }
}

struct DispatchRoot: View {
    @StateObject private var workspace = Workspace()
    var body: some View {
        TabView {
            OverviewView().tabItem { Label("Overview", systemImage: "square.grid.2x2") }
            ProjectsView().tabItem { Label("Projects", systemImage: "folder") }
            ActivityView().tabItem { Label("Activity", systemImage: "clock") }
        }
        .environmentObject(workspace)
        .tint(.indigo)
    }
}
` },
  { id: 'Sources/Models/Workspace.swift', text: String.raw`import SwiftUI

struct WorkItem: Identifiable, Hashable {
    let id = UUID()
    var title: String
    var project: String
    var note: String
    var priority: String
    var done = false
}

struct ActivityEntry: Identifiable {
    let id = UUID()
    let title: String
}

final class Workspace: ObservableObject {
    @Published var tasks = [
        WorkItem(title: "Sketch the welcome flow", project: "Website", note: "Keep the first visit focused on one useful action.", priority: "High"),
        WorkItem(title: "Review the type scale", project: "Website", note: "Check headings, captions, and longer paragraphs on a phone.", priority: "Normal"),
        WorkItem(title: "Prepare the launch checklist", project: "Release", note: "Include accessibility, documentation, and a final export check.", priority: "High"),
        WorkItem(title: "Write the getting started guide", project: "Release", note: "Walk through a complete project from creation to export.", priority: "Normal"),
        WorkItem(title: "Organize the component library", project: "Design system", note: "Group controls by what they do and document their states.", priority: "Normal", done: true)
    ]
    @Published var activity = [ActivityEntry(title: "Workspace created"), ActivityEntry(title: "Component library completed")]
    @Published var showCompleted = true
    let projects = ["Website", "Release", "Design system"]

    var completed: Int { tasks.filter { $0.done }.count }
    var remaining: Int { tasks.filter { !$0.done }.count }
    var urgent: [WorkItem] { tasks.filter { !$0.done && $0.priority == "High" } }

    func item(_ id: UUID) -> WorkItem? { tasks.first { $0.id == id } }
    func toggle(_ id: UUID) {
        if let index = tasks.firstIndex(where: { $0.id == id }) {
            tasks[index].done.toggle()
            activity.insert(ActivityEntry(title: tasks[index].done ? "Completed: " + tasks[index].title : "Reopened: " + tasks[index].title), at: 0)
        }
    }
    func add(title: String, project: String, note: String, priority: String) {
        tasks.append(WorkItem(title: title, project: project, note: note, priority: priority))
        activity.insert(ActivityEntry(title: "Added: " + title), at: 0)
    }
}
` },
  { id: 'Sources/Components/TaskRow.swift', text: String.raw`import SwiftUI

struct TaskRow: View {
    let item: WorkItem
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                .font(.title3).foregroundStyle(item.done ? Color.green : Color.secondary)
            VStack(alignment: .leading, spacing: 5) {
                Text(item.title).font(.headline)
                Text(item.project).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if item.priority == "High" && !item.done {
                Image(systemName: "flag.fill").foregroundStyle(.orange).font(.caption)
            }
        }
        .padding(.vertical, 5)
    }
}
` },
  { id: 'Sources/Features/OverviewView.swift', text: String.raw`import SwiftUI

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
` },
  { id: 'Sources/Features/ProjectsView.swift', text: String.raw`import SwiftUI

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
` },
  { id: 'Sources/Features/TaskDetailView.swift', text: String.raw`import SwiftUI

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
` },
  { id: 'Sources/Features/NewTaskView.swift', text: String.raw`import SwiftUI

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
` },
  { id: 'Sources/Features/ActivityView.swift', text: String.raw`import SwiftUI

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
` },
]
