import SwiftUI

@main
struct TrailheadApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

/// The one place the store is created; every screen below reads it from the environment.
struct RootView: View {
    @StateObject private var store = TrailStore()

    var body: some View {
        MainTabs()
            .environmentObject(store)
    }
}

/// Split out so the injection above has somewhere to land: it needs an unbuilt body.
struct MainTabs: View {
    var body: some View {
        TabView {
            DiscoverView()
                .tabItem {
                    Label("Discover", systemImage: "map")
                }

            SavedView()
                .tabItem {
                    Label("Saved", systemImage: "bookmark")
                }

            ProfileView()
                .tabItem {
                    Label("Profile", systemImage: "person.circle")
                }
        }
    }
}
