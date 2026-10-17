import SwiftUI

@main
struct MotionApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var expanded = false

    var body: some View {
        VStack(spacing: 24) {
            Text(expanded ? "Expanded" : "Collapsed")
                .font(.title2)
                .fontWeight(.semibold)

            RoundedRectangle(cornerRadius: expanded ? 32 : 12)
                .foregroundStyle(Color.accentColor)
                .frame(width: expanded ? 260 : 120, height: expanded ? 160 : 120)
                .shadow(radius: expanded ? 24 : 6, y: 8)

            Button(expanded ? "Collapse" : "Expand") {
                withAnimation(.spring()) {
                    expanded = !expanded
                }
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }
}