import SwiftUI

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

/// Hashable because NavigationLink(value:) pushes the whole value, and Swift
/// synthesises that conformance only for a type that declares it.
struct Trail: Identifiable, Hashable {
    let id = UUID()
    let name: String
    let region: String
    let miles: Double
    let ascent: Int
    let difficulty: Difficulty
    let symbol: String
    let summary: String

    var distance: String {
        return "\(miles) mi"
    }

    var climb: String {
        return "\(ascent) ft"
    }
}
