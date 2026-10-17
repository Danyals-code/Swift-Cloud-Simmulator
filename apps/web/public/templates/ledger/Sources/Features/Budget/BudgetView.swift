import SwiftUI

/// The third tab: the one number the other two are measured against.
struct BudgetView: View {
    @EnvironmentObject var ledger: Ledger
    @AppStorage("ledger.rollover") private var rollover = true
    @State private var alerts = false

    var footnote: String {
        if rollover {
            return "What is left joins the next month."
        }
        return "Every month starts at the same number."
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("This month") {
                    LabeledContent("Budget") {
                        Money(amount: ledger.monthlyBudget)
                    }
                    LabeledContent("Spent") {
                        Money(amount: ledger.spent)
                    }
                    LabeledContent("Left") {
                        Text(ledger.remaining, format: .currency(code: "USD"))
                            .monospacedDigit()
                            .foregroundStyle(ledger.remaining > 0 ? Color.green : Color.red)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Monthly budget")
                            .font(.subheadline)
                            .foregroundStyle(Color.primary)
                        Slider(value: $ledger.monthlyBudget, in: 200...900, step: 10)
                    }
                }

                Section {
                    Toggle("Roll the remainder over", isOn: $rollover)
                    Toggle("Warn me at 80%", isOn: $alerts)
                } header: {
                    Text("Rules")
                } footer: {
                    Text(footnote)
                }

                Section("Heaviest") {
                    ForEach(Category.allCases) { category in
                        LabeledContent(category.rawValue) {
                            Money(amount: ledger.spent(on: category), font: .subheadline)
                        }
                    }
                }
            }
            .navigationTitle("Budget")
        }
    }
}
