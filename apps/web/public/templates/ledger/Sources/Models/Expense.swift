import SwiftUI

/// Where the money went.
///
/// The colour and the symbol are decided here rather than at each of the four
/// places that draw a category, which is the whole reason this is an enum with
/// properties and not a `String`.
enum Category: String, CaseIterable, Identifiable {
    case food = "Food"
    case transport = "Transport"
    case home = "Home"
    case fun = "Fun"

    var id: String {
        return rawValue
    }

    var tint: Color {
        switch self {
        case .food:
            return Color.orange
        case .transport:
            return Color.blue
        case .home:
            return Color.teal
        case .fun:
            return Color.pink
        }
    }

    var symbol: String {
        switch self {
        case .food:
            return "cart.fill"
        case .transport:
            return "arrow.up.arrow.down"
        case .home:
            return "house.fill"
        case .fun:
            return "music.note"
        }
    }
}

/// `Hashable` as well as `Identifiable`: the id is what `ForEach` follows, and the
/// whole value is what `NavigationLink(value:)` pushes.
struct Expense: Identifiable, Hashable {
    let id = UUID()
    var title: String
    var amount: Double
    var category: Category
    var date: Date

    var note: String {
        return "\(category.rawValue) · \(title)"
    }
}
