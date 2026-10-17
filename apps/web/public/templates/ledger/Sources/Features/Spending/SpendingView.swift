import SwiftUI

/// The second tab: everything, searchable, swipe to delete, and a sheet to add.
struct SpendingView: View {
    @EnvironmentObject var ledger: Ledger
    @State private var query = ""
    @State private var adding = false

    var results: [Expense] {
        return ledger.results(matching: query)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(results) { expense in
                        NavigationLink(value: expense) {
                            ExpenseRow(expense: expense)
                        }
                    }
                    .onDelete { offsets in
                        ledger.expenses.remove(atOffsets: offsets)
                    }
                } header: {
                    Text("\(results.count) of \(ledger.expenses.count)")
                } footer: {
                    Text("Swipe a row to delete it.")
                }

                if results.isEmpty {
                    Text("Nothing matches that.")
                        .font(.subheadline)
                        .foregroundStyle(Color.secondary)
                }
            }
            .navigationDestination(for: Expense.self) { expense in
                ExpenseDetail(expense: expense)
            }
            .navigationTitle("Spending")
            .searchable(text: $query)
            .toolbar {
                Button {
                    adding = true
                } label: {
                    Label("Add", systemImage: "plus.circle")
                }
            }
            .sheet(isPresented: $adding) {
                AddExpenseView()
            }
        }
    }
}

struct ExpenseRow: View {
    var expense: Expense

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: expense.category.symbol)
                .font(.title3)
                .foregroundStyle(expense.category.tint)
                .frame(width: 26)

            VStack(alignment: .leading, spacing: 2) {
                Text(expense.title)
                    .font(.body)
                    .foregroundStyle(Color.primary)
                Text(expense.date, style: .date)
                    .font(.caption)
                    .foregroundStyle(Color.secondary)
            }

            Spacer()

            Money(amount: expense.amount, font: .subheadline)
        }
    }
}

/// The pushed screen, reached by tapping a row.
struct ExpenseDetail: View {
    var expense: Expense

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 10) {
                    CategoryChip(category: expense.category)
                    Money(amount: expense.amount, font: .largeTitle)
                    Text(expense.note)
                        .font(.subheadline)
                        .foregroundStyle(Color.secondary)
                }
                .card()

                LabeledContent("Recorded") {
                    Text(expense.date, style: .date)
                        .foregroundStyle(Color.secondary)
                }
                .card()

                LabeledContent("Category") {
                    Text(expense.category.rawValue)
                        .foregroundStyle(Color.secondary)
                }
                .card()
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(expense.title)
    }
}
