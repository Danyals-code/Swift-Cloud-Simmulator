import type { Project } from './types'

/**
 * The vertical-slice reference app (docs/06-VERTICAL-SLICE.md §1).
 *
 * Chosen so that every load-bearing mechanism is exercised at once: identity-keyed
 * `@State`, string interpolation, a result builder, closure capture and mutation,
 * `Spacer` inside `.frame(maxWidth: .infinity)` — which is the case that exposes a
 * wrong layout engine immediately — and `.padding().background()` ordering.
 *
 * When Phase 3 lands, this file is the acceptance target.
 */
export const COUNTER_APP_SOURCE = `import SwiftUI

@main
struct CounterApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var count = 0
    @State private var name = "World"

    var body: some View {
        VStack(spacing: 16) {
            Text("Hello, \\(name)!")
                .font(.largeTitle)
                .foregroundStyle(.primary)

            Text("Count: \\(count)")
                .font(.title2)
                .foregroundStyle(count < 0 ? Color.red : Color.primary)

            HStack(spacing: 12) {
                Button("Minus") {
                    count -= 1
                }
                .padding()
                .background(Color.red.opacity(0.15))

                Spacer()

                Button("Plus") {
                    count += 1
                }
                .padding()
                .background(Color.green.opacity(0.15))
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
        }
        .padding()
        .background(Color(white: 0.95))
    }
}
`

export const DEFAULT_PROJECT_ID = 'counter-app'

export function createDefaultProject(now: number = Date.now()): Project {
  return {
    id: DEFAULT_PROJECT_ID,
    manifest: {
      name: 'CounterApp',
      bundleId: 'com.example.CounterApp',
      deploymentTarget: '17.0',
      device: 'iphone-15',
      colorScheme: 'light',
    },
    files: [{ id: 'Sources/CounterApp.swift', text: COUNTER_APP_SOURCE }],
    createdAt: now,
    updatedAt: now,
  }
}
