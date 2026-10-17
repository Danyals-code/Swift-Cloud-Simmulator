import SwiftUI

/// The first tab: what the month adds up to, and what it is made of.
struct SummaryView: View {
    @EnvironmentObject var ledger: Ledger

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Header(spent: ledger.spent, used: ledger.used)
                        .padding(.horizontal, 16)

                    VStack(alignment: .leading, spacing: 12) {
                        Text("By category")
                            .font(.headline)
                            .foregroundStyle(Color.primary)

                        ForEach(Category.allCases) { category in
                            BarRow(
                                category: category,
                                amount: ledger.spent(on: category),
                                fraction: ledger.spent(on: category) / ledger.heaviest
                            )
                        }
                    }
                    .card()
                    .padding(.horizontal, 16)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Latest")
                            .font(.headline)
                            .foregroundStyle(Color.primary)

                        ForEach(ledger.expenses.prefix(3)) { expense in
                            HStack {
                                Text(expense.title)
                                    .font(.subheadline)
                                    .foregroundStyle(Color.primary)
                                Spacer()
                                Money(amount: expense.amount, font: .subheadline)
                            }
                        }
                    }
                    .card()
                    .padding(.horizontal, 16)
                }
                .padding(.vertical, 16)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Summary")
        }
    }
}

/// The banner: a gradient, the total, and the month's progress through the budget.
struct Header: View {
    var spent = 0.0
    var used = 0.0

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Spent this month")
                .font(.caption)
                .foregroundStyle(Color.white.opacity(0.85))

            Text(spent, format: .currency(code: "USD"))
                .font(.system(size: 34, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(Color.white)

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.25))
                    .frame(height: 8)
                Capsule()
                    .fill(Color.white)
                    .frame(width: max(8.0, 300.0 * used), height: 8)
            }

            Text("\(Int(used * 100))% of the budget")
                .font(.caption)
                .foregroundStyle(Color.white.opacity(0.85))
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [Color.indigo, Color.purple],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(.rect(cornerRadius: 18))
    }
}
