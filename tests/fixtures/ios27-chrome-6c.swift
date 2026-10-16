import SwiftUI

// Native reference fixture for Wave 6c: views beside a NavigationStack or TabView, the
// search tab, toolbar spacers, the default search item, the bottom accessory, subtitles,
// toolbar placements and the compact popover bubble. One screen per launch, picked with
// `-screen <name>` (the arguments domain of UserDefaults). Each measured view prints
// "MEASURE <name> x y width height" in points, read by launching with
// `simctl launch --console-pty`. Geometry is in points on a 402 x 874 pt iPhone 18 Pro.

@main
struct NativeChromeApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct RootView: View {
    let screen = UserDefaults.standard.string(forKey: "screen") ?? "search-tab"

    var body: some View {
        switch screen {
        case "search-tab": SearchTabs(count: 2, accessory: false)
        case "search-tab-three": SearchTabs(count: 3, accessory: false)
        case "search-tab-accessory": SearchTabs(count: 2, accessory: true)
        case "accessory": AccessoryTabs()
        case "spacer-fixed": SpacerFixed()
        case "spacer-flexible": SpacerFlexible()
        case "default-search": DefaultSearch(withButton: false)
        case "default-search-button": DefaultSearch(withButton: true)
        case "default-search-top": DefaultSearchTop()
        case "glass-container": GlassContainer()
        case "subtitle-inline": Subtitle(large: false)
        case "subtitle-large": Subtitle(large: true)
        case "placements": Placements()
        case "status": StatusScreen()
        case "confirmation": Confirmation()
        case "primary": PrimaryOnly()
        case "popover-top": PopoverScreen(atTop: true, inset: 120)
        case "popover-bottom": PopoverScreen(atTop: false, inset: 120)
        case "popover-below": PopoverScreen(atTop: true, inset: 8)
        case "floating-button": FloatingButton()
        case "nav-player": NavPlayer()
        case "nav-toast": NavToast()
        case "tabs-player": TabsPlayer()
        case "tabs-capsule": TabsCapsule()
        default: Text("Unknown screen: \(screen)")
        }
    }
}

extension View {
    /// Prints the view's frame in the window, once it is laid out.
    func measure(_ name: String) -> some View {
        onGeometryChange(for: CGRect.self) { proxy in
            proxy.frame(in: .global)
        } action: { frame in
            print("MEASURE \(name) \(frame.minX) \(frame.minY) \(frame.width) \(frame.height)")
        }
    }
}

/// A page that fills what its container gives it, so its frame is the content region.
struct Page: View {
    let title: String
    let name: String

    var body: some View {
        Color.yellow.opacity(0.3)
            .overlay(Text(title))
            .measure(name)
    }
}

struct MiniPlayer: View {
    var body: some View {
        HStack {
            Image(systemName: "music.note")
            Text("Now Playing")
            Spacer()
            Image(systemName: "play.fill")
        }
        .padding(.horizontal)
        .measure("player")
    }
}

// MARK: - The search tab
//
// Two or three ordinary tabs and a search tab, which iOS 27 draws as its own glass circle
// right of the bar. "search-tab-accessory" adds a bottom accessory above both.

struct SearchTabs: View {
    let count: Int
    let accessory: Bool
    @State private var query = ""

    var body: some View {
        if accessory {
            tabs.tabViewBottomAccessory { MiniPlayer() }
        } else {
            tabs
        }
    }

    var tabs: some View {
        TabView {
            Tab("Home", systemImage: "house") { Page(title: "Home", name: "page") }
            Tab("Library", systemImage: "books.vertical") { Page(title: "Library", name: "library") }
            if count > 2 {
                Tab("Radio", systemImage: "dot.radiowaves.left.and.right") { Page(title: "Radio", name: "radio") }
            }
            Tab(role: .search) {
                NavigationStack {
                    List { Text("Result") }
                        .navigationTitle("Search")
                }
                .searchable(text: $query)
            }
        }
    }
}

// MARK: - The bottom accessory

struct AccessoryTabs: View {
    var body: some View {
        TabView {
            Tab("Home", systemImage: "house") { Page(title: "Home", name: "page") }
            Tab("Library", systemImage: "books.vertical") { Page(title: "Library", name: "library") }
            Tab("Radio", systemImage: "dot.radiowaves.left.and.right") { Page(title: "Radio", name: "radio") }
        }
        .tabViewBottomAccessory { MiniPlayer() }
    }
}

// MARK: - Toolbar spacers
//
// A fixed spacer between two trailing buttons and a third splits the glass group; a
// flexible one in the bottom bar pushes the groups to the edges.

struct SpacerFixed: View {
    var body: some View {
        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Spacers")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Share", systemImage: "square.and.arrow.up") { }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Edit", systemImage: "pencil") { }
                    }
                    ToolbarSpacer(.fixed, placement: .topBarTrailing)
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Add", systemImage: "plus") { }
                    }
                }
        }
    }
}

struct SpacerFlexible: View {
    var body: some View {
        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Spacers")
                .toolbar {
                    ToolbarItem(placement: .bottomBar) {
                        Button("Filter", systemImage: "line.3.horizontal.decrease") { }
                    }
                    ToolbarSpacer(.flexible, placement: .bottomBar)
                    ToolbarItem(placement: .bottomBar) {
                        Button("Share", systemImage: "square.and.arrow.up") { }
                    }
                    ToolbarSpacer(.fixed, placement: .bottomBar)
                    ToolbarItem(placement: .bottomBar) {
                        Button("Add", systemImage: "plus") { }
                    }
                }
        }
    }
}

// MARK: - The default search item

struct DefaultSearch: View {
    let withButton: Bool
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Notes")
                .searchable(text: $query)
                .toolbar {
                    if withButton {
                        ToolbarItem(placement: .bottomBar) {
                            Button("Filter", systemImage: "line.3.horizontal.decrease") { }
                        }
                        ToolbarSpacer(.flexible, placement: .bottomBar)
                    }
                    DefaultToolbarItem(kind: .search, placement: .bottomBar)
                    if withButton {
                        ToolbarSpacer(.flexible, placement: .bottomBar)
                        ToolbarItem(placement: .bottomBar) {
                            Button("New", systemImage: "square.and.pencil") { }
                        }
                    }
                }
        }
    }
}

/// The search item put in the top bar instead.
struct DefaultSearchTop: View {
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Notes")
                .searchable(text: $query)
                .toolbar {
                    DefaultToolbarItem(kind: .search, placement: .topBarTrailing)
                }
        }
    }
}

// MARK: - GlassEffectContainer
//
// Two views written straight inside one, without a stack, then the usual HStack of glass
// buttons, to see how it lays out what it holds.

struct GlassContainer: View {
    var body: some View {
        VStack(spacing: 20) {
            GlassEffectContainer {
                Text("First").measure("first")
                Text("Second").measure("second")
            }
            .measure("bare")
            GlassEffectContainer(spacing: 20) {
                HStack(spacing: 20) {
                    Image(systemName: "pencil")
                        .frame(width: 44, height: 44)
                        .glassEffect()
                    Image(systemName: "eraser")
                        .frame(width: 44, height: 44)
                        .glassEffect()
                }
            }
            .measure("stacked")
        }
    }
}

// MARK: - Subtitles

struct Subtitle: View {
    let large: Bool

    var body: some View {
        NavigationStack {
            List { Text("First row").measure("row") }
                .navigationTitle("Inbox")
                .navigationSubtitle("3 unread")
                .navigationBarTitleDisplayMode(large ? .large : .inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Edit") { }
                    }
                }
        }
    }
}

// MARK: - Placements

struct Placements: View {
    var body: some View {
        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Places")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigation) {
                        Button("Sidebar", systemImage: "sidebar.left") { }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Button("Add", systemImage: "plus") { }
                    }
                    ToolbarItem(placement: .secondaryAction) {
                        Button("Duplicate", systemImage: "plus.square.on.square") { }
                    }
                    ToolbarItem(placement: .secondaryAction) {
                        Button("Archive", systemImage: "archivebox") { }
                    }
                }
        }
    }
}

struct StatusScreen: View {
    var body: some View {
        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Mail")
                .toolbar {
                    ToolbarItem(placement: .status) {
                        Text("Updated just now")
                            .font(.caption)
                    }
                    ToolbarItem(placement: .bottomBar) {
                        Button("Compose", systemImage: "square.and.pencil") { }
                    }
                }
        }
    }
}

struct Confirmation: View {
    var body: some View {
        NavigationStack {
            Form { TextField("Name", text: .constant("Ada")) }
                .navigationTitle("Edit")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { }
                    }
                }
        }
    }
}

struct PrimaryOnly: View {
    var body: some View {
        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Primary")
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Save") { }
                    }
                }
        }
    }
}

// MARK: - The compact popover
//
// The popover is shown once the screen appears, from a button 120 pt in from the top or
// the bottom (the bubble goes above when it fits), or 8 pt below the safe area's top
// (no room above, so it goes below).

struct PopoverScreen: View {
    let atTop: Bool
    let inset: CGFloat
    @State private var shown = false

    var body: some View {
        VStack {
            if !atTop { Spacer() }
            Button("Details") { shown = true }
                .measure("source")
                .popover(isPresented: $shown) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Ada Lovelace").font(.headline)
                        Text("First programmer")
                    }
                    .padding()
                    .measure("content")
                    .presentationCompactAdaptation(.popover)
                }
            if atTop { Spacer() }
        }
        .padding(.vertical, inset)
        .task {
            try? await Task.sleep(for: .milliseconds(600))
            shown = true
        }
    }
}

// MARK: - Views beside a NavigationStack or TabView

struct FloatingButton: View {
    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            NavigationStack {
                List {
                    Text("First row").measure("row")
                    Text("Second row")
                }
                .navigationTitle("Notes")
            }
            .measure("stack")
            Button { } label: {
                Image(systemName: "plus")
                    .font(.title2)
                    .foregroundStyle(.white)
                    .frame(width: 56, height: 56)
                    .background(Circle().fill(.blue))
            }
            .padding(20)
            .measure("fab")
        }
    }
}

struct NavPlayer: View {
    var body: some View {
        VStack(spacing: 0) {
            NavigationStack {
                List { Text("First row").measure("row") }
                    .navigationTitle("Music")
            }
            .measure("stack")
            MiniPlayer()
                .frame(height: 64)
                .background(.thinMaterial)
        }
    }
}

struct NavToast: View {
    var body: some View {
        NavigationStack {
            List { Text("First row").measure("row") }
                .navigationTitle("Inbox")
        }
        .overlay(alignment: .top) {
            Text("Saved")
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Capsule().fill(.green))
                .measure("toast")
        }
    }
}

struct TabsPlayer: View {
    var body: some View {
        VStack(spacing: 0) {
            TabView {
                Tab("Home", systemImage: "house") { Page(title: "Home", name: "page") }
                Tab("Library", systemImage: "books.vertical") { Page(title: "Library", name: "library") }
            }
            .measure("tabs")
            MiniPlayer()
                .frame(height: 64)
                .background(.thinMaterial)
        }
    }
}

struct TabsCapsule: View {
    var body: some View {
        ZStack(alignment: .bottom) {
            TabView {
                Tab("Home", systemImage: "house") { Page(title: "Home", name: "page") }
                Tab("Library", systemImage: "books.vertical") { Page(title: "Library", name: "library") }
            }
            .measure("tabs")
            Text("Offline")
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Capsule().fill(.orange))
                .padding(.bottom, 100)
                .measure("capsule")
        }
    }
}
