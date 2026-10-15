import SwiftUI

// Native reference fixture for Wave 4a: swipe actions, a context menu and list row
// settings. One screen per launch, picked with `-screen <name>` (the arguments domain
// of UserDefaults). The swipes and the long press are made by hand in the simulator;
// each screen says which row to swipe. Geometry is in points on a 402 x 874 pt
// iPhone 18 Pro.

@main
struct NativeSystemUIApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct RootView: View {
    let screen = UserDefaults.standard.string(forKey: "screen") ?? "swipe-trailing"

    var body: some View {
        switch screen {
        case "swipe-trailing": SwipeTrailing()
        case "swipe-leading": SwipeLeading()
        case "swipe-widths": SwipeWidths()
        case "swipe-full": SwipeFull()
        case "swipe-ondelete": SwipeOnDelete()
        case "context-menu": ContextMenuRows()
        case "context-menu-leading": ContextMenuLeading(inset: 16)
        case "context-menu-inset": ContextMenuLeading(inset: 48)
        case "context-menu-bottom": ContextMenuBottom()
        case "swipe-tint": SwipeTint()
        case "list-rows": ListRows()
        default: Text("Unknown screen: \(screen)")
        }
    }
}

// MARK: - Trailing actions
//
// Swipe each row left in turn. "Labels" has an icon and a title in each action;
// "Icons" has icon-only labels; "Titles" has plain titles, one with no tint.

struct SwipeTrailing: View {
    var body: some View {
        List {
            Text("Labels")
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) { } label: {
                        Label("Delete", systemImage: "trash")
                    }
                    Button { } label: {
                        Label("Flag", systemImage: "flag")
                    }
                    .tint(.orange)
                }
            Text("Icons")
                .swipeActions {
                    Button(role: .destructive) { } label: {
                        Label("Delete", systemImage: "trash")
                    }
                    .labelStyle(.iconOnly)
                    Button { } label: {
                        Label("Flag", systemImage: "flag")
                    }
                    .labelStyle(.iconOnly)
                    .tint(.orange)
                }
            Text("Titles")
                .swipeActions {
                    Button("Archive") { }
                        .tint(.blue)
                    Button("More") { }
                }
            Text("Plain row")
        }
    }
}

// MARK: - Leading actions
//
// Swipe "Leading" right.

struct SwipeLeading: View {
    var body: some View {
        List {
            Text("Leading")
                .swipeActions(edge: .leading) {
                    Button("Pin") { }
                        .tint(.yellow)
                    Button { } label: {
                        Label("Unread", systemImage: "envelope.badge")
                    }
                    .tint(.blue)
                }
            Text("Plain row")
        }
    }
}

// MARK: - How wide each action is
//
// Swipe each row in turn: the first two left, the last two right.

struct SwipeWidths: View {
    var body: some View {
        List {
            Text("One short")
                .swipeActions {
                    Button("Pin") { }
                        .tint(.yellow)
                }
            Text("Short and long")
                .swipeActions {
                    Button("A") { }
                        .tint(.green)
                    Button("Longer title") { }
                        .tint(.purple)
                }
            Text("Leading icons")
                .swipeActions(edge: .leading) {
                    Button { } label: {
                        Label("Delete", systemImage: "trash")
                    }
                    .labelStyle(.iconOnly)
                    .tint(.red)
                    Button { } label: {
                        Label("Flag", systemImage: "flag")
                    }
                    .labelStyle(.iconOnly)
                    .tint(.orange)
                }
            Text("Leading mixed")
                .swipeActions(edge: .leading) {
                    Button("A") { }
                        .tint(.green)
                    Button("Longer title") { }
                        .tint(.purple)
                }
        }
    }
}

// MARK: - A destructive full swipe
//
// Drag "Full swipe" most of the way across and hold. "No full swipe" has
// allowsFullSwipe: false, so it stops at its actions.

struct SwipeFull: View {
    @State private var rows = ["Full swipe", "No full swipe", "Plain row"]

    var body: some View {
        List {
            ForEach(rows, id: \.self) { row in
                Text(row)
                    .swipeActions(edge: .trailing, allowsFullSwipe: row != "No full swipe") {
                        Button(role: .destructive) {
                            rows.removeAll { $0 == row }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        Button("Flag") { }
                            .tint(.orange)
                    }
            }
        }
    }
}

// MARK: - .onDelete beside .swipeActions
//
// Swipe each row left. "On delete" has only .onDelete; "With leading" also has a
// leading action, to see whether the Delete that .onDelete makes is still offered.

struct SwipeOnDelete: View {
    @State private var rows = ["On delete", "With leading"]

    var body: some View {
        List {
            ForEach(rows, id: \.self) { row in
                if row == "With leading" {
                    Text(row)
                        .swipeActions(edge: .leading) {
                            Button("Pin") { }
                                .tint(.yellow)
                        }
                } else {
                    Text(row)
                }
            }
            .onDelete { offsets in
                rows.remove(atOffsets: offsets)
            }
        }
    }
}

// MARK: - A context menu
//
// Long-press "Hold me".

struct ContextMenuRows: View {
    var body: some View {
        List {
            Text("First row")
            Text("Hold me")
                .contextMenu {
                    Button { } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                    Button("Rename") { }
                    Button(role: .destructive) { } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            Text("Last row")
        }
    }
}

// MARK: - Where a context menu goes
//
// Long-press "Hold me": near the leading edge, 16 or 48 in, where a menu centred under it
// would leave the screen; and at the bottom, where there is no room below it. These menus
// have no icons.

struct ContextMenuLeading: View {
    let inset: CGFloat

    var body: some View {
        VStack {
            HStack {
                Text("Hold me")
                    .contextMenu {
                        Button("Copy") { }
                        Button("Rename") { }
                    }
                Spacer()
            }
            Spacer()
        }
        .padding(.horizontal, inset)
        .padding(.vertical, 16)
    }
}

struct ContextMenuBottom: View {
    var body: some View {
        VStack {
            Spacer()
            Text("Hold me")
                .contextMenu {
                    Button("Copy") { }
                    Button("Rename") { }
                    Button("Delete", role: .destructive) { }
                }
        }
        .padding()
    }
}

// MARK: - A tint around the list
//
// Swipe both rows left: one list is tinted with .tint, the other with .accentColor, and
// neither action has a tint of its own.

struct SwipeTint: View {
    var body: some View {
        VStack(spacing: 0) {
            List {
                Text("List tint")
                    .swipeActions {
                        Button("More") { }
                    }
            }
            .tint(.green)
            List {
                Text("List accent")
                    .swipeActions {
                        Button("More") { }
                    }
            }
            .accentColor(.green)
        }
    }
}

// MARK: - Row background, insets and separators

struct ListRows: View {
    var body: some View {
        List {
            Text("Background")
                .listRowBackground(Color.yellow)
            Text("Insets")
                .listRowInsets(EdgeInsets(top: 8, leading: 40, bottom: 8, trailing: 16))
            Text("Red separator")
                .listRowSeparatorTint(.red)
            Text("Blue separator above")
                .listRowSeparatorTint(.blue, edges: .top)
            Text("No separator")
                .listRowSeparator(.hidden)
            Text("Plain row")
        }
    }
}
