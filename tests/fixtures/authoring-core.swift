import SwiftUI

enum StudioStyle {
    static let spacing: CGFloat = 12
    static let accent = Color.blue
}

@main struct AuthoringReferenceApp: App {
    var body: some Scene { WindowGroup { CatalogScreen() } }
}

struct ProductRow: View {
    let title: String
    let price: Double
    var body: some View {
        HStack(spacing: StudioStyle.spacing) {
            Text(title)
            Spacer()
            Text(price.formatted())
        }
        .padding(8)
    }
}

struct CatalogScreen: View {
    @State private var count = 0
    @State private var favorite = false
    @State private var search = ""
    var body: some View {
        VStack(spacing: StudioStyle.spacing) {
            Text("Catalog").font(.title).foregroundColor(StudioStyle.accent)
            Text("Count \(count)").accessibilityIdentifier("count")
            Button("Increment") { count += 1 }
                .accessibilityIdentifier("increment")
            Toggle("Favorite", isOn: $favorite)
            TextField("Search", text: $search)
            if count == 0 { Text("Ready") } else { Text("Updated") }
            ForEach(0..<3, id: \.self) { index in
                ProductRow(title: "Product \(index)", price: 12.5)
            }
            Text("Inside").padding(8).background(Color.blue)
            Text("Outside").background(Color.blue).padding(8)
        }
        .padding(16)
    }
}
