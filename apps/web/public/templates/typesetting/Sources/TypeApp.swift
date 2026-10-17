import SwiftUI

@main
struct TypeApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var loading = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("\(Text("Type").font(.largeTitle).fontWeight(.bold))\(Text(" setting").font(.largeTitle).foregroundStyle(Color.accentColor))")

                Text("Two halves of one line, each with a face of its own.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 10) {
                    Text("Underlined, for a link that is not one")
                        .underline()

                    Text("Struck through, for a price that was")
                        .strikethrough()

                    Text("W I D E")
                        .tracking(6)
                        .font(.headline)

                    Text("A paragraph set with extra leading, so the lines breathe a little further apart than the face asks for on its own.")
                        .lineSpacing(7)

                    Text("A single line that will not fit, shortened in the middle rather than at its end")
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .foregroundStyle(.secondary)

                    Text("Shrunk to fit rather than cut")
                        .font(.title2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .frame(width: 180)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Placeholder while it loads")
                        .font(.headline)
                    Text("This paragraph is redacted, which draws the shape of the content without the content itself.")
                        .foregroundStyle(.secondary)
                }
                .redacted(reason: loading ? .placeholder : [])

                Button {
                    loading.toggle()
                } label: {
                    Label(loading ? "Reveal" : "Redact", systemImage: "eye")
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .safeAreaInset(edge: .bottom) {
            Text("Everything above is measured, not guessed.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(12)
                .frame(maxWidth: .infinity)
                .background(Color(.secondarySystemGroupedBackground))
        }
    }
}