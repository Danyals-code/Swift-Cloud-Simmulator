import SwiftUI

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

/// A protocol with a default implementation: `Ingredient` says what it has and
/// gets `scaled(by:)` free. Doubling a recipe is arithmetic in one place.
protocol Scalable {
    var amount: Double { get }
    var unit: String { get }
}

extension Scalable {
    func scaled(by factor: Double) -> String {
        let value = (amount * factor * 10).rounded() / 10
        if unit.isEmpty {
            return "\(value)"
        }
        return "\(value) \(unit)"
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
        return "\(minutes) min"
    }

    /// Computed, so it stays out of the `Hashable` a `NavigationLink(value:)` needs.
    var summary: String {
        return "\(course.rawValue) · serves \(serves)"
    }
}
