import type { ViewLayer } from '@studio/shared'
import { asView, type ViewValue } from './view-value'

export function layerLabel(view: ViewValue): string {
  const title = view.args.find(a => a.label === null)?.value
  if (title?.kind === 'string') return title.value
  if (view.name === 'Image') {
    const symbol = view.args.find(a => a.label === 'systemName')?.value
    if (symbol?.kind === 'string') return symbol.value
  }
  if (['Button', 'Label', 'NavigationLink', '_TabItem'].includes(view.name)) {
    const nested = (value: ViewValue): string => {
      if (value.name === 'Image') return ''
      const text = value.args.find(a => a.label === null)?.value
      return text?.kind === 'string' ? text.value : value.children.map(nested).find(Boolean) || ''
    }
    return view.children.map(nested).find(Boolean) ?? ''
  }
  return ''
}

/** Use the resolver's identities, including stable ForEach keys and modifier layers. */
export function viewLayers(views: readonly ViewValue[]): ViewLayer[] {
  return views.map(view => ({
    id: view.path!,
    name: layerLabel(view) || view.name,
    type: view.name,
    source: view.span,
    ...(view.componentSources?.length ? { componentSources: view.componentSources } : {}),
    children: [
      ...viewLayers(view.children),
      ...view.modifiers.flatMap(modifier => ['background', 'overlay', 'safeAreaInset'].includes(modifier.name)
        ? modifier.args.flatMap(arg => {
          const child = asView(arg.value)
          return child?.path ? viewLayers([child]) : []
        }) : []),
    ],
  }))
}
