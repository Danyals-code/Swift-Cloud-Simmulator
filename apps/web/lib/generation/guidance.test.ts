import { describe, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { buildAuthoringModel } from '@studio/swift-sema'
import { STYLE_EXAMPLE, SWIFTUI_GUIDANCE } from './guidance'

/**
 * The SwiftUI both AI prompts ask for (G1): what the preview draws as the simulator
 * does, and what the Design view can go on editing.
 */

/** The SF Symbols the prompts offer, as the guidance lists them. */
const offered = () => new Set(SWIFTUI_GUIDANCE.match(/SF Symbols[^:]*: ([^\n]+)/)![1]!.split(', '))

describe('the SwiftUI the AI is asked for', () => {
  it('says how iOS writes a number put into a title, and the forms that write it as meant', () => {
    expect(SWIFTUI_GUIDANCE).toContain('Text("\\(price)") shows a Double with six decimals (3.500000) and a whole number with separators (2,000, and a year as 2,026)')
    expect(SWIFTUI_GUIDANCE).toContain('Write decimals as Text(price, format: .currency(code: "USD")), price.formatted() or Text("\\(distance, specifier: "%.1f") km"), and a year or a code as Text(String(year)).')
  })

  it('steers away from date format styles the preview cannot run, to the form it can', () => {
    expect(SWIFTUI_GUIDANCE).toContain('DateFormatter and .dateTime format styles such as .formatted(.dateTime.month(.wide)) (write date.formatted(date: .abbreviated, time: .omitted))')
    resetPipelineState()
    const files = [{ id: 'App.swift', text: 'import SwiftUI\n@main struct DatesApp: App { var body: some Scene { WindowGroup { Text(Date().formatted(date: .abbreviated, time: .omitted)) } } }' }]
    const preview = compile({ files, canvas: { width: 402, height: 874 }, colorScheme: 'light', revision: 1 })
    expect([...preview.diagnostics.map(d => d.message), ...preview.logs.filter(log => log.level === 'error').map(log => log.message)]).toEqual([])
  })

  it('offers only SF Symbols the preview draws and Apple ships', () => {
    const symbols = offered()

    expect(symbols).toContain('house')
    expect(symbols).toContain('gearshape.fill')
    expect(symbols).toContain('checkmark.circle.fill')
    // Drawn by the preview once, but Apple ships no symbol by these names: Xcode shows nothing.
    expect(symbols).not.toContain('gear.fill')
    expect(symbols).not.toContain('sparkles.fill')
    // A real symbol the preview has no drawing for.
    expect(symbols).not.toContain('figure.run')
  })

  it('shows an example that the preview draws without a warning, and whose tabs, records and buttons Design can edit', () => {
    const files = [{ id: 'Sources/TripsApp.swift', text: STYLE_EXAMPLE }]
    resetPipelineState()
    const preview = compile({ files, canvas: { width: 402, height: 874 }, colorScheme: 'light', revision: 1, allPages: true })
    const design = buildAuthoringModel({ files, projectId: 'example', revision: 1 })

    expect(SWIFTUI_GUIDANCE).toContain(STYLE_EXAMPLE)
    expect(preview.diagnostics.map(d => d.message)).toEqual([])
    expect(preview.logs.filter(log => log.level === 'error')).toEqual([])
    expect(preview.renderTree?.nodes.some(node => node.kind === 'placeholder')).toBe(false)
    expect(design.navigation).toMatchObject({ style: 'tabs', editable: true, tabs: [{ name: 'Trips', icon: 'airplane' }, { name: 'Settings', icon: 'gearshape' }] })
    expect(design.nodes.find(node => node.kind === 'collection')?.collection).toMatchObject({ recordType: 'Trip', mutable: true })
    expect(design.nodes.filter(node => node.behavior?.canConfigureAction).length).toBeGreaterThanOrEqual(2)
  })
})
