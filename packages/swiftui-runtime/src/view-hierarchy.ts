import type { ViewLayer } from '@studio/shared'
import { asView, labelView, stopped, type ViewValue } from './view-value'

export function layerLabel(view: ViewValue): string {
  // A view that stopped is still the view it was: its layer says which.
  const halted = stopped(view)
  if (halted) return halted.name
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
    return [...view.children, ...labelViews(view)].map(nested).find(Boolean) ?? ''
  }
  return ''
}

/**
 * What `Button { … } label: { … }` is drawn with (D16). The host keeps a label as the
 * Button's arguments, since its content closure is the action, so the label's views are
 * listed here as the Button's own layers: a view in a tappable card is then found on the
 * canvas and in Layers like any other.
 */
function labelViews(view: ViewValue): ViewValue[] {
  return view.name === 'Button' ? view.args.flatMap(arg => labelView(arg) ?? []) : []
}

/** The SF Symbol a tab item shows, for the tab's lane on the design canvas. */
export function tabIcon(view: ViewValue): string | undefined {
  const label = view.name === 'Image' ? 'systemName' : view.name === 'Label' ? 'systemImage' : null
  const value = label ? view.args.find(a => a.label === label)?.value : undefined
  if (value?.kind === 'string') return value.value
  for (const child of view.children) {
    const found = tabIcon(child)
    if (found) return found
  }
  return undefined
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
      ...viewLayers(labelViews(view).filter(child => child.path)),
      ...view.modifiers.flatMap(modifier => ['background', 'overlay', 'safeAreaInset'].includes(modifier.name)
        ? modifier.args.flatMap(arg => {
          const child = asView(arg.value)
          return child?.path ? viewLayers([child]) : []
        }) : []),
    ],
  }))
}
