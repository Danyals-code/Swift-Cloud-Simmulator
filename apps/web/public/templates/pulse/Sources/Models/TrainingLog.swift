import SwiftUI

/// The week, and the arithmetic over it.
///
/// Every number the two screens draw is computed here, so neither can invent one:
/// the ring, the bars and the list are three views of the same seven sessions.
final class TrainingLog: ObservableObject {
    @Published var target = 540
    @Published var sessions = [
        Session(discipline: .run, day: "Mon", minutes: 42, effort: 6, note: "Easy, into the wind on the way back."),
        Session(discipline: .lift, day: "Tue", minutes: 55, effort: 7, note: "Squats, then everything that hurt after."),
        Session(discipline: .ride, day: "Wed", minutes: 95, effort: 5, note: "Long and flat. Legs came back by the end."),
        Session(discipline: .swim, day: "Thu", minutes: 35, effort: 6, note: "Drills for half of it. Catch is improving."),
        Session(discipline: .run, day: "Fri", minutes: 28, effort: 8, note: "Intervals. Six by three, short recoveries."),
        Session(discipline: .ride, day: "Sat", minutes: 140, effort: 7, note: "Hills. Ate too little and paid for it."),
        Session(discipline: .run, day: "Sun", minutes: 61, effort: 4, note: "Slow. The only honest recovery run all week.")
    ]

    let days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    var total: Int {
        return sessions.reduce(0) { running, session in
            return running + session.minutes
        }
    }

    /// Clamped: a ring drawn past 1.0 wraps around and reads as almost nothing done.
    var progress: Double {
        return min(1.0, Double(total) / Double(target))
    }

    var hardest: Session? {
        return sessions.max { first, second in
            return first.load < second.load
        }
    }

    func minutes(on day: String) -> Int {
        return sessions.filter { session in
            return session.day == day
        }
        .reduce(0) { running, session in
            return running + session.minutes
        }
    }

    func minutes(of discipline: Discipline) -> Int {
        return sessions.filter { session in
            return session.discipline == discipline
        }
        .reduce(0) { running, session in
            return running + session.minutes
        }
    }

    var busiest: Int {
        var top = 1
        for day in days {
            top = max(top, minutes(on: day))
        }
        return top
    }
}
