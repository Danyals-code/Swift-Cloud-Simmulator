import { describe, expect, it } from 'vitest'
import type { CompileRequest, Diagnostic, RenderNode } from '@studio/shared'
import { TEMPLATES, createProjectFromTemplate } from '@studio/project-model'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * The conformance corpus.
 *
 * Phase 4 gate 2: **every template renders with zero unsupported placeholders.**
 *
 * This is the test that keeps the gallery honest. A template is a promise that the
 * tool can draw what it shows, so one that renders a half-drawn placeholder is worse
 * than one that does not ship. It is also the reason the gallery is small: it grows
 * with the coverage matrix, not ahead of it.
 *
 * The suite lives outside any one package because it deliberately spans all of them —
 * project model, parser, checker, interpreter, layout, render.
 */

const device = DEVICES['iphone-15']

function requestFor(source: string): CompileRequest {
  return {
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: 1,
  }
}

function describeDiagnostic(d: Diagnostic): string {
  return `${d.severity} (${d.code}): ${d.message}`
}

function placeholders(nodes: readonly RenderNode[]): RenderNode[] {
  return nodes.filter((n) => n.kind === 'placeholder')
}

describe.each(TEMPLATES)('template: $name', (template) => {
  // Each template gets a clean runtime, so one template's state cannot leak into
  // the next and mask a failure.
  function run() {
    resetPipelineState()
    return compile(requestFor(template.source))
  }

  it('produces no diagnostics of any severity', () => {
    // Including warnings: a coverage warning means the template uses something the
    // preview cannot draw, which is exactly what gate 2 forbids.
    expect(run().diagnostics.map(describeDiagnostic)).toEqual([])
  })

  it('renders without a single unsupported placeholder', () => {
    const tree = run().renderTree
    expect(tree, 'template produced no render tree').not.toBeNull()

    const unsupported = placeholders(tree!.nodes).map(
      (n) => `${n.placeholder?.feature}: ${n.placeholder?.reason}`,
    )
    expect(unsupported).toEqual([])
  })

  it('draws something', () => {
    // A template that parses, runs and lays out to nothing would pass every check
    // above while showing an empty screen.
    const tree = run().renderTree!
    const painted = tree.nodes.filter((n) => n.id !== 'screen')

    expect(painted.length).toBeGreaterThan(2)
    expect(painted.some((n) => n.kind === 'text')).toBe(true)
  })

  it('places every node inside the screen, with finite geometry', () => {
    const tree = run().renderTree!

    for (const node of tree.nodes) {
      const { x, y, width, height } = node.frame
      expect(Number.isFinite(x), `${node.id} x`).toBe(true)
      expect(Number.isFinite(y), `${node.id} y`).toBe(true)
      expect(Number.isFinite(width), `${node.id} width`).toBe(true)
      expect(Number.isFinite(height), `${node.id} height`).toBe(true)

      expect(width).toBeGreaterThanOrEqual(0)
      expect(height).toBeGreaterThanOrEqual(0)
      // Generous bounds: content may legitimately overflow, but not by orders of
      // magnitude — that would mean an unbounded proposal leaked into a frame.
      expect(Math.abs(x)).toBeLessThan(device.width * 4)
      expect(Math.abs(y)).toBeLessThan(device.height * 4)
    }
  })

  it('creates a project whose app name matches its source', () => {
    const project = createProjectFromTemplate(template, 0)
    expect(project.files).toHaveLength(1)
    expect(project.files[0]!.text).toBe(template.source)
    expect(project.files[0]!.id).toContain(project.manifest.name)
    expect(template.source).toContain(`struct ${project.manifest.name}: App`)
  })

  it('stays inside the interaction budget', () => {
    const request = requestFor(template.source)
    resetPipelineState()
    for (let i = 0; i < 3; i++) compile(request)

    let best = Infinity
    for (let i = 0; i < 5; i++) {
      const started = performance.now()
      compile(request)
      best = Math.min(best, performance.now() - started)
    }
    expect(best).toBeLessThan(120)
  })
})

describe('the gallery', () => {
  it('has unique ids and names', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length)
    expect(new Set(TEMPLATES.map((t) => t.name)).size).toBe(TEMPLATES.length)
  })

  it('describes every template', () => {
    for (const template of TEMPLATES) {
      expect(template.description.length).toBeGreaterThan(10)
    }
  })

  it('starts with the reference app', () => {
    expect(TEMPLATES[0]!.id).toBe('counter')
  })
})
