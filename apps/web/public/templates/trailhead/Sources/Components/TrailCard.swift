import SwiftUI

/// A ViewModifier plus the extension below: a look named once and applied in five places.
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

/// A button that presses in, applied to every button inside the detail screen.
struct PressableButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.vertical, 10)
            .padding(.horizontal, 18)
            .background(Color.accentColor)
            .foregroundStyle(Color.white)
            .clipShape(.rect(cornerRadius: 10))
            .opacity(configuration.isPressed ? 0.7 : 1.0)
    }
}

/// The difficulty pill, used on the card and again on the detail screen.
struct DifficultyBadge: View {
    var difficulty = Difficulty.easy

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: difficulty.symbol)
                .font(.caption2)
            Text(difficulty.rawValue)
                .font(.caption2)
        }
        .padding(.vertical, 3)
        .padding(.horizontal, 8)
        .background(difficulty.tint.opacity(0.18))
        .foregroundStyle(difficulty.tint)
        .clipShape(.rect(cornerRadius: 8))
    }
}

/// One trail, as it appears in the Discover grid.
struct TrailCard: View {
    var trail: Trail

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: trail.symbol)
                    .font(.title2)
                    .foregroundStyle(trail.difficulty.tint)
                Spacer()
                DifficultyBadge(difficulty: trail.difficulty)
            }

            Text(trail.name)
                .font(.headline)
                .foregroundStyle(Color.primary)

            Text(trail.region)
                .font(.caption)
                .foregroundStyle(Color.secondary)

            HStack(spacing: 10) {
                Text(trail.distance)
                    .font(.caption)
                    .foregroundStyle(Color.secondary)
                Text(trail.climb)
                    .font(.caption)
                    .foregroundStyle(Color.secondary)
            }
        }
        .card()
    }
}
