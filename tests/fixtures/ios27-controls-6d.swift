import SwiftUI

// Native reference fixture for Wave 6d: DatePicker styles (compact pills in a Form and
// outside one, graphical, wheel), the ColorPicker swatch, content margins, safe area
// padding, view-aligned scrolling and MeshGradient. One screen per launch, picked with
// `-screen <name>` (the arguments domain of UserDefaults). Each measured view prints
// "MEASURE <name> x y width height" in points, read by launching with
// `simctl launch --console-pty`. Geometry is in points on a 402 x 874 pt iPhone 18 Pro.

@main
struct NativeControlsApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct RootView: View {
    let screen = UserDefaults.standard.string(forKey: "screen") ?? "compact-form"

    var body: some View {
        switch screen {
        case "compact-form": CompactFormScreen()
        case "compact-plain": CompactPlainScreen()
        case "graphical": GraphicalScreen(components: .date)
        case "graphical-both": GraphicalScreen(components: [.date, .hourAndMinute])
        case "graphical-six": GraphicalScreen(components: .date, date: sixWeekDate)
        case "compact-text": CompactTextScreen()
        case "wheel": WheelScreen()
        case "wheel-form": WheelFormScreen()
        case "color": ColorScreen()
        case "margins": MarginsScreen()
        case "margins-placement": MarginsPlacementScreen()
        case "aligned-probe": MarginsScreen().onAppear(perform: probeSnapping)
        case "aligned-variants": AlignedVariantsScreen().onAppear(perform: probeSnapping)
        case "margins-vertical": MarginsVerticalScreen(mixed: false)
        case "margins-mixed": MarginsVerticalScreen(mixed: true)
        case "margins-list": MarginsListScreen(top: true)
        case "list-plain": MarginsListScreen(top: false)
        case "list-mixed": MarginsListScreen(top: true, mixed: true)
        case "list-header": MarginsListScreen(top: false, header: true)
        case "list-header-top": MarginsListScreen(top: true, header: true)
        case "safe-area": SafeAreaScreen()
        case "mesh": MeshScreen()
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

/// 15 June 2026 at 9:41 in the device's own time zone, so every capture shows the same value.
let fixedDate = Calendar.current.date(from: DateComponents(year: 2026, month: 6, day: 15, hour: 9, minute: 41))!

/// 15 August 2026, a month that starts on a Saturday and so spans six weeks.
let sixWeekDate = Calendar.current.date(from: DateComponents(year: 2026, month: 8, day: 15, hour: 9, minute: 41))!

// MARK: - Compact, the default style
//
// Date only, time only, and both, in a Form and in a padded stack.

struct CompactFormScreen: View {
    @State private var date = fixedDate

    var body: some View {
        Form {
            DatePicker("Date", selection: $date, displayedComponents: .date).measure("form-date")
            DatePicker("Time", selection: $date, displayedComponents: .hourAndMinute).measure("form-time")
            DatePicker("Both", selection: $date).measure("form-both")
            DatePicker("Compact", selection: $date).datePickerStyle(.compact).measure("form-compact")
        }
    }
}

struct CompactPlainScreen: View {
    @State private var date = fixedDate

    var body: some View {
        VStack(spacing: 16) {
            DatePicker("Date", selection: $date, displayedComponents: .date).measure("plain-date")
            DatePicker("Time", selection: $date, displayedComponents: .hourAndMinute).measure("plain-time")
            DatePicker("Both", selection: $date).measure("plain-both")
            DatePicker(selection: $date) { Text("Closure") }.measure("plain-closure")
        }
        .padding()
    }
}

/// The pills' titles as plain body text, for the padding around them.
struct CompactTextScreen: View {
    var body: some View {
        VStack(spacing: 16) {
            Text("Jun 15, 2026").measure("text-date")
            Text("9:41 AM").measure("text-time")
            Text("9:41 AM").monospacedDigit().measure("text-time-mono")
        }
    }
}

// MARK: - Graphical
//
// The inline month calendar, date only and with the time row under it.

struct GraphicalScreen: View {
    let components: DatePickerComponents
    @State var date = fixedDate

    var body: some View {
        VStack(spacing: 0) {
            DatePicker("Date", selection: $date, displayedComponents: components)
                .datePickerStyle(.graphical)
                .measure("graphical")
        }
        .padding()
    }
}

// MARK: - Wheel
//
// Spinning columns: both halves, date only and time only, with their titles.

struct WheelScreen: View {
    @State private var date = fixedDate

    var body: some View {
        VStack(spacing: 8) {
            DatePicker("Both", selection: $date).datePickerStyle(.wheel).measure("wheel-both")
            DatePicker("Date", selection: $date, displayedComponents: .date).datePickerStyle(.wheel).measure("wheel-date")
            DatePicker("Time", selection: $date, displayedComponents: .hourAndMinute).datePickerStyle(.wheel).measure("wheel-time")
        }
        .padding()
    }
}

struct WheelFormScreen: View {
    @State private var date = fixedDate

    var body: some View {
        Form {
            DatePicker("Date", selection: $date, displayedComponents: .date).datePickerStyle(.wheel).measure("wheel-form-date")
            DatePicker("Time", selection: $date, displayedComponents: .hourAndMinute).datePickerStyle(.wheel).measure("wheel-form-time")
        }
    }
}

// MARK: - ColorPicker
//
// The swatch in a Form and outside one, opaque and translucent.

struct ColorScreen: View {
    @State private var tint = Color(red: 1, green: 0, blue: 0)
    @State private var faded = Color(red: 0, green: 0, blue: 1).opacity(0.5)

    var body: some View {
        VStack(spacing: 0) {
            Form {
                ColorPicker("Tint", selection: $tint).measure("form-color")
                ColorPicker("Faded", selection: $faded).measure("form-faded")
            }
            .frame(height: 220)
            VStack(spacing: 16) {
                ColorPicker("Tint", selection: $tint).measure("plain-color")
                ColorPicker("Opaque", selection: $tint, supportsOpacity: false).measure("plain-opaque")
            }
            .padding()
            Spacer()
        }
    }
}

// MARK: - Content margins
//
// A carousel of 300 pt cards inset 24 on each side and aligned to them, the margin given to
// the indicators only, and automatic, vertically, and on a List.

struct Cards: View {
    let prefix: String

    var body: some View {
        HStack(spacing: 12) {
            ForEach(0..<5) { i in
                RoundedRectangle(cornerRadius: 16)
                    .fill(i % 2 == 0 ? Color(red: 0, green: 0.5, blue: 1) : Color(red: 1, green: 0.6, blue: 0))
                    .frame(width: 300, height: 120)
                    .measure("\(prefix)-\(i)")
            }
        }
        .scrollTargetLayout()
    }
}

struct MarginsScreen: View {
    var body: some View {
        VStack(spacing: 24) {
            ScrollView(.horizontal) {
                Cards(prefix: "content")
            }
            .contentMargins(.horizontal, 24, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            .measure("content-scroll")
            ScrollView(.horizontal) {
                Cards(prefix: "aligned")
            }
            .scrollTargetBehavior(.viewAligned)
            .measure("aligned-scroll")
            Spacer()
        }
        .padding(.top, 80)
    }
}

/// View-aligned scroll views whose cards are marked differently, top to bottom: not marked,
/// a marked LazyHStack, and a marked HStack inside a VStack.
struct AlignedVariantsScreen: View {
    var body: some View {
        VStack(spacing: 24) {
            ScrollView(.horizontal) {
                HStack(spacing: 12) {
                    ForEach(0..<5) { _ in Color.blue.frame(width: 300, height: 120) }
                }
            }
            .scrollTargetBehavior(.viewAligned)
            ScrollView(.horizontal) {
                LazyHStack(spacing: 12) {
                    ForEach(0..<5) { _ in Color.orange.frame(width: 300, height: 120) }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            ScrollView(.horizontal) {
                VStack {
                    HStack(spacing: 12) {
                        ForEach(0..<5) { _ in Color.green.frame(width: 300, height: 120) }
                    }
                    .scrollTargetLayout()
                }
            }
            .scrollTargetBehavior(.viewAligned)
            Spacer()
        }
        .padding(.top, 80)
    }
}

struct MarginsPlacementScreen: View {
    var body: some View {
        VStack(spacing: 24) {
            ScrollView(.horizontal) {
                Cards(prefix: "indicators")
            }
            .contentMargins(.horizontal, 24, for: .scrollIndicators)
            ScrollView(.horizontal) {
                Cards(prefix: "automatic")
            }
            .contentMargins(.horizontal, 24)
            ScrollView(.horizontal) {
                Cards(prefix: "all")
            }
            .contentMargins(10)
            .measure("all-scroll")
            Spacer()
        }
        .padding(.top, 80)
    }
}

struct VerticalCards: View {
    var body: some View {
        VStack(spacing: 12) {
            ForEach(0..<3) { i in
                Color.blue.frame(height: 80).measure("vertical-\(i)")
            }
        }
    }
}

/// With `mixed`, a margin for `.scrollContent` alone is written around the automatic one.
struct MarginsVerticalScreen: View {
    let mixed: Bool

    var body: some View {
        if mixed {
            ScrollView { VerticalCards() }
                .contentMargins(.vertical, 40)
                .contentMargins(.horizontal, 30, for: .scrollContent)
                .measure("vertical-scroll")
        } else {
            ScrollView { VerticalCards() }
                .contentMargins(.vertical, 40)
                .measure("vertical-scroll")
        }
    }
}

struct ListRows: View {
    var header = false

    var body: some View {
        if header {
            Section("Header") {
                ForEach(0..<3) { i in
                    Text("Row \(i)").measure("list-\(i)")
                }
            }
        } else {
            ForEach(0..<3) { i in
                Text("Row \(i)").measure("list-\(i)")
            }
        }
    }
}

/// No margin, a top margin, or a top margin with a horizontal one for `.scrollContent` around it.
struct MarginsListScreen: View {
    let top: Bool
    var mixed = false
    var header = false

    var body: some View {
        if mixed {
            List { ListRows(header: header) }
                .contentMargins(.top, 40)
                .contentMargins(.horizontal, 40, for: .scrollContent)
                .measure("list-scroll")
        } else if top {
            List { ListRows(header: header) }
                .contentMargins(.top, 40)
                .measure("list-scroll")
        } else {
            List { ListRows(header: header) }
                .measure("list-scroll")
        }
    }
}

/// Asks each horizontal scroll view where a drag released at rest would settle, by calling its
/// delegate as UIKit does at the end of a drag, and prints "SNAP <inset> <proposed> <settled>":
/// the content offsets of a view-aligned scroll view, which is all its snapping changes.
func probeSnapping() {
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
        let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene
        var found: [UIScrollView] = []
        func walk(_ view: UIView) {
            if let scroll = view as? UIScrollView, scroll.contentSize.width > scroll.bounds.width { found.append(scroll) }
            view.subviews.forEach(walk)
        }
        scene?.windows.forEach(walk)
        for scroll in found {
            print("SCROLL \(scroll.convert(scroll.bounds, to: nil).minY)")
            for proposed in [30.0, 100, 150, 200, 400, 700] {
                var target = CGPoint(x: proposed - scroll.adjustedContentInset.left, y: scroll.contentOffset.y)
                scroll.delegate?.scrollViewWillEndDragging?(scroll, withVelocity: .zero, targetContentOffset: &target)
                print("SNAP \(scroll.adjustedContentInset.left) \(proposed) \(target.x + scroll.adjustedContentInset.left)")
            }
        }
    }
}

// MARK: - Safe area padding

struct SafeAreaScreen: View {
    var body: some View {
        VStack(spacing: 24) {
            ScrollView(.horizontal) {
                Cards(prefix: "safe")
            }
            .safeAreaPadding(.horizontal, 24)
            .measure("safe-scroll")
            Text("Inset")
                .background(Color.yellow)
                .measure("safe-text")
                .safeAreaPadding(20)
                .background(Color.blue)
                .measure("safe-outer")
            Spacer()
        }
        .padding(.top, 80)
    }
}

// MARK: - MeshGradient
//
// A 3 x 3 mesh with its middle point moved, smooth and not, each 300 pt tall.

struct MeshScreen: View {
    let points: [SIMD2<Float>] = [
        [0, 0], [0.5, 0], [1, 0],
        [0, 0.5], [0.8, 0.3], [1, 0.5],
        [0, 1], [0.5, 1], [1, 1],
    ]
    let colors: [Color] = [
        Color(red: 1, green: 0, blue: 0), Color(red: 0.5, green: 0, blue: 0.5), Color(red: 0, green: 0, blue: 1),
        Color(red: 1, green: 0.5, blue: 0), Color(red: 1, green: 1, blue: 1), Color(red: 0, green: 0.5, blue: 1),
        Color(red: 1, green: 1, blue: 0), Color(red: 0, green: 1, blue: 0), Color(red: 0, green: 1, blue: 1),
    ]

    var body: some View {
        VStack(spacing: 20) {
            MeshGradient(width: 3, height: 3, points: points, colors: colors)
                .frame(height: 300)
                .measure("mesh-smooth")
            MeshGradient(width: 3, height: 3, points: points, colors: colors, smoothsColors: false)
                .frame(height: 300)
                .measure("mesh-linear")
        }
        .padding(.horizontal)
    }
}
