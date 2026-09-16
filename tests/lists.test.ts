import { beforeEach, describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult, RenderNode, RenderTree } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * List actions and search.
 *
 * `.onDelete` is written on the `ForEach` but the thing that gets swiped is the
 * *row*, and the closure needs to know which offset went - so most of what is tested
 * here is that those three facts stay connected through a drag.
 */

const device = DEVICES['iphone-15']
let revision = 1

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

function control(tree: RenderTree | null, label: string): RenderNode | undefined {
  return (tree?.nodes ?? []).find((n) => n.hitTarget && n.a11y?.label === label)
}

function swipeRows(tree: RenderTree | null): RenderNode[] {
  return (tree?.nodes ?? []).filter((n) => n.hitTarget?.role === 'drag')
}

const TODO_APP = `import SwiftUI

struct Todo: Identifiable {
    let id: Int
    let title: String
}

@main
struct TodoApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @State private var todos = [
        Todo(id: 1, title: "Write it"),
        Todo(id: 2, title: "Test it"),
        Todo(id: 3, title: "Ship it")
    ]

    var body: some View {
        NavigationStack {
            List {
                ForEach(todos) { todo in
                    Text(todo.title)
                }
                .onDelete { offsets in
                    todos.remove(atOffsets: offsets)
                }
            }
            .navigationTitle("Todos")
        }
    }
}
`

beforeEach(() => {
  resetPipelineState()
})

describe('.onDelete', () => {
  it('reveals a delete action when a row is swiped', () => {
    let result = run(TODO_APP)
    expect(texts(result.renderTree)).not.toContain('Delete')

    const row = swipeRows(result.renderTree)[0]!
    applyEvent({
      kind: 'drag',
      handlerId: row.hitTarget!.handlerId,
      phase: 'changed',
      location: { x: -60, y: 0 },
      startLocation: { x: 0, y: 0 },
      translation: { x: -60, y: 0 },
    })
    result = rerender(revision++)

    expect(texts(result.renderTree)).toContain('Delete')
  })

  it('removes the row the action belongs to', () => {
    let result = run(TODO_APP)
    expect(texts(result.renderTree)).toContain('Test it')

    // Swipe the *second* row; the offset the closure receives must be that row's.
    const row = swipeRows(result.renderTree)[1]!
    applyEvent({
      kind: 'drag',
      handlerId: row.hitTarget!.handlerId,
      phase: 'ended',
      location: { x: -90, y: 0 },
      startLocation: { x: 0, y: 0 },
      translation: { x: -90, y: 0 },
    })
    result = rerender(revision++)

    const del = control(result.renderTree, 'Delete')!
    applyEvent({ kind: 'tap', handlerId: del.hitTarget!.handlerId, location: { x: 0, y: 0 } })
    result = rerender(revision++)

    expect(texts(result.renderTree)).not.toContain('Test it')
    expect(texts(result.renderTree)).toContain('Write it')
    expect(texts(result.renderTree)).toContain('Ship it')
  })

  it('snaps shut when the swipe does not go far enough', () => {
    let result = run(TODO_APP)
    const row = swipeRows(result.renderTree)[0]!

    applyEvent({
      kind: 'drag',
      handlerId: row.hitTarget!.handlerId,
      phase: 'ended',
      location: { x: -10, y: 0 },
      startLocation: { x: 0, y: 0 },
      translation: { x: -10, y: 0 },
    })
    result = rerender(revision++)

    expect(texts(result.renderTree)).not.toContain('Delete')
  })
})

describe('.searchable', () => {
  const SEARCH_APP = `import SwiftUI

@main
struct SearchApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @State private var query = ""
    let cities = ["Kyoto", "Lisbon", "Oslo"]

    var matches: [String] {
        if query.isEmpty {
            return cities
        }
        var found: [String] = []
        for city in cities {
            if city.lowercased().hasPrefix(query.lowercased()) {
                found.append(city)
            }
        }
        return found
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(matches, id: \\.self) { city in
                    Text(city)
                }
            }
            .searchable(text: $query)
            .navigationTitle("Cities")
        }
    }
}
`

  it('draws search in the navigation drawer on phones', () => {
    const result = run(SEARCH_APP)
    const field = (result.renderTree?.nodes ?? []).find((n) => n.hitTarget?.role === 'textField')
    expect(field).toBeDefined()
    expect(field!.hitTarget!.placeholder).toBe('Search')

    expect(field!.parent).toBe(result.renderTree!.chrome!.scrollId)
    expect(field!.frame.y).toBeLessThan(100)
  })

  it('filters the list through its binding', () => {
    let result = run(SEARCH_APP)
    expect(texts(result.renderTree)).toContain('Lisbon')
    expect(texts(result.renderTree)).toContain('Oslo')

    const field = (result.renderTree?.nodes ?? []).find((n) => n.hitTarget?.role === 'textField')!
    applyEvent({ kind: 'textChange', handlerId: field.hitTarget!.handlerId, value: 'lis' })
    result = rerender(revision++)

    expect(texts(result.renderTree)).toContain('Lisbon')
    expect(texts(result.renderTree)).not.toContain('Oslo')
  })
})

describe('.ignoresSafeArea', () => {
  it('lets content extend under the device edges', () => {
    const result = run(`import SwiftUI

@main
struct EdgeApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    var body: some View {
        Color.blue
            .ignoresSafeArea()
    }
}
`)
    const fill = (result.renderTree?.nodes ?? []).find(
      (n) => n.id !== 'screen' && n.background?.kind === 'solid',
    )!
    expect(fill.frame.y).toBe(0)
    expect(fill.frame.height).toBe(device.height)
  })
})
