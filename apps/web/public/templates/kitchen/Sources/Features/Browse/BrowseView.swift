import SwiftUI

/// The only screen that is not a push.
struct BrowseView: View {
    @EnvironmentObject var shelf: Shelf

    let columns = [GridItem(.adaptive(minimum: 158), spacing: 12)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Picker("Course", selection: $shelf.course) {
                        ForEach(Course.allCases) { course in
                            Text(course.rawValue)
                                .tag(course)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16)

                    if !shelf.saved.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("On the shelf")
                                .font(.headline)
                                .foregroundStyle(Color.primary)
                                .padding(.horizontal, 16)

                            ScrollView(.horizontal) {
                                HStack(spacing: 12) {
                                    ForEach(shelf.saved) { recipe in
                                        NavigationLink(value: recipe) {
                                            SavedTile(recipe: recipe)
                                        }
                                    }
                                }
                                .padding(.horizontal, 16)
                            }
                        }
                    }

                    HStack {
                        Text(shelf.course == .all ? "Everything" : shelf.course.rawValue)
                            .font(.headline)
                            .foregroundStyle(Color.primary)
                        Spacer()
                        Text("\(shelf.results.count)")
                            .font(.subheadline)
                            .foregroundStyle(Color.secondary)
                    }
                    .padding(.horizontal, 16)

                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(shelf.results) { recipe in
                            NavigationLink(value: recipe) {
                                RecipeCard(recipe: recipe, saved: shelf.isFavourite(recipe))
                            }
                        }
                    }
                    .padding(.horizontal, 16)

                    if shelf.results.isEmpty {
                        Text("Nothing here matches that.")
                            .font(.subheadline)
                            .foregroundStyle(Color.secondary)
                            .padding(.horizontal, 16)
                    }
                }
                .padding(.vertical, 14)
            }
            .background(Color(.systemGroupedBackground))
            .navigationDestination(for: Recipe.self) { recipe in
                RecipeView(recipe: recipe)
            }
            .navigationTitle("Kitchen")
            .searchable(text: $shelf.query)
        }
    }
}

struct SavedTile: View {
    var recipe: Recipe

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: recipe.course.symbol)
                .font(.title2)
                .foregroundStyle(Color.white)

            Spacer()

            Text(recipe.title)
                .font(.subheadline)
                .foregroundStyle(Color.white)
                .lineLimit(2)

            Text(recipe.summary)
                .font(.caption2)
                .foregroundStyle(Color.white.opacity(0.85))
        }
        .padding(12)
        .frame(width: 176, height: 132, alignment: .leading)
        .background(
            LinearGradient(
                colors: [recipe.course.tint, Color.indigo],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(.rect(cornerRadius: 16))
    }
}
