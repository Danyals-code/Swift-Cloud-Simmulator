import {
  rgba,
  type CompileRequest,
  type CompileResult,
  type Diagnostic,
  type LogEntry,
  type RenderNode,
  type RenderTree,
  type ResolvedFont,
  type UIEvent,
} from '@studio/shared'

/**
 * PHASE 0 STUB — this is not a compiler.
 *
 * It ignores the Swift source entirely and emits a fixed tree that mimics the
 * vertical-slice reference app (docs/06-VERTICAL-SLICE.md §1), with hand-computed
 * frames standing in for the layout engine.
 *
 * Its purpose is to exercise the plumbing end to end before any of the hard parts
 * exist: worker RPC -> render tree -> absolutely positioned DOM -> hit test ->
 * event back to the worker -> state mutation -> new tree -> repaint. That loop is
 * where integration bugs hide, and having it working and under test from day one
 * means Phases 1-3 only ever have to get the *contents* of the tree right.
 *
 * Phase 3 deletes this file and replaces it with the real evaluator.
 */

const SYSTEM_FONT = '"Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'

function font(size: number, weight: number, lineHeight: number): ResolvedFont {
  return { family: SYSTEM_FONT, size, weight, italic: false, lineHeight }
}

const LARGE_TITLE = font(34, 700, 41)
const TITLE_2 = font(22, 400, 28)
const BODY = font(17, 600, 22)
const FOOTNOTE = font(13, 400, 18)

const LABEL = rgba(0, 0, 0, 0.9)
const SECONDARY_LABEL = rgba(60, 60, 67, 0.6)
const GROUPED_BG = rgba(242, 242, 247, 1)
const RED_WASH = rgba(255, 59, 48, 0.15)
const GREEN_WASH = rgba(52, 199, 89, 0.15)
const NEGATIVE = rgba(255, 59, 48, 1)

/** Mutable state the stub owns, standing in for Phase 3's identity-keyed `@State` boxes. */
let count = 0
let revision = 0

export function resetStubState(): void {
  count = 0
}

export function getStubCount(): number {
  return count
}

export function applyStubEvent(event: UIEvent): void {
  if (event.kind !== 'tap') return
  if (event.handlerId === 'btn-plus') count += 1
  if (event.handlerId === 'btn-minus') count -= 1
}

/**
 * Frames are hand-computed for a 393x852 canvas with a 59pt top safe area, i.e.
 * what the Phase 3 layout engine should independently arrive at for the reference
 * app. When the real engine lands, these numbers become a golden test case.
 */
function buildTree(canvasWidth: number, canvasHeight: number): RenderTree {
  const pad = 16
  const contentX = pad
  const contentW = canvasWidth - pad * 2
  const hstackInset = 24
  const hstackX = contentX + hstackInset
  const hstackW = contentW - hstackInset * 2
  const buttonW = 110
  const buttonH = 52

  const titleY = 91
  const countY = titleY + LARGE_TITLE.lineHeight + 16
  const rowY = countY + TITLE_2.lineHeight + 16
  const noteY = rowY + buttonH + 32

  const nodes: RenderNode[] = [
    {
      id: 'root',
      kind: 'layer',
      frame: { x: 0, y: 0, width: canvasWidth, height: canvasHeight },
      z: 0,
      opacity: 1,
      background: { kind: 'solid', color: GROUPED_BG },
    },
    {
      id: 'title',
      kind: 'text',
      frame: { x: contentX, y: titleY, width: contentW, height: LARGE_TITLE.lineHeight },
      z: 1,
      opacity: 1,
      text: {
        runs: [{ text: 'Hello, World!', font: LARGE_TITLE, color: LABEL }],
        alignment: 'leading',
      },
      a11y: { role: 'heading', label: 'Hello, World!' },
    },
    {
      id: 'count',
      kind: 'text',
      frame: { x: contentX, y: countY, width: contentW, height: TITLE_2.lineHeight },
      z: 1,
      opacity: 1,
      text: {
        runs: [
          {
            text: `Count: ${count}`,
            font: TITLE_2,
            color: count < 0 ? NEGATIVE : LABEL,
          },
        ],
        alignment: 'leading',
      },
      a11y: { role: 'text', label: `Count: ${count}` },
    },
    {
      id: 'btn-minus',
      kind: 'layer',
      frame: { x: hstackX, y: rowY, width: buttonW, height: buttonH },
      z: 1,
      opacity: 1,
      background: { kind: 'solid', color: RED_WASH },
      hitTarget: { handlerId: 'btn-minus', role: 'button', enabled: true },
      a11y: { role: 'button', label: 'Minus' },
    },
    {
      id: 'btn-minus-label',
      kind: 'text',
      frame: { x: hstackX, y: rowY + (buttonH - BODY.lineHeight) / 2, width: buttonW, height: BODY.lineHeight },
      z: 2,
      opacity: 1,
      text: { runs: [{ text: 'Minus', font: BODY, color: LABEL }], alignment: 'center' },
    },
    {
      id: 'btn-plus',
      kind: 'layer',
      frame: { x: hstackX + hstackW - buttonW, y: rowY, width: buttonW, height: buttonH },
      z: 1,
      opacity: 1,
      background: { kind: 'solid', color: GREEN_WASH },
      hitTarget: { handlerId: 'btn-plus', role: 'button', enabled: true },
      a11y: { role: 'button', label: 'Plus' },
    },
    {
      id: 'btn-plus-label',
      kind: 'text',
      frame: {
        x: hstackX + hstackW - buttonW,
        y: rowY + (buttonH - BODY.lineHeight) / 2,
        width: buttonW,
        height: BODY.lineHeight,
      },
      z: 2,
      opacity: 1,
      text: { runs: [{ text: 'Plus', font: BODY, color: LABEL }], alignment: 'center' },
    },
    {
      id: 'phase-0-notice',
      kind: 'placeholder',
      frame: { x: contentX, y: noteY, width: contentW, height: 92 },
      z: 1,
      opacity: 1,
      placeholder: {
        feature: 'Swift compiler',
        reason:
          'Phase 0 wires the pipeline; the parser, interpreter and layout engine land in Phases 1-3. ' +
          'This tree is hand-built — your source is not being read yet.',
      },
    },
    {
      id: 'footnote',
      kind: 'text',
      frame: { x: contentX, y: noteY + 104, width: contentW, height: FOOTNOTE.lineHeight },
      z: 1,
      opacity: 1,
      text: {
        runs: [
          { text: 'Tap the buttons — the round-trip is real.', font: FOOTNOTE, color: SECONDARY_LABEL },
        ],
        alignment: 'leading',
      },
    },
  ]

  return { canvas: { width: canvasWidth, height: canvasHeight }, nodes, revision: ++revision }
}

/**
 * One synthetic diagnostic so the editor's squiggle path is exercised (Phase 0
 * gate 2). It is pinned to the first `import` line if there is one, otherwise to
 * the start of the file.
 */
function syntheticDiagnostics(request: CompileRequest): Diagnostic[] {
  const first = request.files[0]
  if (!first) {
    return [
      {
        span: { file: 'Sources/App.swift', start: 0, end: 0 },
        severity: 'error',
        code: 'no_entry_point',
        message: "Project has no source files. Add a file containing an '@main' App type.",
      },
    ]
  }

  const importIdx = first.text.indexOf('import SwiftUI')
  const start = importIdx >= 0 ? importIdx : 0
  const end = importIdx >= 0 ? importIdx + 'import SwiftUI'.length : Math.min(1, first.text.length)

  return [
    {
      span: { file: first.id, start, end },
      severity: 'info',
      code: 'unsupported_language_feature',
      feature: 'all of Swift',
      message:
        'Phase 0: source is stored and exported verbatim, but not yet parsed. ' +
        'The preview shows a fixed demo tree.',
    },
  ]
}

export function stubCompile(request: CompileRequest): CompileResult {
  const startedAt = performance.now()
  const diagnostics = syntheticDiagnostics(request)
  const renderTree = buildTree(request.canvas.width, request.canvas.height)
  const total = performance.now() - startedAt

  const logs: LogEntry[] = [
    {
      level: 'log',
      message: `Compiled ${request.files.length} file(s) — stub pipeline, count = ${count}`,
      at: total,
    },
  ]

  return {
    revision: request.revision,
    diagnostics,
    renderTree,
    logs,
    timings: { parse: 0, check: 0, evaluate: 0, layout: total, total },
  }
}
