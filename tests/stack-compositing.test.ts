import { beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import type { RenderTree } from '@studio/shared'
import { ancestors, worldFrame } from './render-geometry'

beforeEach(resetPipelineState)
const source = (body: string) => `import SwiftUI\n@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { var body: some View { ${body} } }`
const row = 'HStack(spacing: 0) { Color.red.frame(width: 80, height: 80); Color.blue.frame(width: 80, height: 80) }'
function render(body: string) {
  const result = compile({ files: [{ id: 'App.swift', text: source(body) }], revision: 1, canvas: { width: 393, height: 852 }, colorScheme: 'light' })
  expect(result.diagnostics).toEqual([])
  return result.renderTree!
}
function styles(tree: RenderTree) {
  const html = renderToStaticMarkup(createElement(RenderTreeView, { tree }))
  return new Map([...html.matchAll(/<[^>]*data-node-id="([^"]+)"[^>]*>/g)].map(match => [match[1]!, match[0].match(/style="([^"]*)"/)?.[1] ?? '']))
}
const paints = (tree: RenderTree) => tree.nodes.filter(node => node.id !== 'screen' && node.background)

describe('stack effects compose at the view boundary', () => {
  it.each(['.cornerRadius(30)', '.clipShape(.rect(cornerRadius: 30))'])('clips the outer row with %s and keeps the internal seam square', modifier => {
    const tree = render(row + modifier), fills = paints(tree)
    expect(fills).toHaveLength(2)
    expect(fills.every(node => !node.cornerRadius)).toBe(true)
    const clip = tree.nodes.find(node => node.clip)!
    expect(clip).toMatchObject({ cornerRadius: 30, frame: { width: 160, height: 80 } })
    expect(fills.every(node => ancestors(tree.nodes, node).includes(clip))).toBe(true)
    expect(worldFrame(tree.nodes, fills[1]!).x - worldFrame(tree.nodes, fills[0]!).x).toBe(80)
    expect(styles(tree).get(clip.id)).toContain('overflow:hidden')
    expect(styles(tree).get(clip.id)).toContain('clip-path:')
  })
  it('applies opacity once across clips, shadows and transforms', () => {
    const tree = render(row + '.clipShape(.rect(cornerRadius: 30)).shadow(radius: 8).rotationEffect(.degrees(10)).opacity(0.5)')
    const css = styles(tree)
    for (const fill of paints(tree)) {
      const path = [fill, ...ancestors(tree.nodes, fill)]
      const actual = path.reduce((opacity, node) => opacity * Number(css.get(node.id)?.match(/(?:^|;)opacity:([^;]+)/)?.[1] ?? 1), 1)
      expect(actual).toBe(0.5)
    }
    expect(tree.nodes.filter(node => node.id.endsWith('-opacity'))).toHaveLength(1)
  })
  it('composites overlapping children as a group and combines explicit nested opacities', () => {
    const tree = render('ZStack { Color.red; Rectangle().fill(Color.blue).opacity(0.5) }.frame(width: 100, height: 80).opacity(0.5)')
    const opacityGroups = tree.nodes.filter(node => node.id.endsWith('-opacity'))
    expect(opacityGroups.map(node => node.opacity)).toEqual([0.5, 0.25])
    expect(paints(tree).every(node => ancestors(tree.nodes, node).includes(opacityGroups[0]!))).toBe(true)
    const css = styles(tree)
    expect(opacityGroups.every(node => css.get(node.id)?.includes('opacity:0.5;'))).toBe(true)
  })
  it.each(['', '.opacity(0)'])('shadows painted rounded content instead of a rectangular box %s', suffix => {
    const tree = render(row + '.clipShape(.rect(cornerRadius: 30)).shadow(color: .black.opacity(0.3), radius: 8, x: 2, y: 6)' + suffix)
    const shadow = tree.nodes.find(node => node.shadow)!, clip = tree.nodes.find(node => node.clip)!
    expect(ancestors(tree.nodes, clip)).toContain(shadow)
    expect(shadow.background).toBeUndefined()
    expect(styles(tree).get(shadow.id)).toContain('filter:drop-shadow(2px 6px 8px')
    expect(styles(tree).get(shadow.id)).not.toContain('box-shadow:')
  })
  it('retains modifier ordering when a clip follows a shadow or precedes a background', () => {
    const tree = render(row + '.shadow(radius: 8).cornerRadius(30).background(Color.green)')
    const clip = tree.nodes.find(node => node.clip)!, shadow = tree.nodes.find(node => node.shadow)!
    expect(ancestors(tree.nodes, shadow)).toContain(clip)
    const outside = paints(tree).find(node => node.background?.kind === 'solid' && node.background.color.g > node.background.color.r)!
    expect(ancestors(tree.nodes, outside)).not.toContain(clip)
  })
  it.each(['HStack', 'VStack', 'ZStack'])('keeps a bounded root %s background inside its frame', stack => {
    const tree = render(`${stack} { Text("Card") }.frame(width: 100, height: 80).background(Color.blue).cornerRadius(20).opacity(0.5)`)
    expect(tree.nodes.find(node => node.id === 'screen')?.background).toEqual({ kind: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } })
    expect(paints(tree)).toHaveLength(1)
    expect(paints(tree)[0]?.frame).toMatchObject({ width: 100, height: 80 })
  })
  it('edits the row in Design, writes Swift, then renders the new fill and clipping', () => {
    let text = source(row + '.background(Color.gray).clipShape(.rect(cornerRadius: 4))')
    for (const [name, value] of [['background', 'blue'], ['clipShape', '30']]) {
      const files = [{ id: 'App.swift', text }]
      const model = buildAuthoringModel({ projectId: 'stack', revision: 1, files })
      const node = model.nodes.find(node => node.name === 'HStack')!
      const control = node.modifiers?.find(item => item.name === name)?.controls.find(item => !item.id.startsWith('fill:'))?.id
      expect(control).toBeDefined()
      const edit = planDesignEdit({ projectId: 'stack', baseRevision: 1, files, scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'property', control: control!, value: value! } })
      if (!edit.ok) throw new Error(edit.reason)
      text = edit.changes[0]!.after!
    }
    expect(text).toContain('.background(Color.blue)')
    expect(text).toContain('cornerRadius: 30')
    const result = compile({ files: [{ id: 'App.swift', text }], revision: 2, canvas: { width: 393, height: 852 }, colorScheme: 'light' })
    expect(result.diagnostics).toEqual([])
    expect(result.renderTree?.nodes.find(node => node.clip)?.cornerRadius).toBe(30)
    expect(paints(result.renderTree!)[0]?.background).toEqual({ kind: 'solid', color: { r: 0, g: 136, b: 255, a: 1 } })
  })
})
