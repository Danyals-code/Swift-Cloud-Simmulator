import SwiftUI

@main
struct TabsApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var selected = 0

    var body: some View {
        TabView(selection: $selected) {
            NavigationStack {
                List {
                    Section("A little inspiration") {
                        Label("Take a walk outside", systemImage: "leaf")
                        Label("Read a few pages", systemImage: "book")
                        Label("Make something new", systemImage: "pencil")
                    }
                    Section {
                        Button("Browse the library") { selected = 1 }
                    }
                }
                .navigationTitle("Today")
            }
            .tabItem { Label("Today", systemImage: "sun.max") }
            .tag(0)

            NavigationStack {
                List {
                    Section("Collections") {
                        Label("Weekend ideas", systemImage: "bookmark")
                        Label("Things to learn", systemImage: "book")
                        Label("Favorite places", systemImage: "map")
                    }
                }
                .navigationTitle("Library")
            }
            .tabItem { Label("Library", systemImage: "folder") }
            .tag(1)

            NavigationStack {
                Form {
                    Section("About you") {
                        LabeledContent("Name", value: "Ada Lovelace")
                        LabeledContent("Member since", value: "2026")
                    }
                }
                .navigationTitle("Profile")
            }
            .tabItem { Label("Profile", systemImage: "person.circle") }
            .tag(2)
        }
        .tint(.indigo)
    }
}