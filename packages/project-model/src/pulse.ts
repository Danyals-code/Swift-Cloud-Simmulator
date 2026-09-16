import type { SourceFile } from '@studio/shared'

/**
 * Pulse - the app that draws its own numbers.
 *
 * Trailhead browses, Ledger records, Kitchen reads. This one *computes*: every
 * figure on screen - the ring, the seven bars, the split by discipline - is derived
 * from the same array of sessions, so none of the three can disagree with the other
 * two. That is the arrangement most dashboards want and most get wrong by caching a
 * total somewhere.
 *
 * It is the gallery's worked example of drawing rather than assembling: a `Path`
 * with an explicit arc inside a `GeometryReader`, which is the only place the radius
 * in points actually exists. It also carries the `Grid` / `GridRow` the coverage
 * matrix claims and nothing else exercised.
 *
 * Same gate as every other template (`tests/templates.test.ts`).
 */

const APP = `import SwiftUI

@main
struct PulseApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct RootView: View {
    @StateObject private var log = TrainingLog()

    var body: some View {
        MainTabs()
            .environmentObject(log)
    }
}

struct MainTabs: View {
    var body: some View {
        TabView {
            TodayView()
                .tabItem {
                    Label("Today", systemImage: "bolt.fill")
                }

            HistoryView()
                .tabItem {
                    Label("History", systemImage: "list.bullet")
                }
        }
    }
}
`

const SESSION = `import SwiftUI

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
        return "\\(minutes) min"
    }
}
`

const LOG = `import SwiftUI

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
`

const RINGS = `import SwiftUI

/// A progress ring drawn rather than assembled.
///
/// \`GeometryReader\` is what makes it square at whatever size it is given: the arc
/// needs a radius in points, and the only place that number exists is here.
struct Ring: View {
    var progress = 0.0
    var tint = Color.accentColor
    var thickness = 14.0

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Circle()
                    .stroke(tint.opacity(0.18), lineWidth: thickness)

                Path { path in
                    path.addArc(
                        center: CGPoint(x: geo.size.width / 2, y: geo.size.height / 2),
                        radius: (min(geo.size.width, geo.size.height) - thickness) / 2,
                        startAngle: .degrees(-90),
                        endAngle: .degrees(270),
                        clockwise: true
                    )
                }
                .trim(from: 0, to: progress)
                .stroke(tint, lineWidth: thickness)
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

/// One bar of the week. The height is a fraction of the busiest day, so the tallest
/// bar is always full and the shape of the week is readable at any volume.
struct DayBar: View {
    var day = ""
    var minutes = 0
    var fraction = 0.0
    var tint = Color.accentColor

    var body: some View {
        VStack(spacing: 6) {
            Text("\\(minutes)")
                .font(.caption2)
                .monospacedDigit()
                .foregroundStyle(Color.secondary)

            ZStack(alignment: .bottom) {
                RoundedRectangle(cornerRadius: 5)
                    .fill(Color.primary.opacity(0.07))
                    .frame(width: 22, height: 96)
                RoundedRectangle(cornerRadius: 5)
                    .fill(tint)
                    .frame(width: 22, height: max(4.0, 96.0 * fraction))
            }

            Text(day)
                .font(.caption2)
                .foregroundStyle(Color.secondary)
        }
    }
}

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
`

const TODAY = `import SwiftUI

/// The week at a glance: a drawn ring, seven bars, and the split by discipline.
struct TodayView: View {
    @EnvironmentObject var log: TrainingLog
    @State private var showing = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(spacing: 12) {
                        ZStack {
                            Ring(progress: log.progress, tint: Color.orange)
                                .frame(width: 168, height: 168)

                            VStack(spacing: 2) {
                                Text("\\(log.total)")
                                    .font(.system(size: 36, weight: .semibold, design: .rounded))
                                    .monospacedDigit()
                                    .foregroundStyle(Color.primary)
                                Text("of \\(log.target) min")
                                    .font(.caption)
                                    .foregroundStyle(Color.secondary)
                            }
                        }

                        Text(log.progress < 1 ? "Keep going." : "Week done.")
                            .font(.subheadline)
                            .foregroundStyle(Color.secondary)
                    }
                    .card()
                    .padding(.horizontal, 16)

                    VStack(alignment: .leading, spacing: 12) {
                        Text("This week")
                            .font(.headline)
                            .foregroundStyle(Color.primary)

                        HStack(alignment: .bottom, spacing: 8) {
                            ForEach(log.days, id: \\.self) { day in
                                DayBar(
                                    day: day,
                                    minutes: log.minutes(on: day),
                                    fraction: Double(log.minutes(on: day)) / Double(log.busiest),
                                    tint: Color.orange
                                )
                            }
                        }
                    }
                    .card()
                    .padding(.horizontal, 16)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Split")
                            .font(.headline)
                            .foregroundStyle(Color.primary)

                        Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
                            ForEach(Discipline.allCases) { discipline in
                                GridRow {
                                    Image(systemName: discipline.symbol)
                                        .font(.caption)
                                        .foregroundStyle(discipline.tint)
                                    Text(discipline.rawValue)
                                        .font(.subheadline)
                                        .foregroundStyle(Color.primary)
                                    Text("\\(log.minutes(of: discipline)) min")
                                        .font(.subheadline)
                                        .monospacedDigit()
                                        .foregroundStyle(Color.secondary)
                                }
                            }
                        }
                    }
                    .card()
                    .padding(.horizontal, 16)

                    Button {
                        showing = true
                    } label: {
                        Label("Set the target", systemImage: "slider.horizontal.3")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .padding(.horizontal, 16)
                }
                .padding(.vertical, 16)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Pulse")
            .sheet(isPresented: $showing) {
                TargetSheet(target: $log.target)
            }
        }
    }
}
`

const TARGET = `import SwiftUI

/// Takes the target as a \`Binding\` straight out of the store, so moving the stepper
/// redraws the ring on the screen behind the sheet.
struct TargetSheet: View {
    @Binding var target: Int
    @Environment(\\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Weekly target")
                .font(.title2)
                .foregroundStyle(Color.primary)

            Text("\\(target) minutes")
                .font(.system(size: 30, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(Color.orange)

            Stepper("Adjust", value: $target, in: 60...900, step: 30)

            Text("Not a recommendation. It is the number you chose.")
                .font(.footnote)
                .foregroundStyle(Color.secondary)

            Spacer()

            Button("Done") {
                dismiss()
            }
            .buttonStyle(.borderedProminent)
            .frame(maxWidth: .infinity)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(.systemGroupedBackground))
    }
}
`

const HISTORY = `import SwiftUI

/// The second tab: every session, and a push onto one of them.
struct HistoryView: View {
    @EnvironmentObject var log: TrainingLog

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(log.sessions) { session in
                        NavigationLink(value: session) {
                            SessionRow(session: session)
                        }
                    }
                } header: {
                    Text("\\(log.sessions.count) sessions")
                } footer: {
                    Text("Load is minutes times effort, which is as crude as it sounds.")
                }
            }
            .navigationDestination(for: Session.self) { session in
                SessionView(session: session)
            }
            .navigationTitle("History")
        }
    }
}

struct SessionRow: View {
    var session: Session

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: session.discipline.symbol)
                .font(.title3)
                .foregroundStyle(session.discipline.tint)
                .frame(width: 26)

            VStack(alignment: .leading, spacing: 2) {
                Text(session.discipline.rawValue)
                    .font(.body)
                    .foregroundStyle(Color.primary)
                Text(session.day)
                    .font(.caption)
                    .foregroundStyle(Color.secondary)
            }

            Spacer()

            Text(session.duration)
                .font(.subheadline)
                .monospacedDigit()
                .foregroundStyle(Color.secondary)
        }
    }
}
`

const SESSIONVIEW = `import SwiftUI

/// The pushed screen. Effort is a row of pips rather than a number out of ten,
/// which invites arithmetic nobody wants to do.
struct SessionView: View {
    var session: Session

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    Image(systemName: session.discipline.symbol)
                        .font(.largeTitle)
                        .foregroundStyle(Color.white)
                    Text(session.duration)
                        .font(.system(size: 32, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color.white)
                    Text(session.day)
                        .font(.subheadline)
                        .foregroundStyle(Color.white.opacity(0.85))
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    LinearGradient(
                        colors: [session.discipline.tint, Color.indigo],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .cornerRadius(18)

                LabeledContent("Effort") {
                    HStack(spacing: 3) {
                        ForEach(1...10, id: \\.self) { pip in
                            Circle()
                                .fill(pip <= session.effort
                                    ? session.discipline.tint
                                    : Color.secondary.opacity(0.22))
                                .frame(width: 8, height: 8)
                        }
                    }
                }
                .card()

                LabeledContent("Load") {
                    Text("\\(session.load)")
                        .monospacedDigit()
                        .foregroundStyle(Color.secondary)
                }
                .card()

                VStack(alignment: .leading, spacing: 6) {
                    Text("Note")
                        .font(.headline)
                        .foregroundStyle(Color.primary)
                    Text(session.note)
                        .font(.subheadline)
                        .foregroundStyle(Color.secondary)
                }
                .card()
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(session.discipline.rawValue)
    }
}
`

export const PULSE_FILES: readonly SourceFile[] = [
  { id: 'Sources/PulseApp.swift', text: APP },
  { id: 'Sources/Models/Session.swift', text: SESSION },
  { id: 'Sources/Models/TrainingLog.swift', text: LOG },
  { id: 'Sources/Components/Rings.swift', text: RINGS },
  { id: 'Sources/Features/Today/TodayView.swift', text: TODAY },
  { id: 'Sources/Features/Today/TargetSheet.swift', text: TARGET },
  { id: 'Sources/Features/History/HistoryView.swift', text: HISTORY },
  { id: 'Sources/Features/History/SessionView.swift', text: SESSIONVIEW },
]
