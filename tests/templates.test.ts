import { describe, expect, it } from 'vitest'
import type { CompileRequest, Diagnostic, RenderNode, RenderTree } from '@studio/shared'
import { TEMPLATES, appNameOf, createProjectFromTemplate } from '@studio/project-model/templates'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
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

/**
 * The checks that have to hold on *any* screen, not just the first one.
 *
 * Pulled out of the root tests below so the crawl can make exactly the same
 * assertions about a pushed detail view, a presented sheet and a second tab. The
 * root tests keep their own `it` blocks, because a failure there should say which
 * check failed rather than "screen 4".
 */
function assertScreenIsSound(tree: RenderTree, where: string): void {
  const unsupported = placeholders(tree.nodes).map(
    (n) => `${n.placeholder?.feature}: ${n.placeholder?.reason}`,
  )
  expect(unsupported, `${where} draws an unsupported placeholder`).toEqual([])

  for (const node of tree.nodes) {
    const { x, y, width, height } = node.frame
    expect(Number.isFinite(x) && Number.isFinite(y), `${where}: ${node.id} position`).toBe(true)
    expect(Number.isFinite(width) && Number.isFinite(height), `${where}: ${node.id} size`).toBe(true)
    expect(width, `${where}: ${node.id} width`).toBeGreaterThanOrEqual(0)
    expect(height, `${where}: ${node.id} height`).toBeGreaterThanOrEqual(0)
    expect(Math.abs(x), `${where}: ${node.id} x`).toBeLessThan(device.width * 4)
    expect(Math.abs(y), `${where}: ${node.id} y`).toBeLessThan(device.height * 4)
  }

  for (const node of tree.nodes) {
    for (const run of node.text?.runs ?? []) {
      if (run.color.a < 0.1) continue
      const behind = backgroundBehind(tree.nodes, node)
      if (!behind) continue
      expect(
        contrastRatio(run.color, behind),
        `${where}: "${run.text}" is unreadable on its background`,
      ).toBeGreaterThan(1.8)
    }
  }
}

/** Every distinct handler a person could press, in paint order. */
function pressable(tree: RenderTree): { id: string; label: string }[] {
  const seen = new Set<string>()
  const out: { id: string; label: string }[] = []

  for (const node of tree.nodes) {
    const hit = node.hitTarget
    if (!hit || hit.role !== 'button' || !hit.enabled) continue
    if (seen.has(hit.handlerId)) continue
    seen.add(hit.handlerId)
    out.push({
      id: hit.handlerId,
      label: (node.text?.runs ?? []).map((r) => r.text).join('') || node.a11y?.label || hit.handlerId,
    })
  }
  return out
}

/** The control that goes back, if this screen has one. */
function backButton(tree: RenderTree): string | null {
  return pressable(tree).find((t) => t.id.endsWith('/back'))?.id ?? null
}

function press(handlerId: string, revision: number): RenderTree | null {
  if (!applyEvent({ kind: 'tap', handlerId, location: { x: 0, y: 0 } })) return null
  return rerender(revision).renderTree
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

  /**
   * Every screen the template has, not just the one it opens on.
   *
   * Everything above this measures the *root*. For a one-file template that is the
   * whole template; for an eight-file app it is the first screen, and every detail
   * view behind a NavigationLink, every sheet and every tab but the first could be
   * broken - a trap, a placeholder, unreadable text - with all of it passing.
   *
   * That was not hypothetical. Trailhead's route list printed `Text("\(step.id)")`
   * where `id` had become a `UUID`, so three lines of the detail screen read as
   * 36-character hex strings. It shipped, and every gate was green, because no test
   * had ever pushed that screen.
   *
   * So this presses things. Depth-first from the root, at most `MAX_DEPTH` deep and
   * `MAX_SCREENS` screens in total, coming back via the navigation bar's own back
   * button where there is one. It runs in dark mode because that is the harder of the
   * two appearances and the other checks do not depend on the palette.
   *
   * The budget is a real constraint rather than a guess: every screen is a full
   * evaluate-lay out-render pass, and the whole suite has to stay usable.
   */
  const MAX_DEPTH = 3
  const MAX_SCREENS = 20
  const MAX_TARGETS_PER_SCREEN = 10

  it('renders every screen a press can reach as cleanly as the first', () => {
    resetPipelineState()
    const root = compile(requestFor(template.files, 'dark')).renderTree
    expect(root, 'template produced no render tree').not.toBeNull()

    let revision = 1
    let screens = 0
    const visited = new Set<string>()

    /**
     * What makes two screens the same for the purpose of not visiting both.
     *
     * Every string it draws, in paint order, and *not* a prefix of them: a sheet is
     * drawn over the screen that presented it, so the first few hundred characters of
     * a presented screen are the ones underneath it. Comparing a prefix marked every
     * sheet in the corpus as already seen.
     */
    const shapeOf = (tree: RenderTree) =>
      tree.nodes.flatMap((n) => (n.text?.runs ?? []).map((r) => r.text)).join('\u0000')

    const explore = (tree: RenderTree, depth: number, trail: string): void => {
      if (depth >= MAX_DEPTH || screens >= MAX_SCREENS) return

      // Captured before anything is pressed: the list changes underneath us as soon
      // as it does, and these ids stay valid for the life of this run.
      const targets = pressable(tree)
        .filter((t) => !t.id.endsWith('/back'))
        .slice(0, MAX_TARGETS_PER_SCREEN)

      for (const target of targets) {
        if (screens >= MAX_SCREENS) return

        const next = press(target.id, ++revision)
        // A press that changed nothing has no screen to check - a disabled Save, a
        // toggle already in that state.
        if (!next) continue

        const shape = shapeOf(next)
        const where = `${trail} > ${target.label}`
        if (!visited.has(shape)) {
          visited.add(shape)
          screens++
          if (process.env.CRAWL) console.log(`[${template.name}] ${screens}. ${where}`)
          assertScreenIsSound(next, where)
          explore(next, depth + 1, where)
        }

        // Back out so the next sibling is pressed from where this one was. Where
        // there is no way back - a press that toggled state rather than navigating -
        // carry on from wherever we are, which is still a screen worth checking.
        const back = backButton(next)
        if (back) {
          const returned = press(back, ++revision)
          if (returned) tree = returned
        }
      }
    }

    // The root counts as visited, or the tab bar's own tab is a "new" screen: pressing
    // Summary while on Summary writes the binding and redraws the same thing, and
    // recursing into it spent a whole level of depth to arrive back where we started.
    visited.add(shapeOf(root!))
    explore(root!, 0, template.name)

    // A template whose screens are all one press away should have reached some of
    // them; a one-file template legitimately has none, and says so by having no
    // pressable controls at all.
    if (template.kind === 'app') {
      expect(screens, 'no screen beyond the root was reachable').toBeGreaterThan(2)
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

  /**
   * The corpus has to look like code people write - defect register 10.6.
   *
   * "Eighteen templates render with zero placeholders" was measuring the *corpus*
   * rather than the interpreter: 231 defects lived behind it because the gallery used
   * none of the constructs that failed. `Identifiable` models all carried `let id:
   * Int`, nothing called `UUID()` or `Date()` or `allCases`, nobody wrote `Button { }
   * label: { }` or an explicit `get {`.
   *
   * This is the assertion that stops it drifting back to the safe subset: each of
   * these is something the matrix claims and the corpus previously never exercised,
   * so a regression in one of them now fails a template rather than going unnoticed
   * until someone writes real code.
   */
  it('is written the way people write, not the way the preview finds easy', () => {
    const corpus = TEMPLATES.flatMap((t) => t.files.map((f) => f.text)).join('\n')

    const idioms: [string, RegExp][] = [
      ['a UUID identity', /let id = UUID\(\)/],
      ['a Date', /Date\(\)/],
      ['an enum over allCases', /\.allCases/],
      ['the label: form of Button', /\}\s*label:\s*\{/],
      ['an explicit getter', /\bget\s*\{/],
      ['a raw-value enum', /:\s*String,\s*CaseIterable/],
      ['a closure over a model collection', /\.filter\s*\{/],
      ['storage that outlives a view', /@AppStorage/],
      ['a text attribute', /\.strikethrough\(|\.underline\(/],
      ['a concatenated Text', /\+ Text\(/],
      ['a section footer', /\}\s*footer:\s*\{/],
      ['a date picker', /DatePicker\(/],
    ]

    for (const [what, pattern] of idioms) {
      expect(pattern.test(corpus), `no template contains ${what}`).toBe(true)
    }
  })

  it('no longer identifies a model by an integer it made up', () => {
    // Every `Identifiable` in the gallery used `let id: Int` with hand-written
    // numbers, which is the one identity scheme no real app uses and the only one
    // that never exercises `UUID`.
    const corpus = TEMPLATES.flatMap((t) => t.files.map((f) => f.text)).join('\n')
    expect(/let id: Int/.test(corpus)).toBe(false)
  })
})
