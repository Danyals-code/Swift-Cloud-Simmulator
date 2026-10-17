import SwiftUI

@main
struct GalleryApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    let columns = [GridItem(.adaptive(minimum: 100))]
    let symbols = [
        "sun.max", "moon", "cloud", "bolt",
        "leaf", "drop", "flame", "sparkles"
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(symbols, id: \.self) { symbol in
                        VStack(spacing: 8) {
                            Image(systemName: symbol)
                                .font(.title)
                            Text(symbol)
                                .font(.caption)
                                .foregroundStyle(Color.secondary)
                        }
                        .padding(.vertical, 16)
                        .frame(maxWidth: .infinity)
                        .background(Color(.secondarySystemGroupedBackground))
                        .clipShape(.rect(cornerRadius: 12))
                    }
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Gallery")
        }
    }
}