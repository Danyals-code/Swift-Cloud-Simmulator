import SwiftUI

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
