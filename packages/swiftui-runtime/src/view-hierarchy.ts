import { LAYERED_LABEL_VIEWS, type ViewLayer } from '@studio/shared'
import { textOf } from './to-layout'
import { asView, labelView, stopped, type ViewArg, type ViewValue } from './view-value'

export function layerLabel(view: ViewValue): string {
  // A view that stopped is still the view it was: its layer says which.
  const halted = stopped(view)
  if (halted) return halted.name
  const title = view.args.find(a => a.label === null)?.value
  if (title?.kind === 'string') return title.value
  // Texts joined with `+` draw their runs' words, one after another (Wave 3a).
  if (view.name === 'Text' && !view.args.length && view.children.length) return view.children.map(layerLabel).join('')
  // `Text(price, format: .currency(code: "USD"))`: the words it draws, `$12.50` (Wave 3a).
  if (view.name === 'Text') return textOf(view)
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

/** A label's or an icon's views, from an argument of a view in `LAYERED_LABEL_VIEWS`, or null for any other argument. */
export function labelArgView(arg: ViewArg): ViewValue | null {
  return arg.label === 'icon' ? asView(arg.value) : labelView(arg)
}

/** A view of the closure form of `ContentUnavailableView`'s description or actions, or null for any other argument (Wave 4b). */
export function unavailablePart(arg: ViewArg): ViewValue | null {
  return arg.label === 'description' || arg.label === 'actions' ? asView(arg.value) : null
}

/**
 * What `Button { … } label: { … }` is drawn with (D16), and a Menu's, a Picker's or a
 * GroupBox's label and a Label's icon (Wave 3a). The host keeps them as the control's
 * arguments, since its content closure is the action or its content, so they are listed
 * here as the control's own layers: a view in a label is then found on the canvas and
 * in Layers like any other.
 */
function labelViews(view: ViewValue): ViewValue[] {
  if (view.name === 'ContentUnavailableView') return view.args.flatMap(arg => unavailablePart(arg) ?? [])
  return LAYERED_LABEL_VIEWS.has(view.name) ? view.args.flatMap(arg => labelArgView(arg) ?? []) : []
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
