import SwiftUI

/// A progress ring drawn rather than assembled.
///
/// `GeometryReader` is what makes it square at whatever size it is given: the arc
/// needs a radius in points, and the only place that number exists is here.
struct Ring: View {
    var progress = 0.0
    var tint = Color.accentColor
    var thickness = 14.0

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Circle()
                    .stroke(tint.opacity(0.18), lineWidth: thickness)

                Path { path in
                    path.addArc(
                        center: CGPoint(x: geo.size.width / 2, y: geo.size.height / 2),
                        radius: (min(geo.size.width, geo.size.height) - thickness) / 2,
                        startAngle: .degrees(-90),
                        endAngle: .degrees(270),
                        clockwise: true
                    )
                }
                .trim(from: 0, to: progress)
                .stroke(tint, lineWidth: thickness)
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

/// One bar of the week. The height is a fraction of the busiest day, so the tallest
/// bar is always full and the shape of the week is readable at any volume.
struct DayBar: View {
    var day = ""
    var minutes = 0
    var fraction = 0.0
    var tint = Color.accentColor

    var body: some View {
        VStack(spacing: 6) {
            Text("\(minutes)")
                .font(.caption2)
                .monospacedDigit()
                .foregroundStyle(Color.secondary)

            ZStack(alignment: .bottom) {
                RoundedRectangle(cornerRadius: 5)
                    .fill(Color.primary.opacity(0.07))
                    .frame(width: 22, height: 96)
                RoundedRectangle(cornerRadius: 5)
                    .fill(tint)
                    .frame(width: 22, height: max(4.0, 96.0 * fraction))
            }

            Text(day)
                .font(.caption2)
                .foregroundStyle(Color.secondary)
        }
    }
}

struct CardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground))
            .clipShape(.rect(cornerRadius: 14))
    }
}

extension View {
    func card() -> some View {
        return self.modifier(CardStyle())
    }
}
