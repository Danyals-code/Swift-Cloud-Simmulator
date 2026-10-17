import { LIBRARY_IMAGES } from '@studio/project-model'
import { offeredSymbols } from './offered-symbols'
import { PREVIEW_STDLIB } from './preview-stdlib'

/**
 * A small app in the style the rules ask for, shown to the AI with them. Its tests
 * hold it to its word: the preview draws it without a warning, and the Design view
 * can edit its tabs, its list of records and its buttons.
 */
export const STYLE_EXAMPLE = `import SwiftUI

@main
struct TripsApp: App {
    @State private var settings = TripSettings()

    var body: some Scene {
        WindowGroup {
            TabView {
                TripsView()
                    .tabItem { Label("Trips", systemImage: "airplane") }
                SettingsView()
                    .tabItem { Label("Settings", systemImage: "gearshape") }
            }
            .environment(settings)
        }
    }
}

@Observable final class TripSettings {
    var showsNights = true
}

struct Trip: Identifiable {
    let id: Int
    var city: String
    var nights: Int
    var booked: Bool
}

struct TripsView: View {
    @State private var trips: [Trip] = [
        Trip(id: 1, city: "Lisbon", nights: 4, booked: true),
        Trip(id: 2, city: "Kyoto", nights: 7, booked: false),
    ]
    @State private var showingNewTrip = false

    var body: some View {
        NavigationStack {
            List(trips) { trip in
                NavigationLink { TripDetailView(trip: trip) } label: {
                    TripRow(city: trip.city, nights: trip.nights)
                }
            }
            .navigationTitle("Trips")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New Trip") { showingNewTrip = true }
                }
            }
            .sheet(isPresented: $showingNewTrip) { NewTripView() }
        }
    }
}

struct TripRow: View {
    let city: String
    let nights: Int
    @Environment(TripSettings.self) private var settings

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(city)
                .font(.headline)
            if settings.showsNights {
                Text("\\(nights) nights")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

struct TripDetailView: View {
    let trip: Trip

    var body: some View {
        Form {
            LabeledContent("Nights", value: "\\(trip.nights)")
            LabeledContent("Booked", value: trip.booked ? "Yes" : "Not yet")
        }
        .navigationTitle(trip.city)
    }
}

struct NewTripView: View {
    @Environment(\\.dismiss) private var dismiss
    @State private var city = ""

    var body: some View {
        NavigationStack {
            Form {
                TextField("City", text: $city)
            }
            .navigationTitle("New Trip")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

struct SettingsView: View {
    @Environment(TripSettings.self) private var settings

    var body: some View {
        @Bindable var settings = settings
        NavigationStack {
            Form {
                Toggle("Show nights", isOn: $settings.showsNights)
            }
            .navigationTitle("Settings")
        }
    }
}
`

/**
 * The built-in library (Wave 7b): photos every project draws by name, listed with the alt
 * text that gives each one's shape, so a hero or a thumbnail gets an image that fits. Only a
 * name written as a literal is found and bundled when the app is exported. Some of the photos
 * show real, recognisable people, so they are photography, never anyone the app names.
 */
export const LIBRARY_GUIDANCE = `- Photos: every project can show these built-in library images by name, and the export gives Xcode each one the code uses. Show one by its exact name as Image("snowy-peak"), with .resizable() and .scaledToFill() or .scaledToFit() in a .frame or an .aspectRatio, and .clipped() or .clipShape after a fill. Write each name as a string literal where it is chosen, in Image("…") or in a record's literal data (Trip(name: "Coast", photo: "red-roof-house") shown with Image(trip.photo)), never built from parts, which the export cannot find. Never invent an image name. The people in these photos are real: use them only as photography with a neutral caption, never as a user, contact, author, reviewer or coach the app shows, and never give them a name. Keep the photos that show smoking out of health and fitness apps.
${LIBRARY_IMAGES.map(image => `  - ${image.name}: ${image.alt}`).join('\n')}`

/**
 * The SwiftUI both AI prompts ask for (G1), so that creating and editing an app write
 * the same kind of code.
 *
 * Each rule comes from the studio as it is: what its preview draws as the simulator
 * does, and what its Design view can go on editing (literal values, screens as plain
 * View structs, `.tabItem` tabs, a screen's own list of records). The patterns to avoid
 * are the ones its preview draws wrongly, or not at all, today.
 */
export const SWIFTUI_GUIDANCE = `SwiftUI rules. The studio previews the app in a browser, and designers go on editing it in a visual Design view, so write code that Xcode, the preview and the Design view all understand:
- Write current, idiomatic SwiftUI for iOS 27. Keep the code plain: no unsafe code, reflection or complicated generics.
- Screens: each screen is a top-level struct SomethingView: View whose body builds its visible UI directly. A screen takes no initializer arguments, unless it shows one record picked from a list: then it takes that record (PlaceDetailView(place: place)). Put repeated UI in small View structs with let properties and the memberwise initializer, called with literal values where they fit (StatCard(title: "Steps", value: "8,204")). Do not build visible UI in computed some View properties, functions, @ViewBuilder helpers, custom ViewModifiers or View extensions, or in components that take a content closure: the Design view cannot edit views built that way.
- Literals: write texts, numbers and colors where they are used: Text("Weekly budget"), .padding(16), .font(.headline), .frame(maxWidth: .infinity). Use system colors (.blue, .secondary, Color(.secondarySystemGroupedBackground)) and Color.accentColor. No hex values, Color("Name") or color constants of your own.
- Numbers: iOS writes a number put into a Text, Button or other title written as a literal for the locale, so Text("\\(price)") shows a Double with six decimals (3.500000) and a whole number with separators (2,000, and a year as 2,026). Write decimals as Text(price, format: .currency(code: "USD")), price.formatted() or Text("\\(distance, specifier: "%.1f") km"), and a year or a code as Text(String(year)).
- Rich text, drawn as iOS draws it: Markdown in a Text, Button or Label title written as a literal (Text("**Bold**, *italic*, \`code\` and [a link](https://apple.com)")); an AttributedString for styled runs (var text = AttributedString("Hello"); text.foregroundColor = .blue; then Text(text)), with its font, foregroundColor, underline and strikethrough but not its backgroundColor, which the preview doesn't draw; and symbols inside text (Text("Rated \\(Image(systemName: "star.fill")) 4.8")). A String variable shows its characters as they are, as on iOS.
- Layering and symbols: .mask with a shape, a Text or a symbol (a gradient masked by a Text is gradient text), .zIndex to raise a view in a ZStack, symbol variants such as .symbolVariant(.fill.circle), and rendering modes on a symbol in a circle or a square, or with a badge: .symbolRenderingMode(.hierarchical), .symbolRenderingMode(.palette) with two colors in .foregroundStyle(.red, .primary), and .symbolRenderingMode(.multicolor) on heart, star, leaf, bolt and trash. Other symbols draw in one color in the preview.
- Liquid Glass and iOS 27 bars, drawn as iOS draws them: .glassEffect() on a view, and GlassEffectContainer around views that each have their own; ToolbarSpacer(.fixed) between toolbar items to split their glass into two capsules, and ToolbarSpacer(.flexible) to push them apart; ToolbarItem(placement: .navigation) for a menu or sidebar button, .status for a short note in the middle of the bottom bar, and .secondaryAction for actions in the "…" menu; .navigationSubtitle under the title; .tabViewBottomAccessory { } on the TabView for a mini player above the tab bar; and a floating button in a ZStack around the app's outermost NavigationStack or TabView (one around a NavigationStack inside a tab isn't drawn yet, so put it around the TabView).
- Controls, scrolling and paint, drawn as iOS draws them: DatePicker in its default compact style, or with .datePickerStyle(.graphical) for a month calendar or .datePickerStyle(.wheel); ColorPicker("Tint", selection: $tint); MeshGradient(width: 3, height: 3, points: [[0, 0], [0.5, 0], [1, 0], ...], colors: [...]) for a background, with each point written as [x, y] and the mesh sized with .frame; and a carousel of cards as ScrollView(.horizontal) { HStack { ... }.scrollTargetLayout() } with .scrollTargetBehavior(.viewAligned) or .paging (.viewAligned snaps only to a stack marked .scrollTargetLayout(), as on iOS), .contentMargins(.horizontal, 24, for: .scrollContent) so the next card peeks in, and .safeAreaPadding.
- Charts, drawn as iOS draws them: import Charts at the top of the file, and a Chart over a screen's own records, sized with .frame(height: 200). Bars as Chart(sales) { sale in BarMark(x: .value("Month", sale.month), y: .value("Sales", sale.amount)) }, stacked with .foregroundStyle(by: .value("Product", sale.product)), which colors each product and adds a legend below, or side by side with .position(by: .value("Product", sale.product)) as well; a trend as a LineMark with a PointMark at the same values; and a pie or a donut as SectorMark(angle: .value("Sales", sale.amount), innerRadius: .ratio(0.6), angularInset: 1.5). Days as a Date field, written Date.now.addingTimeInterval(-86_400 * 2), and plotted with unit: .day, as BarMark(x: .value("Day", run.day, unit: .day), y: .value("Miles", run.miles)). Write unit: .day on every date: the preview draws dates by day only, so a date without a unit, which iOS spaces by time, or by another unit shows a box. AreaMark, RuleMark(y: .value("Goal", 50)), .annotation(position: .top) { Text("50") } on a bar or a rule, .annotation(position: .overlay) { Text("40%") } on a sector (iOS draws nothing above a sector), .chartLegend(.hidden), .chartXAxis(.hidden), .chartYAxis(.hidden) and .chartYScale(domain: 0...100) draw too.
- Modifiers: .foregroundStyle, never .foregroundColor. .clipShape(.rect(cornerRadius: 12)), never .cornerRadius. Text styles such as .font(.title2.bold()), or .font(.system(size: 28, weight: .semibold)). For a typeface other than the system font, one iOS ships, keeping the text style so it scales: .font(.custom("Avenir Next", size: 17, relativeTo: .body)) or Georgia, never a font file’s name, which the app would not have.
- Buttons: Button("Save") { save() } whenever the label is text. Button { } label: { Label("Add", systemImage: "plus") } only when the label needs an icon.
- Navigation: a NavigationStack at the root of each tab, or of the app. Push with NavigationLink { PlaceDetailView(place: place) } label: { PlaceRow(place: place) }, or NavigationLink("Settings") { SettingsView() }. Present with .sheet(isPresented: $showingForm) { NewPlaceView() }, and close with @Environment(\\.dismiss).
- Tabs: in the App, WindowGroup { TabView { HomeView().tabItem { Label("Home", systemImage: "house") } ... } }, with a literal title and symbol on each tab. Not Tab(...).
- State: @State private var with a literal initial value for a screen's own values (String, Int, Double, Bool, an enum or a Date). Keep the records a screen lists in that screen, as literals: @State private var places: [Place] = [Place(id: 1, name: "Harbor Walk", visited: false), ...], with struct Place: Identifiable { let id: Int; var name: String; var visited: Bool } (Int ids, fields typed String, Int, Double or Bool, or Date for a chart of days, and no initializer of its own). Show them with List(places) { place in ... } or ForEach(places) { place in ... }, and ForEach($places) { $place in ... } when rows change them.
- Shared state: only when several screens must share data, one @Observable final class, created as @State in the App, passed down with .environment(model), and read with @Environment(Model.self), with @Bindable var model = model inside body for bindings. Never ObservableObject, @Published, @StateObject, @ObservedObject or @EnvironmentObject.
- SF Symbols, only these names, which the preview draws as iOS does: ${offeredSymbols(300).join(', ')}
- Loading placeholders: .redacted(reason: .placeholder) on a view draws its texts and images as gray bars, as iOS does, and .unredacted() keeps one part shown.
${LIBRARY_GUIDANCE}
- The preview cannot show these, so never use them: glass button styles; Label or DisclosureGroup built from content closures (write Label("Title", systemImage: "star") and DisclosureGroup("More") { ... }); .toolbar(.hidden, for:) for any bar but .navigationBar, .tabBar and .bottomBar, and .toolbarVisibility; ToolbarItem placements other than .topBarLeading, .topBarTrailing, .principal, .bottomBar, .navigation, .status, .primaryAction, .secondaryAction, .confirmationAction and .cancellationAction, such as the .keyboard toolbar placement; .environment(\\.colorScheme, ...) and .preferredColorScheme; timers (Timer, .onReceive), which never fire in the preview; .searchScopes and .searchSuggestions; .presentationBackground with a view (use a Color or a Material); a ForEach over more than 1,000 items; custom EnvironmentKey or @Entry values; DateFormatter (write date.formatted(date: .abbreviated, time: .omitted) or date.formatted(.dateTime.month(.wide).day())); _value = State(initialValue:); TextField(value:format:); AsyncImage, TimelineView, Link, ShareLink, .onMove, .refreshable, .sensoryFeedback, PhotosPicker, MultiDatePicker, Table, OutlineGroup, TipKit, .fileImporter, .fileExporter, MapKit, web views, SwiftData, GeometryReader, custom Layouts and preference keys.
- Real SwiftUI that Xcode builds but the preview can't draw yet, so leave it out for now: scrolling charts (.chartScrollableAxes), chart selection (.chartXSelection, .chartAngleSelection), custom axis marks (AxisMarks in .chartXAxis { } or .chartYAxis { }), chosen series colors (.chartForegroundStyleScale; .foregroundStyle(by:) picks them), and .interpolationMethod, .symbol and .lineStyle on a mark.
${PREVIEW_STDLIB}

An example of these forms, not content to copy:
${STYLE_EXAMPLE}`
