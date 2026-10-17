import SwiftUI

struct BookRow: View {
    let book: Book

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: book.symbol)
                .font(.title2)
                .foregroundStyle(.indigo)
                .frame(width: 44, height: 56)
                .background(Color.indigo.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 4) {
                Text(book.title).font(.headline)
                Text(book.author).font(.subheadline).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 2)
    }
}
