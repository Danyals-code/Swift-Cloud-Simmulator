import SwiftUI

@main
struct AppearanceFixtureApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}

struct ContentView: View {
    @State private var enabled = true
    @State private var amount = 0.6
    @State private var name = "Hello"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Appearance check").font(.title2).bold()
                Text("This body text stays neutral.")
                HStack(spacing: 20) {
                    Button("Default") { }
                    Button("Delete", role: .destructive) { }
                }
                HStack(spacing: 12) {
                    Button("Bordered") { }.buttonStyle(.bordered)
                    Button("Prominent") { }.buttonStyle(.borderedProminent)
                }
                HStack(spacing: 12) {
                    Button("Glass") { }.buttonStyle(.glass)
                    Button("Glass filled") { }.buttonStyle(.glassProminent)
                }
                Toggle("Enabled", isOn: $enabled)
                Slider(value: $amount)
                ProgressView(value: amount)
                TextField("Name", text: $name).textFieldStyle(.roundedBorder)
                HStack(spacing: 16) {
                    Image(systemName: "heart")
                    Image(systemName: "heart.fill")
                    Image(systemName: "eye.slash")
                    Image(systemName: "star.circle.fill")
                    Image(systemName: "gearshape")
                }
                .font(.title2)
                .foregroundStyle(.tint)
                HStack(spacing: 12) {
                    Text("Thin").padding().background(.thinMaterial)
                    Text("Thick").padding().background(.thickMaterial)
                }
                Button("Disabled") { }.buttonStyle(.borderedProminent).disabled(true)
            }
            .padding(20)
        }
        .tint(.purple)
    }
}
