import SwiftUI

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
                                Text("\(log.total)")
                                    .font(.system(size: 36, weight: .semibold, design: .rounded))
                                    .monospacedDigit()
                                    .foregroundStyle(Color.primary)
                                Text("of \(log.target) min")
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
                            ForEach(log.days, id: \.self) { day in
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
                                    Text("\(log.minutes(of: discipline)) min")
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
