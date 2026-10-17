import SwiftUI

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
