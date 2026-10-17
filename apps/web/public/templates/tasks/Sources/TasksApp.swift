import SwiftUI

@main
struct TasksApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct Task: Identifiable {
    let id = UUID()
    var title: String
    var done: Bool
}

struct ContentView: View {
    @State private var tasks = [
        Task(title: "Draft the brief", done: true),
        Task(title: "Review the copy", done: true),
        Task(title: "Send for sign-off", done: false),
        Task(title: "Archive the folder", done: false)
    ]

    private var complete: Int {
        get { tasks.filter { $0.done }.count }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(tasks) { task in
                        Button {
                            toggle(task)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: task.done ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(task.done ? Color.green : Color.secondary)
                                Text(task.title)
                                    .strikethrough(task.done)
                                    .foregroundStyle(task.done ? Color.secondary : Color.primary)
                            }
                        }
                    }
                } header: {
                    Text("Today")
                } footer: {
                    Text("\(complete) of \(tasks.count) complete. Tap a task to change it.")
                }
            }
            .navigationTitle("Tasks")
            .toolbar {
                Button("Reset") {
                    for index in 0..<tasks.count {
                        tasks[index].done = false
                    }
                }
            }
        }
        .tint(.green)
    }

    private func toggle(_ task: Task) {
        for index in 0..<tasks.count {
            if tasks[index].id == task.id {
                tasks[index].done.toggle()
            }
        }
    }
}