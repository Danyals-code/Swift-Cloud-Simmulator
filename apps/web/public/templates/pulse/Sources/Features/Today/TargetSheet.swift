import SwiftUI

/// Takes the target as a `Binding` straight out of the store, so moving the stepper
/// redraws the ring on the screen behind the sheet.
struct TargetSheet: View {
    @Binding var target: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Weekly target")
                .font(.title2)
                .foregroundStyle(Color.primary)

            Text("\(target) minutes")
                .font(.system(size: 30, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(Color.orange)

            Stepper("Adjust", value: $target, in: 60...900, step: 30)

            Text("Not a recommendation. It is the number you chose.")
                .font(.footnote)
                .foregroundStyle(Color.secondary)

            Spacer()

            Button("Done") {
                dismiss()
            }
            .buttonStyle(.borderedProminent)
            .frame(maxWidth: .infinity)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(.systemGroupedBackground))
    }
}
