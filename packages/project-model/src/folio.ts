import type { SourceFile } from '@studio/shared'

/** A compact app whose saved collection stays in sync across its screens. */
export const FOLIO_FILES: readonly SourceFile[] = [
  { id: 'Sources/FolioApp.swift', text: String.raw`import SwiftUI

@main
struct FolioApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @StateObject private var library = Library()

    var body: some View {
        MainTabs()
            .environmentObject(library)
            .tint(.indigo)
    }
}

struct MainTabs: View {
    var body: some View {
        TabView {
            LibraryView(savedOnly: false)
                .tabItem { Label("Library", systemImage: "books.vertical") }
            LibraryView(savedOnly: true)
                .tabItem { Label("Reading list", systemImage: "bookmark") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}
` },
  { id: 'Sources/Models/Library.swift', text: String.raw`import SwiftUI

struct Book: Identifiable, Hashable {
    let id = UUID()
    let title: String
    let author: String
    let category: String
    let summary: String
    let symbol: String
}

final class Library: ObservableObject {
    @Published var savedIDs: [UUID] = []
    @Published var books = [
        Book(title: "The Secret Garden", author: "Frances Hodgson Burnett", category: "Fiction",
             summary: "A locked garden, an unexpected friendship, and the small things that help us grow.", symbol: "leaf"),
        Book(title: "A Room of One’s Own", author: "Virginia Woolf", category: "Essays",
             summary: "An invitation to think about creative freedom, independence, and the space we need to make things.", symbol: "pencil"),
        Book(title: "Around the World in Eighty Days", author: "Jules Verne", category: "Adventure",
             summary: "One ambitious wager becomes a journey across continents, with surprises at every stop.", symbol: "globe"),
        Book(title: "The Time Machine", author: "H. G. Wells", category: "Science fiction",
             summary: "A visitor from the present travels far into the future and returns with more questions than answers.", symbol: "clock")
    ]

    func isSaved(_ book: Book) -> Bool {
        return savedIDs.contains(book.id)
    }

    func toggleSaved(_ book: Book) {
        if let index = savedIDs.firstIndex(of: book.id) {
            savedIDs.remove(at: index)
        } else {
            savedIDs.append(book.id)
        }
    }

    func add(title: String, author: String) {
        books.append(Book(title: title, author: author, category: "My books",
                          summary: "A new addition to your personal library.", symbol: "book"))
    }
}
` },
  { id: 'Sources/Components/BookRow.swift', text: String.raw`import SwiftUI

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
` },
  { id: 'Sources/Features/LibraryView.swift', text: String.raw`import SwiftUI

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
` },
  { id: 'Sources/Features/BookDetailView.swift', text: String.raw`import SwiftUI

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
` },
  { id: 'Sources/Features/AddBookView.swift', text: String.raw`import SwiftUI

struct AddBookView: View {
    @EnvironmentObject private var library: Library
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var author = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Book details") {
                    TextField("Title", text: $title)
                    TextField("Author", text: $author)
                } footer: {
                    Text("Your book will appear in Library. Save it to your reading list whenever you are ready.")
                }
            }
            .navigationTitle("Add a book")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        library.add(title: title, author: author)
                        dismiss()
                    }
                    .disabled(title.isEmpty || author.isEmpty)
                }
            }
        }
    }
}
` },
  { id: 'Sources/Features/SettingsView.swift', text: String.raw`import SwiftUI

struct SettingsView: View {
    @AppStorage("folio.reader") private var name = "Taylor"
    @AppStorage("folio.dailyGoal") private var dailyGoal = 20

    var body: some View {
        NavigationStack {
            Form {
                Section("Reader") {
                    TextField("Your name", text: $name)
                }
                Section("Reading goal") {
                    Stepper("\(dailyGoal) minutes a day", value: $dailyGoal, in: 5...120, step: 5)
                } footer: {
                    Text("A little time for a good book. Your name and goal are saved on this device.")
                }
                Section("About Folio") {
                    LabeledContent("Version", value: "1.0")
                    Text("A small library, with room to grow.").foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
        }
    }
}
` },
]
