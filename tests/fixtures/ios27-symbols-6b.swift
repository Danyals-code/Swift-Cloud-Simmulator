import SwiftUI

// Native reference fixture for Wave 6b: SF Symbol rendering modes (multicolor, hierarchical,
// palette), variable values, symbol effects, and a sample of the names the preview draws as
// look-alikes. One screen per launch, picked with `-screen <name>` (the arguments domain of
// UserDefaults). Each measured view prints "MEASURE <name> x y width height" in points, read
// by launching with `simctl launch --console-pty`. Geometry is in points on a 402 x 874 pt
// iPhone 18 Pro.

@main
struct NativeSymbolsApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct RootView: View {
    let screen = UserDefaults.standard.string(forKey: "screen") ?? "multicolor"

    var body: some View {
        switch screen {
        case "multicolor": SymbolGrid(names: Symbols.multicolor, mode: .multicolor)
        case "multicolor-tinted": SymbolGrid(names: Symbols.multicolor, mode: .multicolor, tint: .purple)
        case "hierarchical": SymbolGrid(names: Symbols.layered, mode: .hierarchical)
        case "hierarchical-red": SymbolGrid(names: Symbols.layered, mode: .hierarchical, tint: .red)
        case "palette": PaletteScreen()
        case "variable": VariableScreen()
        case "effects": EffectsScreen()
        case "names-1": SymbolGrid(names: Symbols.sample1, mode: nil)
        case "names-2": SymbolGrid(names: Symbols.sample2, mode: nil)
        case "names-3": SymbolGrid(names: Symbols.sample3, mode: nil)
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

enum Symbols {
    static let multicolor = [
        "heart.fill", "heart", "flame.fill", "flame", "leaf.fill", "leaf", "drop.fill", "drop",
        "bolt.fill", "bolt", "trash", "trash.fill", "trash.circle.fill", "star.fill", "star", "sun.max.fill",
        "sun.max", "moon.fill", "moon.stars.fill", "cloud.fill", "cloud.sun.fill", "cloud.rain.fill", "cloud.bolt.fill", "cloud.bolt.rain.fill",
        "cloud.snow.fill", "cloud.moon.fill", "snowflake", "thermometer.sun.fill", "sunrise.fill", "sunset.fill", "bell.badge", "bell.badge.fill",
        "app.badge", "envelope.badge", "folder.badge.plus", "person.crop.circle.badge.plus", "person.crop.circle.badge.checkmark", "calendar.badge.plus", "cart.badge.plus", "exclamationmark.triangle.fill",
        "xmark.octagon.fill", "checkmark.seal.fill", "battery.100", "battery.25", "wifi.exclamationmark", "pencil.circle.fill", "paintpalette.fill", "lightbulb.fill",
        "umbrella.fill", "flag.fill", "pawprint.fill", "tortoise.fill", "hare.fill", "xmark.bin", "checkmark.circle.fill", "plus.circle.fill",
    ]
    static let layered = [
        "checkmark.circle.fill", "xmark.circle.fill", "plus.circle.fill", "heart.circle.fill", "star.circle", "star.square.fill", "info.circle", "person.circle.fill",
        "person.crop.circle", "person.crop.circle.fill", "bell.badge", "bell.badge.fill", "folder.badge.plus", "exclamationmark.triangle.fill", "cloud.sun.fill", "heart.fill",
        "message.circle.fill", "play.circle.fill", "arrow.up.circle.fill", "chevron.right.circle.fill", "wifi", "speaker.wave.3.fill", "trash.circle", "line.3.horizontal.decrease.circle",
    ]
    static let sample1 = [
        "person.crop.circle", "person.crop.circle.fill", "chevron.forward", "chevron.backward", "message", "message.fill", "phone", "phone.fill",
        "mic", "mic.fill", "mappin", "mappin.circle", "ellipsis.circle", "line.3.horizontal.decrease", "line.3.horizontal.decrease.circle", "car",
        "trophy", "pin", "printer", "qrcode", "fork.knife", "power", "checklist", "note.text",
        "bell.badge", "star.leadinghalf.filled", "arrow.triangle.2.circlepath", "square.and.arrow.down", "doc.on.doc", "bubble.left", "bubble.right", "video",
        "photo.on.rectangle", "speaker.wave.3", "shuffle", "repeat", "headphones", "stopwatch", "dollarsign.circle", "bus",
        "tram", "bicycle", "figure.walk", "figure.run", "moon.stars", "cloud.rain", "cloud.sun", "umbrella",
    ]
    static let sample2 = [
        "heart.text.square", "cross.case", "pills", "hand.raised", "square.grid.2x2.fill", "rectangle.grid.1x2", "antenna.radiowaves.left.and.right", "barcode",
        "graduationcap", "newspaper", "crown", "archivebox", "cube", "sun.horizon", "takeoutbag.and.cup.and.straw", "dumbbell",
        "figure.strengthtraining.traditional", "bed.double", "brain.head.profile", "face.smiling", "hand.wave", "square.and.arrow.up.on.square", "rectangle.portrait.and.arrow.right", "laptopcomputer",
        "applewatch", "hexagon", "app.badge", "plus.app", "text.bubble", "gearshape.2", "person.crop.circle.badge.plus", "person.badge.plus",
        "heart.slash", "star.slash", "xmark.octagon.fill", "checkmark.seal", "checkmark.shield", "chevron.left.2", "chevron.right.2", "chevron.compact.down",
        "arrow.up.left", "arrow.down.right", "arrow.down.to.line", "arrow.up.to.line", "arrow.left.to.line", "arrow.right.to.line", "arrow.up.right.square", "arrow.triangle.branch",
    ]
    static let sample3 = [
        "pencil.line", "doc.badge.plus", "folder.badge.plus", "tray.full", "tray.and.arrow.down", "externaldrive", "envelope.badge", "bubble.left.and.bubble.right",
        "video.slash", "camera.rotate", "viewfinder", "livephoto", "mic.slash", "playpause", "forward.end.fill", "backward.end.fill",
        "music.note.list", "waveform.path.ecg", "film", "calendar.badge.plus", "cart.badge.plus", "basket", "banknote", "ticket",
        "storefront", "wallet.bifold", "receipt", "globe.americas", "network", "signpost.right", "safari", "airplane.departure",
        "ferry", "figure.yoga", "figure.stand", "sunrise", "cloud.bolt", "cloud.moon", "sidebar.left", "cellularbars",
        "bookmark.slash", "trash.slash", "location.slash", "wifi.slash", "lightbulb", "seal", "octagon", "scribble",
    ]
}

/// Eight symbols to a row, each in a 44 x 44 cell, at the size `.title` gives.
struct SymbolGrid: View {
    let names: [String]
    let mode: SymbolRenderingMode?
    var tint: Color? = nil

    var body: some View {
        let columns = Array(repeating: GridItem(.fixed(44), spacing: 4), count: 8)
        LazyVGrid(columns: columns, spacing: 4) {
            ForEach(names, id: \.self) { name in
                Image(systemName: name)
                    .symbolRenderingMode(mode)
                    .foregroundStyle(tint ?? .accentColor)
                    .font(.title)
                    .frame(width: 44, height: 44)
                    .measure(name)
            }
        }
        .padding(.top, 8)
    }
}

/// Two styles with and without `.palette`, three styles, and two styles on hierarchical.
struct PaletteScreen: View {
    let names = ["person.crop.circle.fill", "checkmark.circle.fill", "heart.circle.fill", "bell.badge", "cloud.sun.fill", "heart.fill"]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            row("palette") { Image(systemName: $0).symbolRenderingMode(.palette).foregroundStyle(.red, .blue) }
            row("two-styles") { Image(systemName: $0).foregroundStyle(.red, .blue) }
            row("white-blue") { Image(systemName: $0).foregroundStyle(.white, .blue) }
            row("three") { Image(systemName: $0).symbolRenderingMode(.palette).foregroundStyle(.red, .green, .blue) }
            row("one-style") { Image(systemName: $0).symbolRenderingMode(.palette).foregroundStyle(.red) }
            row("hier-two") { Image(systemName: $0).symbolRenderingMode(.hierarchical).foregroundStyle(.red, .blue) }
            row("mono-two") { Image(systemName: $0).symbolRenderingMode(.monochrome).foregroundStyle(.red, .blue) }
            row("multi-two") { Image(systemName: $0).symbolRenderingMode(.multicolor).foregroundStyle(.red, .blue) }
        }
        .font(.title)
        .padding(.top, 8)
    }

    func row<Content: View>(_ label: String, _ image: @escaping (String) -> Content) -> some View {
        HStack(spacing: 4) {
            ForEach(names, id: \.self) { name in
                image(name).frame(width: 44, height: 44).measure("\(label) \(name)")
            }
        }
    }
}

/// Each variable symbol at seven values, a row each.
struct VariableScreen: View {
    let names = ["wifi", "cellularbars", "speaker.wave.3", "speaker.wave.3.fill", "speaker.wave.2", "speaker.wave.1", "chart.bar.fill", "touchid"]
    let values: [Double] = [0, 0.2, 0.34, 0.5, 0.67, 0.8, 1]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(names, id: \.self) { name in
                HStack(spacing: 4) {
                    ForEach(values, id: \.self) { value in
                        Image(systemName: name, variableValue: value)
                            .font(.title)
                            .frame(width: 44, height: 44)
                            .measure("\(name) \(value)")
                    }
                }
            }
        }
        .padding(.top, 8)
    }
}

/// Effects at rest: which ones change what is drawn, and whether `.disappear` keeps its frame.
struct EffectsScreen: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Image(systemName: "heart.fill").symbolEffect(.bounce, value: 0).measure("bounce")
                Image(systemName: "heart.fill").symbolEffect(.disappear).measure("disappear")
                Image(systemName: "heart.fill").symbolEffect(.disappear, isActive: false).measure("disappear-inactive")
                Image(systemName: "heart.fill").symbolEffect(.disappear.down).measure("disappear-down")
                Image(systemName: "heart.fill").symbolEffect(.appear).measure("appear")
                Image(systemName: "heart.fill").symbolEffect(.scale.up).measure("scale-up")
                Image(systemName: "heart.fill").symbolEffect(.variableColor).measure("variable-color")
                Text("end").measure("end")
            }
            HStack(spacing: 4) {
                Image(systemName: "star.fill").symbolEffect(.disappear).symbolEffectsRemoved().measure("removed")
                Image(systemName: "star.fill").symbolEffect(.disappear).symbolEffectsRemoved(false).measure("removed-false")
                Image(systemName: "star.fill").symbolEffectsRemoved().symbolEffect(.disappear).measure("removed-inside")
                Image(systemName: "star.fill").symbolEffect(.appear, isActive: false).measure("appear-inactive")
                Text("end").measure("end-2")
            }
        }
        .font(.title)
        .padding(.top, 8)
    }
}
