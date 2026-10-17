import SwiftUI

struct CatalogView: View {
    @EnvironmentObject private var shop: Shop
    @State private var query = ""
    @State private var category = "All"
    @State private var savedOnly = false
    private var results: [Product] {
        shop.products.filter { product in
            (category == "All" || product.category == category)
                && (!savedOnly || shop.favorites.contains(product.id))
                && (query.isEmpty || product.name.lowercased().contains(query.lowercased()))
        }
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Fewer things.\nBetter everyday.").font(.largeTitle).bold()
                        Text("Useful objects, thoughtfully chosen.").foregroundStyle(.secondary)
                    }.padding(.top, 8)
                    Picker("Category", selection: $category) {
                        Text("All").tag("All")
                        Text("Carry").tag("Carry")
                        Text("Desk").tag("Desk")
                        Text("Home").tag("Home")
                    }.pickerStyle(.segmented)
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 24) {
                        ForEach(results) { product in
                            NavigationLink { ProductView(product: product) } label: { ProductTile(product: product) }
                        }
                    }
                    if results.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Nothing here yet").font(.headline)
                            Text("Try another search or save a product with the heart button.").foregroundStyle(.secondary)
                        }.padding(.vertical, 24)
                    }
                }.padding(20)
            }
            .navigationTitle("Market")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Find something useful")
            .toolbar { Button(savedOnly ? "Show all" : "Saved") { savedOnly.toggle() } }
        }
    }
}
