import { expect, it } from 'vitest'
import { parseRecordDrafts } from './recordDrafts'
import type { RecordField } from '@studio/shared'

const fields: RecordField[] = [
  { name: 'id', type: 'String', optional: false },
  { name: 'price', type: 'Double', optional: false },
  { name: 'count', type: 'Int', optional: false },
  { name: 'discount', type: 'Double', optional: true },
]
it('converts numeric drafts only at Apply, preserving strings, optional absence and input records', () => {
  const drafts = [{ id: '001', price: '-1.25', count: '12', discount: null }]
  expect(parseRecordDrafts({ fields }, drafts)).toEqual({ ok: true, records: [{ id: '001', price: -1.25, count: 12, discount: null }] })
  expect(drafts[0]!.price).toBe('-1.25')
})
it.each(['', '-', '.', 'NaN', 'Infinity', '1e999', '0x10', '4 + 2'])('refuses incomplete or invalid number %j without changing records', price => {
  const records = [{ id: 'one', price, count: 1, discount: null }]
  expect(parseRecordDrafts({ fields }, records)).toMatchObject({ ok: false, error: 'Record 1, price: enter a finite number.' })
  expect(records[0]!.price).toBe(price)
})
it.each(['1.', '.5', '-0.5', '2e2', '0'])('accepts a complete numeric draft %j', price => {
  expect(parseRecordDrafts({ fields }, [{ id: 'one', price, count: 1, discount: null }])).toMatchObject({ ok: true, records: [{ price: Number(price) }] })
})
it('rejects a fraction or unsafe integer for a whole-number field', () => {
  for (const count of ['1.5', '9007199254740992']) expect(parseRecordDrafts({ fields }, [{ id: 'one', price: 1, count, discount: null }])).toMatchObject({ ok: false })
})
it('requires an explicit optional absence and never interprets an empty draft as null', () => {
  expect(parseRecordDrafts({ fields }, [{ id: 'one', price: null, count: 1, discount: null }])).toMatchObject({ ok: false })
  expect(parseRecordDrafts({ fields }, [{ id: 'one', price: 1, count: 1, discount: '' }])).toMatchObject({ ok: false })
})
