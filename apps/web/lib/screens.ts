import type { AuthoringNode, AuthoringSnapshot, DesignControl, PagePreview, PreviewScenario } from '@studio/shared'
import { settingsVisualChildren } from './authoringSettings'

export interface DesignScreen { view: string; name: string }
export type ScreenCommand = { kind: 'create'; name: string; layout: 'VStack' | 'HStack' | 'ZStack' } | { kind: 'rename'; view: string; name: string } | { kind: 'duplicate' | 'remove' | 'up' | 'down'; view: string }
/**
 * The view a page is drawn by, when it is that view's own page.
 *
 * A page written inside another view's code - a link or a sheet with its content
 * inline, a tab built in place - has no view of its own. It is not the view whose code
 * holds it: naming it after that view, or renaming, duplicating or removing that view
 * from it, would act on another screen. The pipeline decides which pages are whose
 * (see `pageViews`), with every page in view.
 */
export function screenDefinition(snapshot: AuthoringSnapshot | undefined, page: PagePreview): AuthoringNode | undefined {
  const view = page.id.startsWith('screen:') ? page.id.slice(7) : page.view
  return view ? snapshot?.nodes.find(n => n.kind === 'definition' && n.name === view) : undefined
}
/** Names the preview falls back to when a screen has no title of its own. */
const GENERIC_PAGE = /^(Main page|Page \d+|Details|Sheet|Full screen|Popover|Menu|Alert|Confirmation)$/
/** A screen's name from its view: `HomeScreen` is "Home". */
export const screenLabel = (view: string) => view.replace(/(Screen|View)$/, '') || view

export function screenCatalog(snapshot: AuthoringSnapshot | undefined, pages: readonly PagePreview[] | undefined, saved: readonly DesignScreen[] = []): DesignScreen[] {
  const found = new Map<string, DesignScreen>()
  for (const screen of saved) if (snapshot?.nodes.some(n => n.kind === 'definition' && n.name === screen.view)) found.set(screen.view, screen)
  for (const page of pages ?? []) {
    const definition = screenDefinition(snapshot, page)
    // "Main page" is what the preview calls a screen with no title bar. The view's
    // own name is what the designer wrote, so it wins.
    if (definition && !found.has(definition.name)) found.set(definition.name, { view: definition.name, name: GENERIC_PAGE.test(page.name) ? screenLabel(definition.name) : page.name })
  }
  return [...found.values()]
}

/** The first local occurrence wins SwiftUI's inherited font/foreground precedence. */
export function screenOverrideModifier(root: AuthoringNode, name: string) {
  const names = name === 'foregroundColor' || name === 'foregroundStyle' ? ['foregroundColor', 'foregroundStyle'] : name === 'tint' ? ['tint', 'accentColor'] : [name]
  return root.modifiers?.find(modifier => modifier.enabled && names.includes(modifier.name))
}

/** The first visible view a screen draws - what screen-level values are written on. */
export function screenRoot(snapshot: AuthoringSnapshot | undefined, definition: AuthoringNode | undefined): AuthoringNode | undefined {
  if (!snapshot || !definition) return undefined
  return settingsVisualChildren(snapshot, definition)[0]
}

/** The screen's title bar title, wherever in the screen's own views it is written. */
export function screenTitleControl(snapshot: AuthoringSnapshot | undefined, definition: AuthoringNode | undefined): { node: AuthoringNode; control: DesignControl } | undefined {
  if (!snapshot || !definition) return undefined
  for (const node of snapshot.nodes) {
    if (node.owner !== definition.name || node.kind === 'definition') continue
    const control = node.controls?.find(c => c.id.startsWith('modifier:') && c.label.startsWith('navigationTitle'))
    if (control) return { node, control }
  }
  return undefined
}

/** Which screen a preview state belongs to: the view whose inputs it changes. */
export function scenarioScreen(scenario: PreviewScenario): string {
  return (scenario.owner || scenario.inputs?.[0]?.owner || '').split('.')[0]!
}

/** Persisted names remain human-readable; UI identity also includes the owning screen. */
export function scenarioKey(scenario: PreviewScenario): string {
  return JSON.stringify([scenarioScreen(scenario), scenario.name])
}
