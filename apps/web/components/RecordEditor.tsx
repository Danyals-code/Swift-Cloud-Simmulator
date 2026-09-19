'use client'

import { useState } from 'react'
import type { CollectionSettings, DesignRecord, DesignValue } from '@studio/shared'
import styles from './AuthoringInspector.module.css'

export function defaultRecord(info: Pick<CollectionSettings, 'fields'>, records: readonly DesignRecord[]): DesignRecord {
  const record: Record<string, DesignValue> = {}
  for (const field of info.fields) record[field.name] = field.defaultValue !== undefined ? field.defaultValue : field.optional ? null : field.type === 'String' ? '' : field.type === 'Bool' ? false : 0
  const id = info.fields.find(f => f.name === 'id')!
  let index = 1
  while (records.some(r => id.type === 'String' ? r.id === `item-${index}` : r.id !== null && String(r.id).trim() !== '' && Number(r.id) === index)) index++
  record.id = id.type === 'String' ? `item-${index}` : index
  return record
}

/** A paged record form keeps a hundred sample rows out of both Layers and the inspector. */
export function RecordEditor({ info, value, onChange }: { info: Pick<CollectionSettings, 'fields'>; value: readonly DesignRecord[]; onChange: (value: readonly DesignRecord[]) => void }) {
  const [selected, setSelected] = useState(0)
  const index = Math.min(selected, Math.max(0, value.length - 1)), record = value[index]
  const update = (name: string, value_: DesignValue) => onChange(value.map((r, i) => i === index ? { ...r, [name]: value_ } : r))
  const move = (direction: number) => {
    const next = index + direction
    if (next < 0 || next >= value.length) return
    const records = [...value]; [records[index], records[next]] = [records[next]!, records[index]!]; onChange(records); setSelected(next)
  }
  return <div className={styles.controls} data-testid="record-editor">
    <div className={styles.control}><label>Record<select aria-label="Selected record" value={record ? index : ''} onChange={e => setSelected(Number(e.target.value))}>{!record && <option value="">Empty collection</option>}{value.map((r, i) => <option key={i} value={i}>{i + 1}. {String(Object.entries(r).find(([key, value]) => key !== 'id' && typeof value === 'string' && value.trim())?.[1] ?? r.id)}</option>)}</select></label></div>
    {record && info.fields.map(field => <div key={field.name} className={styles.control}><label>{field.name}{field.type === 'Bool' ? <select aria-label={`Record ${field.name}`} disabled={field.optional && record[field.name] === null} value={String(record[field.name] ?? false)} onChange={e => update(field.name, e.target.value === 'true')}><option value="false">False</option><option value="true">True</option></select> : <input aria-label={`Record ${field.name}`} type="text" inputMode={['Int', 'Double'].includes(field.type) ? 'decimal' : 'text'} disabled={field.optional && record[field.name] === null} value={String(record[field.name] ?? '')} onChange={e => update(field.name, e.target.value)} />}</label>
      {field.optional && <label><input type="checkbox" checked={record[field.name] === null} onChange={e => update(field.name, e.target.checked ? null : field.type === 'String' ? '' : field.type === 'Bool' ? false : 0)} />No value</label>}
      <small>{field.type}{field.optional ? ' · optional' : ''}{field.name === 'id' ? ' · stable, unique identity' : ''}</small></div>)}
    <div className={styles.actions}><button type="button" disabled={value.length >= 1000} onClick={() => { onChange([...value, defaultRecord(info, value)]); setSelected(value.length) }}>Add record</button><button type="button" disabled={!record || value.length >= 1000} onClick={() => { const duplicate = { ...record, id: defaultRecord(info, value).id! }; onChange([...value.slice(0, index + 1), duplicate, ...value.slice(index + 1)]); setSelected(index + 1) }}>Duplicate record</button><button type="button" disabled={!record} onClick={() => onChange(value.filter((_, i) => i !== index))}>Delete record</button><button type="button" disabled={!record || index === 0} onClick={() => move(-1)}>Move up</button><button type="button" disabled={!record || index === value.length - 1} onClick={() => move(1)}>Move down</button></div>
  </div>
}
