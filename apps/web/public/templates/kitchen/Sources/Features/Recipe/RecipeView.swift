import SwiftUI

/// The pushed screen: a stepper that rewrites the quantities under it.
struct RecipeView: View {
    var recipe: Recipe

    @EnvironmentObject var shelf: Shelf
    @State private var servings = 0
    @State private var done: [String] = []
    @State private var confirming = false

    /// Written for `serves`, wanted for `servings`: the ratio is all the rows need.
    var factor: Double {
        return Double(servings) / Double(recipe.serves)
    }

    var progress: Double {
        return Double(done.count) / Double(recipe.method.count)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Banner(recipe: recipe)

                GroupBox("Servings") {
                    VStack(alignment: .leading, spacing: 8) {
                        Stepper(value: $servings, in: 1...16) {
                            Text("Cooking for \(servings)")
                                .font(.subheadline)
                                .foregroundStyle(Color.primary)
                        }

                        Text(servings == recipe.serves ? "As written." : "Scaled.")
                            .font(.caption)
                            .foregroundStyle(Color.secondary)
                    }
                }
                .padding(.horizontal, 16)

                VStack(alignment: .leading, spacing: 10) {
                    Text("Ingredients")
                        .font(.headline)
                        .foregroundStyle(Color.primary)

                    ForEach(recipe.ingredients) { ingredient in
                        HStack(alignment: .firstTextBaseline) {
                            Text(ingredient.name)
                                .font(.subheadline)
                                .foregroundStyle(Color.primary)
                            Spacer()
                            Text(ingredient.scaled(by: factor))
                                .font(.subheadline)
                                .monospacedDigit()
                                .foregroundStyle(Color.secondary)
                        }
                    }
                }
                .card()
                .padding(.horizontal, 16)

                Method(steps: recipe.method, done: $done)
                    .padding(.horizontal, 16)

                VStack(alignment: .leading, spacing: 8) {
                    ProgressView(value: progress)
                    Text("\(done.count) of \(recipe.method.count) steps")
                        .font(.caption)
                        .foregroundStyle(Color.secondary)
                }
                .card()
                .padding(.horizontal, 16)

                HStack(spacing: 12) {
                    Button(shelf.isFavourite(recipe) ? "Shelved" : "Shelve it") {
                        shelf.toggleFavourite(recipe)
                    }
                    .buttonStyle(.borderedProminent)

                    Button("Start over") {
                        confirming = true
                    }
                    .buttonStyle(.bordered)

                    Spacer()
                }
                .padding(.horizontal, 16)
            }
            .padding(.vertical, 16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(recipe.title)
        .onAppear {
            servings = recipe.serves
        }
        .alert("Clear the ticks?", isPresented: $confirming) {
            Button("Clear") {
                done = []
            }
            Button("Keep them") {
                confirming = false
            }
        } message: {
            Text("Only the ticks. Nothing else changes.")
        }
    }
}

struct Banner: View {
    var recipe: Recipe

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                CourseChip(course: recipe.course)
                Spacer()
                Stars(rating: recipe.rating)
            }

            Text(recipe.blurb)
                .font(.subheadline)
                .foregroundStyle(Color.white)

            HStack(spacing: 14) {
                Fact(label: "Time", value: recipe.time)
                Fact(label: "Serves", value: "\(recipe.serves)")
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [recipe.course.tint, Color.purple],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(.rect(cornerRadius: 18))
        .padding(.horizontal, 16)
    }
}

struct Fact: View {
    var label = ""
    var value = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.caption2)
                .foregroundStyle(Color.white.opacity(0.8))
            Text(value)
                .font(.caption)
                .foregroundStyle(Color.white)
        }
    }
}
