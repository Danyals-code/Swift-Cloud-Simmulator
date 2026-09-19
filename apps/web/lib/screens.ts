import type { AuthoringNode, AuthoringSnapshot, PagePreview } from '@studio/shared'

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
export function screenCatalog(snapshot: AuthoringSnapshot | undefined, pages: readonly PagePreview[] | undefined, saved: readonly DesignScreen[] = []): DesignScreen[] {
  const found = new Map<string, DesignScreen>()
  for (const screen of saved) if (snapshot?.nodes.some(n => n.kind === 'definition' && n.name === screen.view)) found.set(screen.view, screen)
  for (const page of pages ?? []) {
    const definition = screenDefinition(snapshot, page)
    if (definition && !found.has(definition.name)) found.set(definition.name, { view: definition.name, name: page.name })
  }
  return [...found.values()]
}
