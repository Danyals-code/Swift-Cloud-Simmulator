import SwiftUI

// Native reference fixture for Wave 4c: a page-style TabView inside a screen, with its
// page dots shown automatically, always, never, and over a background of their own,
// and a ScrollView that pages. One screen per launch, picked with `-screen <name>` (the
// arguments domain of UserDefaults). Geometry is in points on a 402 x 874 pt iPhone 18
// Pro.

@main
struct NativeSystemUIApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct RootView: View {
    let screen = UserDefaults.standard.string(forKey: "screen") ?? "pager-automatic"

    var body: some View {
        switch screen {
        case "pager-automatic": Pager(mode: .automatic, background: false, colored: false)
        case "pager-always": Pager(mode: .always, background: false, colored: false)
        case "pager-never": Pager(mode: .never, background: false, colored: true)
        case "pager-background": Pager(mode: .always, background: true, colored: false)
        case "pager-colored": Pager(mode: .automatic, background: false, colored: true)
        case "pager-colored-background": Pager(mode: .automatic, background: true, colored: true)
        case "pager-selected": PagerSelected()
        case "pager-one-page": PagerOnePage(mode: .automatic)
        case "pager-one-page-always": PagerOnePage(mode: .always)
        case "pager-root": PagerRoot()
        case "scroll-paging": ScrollPaging(margins: false)
        case "scroll-paging-margins": ScrollPaging(margins: true)
        default: Text("Unknown screen: \(screen)")
        }
    }
}

// MARK: - A pager inside a screen
//
// A carousel 240 tall between a title and a button. Its pages are text on the screen's
// background, or on a colour that fills the page; the dots are shown automatically,
// always or never, with or without the background `.indexViewStyle` gives them.

struct Pager: View {
    let mode: PageTabViewStyle.IndexDisplayMode
    let background: Bool
    let colored: Bool

    var body: some View {
        VStack(spacing: 16) {
            Text("Welcome")
                .font(.largeTitle)
            if background {
                pages
                    .indexViewStyle(.page(backgroundDisplayMode: .always))
            } else {
                pages
            }
            Button("Continue") { }
        }
    }

    var pages: some View {
        TabView {
            page("One", color: .red)
            page("Two", color: .green)
            page("Three", color: .blue)
        }
        .tabViewStyle(.page(indexDisplayMode: mode))
        .frame(height: 240)
    }

    @ViewBuilder
    func page(_ title: String, color: Color) -> some View {
        if colored {
            color
                .overlay {
                    Text(title)
                }
        } else {
            Text(title)
        }
    }
}

// MARK: - The second page selected
//
// A selection binding that starts on the second of four pages, on coloured pages.

struct PagerSelected: View {
    @State private var page = 1

    var body: some View {
        VStack(spacing: 16) {
            Text("Welcome")
                .font(.largeTitle)
            TabView(selection: $page) {
                Color.red.tag(0)
                Color.green.tag(1)
                Color.blue.tag(2)
                Color.orange.tag(3)
            }
            .tabViewStyle(.page)
            .frame(height: 240)
            Button("Continue") { page += 1 }
        }
    }
}

// MARK: - One page
//
// The automatic mode hides the dots when there is only one page; the always mode shows one.

struct PagerOnePage: View {
    let mode: PageTabViewStyle.IndexDisplayMode

    var body: some View {
        VStack(spacing: 16) {
            Text("Welcome")
                .font(.largeTitle)
            TabView {
                Color.blue
            }
            .tabViewStyle(.page(indexDisplayMode: mode))
            .frame(height: 240)
        }
    }
}

// MARK: - A pager as the whole screen
//
// The screen's root TabView in the page style, where its dots sit over the home indicator's
// edge of the screen.

struct PagerRoot: View {
    var body: some View {
        TabView {
            Color.red
            Color.green
            Color.blue
        }
        .tabViewStyle(.page)
    }
}

// MARK: - A ScrollView that pages
//
// Three pages the width of the scroll view, each a coloured card. "scroll-paging-margins"
// insets the content by 16 on every side and lays it out as the scroll's targets.

struct ScrollPaging: View {
    let margins: Bool

    var body: some View {
        VStack(spacing: 16) {
            Text("Paging")
                .font(.largeTitle)
            if margins {
                scroll
                    .contentMargins(16, for: .scrollContent)
            } else {
                scroll
            }
        }
    }

    var scroll: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 0) {
                ForEach(0..<3) { index in
                    RoundedRectangle(cornerRadius: 12)
                        .fill([Color.red, Color.green, Color.blue][index])
                        .overlay {
                            Text("Page \(index + 1)")
                        }
                        .containerRelativeFrame(.horizontal)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .frame(height: 200)
    }
}
