import SwiftUI

@main
struct ScreenComparisonApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}

struct ContentView: View {
    @State private var selected = 0
    @State private var query = ""
    @State private var showingSheet = false
    @State private var showingAlert = false
    @State private var enabled = true
    @State private var name = "Taylor"

    var body: some View {
        TabView(selection: $selected) {
            Tab("Library", systemImage: "books.vertical", value: 0) {
                NavigationStack {
                    List {
                        Section("Favorites") {
                            NavigationLink("A quiet place") {
                                ScrollView {
                                    VStack(alignment: .leading, spacing: 16) {
                                        Text("A quiet place").font(.title).bold()
                                        Text("A longer description that should wrap naturally and keep the same margins when text size changes.")
                                        Button("Show alert") { showingAlert = true }
                                    }.padding()
                                }
                                .navigationTitle("Details")
                                .navigationBarTitleDisplayMode(.inline)
                                .alert("Save changes?", isPresented: $showingAlert) {
                                    Button("Cancel", role: .cancel) { }
                                    Button("Save") { }
                                } message: { Text("Your reading list will be updated.") }
                            }
                            Label("Recently added", systemImage: "clock")
                            Text("A longer row with enough words to wrap onto several lines when accessibility text is selected.")
                        }
                        Section {
                            ForEach(1..<21) { index in Text("Book \(index)") }
                        } header: {
                            Text("Reading list").font(.headline)
                        } footer: {
                            Text("Your library stays available offline.")
                        }
                    }
                    .navigationTitle("Library")
                    .searchable(text: $query, prompt: "Search library")
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Compose") { showingSheet = true }
                        }
                    }
                    .sheet(isPresented: $showingSheet) {
                        NavigationStack {
                            Form {
                                Section("New entry") {
                                    TextField("Title", text: $name)
                                    Toggle("Keep offline", isOn: $enabled)
                                }
                            }
                            .navigationTitle("New entry")
                            .navigationBarTitleDisplayMode(.inline)
                            .toolbar {
                                ToolbarItem(placement: .confirmationAction) {
                                    Button("Done") { showingSheet = false }
                                }
                            }
                        }
                        .presentationDetents([.medium, .large])
                        .presentationCornerRadius(34)
                    }
                }
            }
            Tab("Settings", systemImage: "gearshape", value: 1) {
                NavigationStack {
                    Form {
                        Section("Account") {
                            TextField("Name", text: $name)
                            Toggle("Notifications", isOn: $enabled)
                        }
                        Section {
                            Text("A row with custom insets").listRowInsets(EdgeInsets(top: 18, leading: 24, bottom: 18, trailing: 24))
                            Text("No separator below").listRowSeparator(.hidden)
                            Text("Final row")
                        } footer: {
                            Text("This footer should align with the row text.")
                        }
                        Section("Actions") {
                            Menu("Options") {
                                Button("Rename") { name = "Renamed" }
                                Button("Reset", role: .destructive) { name = "Taylor" }
                            }
                        }
                    }.navigationTitle("Settings")
                }
            }
        }.tint(.purple)
    }
}
