import type { Project } from './types'

/**
 * The template gallery.
 *
 * Every template must render with **zero** unsupported placeholders (Phase 4 gate 2),
 * which constrains them to the views the slice actually draws. That is a real limit
 * and it shows: there is no List, no NavigationStack, no Image. Shipping a gorgeous
 * template gallery that renders half-drawn would be worse than a small honest one —
 * a template is a promise that this is what the tool can do.
 *
 * The gallery grows with the coverage matrix, not ahead of it.
 */

export interface Template {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly source: string
}

function app(name: string, root: string, body: string): string {
  return `import SwiftUI

@main
struct ${name}: App {
    var body: some Scene {
        WindowGroup {
            ${root}()
        }
    }
}

${body}`
}

export const COUNTER_APP_SOURCE = app(
  'CounterApp',
  'ContentView',
  `struct ContentView: View {
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
`,
)

const STACKS = app(
  'LayoutApp',
  'ContentView',
  `struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Layout")
                .font(.largeTitle)

            HStack(spacing: 8) {
                Swatch(label: "One", tint: Color.blue)
                Swatch(label: "Two", tint: Color.green)
                Swatch(label: "Three", tint: Color.orange)
            }

            ZStack {
                Rectangle()
                    .foregroundStyle(Color.indigo)
                    .frame(width: 200, height: 80)
                Text("ZStack")
                    .font(.headline)
                    .foregroundStyle(Color.white)
            }

            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct Swatch: View {
    var label = ""
    var tint = Color.gray

    var body: some View {
        Text(label)
            .font(.footnote)
            .foregroundStyle(Color.white)
            .padding()
            .background(tint)
            .cornerRadius(8)
    }
}
`,
)

const TOGGLE_LIST = app(
  'TasksApp',
  'ContentView',
  `struct ContentView: View {
    @State private var done = 0
    private let total = 4

    var body: some View {
        VStack(spacing: 14) {
            Text("Tasks")
                .font(.largeTitle)

            Text("\\(done) of \\(total) complete")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            VStack(spacing: 8) {
                for index in 0..<total {
                    Row(index: index, complete: index < done)
                }
            }

            Spacer()

            HStack {
                Button("Undo") {
                    if done > 0 { done -= 1 }
                }
                .padding()
                .background(Color.gray.opacity(0.15))
                .cornerRadius(8)

                Spacer()

                Button("Complete") {
                    if done < total { done += 1 }
                }
                .padding()
                .background(Color.blue.opacity(0.15))
                .cornerRadius(8)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct Row: View {
    var index = 0
    var complete = false

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .foregroundStyle(complete ? Color.green : Color.gray.opacity(0.3))
                .frame(width: 18, height: 18)

            Text("Task \\(index + 1)")
                .foregroundStyle(complete ? Color.secondary : Color.primary)

            Spacer()
        }
        .padding(10)
        .background(Color(white: 0.96))
        .cornerRadius(10)
    }
}
`,
)

const PROFILE_CARD = app(
  'CardApp',
  'ContentView',
  `struct ContentView: View {
    @State private var following = false

    var body: some View {
        VStack {
            Spacer()

            VStack(spacing: 12) {
                Circle()
                    .foregroundStyle(Color.teal)
                    .frame(width: 72, height: 72)

                Text("Ada Lovelace")
                    .font(.title2)

                Text("Mathematician")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Button(following ? "Following" : "Follow") {
                    following = !following
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(following ? Color.gray.opacity(0.2) : Color.blue.opacity(0.2))
                .cornerRadius(10)
            }
            .padding(24)
            .background(Color.white)
            .cornerRadius(16)

            Spacer()
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(white: 0.94))
    }
}
`,
)

const GRID = app(
  'PaletteApp',
  'ContentView',
  `struct ContentView: View {
    @State private var selected = 0

    var body: some View {
        VStack(spacing: 16) {
            Text("Palette")
                .font(.largeTitle)

            Text("Swatch \\(selected + 1) selected")
                .font(.footnote)
                .foregroundStyle(.secondary)

            VStack(spacing: 10) {
                for row in 0..<3 {
                    HStack(spacing: 10) {
                        for column in 0..<3 {
                            Button("") {
                                selected = row * 3 + column
                            }
                            .frame(width: 72, height: 72)
                            .background(tint(row * 3 + column))
                            .cornerRadius(12)
                        }
                    }
                }
            }

            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    func tint(_ index: Int) -> Color {
        if index % 3 == 0 { return Color.pink }
        if index % 3 == 1 { return Color.purple }
        return Color.indigo
    }
}
`,
)

export const TEMPLATES: readonly Template[] = [
  {
    id: 'counter',
    name: 'Counter',
    description: 'State, a Spacer and modifier ordering — the reference app.',
    source: COUNTER_APP_SOURCE,
  },
  {
    id: 'stacks',
    name: 'Stacks',
    description: 'VStack, HStack and ZStack, plus a reusable sub-view.',
    source: STACKS,
  },
  {
    id: 'tasks',
    name: 'Task list',
    description: 'A loop building rows, with state driving their appearance.',
    source: TOGGLE_LIST,
  },
  {
    id: 'card',
    name: 'Profile card',
    description: 'A centred card with a button that toggles its own label.',
    source: PROFILE_CARD,
  },
  {
    id: 'palette',
    name: 'Palette',
    description: 'A nested loop grid, and a function returning a Color.',
    source: GRID,
  },
]

export const DEFAULT_PROJECT_ID = 'counter-app'

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

export function createDefaultProject(now: number = Date.now()): Project {
  return createProjectFromTemplate(TEMPLATES[0]!, now)
}

export function createProjectFromTemplate(template: Template, now: number = Date.now()): Project {
  const appName = /struct (\w+): App/.exec(template.source)?.[1] ?? 'MyApp'

  return {
    id: DEFAULT_PROJECT_ID,
    manifest: {
      name: appName,
      bundleId: `com.example.${appName}`,
      deploymentTarget: '17.0',
      device: 'iphone-15',
      colorScheme: 'light',
    },
    files: [{ id: `Sources/${appName}.swift`, text: template.source }],
    createdAt: now,
    updatedAt: now,
  }
}
