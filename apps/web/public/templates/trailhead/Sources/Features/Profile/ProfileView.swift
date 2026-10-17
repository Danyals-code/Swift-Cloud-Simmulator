import SwiftUI

/// The third tab: a form, which is the grouped list in its other clothes.
struct ProfileView: View {
    @EnvironmentObject var store: TrailStore
    @State private var offline = true
    @State private var metric = false
    @State private var pace = 2.5

    var body: some View {
        NavigationStack {
            Form {
                Section("Walker") {
                    HStack(spacing: 12) {
                        Image(systemName: "person.circle")
                            .font(.largeTitle)
                            .foregroundStyle(Color.accentColor)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Ren Okada")
                                .font(.headline)
                                .foregroundStyle(Color.primary)
                            Text("\(store.saved.count) saved · \(store.trails.count) walked")
                                .font(.caption)
                                .foregroundStyle(Color.secondary)
                        }
                    }
                }

                Section("Preferences") {
                    Toggle("Offline maps", isOn: $offline)
                    Toggle("Metric units", isOn: $metric)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Usual pace: \(pace) mph")
                            .font(.subheadline)
                            .foregroundStyle(Color.primary)
                        Slider(value: $pace, in: 1...5)
                    }
                }

                Section("About") {
                    HStack {
                        Text("Version")
                            .foregroundStyle(Color.primary)
                        Spacer()
                        Text("1.0")
                            .foregroundStyle(Color.secondary)
                    }
                }
            }
            .navigationTitle("Profile")
        }
    }
}
