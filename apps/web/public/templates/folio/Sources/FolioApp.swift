import SwiftUI

@main
struct FolioApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @StateObject private var library = Library()

    var body: some View {
        MainTabs()
            .environmentObject(library)
            .tint(.indigo)
    }
}

struct MainTabs: View {
    var body: some View {
        TabView {
            LibraryView(savedOnly: false)
                .tabItem { Label("Library", systemImage: "books.vertical") }
            LibraryView(savedOnly: true)
                .tabItem { Label("Reading list", systemImage: "bookmark") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}
