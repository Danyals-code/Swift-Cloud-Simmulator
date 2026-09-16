import type { SourceFile } from '@studio/shared'

export const MARKET_FILES: readonly SourceFile[] = [
  { id: 'Sources/MarketApp.swift', text: String.raw`import SwiftUI

@main
struct MarketApp: App {
    var body: some Scene { WindowGroup { MarketRoot() } }
}

struct MarketRoot: View {
    @StateObject private var shop = Shop()
    var body: some View {
        TabView {
            CatalogView().tabItem { Label("Discover", systemImage: "square.grid.2x2") }
            BagView().tabItem { Label("Bag", systemImage: "bag") }
            OrdersView().tabItem { Label("Orders", systemImage: "shippingbox") }
        }.environmentObject(shop).tint(.teal)
    }
}
` },
  { id: 'Sources/Models/Shop.swift', text: String.raw`import SwiftUI

struct Product: Identifiable, Hashable {
    let id = UUID()
    let name: String
    let category: String
    let price: Int
    let symbol: String
    let description: String
}
struct BagLine: Identifiable {
    var id: UUID { product.id }
    let product: Product
    var quantity: Int
}
struct Order: Identifiable, Hashable {
    let id = UUID()
    let number: Int
    let summary: String
    let total: Int
    let recipient: String
    let delivery: String
}
final class Shop: ObservableObject {
    let products = [
        Product(name: "Everyday tote", category: "Carry", price: 38, symbol: "bag", description: "A considered daily companion. Heavy cotton canvas, a wide opening, and an inside pocket for the small things."),
        Product(name: "Studio notebook", category: "Desk", price: 18, symbol: "book.closed", description: "A place for unfinished ideas. Lay-flat binding, numbered pages, and paper made for your favorite pen."),
        Product(name: "Morning cup", category: "Home", price: 24, symbol: "cup.and.saucer", description: "Slow mornings start here. A simple ceramic cup with a comfortable handle and a soft matte finish."),
        Product(name: "Travel pouch", category: "Carry", price: 28, symbol: "suitcase", description: "Keep cables, keys, and everyday essentials together. Compact enough for any bag.")
    ]
    @Published var bag: [BagLine] = []
    @Published var orders: [Order] = []
    @Published var favorites: [UUID] = []
    var total: Int { bag.reduce(0) { $0 + $1.product.price * $1.quantity } }
    var count: Int { bag.reduce(0) { $0 + $1.quantity } }
    func add(_ product: Product, quantity: Int) {
        if let index = bag.firstIndex(where: { $0.id == product.id }) { bag[index].quantity += quantity }
        else { bag.append(BagLine(product: product, quantity: quantity)) }
    }
    func change(_ id: UUID, by amount: Int) {
        if let index = bag.firstIndex(where: { $0.id == id }) {
            bag[index].quantity += amount
            if bag[index].quantity <= 0 { bag.remove(at: index) }
        }
    }
    func favorite(_ id: UUID) {
        if let index = favorites.firstIndex(of: id) { favorites.remove(at: index) }
        else { favorites.append(id) }
    }
    func placeOrder(name: String, delivery: String) {
        let summary = bag.map { "\($0.quantity) × \($0.product.name)" }.joined(separator: ", ")
        orders.insert(Order(number: orders.count + 1001, summary: summary, total: total, recipient: name, delivery: delivery), at: 0)
        bag.removeAll()
    }
}
` },
  { id: 'Sources/Components/ProductTile.swift', text: String.raw`import SwiftUI

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
` },
  { id: 'Sources/Features/CatalogView.swift', text: String.raw`import SwiftUI

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
` },
  { id: 'Sources/Features/ProductView.swift', text: String.raw`import SwiftUI

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
` },
  { id: 'Sources/Features/BagView.swift', text: String.raw`import SwiftUI

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
` },
  { id: 'Sources/Features/CheckoutView.swift', text: String.raw`import SwiftUI

struct CheckoutView: View {
    @EnvironmentObject private var shop: Shop
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var delivery = "Standard"
    @State private var confirmed = false
    var body: some View {
        NavigationStack {
            Form {
                if confirmed {
                    Section {
                        Label("Order placed", systemImage: "checkmark.circle.fill").font(.title2).foregroundStyle(.teal)
                        Text("Your demo order is in Orders. No payment was taken.")
                        Button("Done") { dismiss() }
                    }
                } else {
                    Section("Your details") { TextField("Your name", text: $name) }
                    Section("Delivery") {
                        Picker("Delivery", selection: $delivery) {
                            Text("Standard").tag("Standard")
                            Text("Pick up").tag("Pick up")
                        }
                    }
                    Section("Summary") {
                        LabeledContent("Items", value: "\(shop.count)")
                        LabeledContent("Total", value: "$\(shop.total)")
                    }
                    Section {
                        Button("Place demo order") { shop.placeOrder(name: name, delivery: delivery); confirmed = true }
                            .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || shop.bag.isEmpty)
                    } footer: { Text("This is a local checkout example. No payment or delivery service is connected.") }
                }
            }
            .navigationTitle(confirmed ? "Thank you" : "Checkout")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }
}
` },
  { id: 'Sources/Features/OrdersView.swift', text: String.raw`import SwiftUI

struct OrdersView: View {
    @EnvironmentObject private var shop: Shop
    var body: some View {
        NavigationStack {
            List {
                if shop.orders.isEmpty {
                    Section {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Your orders live here").font(.title2).bold()
                            Text("Place a demo order from your bag to see the full flow.").foregroundStyle(.secondary)
                        }.padding(.vertical, 20)
                    }
                }
                ForEach(shop.orders) { order in
                    NavigationLink {
                        Form {
                            Section("Order \(order.number)") {
                                LabeledContent("Recipient", value: order.recipient)
                                LabeledContent("Total", value: "$\(order.total)")
                                LabeledContent("Status", value: "Confirmed")
                                LabeledContent("Delivery", value: order.delivery)
                            }
                            Section("Items") { Text(order.summary) }
                        }.navigationTitle("Order details").navigationBarTitleDisplayMode(.inline)
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack { Text("Order \(order.number)").font(.headline); Spacer(); Text("$\(order.total)") }
                            Text(order.summary).font(.subheadline).foregroundStyle(.secondary)
                        }.padding(.vertical, 6)
                    }
                }
            }.navigationTitle("Orders")
        }
    }
}
` },
]
