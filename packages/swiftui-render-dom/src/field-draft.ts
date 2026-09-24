/**
 * A preview field's own copy of what the user is typing, kept while the app catches up.
 *
 * The app's value comes back from the worker a keystroke or more behind a fast typist.
 * A field drawing that value would put each new key on text the user has already
 * changed, and drop the rest; so the field shows its draft until every change it sent
 * has been answered, and then the app's value, which the app may have changed.
 */
export interface FieldDraft {
  /** What the user has typed, or null to show the app's value. */
  readonly value: string | null
  /** Changes sent to the app and not answered yet. */
  readonly unanswered: number
  /**
   * An input method is composing. What it has so far is sent, as iOS gives the
   * binding marked text too, but the app's value is not taken back until it is done:
   * setting the field's value would end the composition.
   */
  readonly composing: boolean
}

export const NO_DRAFT: FieldDraft = { value: null, unanswered: 0, composing: false }

export type FieldEdit =
  | { readonly kind: 'input'; readonly value: string }
  | { readonly kind: 'compositionStart' }
  | { readonly kind: 'compositionEnd'; readonly value: string }
  | { readonly kind: 'answered' }

/** The field's next draft, and the value to send the app when the edit sends one. */
export function editField(draft: FieldDraft, edit: FieldEdit): { draft: FieldDraft; send?: string } {
  switch (edit.kind) {
    case 'input':
      return { draft: { ...draft, value: edit.value, unanswered: draft.unanswered + 1 }, send: edit.value }
    case 'compositionStart':
      return { draft: { ...draft, composing: true } }
    case 'compositionEnd':
      return { draft: { value: edit.value, unanswered: draft.unanswered + 1, composing: false }, send: edit.value }
    case 'answered': {
      const unanswered = draft.unanswered - 1
      return { draft: unanswered > 0 || draft.composing ? { ...draft, unanswered } : NO_DRAFT }
    }
  }
}

/** What the field shows. */
export function fieldValue(draft: FieldDraft, appValue: string): string {
  return draft.value ?? appValue
}
