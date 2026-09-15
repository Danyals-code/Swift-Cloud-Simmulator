import { describe, expect, it } from 'vitest'
import type { CompileRequest, Diagnostic, RenderNode } from '@studio/shared'
import { TEMPLATES, appNameOf, createProjectFromTemplate } from '@studio/project-model'
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
 * The suite lives outside any one package because it deliberately spans all of them -
 * project model, parser, checker, interpreter, layout, render.
 */

const device = DEVICES['iphone-15']

function requestFor(
  files: readonly { id: string; text: string }[],
  colorScheme: 'light' | 'dark' = 'light',
): CompileRequest {
  return {
    files: files.map((file) => ({ id: file.id, text: file.text })),
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme,
    revision: 1,
  }
}

/** Every distinct colour painted by a tree, as `r,g,b,a` strings. */
function paintedColors(nodes: readonly RenderNode[]): Set<string> {
  const out = new Set<string>()
  for (const node of nodes) {
    if (node.background?.kind === 'solid') {
      const c = node.background.color
      out.add(`${c.r},${c.g},${c.b},${c.a}`)
    }
    for (const run of node.text?.runs ?? []) {
      out.add(`${run.color.r},${run.color.g},${run.color.b},${run.color.a}`)
    }
  }
  return out
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
    return compile(requestFor(template.files))
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
      // magnitude - that would mean an unbounded proposal leaked into a frame.
      expect(Math.abs(x)).toBeLessThan(device.width * 4)
      expect(Math.abs(y)).toBeLessThan(device.height * 4)
    }
  })

  it('adapts to dark mode instead of rendering fixed greys', () => {
    /**
     * A template using `Color(white: 0.95)` looks identical in both appearances while
     * its `.primary` text flips to white - white on light grey, unreadable. That is
     * the most common dark-mode mistake there is, and shipping it as an example would
     * be teaching it.
     */
    resetPipelineState()
    const light = paintedColors(compile(requestFor(template.files, 'light')).renderTree!.nodes)
    resetPipelineState()
    const dark = paintedColors(compile(requestFor(template.files, 'dark')).renderTree!.nodes)

    const shared = [...light].filter((c) => dark.has(c))
    // Some colours legitimately match - a fixed brand tint, a white-on-tint label -
    // but the palettes must not be identical.
    expect([...dark].some((c) => !light.has(c))).toBe(true)
    expect(shared.length).toBeLessThan(light.size)
  })

  it('stays legible in dark mode: text never matches its own backdrop', () => {
    resetPipelineState()
    const tree = compile(requestFor(template.files, 'dark')).renderTree!

    const backdrop = tree.nodes.find((n) => n.id === 'screen')?.background
    expect(backdrop?.kind).toBe('solid')

    for (const node of tree.nodes) {
      for (const run of node.text?.runs ?? []) {
        if (run.color.a < 0.1) continue
        const behind = backgroundBehind(tree.nodes, node)
        if (!behind) continue
        expect(
          contrastRatio(run.color, behind),
          `"${run.text}" is unreadable on its background`,
        ).toBeGreaterThan(1.8)
      }
    }
  })

  it('creates a project carrying every file unchanged', () => {
    const project = createProjectFromTemplate(template, 0)

    expect(project.files).toHaveLength(template.files.length)
    expect(project.files.map((f) => f.id)).toEqual(template.files.map((f) => f.id))
    expect(project.files.map((f) => f.text)).toEqual(template.files.map((f) => f.text))
  })

  it('names the project after the @main type it declares', () => {
    const project = createProjectFromTemplate(template, 0)

    expect(project.manifest.name).toBe(appNameOf(template))
    expect(template.files.some((f) => f.text.includes(`struct ${project.manifest.name}: App`))).toBe(
      true,
    )
  })

  it('puts every file under Sources with a unique path', () => {
    const ids = template.files.map((f) => f.id)

    expect(ids.every((id) => id.startsWith('Sources/') && id.endsWith('.swift'))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('declares exactly one entry point across all its files', () => {
    const entries = template.files.filter((f) => /struct \w+: App/.test(f.text))
    expect(entries).toHaveLength(1)
  })

  it('stays inside the interaction budget', () => {
    const request = requestFor(template.files)
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

/**
 * The nearest solid fill painted beneath a node's frame.
 *
 * Only nodes in the *same* coordinate space are considered. Since Phase 6, a node
 * inside a scroll view is positioned relative to that scroller, so comparing its
 * frame against an absolutely-positioned one would overlap rectangles that never
 * touch on screen - and the contrast check would then be measuring a pair of colours
 * that are never seen together.
 */
function backgroundBehind(
  nodes: readonly RenderNode[],
  target: RenderNode,
): { r: number; g: number; b: number; a: number } | null {
  let found: { r: number; g: number; b: number; a: number } | null = null
  for (const node of nodes) {
    if (node.z >= target.z) continue
    if (node.parent !== target.parent && node.id !== 'screen') continue
    if (node.background?.kind !== 'solid' || node.background.color.a < 0.9) continue

    const f = node.frame
    const t = target.frame
    const covers =
      f.x <= t.x + 1 && f.y <= t.y + 1 && f.x + f.width >= t.x + t.width - 1 && f.y + f.height >= t.y + t.height - 1
    if (covers) found = node.background.color
  }
  return found
}

/** WCAG relative-luminance contrast ratio. */
function contrastRatio(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  const l1 = luminance(a)
  const l2 = luminance(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

function luminance(c: { r: number; g: number; b: number }): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

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
