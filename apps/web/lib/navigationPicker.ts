import type { AuthoringSnapshot, NavigationDestination, PagePreview, SourceFile, ViewLayer } from '@studio/shared'

/** Pick the screen's component, never a component nested inside its content. */
export function navigationDestinationForPage(page: PagePreview, destinations: readonly NavigationDestination[], snapshot: AuthoringSnapshot | undefined, files: readonly SourceFile[]): { destination?: NavigationDestination; reason?: string } {
  const content = (layers: readonly ViewLayer[]): ViewLayer | undefined => {
    for (const layer of layers) {
      if (layer.type === 'Page' || layer.type === 'Presentation') {
        const child = content(layer.children)
        if (child) return child
      } else if (layer.source && layer.type !== '_BackButton' && layer.type !== 'Toolbar') return layer
    }
  }
  const root = content(page.viewHierarchy ?? [])
  const owner = root?.source && snapshot?.nodes.filter(node => node.kind === 'definition' && node.source.file === root.source!.file && node.source.start <= root.source!.start && node.source.end >= root.source!.end).sort((a, b) => (a.source.end - a.source.start) - (b.source.end - b.source.start))[0]
  const component = [...(root?.componentSources ?? [])].reverse().find(component => component.name === owner?.name)
  if (!component) return { reason: 'This screen is defined inline. Choose a reusable screen from Navigate to.' }
  const expression = files.find(file => file.id === component.source.file)?.text.slice(component.source.start, component.source.end).trim()
  const matches = destinations.filter(destination => destination.viewName === component.name)
  if (!matches.length) return { reason: 'This screen is not an available destination for the selected view.' }
  const exact = matches.find(destination => destination.expression.trim() === expression)
  if (exact) return exact.available ? { destination: exact } : { reason: exact.reason ?? 'This screen needs data that is unavailable here.' }
  // A route's parameter has a different name from the selected row's value. The
  // planner supplies the equivalent destination using that row's own data.
  const translated = matches.filter(destination => destination.available && destination.source?.file === component.source.file && destination.source.start <= component.source.start && destination.source.end >= component.source.end)
  if (translated.length === 1) return { destination: translated[0] }
  return { reason: matches.find(destination => !destination.available)?.reason ?? 'Choose this screen in Navigate to and provide its required data.' }
}
