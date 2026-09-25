import type { SourceFile } from '@studio/shared'

/**
 * Ledger - the money app.
 *
 * Trailhead shows a project that browses things. This one shows a project that
 * *adds* them, which is a different set of problems and the one most apps actually
 * have: a form that validates, a sheet that dismisses itself, a row that can be
 * swiped away, and three tabs that all have to agree about a number the moment any
 * one of them changes it.
 *
 * It is also where the gallery keeps its worked example of `$store.property` -
 * `Slider(value: $ledger.monthlyBudget)` - which is how a control writes into a
 * shared model without mirroring the value into a `@State` first.
 *
 * Same gate as every other template (`tests/templates.test.ts`): zero diagnostics of
 * any severity, zero unsupported placeholders, a palette that genuinely changes in
 * dark mode, and the whole pipeline under 120 ms (`tests/template-budgets.test.ts`).
 */

const APP = `import SwiftUI

@main
struct LedgerApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

/// The one place the ledger is created. Every screen below reads it from the
/// environment, so an expense added on one tab is a number that moved on another.
struct RootView: View {
    @StateObject private var ledger = Ledger()

    var body: some View {
        MainTabs()
            .environmentObject(ledger)
    }
}

/// Split out so the injection above has an unbuilt body to land in.
struct MainTabs: View {
    @State private var tab = Tab.summary

    var body: some View {
        TabView(selection: $tab) {
            SummaryView()
                .tabItem {
                    Label("Summary", systemImage: "chart.bar")
                }
                .tag(Tab.summary)

            SpendingView()
                .tabItem {
                    Label("Spending", systemImage: "list.bullet")
                }
                .tag(Tab.spending)

            BudgetView()
                .tabItem {
                    Label("Budget", systemImage: "slider.horizontal.3")
                }
                .tag(Tab.budget)
        }
    }
}

/// The selection a \`TabView\` is bound to has to be some \`Hashable\` value, and a
/// plain enum is the one that cannot be spelled wrong.
enum Tab {
    case summary
    case spending
    case budget
}
`

const EXPENSE = `import SwiftUI

/// Where the money went.
///
/// The colour and the symbol are decided here rather than at each of the four
/// places that draw a category, which is the whole reason this is an enum with
/// properties and not a \`String\`.
enum Category: String, CaseIterable, Identifiable {
    case food = "Food"
    case transport = "Transport"
    case home = "Home"
    case fun = "Fun"

    var id: String {
        return rawValue
    }

    var tint: Color {
        switch self {
        case .food:
            return Color.orange
        case .transport:
            return Color.blue
        case .home:
            return Color.teal
        case .fun:
            return Color.pink
        }
    }

    var symbol: String {
        switch self {
        case .food:
            return "cart.fill"
        case .transport:
            return "arrow.up.arrow.down"
        case .home:
            return "house.fill"
        case .fun:
            return "music.note"
        }
    }
}

/// \`Hashable\` as well as \`Identifiable\`: the id is what \`ForEach\` follows, and the
/// whole value is what \`NavigationLink(value:)\` pushes.
struct Expense: Identifiable, Hashable {
    let id = UUID()
    var title: String
    var amount: Double
    var category: Category
    var date: Date

    var note: String {
        return "\\(category.rawValue) · \\(title)"
    }
}
`

const LEDGER = `import SwiftUI

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
`

const CHROME = `import SwiftUI

/// A look named once and used in seven places: the modifier, plus the extension
/// that lets it be written as \`.card()\` rather than \`.modifier(CardStyle())\`.
struct CardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground))
            .clipShape(.rect(cornerRadius: 14))
    }
}

extension View {
    func card() -> some View {
        return self.modifier(CardStyle())
    }
}

/// Money, formatted by \`Text\` rather than by hand: \`format:\` knows where the
/// separators go and a string built with \`+\` does not.
struct Money: View {
    var amount = 0.0
    var font = Font.body

    var body: some View {
        Text(amount, format: .currency(code: "USD"))
            .font(font)
            .monospacedDigit()
            .foregroundStyle(Color.primary)
    }
}

/// The category pill, on the row and again on the detail screen.
struct CategoryChip: View {
    var category = Category.food

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: category.symbol)
                .font(.caption2)
            Text(category.rawValue)
                .font(.caption2)
        }
        .fixedSize()
        .padding(.vertical, 3)
        .padding(.horizontal, 8)
        .background(category.tint.opacity(0.18))
        .foregroundStyle(category.tint)
        .clipShape(.rect(cornerRadius: 8))
    }
}

/// One bar of the breakdown: a fixed track with a capsule drawn to a fraction of it.
struct BarRow: View {
    var category = Category.food
    var amount = 0.0
    var fraction = 0.0

    let track = 116.0

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: category.symbol)
                .font(.caption)
                .foregroundStyle(category.tint)
                .frame(width: 18)

            Text(category.rawValue)
                .font(.caption)
                .foregroundStyle(Color.secondary)
                .frame(width: 62, alignment: .leading)

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.primary.opacity(0.08))
                    .frame(width: track, height: 9)
                Capsule()
                    .fill(category.tint)
                    .frame(width: max(4.0, track * fraction), height: 9)
            }

            Spacer()

            Money(amount: amount, font: .caption)
                .fixedSize()
        }
    }
}
`

const SUMMARY = `import SwiftUI

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

            Text("\\(Int(used * 100))% of the budget")
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
`

const SPENDING = `import SwiftUI

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
                    Text("\\(results.count) of \\(ledger.expenses.count)")
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
`

const ADD = `import SwiftUI

/// The sheet: a form, and \`dismiss\` rather than a binding threaded down two levels.
struct AddExpenseView: View {
    @EnvironmentObject var ledger: Ledger
    @Environment(\\.dismiss) private var dismiss

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
`

const BUDGET = `import SwiftUI

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
`

export const LEDGER_FILES: readonly SourceFile[] = [
  { id: 'Sources/LedgerApp.swift', text: APP },
  { id: 'Sources/Models/Expense.swift', text: EXPENSE },
  { id: 'Sources/Models/Ledger.swift', text: LEDGER },
  { id: 'Sources/Components/Chrome.swift', text: CHROME },
  { id: 'Sources/Features/Summary/SummaryView.swift', text: SUMMARY },
  { id: 'Sources/Features/Spending/SpendingView.swift', text: SPENDING },
  { id: 'Sources/Features/Spending/AddExpenseView.swift', text: ADD },
  { id: 'Sources/Features/Budget/BudgetView.swift', text: BUDGET },
]
