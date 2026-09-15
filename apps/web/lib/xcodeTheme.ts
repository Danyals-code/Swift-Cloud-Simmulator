'use client'

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { tags as t } from '@lezer/highlight'

/**
 * Xcode's Default (Dark) appearance, for CodeMirror.
 *
 * The editor previously used `oneDark`, which is Atom's theme by way of VS Code.
 * It is a perfectly good theme and it is the wrong one: a Swift file in Xcode has
 * pink keywords, salmon strings and khaki numbers, and anybody who has spent a day
 * in Xcode reads the difference instantly even if they could not name a single
 * hex value. Matching it is most of what makes the editor stop looking like a
 * generic web editor that happens to know Swift.
 *
 * The palette is Xcode's own, unmodified. The one place this departs from
 * transcription is the current-line highlight: Xcode draws it as a selection-tinted
 * band that is nearly invisible on a dark background, and a preview tool wants the
 * caret's line findable at a glance.
 */
export const XCODE_DARK = {
  background: '#1f1f24',
  text: '#dfdfe0',
  caret: '#ffffff',
  selection: '#515b70',
  selectionMatch: '#3a4460',
  currentLine: '#2a2a33',
  gutter: '#1f1f24',
  gutterText: '#6c7986',
  gutterActive: '#dfdfe0',
  panel: '#2e2e33',
  panelBorder: '#000000',

  comment: '#6c7986',
  string: '#fc6a5d',
  number: '#d0bf69',
  keyword: '#fc5fa3',
  preprocessor: '#fd8f3f',
  attribute: '#bf8555',
  /** A type being declared here - `struct ContentView`. */
  typeDeclaration: '#5dd8ff',
  /** A non-type declaration - `let count`, `func body`. */
  otherDeclaration: '#4eb0cc',
  /** A type this project declares, referenced from elsewhere. */
  projectType: '#9ef1dd',
  /** A function or property this project declares. */
  projectMember: '#67b7a4',
  /** A type from outside the project - `Text`, `Color`, `String`. */
  systemType: '#d0a8ff',
  /** A function, method or property from outside the project - `.padding`. */
  systemMember: '#a167e6',
  url: '#6699ff',
  invalid: '#ff5f56',
} as const

/**
 * Editor chrome.
 *
 * Covers more than the canvas, because everything CodeMirror pops up - the
 * completion list, the hover tooltip, the find bar, the lint panel - is styled by
 * whichever theme is installed. Leaving them to the default would produce a
 * faithful Xcode editor with a white autocomplete list floating over it.
 */
const chrome = EditorView.theme(
  {
    '&': {
      color: XCODE_DARK.text,
      backgroundColor: XCODE_DARK.background,
      height: '100%',
      fontSize: '12.5px',
    },
    '.cm-content': {
      caretColor: XCODE_DARK.caret,
      fontFamily:
        'ui-monospace, "SF Mono", SFMono-Regular, Menlo, "JetBrains Mono", "Cascadia Mono", Consolas, monospace',
      // Xcode's default line spacing. Tight enough that a body of code reads as a
      // block, loose enough that the lint underlines have somewhere to go.
      lineHeight: '1.45',
      padding: '6px 0',
    },
    '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit' },
    '&.cm-focused': { outline: 'none' },

    '.cm-cursor, .cm-dropCursor': { borderLeftColor: XCODE_DARK.caret, borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: XCODE_DARK.selection,
    },
    '.cm-selectionMatch': { backgroundColor: XCODE_DARK.selectionMatch },
    '.cm-activeLine': { backgroundColor: XCODE_DARK.currentLine },

    '.cm-gutters': {
      backgroundColor: XCODE_DARK.gutter,
      color: XCODE_DARK.gutterText,
      border: 'none',
      // Xcode's gutter is separated by space, not by a rule.
      paddingRight: '6px',
      minWidth: '38px',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 4px 0 12px' },
    '.cm-activeLineGutter': {
      backgroundColor: XCODE_DARK.currentLine,
      color: XCODE_DARK.gutterActive,
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'rgb(255 255 255 / 0.1)',
      border: 'none',
      color: XCODE_DARK.text,
      borderRadius: '4px',
      padding: '0 6px',
    },

    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgb(255 255 255 / 0.12)',
      outline: 'none',
    },
    '.cm-nonmatchingBracket': { backgroundColor: 'rgb(255 95 86 / 0.25)' },

    // Panels: find/replace, and anything else CodeMirror docks.
    '.cm-panels': {
      backgroundColor: '#2a2a2e',
      color: XCODE_DARK.text,
      borderColor: 'rgb(0 0 0 / 0.6)',
    },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid rgb(0 0 0 / 0.6)' },
    '.cm-panel.cm-search': { padding: '5px 8px', fontSize: '12px' },
    '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-textfield': {
      backgroundColor: 'rgb(0 0 0 / 0.3)',
      color: XCODE_DARK.text,
      border: '1px solid rgb(255 255 255 / 0.12)',
      borderRadius: '5px',
      padding: '2px 6px',
      fontFamily: 'inherit',
    },
    '.cm-panel.cm-search button[name="close"]': { border: 'none', background: 'transparent' },
    '.cm-button': {
      backgroundImage: 'none',
      backgroundColor: 'rgb(255 255 255 / 0.08)',
      border: '1px solid rgb(255 255 255 / 0.12)',
      borderRadius: '5px',
      color: XCODE_DARK.text,
    },

    // Completion. AppKit's own list: a dark panel, a blue active row, no borders
    // between items.
    '.cm-tooltip': {
      backgroundColor: XCODE_DARK.panel,
      border: '1px solid rgb(0 0 0 / 0.5)',
      borderRadius: '6px',
      boxShadow: '0 10px 34px rgb(0 0 0 / 0.55)',
      color: XCODE_DARK.text,
      overflow: 'hidden',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily:
        'ui-monospace, "SF Mono", SFMono-Regular, Menlo, "JetBrains Mono", Consolas, monospace',
      fontSize: '12px',
      maxHeight: '16em',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '3px 8px', lineHeight: '1.4' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: '#0a84ff',
      color: '#ffffff',
    },
    '.cm-completionIcon': { opacity: 0.7, paddingRight: '10px' },
    '.cm-completionLabel': { color: 'inherit' },
    '.cm-completionDetail': { color: XCODE_DARK.comment, fontStyle: 'normal', marginLeft: '1em' },
    'li[aria-selected] .cm-completionDetail': { color: 'rgb(255 255 255 / 0.75)' },
    '.cm-completionMatchedText': {
      textDecoration: 'none',
      color: 'inherit',
      fontWeight: '700',
    },
    '.cm-tooltip.cm-completionInfo': {
      backgroundColor: XCODE_DARK.panel,
      border: '1px solid rgb(0 0 0 / 0.5)',
      padding: '6px 8px',
      maxWidth: '360px',
      fontFamily: 'inherit',
    },

    // Diagnostics. Xcode marks the whole line; CodeMirror underlines the span, which
    // is more precise and worth keeping.
    '.cm-diagnostic': { padding: '4px 8px', borderLeftWidth: '3px' },
    '.cm-diagnostic-error': { borderLeftColor: '#ff5f56' },
    '.cm-diagnostic-warning': { borderLeftColor: '#f5b21e' },
    '.cm-diagnostic-info': { borderLeftColor: '#0a84ff' },
    '.cm-diagnosticAction': {
      backgroundColor: 'rgb(255 255 255 / 0.1)',
      color: XCODE_DARK.text,
      borderRadius: '4px',
      padding: '1px 6px',
      marginLeft: '8px',
      fontFamily: 'inherit',
    },
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy #ff5f56',
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
    '.cm-lintPoint:after': { borderBottomColor: '#ff5f56' },
  },
  { dark: true },
)

/**
 * Token colours.
 *
 * Keyed on the tags the legacy Swift stream mode produces once CodeMirror has
 * mapped its style strings: `keyword`, `string`, `number`, `atom`, `comment`,
 * `def`, `variable`, `property`, `type`, `attribute`, `builtin`, `operator`,
 * `punctuation`.
 *
 * That grammar knows nothing about the code, so it cannot tell a type this project
 * declares from one SwiftUI does - the distinction Xcode draws in mint against
 * purple, and the most recognisable thing about a Swift file on screen. The
 * semantic layer in `semanticHighlight.ts` supplies it from our own parser and
 * paints over the top of these; what is here is what shows while the worker is
 * still thinking, and it has to be right on its own.
 */
const highlight = HighlightStyle.define([
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: XCODE_DARK.comment },
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword], color: XCODE_DARK.keyword },
  { tag: [t.atom, t.bool, t.self, t.null], color: XCODE_DARK.number },
  { tag: [t.number, t.integer, t.float, t.character], color: XCODE_DARK.number },
  { tag: [t.string, t.special(t.string), t.regexp], color: XCODE_DARK.string },
  { tag: [t.escape], color: XCODE_DARK.preprocessor },
  { tag: [t.meta, t.processingInstruction], color: XCODE_DARK.preprocessor },
  // `#Preview`, `#available`, `#if` - the legacy mode calls these `builtin`.
  { tag: [t.standard(t.variableName), t.macroName], color: XCODE_DARK.preprocessor },
  { tag: [t.attributeName, t.annotation], color: XCODE_DARK.attribute },
  { tag: [t.typeName, t.className, t.namespace], color: XCODE_DARK.systemType },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: XCODE_DARK.otherDeclaration },
  { tag: [t.definition(t.typeName), t.definition(t.className)], color: XCODE_DARK.typeDeclaration },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: XCODE_DARK.systemMember },
  { tag: [t.propertyName], color: XCODE_DARK.systemMember },
  { tag: [t.variableName, t.labelName], color: XCODE_DARK.text },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator], color: XCODE_DARK.text },
  { tag: [t.link, t.url], color: XCODE_DARK.url, textDecoration: 'underline' },
  { tag: [t.invalid], color: XCODE_DARK.invalid },
  { tag: [t.strong], fontWeight: '700' },
  { tag: [t.emphasis], fontStyle: 'italic' },
])

/** The complete theme: chrome plus token colours. */
export const xcodeDark: Extension = [chrome, syntaxHighlighting(highlight)]
