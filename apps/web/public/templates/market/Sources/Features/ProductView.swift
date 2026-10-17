import SwiftUI

struct ProductView: View {
    @EnvironmentObject private var shop: Shop
    let product: Product
    @State private var quantity = 1
    @State private var added = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Image(systemName: product.symbol).font(.system(size: 90, weight: .light))
                    .foregroundStyle(.teal).frame(maxWidth: .infinity).frame(height: 220)
                    .background(Color.teal.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 24))
                VStack(alignment: .leading, spacing: 8) {
                    Text(product.category).font(.subheadline).foregroundStyle(.secondary)
                    HStack { Text(product.name).font(.title).bold(); Spacer(); Text("$\(product.price)").font(.title2) }
                    Text(product.description).foregroundStyle(.secondary).padding(.top, 6)
                }
                Stepper("Quantity: \(quantity)", value: $quantity, in: 1...10)
                Button {
                    shop.add(product, quantity: quantity)
                    added = true
                } label: {
                    Text("Add to bag · $\(product.price * quantity)").frame(maxWidth: .infinity)
                }.buttonStyle(.borderedProminent).controlSize(.large)
                if added { Label("Added to your bag", systemImage: "checkmark.circle").foregroundStyle(.teal) }
            }.padding(20)
        }
        .navigationTitle("Product")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Button { shop.favorite(product.id) } label: {
                Image(systemName: shop.favorites.contains(product.id) ? "heart.fill" : "heart")
            }.accessibilityLabel("Save product")
        }
    }
}
