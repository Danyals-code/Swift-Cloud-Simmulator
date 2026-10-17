import SwiftUI

/// The second level of navigation, and the longest scroll in the project.
struct TrailDetailView: View {
    var trail: Trail

    /// Handed in: a pushed destination is built outside the injection's scope.
    @ObservedObject var store: TrailStore

    @State private var showingNotes = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Hero(trail: trail)

                HStack(spacing: 0) {
                    Stat(label: "Distance", value: trail.distance)
                    Divider()
                    Stat(label: "Ascent", value: trail.climb)
                    Divider()
                    Stat(label: "Grade", value: trail.difficulty.rawValue)
                }
                .card()
                .padding(.horizontal, 16)

                VStack(alignment: .leading, spacing: 8) {
                    Text("About this walk")
                        .font(.headline)
                        .foregroundStyle(Color.primary)
                    Text(trail.summary)
                        .font(.body)
                        .foregroundStyle(Color.secondary)
                }
                .card()
                .padding(.horizontal, 16)

                VStack(alignment: .leading, spacing: 10) {
                    Text("Getting there")
                        .font(.headline)
                        .foregroundStyle(Color.primary)

                    ForEach(directions) { step in
                        HStack(alignment: .top, spacing: 10) {
                            Text("\(step.number)")
                                .font(.caption)
                                .foregroundStyle(Color.secondary)
                                .frame(width: 18, alignment: .leading)
                            Text(step.text)
                                .font(.subheadline)
                                .foregroundStyle(Color.primary)
                        }
                    }
                }
                .card()
                .padding(.horizontal, 16)

                HStack(spacing: 12) {
                    Button(store.isSaved(trail) ? "Saved" : "Save") {
                        store.toggleSaved(trail)
                    }
                    .buttonStyle(PressableButtonStyle())

                    Button("Notes") {
                        showingNotes = true
                    }
                    .buttonStyle(.bordered)

                    Spacer()
                }
                .padding(.horizontal, 16)
            }
            .padding(.vertical, 16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(trail.name)
        .sheet(isPresented: $showingNotes) {
            NotesSheet(trail: trail)
        }
    }

    var directions: [Step] {
        return [
            Step(number: 1, text: "Follow the forest road to the upper car park."),
            Step(number: 2, text: "Cross the creek at the second bridge, then turn uphill."),
            Step(number: 3, text: "Stay left where the track forks below the pass.")
        ]
    }
}

/// The number is its own field rather than its identity: id is what ForEach follows
/// and has no business being read by a person.
struct Step: Identifiable {
    let id = UUID()
    let number: Int
    let text: String
}

/// The banner at the top: a gradient, an oversized symbol and the region.
struct Hero: View {
    var trail: Trail

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: trail.symbol)
                .font(.largeTitle)
                .foregroundStyle(Color.white)

            Spacer()

            Text(trail.region)
                .font(.subheadline)
                .foregroundStyle(Color.white.opacity(0.9))

            HStack(spacing: 8) {
                Text(trail.name)
                    .font(.title)
                    .foregroundStyle(Color.white)
                Spacer()
                DifficultyBadge(difficulty: trail.difficulty)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: 190, alignment: .leading)
        .background(
            LinearGradient(
                colors: [trail.difficulty.tint, Color.indigo],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .clipShape(.rect(cornerRadius: 18))
        .padding(.horizontal, 16)
    }
}

struct Stat: View {
    var label = ""
    var value = ""

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.headline)
                .foregroundStyle(Color.primary)
            Text(label)
                .font(.caption)
                .foregroundStyle(Color.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

struct NotesSheet: View {
    var trail: Trail

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(trail.name)
                .font(.title2)
                .foregroundStyle(Color.primary)
            Text("Notes stay on the device and are not synced anywhere.")
                .font(.subheadline)
                .foregroundStyle(Color.secondary)
            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(.systemGroupedBackground))
    }
}
