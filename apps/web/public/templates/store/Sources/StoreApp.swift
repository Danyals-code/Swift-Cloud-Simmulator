import SwiftUI

@main
struct StoreApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

class Basket: ObservableObject {
    @Published var items: [String] = []

    var total: Int {
        return items.count
    }

    func add(_ item: String) {
        items.append(item)
    }

    func clear() {
        items = []
    }
}

struct ContentView: View {
    @StateObject private var basket = Basket()
    let menu = ["Espresso", "Cortado", "Flat white"]

    var body: some View {
        NavigationStack {
            List {
                Section("Menu") {
                    ForEach(menu, id: \.self) { item in
                        Button(item) {
                            basket.add(item)
                        }
                    }
                }

                Section("Basket") {
                    BasketSummary(basket: basket)
                    Button("Clear") {
                        basket.clear()
                    }
                    .foregroundStyle(Color.red)
                }
            }
            .navigationTitle("Order")
        }
    }
}

struct BasketSummary: View {
    @ObservedObject var basket: Basket

    var body: some View {
        HStack {
            Text(basket.total == 0 ? "Nothing yet" : "\(basket.total) item(s)")
            Spacer()
            Text(basket.items.last ?? "-")
                .foregroundStyle(Color.secondary)
        }
    }
}