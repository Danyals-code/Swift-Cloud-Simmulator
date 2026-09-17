'use client'

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { tags as t } from '@lezer/highlight'

export const EDITOR_COLORS = {
  background: 'var(--editor-background)',
  text: 'var(--editor-text)',
  caret: 'var(--editor-caret)',
  selection: 'var(--editor-selection)',
  selectionMatch: 'var(--editor-selectionMatch)',
  currentLine: 'var(--editor-currentLine)',
  gutter: 'var(--editor-gutter)',
  gutterText: 'var(--editor-gutterText)',
  gutterActive: 'var(--editor-gutterActive)',
  panel: 'var(--editor-panel)',
  panelBorder: 'var(--editor-panelBorder)',

  comment: 'var(--editor-comment)',
  string: 'var(--editor-string)',
  number: 'var(--editor-number)',
  keyword: 'var(--editor-keyword)',
  preprocessor: 'var(--editor-preprocessor)',
  attribute: 'var(--editor-attribute)',
  typeDeclaration: 'var(--editor-typeDeclaration)',
  otherDeclaration: 'var(--editor-otherDeclaration)',
  projectType: 'var(--editor-projectType)',
  projectMember: 'var(--editor-projectMember)',
  systemType: 'var(--editor-systemType)',
  systemMember: 'var(--editor-systemMember)',
  url: 'var(--editor-url)',
  invalid: 'var(--editor-invalid)',
} as const

const chrome = EditorView.theme(
  {
    '&': {
      color: EDITOR_COLORS.text,
      backgroundColor: EDITOR_COLORS.background,
      height: '100%',
      fontSize: '14px',
    },
    '.cm-content': {
      caretColor: EDITOR_COLORS.caret,
      fontFamily:
        'ui-monospace, "SF Mono", SFMono-Regular, Menlo, "JetBrains Mono", "Cascadia Mono", Consolas, monospace',
      // Leave enough room for diagnostic underlines and selection highlights.
      lineHeight: '1.7',
      padding: '14px 0',
    },
    '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit' },
    '&.cm-focused': { outline: 'none' },

    '.cm-cursor, .cm-dropCursor': { borderLeftColor: EDITOR_COLORS.caret, borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: EDITOR_COLORS.selection,
    },
    '.cm-selectionMatch': { backgroundColor: EDITOR_COLORS.selectionMatch },
    '.cm-activeLine': { backgroundColor: EDITOR_COLORS.currentLine },

    '.cm-gutters': {
      backgroundColor: EDITOR_COLORS.gutter,
      color: EDITOR_COLORS.gutterText,
      border: 'none',
      paddingRight: '6px',
      minWidth: '38px',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 4px 0 12px' },
    '.cm-activeLineGutter': {
      backgroundColor: EDITOR_COLORS.currentLine,
      color: EDITOR_COLORS.gutterActive,
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--color-xc-bar-raised)',
      border: 'none',
      color: EDITOR_COLORS.text,
      borderRadius: '4px',
      padding: '0 6px',
    },

    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--color-xc-line)',
      outline: 'none',
    },
    '.cm-nonmatchingBracket': { backgroundColor: 'rgb(255 95 86 / 0.25)' },

    // Panels: find/replace, and anything else CodeMirror docks.
    '.cm-panels': {
      backgroundColor: 'var(--color-xc-bar-raised)',
      color: EDITOR_COLORS.text,
      borderColor: 'var(--color-xc-line)',
    },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--color-xc-line)' },
    '.cm-panel.cm-search': { padding: '5px 8px', fontSize: '14px' },
    '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-textfield': {
      backgroundColor: 'var(--color-xc-bar-raised)',
      color: EDITOR_COLORS.text,
      border: '1px solid var(--color-xc-line)',
      borderRadius: '5px',
      padding: '2px 6px',
      fontFamily: 'inherit',
    },
    '.cm-panel.cm-search button[name="close"]': { border: 'none', background: 'transparent' },
    '.cm-button': {
      backgroundImage: 'none',
      backgroundColor: 'var(--color-xc-bar-raised)',
      border: '1px solid var(--color-xc-line)',
      borderRadius: '5px',
      color: EDITOR_COLORS.text,
    },
    '.cm-tooltip': {
      backgroundColor: EDITOR_COLORS.panel,
      border: '1px solid var(--color-xc-line)',
      borderRadius: '6px',
      boxShadow: '0 10px 34px rgb(0 0 0 / 0.12)',
      color: EDITOR_COLORS.text,
      overflow: 'hidden',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily:
        'ui-monospace, "SF Mono", SFMono-Regular, Menlo, "JetBrains Mono", Consolas, monospace',
      fontSize: '14px',
      maxHeight: '16em',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '3px 8px', lineHeight: '1.4' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--editor-backgroundColor)',
      color: 'var(--editor-color)',
    },
    '.cm-completionIcon': { opacity: 0.7, paddingRight: '10px' },
    '.cm-completionLabel': { color: 'inherit' },
    '.cm-completionDetail': { color: EDITOR_COLORS.comment, fontStyle: 'normal', marginLeft: '1em' },
    'li[aria-selected] .cm-completionDetail': { color: 'rgb(255 255 255 / 0.75)' },
    '.cm-completionMatchedText': {
      textDecoration: 'none',
      color: 'inherit',
      fontWeight: '700',
    },
    '.cm-tooltip.cm-completionInfo': {
      backgroundColor: EDITOR_COLORS.panel,
      border: '1px solid var(--color-xc-line)',
      padding: '6px 8px',
      maxWidth: '360px',
      fontFamily: 'inherit',
    },
    '.cm-diagnostic': { padding: '4px 8px', borderLeftWidth: '3px' },
    '.cm-diagnostic-error': { borderLeftColor: '#c83a32' },
    '.cm-diagnostic-warning': { borderLeftColor: '#f5b21e' },
    '.cm-diagnostic-info': { borderLeftColor: '#0a84ff' },
    '.cm-diagnosticAction': {
      backgroundColor: 'var(--color-xc-bar-raised)',
      color: EDITOR_COLORS.text,
      borderRadius: '4px',
      padding: '1px 6px',
      marginLeft: '8px',
      fontFamily: 'inherit',
    },
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy #c83a32',
      textUnderlineOffset: '3px',
    },
    '.cm-lintRange-warning': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy #f5b21e',
      textUnderlineOffset: '3px',
    },
    '.cm-lintRange-info': {
      backgroundImage: 'none',
      textDecoration: 'underline dotted #0a84ff',
      textUnderlineOffset: '3px',
    },
    '.cm-lintPoint:after': { borderBottomColor: '#c83a32' },
  },
  { dark: false },
)

const highlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: EDITOR_COLORS.comment },
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword], color: EDITOR_COLORS.keyword },
  { tag: [t.atom, t.bool, t.self, t.null], color: EDITOR_COLORS.number },
  { tag: [t.number, t.integer, t.float, t.character], color: EDITOR_COLORS.number },
  { tag: [t.string, t.special(t.string), t.regexp], color: EDITOR_COLORS.string },
  { tag: [t.escape], color: EDITOR_COLORS.preprocessor },
  { tag: [t.meta, t.processingInstruction], color: EDITOR_COLORS.preprocessor },
  // `#Preview`, `#available`, `#if` - the legacy mode calls these `builtin`.
  { tag: [t.standard(t.variableName), t.macroName], color: EDITOR_COLORS.preprocessor },
  { tag: [t.attributeName, t.annotation], color: EDITOR_COLORS.attribute },
  { tag: [t.typeName, t.className, t.namespace], color: EDITOR_COLORS.systemType },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: EDITOR_COLORS.otherDeclaration },
  { tag: [t.definition(t.typeName), t.definition(t.className)], color: EDITOR_COLORS.typeDeclaration },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: EDITOR_COLORS.systemMember },
  { tag: [t.propertyName], color: EDITOR_COLORS.systemMember },
  { tag: [t.variableName, t.labelName], color: EDITOR_COLORS.text },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator], color: EDITOR_COLORS.text },
  { tag: [t.link, t.url], color: EDITOR_COLORS.url, textDecoration: 'underline' },
  { tag: [t.invalid], color: EDITOR_COLORS.invalid },
  { tag: [t.strong], fontWeight: '700' },
  { tag: [t.emphasis], fontStyle: 'italic' },
])

export const editorTheme: Extension = [chrome, syntaxHighlighting(highlight)]
