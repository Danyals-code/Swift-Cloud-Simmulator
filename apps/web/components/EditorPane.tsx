'use client'

import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { StreamLanguage } from '@codemirror/language'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { oneDark } from '@codemirror/theme-one-dark'
import { setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint'
import type { Diagnostic } from '@studio/shared'

export interface EditorPaneProps {
  text: string
  diagnostics: readonly Diagnostic[]
  onChange: (text: string) => void
  onSave: () => void
  /**
   * Scroll to and select an offset. Carries a nonce so that clicking the same
   * diagnostic twice reveals it twice — a bare offset would compare equal and the
   * effect would not re-run.
   */
  reveal?: { offset: number; nonce: number } | null
}

/**
 * CodeMirror 6 host.
 *
 * Phase 0 highlights with the legacy stream-mode Swift grammar, which is good
 * enough to look right but knows nothing about the code. Phase 1 replaces it with
 * semantic decorations driven by our own parser — at which point highlighting and
 * diagnostics come from one source of truth rather than two that can disagree.
 */
export function EditorPane({ text, diagnostics, onChange, onSave, reveal }: EditorPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  /**
   * Latest callbacks, so the CodeMirror extensions below never need rebuilding on
   * re-render — tearing down the view would lose the cursor and the undo history.
   * Synced in an effect rather than during render, which is the rule refs exist to
   * respect.
   */
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
  })

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return

    const extensions: Extension[] = [
      basicSetup,
      StreamLanguage.define(swift),
      oneDark,
      keymap.of([
        indentWithTab,
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            onSaveRef.current()
            return true
          },
        },
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString())
      }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '13px' },
        '.cm-scroller': {
          fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace',
          lineHeight: '1.6',
        },
        '&.cm-focused': { outline: 'none' },
      }),
    ]

    const view = new EditorView({
      state: EditorState.create({ doc: text, extensions }),
      parent: hostRef.current,
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Mounted once; document updates are handled by the effect below so that typing
    // never tears down and rebuilds the editor (which would lose cursor and history).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push external document changes in (template reset, project load) without
  // clobbering the cursor when the incoming text is what the user just typed.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === text) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: text },
      selection: { anchor: Math.min(view.state.selection.main.anchor, text.length) },
    })
  }, [text])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch(setDiagnostics(view.state, toCodeMirror(diagnostics, view.state.doc.toString())))
  }, [diagnostics])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !reveal) return
    const offset = Math.max(0, Math.min(reveal.offset, view.state.doc.length))
    view.dispatch({
      selection: { anchor: offset },
      effects: EditorView.scrollIntoView(offset, { y: 'center' }),
    })
    view.focus()
  }, [reveal])

  return <div ref={hostRef} className="h-full overflow-hidden" data-testid="editor" />
}

function toCodeMirror(diagnostics: readonly Diagnostic[], doc: string): CmDiagnostic[] {
  return diagnostics.map((d) => ({
    from: Math.max(0, Math.min(d.span.start, doc.length)),
    to: Math.max(0, Math.min(Math.max(d.span.end, d.span.start + 1), doc.length)),
    severity: d.severity === 'info' ? 'info' : d.severity,
    message: d.message,
    source: d.code,
  }))
}
