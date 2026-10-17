import SwiftUI

@main
struct InboxApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct Message: Identifiable {
    let id = UUID()
    var subject: String
    var received: Date
    var read: Bool
}

struct ContentView: View {
    @State private var messages = [
        Message(subject: "Welcome aboard", received: Date().addingTimeInterval(-3600), read: true),
        Message(subject: "Your export is ready", received: Date().addingTimeInterval(-900), read: false),
        Message(subject: "Weekly digest", received: Date().addingTimeInterval(-120), read: false)
    ]
    @State private var composing = false
    @State private var draft = ""

    var unread: Int {
        get {
            messages.filter { !$0.read }.count
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(messages) { message in
                        HStack(spacing: 10) {
                            Image(systemName: message.read ? "envelope.open" : "envelope")
                                .foregroundStyle(message.read ? Color.secondary : Color.accentColor)

                            VStack(alignment: .leading, spacing: 2) {
                                Text(message.subject)
                                Text(message.received, style: .relative)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            Spacer()
                        }
                    }
                } header: {
                    Text("Inbox")
                } footer: {
                    Text("Pull a message aside to file it. Nothing here leaves the device.")
                }
            }
            .navigationTitle("\(unread) unread")
            .toolbar {
                Button {
                    composing = true
                } label: {
                    Label("Compose", systemImage: "square.and.pencil")
                }
            }
            .sheet(isPresented: $composing) {
                VStack(spacing: 16) {
                    Text("New message")
                        .font(.title2)
                        .fontWeight(.semibold)

                    TextField("Subject", text: $draft)
                        .padding(.horizontal)

                    Button("Cancel") {
                        composing = false
                    }
                    .foregroundStyle(Color.accentColor)

                    Spacer()
                }
                .padding(.top, 24)
            }
        }
    }
}