import SwiftUI

struct AddBookView: View {
    @EnvironmentObject private var library: Library
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var author = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $title)
                    TextField("Author", text: $author)
                } header: {
                    Text("Book details")
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
