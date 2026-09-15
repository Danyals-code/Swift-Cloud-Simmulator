import { describe, expect, it } from 'vitest'
import { declarationPathAt, declarationsIn } from './outline'

/**
 * The jump bar's scanner.
 *
 * It is allowed to be approximate about *where* a declaration ends, and not at all
 * about whether a `}` inside a string closes a type - which is the failure that
 * would make the bar name the wrong thing for the rest of the file rather than for
 * a moment. Most of what is here is that distinction.
 */

const FILE = `import SwiftUI

@main
struct TrailheadApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct Trail: Identifiable {
    let id: Int
    let name: String
}

struct RootView: View {
    @State private var query = ""

    var body: some View {
        Text("a } brace in a string")
    }

    func reset() {
        query = ""
    }
}
`

describe('declarationsIn', () => {
  it('finds every declaration in source order', () => {
    const names = declarationsIn(FILE).map((d) => `${d.kind} ${d.name}`)

    expect(names).toEqual([
      'struct TrailheadApp',
      'var body',
      'struct Trail',
      'let id',
      'let name',
      'struct RootView',
      'var query',
      'var body',
      'func reset',
    ])
  })

  it('nests members under the type that contains them', () => {
    const decls = declarationsIn(FILE)
    const type = decls.find((d) => d.name === 'Trail')!
    const member = decls.find((d) => d.name === 'id')!

    expect(type.depth).toBe(0)
    expect(member.depth).toBe(1)
  })

  it('does not let a brace inside a string close a type', () => {
    const decls = declarationsIn(FILE)
    const root = decls.find((d) => d.kind === 'struct' && d.name === 'RootView')!
    const reset = decls.find((d) => d.name === 'reset')!

    // `reset` is declared after the string containing `}`, and must still be
    // inside `RootView` - the whole point of masking literals before counting.
    expect(reset.start).toBeGreaterThan(root.start)
    expect(reset.start).toBeLessThan(root.end)
  })

  it('ignores declarations inside comments', () => {
    const text = '// struct Commented: View {}\n/* struct Blocked {} */\nstruct Real {}\n'
    expect(declarationsIn(text).map((d) => d.name)).toEqual(['Real'])
  })

  it('handles nested block comments, which Swift allows', () => {
    const text = '/* outer /* inner */ struct Hidden {} */\nstruct Real {}\n'
    expect(declarationsIn(text).map((d) => d.name)).toEqual(['Real'])
  })

  it('does not match a keyword that is part of a longer word', () => {
    const text = 'let functional = 1\nlet myStruct = 2\n'
    expect(declarationsIn(text).map((d) => d.name)).toEqual(['functional', 'myStruct'])
  })

  it('reads a multiline string literal to its end', () => {
    const text = ['let banner = """', 'struct NotReal {}', '"""', 'struct Real {}'].join('\n')
    expect(declarationsIn(text).map((d) => d.name)).toEqual(['banner', 'Real'])
  })
})

describe('declarationPathAt', () => {
  it('reports the chain containing an offset, outermost first', () => {
    const decls = declarationsIn(FILE)
    const reset = decls.find((d) => d.name === 'reset')!

    const path = declarationPathAt(decls, reset.start + 2).map((d) => d.name)
    expect(path).toEqual(['RootView', 'reset'])
  })

  it('is empty between declarations', () => {
    const decls = declarationsIn(FILE)
    // Offset 0 is `import`, outside every declaration.
    expect(declarationPathAt(decls, 0)).toEqual([])
  })
})
