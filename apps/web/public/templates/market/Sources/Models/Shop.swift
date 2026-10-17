import SwiftUI

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
