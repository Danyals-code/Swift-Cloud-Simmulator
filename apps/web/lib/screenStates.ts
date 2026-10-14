import type { PreviewInput, PreviewScenario, StateInput, SuggestedState } from '@studio/shared'

/**
 * What a state sets, in a few words: `model.isLoading: true`, `model.articles: No items`,
 * `items: 2 items`. A picked value reads as its choice, as the panel offers it.
 */
export function describeState(inputs: readonly PreviewInput[] | undefined, known: readonly StateInput[]): string {
  return (inputs ?? []).map(item => {
    if (Array.isArray(item.value)) return `${item.name}: ${item.value.length} items`
    const choice = known.find(input => input.owner === item.owner && input.name === item.name)?.choices?.find(c => c.value === item.value)
    return `${item.name}: ${choice ? choice.label : item.value === null ? 'none' : String(item.value)}`
  }).join(', ')
}

/** A state the screen's code draws but the preview can't show, or a condition it can't set, and why. */
export interface RefusedState { readonly name: string; readonly problem: string }

/**
 * The states a screen's conditions draw that are not saved yet, in the order its values
 * are read, and those the preview can't show, with why (Wave 3b). A state saved under the
 * same name is taken to be that state, so it is not offered twice.
 */
export function stateSuggestions(inputs: readonly StateInput[], saved: readonly PreviewScenario[]): { readonly offered: readonly SuggestedState[]; readonly refused: readonly RefusedState[] } {
  const taken = new Set(saved.map(scenario => scenario.name.trim().toLowerCase()))
  const offered: SuggestedState[] = [], refused: RefusedState[] = []
  for (const input of inputs) {
    if (input.problem) { refused.push({ name: input.name, problem: input.problem }); continue }
    for (const state of input.states ?? []) {
      if (taken.has(state.name.toLowerCase())) continue
      if (state.problem) refused.push({ name: state.name, problem: state.problem })
      else offered.push(state)
    }
  }
  return { offered, refused }
}
