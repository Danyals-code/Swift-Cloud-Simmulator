import { describe, expect, it } from 'vitest'
import type { SourceFile } from '@studio/shared'
import { TEMPLATES } from '@studio/project-model/templates'
import { buildAuthoringModel } from '@studio/swift-sema'
import { Lexer, offMarker } from '@studio/swift-syntax'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'

/**
 * A layer's fingerprint is saved with the names a designer gives layers, so it must read
 * the same for the same source from one version to the next: the kind and text of each
 * token in the view's own source, lexed on its own.
 */
const lexedAlone = (files: readonly SourceFile[], span: { file: string; start: number; end: number }) => {
  const text = files.find(file => file.id === span.file)?.text.slice(span.start, span.end) ?? ''
  return JSON.stringify(Lexer.tokenize(text, span.file).tokens.filter(token => token.kind !== 'endOfFile').map(token => [token.kind, token.text]))
}

/** Built on its own, which lexes each file, and by the preview, which hands it the tokens its parse lexed. */
const expectFingerprints = (files: readonly SourceFile[]) => {
  resetPipelineState()
  const compiled = compile({ files, canvas: { width: 393, height: 852 }, colorScheme: 'light', revision: 1 }).authoring
  for (const snapshot of [buildAuthoringModel({ projectId: 'fingerprints', revision: 1, files }), compiled!]) {
    expect(snapshot.nodes.length).toBeGreaterThan(0)
    for (const node of snapshot.nodes) expect([node.name, node.fingerprint]).toEqual([node.name, lexedAlone(files, node.source)])
  }
}

const TRICKY = String.raw`import SwiftUI
@main struct App1: App { var body: some Scene { WindowGroup { Root() } } }
struct Root: View {
    @State private var count = -1
    var body: some View {
        VStack(spacing: -8) { // a comment
            Text("Item \(count) of \("all".uppercased())") /* trailing */
            Text(#"raw \(not) "quoted""#)${offMarker('.bold()')}
            Text("👋🏽 and a tab:${'\t'} and a \\ backslash")
            Text("multi") + Text("joined").bold()
            if count > 0 { Text("positive") } else if count < -1 { Text("negative") } else { Text("zero") }
            Button("Tap") { count += 1 }
                .padding()${offMarker('.background(Color.blue)')}
            Text("""
                multiline
                """)
            label(for: "x").opacity(0.5)
            Image(systemName: "star").frame(width: 1e2, height: 0x10)
        }
    }
    func label(for name: String) -> some View { Text(name).font(.headline) }
}
#Preview { Root() }
`

const BROKEN = String.raw`import SwiftUI
struct Broken: View {
    var body: some View {
        VStack {
            Text("a"
            Text("\(Image(systemName: "star")) b")
            #if DEBUG
            Text("debug")
            #endif
            Text("unterminated)
            ForEach(0..<3) { i in Text("\(i)") }
            switch count { case 1: Text("one") default: EmptyView() }
        }
    }
}
`

describe('layer fingerprints', () => {
  it('are each view lexed on its own, in a file with comments, markers, strings and joined text', () => {
    expectFingerprints([{ id: 'Sources/App.swift', text: TRICKY }])
  })

  it('are each view lexed on its own in a file that does not parse', () => {
    expectFingerprints([{ id: 'Sources/Broken.swift', text: BROKEN }])
  })

  it('are each view lexed on its own in every template', () => {
    for (const template of TEMPLATES) expectFingerprints(template.files.map(file => ({ id: file.id, text: file.text })))
  })
})
