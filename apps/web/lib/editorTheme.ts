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

/** A completion's kind, as Xcode badges it: a letter on a tint of the colour that kind of name is drawn in. */
const kind = (letter: string, color: string) => ({ '--kind': color, '&:after': { content: `'${letter}'` } })

const TYPE = EDITOR_COLORS.systemType
const MEMBER = EDITOR_COLORS.otherDeclaration
const VALUE = EDITOR_COLORS.projectMember

/** A secondary push button, as `PushButton` draws one. */
const button = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 'var(--control-height)',
  padding: '0 12px',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  backgroundColor: 'var(--color-xc-fill)',
  backgroundImage: 'none',
  color: 'var(--color-xc-text)',
  fontFamily: 'inherit',
  fontSize: 'var(--text-body)',
  cursor: 'default',
  transition: 'background-color var(--duration-fast)',
}

const chrome = EditorView.theme(
  {
    // SF Mono at 12 on 18px lines, which is Xcode's size with the room a diagnostic
    // underline and a selection need between lines.
    '&': {
      color: EDITOR_COLORS.text,
      backgroundColor: EDITOR_COLORS.background,
      height: '100%',
      fontSize: 'var(--text-footnote)',
    },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '18px' },
    '.cm-content': { caretColor: EDITOR_COLORS.caret, padding: '8px 0' },
    '.cm-line': { padding: '0 16px 0 4px' },
    '&.cm-focused': { outline: 'none' },

    '.cm-cursor, .cm-dropCursor': { borderLeftColor: EDITOR_COLORS.caret, borderLeftWidth: '2px' },
    '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: EDITOR_COLORS.selection,
    },
    '.cm-selectionMatch': { backgroundColor: EDITOR_COLORS.selectionMatch },
    '.cm-activeLine': { backgroundColor: EDITOR_COLORS.currentLine },
    '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--color-xc-warn) 22%, transparent)', borderRadius: '2px' },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'color-mix(in srgb, var(--color-xc-warn) 45%, transparent)',
    },

    // The gutter: caption-sized numbers, right-aligned, and the current line's in the
    // primary label colour rather than behind a band of its own.
    '.cm-gutters': {
      backgroundColor: EDITOR_COLORS.gutter,
      color: EDITOR_COLORS.gutterText,
      border: 'none',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '40px',
      padding: '0 4px 0 12px',
      fontSize: 'var(--text-caption)',
      fontVariantNumeric: 'tabular-nums',
      textAlign: 'right',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: EDITOR_COLORS.gutterActive },
    // Fold markers wait for the pointer, as Xcode's ribbon does; a folded line keeps its.
    '.cm-foldGutter .cm-gutterElement': { padding: '0 4px', color: 'var(--color-xc-text-3)' },
    '.cm-foldGutter span': { opacity: 0, transition: 'opacity var(--duration-fast)' },
    '.cm-gutters:hover .cm-foldGutter span, .cm-foldGutter span[title="Unfold line"]': { opacity: 1 },
    '.cm-foldPlaceholder': {
      margin: '0 2px',
      padding: '0 4px',
      border: 'none',
      borderRadius: 'var(--radius-sm)',
      backgroundColor: 'var(--color-xc-fill)',
      color: 'var(--color-xc-text-2)',
      cursor: 'default',
      '&:hover': { backgroundColor: 'var(--color-xc-fill-strong)' },
    },

    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--color-xc-fill-strong)',
      outline: 'none',
    },
    '.cm-nonmatchingBracket': { backgroundColor: 'color-mix(in srgb, var(--color-xc-error) 20%, transparent)' },

    // Panels: find/replace, and anything else CodeMirror docks. A bar of 28px fields
    // and secondary buttons, like every other bar in the studio.
    '.cm-panels': { backgroundColor: 'var(--color-xc-bar)', color: 'var(--color-xc-text)' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--color-xc-line)' },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--color-xc-line)' },
    '.cm-panel.cm-search': {
      padding: '4px 40px 4px 8px',
      fontSize: 'var(--text-body)',
      lineHeight: 'var(--text-body--line-height)',
    },
    '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
      margin: '2px 4px 2px 0',
    },
    '.cm-panel.cm-search label': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      height: 'var(--control-height)',
      marginLeft: '8px',
      verticalAlign: 'middle',
      fontSize: 'var(--text-body)',
      color: 'var(--color-xc-text-2)',
    },
    '.cm-panel.cm-search input[type=checkbox]': { margin: 0 },
    // CodeMirror's own field look steps aside for the studio's (globals.css), hover
    // and focus included.
    '.cm-textfield': {
      width: '220px',
      height: 'var(--control-height)',
      padding: 'revert-layer',
      border: 'revert-layer',
      backgroundColor: 'revert-layer',
      color: 'revert-layer',
      fontSize: 'revert-layer',
    },
    '.cm-button': button,
    '.cm-button:hover, .cm-button:active': { backgroundColor: 'var(--color-xc-fill-strong)', backgroundImage: 'none' },
    '.cm-panel.cm-search [name=close]': {
      position: 'absolute',
      top: '8px',
      right: '8px',
      display: 'grid',
      placeItems: 'center',
      width: 'var(--control-height-sm)',
      height: 'var(--control-height-sm)',
      borderRadius: 'var(--radius-md)',
      backgroundColor: 'transparent',
      color: 'var(--color-xc-text-2)',
      fontSize: 'var(--text-title3)',
      lineHeight: 1,
      cursor: 'default',
      transition: 'background-color var(--duration-fast), color var(--duration-fast)',
      '&:hover': { backgroundColor: 'var(--color-xc-fill)', color: 'var(--color-xc-text)' },
    },
    '.cm-panel.cm-panel-lint ul [aria-selected]': { backgroundColor: 'var(--color-xc-select)' },
    '.cm-panel.cm-panel-lint ul:focus [aria-selected]': { backgroundColor: 'var(--color-xc-accent-fill)', color: '#fff' },

    // Everything that floats over the code is a popover: no border, the popover
    // shadow (which carries its own hairline), and the menus' 8px corners.
    '.cm-tooltip': {
      border: 'none',
      borderRadius: 'var(--radius-lg)',
      backgroundColor: 'var(--color-xc-panel)',
      boxShadow: 'var(--shadow-popover)',
      color: 'var(--color-xc-text)',
      fontFamily: 'var(--font-sans)',
    },
    '.cm-tooltip.cm-tooltip-hover, .cm-tooltip.cm-tooltip-autocomplete': {
      animation: 'xc-pop-in var(--duration-base) var(--ease-out)',
    },
    '.cm-tooltip .cm-tooltip-section:not(:first-child)': { borderTop: '1px solid var(--color-xc-line-soft)' },

    // Completion: rows of SF Mono, the highlighted one filled with the accent, as a
    // menu's is.
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      boxSizing: 'border-box',
      minWidth: '240px',
      maxHeight: '228px',
      padding: '4px',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-footnote)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
      display: 'flex',
      alignItems: 'center',
      height: '22px',
      padding: '0 8px 0 4px',
      borderRadius: 'var(--radius-sm)',
      lineHeight: '22px',
      cursor: 'default',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--color-xc-accent-fill)',
      color: '#fff',
    },
    '.cm-tooltip.cm-tooltip-autocomplete-disabled > ul > li[aria-selected]': {
      backgroundColor: 'var(--color-xc-fill-strong)',
      color: 'var(--color-xc-text)',
    },
    '.cm-completionIcon': {
      '--kind': 'var(--color-xc-text-3)',
      display: 'inline-grid',
      placeItems: 'center',
      flexShrink: 0,
      boxSizing: 'border-box',
      width: '16px',
      height: '16px',
      marginRight: '8px',
      padding: 0,
      borderRadius: 'var(--radius-sm)',
      backgroundColor: 'color-mix(in srgb, var(--kind) 16%, transparent)',
      color: 'var(--kind)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--text-caption)',
      lineHeight: 1,
      fontWeight: 600,
      opacity: 1,
    },
    'li[aria-selected] .cm-completionIcon': { color: '#fff', backgroundColor: 'rgb(255 255 255 / 0.2)' },
    '.cm-completionIcon-class': kind('C', TYPE),
    '.cm-completionIcon-interface': kind('P', TYPE),
    '.cm-completionIcon-enum': kind('E', TYPE),
    '.cm-completionIcon-type': kind('T', TYPE),
    '.cm-completionIcon-namespace': kind('N', TYPE),
    '.cm-completionIcon-function, .cm-completionIcon-method': kind('M', MEMBER),
    '.cm-completionIcon-property, .cm-completionIcon-variable, .cm-completionIcon-constant': kind('V', VALUE),
    '.cm-completionIcon-keyword': kind('K', EDITOR_COLORS.keyword),
    '.cm-completionLabel': { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', color: 'inherit' },
    '.cm-completionDetail': {
      marginLeft: 'auto',
      paddingLeft: '16px',
      flexShrink: 0,
      fontStyle: 'normal',
      color: 'var(--color-xc-text-3)',
    },
    'li[aria-selected] .cm-completionDetail': { color: 'rgb(255 255 255 / 0.75)' },
    '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: 600 },
    '.cm-tooltip.cm-completionInfo': {
      maxWidth: '360px',
      padding: '8px 12px',
      fontSize: 'var(--text-footnote)',
      lineHeight: 'var(--text-footnote--line-height)',
      color: 'var(--color-xc-text-2)',
    },

    // A diagnostic under the pointer: a small card, with the severity as a dot
    // rather than a bar down its side.
    '.cm-tooltip-lint': { padding: '4px 0' },
    '.cm-diagnostic': {
      position: 'relative',
      maxWidth: '420px',
      marginLeft: 0,
      padding: '4px 12px 4px 28px',
      borderLeft: 'none',
      fontSize: 'var(--text-body)',
      lineHeight: 'var(--text-body--line-height)',
      '&:before': {
        content: "''",
        position: 'absolute',
        top: '9px',
        left: '12px',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: 'var(--color-xc-text-3)',
      },
    },
    '.cm-diagnostic-error': { borderLeft: 'none', '&:before': { backgroundColor: 'var(--color-xc-error)' } },
    '.cm-diagnostic-warning': { borderLeft: 'none', '&:before': { backgroundColor: 'var(--color-xc-warn)' } },
    '.cm-diagnostic-info': { borderLeft: 'none', '&:before': { backgroundColor: 'var(--color-xc-accent)' } },
    '.cm-diagnostic-hint': { borderLeft: 'none' },
    '.cm-diagnosticText': { display: 'block' },
    '.cm-diagnosticAction': {
      ...button,
      height: 'var(--control-height-sm)',
      padding: '0 8px',
      margin: '4px 8px 0 0',
      '&:hover': { backgroundColor: 'var(--color-xc-fill-strong)' },
    },
    '.cm-diagnosticSource': {
      marginTop: '2px',
      fontSize: 'var(--text-caption)',
      lineHeight: 'var(--text-caption--line-height)',
      color: 'var(--color-xc-text-3)',
      opacity: 1,
    },
    '.cm-lintRange-error, .cm-lintRange-warning, .cm-lintRange-info': {
      backgroundImage: 'none',
      textDecorationLine: 'underline',
      textDecorationThickness: '1px',
      textUnderlineOffset: '3px',
    },
    '.cm-lintRange-error': { textDecorationStyle: 'wavy', textDecorationColor: 'var(--color-xc-error)' },
    '.cm-lintRange-warning': { textDecorationStyle: 'wavy', textDecorationColor: 'var(--color-xc-warn)' },
    '.cm-lintRange-info': { textDecorationStyle: 'dotted', textDecorationColor: 'var(--color-xc-accent)' },
    '.cm-lintPoint:after': { borderBottomColor: 'var(--color-xc-error)' },
    '.cm-lintPoint-warning:after': { borderBottomColor: 'var(--color-xc-warn)' },
    '.cm-lintPoint-info:after': { borderBottomColor: 'var(--color-xc-accent)' },
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
