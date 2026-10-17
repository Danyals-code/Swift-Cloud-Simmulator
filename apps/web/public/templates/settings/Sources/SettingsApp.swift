import SwiftUI

@main
struct SettingsApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

enum Theme: String, CaseIterable, Identifiable {
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

                Section {
                    Picker("Theme", selection: $theme) {
                        ForEach(Theme.allCases) { option in
                            Text(option.label).tag(option.rawValue)
                        }
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("Appearance")
                } footer: {
                    Text("Currently using the \(chosen.label.lowercased()) appearance.")
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
}