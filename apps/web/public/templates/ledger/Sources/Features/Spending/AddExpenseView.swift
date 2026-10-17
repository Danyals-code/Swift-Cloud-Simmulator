import SwiftUI

/// The sheet: a form, and `dismiss` rather than a binding threaded down two levels.
struct AddExpenseView: View {
    @EnvironmentObject var ledger: Ledger
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var amount = 20.0
    @State private var category = Category.food
    @State private var date = Date()

    var canSave: Bool {
        return !title.isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("What") {
                    TextField("Description", text: $title)

                    Picker("Category", selection: $category) {
                        ForEach(Category.allCases) { option in
                            Text(option.rawValue)
                                .tag(option)
                        }
                    }
                }

                Section("How much") {
                    HStack {
                        Text("Amount")
                            .foregroundStyle(Color.primary)
                        Spacer()
                        Money(amount: amount)
                    }
                    Slider(value: $amount, in: 1...250)
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                }

                Section {
                    Button("Save") {
                        ledger.add(
                            Expense(title: title, amount: amount, category: category, date: date)
                        )
                        dismiss()
                    }
                    .disabled(!canSave)

                    Button("Cancel") {
                        dismiss()
                    }
                    .foregroundStyle(Color.red)
                } footer: {
                    Text("Nothing here leaves the device.")
                }
            }
            .navigationTitle("New expense")
        }
    }
}
