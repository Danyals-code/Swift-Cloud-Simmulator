import type { SourceFile } from '@studio/shared'

/**
 * Trailhead - the multi-screen template.
 *
 * Every other template in the gallery is one file showing one idea, which was all
 * the `Template` type could hold. They are useful and they are not what anybody
 * actually builds: a real SwiftUI app is several screens, a model, a store shared
 * between them, and a components folder - and none of that fits in a single file
 * without becoming an argument for not splitting files.
 *
 * So this one is eight files across four groups, and it is deliberately the project
 * that exercises the navigator's new folder support at the same time as showing
 * what the preview can draw: a tab bar, two levels of navigation, vertical and
 * horizontal scrolling, a grid, a grouped form, a sheet, a shared
 * `ObservableObject`, a custom `ViewModifier` and a custom `ButtonStyle`.
 *
 * It has to clear the same gate as every other template (Phase 4 gate 2, in
 * `tests/templates.test.ts`): zero diagnostics of any severity, zero unsupported
 * placeholders, a palette that genuinely changes in dark mode, and the whole
 * pipeline under 120 ms. Anything the preview cannot draw is not in here - which is
 * why there is no `Chart`, no `Map` and no `.refreshable`.
 */

const APP = `import SwiftUI

@main
struct TrailheadApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

/// The one place the store is created; every screen below reads it from the environment.
struct RootView: View {
    @StateObject private var store = TrailStore()

    var body: some View {
        MainTabs()
            .environmentObject(store)
    }
}

/// Split out so the injection above has somewhere to land: it needs an unbuilt body.
struct MainTabs: View {
    var body: some View {
        TabView {
            DiscoverView()
                .tabItem {
                    Label("Discover", systemImage: "map")
                }

            SavedView()
                .tabItem {
                    Label("Saved", systemImage: "bookmark")
                }

            ProfileView()
                .tabItem {
                    Label("Profile", systemImage: "person.circle")
                }
        }
    }
}
`

const TRAIL = `import SwiftUI

/// A raw-valued enum whose colour and symbol are decided here, not at each call site.
enum Difficulty: String {
    case easy = "Easy"
    case moderate = "Moderate"
    case hard = "Hard"

    var tint: Color {
        switch self {
        case .easy:
            return Color.green
        case .moderate:
            return Color.orange
        case .hard:
            return Color.red
        }
    }

    var symbol: String {
        switch self {
        case .easy:
            return "leaf"
        case .moderate:
            return "flame"
        case .hard:
            return "bolt"
        }
    }
}

struct Trail: Identifiable {
    let id = UUID()
    let name: String
    let region: String
    let miles: Double
    let ascent: Int
    let difficulty: Difficulty
    let symbol: String
    let summary: String

    var distance: String {
        return "\\(miles) mi"
    }

    var climb: String {
        return "\\(ascent) ft"
    }
}
`

const STORE = `import SwiftUI

/// One instance, reached from every tab: saving on the detail screen changes the Saved tab.
final class TrailStore: ObservableObject {
    @Published var savedIDs = [2]

    let trails = [
        Trail(name: "Cascade Ridge", region: "North Cascades", miles: 8.4, ascent: 2900, difficulty: .hard, symbol: "mountain.2",
              summary: "A long climb through old growth to a ridge above three valleys."),
        Trail(name: "Heather Meadows", region: "Mount Baker", miles: 3.1, ascent: 620, difficulty: .easy, symbol: "leaf",
              summary: "An easy loop through subalpine meadows, best in late August."),
        Trail(name: "Blue Lake Basin", region: "Okanogan", miles: 5.6, ascent: 1250, difficulty: .moderate, symbol: "drop",
              summary: "Switchbacks to a cold lake under granite spires. Busy after ten."),
        Trail(name: "Sun Point", region: "Methow", miles: 2.2, ascent: 400, difficulty: .easy, symbol: "sun.max",
              summary: "A short walk to a south-facing bench that stays warm into October."),
        Trail(name: "Granite Pass", region: "North Cascades", miles: 11.0, ascent: 3400, difficulty: .hard, symbol: "bolt",
              summary: "The long way in. Snow lingers on the north side until mid July."),
        Trail(name: "Rainy Tarn", region: "Okanogan", miles: 4.3, ascent: 880, difficulty: .moderate, symbol: "drop",
              summary: "A short steep pull to a tarn that holds the light until late."),
        Trail(name: "Larch Hollow", region: "Methow", miles: 6.8, ascent: 1600, difficulty: .moderate, symbol: "tree",
              summary: "Golden for two weeks in October and quiet for the other fifty."),
        Trail(name: "Cutthroat Lake", region: "North Cascades", miles: 3.8, ascent: 500, difficulty: .easy, symbol: "drop",
              summary: "Flat to the lake, then as far up the basin as the light allows.")
    ]

    /// The filter belongs to the screen looking at the list, not to the model.
    func results(matching query: String, within limit: Double) -> [Trail] {
        return trails.filter { trail in
            let needle = query.lowercased()
            let matches = needle.isEmpty
                || trail.name.lowercased().contains(needle)
                || trail.region.lowercased().contains(needle)
            return matches && trail.miles <= limit
        }
    }

    var featured: [Trail] {
        return trails.filter { trail in
            return trail.ascent >= 1000
        }
    }

    var saved: [Trail] {
        return trails.filter { trail in
            return savedIDs.contains(trail.id)
        }
    }

    func isSaved(_ trail: Trail) -> Bool {
        return savedIDs.contains(trail.id)
    }

    func toggleSaved(_ trail: Trail) {
        if let index = savedIDs.firstIndex(of: trail.id) {
            savedIDs.remove(at: index)
        } else {
            savedIDs.append(trail.id)
        }
    }
}
`

const COMPONENTS = `import SwiftUI

/// A ViewModifier plus the extension below: a look named once and applied in five places.
struct CardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground))
            .cornerRadius(14)
    }
}

extension View {
    func card() -> some View {
        return self.modifier(CardStyle())
    }
}

/// A button that presses in, applied to every button inside the detail screen.
struct PressableButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.vertical, 10)
            .padding(.horizontal, 18)
            .background(Color.accentColor)
            .foregroundStyle(Color.white)
            .cornerRadius(10)
            .opacity(configuration.isPressed ? 0.7 : 1.0)
    }
}

/// The difficulty pill, used on the card and again on the detail screen.
struct DifficultyBadge: View {
    var difficulty = Difficulty.easy

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: difficulty.symbol)
                .font(.caption2)
            Text(difficulty.rawValue)
                .font(.caption2)
        }
        .padding(.vertical, 3)
        .padding(.horizontal, 8)
        .background(difficulty.tint.opacity(0.18))
        .foregroundStyle(difficulty.tint)
        .cornerRadius(8)
    }
}

/// One trail, as it appears in the Discover grid.
struct TrailCard: View {
    var trail: Trail

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: trail.symbol)
                    .font(.title2)
                    .foregroundStyle(trail.difficulty.tint)
                Spacer()
                DifficultyBadge(difficulty: trail.difficulty)
            }

            Text(trail.name)
                .font(.headline)
                .foregroundStyle(Color.primary)

            Text(trail.region)
                .font(.caption)
                .foregroundStyle(Color.secondary)

            HStack(spacing: 10) {
                Text(trail.distance)
                    .font(.caption)
                    .foregroundStyle(Color.secondary)
                Text(trail.climb)
                    .font(.caption)
                    .foregroundStyle(Color.secondary)
            }
        }
        .card()
    }
}
`

const DISCOVER = `import SwiftUI

/// A horizontal carousel inside a vertical scroll view: two scrollers at right angles.
struct DiscoverView: View {
    @EnvironmentObject var store: TrailStore
    @State private var showingFilters = false
    @State private var query = ""
    @State private var maxDistance = 12.0

    let columns = [GridItem(.adaptive(minimum: 150), spacing: 12)]

    var results: [Trail] {
        return store.results(matching: query, within: maxDistance)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Featured")
                        .font(.title3)
                        .foregroundStyle(Color.primary)
                        .padding(.horizontal, 16)

                    ScrollView(.horizontal) {
                        HStack(spacing: 12) {
                            ForEach(store.featured) { trail in
                                NavigationLink(value: trail) {
                                    FeatureTile(trail: trail)
                                }
                            }
                        }
                        .padding(.horizontal, 16)
                    }

                    HStack {
                        Text("All trails")
                            .font(.title3)
                            .foregroundStyle(Color.primary)
                        Spacer()
                        Text("\\(results.count)")
                            .font(.subheadline)
                            .foregroundStyle(Color.secondary)
                    }
                    .padding(.horizontal, 16)

                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(results) { trail in
                            NavigationLink(value: trail) {
                                TrailCard(trail: trail)
                            }
                        }
                    }
                    .padding(.horizontal, 16)

                    if results.isEmpty {
                        Text("Nothing within \\(maxDistance) mi.")
                            .font(.subheadline)
                            .foregroundStyle(Color.secondary)
                            .padding(.horizontal, 16)
                    }
                }
                .padding(.vertical, 16)
            }
            .background(Color(.systemGroupedBackground))
            .navigationDestination(for: Trail.self) { trail in
                TrailDetailView(trail: trail, store: store)
            }
            .navigationTitle("Discover")
            .searchable(text: $query)
            .toolbar {
                Button("Filters") {
                    showingFilters = true
                }
            }
            .sheet(isPresented: $showingFilters) {
                FilterSheet(
                    maxDistance: $maxDistance,
                    matching: results.count,
                    total: store.trails.count
                )
            }
        }
    }
}

/// A card for the horizontal row, wide rather than tall.
struct FeatureTile: View {
    var trail: Trail

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: trail.symbol)
                .font(.title)
                .foregroundStyle(Color.white)

            Spacer()

            Text(trail.name)
                .font(.headline)
                .foregroundStyle(Color.white)

            Text(trail.region)
                .font(.caption)
                .foregroundStyle(Color.white.opacity(0.85))
        }
        .padding(14)
        .frame(width: 190, height: 140, alignment: .leading)
        .background(
            LinearGradient(
                colors: [trail.difficulty.tint, trail.difficulty.tint.opacity(0.55)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .cornerRadius(16)
    }
}

/// Takes a binding, so moving the slider here changes the grid behind it.
struct FilterSheet: View {
    @Binding var maxDistance: Double
    var matching = 0
    var total = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Filters")
                .font(.title2)
                .foregroundStyle(Color.primary)

            Text("Longest walk: \\(maxDistance) mi")
                .font(.subheadline)
                .foregroundStyle(Color.secondary)

            Slider(value: $maxDistance, in: 1...12)

            Text("\\(matching) of \\(total) trails match.")
                .font(.footnote)
                .foregroundStyle(Color.secondary)

            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(.systemGroupedBackground))
    }
}
`

const DETAIL = `import SwiftUI

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
                            Text("\\(step.id)")
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
            Step(text: "Follow the forest road to the upper car park."),
            Step(text: "Cross the creek at the second bridge, then turn uphill."),
            Step(text: "Stay left where the track forks below the pass.")
        ]
    }
}

struct Step: Identifiable {
    let id = UUID()
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
        .cornerRadius(18)
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
`

const SAVED = `import SwiftUI

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
`

const PROFILE = `import SwiftUI

/// The third tab: a form, which is the grouped list in its other clothes.
struct ProfileView: View {
    @EnvironmentObject var store: TrailStore
    @State private var offline = true
    @State private var metric = false
    @State private var pace = 2.5

    var body: some View {
        NavigationStack {
            Form {
                Section("Walker") {
                    HStack(spacing: 12) {
                        Image(systemName: "person.circle")
                            .font(.largeTitle)
                            .foregroundStyle(Color.accentColor)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Ren Okada")
                                .font(.headline)
                                .foregroundStyle(Color.primary)
                            Text("\\(store.saved.count) saved · \\(store.trails.count) walked")
                                .font(.caption)
                                .foregroundStyle(Color.secondary)
                        }
                    }
                }

                Section("Preferences") {
                    Toggle("Offline maps", isOn: $offline)
                    Toggle("Metric units", isOn: $metric)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Usual pace: \\(pace) mph")
                            .font(.subheadline)
                            .foregroundStyle(Color.primary)
                        Slider(value: $pace, in: 1...5)
                    }
                }

                Section("About") {
                    HStack {
                        Text("Version")
                            .foregroundStyle(Color.primary)
                        Spacer()
                        Text("1.0")
                            .foregroundStyle(Color.secondary)
                    }
                }
            }
            .navigationTitle("Profile")
        }
    }
}
`

export const TRAILHEAD_FILES: readonly SourceFile[] = [
  { id: 'Sources/TrailheadApp.swift', text: APP },
  { id: 'Sources/Models/Trail.swift', text: TRAIL },
  { id: 'Sources/Models/TrailStore.swift', text: STORE },
  { id: 'Sources/Components/TrailCard.swift', text: COMPONENTS },
  { id: 'Sources/Features/Discover/DiscoverView.swift', text: DISCOVER },
  { id: 'Sources/Features/Discover/TrailDetailView.swift', text: DETAIL },
  { id: 'Sources/Features/Saved/SavedView.swift', text: SAVED },
  { id: 'Sources/Features/Profile/ProfileView.swift', text: PROFILE },
]
