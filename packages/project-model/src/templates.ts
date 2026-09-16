import type { SourceFile } from '@studio/shared'
import { TRAILHEAD_FILES } from './trailhead'
import type { Project } from './types'

/**
 * The template gallery.
 *
 * Every template must render with **zero** unsupported placeholders (Phase 4 gate 2),
 * which constrains them to the views the slice actually draws. That is a real limit
 * and it shows: there is no List, no NavigationStack, no Image. Shipping a gorgeous
 * template gallery that renders half-drawn would be worse than a small honest one -
 * a template is a promise that this is what the tool can do.
 *
 * The gallery grows with the coverage matrix, not ahead of it.
 *
 * Every template also has to survive dark mode, which means using the *adaptive*
 * semantic colours rather than fixed greys. `Color(white: 0.95)` does not adapt, so a
 * template using it shows white text on a light background the moment appearance
 * flips - the single most common dark-mode mistake, and not one to ship as an
 * example.
 */

export interface Template {
  readonly id: string
  readonly name: string
  readonly description: string
  /**
   * The files the template lays down, in navigator order.
   *
   * Was a single `source` string, which made every template a one-file project by
   * construction - and so made it impossible to ship an example of the thing
   * people actually build, which is several screens across several files. A
   * template that cannot show structure cannot teach it.
   */
  readonly files: readonly SourceFile[]
}

/** A one-file template, named after the `App` struct it declares. */
function single(source: string): readonly SourceFile[] {
  const appName = /struct (\w+): App/.exec(source)?.[1] ?? 'MyApp'
  return [{ id: `Sources/${appName}.swift`, text: source }]
}

/** The `@main` type's name, which becomes the project and target name. */
export function appNameOf(template: Template): string {
  for (const file of template.files) {
    const match = /struct (\w+): App/.exec(file.text)
    if (match?.[1]) return match[1]
  }
  return 'MyApp'
}

function app(name: string, root: string, body: string): string {
  return `import SwiftUI

@main
struct ${name}: App {
    var body: some Scene {
        WindowGroup {
            ${root}()
        }
    }
}

${body}`
}

export const COUNTER_APP_SOURCE = app(
  'CounterApp',
  'ContentView',
  `struct ContentView: View {
    @State private var count = 0
    @State private var name = "World"

    var body: some View {
        VStack(spacing: 16) {
            Text("Hello, \\(name)!")
                .font(.largeTitle)
                .foregroundStyle(.primary)

            Text("Count: \\(count)")
                .font(.title2)
                .foregroundStyle(count < 0 ? Color.red : Color.primary)

            HStack(spacing: 12) {
                Button("Minus") {
                    count -= 1
                }
                .padding()
                .background(Color.red.opacity(0.15))

                Spacer()

                Button("Plus") {
                    count += 1
                }
                .padding()
                .background(Color.green.opacity(0.15))
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
        }
        .padding()
        .background(Color(.systemGroupedBackground))
    }
}
`,
)

const STACKS = app(
  'LayoutApp',
  'ContentView',
  `struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Layout")
                .font(.largeTitle)

            HStack(spacing: 8) {
                Swatch(label: "One", tint: Color.blue)
                Swatch(label: "Two", tint: Color.green)
                Swatch(label: "Three", tint: Color.orange)
            }

            ZStack {
                Rectangle()
                    .foregroundStyle(Color.indigo)
                    .frame(width: 200, height: 80)
                Text("ZStack")
                    .font(.headline)
                    .foregroundStyle(Color.white)
            }

            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct Swatch: View {
    var label = ""
    var tint = Color.gray

    var body: some View {
        Text(label)
            .font(.footnote)
            .foregroundStyle(Color.white)
            .padding()
            .background(tint)
            .cornerRadius(8)
    }
}
`,
)

const TOGGLE_LIST = app(
  'TasksApp',
  'ContentView',
  `struct Task: Identifiable {
    let id = UUID()
    var title: String
    var done: Bool
}

struct ContentView: View {
    @State private var tasks = [
        Task(title: "Draft the brief", done: true),
        Task(title: "Review the copy", done: true),
        Task(title: "Send for sign-off", done: false),
        Task(title: "Archive the folder", done: false)
    ]

    private var complete: Int {
        get { tasks.filter { $0.done }.count }
    }

    var body: some View {
        VStack(spacing: 14) {
            Text("Tasks")
                .font(.largeTitle)

            Text("\\(complete) of \\(tasks.count) complete")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            VStack(spacing: 8) {
                ForEach(tasks) { task in
                    Row(title: task.title, complete: task.done)
                }
            }

            Spacer()

            HStack {
                Button {
                    undo()
                } label: {
                    Label("Undo", systemImage: "arrow.uturn.backward")
                }
                .padding()
                .background(Color.gray.opacity(0.15))
                .cornerRadius(8)

                Spacer()

                Button {
                    advance()
                } label: {
                    Label("Complete", systemImage: "checkmark")
                }
                .padding()
                .background(Color.blue.opacity(0.15))
                .cornerRadius(8)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }

    private func advance() {
        for index in 0..<tasks.count {
            if !tasks[index].done {
                tasks[index].done = true
                return
            }
        }
    }

    private func undo() {
        var index = tasks.count - 1
        while index >= 0 {
            if tasks[index].done {
                tasks[index].done = false
                return
            }
            index -= 1
        }
    }
}

struct Row: View {
    let title: String
    let complete: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: complete ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(complete ? Color.green : Color.secondary)

            Text(title)
                .strikethrough(complete)
                .foregroundStyle(complete ? Color.secondary : Color.primary)

            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(10)
    }
}`,
)

const PROFILE_CARD = app(
  'CardApp',
  'ContentView',
  `struct ContentView: View {
    @State private var following = false

    var body: some View {
        VStack {
            Spacer()

            VStack(spacing: 12) {
                Circle()
                    .foregroundStyle(Color.teal)
                    .frame(width: 72, height: 72)

                Text("Ada Lovelace")
                    .font(.title2)

                Text("Mathematician")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Button(following ? "Following" : "Follow") {
                    following = !following
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(following ? Color.gray.opacity(0.2) : Color.blue.opacity(0.2))
                .cornerRadius(10)
            }
            .padding(24)
            .background(Color(.secondarySystemGroupedBackground))
            .cornerRadius(16)

            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }
}
`,
)

const GRID = app(
  'PaletteApp',
  'ContentView',
  `struct ContentView: View {
    @State private var selected = 0

    var body: some View {
        VStack(spacing: 16) {
            Text("Palette")
                .font(.largeTitle)

            Text("Swatch \\(selected + 1) selected")
                .font(.footnote)
                .foregroundStyle(.secondary)

            VStack(spacing: 10) {
                for row in 0..<3 {
                    HStack(spacing: 10) {
                        for column in 0..<3 {
                            Button("") {
                                selected = row * 3 + column
                            }
                            .frame(width: 72, height: 72)
                            .background(tint(row * 3 + column))
                            .cornerRadius(12)
                        }
                    }
                }
            }

            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    func tint(_ index: Int) -> Color {
        if index % 3 == 0 { return Color.pink }
        if index % 3 == 1 { return Color.purple }
        return Color.indigo
    }
}
`,
)

const NAVIGATION = app(
  'ExplorerApp',
  'ContentView',
  `struct Destination: Identifiable {
    let id = UUID()
    let name: String
    let region: String
    let symbol: String
}

struct ContentView: View {
    let destinations = [
        Destination(name: "Kyoto", region: "Kansai", symbol: "leaf"),
        Destination(name: "Reykjavik", region: "Capital Region", symbol: "snowflake"),
        Destination(name: "Lisbon", region: "Estremadura", symbol: "sun.max")
    ]

    var body: some View {
        NavigationStack {
            List {
                Section("Destinations") {
                    ForEach(destinations) { destination in
                        NavigationLink(destination.name) {
                            DetailView(destination: destination)
                        }
                    }
                }
            }
            .navigationTitle("Explore")
        }
    }
}

struct DetailView: View {
    let destination: Destination

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: destination.symbol)
                .font(.largeTitle)
                .foregroundStyle(Color.accentColor)

            Text(destination.name)
                .font(.largeTitle)
                .fontWeight(.bold)

            Text(destination.region)
                .font(.headline)
                .foregroundStyle(Color.secondary)

            Spacer()
        }
        .padding()
        .navigationTitle(destination.name)
    }
}`,
)

const SETTINGS_FORM = app(
  'SettingsApp',
  'ContentView',
  `enum Theme: String, CaseIterable, Identifiable {
    case system, light, dark

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }
}

struct ContentView: View {
    @AppStorage("notifications") private var notifications = true
    @AppStorage("theme") private var theme = "system"
    @State private var sounds = false
    @State private var volume = 0.6
    @State private var displayName = "Ada"
    @State private var digestAt = Date()

    private var chosen: Theme {
        get {
            Theme.allCases.first { $0.rawValue == theme } ?? .system
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Profile") {
                    TextField("Display name", text: $displayName)
                    Label("Signed in", systemImage: "person.circle")
                }

                Section("Appearance") {
                    Picker("Theme", selection: $theme) {
                        ForEach(Theme.allCases) { option in
                            Text(option.label).tag(option.rawValue)
                        }
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text("Currently using the \\(chosen.label.lowercased()) appearance.")
                }

                Section("Alerts") {
                    Toggle("Notifications", isOn: $notifications)
                    Toggle("Sounds", isOn: $sounds)
                    Slider(value: $volume, in: 0...1)
                    DatePicker("Daily digest", selection: $digestAt, displayedComponents: [.hourAndMinute])
                }

                Section("About") {
                    LabeledContent("Version", value: "1.0")
                }
            }
            .navigationTitle("Settings")
        }
    }
}`,
)

const PHOTO_GRID = app(
  'GalleryApp',
  'ContentView',
  `struct ContentView: View {
    let columns = [GridItem(.adaptive(minimum: 100))]
    let symbols = [
        "sun.max", "moon", "cloud", "bolt",
        "leaf", "drop", "flame", "sparkles"
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(symbols, id: \\.self) { symbol in
                        VStack(spacing: 8) {
                            Image(systemName: symbol)
                                .font(.title)
                            Text(symbol)
                                .font(.caption)
                                .foregroundStyle(Color.secondary)
                        }
                        .padding(.vertical, 16)
                        .frame(maxWidth: .infinity)
                        .background(Color(.secondarySystemGroupedBackground))
                        .cornerRadius(12)
                    }
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Gallery")
        }
    }
}`,
)

const TABS = app(
  'TabsApp',
  'ContentView',
  `struct ContentView: View {
    var body: some View {
        TabView {
            TodayView()
                .tabItem {
                    Label("Today", systemImage: "sun.max")
                }

            LibraryView()
                .tabItem {
                    Label("Library", systemImage: "folder")
                }

            ProfileView()
                .tabItem {
                    Label("Profile", systemImage: "person.circle")
                }
        }
    }
}

struct TodayView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Today")
                .font(.largeTitle)
                .fontWeight(.bold)
            Text("Three things worth doing.")
                .foregroundStyle(Color.secondary)
        }
        .padding()
    }
}

struct LibraryView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "folder")
                .font(.largeTitle)
                .foregroundStyle(Color.accentColor)
            Text("Nothing saved yet.")
                .foregroundStyle(Color.secondary)
        }
        .padding()
    }
}

struct ProfileView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Ada Lovelace")
                .font(.title)
            Text("Member since 1843")
                .font(.footnote)
                .foregroundStyle(Color.secondary)
        }
        .padding()
    }
}`,
)

const ANIMATION = app(
  'MotionApp',
  'ContentView',
  `struct ContentView: View {
    @State private var expanded = false

    var body: some View {
        VStack(spacing: 24) {
            Text(expanded ? "Expanded" : "Collapsed")
                .font(.title2)
                .fontWeight(.semibold)

            RoundedRectangle(cornerRadius: expanded ? 32 : 12)
                .foregroundStyle(Color.accentColor)
                .frame(width: expanded ? 260 : 120, height: expanded ? 160 : 120)
                .shadow(radius: expanded ? 24 : 6, y: 8)

            Button(expanded ? "Collapse" : "Expand") {
                withAnimation(.spring()) {
                    expanded = !expanded
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 10)
            .background(Color.accentColor.opacity(0.15))
            .cornerRadius(10)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }
}`,
)

const SHEET_LIST = app(
  'InboxApp',
  'ContentView',
  `struct Message: Identifiable {
    let id = UUID()
    var subject: String
    var received: Date
    var read: Bool
}

struct ContentView: View {
    @State private var messages = [
        Message(subject: "Welcome aboard", received: Date().addingTimeInterval(-3600), read: true),
        Message(subject: "Your export is ready", received: Date().addingTimeInterval(-900), read: false),
        Message(subject: "Weekly digest", received: Date().addingTimeInterval(-120), read: false)
    ]
    @State private var composing = false
    @State private var draft = ""

    var unread: Int {
        get {
            messages.filter { !$0.read }.count
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Inbox") {
                    ForEach(messages) { message in
                        HStack(spacing: 10) {
                            Image(systemName: message.read ? "envelope.open" : "envelope")
                                .foregroundStyle(message.read ? Color.secondary : Color.accentColor)

                            VStack(alignment: .leading, spacing: 2) {
                                Text(message.subject)
                                Text(message.received, style: .relative)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            Spacer()
                        }
                    }
                } footer: {
                    Text("Pull a message aside to file it. Nothing here leaves the device.")
                }
            }
            .navigationTitle("\\(unread) unread")
            .toolbar {
                Button {
                    composing = true
                } label: {
                    Label("Compose", systemImage: "square.and.pencil")
                }
            }
            .sheet(isPresented: $composing) {
                VStack(spacing: 16) {
                    Text("New message")
                        .font(.title2)
                        .fontWeight(.semibold)

                    TextField("Subject", text: $draft)
                        .padding(.horizontal)

                    Button("Cancel") {
                        composing = false
                    }
                    .foregroundStyle(Color.accentColor)

                    Spacer()
                }
                .padding(.top, 24)
            }
        }
    }
}`,
)

const OBSERVABLE = app(
  'StoreApp',
  'ContentView',
  `class Basket: ObservableObject {
    @Published var items: [String] = []

    var total: Int {
        return items.count
    }

    func add(_ item: String) {
        items.append(item)
    }

    func clear() {
        items = []
    }
}

struct ContentView: View {
    @StateObject private var basket = Basket()
    let menu = ["Espresso", "Cortado", "Flat white"]

    var body: some View {
        NavigationStack {
            List {
                Section("Menu") {
                    ForEach(menu, id: \\.self) { item in
                        Button(item) {
                            basket.add(item)
                        }
                    }
                }

                Section("Basket") {
                    BasketSummary(basket: basket)
                    Button("Clear") {
                        basket.clear()
                    }
                    .foregroundStyle(Color.red)
                }
            }
            .navigationTitle("Order")
        }
    }
}

struct BasketSummary: View {
    @ObservedObject var basket: Basket

    var body: some View {
        HStack {
            Text(basket.total == 0 ? "Nothing yet" : "\\(basket.total) item(s)")
            Spacer()
            Text(basket.items.last ?? "-")
                .foregroundStyle(Color.secondary)
        }
    }
}`,
)

const STATE_MACHINE = app(
  'FlowApp',
  'ContentView',
  `enum Step: String {
    case welcome, details, done

    var title: String {
        switch self {
        case .welcome:
            return "Welcome"
        case .details:
            return "Your details"
        case .done:
            return "All set"
        }
    }

    var next: Step {
        switch self {
        case .welcome:
            return .details
        case .details:
            return .done
        case .done:
            return .welcome
        }
    }
}

struct ContentView: View {
    @State private var step: Step = .welcome
    @State private var name = ""

    var body: some View {
        VStack(spacing: 20) {
            Text(step.title)
                .font(.largeTitle)
                .fontWeight(.bold)

            switch step {
            case .welcome:
                Text("Three short steps.")
                    .foregroundStyle(Color.secondary)
            case .details:
                TextField("Name", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .padding(.horizontal)
            case .done:
                Text(name.isEmpty ? "Thanks!" : "Thanks, \\(name)!")
                    .foregroundStyle(Color.secondary)
            }

            Button(step == .done ? "Start again" : "Continue") {
                withAnimation(.easeInOut) {
                    step = step.next
                }
            }
            .buttonStyle(.borderedProminent)

            Spacer()
        }
        .padding(.top, 40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }
}`,
)

const DRAWING = app(
  'DrawingApp',
  'ContentView',
  `struct ContentView: View {
    @State private var progress = 0.65

    var body: some View {
        VStack(spacing: 32) {
            Text("Vectors")
                .font(.largeTitle)
                .fontWeight(.bold)

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

                Text("\\(Int(progress * 100))%")
                    .font(.title2)
                    .fontWeight(.semibold)
            }
            .frame(width: 140, height: 140)

            Path { path in
                path.move(to: CGPoint(x: 0, y: 60))
                path.addLine(to: CGPoint(x: 60, y: 20))
                path.addLine(to: CGPoint(x: 120, y: 45))
                path.addLine(to: CGPoint(x: 180, y: 0))
            }
            .stroke(Color.green, lineWidth: 3)
            .frame(width: 180, height: 60)

            Slider(value: $progress, in: 0...1)
                .padding(.horizontal, 32)

            Spacer()
        }
        .padding(.top, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}`,
)

const STYLED = app(
  'StyledApp',
  'ContentView',
  `/// A modifier written as a struct. Its body receives the view it is applied to,
/// so content below is an ordinary view carrying ordinary modifiers.
struct Card: ViewModifier {
    var tint: Color

    func body(content: Content) -> some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tint.opacity(0.15))
            .cornerRadius(14)
    }
}

/// The idiom every real codebase uses to name a modifier chain.
extension View {
    func card(_ tint: Color) -> some View {
        modifier(Card(tint: tint))
    }

    func sectionTitle() -> some View {
        font(.caption)
            .textCase(.uppercase)
            .foregroundStyle(.secondary)
    }
}

struct ContentView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Today")
                .sectionTitle()

            VStack(alignment: .leading, spacing: 6) {
                Text("Write the tests first")
                    .font(.headline)
                Text("Then the code has somewhere to be wrong.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .card(.blue)

            VStack(alignment: .leading, spacing: 6) {
                Text("Name the limitation")
                    .font(.headline)
                Text("A partial feature with nothing said is a bug.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .card(.orange)

            Spacer()
        }
        .padding(20)
    }
}`,
)

const LOADER = app(
  'LoaderApp',
  'ContentView',
  `enum LoadError: Error {
    case offline
    case empty
}

/// A protocol with a default implementation, supplied the only way Swift allows:
/// in an extension. Every conformer gets summary() without writing it.
protocol Describable {
    var title: String { get }
}

extension Describable {
    func summary() -> String {
        "Loaded: " + title
    }
}

struct Article: Describable {
    let title: String
}

struct ContentView: View {
    @State private var status = "Tap to load"
    @State private var failNext = false

    var body: some View {
        VStack(spacing: 20) {
            Text("Error handling")
                .font(.title2)
                .bold()

            Text(status)
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(height: 44)

            Toggle("Make it fail", isOn: $failNext)
                .padding(.horizontal, 40)

            Button("Load") {
                load()
            }
            .buttonStyle(.borderedProminent)

            Spacer()
        }
        .padding(24)
    }

    func fetch() throws -> Article {
        if failNext {
            throw LoadError.offline
        }
        return Article(title: "A Swift interpreter in a browser")
    }

    func load() {
        do {
            let article = try fetch()
            status = article.summary()
        } catch LoadError.offline {
            status = "No connection."
        } catch {
            status = "Something else went wrong."
        }
    }
}`,
)

const DRAGGABLE = app(
  'DragApp',
  'ContentView',
  `struct ContentView: View {
    @State private var position = CGSize.zero
    @GestureState private var active = CGSize.zero

    var body: some View {
        VStack(spacing: 24) {
            Text("Drag the card")
                .font(.headline)
                .foregroundStyle(Color.secondary)

            RoundedRectangle(cornerRadius: 20)
                .fill(Color.accentColor)
                .frame(width: 160, height: 110)
                .offset(
                    x: position.width + active.width,
                    y: position.height + active.height
                )
                .shadow(radius: 12, y: 6)
                .gesture(
                    DragGesture()
                        .updating($active) { value, state, transaction in
                            state = value.translation
                        }
                        .onEnded { value in
                            position = value.translation
                        }
                )

            Button("Reset") {
                withAnimation(.spring()) {
                    position = CGSize.zero
                }
            }
            .buttonStyle(.bordered)

            Spacer()
        }
        .padding(.top, 48)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }
}`,
)

const TYPESETTING = app(
  'TypeApp',
  'ContentView',
  `struct ContentView: View {
    @State private var loading = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Type").font(.largeTitle).fontWeight(.bold)
                    + Text(" setting").font(.largeTitle).foregroundStyle(Color.accentColor)

                Text("Two halves of one line, each with a face of its own.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 10) {
                    Text("Underlined, for a link that is not one")
                        .underline()

                    Text("Struck through, for a price that was")
                        .strikethrough()

                    Text("W I D E")
                        .tracking(6)
                        .font(.headline)

                    Text("A paragraph set with extra leading, so the lines breathe a little further apart than the face asks for on its own.")
                        .lineSpacing(7)

                    Text("A single line that will not fit, shortened in the middle rather than at its end")
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .foregroundStyle(.secondary)

                    Text("Shrunk to fit rather than cut")
                        .font(.title2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .frame(width: 180)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Placeholder while it loads")
                        .font(.headline)
                    Text("This paragraph is redacted, which draws the shape of the content without the content itself.")
                        .foregroundStyle(.secondary)
                }
                .redacted(reason: loading ? .placeholder : [])

                Button {
                    loading.toggle()
                } label: {
                    Label(loading ? "Reveal" : "Redact", systemImage: "eye")
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .safeAreaInset(edge: .bottom) {
            Text("Everything above is measured, not guessed.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(12)
                .frame(maxWidth: .infinity)
                .background(Color(.secondarySystemGroupedBackground))
        }
    }
}`,
)

export const TEMPLATES: readonly Template[] = [
  {
    id: 'counter',
    name: 'Counter',
    description: 'State, a Spacer and modifier ordering - the reference app.',
    files: single(COUNTER_APP_SOURCE),
  },
  {
    id: 'stacks',
    name: 'Stacks',
    description: 'VStack, HStack and ZStack, plus a reusable sub-view.',
    files: single(STACKS),
  },
  {
    id: 'tasks',
    name: 'Task list',
    description: 'A loop building rows, with state driving their appearance.',
    files: single(TOGGLE_LIST),
  },
  {
    id: 'card',
    name: 'Profile card',
    description: 'A centred card with a button that toggles its own label.',
    files: single(PROFILE_CARD),
  },
  {
    id: 'palette',
    name: 'Palette',
    description: 'A nested loop grid, and a function returning a Color.',
    files: single(GRID),
  },
  {
    id: 'navigation',
    name: 'Explore',
    description: 'A navigation stack over a list, pushing a detail screen.',
    files: single(NAVIGATION),
  },
  {
    id: 'settings',
    name: 'Settings',
    description: 'A form of grouped sections: toggles, a slider and a text field.',
    files: single(SETTINGS_FORM),
  },
  {
    id: 'gallery',
    name: 'Gallery',
    description: 'An adaptive grid of symbol tiles inside a scroll view.',
    files: single(PHOTO_GRID),
  },
  {
    id: 'tabs',
    name: 'Tabs',
    description: 'Three tabs, each its own view, with a real tab bar.',
    files: single(TABS),
  },
  {
    id: 'motion',
    name: 'Motion',
    description: 'withAnimation driving size, corner radius and shadow together.',
    files: single(ANIMATION),
  },
  {
    id: 'inbox',
    name: 'Inbox',
    description: 'A list, a toolbar button and a sheet that composes a message.',
    files: single(SHEET_LIST),
  },
  {
    id: 'store',
    name: 'Order',
    description: 'An ObservableObject shared between two views, with @StateObject.',
    files: single(OBSERVABLE),
  },
  {
    id: 'flow',
    name: 'Steps',
    description: 'An enum driving the screen, switched on in the body.',
    files: single(STATE_MACHINE),
  },
  {
    id: 'drawing',
    name: 'Vectors',
    description: 'Path, arcs and trim - a progress ring drawn from scratch.',
    files: single(DRAWING),
  },
  {
    id: 'drag',
    name: 'Drag',
    description: 'A drag gesture with @GestureState, and a spring on release.',
    files: single(DRAGGABLE),
  },
  {
    id: 'styled',
    name: 'Styled',
    description: 'A custom ViewModifier, and extension View naming a modifier chain.',
    files: single(STYLED),
  },
  {
    id: 'trailhead',
    name: 'Trailhead',
    description:
      'Eight files across four groups: tabs, two levels of navigation, scrolling in both directions, a shared store and a sheet.',
    files: TRAILHEAD_FILES,
  },
  {
    id: 'typesetting',
    name: 'Typesetting',
    description: 'Text attributes, concatenation, shrink-to-fit and an inset footer.',
    files: single(TYPESETTING),
  },
  {
    id: 'loader',
    name: 'Loader',
    description: 'A protocol with a default, and do/catch handling a thrown error.',
    files: single(LOADER),
  },
]

export const DEFAULT_PROJECT_ID = 'counter-app'

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

export function createDefaultProject(now: number = Date.now()): Project {
  return createProjectFromTemplate(TEMPLATES[0]!, now)
}

export function createProjectFromTemplate(template: Template, now: number = Date.now()): Project {
  const appName = appNameOf(template)

  return {
    id: DEFAULT_PROJECT_ID,
    manifest: {
      name: appName,
      bundleId: `com.example.${appName}`,
      deploymentTarget: '17.0',
      device: 'iphone-15',
      colorScheme: 'light',
    },
    files: template.files.map((file) => ({ id: file.id, text: file.text })),
    createdAt: now,
    updatedAt: now,
  }
}
