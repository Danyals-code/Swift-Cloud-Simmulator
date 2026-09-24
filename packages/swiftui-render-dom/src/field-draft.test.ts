import { describe, expect, it } from 'vitest'
import { editField, fieldValue, NO_DRAFT, type FieldDraft, type FieldEdit } from './field-draft'

/** Applies edits in order, collecting what the field sends the app. */
function run(edits: readonly FieldEdit[], from: FieldDraft = NO_DRAFT) {
  let draft = from
  const sent: string[] = []
  for (const edit of edits) {
    const next = editField(draft, edit)
    draft = next.draft
    if (next.send !== undefined) sent.push(next.send)
  }
  return { draft, sent }
}

describe("a preview field's draft", () => {
  it('shows what was typed until every change is answered, whatever the app had drawn', () => {
    const { draft, sent } = run([{ kind: 'input', value: 'h' }, { kind: 'input', value: 'he' }, { kind: 'answered' }])
    expect(sent).toEqual(['h', 'he'])
    // The app has only answered "h" so far.
    expect(fieldValue(draft, 'h')).toBe('he')
  })

  it("shows the app's value once every change is answered, since the app may have changed it", () => {
    const { draft } = run([{ kind: 'input', value: 'h' }, { kind: 'input', value: 'he' }, { kind: 'answered' }, { kind: 'answered' }])
    // `.onChange` upper-cased it.
    expect(fieldValue(draft, 'HE')).toBe('HE')
  })

  it('sends what an input method is composing, as iOS does, but keeps it on screen until it is done', () => {
    const { draft, sent } = run([
      { kind: 'input', value: 'a' },
      { kind: 'compositionStart' },
      { kind: 'input', value: 'ak' },
      { kind: 'input', value: 'aか' },
      { kind: 'answered' },
      { kind: 'answered' },
      { kind: 'answered' },
    ])
    expect(sent).toEqual(['a', 'ak', 'aか'])
    // Every change is answered, but taking the app's value now would end the composition.
    expect(fieldValue(draft, 'aか')).toBe('aか')
    expect(draft.value).toBe('aか')
    const done = run([{ kind: 'compositionEnd', value: 'a漢' }, { kind: 'answered' }], draft)
    expect(done.sent).toEqual(['a漢'])
    expect(done.draft.value).toBeNull()
  })
})
