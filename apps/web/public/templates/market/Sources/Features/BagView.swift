import SwiftUI

struct BagView: View {
    @EnvironmentObject private var shop: Shop
    @State private var checkout = false
    var body: some View {
        NavigationStack {
            List {
                if shop.bag.isEmpty {
                    Section {
                        VStack(alignment: .leading, spacing: 12) {
                            Image(systemName: "bag").font(.largeTitle).foregroundStyle(.teal)
                            Text("Your bag is empty").font(.title2).bold()
                            Text("Explore Discover and add something you like.").foregroundStyle(.secondary)
                        }.padding(.vertical, 24)
                    }
                } else {
                    Section("Your items") {
                        ForEach(shop.bag) { line in
                            VStack(alignment: .leading, spacing: 12) {
                                HStack { Text(line.product.name).font(.headline); Spacer(); Text("$\(line.product.price * line.quantity)") }
                                HStack {
                                    Button { shop.change(line.id, by: -1) } label: { Image(systemName: "minus.circle") }.accessibilityLabel("Remove one " + line.product.name)
                                    Text("\(line.quantity)").frame(width: 30)
                                    Button { shop.change(line.id, by: 1) } label: { Image(systemName: "plus.circle") }.accessibilityLabel("Add one " + line.product.name)
                                    Spacer()
                                    Text("$\(line.product.price) each").font(.caption).foregroundStyle(.secondary)
                                }.buttonStyle(.borderless)
                            }.padding(.vertical, 8)
                        }
                    }
                    Section {
                        LabeledContent("Items", value: "\(shop.count)")
                        LabeledContent("Total", value: "$\(shop.total)")
                        Button("Continue to checkout") { checkout = true }
                    }
                }
            }.navigationTitle("Your bag")
                .sheet(isPresented: $checkout) { CheckoutView() }
        }
    }
}
