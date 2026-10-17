import SwiftUI

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
