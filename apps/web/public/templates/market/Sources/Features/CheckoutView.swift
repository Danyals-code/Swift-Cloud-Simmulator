import SwiftUI

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
