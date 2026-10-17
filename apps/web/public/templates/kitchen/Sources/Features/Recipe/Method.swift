import SwiftUI

/// The method. It owns no state: the ticks arrive as a `@Binding`, so this list
/// and the progress bar above it cannot disagree about what is done.
struct Method: View {
    var steps: [String] = []
    @Binding var done: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            DisclosureGroup("Method") {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(steps, id: \.self) { step in
                        StepRow(
                            step: step,
                            number: (steps.firstIndex(of: step) ?? 0) + 1,
                            ticked: done.contains(step)
                        ) {
                            toggle(step)
                        }
                    }
                }
                .padding(.top, 8)
            }
        }
        .card()
    }

    func toggle(_ step: String) {
        if let index = done.firstIndex(of: step) {
            done.remove(at: index)
        } else {
            done.append(step)
        }
    }
}

/// Takes its action as a closure, so `Method` holds no opinion about the drawing.
struct StepRow: View {
    var step = ""
    var number = 1
    var ticked = false
    var onTap: () -> Void = {}

    var body: some View {
        Button {
            onTap()
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: ticked ? "checkmark.circle.fill" : "circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(ticked ? Color.green : Color.secondary.opacity(0.35))

                Text("\(number). \(step)")
                    .font(.subheadline)
                    .multilineTextAlignment(.leading)
                    .foregroundStyle(ticked ? Color.secondary : Color.primary)
                    .strikethrough(ticked)

                Spacer()
            }
        }
        .buttonStyle(.plain)
    }
}
