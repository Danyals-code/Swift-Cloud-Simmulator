import SwiftUI

struct ProductTile: View {
    let product: Product
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: product.symbol)
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(.teal)
                .frame(maxWidth: .infinity).frame(height: 124)
                .background(Color.teal.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 18))
            Text(product.name).font(.headline)
            HStack {
                Text(product.category).foregroundStyle(.secondary)
                Spacer()
                Text("$\(product.price)")
            }.font(.subheadline)
        }
        .foregroundStyle(.primary)
    }
}
