import SwiftUI

@main
struct StyledApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

/// A modifier written as a struct. Its body receives the view it is applied to,
/// so content below is an ordinary view carrying ordinary modifiers.
struct Card: ViewModifier {
    var tint: Color

    func body(content: Content) -> some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tint.opacity(0.15))
            .clipShape(.rect(cornerRadius: 14))
    }
}

/// The idiom every real codebase uses to name a modifier chain.
extension View {
    func card(_ tint: Color) -> some View {
        modifier(Card(tint: tint))
    }

    func sectionTitle() -> some View {
        font(.caption)
            .textCase(.uppercase)
            .foregroundStyle(.secondary)
    }
}

struct ContentView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Today")
                .sectionTitle()

            VStack(alignment: .leading, spacing: 6) {
                Text("Write the tests first")
                    .font(.headline)
                Text("Then the code has somewhere to be wrong.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .card(.blue)

            VStack(alignment: .leading, spacing: 6) {
                Text("Name the limitation")
                    .font(.headline)
                Text("A partial feature with nothing said is a bug.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .card(.orange)

            Spacer()
        }
        .padding(20)
    }
}