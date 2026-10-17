import SwiftUI

struct LibraryView: View {
    @EnvironmentObject private var library: Library
    @State private var query = ""
    @State private var adding = false
    let savedOnly: Bool

    private var results: [Book] {
        return library.books.filter { book in
            let matches = query.isEmpty
                || book.title.lowercased().contains(query.lowercased())
                || book.author.lowercased().contains(query.lowercased())
            return matches && (!savedOnly || library.isSaved(book))
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section(savedOnly ? "Up next" : "On the shelf") {
                    ForEach(results) { book in
                        NavigationLink(value: book) { BookRow(book: book) }
                    }
                }
                if results.isEmpty {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Image(systemName: "bookmark").font(.title).foregroundStyle(.indigo)
                            Text(query.isEmpty ? "Make room for a good book" : "No matching books").font(.headline)
                            Text(query.isEmpty ? "Open a book in Library and tap Save to reading list." : "Try another title or author.")
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 12)
                    }
                }
            }
            .navigationTitle(savedOnly ? "Reading list" : "Library")
            .searchable(text: $query, prompt: "Title or author")
            .navigationDestination(for: Book.self) { book in
                BookDetailView(book: book)
            }
            .toolbar {
                Button("Add book") { adding = true }
            }
            .sheet(isPresented: $adding) { AddBookView() }
        }
    }
}
