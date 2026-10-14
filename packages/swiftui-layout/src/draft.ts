import { withChildren, type Alignment, type Axis, type LayoutElement, type LayoutModifier } from './elements'

/**
 * A layout tree with a few of its elements changed: what a drag on the canvas shows
 * before anything is written. The caller says which modifier elements go, which new ones
 * wrap an element, and how a stack's spacing changes; nothing else in the tree is copied,
 * so a layout that keeps its measurements measures only what changed and what holds it.
 */
export type LayoutDraftEdit =
  /** The modifier element with this id taken out, keeping what it wraps. */
  | { readonly kind: 'unwrap'; readonly id: string }
  /** The element with this id wrapped in new modifiers, the first innermost. */
  | { readonly kind: 'wrap'; readonly id: string; readonly modifiers: readonly { readonly id: string; readonly modifier: LayoutModifier }[] }
  /** A stack's spacing, with its Spacers taken out when a number replaces the space they made. */
  | { readonly kind: 'spacing'; readonly id: string; readonly spacing: number; readonly withoutSpacers?: boolean }
  /**
   * A stack's children moved into a stack of their own, its only child, which edits can
   * then address by `into.id`: a Button label of several views grouped to take a size.
   */
  | { readonly kind: 'group'; readonly id: string; readonly into: { readonly id: string; readonly axis: Axis; readonly alignment: Alignment } }

export function applyLayoutDraft(root: LayoutElement, edits: readonly LayoutDraftEdit[]): LayoutElement {
  if (!edits.length) return root
  const byId = new Map<string, LayoutDraftEdit[]>()
  for (const edit of edits) byId.set(edit.id, [...byId.get(edit.id) ?? [], edit])
  const visit = (element: LayoutElement): LayoutElement => {
    let next = withChildren(element, visit)
    for (const edit of byId.get(element.id) ?? []) next = applyEdit(next, edit, byId)
    return next
  }
  return visit(root)
}

function applyEdit(element: LayoutElement, edit: LayoutDraftEdit, byId: ReadonlyMap<string, readonly LayoutDraftEdit[]>): LayoutElement {
  switch (edit.kind) {
    case 'unwrap': {
      if (element.kind !== 'modified') return element
      // The spacing a view asks for is carried on its outermost element, which this may be.
      const child = element.child
      return element.preferredSpacing && !child.preferredSpacing ? { ...child, preferredSpacing: element.preferredSpacing } : child
    }
    case 'wrap': {
      let wrapped = element
      for (const { id, modifier } of edit.modifiers) {
        wrapped = { kind: 'modified', id, modifier, child: wrapped }
        // A new element can be wrapped in turn, as a frame goes around a new padding.
        for (const inner of byId.get(id) ?? []) wrapped = applyEdit(wrapped, inner, byId)
      }
      return wrapped
    }
    case 'spacing':
      if (element.kind !== 'stack') return element
      return { ...element, spacing: edit.spacing, ...(edit.withoutSpacers ? { children: element.children.filter(child => child.kind !== 'spacer') } : {}) }
    case 'group': {
      if (element.kind !== 'stack') return element
      let group: LayoutElement = { kind: 'stack', id: edit.into.id, axis: edit.into.axis, spacing: null, alignment: edit.into.alignment, children: element.children }
      for (const inner of byId.get(edit.into.id) ?? []) group = applyEdit(group, inner, byId)
      return { ...element, children: [group] }
    }
  }
}
