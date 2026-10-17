import SwiftUI

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
