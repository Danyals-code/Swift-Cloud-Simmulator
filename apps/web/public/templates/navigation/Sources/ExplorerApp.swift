import SwiftUI

@main
struct ExplorerApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct Destination: Identifiable {
    let id = UUID()
    let name: String
    let region: String
    let symbol: String
}

struct ContentView: View {
    @State private var query = ""
    let destinations = [
        Destination(name: "Kyoto", region: "Kansai", symbol: "leaf"),
        Destination(name: "Reykjavik", region: "Capital Region", symbol: "snowflake"),
        Destination(name: "Lisbon", region: "Estremadura", symbol: "sun.max")
    ]

    var body: some View {
        NavigationStack {
            List {
                Section("Destinations") {
                    ForEach(destinations.filter { query.isEmpty || $0.name.lowercased().contains(query.lowercased()) }) { destination in
                        NavigationLink {
                            DetailView(destination: destination)
                        } label: {
                            Label(destination.name, systemImage: destination.symbol)
                        }
                    }
                }
            }
            .navigationTitle("Explore")
            .searchable(text: $query, prompt: "Find a destination")
        }
    }
}

struct DetailView: View {
    let destination: Destination

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: destination.symbol)
                .font(.largeTitle)
                .foregroundStyle(Color.accentColor)

            Text(destination.name)
                .font(.largeTitle)
                .fontWeight(.bold)

            Text(destination.region)
                .font(.headline)
                .foregroundStyle(Color.secondary)

            Spacer()
        }
        .padding()
        .navigationTitle(destination.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}