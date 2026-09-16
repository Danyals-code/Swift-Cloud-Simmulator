import SwiftUI

@main
struct LayoutControlsApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}

struct ContentView: View {
    @State private var enabled = true
    @State private var amount = 0.5
    @State private var count = 0
    @State private var name = "Hello"
    @State private var selection = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Text, spacing & controls").font(.title2).bold()
                HStack(alignment: .firstTextBaseline) {
                    Text("Title").font(.title)
                    Text("Caption").font(.caption)
                }
                Text("AV fi café é 한글 العربية 👩🏽‍💻").font(.body)
                Text("This wraps using the font actually drawn in the preview. It should keep its words and baselines together.")
                VStack(alignment: .leading) {
                    Text("Automatic text spacing")
                    Text("A second text line")
                    Button("A neighboring button") { count += 1 }
                }
                HStack(spacing: 12) {
                    Button("Small") { count += 1 }.controlSize(.small)
                    Button("Regular") { count += 1 }
                    Button("+") { count += 1 }.buttonBorderShape(.circle)
                }.buttonStyle(.bordered)
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(.purple, lineWidth: 5)
                    RoundedRectangle(cornerRadius: 12, style: .circular).strokeBorder(.purple, lineWidth: 5)
                    Capsule().fill(.purple)
                }.frame(height: 34)
                Toggle("Enabled", isOn: $enabled)
                Slider(value: $amount, in: 0...1, step: 0.25)
                ProgressView(value: amount)
                TextField("Name", text: $name).textFieldStyle(.roundedBorder)
                Picker("Mode", selection: $selection) {
                    Text("One").tag(0)
                    Text("Two").tag(1)
                    Text("Three").tag(2)
                }.pickerStyle(.segmented)
                Stepper("Count: \(count)", value: $count, in: 0...5)
                Button("Disabled") { }.buttonStyle(.borderedProminent).disabled(true)
                Text("Fixed at 16 points").font(.system(size: 16))
                Text("Scales as body text").font(.body)
            }.padding()
        }.tint(.purple)
    }
}
