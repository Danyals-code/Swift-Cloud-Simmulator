import SwiftUI

// Native reference fixture: one screen per launch, picked with `-screen <name>`
// (the arguments domain of UserDefaults). Geometry is in points on a
// 402 x 874 pt iPhone 18 Pro; pages that need exact positions ignore the safe
// area so their coordinate space is the screen itself.

@main
struct NativeMisrendersApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct RootView: View {
    let screen = UserDefaults.standard.string(forKey: "screen") ?? "colors"

    var body: some View {
        switch screen {
        case "colors": ColorsScreen(backdrop: .white)
        case "colors-black": ColorsScreen(backdrop: .black)
        case "trim": TrimScreen()
        case "trim2": TrimExtrasScreen()
        case "arcs": ArcsScreen()
        case "safe-bg-color": SafeBackgroundColor()
        case "safe-bg-style": SafeBackgroundStyle()
        case "safe-bg-gradient": SafeBackgroundGradient()
        case "safe-bg-closure": SafeBackgroundClosure()
        case "safe-bg-ignoring": SafeBackgroundIgnoring()
        case "safe-zstack": SafeZStack()
        case "safe-keyboard": SafeKeyboard()
        case "safe-top-edge": SafeTopEdge()
        case "safe-nav-grouped": SafeNavGrouped()
        case "safe-nav-red": SafeNavRed()
        case "safe-tab-red": SafeTabRed()
        case "safe-scroll-red": SafeScrollRed()
        case "search-root": SearchRoot()
        case "search-pushed": SearchPushed()
        case "sheet-on-stack": SheetOnStack()
        case "sheet-on-tab-stack": SheetOnTabStack()
        case "alert-on-stack": AlertOnStack()
        case "dialog-on-stack": DialogOnStack()
        case "search-on-tabview": SearchOnTabView()
        default: Text("Unknown screen: \(screen)")
        }
    }
}

// MARK: - Fixed geometry helpers

/// A full-screen page whose coordinate space is the screen, in points.
struct Page<Content: View>: View {
    var backdrop: Color = .white
    @ViewBuilder var content: () -> Content

    var body: some View {
        ZStack(alignment: .topLeading) {
            backdrop
            content()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea()
    }
}

extension View {
    /// Sizes the view to width x height and puts its top-left corner at (x, y) on the page.
    func placed(x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) -> some View {
        frame(width: width, height: height)
            .position(x: x + width / 2, y: y + height / 2)
    }
}

// MARK: - 1. Colours

/// 50 x 50 pt swatches, 8 pt gaps, 6 per row, the first at (10, 80) pt.
struct ColorsScreen: View {
    var backdrop: Color

    static var swatches: [(name: String, style: AnyShapeStyle)] {
        [
            // UIKit greys
            ("Color(.systemGray)", AnyShapeStyle(Color(.systemGray))),
            ("Color(.systemGray2)", AnyShapeStyle(Color(.systemGray2))),
            ("Color(.systemGray3)", AnyShapeStyle(Color(.systemGray3))),
            ("Color(.systemGray4)", AnyShapeStyle(Color(.systemGray4))),
            ("Color(.systemGray5)", AnyShapeStyle(Color(.systemGray5))),
            ("Color(.systemGray6)", AnyShapeStyle(Color(.systemGray6))),
            // UIKit hues
            ("Color(.systemRed)", AnyShapeStyle(Color(.systemRed))),
            ("Color(.systemOrange)", AnyShapeStyle(Color(.systemOrange))),
            ("Color(.systemYellow)", AnyShapeStyle(Color(.systemYellow))),
            ("Color(.systemGreen)", AnyShapeStyle(Color(.systemGreen))),
            ("Color(.systemMint)", AnyShapeStyle(Color(.systemMint))),
            ("Color(.systemTeal)", AnyShapeStyle(Color(.systemTeal))),
            ("Color(.systemCyan)", AnyShapeStyle(Color(.systemCyan))),
            ("Color(.systemBlue)", AnyShapeStyle(Color(.systemBlue))),
            ("Color(.systemIndigo)", AnyShapeStyle(Color(.systemIndigo))),
            ("Color(.systemPurple)", AnyShapeStyle(Color(.systemPurple))),
            ("Color(.systemPink)", AnyShapeStyle(Color(.systemPink))),
            ("Color(.systemBrown)", AnyShapeStyle(Color(.systemBrown))),
            // UIKit text and separators
            ("Color(.label)", AnyShapeStyle(Color(.label))),
            ("Color(.secondaryLabel)", AnyShapeStyle(Color(.secondaryLabel))),
            ("Color(.tertiaryLabel)", AnyShapeStyle(Color(.tertiaryLabel))),
            ("Color(.quaternaryLabel)", AnyShapeStyle(Color(.quaternaryLabel))),
            ("Color(.separator)", AnyShapeStyle(Color(.separator))),
            ("Color(.opaqueSeparator)", AnyShapeStyle(Color(.opaqueSeparator))),
            ("Color(.placeholderText)", AnyShapeStyle(Color(.placeholderText))),
            ("Color(.link)", AnyShapeStyle(Color(.link))),
            // UIKit backgrounds
            ("Color(.systemBackground)", AnyShapeStyle(Color(.systemBackground))),
            ("Color(.secondarySystemBackground)", AnyShapeStyle(Color(.secondarySystemBackground))),
            ("Color(.tertiarySystemBackground)", AnyShapeStyle(Color(.tertiarySystemBackground))),
            ("Color(.systemGroupedBackground)", AnyShapeStyle(Color(.systemGroupedBackground))),
            ("Color(.secondarySystemGroupedBackground)", AnyShapeStyle(Color(.secondarySystemGroupedBackground))),
            ("Color(.tertiarySystemGroupedBackground)", AnyShapeStyle(Color(.tertiarySystemGroupedBackground))),
            // UIKit fills
            ("Color(.systemFill)", AnyShapeStyle(Color(.systemFill))),
            ("Color(.secondarySystemFill)", AnyShapeStyle(Color(.secondarySystemFill))),
            ("Color(.tertiarySystemFill)", AnyShapeStyle(Color(.tertiarySystemFill))),
            ("Color(.quaternarySystemFill)", AnyShapeStyle(Color(.quaternarySystemFill))),
            // SwiftUI named colours
            ("Color.red", AnyShapeStyle(Color.red)),
            ("Color.orange", AnyShapeStyle(Color.orange)),
            ("Color.yellow", AnyShapeStyle(Color.yellow)),
            ("Color.green", AnyShapeStyle(Color.green)),
            ("Color.mint", AnyShapeStyle(Color.mint)),
            ("Color.teal", AnyShapeStyle(Color.teal)),
            ("Color.cyan", AnyShapeStyle(Color.cyan)),
            ("Color.blue", AnyShapeStyle(Color.blue)),
            ("Color.indigo", AnyShapeStyle(Color.indigo)),
            ("Color.purple", AnyShapeStyle(Color.purple)),
            ("Color.pink", AnyShapeStyle(Color.pink)),
            ("Color.brown", AnyShapeStyle(Color.brown)),
            ("Color.gray", AnyShapeStyle(Color.gray)),
            ("Color.primary", AnyShapeStyle(Color.primary)),
            ("Color.secondary", AnyShapeStyle(Color.secondary)),
            // Hierarchical styles, resolved exactly like `.fill(.primary)` and so on
            (".primary", AnyShapeStyle(.primary)),
            (".secondary", AnyShapeStyle(.secondary)),
            (".tertiary", AnyShapeStyle(.tertiary)),
            (".quaternary", AnyShapeStyle(.quaternary)),
            (".quinary", AnyShapeStyle(.quinary)),
            ("Color.blue.secondary", AnyShapeStyle(Color.blue.secondary)),
            ("Color.blue.tertiary", AnyShapeStyle(Color.blue.tertiary)),
            // Component colours
            ("Color(hue: 0.6, saturation: 0.8, brightness: 0.9)", AnyShapeStyle(Color(hue: 0.6, saturation: 0.8, brightness: 0.9))),
            ("Color(white: 0.5)", AnyShapeStyle(Color(white: 0.5))),
            ("Color(white: 0.5, opacity: 0.5)", AnyShapeStyle(Color(white: 0.5, opacity: 0.5))),
            ("Color(red: 0.2, green: 0.4, blue: 0.6)", AnyShapeStyle(Color(red: 0.2, green: 0.4, blue: 0.6))),
        ]
    }

    var body: some View {
        let swatches = Self.swatches
        Page(backdrop: backdrop) {
            ForEach(0..<swatches.count, id: \.self) { index in
                Rectangle()
                    .fill(swatches[index].style)
                    .placed(
                        x: 10 + CGFloat(index % 6) * 58,
                        y: 80 + CGFloat(index / 6) * 58,
                        width: 50,
                        height: 50
                    )
            }
        }
    }
}

// MARK: - 2. Trim

struct TrimScreen: View {
    var body: some View {
        Page {
            // Row 1, y 90
            Circle().trim(from: 0, to: 0.25).stroke(Color.red, lineWidth: 8)
                .placed(x: 16, y: 90, width: 110, height: 110)
            Circle().trim(from: 0, to: 0.25).stroke(Color.red, lineWidth: 8)
                .rotationEffect(.degrees(-90))
                .placed(x: 146, y: 90, width: 110, height: 110)
            Circle().trim(from: 0.25, to: 0.5).stroke(Color.red, lineWidth: 8)
                .placed(x: 276, y: 90, width: 110, height: 110)
            // Row 2, y 230
            Rectangle().trim(from: 0, to: 0.25).stroke(Color.red, lineWidth: 8)
                .placed(x: 16, y: 230, width: 110, height: 110)
            RoundedRectangle(cornerRadius: 24).trim(from: 0, to: 0.25).stroke(Color.red, lineWidth: 8)
                .placed(x: 146, y: 230, width: 110, height: 110)
            Capsule().trim(from: 0, to: 0.25).stroke(Color.red, lineWidth: 8)
                .placed(x: 276, y: 230, width: 110, height: 60)
            // Row 3, y 370
            Ellipse().trim(from: 0, to: 0.25).stroke(Color.red, lineWidth: 8)
                .placed(x: 16, y: 370, width: 110, height: 60)
            Circle().trim(from: 0, to: 0.5).fill(Color.red)
                .placed(x: 146, y: 370, width: 110, height: 110)
            Circle().trim(from: 0, to: 0).stroke(Color.red, lineWidth: 8)
                .placed(x: 276, y: 370, width: 110, height: 110)
        }
    }
}

/// Extra trims that pin down where each shape's path starts (the end shared with the 0...0.25
/// trim on the `trim` screen) and whether trim is measured along the path length.
struct TrimExtrasScreen: View {
    var body: some View {
        Page {
            // Row 1, y 90
            Rectangle().trim(from: 0, to: 0.1).stroke(Color.red, lineWidth: 8)
                .placed(x: 16, y: 90, width: 110, height: 110)
            RoundedRectangle(cornerRadius: 24).trim(from: 0, to: 0.1).stroke(Color.red, lineWidth: 8)
                .placed(x: 146, y: 90, width: 110, height: 110)
            Capsule().trim(from: 0, to: 0.1).stroke(Color.red, lineWidth: 8)
                .placed(x: 276, y: 90, width: 110, height: 60)
            // Row 2, y 240
            Ellipse().trim(from: 0, to: 0.1).stroke(Color.red, lineWidth: 8)
                .placed(x: 16, y: 240, width: 110, height: 60)
            Rectangle().trim(from: 0, to: 0.25).stroke(Color.red, lineWidth: 8)
                .placed(x: 146, y: 240, width: 110, height: 60)
            Capsule().trim(from: 0, to: 0.25).stroke(Color.red, lineWidth: 8)
                .placed(x: 301, y: 230, width: 60, height: 110)
            // Row 3, y 380
            RoundedRectangle(cornerRadius: 24).trim(from: 0, to: 0.25).stroke(Color.red, lineWidth: 8)
                .placed(x: 16, y: 380, width: 110, height: 60)
            Circle().trim(from: 0, to: 0.1).stroke(Color.red, lineWidth: 8)
                .placed(x: 146, y: 380, width: 110, height: 110)
        }
    }
}

// MARK: - 3. Arcs

struct ArcsScreen: View {
    @State private var progress = 0.65

    var body: some View {
        Page {
            // Row 1, y 90: quarter arcs from 12 o'clock to 3 o'clock
            Path { p in
                p.addArc(center: CGPoint(x: 55, y: 55), radius: 45, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
            }
            .stroke(Color.red, lineWidth: 8)
            .placed(x: 16, y: 90, width: 110, height: 110)

            Path { p in
                p.addArc(center: CGPoint(x: 55, y: 55), radius: 45, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: true)
            }
            .stroke(Color.red, lineWidth: 8)
            .placed(x: 146, y: 90, width: 110, height: 110)

            // Row 2: the Drawing template's progress ring, copied unchanged
            // (packages/project-model/src/templates.ts, DRAWING), centred at (201, 310).
            ZStack {
                Circle()
                    .stroke(Color.secondary.opacity(0.25), lineWidth: 14)

                Path { path in
                    path.addArc(
                        center: CGPoint(x: 70, y: 70),
                        radius: 63,
                        startAngle: .degrees(-90),
                        endAngle: .degrees(270),
                        clockwise: true
                    )
                }
                .trim(from: 0, to: progress)
                .stroke(Color.accentColor, lineWidth: 14)

                Text("\(Int(progress * 100))%")
                    .font(.title2)
                    .fontWeight(.semibold)
            }
            .frame(width: 140, height: 140)
            .position(x: 201, y: 310)

            // Row 3, y 440: the ring's path alone in red, untrimmed and trimmed to 0.65
            Path { path in
                path.addArc(
                    center: CGPoint(x: 70, y: 70),
                    radius: 63,
                    startAngle: .degrees(-90),
                    endAngle: .degrees(270),
                    clockwise: true
                )
            }
            .stroke(Color.red, lineWidth: 14)
            .placed(x: 40, y: 440, width: 140, height: 140)

            Path { path in
                path.addArc(
                    center: CGPoint(x: 70, y: 70),
                    radius: 63,
                    startAngle: .degrees(-90),
                    endAngle: .degrees(270),
                    clockwise: true
                )
            }
            .trim(from: 0, to: 0.65)
            .stroke(Color.red, lineWidth: 14)
            .placed(x: 222, y: 440, width: 140, height: 140)
        }
    }
}

// MARK: - 4. Safe area

struct SafeBackgroundColor: View {
    var body: some View {
        VStack { Text("Top"); Spacer(); Text("Bottom") }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.red)
    }
}

struct SafeBackgroundStyle: View {
    var body: some View {
        VStack { Text("Top"); Spacer(); Text("Bottom") }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.red)
    }
}

struct SafeBackgroundGradient: View {
    var body: some View {
        VStack { Text("Top"); Spacer(); Text("Bottom") }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(LinearGradient(colors: [.red, .blue], startPoint: .top, endPoint: .bottom))
    }
}

struct SafeBackgroundClosure: View {
    var body: some View {
        VStack { Text("Top"); Spacer(); Text("Bottom") }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { Color.red }
    }
}

struct SafeBackgroundIgnoring: View {
    var body: some View {
        VStack { Text("Top"); Spacer(); Text("Bottom") }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.red.ignoresSafeArea())
    }
}

struct SafeZStack: View {
    var body: some View {
        ZStack {
            Color.blue.ignoresSafeArea()
            VStack { Text("Title"); Spacer(); Text("Footer") }
        }
    }
}

struct SafeKeyboard: View {
    var body: some View {
        VStack { Text("Top"); Spacer(); Text("Bottom") }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { Color.red }
            .ignoresSafeArea(.keyboard)
    }
}

struct SafeTopEdge: View {
    var body: some View {
        VStack(spacing: 0) {
            Color.red.frame(height: 200).ignoresSafeArea(edges: .top)
            Spacer()
        }
    }
}

struct SafeNavGrouped: View {
    var body: some View {
        NavigationStack {
            VStack { Text("Row"); Spacer() }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(.systemGroupedBackground))
                .navigationTitle("Title")
        }
    }
}

struct SafeNavRed: View {
    var body: some View {
        NavigationStack {
            VStack { Text("Row"); Spacer() }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.red)
                .navigationTitle("Title")
        }
    }
}

struct SafeTabRed: View {
    var body: some View {
        TabView {
            VStack { Text("A"); Spacer() }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.red)
                .tabItem { Label("A", systemImage: "house") }
        }
    }
}

struct SafeScrollRed: View {
    var body: some View {
        ScrollView {
            VStack { ForEach(0..<40, id: \.self) { Text("Row \($0)") } }
        }
        .background(Color.red)
    }
}

// MARK: - 5. Container presentations

struct SearchRoot: View {
    @State private var q = ""

    var body: some View {
        NavigationStack {
            List(["a", "b"], id: \.self) { Text($0) }
                .navigationTitle("Home")
        }
        .searchable(text: $q)
    }
}

struct SearchPushed: View {
    @State private var q = ""
    @State private var path: [String] = ["detail"]

    var body: some View {
        NavigationStack(path: $path) {
            List(["a", "b"], id: \.self) { Text($0) }
                .navigationTitle("Home")
                .navigationDestination(for: String.self) { Text("Detail \($0)") }
        }
        .searchable(text: $q)
    }
}

struct SheetOnStack: View {
    @State private var show = true

    var body: some View {
        NavigationStack { Text("Root").navigationTitle("Home") }
            .sheet(isPresented: $show) { Text("Sheet") }
    }
}

struct SheetOnTabStack: View {
    @State private var show = true

    var body: some View {
        TabView {
            NavigationStack { Text("Tab root") }
                .sheet(isPresented: $show) { Text("Tab sheet") }
                .tabItem { Label("A", systemImage: "house") }
        }
    }
}

struct AlertOnStack: View {
    @State private var show = true

    var body: some View {
        NavigationStack { Text("Root").navigationTitle("Home") }
            .alert("Hello", isPresented: $show) { Button("OK", role: .cancel, action: {}) }
    }
}

struct DialogOnStack: View {
    @State private var show = true

    var body: some View {
        NavigationStack { Text("Root").navigationTitle("Home") }
            .confirmationDialog("Pick", isPresented: $show) { Button("One") {}; Button("Two") {} }
    }
}

struct SearchOnTabView: View {
    @State private var q = ""

    var body: some View {
        TabView { Text("A").tabItem { Label("A", systemImage: "house") } }
            .searchable(text: $q)
    }
}
