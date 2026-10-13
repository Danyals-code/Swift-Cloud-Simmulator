import type { AuthoringNode, CopiedView, DesignEditRequest } from '@studio/shared'

/**
 * The paste ⌘V makes with `selected` selected, or with nothing selected into the
 * screen Add would fill (D6).
 *
 * Right after the selection, as Keynote and Figma put a copy: a container with views
 * in it takes it beside itself rather than as its last child. An empty one takes it,
 * and so does a screen's own stack, where beside it there is nothing to sit in, and a
 * repeated row's, where beside it would be another row for every item.
 */
export function pasteEdit(nodes: readonly AuthoringNode[], selected: AuthoringNode | undefined, copied: CopiedView): DesignEditRequest['operation'] {
  const paste = { kind: 'paste' as const, snippet: copied.snippet, values: copied.values }
  if (!selected || !nodes.some(node => node.parentId === selected.id && !node.argument)) return paste
  const parent = nodes.find(node => node.id === selected.parentId)
  return !parent || parent.kind === 'definition' || parent.kind === 'template' ? paste : { ...paste, beside: true }
}
