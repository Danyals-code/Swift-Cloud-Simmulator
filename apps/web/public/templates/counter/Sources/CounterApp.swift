import SwiftUI

@main
struct CounterApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var count = 0
    @State private var name = "World"

    var body: some View {
        VStack(spacing: 16) {
            Text("Hello, \(name)!")
                .font(.largeTitle)
                .foregroundStyle(.primary)

            Text("Count: \(count)")
                .font(.title2)
                .foregroundStyle(count < 0 ? Color.red : Color.primary)

            HStack(spacing: 12) {
                Button("Minus") {
                    count -= 1
                }
                .padding()
                .background(Color.red.opacity(0.15))

                Spacer()

                Button("Plus") {
                    count += 1
                }
                .padding()
                .background(Color.green.opacity(0.15))
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
        }
        .padding()
        .background(Color(.systemGroupedBackground))
    }
}
