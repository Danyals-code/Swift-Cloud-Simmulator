import SwiftUI

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
                        Text("\(results.count)")
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
                        Text("Nothing within \(maxDistance) mi.")
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
        .clipShape(.rect(cornerRadius: 16))
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

            Text("Longest walk: \(maxDistance) mi")
                .font(.subheadline)
                .foregroundStyle(Color.secondary)

            Slider(value: $maxDistance, in: 1...12)

            Text("\(matching) of \(total) trails match.")
                .font(.footnote)
                .foregroundStyle(Color.secondary)

            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(.systemGroupedBackground))
    }
}
