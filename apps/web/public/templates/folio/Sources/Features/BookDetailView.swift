import SwiftUI

struct BookDetailView: View {
    @EnvironmentObject private var library: Library
    let book: Book

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Image(systemName: book.symbol)
                    .font(.system(size: 48))
                    .foregroundStyle(.indigo)
                    .frame(maxWidth: .infinity)
                    .frame(height: 160)
                    .background(Color.indigo.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 28))
                VStack(alignment: .leading, spacing: 8) {
                    Text(book.category).font(.subheadline).foregroundStyle(.indigo)
                    Text(book.title).font(.title).bold()
                    Text(book.author).foregroundStyle(.secondary)
                }
                Text(book.summary)
                Button(library.isSaved(book) ? "Remove from reading list" : "Save to reading list") {
                    library.toggleSaved(book)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .navigationTitle("Book details")
        .navigationBarTitleDisplayMode(.inline)
    }
}
