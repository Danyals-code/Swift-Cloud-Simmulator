import SwiftUI

@main
struct LoaderApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

enum LoadError: Error {
    case offline
    case empty
}

/// A protocol with a default implementation, supplied the only way Swift allows:
/// in an extension. Every conformer gets summary() without writing it.
protocol Describable {
    var title: String { get }
}

extension Describable {
    func summary() -> String {
        "Loaded: " + title
    }
}

struct Article: Describable {
    let title: String
}

struct ContentView: View {
    @State private var status = "Tap to load"
    @State private var failNext = false

    var body: some View {
        VStack(spacing: 20) {
            Text("Error handling")
                .font(.title2)
                .bold()

            Text(status)
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(height: 44)

            Toggle("Make it fail", isOn: $failNext)
                .padding(.horizontal, 40)

            Button("Load") {
                load()
            }
            .buttonStyle(.borderedProminent)

            Spacer()
        }
        .padding(24)
    }

    func fetch() throws -> Article {
        if failNext {
            throw LoadError.offline
        }
        return Article(title: "A Swift interpreter in a browser")
    }

    func load() {
        do {
            let article = try fetch()
            status = article.summary()
        } catch LoadError.offline {
            status = "No connection."
        } catch {
            status = "Something else went wrong."
        }
    }
}