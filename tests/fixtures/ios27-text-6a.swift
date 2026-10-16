import SwiftUI

// Native reference fixture for Wave 6a: Markdown in literal titles and not in interpolated
// strings, AttributedString, images inside text at body and large title, symbol variant
// chains, the built-in font families, masks and zIndex. One screen per launch, picked with
// `-screen <name>` (the arguments domain of UserDefaults). Each measured view prints
// "MEASURE <name> x y width height" in points, read by launching with
// `simctl launch --console-pty`. Geometry is in points on a 402 x 874 pt iPhone 18 Pro.

@main
struct NativeTextApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct RootView: View {
    let screen = UserDefaults.standard.string(forKey: "screen") ?? "markdown"

    var body: some View {
        switch screen {
        case "markdown": MarkdownScreen()
        case "markdown-weights": MarkdownWeights()
        case "interpolated": InterpolatedScreen()
        case "attributed": AttributedScreen()
        case "text-image": TextImageScreen()
        case "symbol-variant": SymbolVariantScreen()
        case "fonts": FontsScreen()
        case "masks": MasksScreen()
        case "parser": ParserScreen()
        case "attributed-more": AttributedMoreScreen()
        case "titles-more": TitlesMoreScreen()
        case "tab-default": TabsScreen(variant: nil)
        case "tab-none": TabsScreen(variant: SymbolVariants.none)
        case "tab-label-none": TabsScreen(variant: nil, onLabel: true)
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

// MARK: - Markdown in literal titles
//
// Bold, italic, both, code, strikethrough and a link, in Text, Button and Label titles, and
// text whose asterisks and underscores don't flank a word, which stays as written.

struct MarkdownScreen: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("**Bold** and *italic* and ***both***").measure("md-mixed")
            Text("Run `swift build` now").measure("md-code")
            Text("~~Old~~ price").measure("md-strike")
            Text("Read the [terms](https://apple.com) first").measure("md-link")
            Text("__Under__ _score_").measure("md-underscore")
            Text("5 * 3 * 2 and snake_case_name").measure("md-flanking")
            Button("**Save** now") { }.measure("md-button")
            Label("*Starred* items", systemImage: "star").measure("md-label")
            Text("A [link](https://apple.com) in red").foregroundStyle(.red).measure("md-link-foreground")
            Text("A [link](https://apple.com) tinted").tint(.green).measure("md-link-tint")
        }
        .padding()
    }
}

// MARK: - Weights
//
// Each Markdown word beside the modifier it might equal, so the widths say which it is.

struct MarkdownWeights: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("**Weight**").fixedSize().measure("w-md-bold")
            Text("Weight").bold().fixedSize().measure("w-bold")
            Text("Weight").fontWeight(.semibold).fixedSize().measure("w-semibold")
            Text("Weight").fixedSize().measure("w-regular")
            Text("*Weight*").fixedSize().measure("w-md-italic")
            Text("Weight").italic().fixedSize().measure("w-italic")
            Text("***Weight***").fixedSize().measure("w-md-both")
            Text("Weight").bold().italic().fixedSize().measure("w-bold-italic")
            Text("`Weight`").fixedSize().measure("w-md-code")
            Text("Weight").monospaced().fixedSize().measure("w-monospaced")
            Text("Weight").font(.body.monospaced()).fixedSize().measure("w-body-monospaced")
            Text("**Weight**").font(.title).fixedSize().measure("w-md-bold-title")
            Text("Weight").font(.title).bold().fixedSize().measure("w-bold-title")
        }
        .padding()
    }
}

// MARK: - Interpolated strings
//
// A String put into a literal is not Markdown, nor is a String variable or verbatim text.

struct InterpolatedScreen: View {
    let name = "**Ann**"

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Hi \(name), **welcome**").measure("interp-mixed")
            Text(name).measure("interp-variable")
            Text(verbatim: "**Verbatim**").measure("interp-verbatim")
            Text("Plain **\(name)**").measure("interp-wrapped")
        }
        .padding()
    }
}

// MARK: - AttributedString
//
// Whole-string attributes, joined strings and the Markdown initialiser.

struct AttributedScreen: View {
    var greeting: AttributedString {
        var hello = AttributedString("Hello")
        hello.foregroundColor = .red
        hello.font = .title.bold()
        var world = AttributedString(" world")
        world.foregroundColor = .blue
        return hello + world
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(greeting).measure("attr-joined")
            Text(AttributedString("Plain string")).measure("attr-plain")
            Text((try? AttributedString(markdown: "**Bold** and [link](https://apple.com)")) ?? "").measure("attr-markdown")
            Text("\(greeting.characters.count) characters").measure("attr-count")
        }
        .padding()
    }
}

// MARK: - Images inside text
//
// An image between capital H's, so the H's ink gives the baseline and cap height and the
// red image's ink its size and place, at body and at large title, by interpolation and by +.

struct TextImageScreen: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("HH").fixedSize().measure("img-ref-body")
            Text("H\(Text(Image(systemName: "star.fill")).foregroundStyle(.red))H").fixedSize().measure("img-star-body")
            Text("H\(Text(Image(systemName: "heart.fill")).foregroundStyle(.red))H").fixedSize().measure("img-heart-body")
            Text("H\(Text(Image(systemName: "person")).foregroundStyle(.red))H").fixedSize().measure("img-person-body")
            Text("Rated \(Image(systemName: "star.fill")) 4.8").fixedSize().measure("img-rated-body")
            (Text(Image(systemName: "heart.fill")) + Text(" Favourites")).fixedSize().measure("img-plus-body")
            Text("HH").font(.largeTitle).fixedSize().measure("img-ref-large")
            Text("H\(Text(Image(systemName: "star.fill")).foregroundStyle(.red))H").font(.largeTitle).fixedSize().measure("img-star-large")
            Text("H\(Text(Image(systemName: "heart.fill")).foregroundStyle(.red))H").font(.largeTitle).fixedSize().measure("img-heart-large")
            Text("Rated \(Image(systemName: "star.fill")) 4.8").font(.largeTitle).fixedSize().measure("img-rated-large")
            Text("Go \(Image(systemName: "chevron.right"))").foregroundStyle(.blue).fixedSize().measure("img-tinted")
        }
        .padding()
    }
}

// MARK: - Symbol variants
//
// One symbol per variant chain, in order, so each draws the composed name or the base.

struct SymbolVariantScreen: View {
    let rows: [(String, String, SymbolVariants)] = [
        ("none", "star", .none),
        ("fill", "star", .fill),
        ("circle", "star", .circle),
        ("fill.circle", "star", .fill.circle),
        ("circle.fill", "star", .circle.fill),
        ("square", "star", .square),
        ("slash", "star", .slash),
        ("rectangle", "person", .rectangle),
        ("fill.square", "heart", .fill.square),
        ("square-missing", "folder", .square),
        ("slash-missing", "house", .slash),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(rows, id: \.0) { row in
                HStack {
                    Image(systemName: row.1)
                        .symbolVariant(row.2)
                        .font(.title)
                        .frame(width: 44, height: 36)
                        .measure("sym-\(row.0)")
                    Text("\(row.1) .\(row.0)")
                }
            }
            Label("Inbox", systemImage: "tray").symbolVariant(.fill).measure("sym-label-fill")
        }
        .padding()
    }
}

// MARK: - Built-in font families
//
// Families iOS ships, by family and by PostScript name, and one it doesn't, at 22 points.

struct FontsScreen: View {
    let families = [
        "Avenir Next", "AvenirNext-DemiBold", "Georgia", "Menlo", "Helvetica Neue", "Futura",
        "Gill Sans", "Palatino", "Courier New", "Times New Roman", "Snell Roundhand", "Brand Sans",
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(families, id: \.self) { family in
                Text("Hamburgefonts \(family)")
                    .font(.custom(family, size: 22))
                    .fixedSize()
                    .measure("font-\(family)")
            }
        }
        .padding()
    }
}

// MARK: - Masks and zIndex
//
// Gradient text through a text mask, a colour through a shape and a symbol mask, a mask
// placed by alignment, and a circle raised above a later sibling by zIndex.

struct MasksScreen: View {
    var body: some View {
        VStack(spacing: 16) {
            LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing)
                .frame(width: 240, height: 60)
                .mask(Text("Gradient").font(.largeTitle.bold()))
                .measure("mask-text")
            Color.blue
                .frame(width: 100, height: 100)
                .mask(Circle())
                .measure("mask-circle")
            Color.orange
                .frame(width: 100, height: 100)
                .mask { Image(systemName: "star.fill").font(.system(size: 80)) }
                .measure("mask-symbol")
            Color.green
                .frame(width: 100, height: 100)
                .mask(alignment: .topLeading) { Circle().frame(width: 50, height: 50) }
                .measure("mask-aligned")
            ZStack {
                Circle().fill(.red).frame(width: 80, height: 80).offset(x: -20).zIndex(1)
                Circle().fill(.blue).frame(width: 80, height: 80).offset(x: 20)
            }
            .measure("zindex")
        }
        .padding()
    }
}

// MARK: - Apple's parser, beyond the marks
//
// What Text draws for a bare URL, an email address, www., an autolink in angle brackets, a
// single tilde, an HTML entity, a link whose URL has parentheses, and asterisks around a
// value put into the literal with a letter on each side.

struct ParserScreen: View {
    let name = "Ann"

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Visit https://apple.com now").fixedSize().measure("p-url")
            Text("Mail support@apple.com now").fixedSize().measure("p-email")
            Text("Go to www.apple.com now").fixedSize().measure("p-www")
            Text("Open <https://apple.com> now").fixedSize().measure("p-angle")
            Text("One ~tilde~ here").fixedSize().measure("p-tilde")
            Text("Fish &amp; chips &lt;3").fixedSize().measure("p-entity")
            Text("A [link](https://a.com/(x)) after").fixedSize().measure("p-parens")
            Text("x**\(name)**y").fixedSize().measure("p-atom")
            Text("**Bold** \(Image(systemName: "star.fill")) *it*").fixedSize().measure("p-image")
            Text("**Hi** \(Text("there").italic())").fixedSize().measure("p-text")
            Text("**Hi \(Text("there"))**").fixedSize().measure("p-text-inside")
        }
        .padding()
    }
}

// MARK: - AttributedString, more members
//
// An AttributedString put into a literal, the .swiftUI scope, the localized initialiser,
// AttributeContainer, and each inline presentation intent on the word "Weight", whose
// widths compare with the markdown-weights screen.

struct AttributedMoreScreen: View {
    var inserted: AttributedString {
        var text = AttributedString("inside")
        text.foregroundColor = .red
        return text
    }

    var scoped: AttributedString {
        var text = AttributedString("Scoped")
        text.swiftUI.foregroundColor = .red
        return text
    }

    var contained: AttributedString {
        var container = AttributeContainer()
        container.foregroundColor = .red
        return AttributedString("Contained", attributes: container)
    }

    var merged: AttributedString {
        var text = AttributedString("Weight")
        text.foregroundColor = .blue
        var container = AttributeContainer()
        container.font = .body.bold()
        text.mergeAttributes(container)
        return text
    }

    var replaced: AttributedString {
        var text = AttributedString("Weight")
        text.font = .body.bold()
        var container = AttributeContainer()
        container.foregroundColor = .red
        text.setAttributes(container)
        return text
    }

    func intent(_ intent: InlinePresentationIntent) -> AttributedString {
        var text = AttributedString("Weight")
        text.inlinePresentationIntent = intent
        return text
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("x \(inserted) y").fixedSize().measure("am-inserted")
            Text(scoped).fixedSize().measure("am-scoped")
            Text(AttributedString(localized: "**Weight**")).fixedSize().measure("am-localized")
            Text(contained).fixedSize().measure("am-contained")
            Text(merged).fixedSize().measure("am-merged")
            Text(replaced).fixedSize().measure("am-replaced")
            Text(intent(.stronglyEmphasized)).fixedSize().measure("am-strong")
            Text(intent(.emphasized)).fixedSize().measure("am-emphasized")
            Text(intent(.code)).fixedSize().measure("am-code")
            Text(intent(.strikethrough)).fixedSize().measure("am-strike")
        }
        .padding()
    }
}

// MARK: - Titles and symbols, more
//
// Markdown in Toggle, Link and NavigationLink titles and in a LocalizedStringKey variable,
// the symbolVariants environment value, a variant on a stack, a symbol in text under a
// gradient, an asset image in text, and a shape mask painted at 30%.

struct TitlesMoreScreen: View {
    let key: LocalizedStringKey = "**Key** var"

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Toggle("**Bold** toggle", isOn: .constant(true)).measure("t-toggle")
                Link("**Bold** link", destination: URL(string: "https://apple.com")!).measure("t-link")
                NavigationLink("**Bold** nav") { Text("Next") }.measure("t-navlink")
                Text(key).fixedSize().measure("t-key")
                Image(systemName: "star").environment(\.symbolVariants, .fill).font(.title).measure("t-env-fill")
                VStack { Image(systemName: "gear") }.symbolVariant(.fill.circle).font(.title).measure("t-gear")
                Text("Go \(Image(systemName: "star.fill")) now")
                    .font(.largeTitle)
                    .foregroundStyle(LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing))
                    .fixedSize()
                    .measure("t-gradient")
                Text("HH").fixedSize().measure("t-ref")
                Text("H\(Image("photo"))H").fixedSize().measure("t-named")
                (Text(Image("photo")) + Text("H")).fixedSize().measure("t-named-plus")
                Text("H\(Image("photo"))H").font(.largeTitle).fixedSize().measure("t-named-large")
                Color.blue
                    .frame(width: 60, height: 60)
                    .mask(Circle().fill(.black.opacity(0.3)))
                    .measure("t-mask-opacity")
            }
            .padding()
        }
    }
}

// MARK: - The tab bar's symbols
//
// A TabView's items draw their symbols filled, with .symbolVariant(.none) on the TabView
// and on each item's Label.

struct TabsScreen: View {
    let variant: SymbolVariants?
    var onLabel = false

    var body: some View {
        if let variant {
            tabs.symbolVariant(variant)
        } else {
            tabs
        }
    }

    var tabs: some View {
        TabView {
            Text("Home").tabItem { item("Home", "house") }
            Text("Inbox").tabItem { item("Inbox", "tray") }
        }
    }

    @ViewBuilder
    func item(_ title: String, _ symbol: String) -> some View {
        if onLabel {
            Label(title, systemImage: symbol).symbolVariant(.none)
        } else {
            Label(title, systemImage: symbol)
        }
    }
}
