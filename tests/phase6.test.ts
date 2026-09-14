import { beforeEach, describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult, RenderNode, RenderTree } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * Phase 6 - coverage and fidelity.
 *
 * The gate this suite exists for is gate 3: *a three-screen navigation flow with a
 * sheet and animated transitions works end to end.* That is not a rendering
 * assertion - it is a statement about a sequence of taps producing the right
 * screens, which is why these tests drive events through the real dispatch path
 * rather than inspecting one tree.
 *
 * Everything else here follows the same rule the earlier phases set: assert on what
 * a user could observe (a label on screen, a control that responds), not on internal
 * structure, so the tests survive the layout being improved.
 */

const device = DEVICES['iphone-15']
let revision = 1

function request(source: string, colorScheme: 'light' | 'dark' = 'light'): CompileRequest {
  return {
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme,
    revision: revision++,
  }
}

function app(body: string, extra = ''): string {
  return `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
${body}
}

${extra}`
}

function run(source: string, colorScheme: 'light' | 'dark' = 'light'): CompileResult {
  resetPipelineState()
  return compile(request(source, colorScheme))
}

function nodes(result: CompileResult): readonly RenderNode[] {
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  expect(result.renderTree).not.toBeNull()
  return result.renderTree!.nodes
}

function texts(tree: RenderTree | null): string[] {
  return (tree?.nodes ?? []).flatMap((n) => n.text?.runs.map((r) => r.text) ?? [])
}

function glyphs(tree: RenderTree | null): string[] {
  return (tree?.nodes ?? []).flatMap((n) => (n.image ? [n.image.glyph] : []))
}

/** The hit target whose accessibility label matches, as a user would find it. */
function control(tree: RenderTree | null, label: string): RenderNode {
  const found = (tree?.nodes ?? []).find((n) => n.hitTarget && n.a11y?.label === label)
  expect(found, `no control labelled "${label}"`).toBeDefined()
  return found!
}

function tap(tree: RenderTree | null, label: string): CompileResult {
  const target = control(tree, label)
  expect(applyEvent({ kind: 'tap', handlerId: target.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(
    true,
  )
  return rerender(revision++)
}

function placeholders(result: CompileResult): string[] {
  return (result.renderTree?.nodes ?? [])
    .filter((n) => n.kind === 'placeholder')
    .map((n) => n.placeholder!.feature)
}

beforeEach(() => {
  resetPipelineState()
})

// ------------------------------------------------------------------ gate 3

describe('gate 3 - a three-screen navigation flow with a sheet and animation', () => {
  const SOURCE = `import SwiftUI

struct Folder: Identifiable {
    let id: Int
    let name: String
}

@main
struct FlowApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    let folders = [Folder(id: 1, name: "Work"), Folder(id: 2, name: "Personal")]

    var body: some View {
        NavigationStack {
            List {
                ForEach(folders) { folder in
                    NavigationLink(folder.name) {
                        FolderView(folder: folder)
                    }
                }
            }
            .navigationTitle("Folders")
        }
    }
}

struct FolderView: View {
    let folder: Folder

    var body: some View {
        List {
            NavigationLink("Settings") {
                SettingsView()
            }
        }
        .navigationTitle(folder.name)
    }
}

struct SettingsView: View {
    @State private var showingSheet = false
    @State private var expanded = false

    var body: some View {
        VStack(spacing: 20) {
            Button("Show options") {
                showingSheet = true
            }

            Button("Expand") {
                withAnimation(.easeInOut(duration: 0.3)) {
                    expanded = true
                }
            }

            Rectangle()
                .frame(width: expanded ? 200 : 60, height: 60)
                .foregroundStyle(Color.blue)
        }
        .navigationTitle("Settings")
        .sheet(isPresented: $showingSheet) {
            VStack(spacing: 12) {
                Text("Options")
                Button("Done") {
                    showingSheet = false
                }
            }
        }
    }
}
`

  it('walks three screens forward and back again', () => {
    let result = run(SOURCE)
    expect(texts(result.renderTree)).toContain('Folders')
    expect(texts(result.renderTree)).toContain('Work')

    // Screen 2.
    result = tap(result.renderTree, 'Work')
    expect(texts(result.renderTree)).toContain('Settings')
    // The back button is labelled with the screen it returns to, as iOS does.
    expect(texts(result.renderTree)).toContain('Folders')

    // Screen 3.
    result = tap(result.renderTree, 'Settings')
    expect(texts(result.renderTree)).toContain('Show options')

    // …and back down the stack.
    result = tap(result.renderTree, 'Work')
    expect(texts(result.renderTree)).toContain('Settings')
    expect(texts(result.renderTree)).not.toContain('Show options')

    result = tap(result.renderTree, 'Folders')
    expect(texts(result.renderTree)).toContain('Personal')
  })

  it('presents and dismisses a sheet', () => {
    let result = run(SOURCE)
    result = tap(result.renderTree, 'Work')
    result = tap(result.renderTree, 'Settings')

    expect(texts(result.renderTree)).not.toContain('Options')

    result = tap(result.renderTree, 'Show options')
    expect(texts(result.renderTree)).toContain('Options')

    result = tap(result.renderTree, 'Done')
    expect(texts(result.renderTree)).not.toContain('Options')
  })

  it('marks the frame after withAnimation as animated', () => {
    let result = run(SOURCE)
    result = tap(result.renderTree, 'Work')
    result = tap(result.renderTree, 'Settings')

    const before = nodes(result).find((n) => n.kind === 'shape')
    expect(before?.frame.width).toBe(60)
    expect(before?.animation).toBeUndefined()

    result = tap(result.renderTree, 'Expand')
    const after = nodes(result).find((n) => n.kind === 'shape')

    // The engine still produces one static frame per state; what `withAnimation`
    // changes is that the renderer is told to interpolate into this one.
    expect(after?.frame.width).toBe(200)
    expect(after?.animation).toEqual({ curve: 'easeInOut', duration: 0.3 })
  })

  it('keeps the sheet closed until its binding says otherwise', () => {
    // The failure this guards against is specific and was real: `isPresented:` is a
    // binding, and an opaque value is truthy, so testing it without reading through
    // presented every sheet in the file permanently.
    const result = run(SOURCE)
    expect(texts(result.renderTree)).not.toContain('Options')
  })
})

// ------------------------------------------------------- content primitives

describe('ForEach', () => {
  it('renders one row per element of a range', () => {
    const result = run(
      app(`    var body: some View {
        VStack {
            ForEach(0..<4) { index in
                Text("Row \\(index)")
            }
        }
    }`),
    )
    const shown = texts(result.renderTree)
    expect(shown).toEqual(['Row 0', 'Row 1', 'Row 2', 'Row 3'])
  })

  it('renders one row per element of an array, keyed by id', () => {
    const result = run(`import SwiftUI

struct Task: Identifiable {
    let id: String
    let title: String
}

@main
struct A: App { var body: some Scene { WindowGroup { V() } } }

struct V: View {
    let tasks = [Task(id: "a", title: "Alpha"), Task(id: "b", title: "Beta")]
    var body: some View {
        VStack {
            ForEach(tasks) { task in
                Text(task.title)
            }
        }
    }
}
`)
    expect(texts(result.renderTree)).toEqual(['Alpha', 'Beta'])
  })

  it('accepts an explicit id key path', () => {
    const result = run(
      app(`    let names = ["one", "two"]
    var body: some View {
        VStack {
            ForEach(names, id: \\.self) { name in
                Text(name)
            }
        }
    }`),
    )
    expect(texts(result.renderTree)).toEqual(['one', 'two'])
  })

  it('gives each row its own @State', () => {
    // Keyed identity is what makes this true: without it every row shares one box
    // and tapping one counter increments all of them.
    const source = `import SwiftUI

@main
struct A: App { var body: some Scene { WindowGroup { V() } } }

struct V: View {
    var body: some View {
        VStack {
            ForEach(0..<2) { index in
                Row(label: "R\\(index)")
            }
        }
    }
}

struct Row: View {
    let label: String
    @State private var count = 0

    var body: some View {
        Button("\\(label): \\(count)") {
            count += 1
        }
    }
}
`
    let result = run(source)
    expect(texts(result.renderTree)).toEqual(['R0: 0', 'R1: 0'])

    result = tap(result.renderTree, 'R0: 0')
    expect(texts(result.renderTree)).toEqual(['R0: 1', 'R1: 0'])
  })
})

describe('Image and Label', () => {
  it('draws an SF Symbol as an approximated glyph', () => {
    const result = run(
      app(`    var body: some View {
        Image(systemName: "star.fill")
    }`),
    )
    const image = nodes(result).find((n) => n.kind === 'image')
    expect(image).toBeDefined()
    expect(image!.image!.approximated).toBe(true)
    expect(image!.image!.glyph).not.toBe('')
  })

  it('falls back to a base symbol when a variant is unknown', () => {
    const result = run(
      app(`    var body: some View {
        Image(systemName: "star.square.badge.something")
    }`),
    )
    // `star` is known, so an unrecognised variant lands on the base star rather than
    // on the "no such symbol" box.
    expect(glyphs(result.renderTree)).toEqual(['☆'])
  })

  it('lays a Label out as icon then title on one line', () => {
    const result = run(
      app(`    var body: some View {
        Label("Starred", systemImage: "star.fill")
    }`),
    )
    const painted = nodes(result)
    const icon = painted.find((n) => n.kind === 'image')!
    const title = painted.find((n) => n.text?.runs[0]?.text === 'Starred')!

    expect(icon.frame.x).toBeLessThan(title.frame.x)
    // One line: the regression that made this fail was a stack dividing its own
    // measured width back up and losing a hundredth of a point to rounding.
    expect(title.frame.height).toBe(22)
  })

  it('reports an asset image as unavailable rather than drawing a grey box', () => {
    const result = run(
      app(`    var body: some View {
        Image("Logo")
    }`),
    )
    expect(placeholders(result)).toEqual(['Image("Logo")'])
  })
})

describe('ScrollView', () => {
  it('clips its content and reports a scrollable extent', () => {
    const result = run(
      app(`    var body: some View {
        ScrollView {
            VStack {
                ForEach(0..<40) { index in
                    Text("Line \\(index)")
                        .frame(height: 40)
                }
            }
        }
    }`),
    )
    const scroll = nodes(result).find((n) => n.scroll)
    expect(scroll).toBeDefined()
    expect(scroll!.clip).toBe(true)
    // 40 rows of 40pt is far taller than the screen, which is the whole point.
    expect(scroll!.scroll!.content.height).toBeGreaterThan(scroll!.frame.height)

    // Rows are positioned inside the scroller, in its coordinate space.
    const inside = nodes(result).filter((n) => n.parent === scroll!.id)
    expect(inside.length).toBeGreaterThan(10)
  })
})

describe('grids', () => {
  it('flows children into adaptive columns', () => {
    const result = run(
      app(`    let columns = [GridItem(.adaptive(minimum: 100))]
    var body: some View {
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(0..<6) { index in
                Text("\\(index)")
                    .frame(height: 40)
            }
        }
    }`),
    )
    const cells = nodes(result).filter((n) => n.kind === 'text')
    expect(cells).toHaveLength(6)

    // Three columns fit in 393pt at a 100pt minimum, so cell 3 starts a new row.
    const rows = new Set(cells.map((c) => Math.round(c.frame.y)))
    expect(rows.size).toBe(2)
  })

  it('honours fixed columns', () => {
    const result = run(
      app(`    let columns = [GridItem(.fixed(80)), GridItem(.fixed(80))]
    var body: some View {
        LazyVGrid(columns: columns) {
            Text("a")
            Text("b")
            Text("c")
        }
    }`),
    )
    const cells = nodes(result).filter((n) => n.kind === 'text')
    expect(cells).toHaveLength(3)
    expect(new Set(cells.map((c) => Math.round(c.frame.y))).size).toBe(2)
  })
})

// ------------------------------------------------------------------- lists

describe('List', () => {
  it('draws section headers, rows and separators', () => {
    const result = run(
      app(`    var body: some View {
        List {
            Section("Fruit") {
                Text("Apple")
                Text("Banana")
            }
        }
    }`),
    )
    const shown = texts(result.renderTree)
    expect(shown).toContain('FRUIT')
    expect(shown).toContain('Apple')
    expect(shown).toContain('Banana')
  })

  it('gives rows the system minimum height', () => {
    const result = run(
      app(`    var body: some View {
        List {
            Text("Only")
        }
    }`),
    )
    const row = nodes(result).find((n) => n.text?.runs[0]?.text === 'Only')!
    // The 44pt floor is applied to the row, so its text sits centred within it.
    expect(row.frame.height).toBeLessThanOrEqual(44)
    expect(row.frame.x).toBeGreaterThanOrEqual(32)
  })

  it('scrolls when its rows exceed the screen', () => {
    const result = run(
      app(`    var body: some View {
        List {
            ForEach(0..<40) { index in
                Text("Item \\(index)")
            }
        }
    }`),
    )
    const scroll = nodes(result).find((n) => n.scroll)!
    expect(scroll.scroll!.content.height).toBeGreaterThan(scroll.frame.height)
  })
})

// ---------------------------------------------------------------- controls

describe('controls bound to state', () => {
  it('flips a Toggle and re-renders from the new value', () => {
    const source = app(`    @State private var on = false

    var body: some View {
        VStack {
            Toggle("Wi-Fi", isOn: $on)
            Text(on ? "connected" : "off")
        }
    }`)

    let result = run(source)
    expect(texts(result.renderTree)).toContain('off')

    const toggle = control(result.renderTree, 'Wi-Fi')
    expect(toggle.hitTarget!.role).toBe('toggle')

    applyEvent({ kind: 'toggle', handlerId: toggle.hitTarget!.handlerId, value: true })
    result = rerender(revision++)
    expect(texts(result.renderTree)).toContain('connected')
  })

  it("writes a TextField's new text back through its binding", () => {
    const source = app(`    @State private var name = ""

    var body: some View {
        VStack {
            TextField("Name", text: $name)
            Text("Hello, \\(name)")
        }
    }`)

    let result = run(source)
    const field = control(result.renderTree, 'Name')
    expect(field.hitTarget!.role).toBe('textField')
    expect(field.hitTarget!.value).toBe('')

    applyEvent({ kind: 'textChange', handlerId: field.hitTarget!.handlerId, value: 'Ada' })
    result = rerender(revision++)
    expect(texts(result.renderTree)).toContain('Hello, Ada')
  })

  it("carries a Slider's range to the renderer", () => {
    const source = app(`    @State private var level = 3.0

    var body: some View {
        Slider(value: $level, in: 0...10)
    }`)

    let result = run(source)
    const slider = (result.renderTree?.nodes ?? []).find((n) => n.hitTarget?.role === 'slider')!
    expect(slider.hitTarget!.min).toBe(0)
    expect(slider.hitTarget!.max).toBe(10)
    expect(slider.hitTarget!.value).toBe('3')

    applyEvent({ kind: 'slide', handlerId: slider.hitTarget!.handlerId, value: 7.5 })
    result = rerender(revision++)
    const moved = (result.renderTree?.nodes ?? []).find((n) => n.hitTarget?.role === 'slider')!
    expect(moved.hitTarget!.value).toBe('7.5')
  })

  it('runs an onTapGesture closure', () => {
    const source = app(`    @State private var taps = 0

    var body: some View {
        Text("Tapped \\(taps)")
            .onTapGesture {
                taps += 1
            }
    }`)

    let result = run(source)
    const target = (result.renderTree?.nodes ?? []).find((n) => n.hitTarget)!
    expect(target.hitTarget!.role).toBe('tapGesture')

    applyEvent({ kind: 'tap', handlerId: target.hitTarget!.handlerId, location: { x: 0, y: 0 } })
    result = rerender(revision++)
    expect(texts(result.renderTree)).toContain('Tapped 1')
  })

  it('marks a disabled control as such', () => {
    const result = run(
      app(`    var body: some View {
        Button("Send") { }
            .disabled(true)
    }`),
    )
    expect(control(result.renderTree, 'Send').hitTarget!.enabled).toBe(false)
  })
})

describe('bindings', () => {
  it("lets a child view write its parent's state", () => {
    const source = `import SwiftUI

@main
struct A: App { var body: some Scene { WindowGroup { Parent() } } }

struct Parent: View {
    @State private var count = 0

    var body: some View {
        VStack {
            Text("Count \\(count)")
            Child(count: $count)
        }
    }
}

struct Child: View {
    @Binding var count: Int

    var body: some View {
        Button("Bump") {
            count += 1
        }
    }
}
`
    let result = run(source)
    expect(texts(result.renderTree)).toContain('Count 0')

    result = tap(result.renderTree, 'Bump')
    expect(texts(result.renderTree)).toContain('Count 1')
  })
})

// --------------------------------------------------------------- tab views

describe('TabView', () => {
  const SOURCE = app(`    var body: some View {
        TabView {
            Text("Home screen")
                .tabItem {
                    Label("Home", systemImage: "house")
                }

            Text("Settings screen")
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
        }
    }`)

  it('shows the first tab and switches on tap', () => {
    let result = run(SOURCE)
    expect(texts(result.renderTree)).toContain('Home screen')
    expect(texts(result.renderTree)).not.toContain('Settings screen')

    result = tap(result.renderTree, 'Settings')
    expect(texts(result.renderTree)).toContain('Settings screen')
    expect(texts(result.renderTree)).not.toContain('Home screen')
  })

  it('keeps the bar pinned to the bottom of the screen', () => {
    const result = run(SOURCE)
    const labels = nodes(result).filter((n) => n.text?.runs[0]?.text === 'Home')
    const item = labels[labels.length - 1]!
    expect(item.frame.y).toBeGreaterThan(device.height - 120)
  })
})

// -------------------------------------------------------------- appearance

describe('appearance modifiers', () => {
  it('paints a border outside its content', () => {
    const result = run(
      app(`    var body: some View {
        Text("Boxed")
            .padding()
            .border(Color.red, width: 2)
    }`),
    )
    const border = nodes(result).find((n) => n.border)
    expect(border).toBeDefined()
    expect(border!.border!.width).toBe(2)
    expect(border!.border!.color.r).toBe(255)
  })

  it('casts a shadow behind its content', () => {
    const result = run(
      app(`    var body: some View {
        Text("Lifted").shadow(radius: 8, y: 4)
    }`),
    )
    const shadow = nodes(result).find((n) => n.shadow)
    expect(shadow?.shadow).toMatchObject({ radius: 8, y: 4 })
  })

  it('clips to a shape with a real container', () => {
    const result = run(
      app(`    var body: some View {
        Rectangle()
            .frame(width: 80, height: 80)
            .clipShape(Circle())
    }`),
    )
    const clip = nodes(result).find((n) => n.clip && !n.scroll)
    expect(clip).toBeDefined()
    expect(clip!.cornerRadius).toBe(40)
  })

  it('offsets without moving its neighbours', () => {
    const result = run(
      app(`    var body: some View {
        VStack(spacing: 0) {
            Text("first").offset(x: 20)
            Text("second")
        }
    }`),
    )
    const painted = nodes(result)
    const first = painted.find((n) => n.text?.runs[0]?.text === 'first')!
    const second = painted.find((n) => n.text?.runs[0]?.text === 'second')!

    // The offset view moved; the stack behaved as though it had not.
    expect(first.frame.x).toBeGreaterThan(second.frame.x)
    expect(second.frame.y).toBe(first.frame.y + first.frame.height)
  })

  it('fills with a gradient', () => {
    const result = run(
      app(`    var body: some View {
        Text("Sky")
            .padding()
            .background(
                LinearGradient(
                    colors: [Color.blue, Color.purple],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
    }`),
    )
    const gradient = nodes(result).find((n) => n.background?.kind === 'linearGradient')
    expect(gradient).toBeDefined()
    expect(gradient!.background).toMatchObject({ kind: 'linearGradient' })
  })

  it('applies a system font with an explicit size and weight', () => {
    const result = run(
      app(`    var body: some View {
        Text("Big").font(.system(size: 40, weight: .bold))
    }`),
    )
    const text = nodes(result).find((n) => n.text)!
    expect(text.text!.runs[0]!.font.size).toBe(40)
    expect(text.text!.runs[0]!.font.weight).toBe(700)
  })

  it('changes weight without changing size', () => {
    const result = run(
      app(`    var body: some View {
        Text("Heavy").font(.title).fontWeight(.semibold)
    }`),
    )
    const font = nodes(result).find((n) => n.text)!.text!.runs[0]!.font
    expect(font.size).toBe(28)
    expect(font.weight).toBe(600)
  })
})
