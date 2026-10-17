import SwiftUI

enum Discipline: String, CaseIterable, Identifiable {
    case run = "Run"
    case ride = "Ride"
    case swim = "Swim"
    case lift = "Lift"

    var id: String {
        return rawValue
    }

    var tint: Color {
        switch self {
        case .run:
            return Color.orange
        case .ride:
            return Color.blue
        case .swim:
            return Color.teal
        case .lift:
            return Color.purple
        }
    }

    var symbol: String {
        switch self {
        case .run:
            return "bolt.fill"
        case .ride:
            return "arrow.clockwise"
        case .swim:
            return "drop.fill"
        case .lift:
            return "square.grid.2x2"
        }
    }
}

struct Session: Identifiable, Hashable {
    let id = UUID()
    var discipline: Discipline
    var day: String
    var minutes: Int
    var effort: Int
    var note: String

    var load: Int {
        return minutes * effort
    }

    var duration: String {
        return "\(minutes) min"
    }
}
