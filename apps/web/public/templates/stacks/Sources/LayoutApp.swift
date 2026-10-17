import SwiftUI

@main
struct LayoutApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Layout")
                .font(.largeTitle)

            HStack(spacing: 8) {
                Swatch(label: "One", tint: Color.blue)
                Swatch(label: "Two", tint: Color.green)
                Swatch(label: "Three", tint: Color.orange)
            }

            ZStack {
                Rectangle()
                    .foregroundStyle(Color.indigo)
                    .frame(width: 200, height: 80)
                Text("ZStack")
                    .font(.headline)
                    .foregroundStyle(Color.white)
            }

            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct Swatch: View {
    var label = ""
    var tint = Color.gray

    var body: some View {
        Text(label)
            .font(.footnote)
            .foregroundStyle(Color.white)
            .padding()
            .background(tint)
            .clipShape(.rect(cornerRadius: 8))
    }
}
