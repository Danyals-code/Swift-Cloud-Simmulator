import { beforeEach, describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult, Point, RenderNode, RenderTree } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * Gestures.
 *
 * Every test here drives the real dispatch path with real event phases, because a
 * gesture is a *sequence* — a drag that reports its translation correctly on
 * `changed` and forgets to revert its `@GestureState` on `ended` is broken in a way
 * no single-frame assertion can see.
 */

const device = DEVICES['iphone-15']
let revision = 1

function app(body: string): string {
  return `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
${body}
}
`
}

function run(source: string): CompileResult {
  resetPipelineState()
  const request: CompileRequest = {
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  }
  const result = compile(request)
  expect(result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([])
  return result
}

function texts(tree: RenderTree | null): string[] {
  return (tree?.nodes ?? []).flatMap((n) => n.text?.runs.map((r) => r.text) ?? [])
}

function draggable(tree: RenderTree | null): RenderNode {
  const found = (tree?.nodes ?? []).find((n) => n.hitTarget?.role === 'drag')
  expect(found, 'no draggable node').toBeDefined()
  return found!
}

function drag(
  tree: RenderTree | null,
  phase: 'began' | 'changed' | 'ended',
  translation: Point,
): CompileResult {
  const target = draggable(tree)
  applyEvent({
    kind: 'drag',
    handlerId: target.hitTarget!.handlerId,
    phase,
    location: { x: translation.x, y: translation.y },
    startLocation: { x: 0, y: 0 },
    translation,
  })
  return rerender(revision++)
}

beforeEach(() => {
  resetPipelineState()
})

describe('DragGesture', () => {
  const SOURCE = app(`    @State private var offset = CGSize.zero

    var body: some View {
        Rectangle()
            .frame(width: 80, height: 80)
            .offset(x: offset.width, y: offset.height)
            .gesture(
                DragGesture()
                    .onChanged { value in
                        offset = value.translation
                    }
                    .onEnded { value in
                        offset = CGSize.zero
                    }
            )
        Text("at \\(Int(offset.width)), \\(Int(offset.height))")
    }`)

  it('reports the cumulative translation while dragging', () => {
    let result = run(SOURCE)
    expect(texts(result.renderTree)).toContain('at 0, 0')

    result = drag(result.renderTree, 'changed', { x: 40, y: 25 })
    expect(texts(result.renderTree)).toContain('at 40, 25')

    // Cumulative, not incremental: the second report replaces the first.
    result = drag(result.renderTree, 'changed', { x: 60, y: 25 })
    expect(texts(result.renderTree)).toContain('at 60, 25')
  })

  it('runs onEnded when the drag finishes', () => {
    let result = run(SOURCE)
    result = drag(result.renderTree, 'changed', { x: 40, y: 25 })
    result = drag(result.renderTree, 'ended', { x: 40, y: 25 })
    expect(texts(result.renderTree)).toContain('at 0, 0')
  })

  it('marks the view as draggable rather than tappable', () => {
    const result = run(SOURCE)
    expect(draggable(result.renderTree).hitTarget!.role).toBe('drag')
  })
})

describe('@GestureState', () => {
  const SOURCE = app(`    @GestureState private var drag = CGSize.zero

    var body: some View {
        Rectangle()
            .frame(width: 80, height: 80)
            .gesture(
                DragGesture()
                    .updating($drag) { value, state, transaction in
                        state = value.translation
                    }
            )
        Text("held \\(Int(drag.width))")
    }`)

  it('writes through the projection, which is what inout would do', () => {
    let result = run(SOURCE)
    expect(texts(result.renderTree)).toContain('held 0')

    result = drag(result.renderTree, 'changed', { x: 33, y: 0 })
    expect(texts(result.renderTree)).toContain('held 33')
  })

  it('reverts when the gesture ends', () => {
    // The defining property of gesture state: it is transient. Ordinary `@State`
    // would keep the last value and this test would fail.
    let result = run(SOURCE)
    result = drag(result.renderTree, 'changed', { x: 33, y: 0 })
    result = drag(result.renderTree, 'ended', { x: 33, y: 0 })
    expect(texts(result.renderTree)).toContain('held 0')
  })
})

describe('gesture composition', () => {
  it('runs both halves of a simultaneous gesture', () => {
    const source = app(`    @State private var drags = 0
    @State private var magnifications = 0

    var body: some View {
        Rectangle()
            .frame(width: 100, height: 100)
            .gesture(
                DragGesture()
                    .onChanged { value in
                        drags += 1
                    }
                    .simultaneously(
                        with: MagnificationGesture()
                            .onChanged { value in
                                magnifications += 1
                            }
                    )
            )
        Text("\\(drags) drags, \\(magnifications) zooms")
    }`)

    let result = run(source)
    result = drag(result.renderTree, 'changed', { x: 10, y: 0 })
    expect(texts(result.renderTree)).toContain('1 drags, 0 zooms')

    // A magnify event reaches only the magnification half, which is the point of
    // composition: each gesture responds to its own kind of input.
    const target = draggable(result.renderTree)
    applyEvent({
      kind: 'magnify',
      handlerId: target.hitTarget!.handlerId,
      phase: 'changed',
      scale: 1.5,
    })
    result = rerender(revision++)
    expect(texts(result.renderTree)).toContain('1 drags, 1 zooms')
  })
})

describe('magnify and rotate', () => {
  it('reports the magnification factor', () => {
    const source = app(`    @State private var scale = 1.0

    var body: some View {
        Rectangle()
            .frame(width: 60, height: 60)
            .gesture(
                MagnificationGesture()
                    .onChanged { value in
                        scale = value.magnification
                    }
            )
        Text("scale \\(scale)")
    }`)

    let result = run(source)
    const target = draggable(result.renderTree)
    applyEvent({
      kind: 'magnify',
      handlerId: target.hitTarget!.handlerId,
      phase: 'changed',
      scale: 2.5,
    })
    result = rerender(revision++)
    expect(texts(result.renderTree)).toContain('scale 2.5')
  })

  it('reports rotation in degrees', () => {
    const source = app(`    @State private var angle = 0.0

    var body: some View {
        Rectangle()
            .frame(width: 60, height: 60)
            .gesture(
                RotationGesture()
                    .onChanged { value in
                        angle = value.degrees
                    }
            )
        Text("angle \\(Int(angle))")
    }`)

    let result = run(source)
    const target = draggable(result.renderTree)
    applyEvent({
      kind: 'rotate',
      handlerId: target.hitTarget!.handlerId,
      phase: 'changed',
      degrees: 45,
    })
    result = rerender(revision++)
    expect(texts(result.renderTree)).toContain('angle 45')
  })
})
