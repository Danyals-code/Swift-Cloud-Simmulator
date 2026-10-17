import SwiftUI

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

/// The selection a `TabView` is bound to has to be some `Hashable` value, and a
/// plain enum is the one that cannot be spelled wrong.
enum Tab {
    case summary
    case spending
    case budget
}
