import { DEFAULT_PREVIEW_TARGET } from '@studio/shared'
import type { SourceFile } from '@studio/shared'
import { STARTER_TEMPLATE_ID, TEMPLATE_CATALOG, type TemplateInfo } from './catalog'
import { fingerprintFiles, newProjectId } from './open'
import { FOLIO_FILES } from './folio'
import { KITCHEN_FILES } from './kitchen'
import { LEDGER_FILES } from './ledger'
import { PULSE_FILES } from './pulse'
import { TRAILHEAD_FILES } from './trailhead'
import type { Project } from './types'

export { FOLIO_FILES } from './folio'
export { KITCHEN_FILES } from './kitchen'
export { LEDGER_FILES } from './ledger'
export { PULSE_FILES } from './pulse'
export { TRAILHEAD_FILES } from './trailhead'

/** Templates use adaptive colors and must render without unsupported placeholders. */

/**
 * A template with its Swift.
 *
 * `files` is the one field that differs from the catalog entry - there it is the list
 * of paths the sheet shows, here it is those paths with their text - so the metadata
 * is inherited and that one property replaced.
 */
export interface Template extends Omit<TemplateInfo, 'files'> {
  /**
   * The files the template lays down, in navigator order.
   *
   * Was a single `source` string, which made every template a one-file project by
   * construction - and so made it impossible to ship an example of the thing people
   * actually build, which is several screens across several files. A template that
   * cannot show structure cannot teach it.
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
        NavigationStack {
            List {
                Section("Today") {
                    ForEach(tasks) { task in
                        Button {
                            toggle(task)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: task.done ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(task.done ? Color.green : Color.secondary)
                                Text(task.title)
                                    .strikethrough(task.done)
                                    .foregroundStyle(task.done ? Color.secondary : Color.primary)
                            }
                        }
                    }
                } footer: {
                    Text("\\(complete) of \\(tasks.count) complete. Tap a task to change it.")
                }
            }
            .navigationTitle("Tasks")
            .toolbar {
                Button("Reset") {
                    for index in 0..<tasks.count {
                        tasks[index].done = false
                    }
                }
            }
        }
        .tint(.green)
    }

    private func toggle(_ task: Task) {
        for index in 0..<tasks.count {
            if tasks[index].id == task.id {
                tasks[index].done.toggle()
            }
        }
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
                Image(systemName: "person.crop.circle.fill")
                    .font(.system(size: 72))
                    .foregroundStyle(.teal)

                Text("Ada Lovelace")
                    .font(.title2)

                Text("Mathematician")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Button(following ? "Following" : "Follow") {
                    following = !following
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .tint(following ? Color.gray : Color.teal)
            }
            .padding(24)
            .background(Color(.secondarySystemGroupedBackground))
            .cornerRadius(28)

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
    @State private var query = ""
    let destinations = [
        Destination(name: "Kyoto", region: "Kansai", symbol: "leaf"),
        Destination(name: "Reykjavik", region: "Capital Region", symbol: "snowflake"),
        Destination(name: "Lisbon", region: "Estremadura", symbol: "sun.max")
    ]

    var body: some View {
        NavigationStack {
            List {
                Section("Destinations") {
                    ForEach(destinations.filter { query.isEmpty || $0.name.lowercased().contains(query.lowercased()) }) { destination in
                        NavigationLink {
                            DetailView(destination: destination)
                        } label: {
                            Label(destination.name, systemImage: destination.symbol)
                        }
                    }
                }
            }
            .navigationTitle("Explore")
            .searchable(text: $query, prompt: "Find a destination")
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
        .navigationBarTitleDisplayMode(.inline)
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
    @State private var selected = 0

    var body: some View {
        TabView(selection: $selected) {
            NavigationStack {
                List {
                    Section("A little inspiration") {
                        Label("Take a walk outside", systemImage: "leaf")
                        Label("Read a few pages", systemImage: "book")
                        Label("Make something new", systemImage: "pencil")
                    }
                    Section {
                        Button("Browse the library") { selected = 1 }
                    }
                }
                .navigationTitle("Today")
            }
            .tabItem { Label("Today", systemImage: "sun.max") }
            .tag(0)

            NavigationStack {
                List {
                    Section("Collections") {
                        Label("Weekend ideas", systemImage: "bookmark")
                        Label("Things to learn", systemImage: "lightbulb")
                        Label("Favorite places", systemImage: "map")
                    }
                }
                .navigationTitle("Library")
            }
            .tabItem { Label("Library", systemImage: "folder") }
            .tag(1)

            NavigationStack {
                Form {
                    Section("About you") {
                        LabeledContent("Name", value: "Ada Lovelace")
                        LabeledContent("Member since", value: "2026")
                    }
                }
                .navigationTitle("Profile")
            }
            .tabItem { Label("Profile", systemImage: "person.circle") }
            .tag(2)
        }
        .tint(.indigo)
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
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
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

/**
 * The files each template lays down, keyed by the catalog's id.
 *
 * Separate from the metadata so the two can live in different chunks. A key here
 * with no catalog entry - or the reverse - is caught by `catalog.test.ts` rather
 * than producing a template that half exists.
 */
const SOURCES: Readonly<Record<string, readonly SourceFile[]>> = {
  counter: single(COUNTER_APP_SOURCE),
  stacks: single(STACKS),
  tasks: single(TOGGLE_LIST),
  card: single(PROFILE_CARD),
  palette: single(GRID),
  navigation: single(NAVIGATION),
  settings: single(SETTINGS_FORM),
  gallery: single(PHOTO_GRID),
  tabs: single(TABS),
  motion: single(ANIMATION),
  inbox: single(SHEET_LIST),
  store: single(OBSERVABLE),
  flow: single(STATE_MACHINE),
  drawing: single(DRAWING),
  drag: single(DRAGGABLE),
  styled: single(STYLED),
  folio: FOLIO_FILES,
  trailhead: TRAILHEAD_FILES,
  ledger: LEDGER_FILES,
  kitchen: KITCHEN_FILES,
  pulse: PULSE_FILES,
  typesetting: single(TYPESETTING),
  loader: single(LOADER),
}

/**
 * The gallery, sources included.
 *
 * Paired with `catalog.ts` rather than restating it: the metadata lives there so the
 * welcome sheet can draw the gallery without pulling 31 KB of Swift into the initial
 * bundle, and this module - which nothing in the app's static graph imports - adds
 * the files. `catalog.test.ts` asserts the two lists still agree.
 */
export const TEMPLATES: readonly Template[] = TEMPLATE_CATALOG.map((info) => ({
  ...info,
  files: SOURCES[info.id] ?? [],
}))

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

export function createDefaultProject(now: number = Date.now()): Project {
  return createProjectFromTemplate(templateById(STARTER_TEMPLATE_ID) ?? TEMPLATES[0]!, now)
}

export function createProjectFromTemplate(template: Template, now: number = Date.now()): Project {
  const appName = appNameOf(template)
  const files = template.files.map((file) => ({ id: file.id, text: file.text }))

  return {
    // Its own id. Every project the studio held used to be written to one key, so
    // creating from a template destroyed whatever was there with no copy anywhere.
    id: newProjectId(),
    manifest: {
      name: appName,
      bundleId: `com.example.${appName}`,
      deploymentTarget: '17.0',
      previewTarget: DEFAULT_PREVIEW_TARGET,
      device: 'iphone-15',
      colorScheme: 'light',
      // What `isPristine` compares against later, so the confirmation before a
      // replacement can tell "untouched" from "worked on" without the corpus.
      origin: fingerprintFiles(files),
    },
    files,
    createdAt: now,
    updatedAt: now,
  }
}
