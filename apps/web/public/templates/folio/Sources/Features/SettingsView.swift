import SwiftUI

struct SettingsView: View {
    @AppStorage("folio.reader") private var name = "Taylor"
    @AppStorage("folio.dailyGoal") private var dailyGoal = 20

    var body: some View {
        NavigationStack {
            Form {
                Section("Reader") {
                    TextField("Your name", text: $name)
                }
                Section {
                    Stepper("\(dailyGoal) minutes a day", value: $dailyGoal, in: 5...120, step: 5)
                } header: {
                    Text("Reading goal")
                } footer: {
                    Text("A little time for a good book. Your name and goal are saved on this device.")
                }
                Section("About Folio") {
                    LabeledContent("Version", value: "1.0")
                    Text("A small library, with room to grow.").foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
        }
    }
}
