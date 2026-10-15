import type { Argument, CallExpr } from '@studio/swift-syntax'
import { LEGACY_STYLE_TOKENS } from './builtins'

/**
 * Whether `.tabViewStyle(…)`'s arguments set the page style (Wave 4c): `.page`,
 * `.page(indexDisplayMode:)` or the older `PageTabViewStyle(…)`, read from its one argument
 * as written. A style worked out in code is not read as one. App navigation, a carousel's
 * Page dots and a tab's Badge all read it here, and the preview's `pageStyled`, which reads
 * the style's evaluated token, mirrors it.
 */
export function isPageStyle(args: readonly Argument[]): boolean {
  const value = args.length === 1 && !args[0]!.label ? args[0]!.value : undefined
  const head = value?.kind === 'call' ? value.callee : value
  if (head?.kind === 'memberAccess' && !head.base) return head.member === 'page'
  return value?.kind === 'call' && head?.kind === 'identifier' && LEGACY_STYLE_TOKENS.get(head.name) === 'page'
}

/** Whether a TabView's modifiers swipe through its views as pages (Wave 4c), rather than showing them as tabs. */
export const pagesThrough = (modifiers: readonly CallExpr[]): boolean =>
  modifiers.some(m => m.callee.kind === 'memberAccess' && m.callee.member === 'tabViewStyle' && isPageStyle(m.args))
