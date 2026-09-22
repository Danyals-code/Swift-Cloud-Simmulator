'use client'

import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { Annotation, Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { StreamLanguage } from '@codemirror/language'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint'
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult as CmCompletionResult,
} from '@codemirror/autocomplete'
import { hoverTooltip } from '@codemirror/view'
import { search, searchKeymap } from '@codemirror/search'
import type { Diagnostic, SourceSpan, SymbolInfo } from '@studio/shared'
import { EditorEchoes } from '../lib/editorEchoes'
import { editorTheme } from '../lib/editorTheme'
import { useLayout } from '../lib/layout'

const externalDocument = Annotation.define<boolean>()

/**
 * What the editor may ask the compiler worker about a caret position.
 *
 * Passed in rather than imported so this component stays a view: it knows how to
 * render a completion list, and nothing about where the answers come from.
 */
export interface EditorLanguageService {
  complete(fileId: string, offset: number): Promise<{ from: number; items: readonly SymbolInfo[] }>
  definition(fileId: string, offset: number): Promise<SymbolInfo | null>
  hover(fileId: string, offset: number): Promise<SymbolInfo | null>
  references(
    fileId: string,
    offset: number,
  ): Promise<{ name: string; spans: readonly SourceSpan[] }>
}

/** CodeMirror's own icon vocabulary, which decides the glyph beside each item. */
const COMPLETION_TYPES: Readonly<Record<string, string>> = {
  type: 'class',
  protocol: 'interface',
  enumCase: 'enum',
  function: 'function',
  method: 'method',
  property: 'property',
  local: 'variable',
  parameter: 'variable',
  view: 'class',
  modifier: 'method',
  attribute: 'keyword',
  keyword: 'keyword',
}

export interface EditorPaneProps {
  text: string
  diagnostics: readonly Diagnostic[]
  onUndo?: () => void
  onRedo?: () => void
  onChange: (text: string) => void
  onSave: () => void
  /** The file being edited, so the worker knows which one the offset belongs to. */
  fileId?: string
  language?: EditorLanguageService
  /** Jump to a declaration in another file. Called only when the span names one. */
  onOpenFile?: (fileId: string, offset: number) => void
  /** F2: the host asks the user for a new name and applies the spans. */
  onRename?: (name: string, spans: readonly SourceSpan[]) => void
  /** Caret moved. Drives the jump bar, which names the declaration you are inside. */
  onCaret?: (offset: number) => void
  /**
   * Scroll to and select an offset. Carries a nonce so that clicking the same
   * diagnostic twice reveals it twice - a bare offset would compare equal and the
   * effect would not re-run.
   */
  reveal?: { offset: number; nonce: number } | null
}

/**
 * CodeMirror 6 host.
 *
 * Phase 0 highlights with the legacy stream-mode Swift grammar, which is good
 * enough to look right but knows nothing about the code. Phase 1 replaces it with
 * semantic decorations driven by our own parser - at which point highlighting and
 * diagnostics come from one source of truth rather than two that can disagree.
 */
export function EditorPane({
  text,
  diagnostics,
  onChange,
  onUndo,
  onRedo,
  onSave,
  reveal,
  fileId,
  language,
  onOpenFile,
  onRename,
  onCaret,
}: EditorPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const theme = useLayout(s => s.theme)
  const appearance = useRef(new Compartment())
  /** What the editor has typed that the store has not handed back yet. */
  const echoes = useRef(new EditorEchoes())
  /**
   * Latest callbacks, so the CodeMirror extensions below never need rebuilding on
   * re-render - tearing down the view would lose the cursor and the undo history.
   * Synced in an effect rather than during render, which is the rule refs exist to
   * respect.
   */
  const onUndoRef = useRef(onUndo)
  const onRedoRef = useRef(onRedo)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const languageRef = useRef(language)
  const fileIdRef = useRef(fileId)
  const onOpenFileRef = useRef(onOpenFile)
  const onRenameRef = useRef(onRename)
  const onCaretRef = useRef(onCaret)
  useEffect(() => {
    onUndoRef.current = onUndo
    onRedoRef.current = onRedo
    onChangeRef.current = onChange
    onSaveRef.current = onSave
    languageRef.current = language
    fileIdRef.current = fileId
    onOpenFileRef.current = onOpenFile
    onRenameRef.current = onRename
    onCaretRef.current = onCaret
  })

  useEffect(() => {
    if (!hostRef.current || viewRef.current) return

    /**
     * The completion source.
     *
     * Everything it knows comes from the worker. The `from` the worker reports is
     * where the word being completed starts, and using that rather than CodeMirror's
     * own guess is what makes `Text("hi").pad` replace `pad` instead of the whole
     * expression.
     */
    const completionSource = async (
      context: CompletionContext,
    ): Promise<CmCompletionResult | null> => {
      const service = languageRef.current
      const file = fileIdRef.current
      if (!service || !file) return null

      const before = context.matchBefore(/[A-Za-z0-9_$]*/)
      // Explicit means the user asked for the list; an empty prefix is then a request
      // for everything rather than a stray keystroke.
      const triggered = context.explicit || endsWithTrigger(context)
      if (!triggered && (!before || before.from === before.to)) return null

      const result = await service.complete(file, context.pos)
      if (result.items.length === 0) return null

      return {
        from: result.from,
        options: result.items.map(toCompletion),
        // Everything in scope comes back at once and CodeMirror filters it, so the
        // list stays valid as the user keeps typing without another round trip.
        validFor: /^[A-Za-z0-9_$]*$/,
      }
    }

    /**
     * Jump to where a name was declared.
     *
     * A declaration in another file is handed to the host, because this component owns
     * one document and cannot open another. Nothing happens when the name resolves
     * nowhere - a jump to the wrong place is worse than no jump.
     */
    const goToDefinition = async (view: EditorView, pos: number): Promise<void> => {
      const service = languageRef.current
      const file = fileIdRef.current
      if (!service || !file) return

      const symbol = await service.definition(file, pos)
      if (!symbol?.span) return

      if (symbol.span.file !== file) {
        onOpenFileRef.current?.(symbol.span.file, symbol.span.start)
        return
      }

      const target = Math.max(0, Math.min(symbol.span.start, view.state.doc.length))
      view.dispatch({
        selection: { anchor: target, head: Math.min(symbol.span.end, view.state.doc.length) },
        effects: EditorView.scrollIntoView(target, { y: 'center' }),
      })
      view.focus()
    }

    const extensions: Extension[] = [
      basicSetup,
      Prec.highest(keymap.of([
        { key: 'Mod-z', run: () => { if (!onUndoRef.current) return false; onUndoRef.current(); return true } },
        { key: 'Mod-Shift-z', run: () => { if (!onRedoRef.current) return false; onRedoRef.current(); return true } },
        { key: 'Mod-y', run: () => { if (!onRedoRef.current) return false; onRedoRef.current(); return true } },
      ])),
      Prec.highest(EditorView.domEventHandlers({
        beforeinput: event => {
          const callback = event.inputType === 'historyUndo' ? onUndoRef.current : event.inputType === 'historyRedo' ? onRedoRef.current : undefined
          if (!callback) return false
          event.preventDefault()
          callback()
          return true
        },
      })),
      StreamLanguage.define(swift),
      editorTheme,
      appearance.current.of(EditorView.darkTheme.of(theme === 'dark')),
      // `override` replaces basicSetup's word-based source entirely. Left alongside
      // it, the two merge and every identifier already in the file comes back as a
      // suggestion - including the half-typed one being completed.
      autocompletion({ override: [completionSource], activateOnTyping: true }),
      hoverTooltip(async (view, pos) => {
        const service = languageRef.current
        const file = fileIdRef.current
        if (!service || !file) return null

        const symbol = await service.hover(file, pos)
        if (!symbol) return null

        // The word under the cursor, so the tooltip sits over the name it describes
        // rather than at the exact pixel the pointer happened to stop on.
        const { from, to } = wordRangeAt(view.state.doc.toString(), pos)
        return { pos: from, end: to, above: true, create: () => ({ dom: tooltipFor(symbol) }) }
      }),
      // In-file find and replace, from CodeMirror's own implementation. Project-wide
      // rename is F2 below; these two answer different questions and neither
      // substitutes for the other.
      search({ top: true }),
      keymap.of(searchKeymap),
      keymap.of([
        {
          // Rename every occurrence of the symbol under the caret, across all files.
          key: 'F2',
          preventDefault: true,
          run: (view) => {
            void (async () => {
              const service = languageRef.current
              const file = fileIdRef.current
              if (!service || !file) return
              const found = await service.references(file, view.state.selection.main.head)
              if (found.name && found.spans.length > 0) {
                onRenameRef.current?.(found.name, found.spans)
              }
            })()
            return true
          },
        },
        {
          // Go to definition. F12 is the near-universal binding; Mod-click is handled
          // by the DOM handler below, because CodeMirror's keymap sees no clicks.
          key: 'F12',
          preventDefault: true,
          run: (view) => {
            void goToDefinition(view, view.state.selection.main.head)
            return true
          },
        },
      ]),
      EditorView.domEventHandlers({
        mousedown: (event, view) => {
          if (!event.metaKey && !event.ctrlKey) return false
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
          if (pos === null) return false
          event.preventDefault()
          void goToDefinition(view, pos)
          return true
        },
      }),
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
        if (update.docChanged && !update.transactions.some(t => t.annotation(externalDocument))) {
          const typed = update.state.doc.toString()
          echoes.current.sent(typed)
          onChangeRef.current(typed)
        }
        // Reported on document changes too: typing moves the caret without
        // producing a selection event of its own.
        if (update.docChanged || update.selectionSet) {
          onCaretRef.current?.(update.state.selection.main.head)
        }
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

  useEffect(() => {
    viewRef.current?.dispatch({ effects: appearance.current.reconfigure(EditorView.darkTheme.of(theme === 'dark')) })
  }, [theme])

  // Push external document changes in (template reset, project load, Undo) without
  // clobbering the cursor when the incoming text is what the user just typed - or
  // newer typing, when the store hands one of the editor's own texts back late.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (!echoes.current.isNews(text, current)) return
    view.dispatch({
      annotations: externalDocument.of(true),
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

function endsWithTrigger(context: CompletionContext): boolean {
  const previous = context.state.doc.sliceString(Math.max(0, context.pos - 1), context.pos)
  return previous === '.' || previous === '@'
}

function toCompletion(symbol: SymbolInfo): Completion {
  return {
    label: symbol.name,
    type: COMPLETION_TYPES[symbol.kind] ?? 'variable',
    detail: symbol.detail,
    info: symbol.doc,
    apply: symbol.insert,
  }
}

function tooltipFor(symbol: SymbolInfo): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'px-2 py-1 text-xs leading-relaxed'

  const signature = document.createElement('div')
  signature.className = 'font-mono'
  signature.textContent = symbol.detail ? `${symbol.name}: ${symbol.detail}` : symbol.name
  dom.appendChild(signature)

  if (symbol.doc) {
    const note = document.createElement('div')
    note.className = 'mt-1 opacity-70'
    note.textContent = symbol.doc
    dom.appendChild(note)
  }
  return dom
}

/** The bounds of the identifier containing `pos`, for positioning a tooltip. */
function wordRangeAt(doc: string, pos: number): { from: number; to: number } {
  let from = pos
  while (from > 0 && /[A-Za-z0-9_$]/.test(doc[from - 1]!)) from--
  let to = pos
  while (to < doc.length && /[A-Za-z0-9_$]/.test(doc[to]!)) to++
  return { from, to }
}

function toCodeMirror(diagnostics: readonly Diagnostic[], doc: string): CmDiagnostic[] {
  return diagnostics.map((d) => ({
    from: Math.max(0, Math.min(d.span.start, doc.length)),
    to: Math.max(0, Math.min(Math.max(d.span.end, d.span.start + 1), doc.length)),
    severity: d.severity === 'info' ? 'info' : d.severity,
    message: d.message,
    source: d.code,
    // A diagnostic that knows how to fix itself offers a button. Only fixes the
    // analyser is certain about arrive here: a wrong fix costs an undo and a little
    // trust, which is more than the fix was worth.
    actions: (d.fixIts ?? []).map((fix) => ({
      name: fix.title,
      apply: (view: EditorView) => {
        const length = view.state.doc.length
        view.dispatch({
          changes: fix.edits.map((edit) => ({
            from: Math.max(0, Math.min(edit.span.start, length)),
            to: Math.max(0, Math.min(edit.span.end, length)),
            insert: edit.newText,
          })),
        })
      },
    })),
  }))
}
