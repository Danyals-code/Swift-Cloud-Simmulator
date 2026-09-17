import SwiftUI

@main
struct VisualStressApp: App {
    var body: some Scene { WindowGroup { VisualStressView() } }
}

struct VisualStressView: View {
    @State private var page = 0
    var body: some View {
        TabView(selection: $page) {
            Tab("Controls", systemImage: "slider.horizontal.3", value: 0) { StressControls() }
            Tab("Present", systemImage: "rectangle.on.rectangle", value: 1) { StressPresentations() }
            Tab("Lists", systemImage: "list.bullet", value: 2) { StressContainers() }.badge(3)
        }.tint(.blue)
    }
}

struct StressControls: View {
    @State private var selection = 0
    @State private var enabled = true
    @State private var amount = 0.65
    @State private var count = 2
    var body: some View {
        NavigationStack {
            Form {
                Section("Selection") {
                    Picker("Range", selection: $selection) {
                        Text("Day").tag(0)
                        Text("Week").tag(1)
                        Text("Month").tag(2)
                    }.pickerStyle(.segmented)
                    Toggle("Notifications", isOn: $enabled)
                    Toggle("Favorite", isOn: $enabled).toggleStyle(.button)
                    Slider(value: $amount, in: 0...1)
                    Stepper("Quantity: \(count)", value: $count, in: 0...10)
                }
                Section("Buttons") {
                    HStack {
                        Button("Bordered") {}.buttonStyle(.bordered)
                        Button("Prominent") {}.buttonStyle(.borderedProminent)
                    }
                    HStack {
                        Button("Plain") {}.buttonStyle(.plain)
                        Button("Borderless") {}.buttonStyle(.borderless)
                    }
                }
                Section("Status") {
                    ProgressView("Downloading", value: amount)
                    Gauge(value: amount) { Text("Storage") }
                    HStack {
                        Gauge(value: amount) { Text("Used") }.gaugeStyle(.accessoryCircularCapacity)
                        Gauge(value: amount) { Text("Used") }.gaugeStyle(.accessoryCircular)
                    }
                }
            }.navigationTitle("Controls")
        }
    }
}

struct StressPresentations: View {
    @State private var sheet = false
    @State private var alert = false
    @State private var cover = false
    @State private var dialog = false
    @State private var name = "Taylor"
    var body: some View {
        NavigationStack {
            List {
                Button("200 point sheet") { sheet = true }
                Button("Alert with text field") { alert = true }
                Button("Full screen") { cover = true }
                Button("Choices") { dialog = true }
            }.navigationTitle("Presentations")
            .sheet(isPresented: $sheet) {
                VStack(spacing: 16) {
                    Text("Fixed height").font(.headline)
                    Text("200 points plus the bottom safe area")
                    Button("Done") { sheet = false }
                }
                .presentationDetents([.height(200)])
                .presentationCornerRadius(28)
                .presentationDragIndicator(.hidden)
                .presentationBackground(.yellow)
            }
            .alert("Rename item", isPresented: $alert) {
                TextField("Name", text: $name)
                Button("Cancel", role: .cancel) {}
                Button("Save") {}
            } message: { Text("Enter a new name.") }
            .fullScreenCover(isPresented: $cover) {
                VStack { Text("Full screen"); Button("Close") { cover = false } }
            }
            .confirmationDialog("Choose an action", isPresented: $dialog, titleVisibility: .visible) {
                Button("Archive") {}
                Button("Delete", role: .destructive) {}
                Button("Cancel", role: .cancel) {}
            }
        }
    }
}

struct StressContainers: View {
    @State private var expanded = true
    var body: some View {
        NavigationStack {
            List {
                Section("Rows") {
                    LabeledContent("Version", value: "1.0")
                    DisclosureGroup("More", isExpanded: $expanded) { Text("Expanded content") }
                    NavigationLink("Details") { Text("Detail screen").navigationTitle("Details") }
                }
                Section("Grid") {
                    Grid(alignment: .leading) {
                        GridRow { Text("A"); Text("Longer B") }
                        GridRow { Text("C"); Text("D") }
                    }
                }
                Section("Grouped content") {
                    GroupBox("Summary") { Text("A grouped card") }
                }
            }.navigationTitle("Containers")
        }
    }
}
