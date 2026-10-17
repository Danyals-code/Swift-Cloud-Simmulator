import SwiftUI

/// The second tab: a grouped list, and an empty state that is not a blank screen.
struct SavedView: View {
    @EnvironmentObject var store: TrailStore

    var body: some View {
        NavigationStack {
            List {
                Section("Saved walks") {
                    ForEach(store.saved) { trail in
                        NavigationLink(value: trail) {
                            SavedRow(trail: trail)
                        }
                    }
                }

                if store.saved.isEmpty {
                    Text("Nothing saved yet. Open a trail and press Save.")
                        .font(.subheadline)
                        .foregroundStyle(Color.secondary)
                }
            }
            .navigationDestination(for: Trail.self) { trail in
                TrailDetailView(trail: trail, store: store)
            }
            .navigationTitle("Saved")
        }
    }
}

struct SavedRow: View {
    var trail: Trail

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: trail.symbol)
                .font(.title3)
                .foregroundStyle(trail.difficulty.tint)

            VStack(alignment: .leading, spacing: 2) {
                Text(trail.name)
                    .font(.body)
                    .foregroundStyle(Color.primary)
                Text(trail.region)
                    .font(.caption)
                    .foregroundStyle(Color.secondary)
            }

            Spacer()

            Text(trail.distance)
                .font(.caption)
                .foregroundStyle(Color.secondary)
        }
    }
}
