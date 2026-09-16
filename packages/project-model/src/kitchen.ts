import type { SourceFile } from '@studio/shared'

/**
 * Kitchen - the app that is one stack.
 *
 * Trailhead opens onto tabs and Ledger opens onto tabs; plenty of real apps are a
 * single `NavigationStack` with everything pushed onto it, and that shape puts the
 * state somewhere else. Here the shelf is made once at the root, and the screens
 * below reach it through the environment rather than being handed it.
 *
 * It is also the gallery's worked example of two things nothing else shows: a
 * protocol with a default implementation in an extension - `scaled(by:)`, which is
 * what makes doubling a recipe arithmetic in one place - and a child view that owns
 * no state at all, taking the ticked steps as a `@Binding` so the list and the
 * progress bar above it cannot disagree.
 *
 * Same gate as every other template (`tests/templates.test.ts`).
 */

const APP = `import SwiftUI

@main
struct KitchenApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

/// One stack, no tab bar. The shelf is created here so every screen reads one.
struct RootView: View {
    @StateObject private var shelf = Shelf()

    var body: some View {
        BrowseView()
            .environmentObject(shelf)
    }
}
`

const RECIPE = `import SwiftUI

enum Course: String, CaseIterable, Identifiable {
    case all = "All"
    case brunch = "Brunch"
    case dinner = "Dinner"
    case sweet = "Sweet"

    var id: String {
        return rawValue
    }

    var symbol: String {
        switch self {
        case .all:
            return "square.grid.2x2"
        case .brunch:
            return "sun.max"
        case .dinner:
            return "flame.fill"
        case .sweet:
            return "heart.fill"
        }
    }

    var tint: Color {
        switch self {
        case .all:
            return Color.gray
        case .brunch:
            return Color.orange
        case .dinner:
            return Color.red
        case .sweet:
            return Color.pink
        }
    }
}

/// A protocol with a default implementation: \`Ingredient\` says what it has and
/// gets \`scaled(by:)\` free. Doubling a recipe is arithmetic in one place.
protocol Scalable {
    var amount: Double { get }
    var unit: String { get }
}

extension Scalable {
    func scaled(by factor: Double) -> String {
        let value = (amount * factor * 10).rounded() / 10
        if unit.isEmpty {
            return "\\(value)"
        }
        return "\\(value) \\(unit)"
    }
}

struct Ingredient: Identifiable, Hashable, Scalable {
    let id = UUID()
    var name: String
    var amount: Double
    var unit: String
}

struct Recipe: Identifiable, Hashable {
    let id = UUID()
    var title: String
    var cook: String
    var course: Course
    var minutes: Int
    var serves: Int
    var rating: Int
    var blurb: String
    var ingredients: [Ingredient]
    var method: [String]

    var time: String {
        return "\\(minutes) min"
    }

    /// Computed, so it stays out of the \`Hashable\` a \`NavigationLink(value:)\` needs.
    var summary: String {
        return "\\(course.rawValue) · serves \\(serves)"
    }
}
`

const SHELF = `import SwiftUI

/// The one object every screen reads.
final class Shelf: ObservableObject {
    @Published var favourites = ["Bavette, anchovy butter"]
    @Published var course = Course.all
    @Published var query = ""

    let recipes = [
        Recipe(
            title: "Buckwheat pancakes",
            cook: "Ada Lindqvist",
            course: .brunch,
            minutes: 25,
            serves: 2,
            rating: 4,
            blurb: "Nutty, thin, forgiving about the resting.",
            ingredients: [
                Ingredient(name: "Buckwheat flour", amount: 120, unit: "g"),
                Ingredient(name: "Milk", amount: 250, unit: "ml"),
                Ingredient(name: "Eggs", amount: 2, unit: ""),
                Ingredient(name: "Butter", amount: 30, unit: "g")
            ],
            method: [
                "Whisk flour and milk, then leave it twenty minutes.",
                "Beat the eggs in, then the melted butter.",
                "Cook until the edges lift by themselves."
            ]
        ),
        Recipe(
            title: "Bavette, anchovy butter",
            cook: "Marco Reyes",
            course: .dinner,
            minutes: 40,
            serves: 4,
            rating: 5,
            blurb: "The butter does the work. Rest it properly.",
            ingredients: [
                Ingredient(name: "Bavette", amount: 700, unit: "g"),
                Ingredient(name: "Butter", amount: 80, unit: "g"),
                Ingredient(name: "Anchovy fillets", amount: 6, unit: ""),
                Ingredient(name: "Parsley", amount: 15, unit: "g")
            ],
            method: [
                "Mash the anchovies into soft butter with parsley.",
                "Sear hard both sides, then rest it ten minutes.",
                "Slice against the grain, butter on off the heat."
            ]
        ),
        Recipe(
            title: "Burnt basque cheesecake",
            cook: "Ines Duarte",
            course: .sweet,
            minutes: 70,
            serves: 8,
            rating: 5,
            blurb: "Hotter and shorter than feels right.",
            ingredients: [
                Ingredient(name: "Cream cheese", amount: 900, unit: "g"),
                Ingredient(name: "Caster sugar", amount: 300, unit: "g"),
                Ingredient(name: "Eggs", amount: 6, unit: ""),
                Ingredient(name: "Cream", amount: 400, unit: "ml")
            ],
            method: [
                "Beat cheese and sugar smooth, then the eggs one by one.",
                "Fold the cream through and pour into a lined tin.",
                "Bake at 220C until dark on top and loose in the middle."
            ]
        ),
        Recipe(
            title: "Cacio e pepe",
            cook: "Marco Reyes",
            course: .dinner,
            minutes: 20,
            serves: 2,
            rating: 5,
            blurb: "Three ingredients; water is one of them.",
            ingredients: [
                Ingredient(name: "Tonnarelli", amount: 200, unit: "g"),
                Ingredient(name: "Pecorino", amount: 120, unit: "g"),
                Ingredient(name: "Black pepper", amount: 4, unit: "g")
            ],
            method: [
                "Toast the cracked pepper until you can smell it.",
                "Cook the pasta in barely enough water.",
                "Paste the cheese with the water off the heat."
            ]
        )
    ]

    var results: [Recipe] {
        let needle = query.lowercased()
        return recipes.filter { recipe in
            let matchesCourse = course == .all || recipe.course == course
            let matchesQuery = needle.isEmpty
                || recipe.title.lowercased().contains(needle)
                || recipe.cook.lowercased().contains(needle)
            return matchesCourse && matchesQuery
        }
    }

    var saved: [Recipe] {
        return recipes.filter { recipe in
            return favourites.contains(recipe.title)
        }
    }

    func isFavourite(_ recipe: Recipe) -> Bool {
        return favourites.contains(recipe.title)
    }

    func toggleFavourite(_ recipe: Recipe) {
        if let index = favourites.firstIndex(of: recipe.title) {
            favourites.remove(at: index)
        } else {
            favourites.append(recipe.title)
        }
    }
}
`

const CHROME = `import SwiftUI

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

struct Stars: View {
    var rating = 0

    var body: some View {
        HStack(spacing: 2) {
            ForEach(1...5, id: \\.self) { position in
                Image(systemName: position <= rating ? "star.fill" : "circle.fill")
                    .font(.caption2)
                    .foregroundStyle(position <= rating ? Color.yellow : Color.secondary.opacity(0.3))
            }
        }
    }
}

struct CourseChip: View {
    var course = Course.dinner

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: course.symbol)
                .font(.caption2)
            Text(course.rawValue)
                .font(.caption2)
        }
        .fixedSize()
        .padding(.vertical, 3)
        .padding(.horizontal, 8)
        .background(course.tint.opacity(0.18))
        .foregroundStyle(course.tint)
        .cornerRadius(8)
    }
}

struct RecipeCard: View {
    var recipe: Recipe
    var saved = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                CourseChip(course: recipe.course)
                Spacer()
                if saved {
                    Image(systemName: "bookmark.fill")
                        .font(.caption)
                        .foregroundStyle(Color.accentColor)
                }
            }

            Text(recipe.title)
                .font(.headline)
                .foregroundStyle(Color.primary)
                .multilineTextAlignment(.leading)

            Text(recipe.cook)
                .font(.caption)
                .foregroundStyle(Color.secondary)

            HStack(spacing: 8) {
                Stars(rating: recipe.rating)
                Spacer()
                Text(recipe.time)
                    .font(.caption)
                    .foregroundStyle(Color.secondary)
            }
        }
        .card()
    }
}
`

const BROWSE = `import SwiftUI

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
                        Text("\\(shelf.results.count)")
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
        .cornerRadius(16)
    }
}
`

const DETAIL = `import SwiftUI

/// The pushed screen: a stepper that rewrites the quantities under it.
struct RecipeView: View {
    var recipe: Recipe

    @EnvironmentObject var shelf: Shelf
    @State private var servings = 0
    @State private var done: [String] = []
    @State private var confirming = false

    /// Written for \`serves\`, wanted for \`servings\`: the ratio is all the rows need.
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
                            Text("Cooking for \\(servings)")
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
                    Text("\\(done.count) of \\(recipe.method.count) steps")
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
                Fact(label: "Serves", value: "\\(recipe.serves)")
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
        .cornerRadius(18)
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
`

const METHOD = `import SwiftUI

/// The method. It owns no state: the ticks arrive as a \`@Binding\`, so this list
/// and the progress bar above it cannot disagree about what is done.
struct Method: View {
    var steps: [String] = []
    @Binding var done: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            DisclosureGroup("Method") {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(steps, id: \\.self) { step in
                        StepRow(
                            step: step,
                            number: (steps.firstIndex(of: step) ?? 0) + 1,
                            ticked: done.contains(step)
                        ) {
                            toggle(step)
                        }
                    }
                }
                .padding(.top, 8)
            }
        }
        .card()
    }

    func toggle(_ step: String) {
        if let index = done.firstIndex(of: step) {
            done.remove(at: index)
        } else {
            done.append(step)
        }
    }
}

/// Takes its action as a closure, so \`Method\` holds no opinion about the drawing.
struct StepRow: View {
    var step = ""
    var number = 1
    var ticked = false
    var onTap: () -> Void = {}

    var body: some View {
        Button {
            onTap()
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: ticked ? "checkmark.circle.fill" : "circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(ticked ? Color.green : Color.secondary.opacity(0.35))

                Text("\\(number). \\(step)")
                    .font(.subheadline)
                    .multilineTextAlignment(.leading)
                    .foregroundStyle(ticked ? Color.secondary : Color.primary)
                    .strikethrough(ticked)

                Spacer()
            }
        }
        .buttonStyle(.plain)
    }
}
`

export const KITCHEN_FILES: readonly SourceFile[] = [
  { id: 'Sources/KitchenApp.swift', text: APP },
  { id: 'Sources/Models/Recipe.swift', text: RECIPE },
  { id: 'Sources/Models/Shelf.swift', text: SHELF },
  { id: 'Sources/Components/RecipeCard.swift', text: CHROME },
  { id: 'Sources/Features/Browse/BrowseView.swift', text: BROWSE },
  { id: 'Sources/Features/Recipe/RecipeView.swift', text: DETAIL },
  { id: 'Sources/Features/Recipe/Method.swift', text: METHOD },
]
