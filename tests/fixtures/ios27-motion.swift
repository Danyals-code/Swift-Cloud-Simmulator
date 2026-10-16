import SwiftUI

// Native reference fixture for Wave 5a: how iOS 27 moves views in and out, rolls a
// number, and moves one view between two states. One screen per launch, picked with
// `-screen <name>` (the arguments domain of UserDefaults). Each screen changes on its
// own, so the captures need no tapping: 1.5 s after launch it shows its view (or counts
// up) inside `withAnimation(.linear(duration: 4))`, and 7 s after that it hides it again
// (or counts down). Each change prints `CHANGE <screen> <in|out> <seconds since 1970>` to
// standard error, which `simctl launch --console-pty` passes on. A screenshot takes a
// second or more, so each screen also draws a clock: a black bar near the bottom that
// grows from 0 to 300 pt wide, or shrinks back, in the same transaction as the change,
// so how wide it is in a capture says how far through the change that capture is. The
// `curves` screen runs each of Apple's animations on a value from 0
// to 1 and prints where it is on every frame, and how long it took to finish. Geometry is
// in points on a 402 x 874 pt iPhone 18 Pro.

@main
struct NativeMotionApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct RootView: View {
    let screen = UserDefaults.standard.string(forKey: "screen") ?? "fade"

    var body: some View {
        switch screen {
        // An `if` with no transition: the view fades, and the bar below it moves.
        case "fade":
            Stage(name: screen) { shown in
                if shown {
                    Box()
                }
            }
        case "move-top":
            Stage(name: screen) { shown in
                if shown {
                    Box()
                        .transition(.move(edge: .top))
                }
            }
        case "push-trailing":
            Stage(name: screen) { shown in
                if shown {
                    Box()
                        .transition(.push(from: .trailing))
                }
            }
        case "scale":
            Stage(name: screen) { shown in
                if shown {
                    Box()
                        .transition(.scale)
                }
            }
        case "blur":
            Stage(name: screen) { shown in
                if shown {
                    Box()
                        .transition(.blurReplace)
                }
            }
        case "slide":
            Stage(name: screen) { shown in
                if shown {
                    Box()
                        .transition(.slide)
                }
            }
        case "move-fade":
            Stage(name: screen) { shown in
                if shown {
                    Box()
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
        case "asymmetric":
            Stage(name: screen) { shown in
                if shown {
                    Box()
                        .transition(.asymmetric(insertion: .scale, removal: .opacity))
                }
            }
        // A transition with no animation: the view must appear and go at once.
        case "unanimated":
            Stage(name: screen, animated: false) { shown in
                if shown {
                    Box()
                        .transition(.scale)
                }
            }
        // `.animation(_:value:)` around the `if` alone: only what it wraps animates.
        case "value-only-child":
            ValueOnlyChild(name: screen)
        case "numeric":
            Counter(name: screen) { count in
                Text("\(count)")
                    .font(.system(size: 120, weight: .bold))
                    .contentTransition(.numericText())
            }
        case "numeric-value":
            Counter(name: screen) { count in
                Text("\(count)")
                    .font(.system(size: 120, weight: .bold))
                    .contentTransition(.numericText(value: Double(count)))
            }
        case "text-opacity":
            Counter(name: screen) { count in
                Text("\(count)")
                    .font(.system(size: 120, weight: .bold))
                    .contentTransition(.opacity)
            }
        case "text-default":
            Counter(name: screen) { count in
                Text("\(count)")
                    .font(.system(size: 120, weight: .bold))
            }
        case "matched":
            MatchedCard(name: screen)
        case "unmatched":
            PlainCard(name: screen)
        case "curves":
            Curves()
        default:
            Text("Unknown screen: \(screen)")
        }
    }
}

enum Palette {
    static let red = Color(red: 1, green: 0, blue: 0)
    static let blue = Color(red: 0, green: 0, blue: 1)
    static let green = Color(red: 0, green: 0.6, blue: 0)
}

/// What comes and goes: a blue rectangle 300 x 120.
struct Box: View {
    var body: some View {
        Palette.blue
            .frame(width: 300, height: 120)
    }
}

/// A black bar 300 pt wide when `on`, and 0 wide when not, near the bottom of the screen.
struct Clock: View {
    let on: Bool

    var body: some View {
        Color.black
            .frame(width: on ? 300 : 0, height: 10)
            .frame(width: 300, alignment: .leading)
            .padding(.bottom, 40)
    }
}

/// Prints when a change is made, against the same clock the capture reads.
func mark(_ screen: String, _ phase: String) {
    let line = "CHANGE \(screen) \(phase) \(Date().timeIntervalSince1970)\n"
    FileHandle.standardError.write(Data(line.utf8))
}

/// Makes a change 1.5 s after launch and undoes it 7 s later, animated over 4 s unless not.
@MainActor
func cycle(_ screen: String, animated: Bool = true, change: () -> Void) async {
    try? await Task.sleep(for: .seconds(1.5))
    mark(screen, "in")
    if animated {
        withAnimation(.linear(duration: 4)) { change() }
    } else {
        change()
    }
    try? await Task.sleep(for: .seconds(7))
    mark(screen, "out")
    if animated {
        withAnimation(.linear(duration: 4)) { change() }
    } else {
        change()
    }
}

/// A red bar, what comes and goes, and a green bar, from the top of the screen down.
struct Stage<Content: View>: View {
    let name: String
    var animated = true
    @ViewBuilder let content: (Bool) -> Content
    @State private var shown = false

    var body: some View {
        VStack(spacing: 16) {
            Text(name)
                .font(.caption)
            Palette.red
                .frame(width: 300, height: 60)
            content(shown)
            Palette.green
                .frame(width: 300, height: 60)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .padding(.top, 100)
        .overlay(alignment: .bottom) {
            Clock(on: shown)
        }
        .task {
            await cycle(name, animated: animated) { shown.toggle() }
        }
    }
}

struct ValueOnlyChild: View {
    let name: String
    @State private var shown = false

    var body: some View {
        VStack(spacing: 16) {
            Text(name)
                .font(.caption)
            Palette.red
                .frame(width: 300, height: 60)
            VStack {
                if shown {
                    Box()
                }
            }
            .animation(.linear(duration: 4), value: shown)
            Palette.green
                .frame(width: 300, height: 60)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .padding(.top, 100)
        .overlay(alignment: .bottom) {
            Clock(on: shown)
                .animation(.linear(duration: 4), value: shown)
        }
        .task {
            await cycle(name, animated: false) { shown.toggle() }
        }
    }
}

/// A number that goes from 9 to 10, and back.
struct Counter<Content: View>: View {
    let name: String
    @ViewBuilder let content: (Int) -> Content
    @State private var count = 9

    var body: some View {
        VStack(spacing: 16) {
            Text(name)
                .font(.caption)
            content(count)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .padding(.top, 100)
        .overlay(alignment: .bottom) {
            Clock(on: count == 10)
        }
        .task {
            await cycle(name) { count = count == 9 ? 10 : 9 }
        }
    }
}

/// A large card at the top that becomes a small one lower down and to the trailing side.
struct MatchedCard: View {
    let name: String
    @Namespace private var space
    @State private var small = false

    var body: some View {
        VStack(spacing: 16) {
            Text(name)
                .font(.caption)
            if small {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Palette.blue)
                    .matchedGeometryEffect(id: "card", in: space)
                    .frame(width: 80, height: 80)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.top, 400)
                    .padding(.trailing, 24)
            } else {
                RoundedRectangle(cornerRadius: 40)
                    .fill(Palette.blue)
                    .matchedGeometryEffect(id: "card", in: space)
                    .frame(width: 300, height: 300)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .padding(.top, 100)
        .overlay(alignment: .bottom) {
            Clock(on: small)
        }
        .task {
            await cycle(name) { small.toggle() }
        }
    }
}

/// The same two cards, with nothing to say they are one.
struct PlainCard: View {
    let name: String
    @State private var small = false

    var body: some View {
        VStack(spacing: 16) {
            Text(name)
                .font(.caption)
            if small {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Palette.blue)
                    .frame(width: 80, height: 80)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.top, 400)
                    .padding(.trailing, 24)
            } else {
                RoundedRectangle(cornerRadius: 40)
                    .fill(Palette.blue)
                    .frame(width: 300, height: 300)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .padding(.top, 100)
        .overlay(alignment: .bottom) {
            Clock(on: small)
        }
        .task {
            await cycle(name) { small.toggle() }
        }
    }
}

// MARK: - Curves
//
// An animatable modifier's body is called on every frame with the value as it is then,
// which is the one place SwiftUI shows how far an animation has got.

@MainActor
final class CurveLog {
    static let shared = CurveLog()
    private var name = ""
    private var start = 0.0

    func begin(_ name: String) {
        self.name = name
        start = CACurrentMediaTime()
    }

    func end() {
        name = ""
    }

    func record(_ value: Double) {
        guard !name.isEmpty else { return }
        let line = String(format: "CURVE %@ %.4f %.5f\n", name, CACurrentMediaTime() - start, value)
        FileHandle.standardError.write(Data(line.utf8))
    }
}

struct CurveProbe: ViewModifier, Animatable {
    var value: Double

    var animatableData: Double {
        get { value }
        set { value = newValue }
    }

    func body(content: Content) -> some View {
        CurveLog.shared.record(value)
        return content.offset(x: value * 200)
    }
}

struct Curves: View {
    @State private var progress = 0.0

    private let curves: [(String, Animation)] = [
        ("default", .default),
        ("smooth", .smooth),
        ("snappy", .snappy),
        ("bouncy", .bouncy),
        ("spring", .spring),
        ("interactiveSpring", .interactiveSpring),
        ("interpolatingSpring", .interpolatingSpring),
        ("spring-0.8-0.2", .spring(duration: 0.8, bounce: 0.2)),
        ("easeInOut", .easeInOut),
        ("easeIn", .easeIn),
        ("easeOut", .easeOut),
        ("linear", .linear),
        ("easeInOut-1", .easeInOut(duration: 1)),
    ]

    var body: some View {
        Palette.blue
            .frame(width: 60, height: 60)
            .modifier(CurveProbe(value: progress))
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.top, 200)
            .task {
                await measure()
            }
    }

    private func measure() async {
        for (name, animation) in curves {
            try? await Task.sleep(for: .seconds(1))
            CurveLog.shared.begin(name)
            let logical = await timed(animation, .logicallyComplete, to: 1)
            try? await Task.sleep(for: .seconds(1.5))
            CurveLog.shared.end()
            let removed = await timed(animation, .removed, to: 0)
            let line = "DURATION \(name) logicallyComplete \(logical) removed \(removed)\n"
            FileHandle.standardError.write(Data(line.utf8))
        }
        for (name, spring) in [("smooth", Spring.smooth), ("snappy", Spring.snappy), ("bouncy", Spring.bouncy)] {
            let line = "SPRING \(name) duration \(spring.duration) bounce \(spring.bounce) response \(spring.response) dampingRatio \(spring.dampingRatio) settlingDuration \(spring.settlingDuration)\n"
            FileHandle.standardError.write(Data(line.utf8))
        }
        FileHandle.standardError.write(Data("CURVES DONE\n".utf8))
    }

    /// How long an animation of `progress` to `target` takes to finish, by `criteria`.
    private func timed(_ animation: Animation, _ criteria: AnimationCompletionCriteria, to target: Double) async -> Double {
        await withCheckedContinuation { done in
            let start = CACurrentMediaTime()
            withAnimation(animation, completionCriteria: criteria) {
                progress = target
            } completion: {
                done.resume(returning: CACurrentMediaTime() - start)
            }
        }
    }
}
