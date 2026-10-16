import { beforeEach, describe, expect, it } from 'vitest'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { cssEasing, cssSeconds, type CompileResult, type RenderNode } from '@studio/shared'

// Motion as iOS 27 plays it (Wave 5a), read from the frames `compile` and `rerender`
// emit. What each expectation stands for is measured in
// docs/parity/native/iphone18pro-motion/measurements.json.

let revision = 1
beforeEach(() => { resetPipelineState(); revision = 1 })

const words = (node: RenderNode) => node.text?.runs.map(run => run.text).join('')
const keyOf = (node: RenderNode) => node.key ?? node.id

function app(view: string, extra = '') {
  const result = compile({
    projectId: 'motion-runtime', revision: revision++, canvas: { width: 402, height: 874 }, colorScheme: 'light',
    files: [{ id: 'Sources/App.swift', text: `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
${view}
${extra}` }],
  })
  expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
  return result
}

function tap(result: CompileResult, label: string) {
  const button = result.renderTree!.nodes.find(node => node.hitTarget && node.a11y?.label === label)!
  expect(applyEvent({ kind: 'tap', handlerId: button.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
  return rerender(revision++)
}

const textNode = (result: CompileResult, text: string) => result.renderTree!.nodes.find(node => words(node) === text)

describe('identity across an if', () => {
  it('keeps the key of a view after an if when the if opens, while its id stays positional', () => {
    const before = app(`struct ContentView: View {
    @State private var showDetails = false
    var body: some View {
        VStack {
            Button("Show details") { showDetails.toggle() }
            if showDetails {
                Text("Check-in opens 24 hours before departure.")
            }
            Text("Always here")
        }
    }
}`)
    const always = textNode(before, 'Always here')!
    const after = tap(before, 'Show details')
    const moved = textNode(after, 'Always here')!
    expect(moved.id).not.toBe(always.id)
    expect(keyOf(moved)).toBe(keyOf(always))
    const inserted = textNode(after, 'Check-in opens 24 hours before departure.')!
    expect(before.renderTree!.nodes.map(keyOf)).not.toContain(keyOf(inserted))
    const keys = after.renderTree!.nodes.map(keyOf)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keyOf(textNode(tap(after, 'Show details'), 'Always here')!)).toBe(keyOf(always))
  })

  it('keeps the key of a field an if moves, while its handler moves with its path', () => {
    // The DOM keeps the field's element by its key, so it sends what the old handler
    // didn't take to the new one (control-draft's `moved`).
    const before = app(`struct ContentView: View {
    @State private var name = ""
    var body: some View {
        VStack {
            if !name.isEmpty { Text("Hello \\(name)") }
            TextField("Name", text: $name)
            Text("Say hello")
        }
    }
}`)
    const field = (result: CompileResult) => result.renderTree!.nodes.find(node => node.hitTarget?.role === 'textField')!
    const was = field(before).hitTarget!.handlerId
    expect(applyEvent({ kind: 'textChange', handlerId: was, value: 't' })).toBe(true)
    const after = rerender(revision++)
    expect(textNode(after, 'Hello t')).toBeDefined()
    expect(keyOf(field(after))).toBe(keyOf(field(before)))
    expect(field(after).hitTarget!.handlerId).not.toBe(was)
    expect(applyEvent({ kind: 'textChange', handlerId: was, value: 'th' })).toBe(false)
    expect(applyEvent({ kind: 'textChange', handlerId: field(after).hitTarget!.handlerId, value: 'th' })).toBe(true)
    expect(textNode(rerender(revision++), 'Hello th')).toBeDefined()
  })
})

describe('identity of branches', () => {
  it('keeps the key of a view whose own body is an if when an if beside it opens', () => {
    const before = app(`struct ContentView: View {
    @State private var showBanner = false
    var body: some View {
        VStack {
            if showBanner {
                Text("Banner")
            }
            Row(title: "First", selected: true)
            Row(title: "Second", selected: true)
            Button("Banner") { showBanner.toggle() }
        }
    }
}`, `struct Row: View {
    let title: String
    let selected: Bool
    var body: some View {
        if selected {
            Text(title).bold()
        } else {
            Text(title)
        }
    }
}`)
    const after = tap(before, 'Banner')
    expect(textNode(after, 'Banner')).toBeDefined()
    for (const title of ['First', 'Second']) expect(keyOf(textNode(after, title)!)).toBe(keyOf(textNode(before, title)!))
    const keys = after.renderTree!.nodes.map(keyOf)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps the keys of the views a @ViewBuilder property or function draws when an if in it opens', () => {
    for (const [use, helper] of [
      ['header', '@ViewBuilder private var header: some View {'],
      ['header(title: "Sub")', '@ViewBuilder private func header(title: String) -> some View {'],
    ]) {
      resetPipelineState()
      const before = app(`struct ContentView: View {
    @State private var show = false
    var body: some View {
        VStack {
            if show { Text("Top") }
            ${use}
            Text("After")
            Button("Toggle") { withAnimation { show.toggle() } }
        }
    }
    ${helper}
        if show { Text("Head") }
        Text("Sub")
    }
}`)
      const after = tap(before, 'Toggle')
      expect(textNode(after, 'Head')).toBeDefined()
      for (const text of ['Sub', 'After', 'Toggle']) expect(keyOf(textNode(after, text)!)).toBe(keyOf(textNode(before, text)!))
      // The helper's `if` is its own, not the `if` beside it, so neither takes the other's key.
      const back = tap(after, 'Toggle')
      expect(textNode(back, 'Head')).toBeUndefined()
      expect(keyOf(textNode(after, 'Head')!)).not.toBe(keyOf(textNode(after, 'Top')!))
      for (const result of [before, after, back]) {
        const keys = result.renderTree!.nodes.map(keyOf)
        expect(new Set(keys).size).toBe(keys.length)
      }
      expect(keyOf(textNode(back, 'Sub')!)).toBe(keyOf(textNode(before, 'Sub')!))
    }
  })

  it('draws such a helper wherever one view goes, and nothing where its if drew nothing', () => {
    const result = app(`struct ContentView: View {
    @State private var show = false
    var body: some View {
        NavigationStack {
            VStack {
                Text("Base").overlay { badge }
                empty.padding()
                Text("After")
            }
            .toolbar { ToolbarItem { badge } }
        }
    }
    @ViewBuilder private var badge: some View {
        if show { Text("On") } else { Image(systemName: "star") }
    }
    @ViewBuilder private var empty: some View {
        if show { Text("Never") }
    }
}`)
    expect(result.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
    const nodes = result.renderTree!.nodes
    expect(nodes.filter(node => node.kind === 'placeholder')).toEqual([])
    expect(nodes.filter(node => node.kind === 'image').map(node => node.a11y?.label)).toHaveLength(2)
  })

  it('keeps the key of a view a branch draws from a static let, pass after pass', () => {
    // The branch marks a copy: the static is drawn again on the next pass.
    let result = app(`struct ContentView: View {
    static let note = Text("Note")
    @State private var count = 0
    var body: some View {
        VStack {
            if count >= 0 { Self.note }
            Button("Add") { count += 1 }
        }
    }
}`)
    const first = keyOf(textNode(result, 'Note')!)
    for (let i = 0; i < 3; i++) result = tap(result, 'Add')
    expect(keyOf(textNode(result, 'Note')!)).toBe(first)
  })

  it('gives the two sides of an if/else keys of their own, so they are two views', () => {
    const before = app(`struct ContentView: View {
    @State private var big = false
    var body: some View {
        VStack {
            if big {
                RoundedRectangle(cornerRadius: 24).frame(height: 300)
            } else {
                RoundedRectangle(cornerRadius: 12).frame(width: 80, height: 80)
            }
            Button("Grow") { big.toggle() }
        }
    }
}`)
    const shape = (result: CompileResult) => result.renderTree!.nodes.find(node => node.kind === 'shape')!
    const small = shape(before)
    const after = tap(before, 'Grow')
    expect(shape(after).frame.height).toBe(300)
    expect(keyOf(shape(after))).not.toBe(keyOf(small))
    expect(keyOf(textNode(after, 'Grow')!)).toBe(keyOf(textNode(before, 'Grow')!))
  })

  it('keeps every sibling of a long list, nested branches and a switch on its key', () => {
    const rows = Array.from({ length: 12 }, (_, i) => `Text("t${i}")`).join('\n            ')
    const before = app(`struct ContentView: View {
    @State private var on = false
    var body: some View {
        VStack {
            if on {
                Text("Top")
                if !on { Text("Never") } else { Text("Nested") }
            }
            ${rows}
            switch on {
            case true: Text("Yes")
            case false: Text("No")
            }
            Button("Change") { on.toggle() }
        }
    }
}`)
    const after = tap(before, 'Change')
    for (let i = 0; i < 12; i++) expect(keyOf(textNode(after, `t${i}`)!)).toBe(keyOf(textNode(before, `t${i}`)!))
    expect(keyOf(textNode(after, 'Change')!)).toBe(keyOf(textNode(before, 'Change')!))
    expect(keyOf(textNode(after, 'Yes')!)).not.toBe(keyOf(textNode(before, 'No')!))
    expect(textNode(after, 'Nested')).toBeDefined()
    for (const result of [before, after]) {
      const keys = result.renderTree!.nodes.map(keyOf)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })
})

// Native: measurements.json `unanimated` and `valueOnlyChild`. What a frame says of the
// change that made it is what the DOM plays exits by.
describe('which change is animated', () => {
  it('says so for withAnimation and for the .animation(_:value:) whose value changed, and not otherwise', () => {
    const start = app(`struct ContentView: View {
    @State private var a = false
    @State private var b = false
    @State private var c = false
    var body: some View {
        VStack {
            Button("Plain") { a.toggle() }
            Button("Animated") { withAnimation(.linear(duration: 4)) { b.toggle() } }
            Button("Value") { c.toggle() }
            VStack {
                if c { Text("C") }
            }
            .animation(.easeInOut(duration: 1), value: c)
        }
    }
}`)
    expect(start.renderTree!.animated).toBeUndefined()
    const plain = tap(start, 'Plain')
    expect(plain.renderTree!.animated).toBeUndefined()
    expect(tap(plain, 'Animated').renderTree!.animated).toEqual({ all: { curve: 'linear', duration: 4 } })
    const value = tap(plain, 'Value')
    const under = value.renderTree!.animated?.under ?? []
    expect(under.map(scope => scope.animation)).toEqual([{ curve: 'easeInOut', duration: 1 }])
    expect(keyOf(textNode(value, 'C')!).startsWith(under[0]!.key)).toBe(true)
    expect(keyOf(textNode(value, 'Plain')!).startsWith(under[0]!.key)).toBe(false)
    expect(tap(value, 'Plain').renderTree!.animated).toBeUndefined()
  })
})

// Native: measurements.json `moveFade`, `asymmetric`, `pushTrailing`, `blurReplace` and `scale`.
describe('transition parts', () => {
  it('carries a push edge, blur, asymmetric sides, combined parts and a scale', () => {
    const start = app(`struct ContentView: View {
    @State private var show = false
    var body: some View {
        VStack {
            Button("Toggle") { show.toggle() }
            if show {
                Text("Banner")
                    .transition(.move(edge: .top).combined(with: .opacity))
                Text("Asym")
                    .transition(.asymmetric(insertion: .scale, removal: .opacity))
                Text("Push")
                    .transition(.push(from: .trailing))
                Text("Blur")
                    .transition(.blurReplace)
                Text("Half")
                    .transition(.scale(scale: 0.5))
                Text("Both")
                    .transition(AnyTransition.opacity.combined(with: .slide))
                Text("Still")
                    .transition(.identity)
                Text("Out only")
                    .transition(.asymmetric(insertion: .identity, removal: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: show)
    }
}`)
    expect(start.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
    const shown = tap(start, 'Toggle')
    const transition = (text: string) => textNode(shown, text)!.transition
    expect(transition('Banner')).toEqual({ kind: 'move', edge: 'top', also: [{ kind: 'opacity' }] })
    expect(transition('Asym')).toEqual({ kind: 'scale', removal: { kind: 'opacity' } })
    expect(transition('Push')).toEqual({ kind: 'push', edge: 'trailing' })
    expect(transition('Blur')).toEqual({ kind: 'blur' })
    expect(transition('Half')).toEqual({ kind: 'scale', scale: 0.5 })
    expect(transition('Both')).toEqual({ kind: 'opacity', also: [{ kind: 'slide' }] })
    // `.identity` plays nothing, rather than the fade a view with no transition plays.
    expect(transition('Still')).toEqual({ kind: 'identity' })
    expect(transition('Out only')).toEqual({ kind: 'identity', removal: { kind: 'opacity' } })
  })
})

// Native: measurements.json `curves`, logged frame by frame in the simulator.
describe('animation curves', () => {
  it('times each animation as iOS 27 does', () => {
    const styles = ['.default', '.smooth', '.spring', '.snappy', '.bouncy', '.interactiveSpring', '.interpolatingSpring', '.easeInOut', '.spring(duration: 0.8, bounce: 0.2)', '.spring(response: 0.4, dampingFraction: 0.6)']
    const buttons = styles.map((style, i) => `Button("S${i}") { withAnimation(${style}) { on.toggle() } }`).join('\n            ')
    let result = app(`struct ContentView: View {
    @State private var on = false
    var body: some View {
        VStack {
            ${buttons}
            Button("Plain") { withAnimation { on.toggle() } }
        }
    }
}`)
    const timing = styles.map((_, i) => (result = tap(result, `S${i}`)).renderTree!.animated?.all)
    expect(timing).toEqual([
      { curve: 'spring', duration: 0.5, bounce: 0 },
      { curve: 'spring', duration: 0.5, bounce: 0 },
      { curve: 'spring', duration: 0.5, bounce: 0 },
      { curve: 'spring', duration: 0.5, bounce: 0.15 },
      { curve: 'spring', duration: 0.5, bounce: 0.3 },
      { curve: 'spring', duration: 0.15, bounce: 0.14 },
      { curve: 'spring', duration: 0.5, bounce: 0 },
      { curve: 'easeInOut', duration: 0.35 },
      { curve: 'spring', duration: 0.8, bounce: 0.2 },
      { curve: 'spring', duration: 0.4, bounce: 0.4 },
    ])
    expect(tap(result, 'Plain').renderTree!.animated?.all).toEqual({ curve: 'spring', duration: 0.5, bounce: 0 })
  })

  it('draws a spring where the simulator measured it, frame by frame', () => {
    // The CSS easing as a function of seconds, read back from its `linear()` stops.
    const at = (spec: { curve: 'spring'; duration: number; bounce: number }, seconds: number) => {
      const stops = /^linear\((.*)\)$/.exec(cssEasing(spec))![1]!.split(',').map(Number)
      const x = Math.min(1, seconds / cssSeconds(spec)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x))
      return stops[i]! + (stops[i + 1]! - stops[i]!) * (x - i)
    }
    // Logged frames, [seconds from the start, value]: `curves.byAnimation.smooth` and `.bouncy`.
    const smooth = { curve: 'spring' as const, duration: 0.5, bounce: 0 }
    for (const [seconds, value] of [[0.049, 0.128], [0.116, 0.429], [0.217, 0.76], [0.317, 0.903], [0.484, 0.982]] as const) expect(Math.abs(at(smooth, seconds) - value)).toBeLessThan(0.02)
    const bouncy = { curve: 'spring' as const, duration: 0.5, bounce: 0.3 }
    for (const [seconds, value] of [[0.05, 0.14], [0.117, 0.513], [0.217, 0.923], [0.35, 1.042], [0.55, 1.005]] as const) expect(Math.abs(at(bouncy, seconds) - value)).toBeLessThan(0.02)
    // Removed by SwiftUI at 0.84 and 0.78 s; within 0.2% well before.
    expect(cssSeconds(smooth)).toBeLessThan(0.84)
    expect(cssSeconds(bouncy)).toBeLessThan(0.78)
    expect(cssEasing({ curve: 'easeInOut', duration: 0.35 })).toBe('cubic-bezier(0.42, 0, 0.58, 1)')
    expect(cssSeconds({ curve: 'easeInOut', duration: 0.35 })).toBe(0.35)
  })
})

// Native: measurements.json `numericText` and `textCrossFade`.
describe('content transitions', () => {
  it('says how each text changes: numbers roll, by their value, and fade', () => {
    const start = app(`struct ContentView: View {
    @State private var count = 9
    var body: some View {
        VStack {
            Text("\\(count)")
                .font(.largeTitle)
                .contentTransition(.numericText())
            Text("Value \\(count)").contentTransition(.numericText(value: Double(count)))
            Text("Down \\(count)").contentTransition(.numericText(countsDown: true))
            Text("Fade \\(count)").contentTransition(.opacity)
            Text("Plain \\(count)")
            VStack { Text("Inside \\(count)") }.contentTransition(.numericText())
            Button("Add") { withAnimation { count += 1 } }
        }
    }
}`)
    expect(start.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
    const after = tap(start, 'Add')
    expect(textNode(after, '10')!.contentTransition).toEqual({ kind: 'numeric' })
    expect(textNode(after, 'Value 10')!.contentTransition).toEqual({ kind: 'numeric', value: 10 })
    expect(textNode(start, 'Value 9')!.contentTransition).toEqual({ kind: 'numeric', value: 9 })
    expect(textNode(after, 'Down 10')!.contentTransition).toEqual({ kind: 'numeric', countsDown: true })
    expect(textNode(after, 'Fade 10')!.contentTransition).toEqual({ kind: 'opacity' })
    expect(textNode(after, 'Plain 10')!.contentTransition).toBeUndefined()
    expect(textNode(after, 'Inside 10')!.contentTransition).toEqual({ kind: 'numeric' })
    expect(keyOf(textNode(after, '10')!)).toBe(keyOf(textNode(start, '9')!))
  })
})

// Native: measurements.json `matchedGeometry`.
describe('matched geometry', () => {
  it('marks both sides of an if/else as one view in a namespace each copy has its own of', () => {
    const start = app(`struct ContentView: View {
    @Namespace private var hero
    @State private var big = false
    var body: some View {
        VStack {
            if big {
                RoundedRectangle(cornerRadius: 24)
                    .fill(.blue)
                    .matchedGeometryEffect(id: "card", in: hero)
                    .frame(height: 300)
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.blue)
                    .matchedGeometryEffect(id: "card", in: hero)
                    .frame(width: 80, height: 80)
            }
            Button("Grow") { withAnimation(.spring) { big.toggle() } }
            Badge()
            Badge()
        }
    }
}`, `struct Badge: View {
    @Namespace private var space
    var body: some View {
        Text("Badge").matchedGeometryEffect(id: "label", in: space, properties: .position, isSource: false)
    }
}`)
    expect(start.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
    const shape = (result: CompileResult) => result.renderTree!.nodes.find(node => node.kind === 'shape')!
    const after = tap(start, 'Grow')
    expect(shape(start).matched).toBeDefined()
    expect(shape(after).matched).toEqual(shape(start).matched)
    expect(keyOf(shape(after))).not.toBe(keyOf(shape(start)))
    const badges = after.renderTree!.nodes.filter(node => words(node) === 'Badge').map(node => node.matched)
    expect(badges).toHaveLength(2)
    expect(badges[0]).toMatchObject({ properties: 'position', isSource: false })
    expect(badges[0]!.id).not.toBe(badges[1]!.id)
    expect(textNode(after, 'Grow')!.matched).toBeUndefined()
  })
})
