import { unwrapProblem, wrapProblem, CONTAINER_LAYOUTS, CONTAINER_WORDS, type AuthoringNode, type ContainerLayout } from '@studio/shared'

/** One of a layer's container actions: what it is, as the Layers menu names it, and why it is off, or null. */
export interface ContainerAction { readonly value: ContainerLayout | 'unwrap'; readonly label: string; readonly reason: string | null }

/**
 * A layer's Group in actions, for the layers `ids` selected with it, and its Unwrap (Wave 4c),
 * each with the reason the planner would refuse it, by the planner's own check, so the menu
 * turns off what the planner won't do and says why in full.
 */
export function containerActions(nodes: readonly AuthoringNode[], node: AuthoringNode, ids: readonly string[]): ContainerAction[] {
  return [
    ...CONTAINER_LAYOUTS.map(layout => ({ value: layout, label: `Group in ${CONTAINER_WORDS[layout]}`, reason: wrapProblem(nodes, ids, layout) })),
    { value: 'unwrap', label: 'Unwrap', reason: unwrapProblem(nodes, node) },
  ]
}
