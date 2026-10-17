import SwiftUI

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
