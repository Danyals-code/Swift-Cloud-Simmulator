import SwiftUI

@main
struct DragApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var position = CGSize.zero
    @GestureState private var active = CGSize.zero

    var body: some View {
        VStack(spacing: 24) {
            Text("Drag the card")
                .font(.headline)
                .foregroundStyle(Color.secondary)

            RoundedRectangle(cornerRadius: 20)
                .fill(Color.accentColor)
                .frame(width: 160, height: 110)
                .offset(
                    x: position.width + active.width,
                    y: position.height + active.height
                )
                .shadow(radius: 12, y: 6)
                .gesture(
                    DragGesture()
                        .updating($active) { value, state, transaction in
                            state = value.translation
                        }
                        .onEnded { value in
                            position = value.translation
                        }
                )

            Button("Reset") {
                withAnimation(.spring()) {
                    position = CGSize.zero
                }
            }
            .buttonStyle(.bordered)

            Spacer()
        }
        .padding(.top, 48)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }
}