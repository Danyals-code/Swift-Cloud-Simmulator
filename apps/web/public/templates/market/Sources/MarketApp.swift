import SwiftUI

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
