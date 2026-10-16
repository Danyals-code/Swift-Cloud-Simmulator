import { beforeEach, expect, it } from 'vitest'
import { resetPipelineState } from '@studio/swiftui-runtime'
import { draw } from './helpers/layer-project'

/**
 * A real SwiftUI modifier the preview does not draw is named as one, never as a modifier
 * the preview does not know, which reads like a typo that would stop Xcode building.
 */
beforeEach(resetPipelineState)

const warnings = (body: string, members = '') => draw([
  { id: 'App.swift', text: `import SwiftUI\n@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View {\n${members}    var body: some View { ${body} }\n}\n` },
]).diagnostics.filter(d => d.severity === 'warning').map(d => d.message)

it.each([
  ['.sensoryFeedback', 'Text("A").sensoryFeedback(.success, trigger: tapped)'],
  ['.labelsHidden', 'Toggle("A", isOn: $tapped).labelsHidden()'],
])('names %s as recognized but not drawn', (name, body) => {
  const said = warnings(body, '    @State private var tapped = false\n').join('\n')
  expect(said).toContain(`'${name}' is recognized but not applied by the preview`)
  expect(said).not.toContain('does not recognise')
})

it.each([
  ['.contentTransition', 'Text("A").contentTransition(.numericText())', ''],
  ['.matchedGeometryEffect and @Namespace', 'Text("A").matchedGeometryEffect(id: "a", in: space)', '    @Namespace private var space\n'],
  ['a Namespace.ID handed to a view', 'Text("A").matchedGeometryEffect(id: "a", in: space)', '    let space: Namespace.ID\n'],
])('says nothing of %s, which the preview draws (Wave 5a)', (_, body, members) => {
  expect(warnings(body, members)).toEqual([])
})

it('still says a name no SwiftUI view has is unknown', () => {
  expect(warnings('Text("A").shimmerz()').join('\n')).toContain("does not recognise the modifier '.shimmerz'")
})
