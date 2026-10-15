import SwiftUI

// Native reference fixture for Wave 4b: toolbar items in place of the title and in a
// bottom bar, ContentUnavailableView's search and closure forms, and sheets over the
// screen that opens them. One screen per launch, picked with `-screen <name>` (the
// arguments domain of UserDefaults). Every sheet is up at launch, so nothing needs a
// tap. Geometry is in points on a 402 x 874 pt iPhone 18 Pro.

@main
struct NativeSystemUIApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct RootView: View {
    let screen = UserDefaults.standard.string(forKey: "screen") ?? "principal"

    var body: some View {
        switch screen {
        case "principal": Principal()
        case "principal-large": PrincipalLarge()
        case "bottom-bar": NavigationStack { BottomBar() }
        case "bottom-bar-items": BottomBarItems()
        case "bottom-bar-tabs": BottomBarTabs()
        case "bottom-bar-four-tabs": BottomBarFourTabs()
        case "bottom-bar-search": BottomBarSearch()
        case "tab-bar-hidden": TabBarHidden()
        case "cuv-search": ContentUnavailableView.search(text: "kiwi")
        case "cuv-search-member": ContentUnavailableView.search
        case "cuv-closure": NoMail()
        case "sheet-medium": SheetOver(detents: [.medium], indicator: .automatic)
        case "sheet-medium-large": SheetOver(detents: [.medium, .large], indicator: .automatic)
        case "sheet-height": SheetOver(detents: [.height(200)], indicator: .visible)
        case "sheet-styled": SheetStyled()
        default: Text("Unknown screen: \(screen)")
        }
    }
}

// MARK: - A principal item in place of the title
//
// "principal" is an inline title with a two-line principal item and a trailing button;
// "principal-large" keeps the default title display mode, to see whether the large
// title still shows under a principal item.

struct Principal: View {
    var body: some View {
        NavigationStack {
            List {
                Text("First row")
                Text("Second row")
            }
            .navigationTitle("Inbox")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text("Inbox")
                            .font(.headline)
                        Text("3 unread")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Edit") { }
                }
            }
        }
    }
}

struct PrincipalLarge: View {
    var body: some View {
        NavigationStack {
            List {
                Text("First row")
                Text("Second row")
            }
            .navigationTitle("Inbox")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Custom")
                }
            }
        }
    }
}

// MARK: - A bottom bar
//
// Two buttons split by a Spacer: a title and an icon. "bottom-bar-items" writes two
// separate items with no Spacer; "bottom-bar-tabs" puts the bar in a tab, of two tabs
// or of four, and "bottom-bar-search" beside a search field.

struct BottomBar: View {
    var body: some View {
        List {
            Text("First row")
            Text("Second row")
        }
        .navigationTitle("Notes")
        .toolbar {
            ToolbarItemGroup(placement: .bottomBar) {
                Button("Edit") { }
                Spacer()
                Button("Compose", systemImage: "square.and.pencil") { }
            }
        }
    }
}

struct BottomBarItems: View {
    var body: some View {
        NavigationStack {
            List {
                Text("First row")
            }
            .navigationTitle("Notes")
            .toolbar {
                ToolbarItem(placement: .bottomBar) {
                    Button("Edit") { }
                }
                ToolbarItem(placement: .bottomBar) {
                    Button("Share", systemImage: "square.and.arrow.up") { }
                }
            }
        }
    }
}

struct BottomBarTabs: View {
    var body: some View {
        TabView {
            Tab("Notes", systemImage: "note.text") {
                NavigationStack { BottomBar() }
            }
            Tab("Settings", systemImage: "gear") {
                Text("Settings")
            }
        }
    }
}

struct BottomBarFourTabs: View {
    var body: some View {
        TabView {
            Tab("Notes", systemImage: "note.text") {
                NavigationStack { BottomBar() }
            }
            Tab("Inbox", systemImage: "tray") {
                Text("Inbox")
            }
            Tab("Search", systemImage: "magnifyingglass") {
                Text("Search")
            }
            Tab("Settings", systemImage: "gear") {
                Text("Settings")
            }
        }
    }
}

struct BottomBarSearch: View {
    @State private var query = ""

    var body: some View {
        NavigationStack {
            BottomBar()
                .searchable(text: $query)
        }
    }
}

// MARK: - A tab bar hidden from inside a tab

struct TabBarHidden: View {
    var body: some View {
        TabView {
            Tab("Notes", systemImage: "note.text") {
                NavigationStack {
                    List {
                        Text("First row")
                    }
                    .navigationTitle("Notes")
                    .toolbar(.hidden, for: .tabBar)
                }
            }
            Tab("Settings", systemImage: "gear") {
                Text("Settings")
            }
        }
    }
}

// MARK: - ContentUnavailableView with its own label, description and actions

struct NoMail: View {
    var body: some View {
        ContentUnavailableView {
            Label("No Mail", systemImage: "tray.fill")
        } description: {
            Text("New mail you receive appears here.")
        } actions: {
            Button("Refresh") { }
            Button("Compose") { }
                .buttonStyle(.borderedProminent)
        }
    }
}

// MARK: - Sheets over the screen that opens them

struct Opener: View {
    var body: some View {
        NavigationStack {
            List {
                Text("First row")
                Text("Second row")
                Text("Third row")
            }
            .navigationTitle("Opener")
        }
    }
}

struct SheetOver: View {
    let detents: Set<PresentationDetent>
    let indicator: Visibility
    @State private var showing = true

    var body: some View {
        Opener()
            .sheet(isPresented: $showing) {
                Text("Sheet")
                    .presentationDetents(detents)
                    .presentationDragIndicator(indicator)
            }
    }
}

struct SheetStyled: View {
    @State private var showing = true

    var body: some View {
        Opener()
            .sheet(isPresented: $showing) {
                Text("Styled sheet")
                    .presentationDetents([.medium])
                    .presentationDragIndicator(.visible)
                    .presentationBackground(.yellow)
                    .presentationCornerRadius(12)
            }
    }
}
