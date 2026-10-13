import SwiftUI

@main
struct TabSectionCheck: App {
    var body: some Scene { WindowGroup { ContentView() } }
}

struct ContentView: View {
    var body: some View {
        TabView {
            Tab("Home", systemImage: "house") { Text("Home page") }
            TabSection("More") {
                Tab("One", systemImage: "star") { Text("Tab one") }
                Tab("Two", systemImage: "heart") { Text("Tab two") }
            }
        }
    }
}
