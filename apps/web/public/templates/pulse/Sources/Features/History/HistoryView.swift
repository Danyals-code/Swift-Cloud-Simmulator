import SwiftUI

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
                    Text("\(log.sessions.count) sessions")
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
