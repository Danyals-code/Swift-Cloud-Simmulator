import SwiftUI

// Native reference fixture for where content starts under a navigation bar, and
// how a list spaces its sections: one screen per launch, picked with
// `-screen <name>` (the arguments domain of UserDefaults). A red band marks the
// top of plain content; a list's white cards on the grouped grey mark its
// sections. Geometry is in points on a 402 x 874 pt iPhone 18 Pro.

@main
struct NativeUnderBarsApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

struct Band: View {
    var body: some View { Rectangle().fill(Color.red).frame(height: 40) }
}

struct Rows: View {
    var body: some View {
        Text("Row 1")
        Text("Row 2")
    }
}

struct RootView: View {
    let screen = UserDefaults.standard.string(forKey: "screen") ?? "plain-large"

    var body: some View {
        switch screen {
        case "plain-large":
            NavigationStack { VStack(spacing: 0) { Band(); Spacer() }.navigationTitle("Title") }
        case "plain-inline":
            NavigationStack { VStack(spacing: 0) { Band(); Spacer() }.navigationTitle("Title").navigationBarTitleDisplayMode(.inline) }
        case "plain-bare":
            VStack(spacing: 0) { Band(); Spacer() }
        case "scroll-large":
            NavigationStack { ScrollView { VStack(spacing: 0) { Band() } }.navigationTitle("Title") }
        case "scroll-inline":
            NavigationStack { ScrollView { VStack(spacing: 0) { Band() } }.navigationTitle("Title").navigationBarTitleDisplayMode(.inline) }
        case "list-large":
            NavigationStack { List { Rows() }.navigationTitle("Title") }
        case "list-large-header":
            NavigationStack { List { Section("Header") { Rows() } }.navigationTitle("Title") }
        case "list-large-two":
            NavigationStack { List { Section { Text("Row 1") }; Section { Text("Row 2") } }.navigationTitle("Title") }
        case "list-large-two-headers":
            NavigationStack { List { Section("One") { Text("Row 1") }; Section("Two") { Text("Row 2") } }.navigationTitle("Title") }
        case "list-large-footer-plain":
            NavigationStack { List { Section { Text("Row 1") } footer: { Text("Footer") }; Section { Text("Row 2") } }.navigationTitle("Title") }
        case "list-large-footer-header":
            NavigationStack { List { Section { Text("Row 1") } footer: { Text("Footer") }; Section("Two") { Text("Row 2") } }.navigationTitle("Title") }
        case "list-large-spacing":
            NavigationStack { List { Section { Text("Row 1") }; Section { Text("Row 2") } }.listSectionSpacing(40).navigationTitle("Title") }
        case "list-large-spacing-headers":
            NavigationStack { List { Section("One") { Text("Row 1") }; Section("Two") { Text("Row 2") } }.listSectionSpacing(40).navigationTitle("Title") }
        case "list-inline":
            NavigationStack { List { Rows() }.navigationTitle("Title").navigationBarTitleDisplayMode(.inline) }
        case "list-inline-header":
            NavigationStack { List { Section("Header") { Rows() } }.navigationTitle("Title").navigationBarTitleDisplayMode(.inline) }
        case "list-bare":
            List { Rows() }
        case "list-bare-header":
            List { Section("Header") { Rows() } }
        case "list-plain-large":
            NavigationStack { List { Rows() }.listStyle(.plain).navigationTitle("Title") }
        case "list-plain-large-headers":
            NavigationStack { List { Section("One") { Text("Row 1") }; Section("Two") { Text("Row 2") } }.listStyle(.plain).navigationTitle("Title") }
        case "list-grouped-large-header":
            NavigationStack { List { Section("Header") { Rows() } }.listStyle(.grouped).navigationTitle("Title") }
        case "list-grouped-large":
            NavigationStack { List { Rows() }.listStyle(.grouped).navigationTitle("Title") }
        case "form-large-header":
            NavigationStack { Form { Section("Account") { Rows() } }.navigationTitle("Title") }
        case "tab-list-large":
            TabView { NavigationStack { List { Rows() }.navigationTitle("Title") }.tabItem { Label("One", systemImage: "house") } }
        case "list-drawer":
            NavigationStack { List { Rows() }.navigationTitle("Title").searchable(text: .constant(""), placement: .navigationBarDrawer(displayMode: .always)) }
        case "list-drawer-header":
            NavigationStack { List { Section("Header") { Rows() } }.navigationTitle("Title").searchable(text: .constant(""), placement: .navigationBarDrawer(displayMode: .always)) }
        case "sheet-form-inline":
            Text("Home").sheet(isPresented: .constant(true)) { NavigationStack { Form { Section { TextField("Name", text: .constant("")) } }.navigationTitle("New").navigationBarTitleDisplayMode(.inline) } }
        case "sheet-form-header-inline":
            Text("Home").sheet(isPresented: .constant(true)) { NavigationStack { Form { Section("Details") { TextField("Name", text: .constant("")) } }.navigationTitle("New").navigationBarTitleDisplayMode(.inline) } }
        case "sheet-form-large":
            Text("Home").sheet(isPresented: .constant(true)) { NavigationStack { Form { Section { TextField("Name", text: .constant("")) } }.navigationTitle("New") } }
        case "sheet-form-bare":
            Text("Home").sheet(isPresented: .constant(true)) { Form { Section { TextField("Name", text: .constant("")) } } }
        default:
            Text("Unknown screen: \(screen)")
        }
    }
}
