import SwiftUI

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
                .clipShape(.rect(cornerRadius: 18))

                LabeledContent("Effort") {
                    HStack(spacing: 3) {
                        ForEach(1...10, id: \.self) { pip in
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
                    Text("\(session.load)")
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
