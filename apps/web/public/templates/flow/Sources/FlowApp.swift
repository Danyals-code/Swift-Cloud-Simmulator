import SwiftUI

@main
struct FlowApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

enum Step: String {
    case welcome, details, done

    var title: String {
        switch self {
        case .welcome:
            return "Welcome"
        case .details:
            return "Your details"
        case .done:
            return "All set"
        }
    }

    var next: Step {
        switch self {
        case .welcome:
            return .details
        case .details:
            return .done
        case .done:
            return .welcome
        }
    }
}

struct ContentView: View {
    @State private var step: Step = .welcome
    @State private var name = ""

    var body: some View {
        VStack(spacing: 20) {
            Text(step.title)
                .font(.largeTitle)
                .fontWeight(.bold)

            switch step {
            case .welcome:
                Text("Three short steps.")
                    .foregroundStyle(Color.secondary)
            case .details:
                TextField("Name", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .padding(.horizontal)
            case .done:
                Text(name.isEmpty ? "Thanks!" : "Thanks, \(name)!")
                    .foregroundStyle(Color.secondary)
            }

            Button(step == .done ? "Start again" : "Continue") {
                withAnimation(.easeInOut) {
                    step = step.next
                }
            }
            .buttonStyle(.borderedProminent)

            Spacer()
        }
        .padding(.top, 40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }
}