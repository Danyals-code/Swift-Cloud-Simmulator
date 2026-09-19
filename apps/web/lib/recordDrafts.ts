import type { CollectionSettings, DesignRecord } from '@studio/shared'

/** Numeric fields keep their text while typing; only Apply creates typed records. */
export function parseRecordDrafts(info: Pick<CollectionSettings, 'fields'>, drafts: readonly DesignRecord[]): { ok: true; records: readonly DesignRecord[] } | { ok: false; error: string } {
  const records: DesignRecord[] = []
  for (const [index, draft] of drafts.entries()) {
    const record = { ...draft }
    for (const field of info.fields) {
      if (field.type !== 'Int' && field.type !== 'Double') continue
      const value = draft[field.name]
      if (value === null && field.optional) continue
      const text = typeof value === 'string' ? value.trim() : ''
      const number = typeof value === 'number' ? value : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) ? Number(text) : NaN
      if (!Number.isFinite(number) || field.type === 'Int' && !Number.isSafeInteger(number)) {
        return { ok: false, error: `Record ${index + 1}, ${field.name}: enter ${field.type === 'Int' ? 'a whole number within the supported range' : 'a finite number'}.` }
      }
      record[field.name] = number
    }
    records.push(record)
  }
  return { ok: true, records }
}
