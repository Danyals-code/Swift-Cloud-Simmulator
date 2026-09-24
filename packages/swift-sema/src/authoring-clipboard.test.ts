import { describe, expect, it } from 'vitest'
import { copiedView } from './authoring-clipboard'

/**
 * A view copied from one screen and pasted onto another brings along the values it
 * reads (D6). What comes along is each stored value of its screen it names, written as
 * its screen wrote it; a value tied to something else stays behind.
 */
describe('what a copied view brings along', () => {
  const FILE = 'Sources/HomeScreen.swift'
  const HOME = `import SwiftUI

struct HomeScreen: View {
    @State private var count = 0
    @State private var isOn = true
    let title = "Plans"
    @Environment(\\.dismiss) private var dismiss
    var summary: String { "\\(count) plans" }

    var body: some View {
        VStack {
            Text("Count \\(count)")
            Toggle("Notify", isOn: $isOn)
            Button("Add") { count += 1 }
            Text(title)
            Button("Close") { dismiss() }
            Text(summary)
            Text("Plain")
        }
    }
}
`
  const values = (view: string) => {
    const copied = copiedView(HOME, FILE, HOME.indexOf(view))
    if ('refused' in copied) throw new Error(copied.refused)
    return copied.values
  }

  it('brings the stored values the view reads, as its screen wrote them', () => {
    expect(copiedView(HOME, FILE, HOME.indexOf('Text("Count'))).toEqual({ snippet: 'Text("Count \\(count)")', values: ['@State private var count = 0'] })
    expect(values('Toggle("Notify"')).toEqual(['@State private var isOn = true'])
    expect(values('Button("Add")')).toEqual(['@State private var count = 0'])
    expect(values('Text(title)')).toEqual(['let title = "Plans"'])
  })

  it('leaves behind a value tied to something else, and brings nothing for a view that reads none', () => {
    expect(values('Button("Close")')).toEqual([])
    expect(values('Text(summary)')).toEqual([])
    expect(values('Text("Plain")')).toEqual([])
  })

  it('leaves behind a value made of a type its screen declares inside it, which no other screen can see', () => {
    const sorted = HOME.replace('    let title = "Plans"\n', '    enum Sort { case name, date }\n    @State private var sort = Sort.name\n').replace('Text("Plain")', 'Text(sort == .name ? "By name" : "By date")')
    const copied = copiedView(sorted, FILE, sorted.indexOf('Text(sort'))
    expect(copied).toMatchObject({ values: [] })
  })

  it('says why a view that is part of the code around it cannot be copied', () => {
    const either = HOME.replace('Text("Plain")', 'true ? Text("Plain") : Text("Other")')
    expect(copiedView(either, FILE, either.indexOf('Text("Other")'))).toEqual({ refused: 'This view is part of the code around it, so it can’t be copied on its own. Change it in Code.' })
  })
})
