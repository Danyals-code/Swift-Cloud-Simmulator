import type { AuthoringNode, AuthoringSnapshot, Diagnostic, SourceSpan } from '@studio/shared'
import type { DesignScreen } from './screens'
import { friendlyComponentName, sourceDefinitionAround, sourceLayerAround, sourceLayerLabel } from './sourceLayers'

/**
 * The canvas's warnings in a designer's words (D11): what the preview draws or runs
 * differently from the app, and what may not build or behave in the app either. The
 * Problems pane keeps the checker's own text; these say the same thing for Design.
 */
export interface DesignWarning {
  /** `preview`: only the preview differs, and the app is as written. `xcode`: check it in Xcode too. */
  readonly kind: 'preview' | 'xcode'
  /** The screen it is on, as Design names it. */
  readonly screen: string
  /** What it is about, as Layers names it. */
  readonly what: string
  readonly sentence: string
  /** The layer it is on, for Find layer. */
  readonly node?: AuthoringNode
  readonly span: SourceSpan
}

/** The warnings, preview-only first, then by screen and by where they are written. */
export function designWarnings(diagnostics: readonly Diagnostic[], snapshot: AuthoringSnapshot | undefined, screens: readonly DesignScreen[]): DesignWarning[] {
  const order = (screen: string) => { const at = screens.findIndex(item => item.name === screen); return at < 0 ? screens.length : at }
  return diagnostics.filter(d => d.severity === 'warning').map(d => {
    const node = sourceLayerAround(snapshot, d.span)
    const view = sourceDefinitionAround(snapshot, d.span)?.name
    // A view no screen is drawn by is a component, used in screens, not one of them.
    const screen = view ? screens.find(item => item.view === view)?.name ?? `${friendlyComponentName(view)} component` : 'App'
    return { kind: kindOf(d), screen, what: node ? sourceLayerLabel(node) : d.feature ?? 'Code', sentence: sentenceOf(d), ...(node ? { node } : {}), span: d.span }
  }).sort((a, b) => Number(a.kind === 'xcode') - Number(b.kind === 'xcode') || order(a.screen) - order(b.screen) || a.span.start - b.span.start)
}

/** Whether the app may not build or behave as the designer expects, not only the preview. */
function kindOf(d: Diagnostic): DesignWarning['kind'] {
  // A screen the Design canvas leaves out is the preview's alone, wherever its warning is written.
  if (d.message.includes(' on the Design canvas: ')) return 'preview'
  // A trap at run time, such as rows sharing an id, is a bug on a device too.
  if (['may_not_compile_in_xcode', 'unresolved_identifier', 'unresolved_member', 'type_mismatch', 'runtime_trap'].includes(d.code)) return 'xcode'
  return /will not compile|does not recognise the (?:modifier|attribute)/.test(d.message) ? 'xcode' : 'preview'
}

/** The checker's words where they are already a designer's; otherwise the same thing said plainly. */
function sentenceOf(d: Diagnostic): string {
  const feature = d.feature ?? ''
  if (feature === 'Link' || feature === 'ShareLink') return `Tapping it opens nothing in the preview. In the app it opens ${feature === 'Link' ? 'the link' : 'the share sheet'}.`
  let match = /^'(\.\w+)' is recognised but not applied/.exec(d.message)
  if (match) return `The preview doesn't apply ${match[1]}. The app does.`
  match = /^The preview does not recognise the attribute '(@\w+)'/.exec(d.message)
  if (match) return `The preview doesn't know ${match[1]} and ignores it. If it isn't Swift's or SwiftUI's, the app won't build.`
  match = /^The preview does not recognise the modifier '(\.\w+)'/.exec(d.message)
  if (match) return `The preview doesn't know ${match[1]} and leaves it out. If it isn't SwiftUI's, the app won't build.`
  match = /^'([\w.]+)' isn't drawn in the preview yet/.exec(d.message)
  if (match) return `The preview shows a labelled box in its place. The app draws it.`
  match = /^Cannot find '(\w+)' in scope\. The preview draws a placeholder/.exec(d.message)
  if (match) return `The preview doesn't know '${match[1]}' and shows a box for it. If it isn't SwiftUI's or the project's, the app won't build.`
  // `Feature: what the preview does. The source exports unchanged.`, from the overload and corner checks.
  if (feature && d.message.startsWith(`${feature}: `)) {
    const said = d.message.slice(feature.length + 2).replace(/\.? The source exports unchanged\.$/, '.').replace(/Xcode draws/g, 'The app draws')
    return said.charAt(0).toUpperCase() + said.slice(1)
  }
  return d.message
    .replace(/ It is exported to Xcode unchanged, where it will not compile\.$/, " The app won't build with it: change it in Code.")
    .replace(/ It (?:is (?:ignored here and )?exported|exports)(?: to Xcode)? unchanged\.$/, ' The app uses it as written.')
}
