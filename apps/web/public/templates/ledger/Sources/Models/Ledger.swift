import SwiftUI

/// One instance, reached from all three tabs.
final class Ledger: ObservableObject {
    @Published var expenses = [
        Expense(title: "Market", amount: 48.20, category: .food, date: Date()),
        Expense(title: "Train pass", amount: 96.00, category: .transport, date: Date()),
        Expense(title: "Electricity", amount: 71.35, category: .home, date: Date()),
        Expense(title: "Cinema", amount: 24.00, category: .fun, date: Date()),
        Expense(title: "Coffee beans", amount: 17.90, category: .food, date: Date()),
        Expense(title: "Bike service", amount: 62.50, category: .transport, date: Date()),
        Expense(title: "Records", amount: 33.00, category: .fun, date: Date())
    ]

    @Published var monthlyBudget = 420.0

    var spent: Double {
        return expenses.reduce(0.0) { running, expense in
            return running + expense.amount
        }
    }

    var remaining: Double {
        return max(0.0, monthlyBudget - spent)
    }

    /// Clamped, because a bar drawn past 1.0 is a bar drawn outside its track.
    var used: Double {
        return min(1.0, spent / monthlyBudget)
    }

    func spent(on category: Category) -> Double {
        return expenses.filter { expense in
            return expense.category == category
        }
        .reduce(0.0) { running, expense in
            return running + expense.amount
        }
    }

    /// The biggest category total, which is what every bar is drawn relative to.
    var heaviest: Double {
        var top = 0.01
        for category in Category.allCases {
            top = max(top, spent(on: category))
        }
        return top
    }

    /// The filter belongs to the screen doing the looking, not to the model.
    func results(matching query: String) -> [Expense] {
        let needle = query.lowercased()
        return expenses.filter { expense in
            return needle.isEmpty || expense.title.lowercased().contains(needle)
        }
    }

    func add(_ expense: Expense) {
        expenses.insert(expense, at: 0)
    }
}
