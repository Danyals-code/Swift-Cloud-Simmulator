import SwiftUI

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

struct Stars: View {
    var rating = 0

    var body: some View {
        HStack(spacing: 2) {
            ForEach(1...5, id: \.self) { position in
                Image(systemName: position <= rating ? "star.fill" : "circle.fill")
                    .font(.caption2)
                    .foregroundStyle(position <= rating ? Color.yellow : Color.secondary.opacity(0.3))
            }
        }
    }
}

struct CourseChip: View {
    var course = Course.dinner

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: course.symbol)
                .font(.caption2)
            Text(course.rawValue)
                .font(.caption2)
        }
        .fixedSize()
        .padding(.vertical, 3)
        .padding(.horizontal, 8)
        .background(course.tint.opacity(0.18))
        .foregroundStyle(course.tint)
        .clipShape(.rect(cornerRadius: 8))
    }
}

struct RecipeCard: View {
    var recipe: Recipe
    var saved = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                CourseChip(course: recipe.course)
                Spacer()
                if saved {
                    Image(systemName: "bookmark.fill")
                        .font(.caption)
                        .foregroundStyle(Color.accentColor)
                }
            }

            Text(recipe.title)
                .font(.headline)
                .foregroundStyle(Color.primary)
                .multilineTextAlignment(.leading)

            Text(recipe.cook)
                .font(.caption)
                .foregroundStyle(Color.secondary)

            HStack(spacing: 8) {
                Stars(rating: recipe.rating)
                Spacer()
                Text(recipe.time)
                    .font(.caption)
                    .foregroundStyle(Color.secondary)
            }
        }
        .card()
    }
}
