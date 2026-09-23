import SwiftUI

// Native reference fixture for the second set of preview fixes: one screen per
// launch, picked with `-screen <name>` (the arguments domain of UserDefaults).
// Screens print what they measure as `PROBE`, `FRAME` and `HOOK` lines, so the
// app's output answers what a screenshot can't. Geometry is in points on a
// 402 x 874 pt iPhone 18 Pro.

@main
struct NativeMisrendersIIApp: App {
    // Line-buffered, so each line reaches the captured output as it is printed.
    init() { setvbuf(stdout, nil, _IOLBF, 0) }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct RootView: View {
    let screen = UserDefaults.standard.string(forKey: "screen") ?? "tags-segmented"

    var body: some View {
        switch screen {
        case "tags-segmented": TagsSegmented()
        case "tags-optional": TagsOptional()
        case "tags-menu": TagsMenu()
        case "tags-tabview": TagsTabView()
        case "hooks": Hooks()
        case "geo-root": GeometryReader { geo in Probe(name: "geo-root", geo: geo) }
        case "geo-ignoring": GeometryReader { geo in Probe(name: "geo-ignoring", geo: geo) }.ignoresSafeArea()
        case "geo-padded": VStack { GeometryReader { geo in Probe(name: "geo-padded", geo: geo) } }.padding()
        case "geo-header": VStack { Text("Header").frame(height: 100); GeometryReader { geo in Probe(name: "geo-header", geo: geo) } }.padding()
        case "geo-nav": NavigationStack { GeometryReader { geo in Probe(name: "geo-nav", geo: geo) }.navigationTitle("Title") }
        case "geo-inline": NavigationStack { GeometryReader { geo in Probe(name: "geo-inline", geo: geo) }.navigationTitle("Title").navigationBarTitleDisplayMode(.inline) }
        case "geo-tab": TabView { Tab("One", systemImage: "house") { GeometryReader { geo in Probe(name: "geo-tab", geo: geo) } } }
        case "geo-scroll": ScrollView { GeometryReader { geo in Probe(name: "geo-scroll", geo: geo) }.frame(height: 200) }
        case "links": Links()
        case "symbol-unknown": UnknownSymbol()
        case "scroll-text": ScrollView { Text("Hi").modifier(Framed(name: "scroll-text")) }
        case "scroll-fixed": ScrollView { Color.red.frame(height: 200).modifier(Framed(name: "scroll-fixed")) }
        case "text-in-text": TextInText()
        default: Text("Unknown screen: \(screen)")
        }
    }
}

func fmt(_ e: EdgeInsets) -> String { "t\(Int(e.top)) l\(Int(e.leading)) b\(Int(e.bottom)) r\(Int(e.trailing))" }
func fmt(_ r: CGRect) -> String { "x\(Int(r.minX)) y\(Int(r.minY)) w\(Int(r.width)) h\(Int(r.height))" }

/// Prints where the view it modifies is drawn on the screen, once laid out.
struct Framed: ViewModifier {
    let name: String

    func body(content: Content) -> some View {
        content.onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { print("FRAME \(name) \(fmt($0))") }
    }
}

// MARK: - 1. Which ForEach rows a Picker can select (E7)
//
// Every picker starts on the middle option (chocolate, or id 2). A highlighted
// middle segment, a "chocolate" menu label or the middle tab selected means the
// row's tag matched the selection's type; nothing highlighted means it didn't.

enum FlavorSelf: String, CaseIterable, Identifiable {
    case vanilla, chocolate, strawberry
    var id: Self { self }
}

enum FlavorRaw: String, CaseIterable, Identifiable {
    case vanilla, chocolate, strawberry
    var id: String { rawValue }
}

enum Plain: String, CaseIterable {
    case vanilla, chocolate, strawberry
}

struct Scoop: Identifiable {
    let id: Int
    let name: String
}

let scoops = [Scoop(id: 1, name: "vanilla"), Scoop(id: 2, name: "chocolate"), Scoop(id: 3, name: "strawberry")]

/// One caption and one segmented picker, which prints where it is drawn.
struct Row<Content: View>: View {
    let name: String
    let caption: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(caption).font(.caption)
            content().pickerStyle(.segmented).modifier(Framed(name: name))
        }
    }
}

struct TagsSegmented: View {
    @State private var a: FlavorSelf = .chocolate
    @State private var b: FlavorRaw = .chocolate
    @State private var c: Plain = .chocolate
    @State private var d: Plain = .chocolate
    @State private var e = "chocolate"
    @State private var h = 2
    @State private var i = 1

    var body: some View {
        VStack(spacing: 14) {
            Row(name: "A", caption: "A Identifiable, id: Self") {
                Picker("A", selection: $a) { ForEach(FlavorSelf.allCases) { Text($0.rawValue) } }
            }
            Row(name: "B", caption: "B Identifiable, id: String") {
                Picker("B", selection: $b) { ForEach(FlavorRaw.allCases) { Text($0.rawValue) } }
            }
            Row(name: "C", caption: "C id: \\.self") {
                Picker("C", selection: $c) { ForEach(Plain.allCases, id: \.self) { Text($0.rawValue) } }
            }
            Row(name: "D", caption: "D id: \\.rawValue, enum selection") {
                Picker("D", selection: $d) { ForEach(Plain.allCases, id: \.rawValue) { Text($0.rawValue) } }
            }
            Row(name: "E", caption: "E id: \\.rawValue, String selection") {
                Picker("E", selection: $e) { ForEach(Plain.allCases, id: \.rawValue) { Text($0.rawValue) } }
            }
            Row(name: "H", caption: "H struct, let id: Int") {
                Picker("H", selection: $h) { ForEach(scoops) { Text($0.name) } }
            }
            Row(name: "I", caption: "I ForEach(0..<3), Int selection") {
                Picker("I", selection: $i) { ForEach(0..<3) { Text(Plain.allCases[$0].rawValue) } }
            }
        }
        .padding()
    }
}

struct TagsOptional: View {
    @State private var g1: FlavorSelf? = .chocolate
    @State private var g2: Plain? = .chocolate
    @State private var g3: String? = "chocolate"
    @State private var k1: FlavorSelf? = .chocolate
    @State private var k2: FlavorSelf? = .chocolate
    @State private var l: FlavorSelf? = .chocolate

    var body: some View {
        VStack(spacing: 14) {
            Row(name: "G1", caption: "G1 Optional, implicit, id: Self") {
                Picker("G1", selection: $g1) { ForEach(FlavorSelf.allCases) { Text($0.rawValue) } }
            }
            Row(name: "G2", caption: "G2 Optional, implicit, id: \\.self") {
                Picker("G2", selection: $g2) { ForEach(Plain.allCases, id: \.self) { Text($0.rawValue) } }
            }
            Row(name: "G3", caption: "G3 String?, implicit, id: \\.rawValue") {
                Picker("G3", selection: $g3) { ForEach(Plain.allCases, id: \.rawValue) { Text($0.rawValue) } }
            }
            Row(name: "K1", caption: "K1 Optional, .tag(f)") {
                Picker("K1", selection: $k1) { ForEach(FlavorSelf.allCases) { Text($0.rawValue).tag($0) } }
            }
            Row(name: "K2", caption: "K2 Optional, .tag(f, includeOptional: false)") {
                Picker("K2", selection: $k2) { ForEach(FlavorSelf.allCases) { Text($0.rawValue).tag($0, includeOptional: false) } }
            }
            Row(name: "L", caption: "L Optional, .tag(Optional(f))") {
                Picker("L", selection: $l) { ForEach(FlavorSelf.allCases) { Text($0.rawValue).tag(Optional($0)) } }
            }
        }
        .padding()
    }
}

/// What a menu picker's label reads, matching and not.
struct TagsMenu: View {
    @State private var a: FlavorSelf = .chocolate
    @State private var b: FlavorRaw = .chocolate
    @State private var s = "mint"
    @State private var h = 2
    @State private var m: Plain = .chocolate
    @State private var g: FlavorSelf? = .chocolate

    var body: some View {
        Form {
            Picker("A match", selection: $a) { ForEach(FlavorSelf.allCases) { Text($0.rawValue) } }
            Picker("B String id", selection: $b) { ForEach(FlavorRaw.allCases) { Text($0.rawValue) } }
            Picker("S no such row", selection: $s) { ForEach(Plain.allCases, id: \.rawValue) { Text($0.rawValue) } }
            Picker("H Int id", selection: $h) { ForEach(scoops) { Text($0.name) } }
            Picker("M String tag", selection: $m) { ForEach(Plain.allCases, id: \.self) { Text($0.rawValue).tag($0.rawValue) } }
            Picker("G Optional", selection: $g) { ForEach(FlavorSelf.allCases) { Text($0.rawValue) } }
        }
    }
}

/// A TabView over ForEach pages with no `.tag`.
struct TagsTabView: View {
    @State private var tab: FlavorSelf = .chocolate

    var body: some View {
        TabView(selection: $tab) {
            ForEach(FlavorSelf.allCases) { flavor in
                Text("Page \(flavor.rawValue)")
                    .tabItem { Label(flavor.rawValue, systemImage: "circle") }
            }
        }
    }
}

// MARK: - 2. Which of a view's appear hooks run, and in what order (E10)

struct Hooks: View {
    var body: some View {
        VStack(spacing: 20) {
            Text("A").onAppear { print("HOOK A appear") }.task { print("HOOK A task") }
            Text("B").task { print("HOOK B task") }.onAppear { print("HOOK B appear") }
            Text("C").onAppear { print("HOOK C appear 1") }.onAppear { print("HOOK C appear 2") }
            Text("D").task { print("HOOK D task 1") }.task { print("HOOK D task 2") }
        }
    }
}

// MARK: - 3. What a GeometryReader reports, where it is (E12)

/// Prints the reader's safe-area insets and its frame in the screen and in itself.
struct Probe: View {
    let name: String
    let geo: GeometryProxy

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(name) insets \(fmt(geo.safeAreaInsets))")
            Text("global \(fmt(geo.frame(in: .global)))")
            Text("local \(fmt(geo.frame(in: .local)))")
        }
        .font(.caption)
        .onAppear { print("PROBE \(name) insets=\(fmt(geo.safeAreaInsets)) global=\(fmt(geo.frame(in: .global))) local=\(fmt(geo.frame(in: .local)))") }
    }
}

// MARK: - 4. Links, share links and a timeline (E12)

struct Links: View {
    let url = URL(string: "https://example.com")!

    var body: some View {
        VStack(spacing: 24) {
            Link("Site", destination: url).modifier(Framed(name: "link-title"))
            Link(destination: url) { Label("Site", systemImage: "globe") }.modifier(Framed(name: "link-label"))
            ShareLink(item: url).modifier(Framed(name: "share-item"))
            ShareLink("Share", item: url).modifier(Framed(name: "share-title"))
            ShareLink(item: url) { Label("Send", systemImage: "paperplane") }.modifier(Framed(name: "share-label"))
            TimelineView(.periodic(from: .now, by: 1)) { context in Text(context.date, style: .time) }.modifier(Framed(name: "timeline"))
        }
    }
}

// MARK: - 5. A symbol name iOS doesn't have (E16a)

struct UnknownSymbol: View {
    var body: some View {
        HStack(spacing: 0) {
            Text("L").modifier(Framed(name: "symbol-left"))
            Image(systemName: "not.a.symbol").modifier(Framed(name: "symbol-unknown"))
            Text("R").modifier(Framed(name: "symbol-right"))
        }
    }
}

// MARK: - 6. Text interpolated into Text

struct TextInText: View {
    var body: some View {
        Text("\(Text("Bold").bold()) and plain").modifier(Framed(name: "text-in-text"))
    }
}
