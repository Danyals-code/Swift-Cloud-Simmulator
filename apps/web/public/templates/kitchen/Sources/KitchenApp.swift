import SwiftUI

@main
struct KitchenApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

/// One stack, no tab bar. The shelf is created here so every screen reads one.
struct RootView: View {
    @StateObject private var shelf = Shelf()

    var body: some View {
        BrowseView()
            .environmentObject(shelf)
    }
}
