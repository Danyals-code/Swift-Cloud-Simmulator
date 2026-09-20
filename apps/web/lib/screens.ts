import type { AuthoringNode, AuthoringSnapshot, DesignControl, PagePreview, PreviewScenario } from '@studio/shared'
import { settingsVisualChildren } from './authoringSettings'

export interface DesignScreen { view: string; name: string }
export type ScreenCommand = { kind: 'create'; name: string; layout: 'VStack' | 'HStack' | 'ZStack' } | { kind: 'rename'; view: string; name: string } | { kind: 'duplicate' | 'remove' | 'up' | 'down'; view: string }
export function screenDefinition(snapshot: AuthoringSnapshot | undefined, page: PagePreview): AuthoringNode | undefined {
  if (page.id.startsWith('screen:')) return snapshot?.nodes.find(n => n.kind === 'definition' && n.name === page.id.slice(7))
  const component = page.viewHierarchy?.[0]?.children[0]?.componentSources?.at(-1)?.name
  if (component) { const definition = snapshot?.nodes.find(n => n.kind === 'definition' && n.name === component); if (definition) return definition }
  const source = page.source
  const candidate = source && snapshot?.nodes.filter(n => n.source.file === source.file && n.source.start <= source.start && n.source.end >= source.end && n.kind !== 'definition').sort((a, b) => (a.source.end - a.source.start) - (b.source.end - b.source.start))[0]
  if (candidate?.definitionId) return snapshot?.nodes.find(n => n.id === candidate.definitionId)
  return source && snapshot?.nodes.filter(n => n.kind === 'definition' && n.source.file === source.file && n.source.start <= source.start && n.source.end >= source.end).sort((a, b) => (a.source.end - a.source.start) - (b.source.end - b.source.start))[0]
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
