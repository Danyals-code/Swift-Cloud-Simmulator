/**
 * Why an edit cannot be planned just now, or null when it can (C7): the preview has not
 * caught up with the source yet, or the last change is still being applied. The studio
 * shows it and logs it, rather than dropping the edit without a word.
 */
export function busyEditProblem(state: { readonly current: boolean; readonly stale: boolean; readonly applying: boolean }): string | null {
  if (!state.current || state.stale) return 'The source is updating. Try again when the preview is ready.'
  if (state.applying) return 'Still applying the last change. Try again in a moment.'
  return null
}
