import SwiftUI

/// A look named once and used in seven places: the modifier, plus the extension
/// that lets it be written as `.card()` rather than `.modifier(CardStyle())`.
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

/// Money, formatted by `Text` rather than by hand: `format:` knows where the
/// separators go and a string built with `+` does not.
struct Money: View {
    var amount = 0.0
    var font = Font.body

    var body: some View {
        Text(amount, format: .currency(code: "USD"))
            .font(font)
            .monospacedDigit()
            .foregroundStyle(Color.primary)
    }
}

/// The category pill, on the row and again on the detail screen.
struct CategoryChip: View {
    var category = Category.food

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: category.symbol)
                .font(.caption2)
            Text(category.rawValue)
                .font(.caption2)
        }
        .fixedSize()
        .padding(.vertical, 3)
        .padding(.horizontal, 8)
        .background(category.tint.opacity(0.18))
        .foregroundStyle(category.tint)
        .clipShape(.rect(cornerRadius: 8))
    }
}

/// One bar of the breakdown: a fixed track with a capsule drawn to a fraction of it.
struct BarRow: View {
    var category = Category.food
    var amount = 0.0
    var fraction = 0.0

    let track = 116.0

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: category.symbol)
                .font(.caption)
                .foregroundStyle(category.tint)
                .frame(width: 18)

            Text(category.rawValue)
                .font(.caption)
                .foregroundStyle(Color.secondary)
                .frame(width: 62, alignment: .leading)

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.primary.opacity(0.08))
                    .frame(width: track, height: 9)
                Capsule()
                    .fill(category.tint)
                    .frame(width: max(4.0, track * fraction), height: 9)
            }

            Spacer()

            Money(amount: amount, font: .caption)
                .fixedSize()
        }
    }
}
