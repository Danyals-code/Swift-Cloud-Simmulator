import type { PreviewInput, PreviewScenario, StateInput, SuggestedState, ViewVisibility } from '@studio/shared'

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

/** What Show it does (Wave 5a): select a saved state, or Default as null; save one; or say why it can't. */
export type ShowIt = { readonly select: PreviewScenario | null } | { readonly save: { readonly name: string; readonly inputs: readonly PreviewInput[] } } | { readonly problem: string }

/** Whether `values` set `input` as it is: the same value of the same screen. */
const sets = (values: readonly { owner: string; name: string; value: unknown }[] | undefined, input: PreviewInput) => !!values?.some(item => item.owner === input.owner && item.name === input.name && JSON.stringify(item.value) === JSON.stringify(input.value))

/**
 * The state that draws a view hidden in this one (Wave 5a), from the values that show it
 * (`visibility.shows`), in the screen's `saved` states and `inputs`: a saved state that sets
 * them all, Default when the screen starts with them and a state hides it, or else a state to
 * save, named as the suggestion with the same values is, never over a saved one's name.
 */
export function stateShowing(visibility: Pick<ViewVisibility, 'shows' | 'label'>, saved: readonly PreviewScenario[], active: PreviewScenario | undefined, inputs: readonly StateInput[]): ShowIt {
  const shows = visibility.shows
  if (!shows?.length) return { problem: 'The preview can’t set what shows this view. Open it in Code to see its condition.' }
  const current = active && saved.includes(active) ? active : undefined
  const found = saved.find(state => state !== current && shows.every(input => sets(state.inputs, input)))
  if (found) return { select: found }
  if (current && shows.every(input => sets(inputs, input))) return { select: null }
  const suggested = inputs.flatMap(input => input.states ?? []).find(state => state.inputs.length === shows.length && shows.every(input => sets(state.inputs, input)))
  const base = suggested?.name ?? (visibility.label ? visibility.label.charAt(0).toUpperCase() + visibility.label.slice(1) : 'Shown')
  const taken = new Set(saved.map(state => state.name.trim().toLowerCase()))
  let name = base
  for (let count = 2; taken.has(name.toLowerCase()); count++) name = `${base} ${count}`
  return { save: { name, inputs: shows } }
}
