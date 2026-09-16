import { CENTER, type EdgeInsets, type LayoutElement, type ScrollElement } from '@studio/swiftui-layout'

/** Only a screen's primary scroller drives its chrome; nested scrollers stay independent. */
export function primaryScroll(element: LayoutElement): ScrollElement | null {
  if (element.kind === 'scroll') return element.axis === 'vertical' ? element : null
  if (element.kind === 'modified') return primaryScroll(element.child)
  if (element.kind === 'stack' && element.children.length === 1) return primaryScroll(element.children[0]!)
  return null
}

export function mapPrimaryScroll(element: LayoutElement, change: (scroll: ScrollElement) => LayoutElement): LayoutElement {
  if (element.kind === 'scroll' && element.axis === 'vertical') return change(element)
  if (element.kind === 'modified') return { ...element, child: mapPrimaryScroll(element.child, change) }
  if (element.kind === 'stack' && element.children.length === 1) return { ...element, children: [mapPrimaryScroll(element.children[0]!, change)] }
  return element
}

export function scrollInsets(element: LayoutElement, contentInsets: EdgeInsets): LayoutElement {
  return mapPrimaryScroll(element, scroll => ({ ...scroll, contentInsets,
    content: { kind: 'modified', id: `${scroll.id}/safe-content`, modifier: { kind: 'padding', insets: contentInsets }, child: scroll.content },
  }))
}

export function prependSearch(element: LayoutElement, search: LayoutElement): LayoutElement {
  const stack = (content: LayoutElement): LayoutElement => ({ kind: 'stack', id: 'root-search', axis: 'vertical', spacing: 0, alignment: CENTER, children: [search, content] })
  return primaryScroll(element) ? mapPrimaryScroll(element, scroll => ({ ...scroll, content: stack(scroll.content) })) : stack(element)
}
