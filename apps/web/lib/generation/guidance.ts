import { SYMBOL_MAP } from '@studio/shared'

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
- Modifiers: .foregroundStyle, never .foregroundColor. .clipShape(.rect(cornerRadius: 12)), never .cornerRadius. Text styles such as .font(.title2.bold()), or .font(.system(size: 28, weight: .semibold)).
- Buttons: Button("Save") { save() } whenever the label is text. Button { } label: { Label("Add", systemImage: "plus") } only when the label needs an icon.
- Navigation: a NavigationStack at the root of each tab, or of the app. Push with NavigationLink { PlaceDetailView(place: place) } label: { PlaceRow(place: place) }, or NavigationLink("Settings") { SettingsView() }. Present with .sheet(isPresented: $showingForm) { NewPlaceView() }, and close with @Environment(\\.dismiss).
- Tabs: in the App, WindowGroup { TabView { HomeView().tabItem { Label("Home", systemImage: "house") } ... } }, with a literal title and symbol on each tab. Not Tab(...).
- State: @State private var with a literal initial value for a screen's own values (String, Int, Double, Bool, an enum or a Date). Keep the records a screen lists in that screen, as literals: @State private var places: [Place] = [Place(id: 1, name: "Harbor Walk", visited: false), ...], with struct Place: Identifiable { let id: Int; var name: String; var visited: Bool } (Int ids, fields typed String, Int, Double or Bool, and no initializer of its own). Show them with List(places) { place in ... } or ForEach(places) { place in ... }, and ForEach($places) { $place in ... } when rows change them.
- Shared state: only when several screens must share data, one @Observable final class, created as @State in the App, passed down with .environment(model), and read with @Environment(Model.self), with @Bindable var model = model inside body for bindings. Never ObservableObject, @Published, @StateObject, @ObservedObject or @EnvironmentObject.
- SF Symbols, only these names, which the preview draws as iOS does: ${Object.keys(SYMBOL_MAP).join(', ')}
- The preview cannot show these, so never use them: Liquid Glass APIs (.glassEffect, GlassEffectContainer, glass button styles); Markdown or links inside Text strings; .redacted; corners with different radii (.rect(topLeadingRadius: ...), UnevenRoundedRectangle); Label, ContentUnavailableView or DisclosureGroup built from content closures (write Label("Title", systemImage: "star"), ContentUnavailableView("No places", systemImage: "map", description: Text("Add one to start.")) and DisclosureGroup("More") { ... }); a second .toolbar on one view, or .toolbar(.hidden, ...); ToolbarItem placements other than .topBarLeading and .topBarTrailing; .environment(\\.colorScheme, ...) and .preferredColorScheme; timers (Timer, .onReceive), which never fire in the preview; .searchScopes and .searchSuggestions; .presentationBackground with a view (use a Color or a Material); a ForEach over more than 1,000 items; custom EnvironmentKey or @Entry values; DateFormatter and .dateTime format styles such as .formatted(.dateTime.month(.wide)) (write date.formatted(date: .abbreviated, time: .omitted)); _value = State(initialValue:); TextField(value:format:); NavigationStack(path:); navigationDestination(isPresented:) or (item:); AsyncImage, TimelineView, Link, ShareLink, .swipeActions, .onMove, .refreshable, .contextMenu, .sensoryFeedback, .symbolEffect, .contentMargins, .scrollTargetBehavior, PhotosPicker, MultiDatePicker, Table, OutlineGroup, TipKit, .fileImporter, .fileExporter, Charts, MapKit, web views, SwiftData, GeometryReader, custom Layouts and preference keys.

An example of these forms, not content to copy:
${STYLE_EXAMPLE}`
