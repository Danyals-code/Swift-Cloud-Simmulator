import SwiftUI

@main
struct PaletteApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var selected = 0

    var body: some View {
        VStack(spacing: 16) {
            Text("Palette")
                .font(.largeTitle)

            Text("Swatch \(selected + 1) selected")
                .font(.footnote)
                .foregroundStyle(.secondary)

            VStack(spacing: 10) {
                ForEach(0..<3, id: \.self) { row in
                    HStack(spacing: 10) {
                        ForEach(0..<3, id: \.self) { column in
                            swatch(row * 3 + column)
                        }
                    }
                }
            }

            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    func swatch(_ index: Int) -> some View {
        Button("") {
            selected = index
        }
        .frame(width: 72, height: 72)
        .background(tint(index))
        .clipShape(.rect(cornerRadius: 12))
        .accessibilityLabel("Swatch \(index + 1)")
    }

    func tint(_ index: Int) -> Color {
        if index % 3 == 0 { return Color.pink }
        if index % 3 == 1 { return Color.purple }
        return Color.indigo
    }
}
