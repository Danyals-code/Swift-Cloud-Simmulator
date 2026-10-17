import SwiftUI

@main
struct CardApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var following = false

    var body: some View {
        VStack {
            Spacer()

            VStack(spacing: 12) {
                Image(systemName: "person.circle.fill")
                    .font(.system(size: 72))
                    .foregroundStyle(.teal)

                Text("Ada Lovelace")
                    .font(.title2)

                Text("Mathematician")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Button(following ? "Following" : "Follow") {
                    following = !following
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .tint(following ? Color.gray : Color.teal)
            }
            .padding(24)
            .background(Color(.secondarySystemGroupedBackground))
            .clipShape(.rect(cornerRadius: 28))

            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }
}
