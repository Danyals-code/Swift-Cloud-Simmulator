import SwiftUI

@main
struct DrawingApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var progress = 0.65

    var body: some View {
        VStack(spacing: 32) {
            Text("Vectors")
                .font(.largeTitle)
                .fontWeight(.bold)

            ZStack {
                Circle()
                    .stroke(Color.secondary.opacity(0.25), lineWidth: 14)

                Path { path in
                    path.addArc(
                        center: CGPoint(x: 70, y: 70),
                        radius: 63,
                        startAngle: .degrees(-90),
                        endAngle: .degrees(270),
                        clockwise: true
                    )
                }
                .trim(from: 0, to: progress)
                .stroke(Color.accentColor, lineWidth: 14)

                Text("\(Int(progress * 100))%")
                    .font(.title2)
                    .fontWeight(.semibold)
            }
            .frame(width: 140, height: 140)

            Path { path in
                path.move(to: CGPoint(x: 0, y: 60))
                path.addLine(to: CGPoint(x: 60, y: 20))
                path.addLine(to: CGPoint(x: 120, y: 45))
                path.addLine(to: CGPoint(x: 180, y: 0))
            }
            .stroke(Color.green, lineWidth: 3)
            .frame(width: 180, height: 60)

            Slider(value: $progress, in: 0...1)
                .padding(.horizontal, 32)

            Spacer()
        }
        .padding(.top, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}