import SwiftUI

@main
struct PulseApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct RootView: View {
    @StateObject private var log = TrainingLog()

    var body: some View {
        MainTabs()
            .environmentObject(log)
    }
}

struct MainTabs: View {
    var body: some View {
        TabView {
            TodayView()
                .tabItem {
                    Label("Today", systemImage: "bolt.fill")
                }

            HistoryView()
                .tabItem {
                    Label("History", systemImage: "list.bullet")
                }
        }
    }
}
