'use client'

import { SharedStyleProperties } from './SharedStyles'
import { useState } from 'react'
import type { AuthoringNode, AuthoringOperation, AuthoringSnapshot, ComponentDescription, BehaviorAction, DesignRecord, DesignValue, RecordField, PreviewInput } from '@studio/shared'
import { defaultRecord, RecordEditor } from './RecordEditor'
import { parseRecordDrafts } from '../lib/recordDrafts'
import styles from './AuthoringInspector.module.css'

export type FeatureChange = (operation: AuthoringOperation | { kind: 'insert'; snippet: string }) => Promise<string | null>
export interface FeatureProps {
  node: AuthoringNode
  assets?: readonly { readonly name: string; readonly id: string }[]
  snapshot?: AuthoringSnapshot
  onCommand?: FeatureChange
  onSelect?: (node: AuthoringNode) => void
  descriptions?: readonly ComponentDescription[]
  onDescribe?: (description: ComponentDescription) => string | null
  onPreview?: (name: string, inputs: readonly PreviewInput[]) => string | null
}
export function AuthoringFeatures({ node, snapshot, onCommand, onSelect, onPreview, onDescribe, descriptions, assets, section = 'basics' }: FeatureProps & { section?: 'basics' | 'data' | 'behavior' | 'styles' | 'advanced' }) {
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const [name, setName] = useState('CardView'), [collectionName, setCollectionName] = useState('items'), [recordType, setRecordType] = useState('ItemRecord')
  const [emptyText, setEmptyText] = useState('No items yet'), [field, setField] = useState(node.fields?.[0] ?? '')
  const [shared, setShared] = useState(false)
  const [records, setRecords] = useState<readonly DesignRecord[]>(node.collection?.records ?? [])
  const [newField, setNewField] = useState('price'), [fieldType, setFieldType] = useState<RecordField['type']>('Double'), [fieldDefault, setFieldDefault] = useState('0'), [optional, setOptional] = useState(false)
  const [recordScope, setRecordScope] = useState<'preview' | 'app'>('preview')
  const command = async (operation: Parameters<FeatureChange>[0]) => { if (!onCommand || busy) return; setBusy(true); try { setError(await onCommand(operation)) } finally { setBusy(false) } }
  if (!onCommand) return null
  const children = node.children.map(id => snapshot?.nodes.find(n => n.id === id)).filter((n): n is AuthoringNode => !!n)
  const template = children.find(n => n.kind === 'template')
  const callSites = snapshot?.nodes.filter(n => n.definitionId === node.id) ?? []
  return <div className={styles.features}>
    {section === 'basics' && node.name === 'Image' && node.properties.some(p => ['argument 1', 'systemName'].includes(p.name) && p.valueKind === 'literal') && !!assets?.length && <label>Bundled image<select aria-label="Bundled image" disabled={busy} value={node.properties.find(p => p.name === 'argument 1')?.expression.replace(/^"|"$/g, '') ?? ''} onChange={e => void command({ kind: 'asset-use', name: e.target.value })}><option value="" disabled>Choose image</option>{assets.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}</select></label>}
    {section === 'styles' && <SharedStyleProperties node={node} snapshot={snapshot} onCommand={command} busy={busy} />}
    {section === 'basics' && node.component && <section><h3>Component instance</h3><p>{node.component.descriptionStatus}. Changes to arguments affect this instance.</p>
      <button type="button" aria-expanded={shared} onClick={() => setShared(!shared)}>Edit main component…</button>
      {shared && <div><p>Definition edits affect {node.component.callSites.length} source call sites, including repeated rows:</p><ul>{node.component.callSites.map(s => <li key={`${s.file}:${s.start}`}>{s.file} · offset {s.start}</li>)}</ul><button type="button" onClick={() => { const definition = snapshot?.nodes.find(n => n.id === node.component!.definitionId); if (definition) onSelect?.(definition) }}>Enter main component</button></div>}
      {onDescribe && <ComponentDescriptionEditor node={node} descriptions={descriptions} onSave={onDescribe} />}
    </section>}
    {section === 'basics' && node.kind === 'definition' && <section><h3>Shared definition</h3><p>Changes here affect all {callSites.length} source call sites of {node.name}.</p><details><summary>Affected instances</summary><ul>{callSites.map(site => <li key={site.id}><button type="button" onClick={() => onSelect?.(site)}>{site.owner} · {site.source.file}</button></li>)}</ul></details></section>}
    {section === 'data' && (node.name === 'List' || node.kind === 'collection') && <section><h3>List content</h3>
      <p>{node.kind === 'collection' ? 'Collection · One template renders every record.' : 'Static · Each row keeps its own content and structure.'}</p>
      {template && <button type="button" onClick={() => onSelect?.(template)}>Edit row template · all rows</button>}
      {node.kind !== 'collection' && <><button type="button" disabled={busy} onClick={() => void command({ kind: 'insert', snippet: 'Text("New row")' })}>Add static row</button>
        <details><summary>Use a collection</summary><p>A single Text row can become a typed collection. Mixed rows remain static.</p><label>Collection name<input value={collectionName} onChange={e => setCollectionName(e.target.value)} /></label><label>Record type<input value={recordType} onChange={e => setRecordType(e.target.value)} /></label><button type="button" disabled={busy} onClick={() => void command({ kind: 'collection-convert', name: collectionName, recordType })}>Convert to collection</button></details></>}
      {node.collection ? <><p>{node.collection.recordType} · id identifies each record</p><label>Editing<select aria-label="Record edit scope" value={recordScope} onChange={e => setRecordScope(e.target.value as 'preview' | 'app')}><option value="preview">Preview records only</option><option value="app">App initial data (Swift)</option></select></label>
        <details><summary>Add record field</summary><label>Field name<input aria-label="New record field" value={newField} onChange={e => setNewField(e.target.value)} /></label><label>Field type<select aria-label="Record field type" value={fieldType} onChange={e => { setFieldType(e.target.value as RecordField['type']); setFieldDefault(e.target.value === 'Bool' ? 'false' : e.target.value === 'String' ? '' : '0') }}>{['String', 'Double', 'Int', 'Bool'].map(t => <option key={t}>{t}</option>)}</select></label><label><input type="checkbox" checked={optional} onChange={e => setOptional(e.target.checked)} />Optional, starts with no value</label>{!optional && <label>Default value{fieldType === 'Bool' ? <select aria-label="Field default" value={fieldDefault} onChange={e => setFieldDefault(e.target.value)}><option value="false">False</option><option value="true">True</option></select> : <input aria-label="Field default" value={fieldDefault} onChange={e => setFieldDefault(e.target.value)} />}</label>}<button type="button" disabled={busy} onClick={() => void command({ kind: 'collection-field', name: newField, type: fieldType, optional, value: optional ? null : fieldType === 'String' ? fieldDefault : fieldType === 'Bool' ? fieldDefault === 'true' : fieldDefault === '' ? null : Number(fieldDefault) })}>Add field to record type</button><p>Changes the app’s record type. A default preserves existing records and initializers.</p></details>
        <RecordEditor info={node.collection} value={records} onChange={setRecords} />
        <button type="button" disabled={busy} onClick={() => { const parsed = parseRecordDrafts(node.collection!, records); if (!parsed.ok) { setError(parsed.error); return }; if (recordScope === 'app') void command({ kind: 'records', records: parsed.records }); else setError(onPreview?.('Collection preview', [{ owner: node.collection!.owner, name: node.collection!.name, signature: node.collection!.signature, value: parsed.records }]) ?? null) }}>{recordScope === 'app' ? 'Apply app initial data' : 'Apply preview records'}</button>
        <label>Empty-state message<input aria-label="Empty-state message" value={emptyText} onChange={e => setEmptyText(e.target.value)} /></label><button type="button" disabled={busy} onClick={() => void command({ kind: 'empty-state', text: emptyText })}>Add empty-state branch</button>
      </> : node.kind === 'collection' && <p>Data comes from Swift. Typed local Identifiable records with literal initial data expose a record editor here.</p>}
    </section>}
    {section === 'basics' && node.kind === 'template' && <section><h3>Row design</h3><p>Select a child to edit the design used by every row.</p>{children.map(child => <button key={child.id} type="button" onClick={() => onSelect?.(child)}>{child.name}</button>)}<button type="button" disabled={busy} onClick={() => { const collection = snapshot?.nodes.find(n => n.id === node.parentId); if (collection) onSelect?.(collection) }}>List settings</button><button type="button" disabled={busy} onClick={() => void command({ kind: 'insert', snippet: 'Text("New element")' })}>Add element to row template</button><p>Added elements appear in every row.</p></section>}
    {section === 'data' && !!node.fields?.length && <section><h3>Connected field</h3><label>Field<select aria-label="Row field" value={field} onChange={e => setField(e.target.value)}>{node.fields.map(f => <option key={f}>{f}</option>)}</select></label><button type="button" disabled={busy} onClick={() => void command({ kind: 'bind-field', field })}>Bind to field · all rows</button></section>}
    {section === 'basics' && !!children.length && node.kind === 'definition' && <section><h3>Shared content</h3>{children.map(child => <button key={child.id} type="button" onClick={() => onSelect?.(child)}>{child.name}</button>)}</section>}
    {section === 'behavior' && node.behavior && (node.behavior.canConfigureAction || node.behavior.binding || node.behavior.states.length > 0) && <BehaviorEditor key={node.id} node={node} onCommand={command} busy={busy} />}
    {section === 'advanced' && ['view', 'component'].includes(node.kind) && node.name !== 'WindowGroup' && <details><summary>Extract reusable component</summary><label>Component name<input aria-label="New component name" value={name} onChange={e => setName(e.target.value)} /></label><p>Creates a Swift file and an instance here, in one undo step. Supported dependencies become explicit inputs.</p><button type="button" disabled={busy} onClick={() => void command({ kind: 'extract-component', name })}>Extract component</button></details>}
    {error && <p role="alert" className={styles.error}>{error}</p>}{busy && <p role="status">Preparing source changes…</p>}
  </div>
}

function BehaviorEditor({ node, onCommand, busy }: { node: AuthoringNode; onCommand: (op: Parameters<FeatureChange>[0]) => Promise<void>; busy: boolean }) {
  const info = node.behavior!
  const [recordError, setRecordError] = useState<string | null>(null)
  const [kind, setKind] = useState<BehaviorAction['type']>('toggle'), [state, setState] = useState(info.states[0]?.name ?? '')
  const [destination, setDestination] = useState(info.destinations[0] ?? ''), [actionName, setActionName] = useState(info.actions[0] ?? '')
  const [value, setValue] = useState(''), [replace, setReplace] = useState(false), [newState, setNewState] = useState('value')
  const [collectionName, setCollectionName] = useState(info.collections[0]?.name ?? ''), [item, setItem] = useState<readonly DesignRecord[]>([])
  const [deleteId, setDeleteId] = useState('')
  const [transition, setTransition] = useState<'opacity' | 'slide' | 'scale'>('opacity'), [duration, setDuration] = useState('0.25')
  const selected = info.states.find(s => s.name === state), collection = info.collections.find(c => c.name === collectionName)
  const parse = (type: string): DesignValue => type === 'Bool' ? value === 'true' : ['Int', 'Double'].includes(type) ? (value === '' ? null : Number(value)) : value
  const configure = () => {
    let action: BehaviorAction
    if (kind === 'toggle' || kind === 'dismiss') action = { type: kind, state }
    else if (kind === 'set') action = { type: 'set', state, value: parse(selected?.type ?? 'String') }
    else if (kind === 'navigate' || kind === 'sheet') action = { type: kind, destination }
    else if (kind === 'call') action = { type: kind, name: actionName }
    else if (kind === 'append') {
      if (!collection) { setRecordError('Choose a collection first.'); return }
      const parsed = parseRecordDrafts(collection, [item[0] ?? defaultRecord(collection, collection.records)])
      if (!parsed.ok) { setRecordError(parsed.error); return }
      action = { type: kind, collection: collectionName, record: parsed.records[0]! }
    }
    else action = { type: 'delete', collection: collectionName, id: collection?.records.find(r => String(r.id) === deleteId)?.id ?? deleteId }
    setRecordError(null)
    void onCommand({ kind: 'behavior', action, replace })
  }
  const stateSelect = <label>Local state<select aria-label="Behavior state" value={state} onChange={e => setState(e.target.value)}><option value="" disabled>Select state</option>{info.states.map(s => <option key={s.name} value={s.name}>{s.name} · {s.type}</option>)}</select></label>
  return <section><h3>Interactions</h3>
    {info.binding && <><p>Binding: <code>{info.binding.current}</code> · {info.binding.type}</p><label>Bind to existing state<select aria-label="Bind to state" value="" onChange={e => void onCommand({ kind: 'bind-state', name: e.target.value })}><option value="" disabled>Select state</option>{info.states.filter(s => !s.optional && s.type === info.binding!.type).map(s => <option key={s.name}>{s.name}</option>)}</select></label><details><summary>Create interactive state</summary><label>Name<input aria-label="New state name" value={newState} onChange={e => setNewState(e.target.value)} /></label><label>Initial value{info.binding.type === 'Bool' ? <select aria-label="State initial value" value={value || 'false'} onChange={e => setValue(e.target.value)}><option value="false">False</option><option value="true">True</option></select> : <input aria-label="State initial value" value={value} onChange={e => setValue(e.target.value)} />}</label><button type="button" disabled={busy} onClick={() => void onCommand({ kind: 'bind-state', name: newState, create: { value: parse(info.binding!.type) } })}>Create state and bind</button></details></>}
    {info.canConfigureAction && <><details><summary>Current action source</summary><pre>{info.currentAction}</pre></details><label>Action<select aria-label="Action type" value={kind} onChange={e => setKind(e.target.value as BehaviorAction['type'])}><option value="toggle">Toggle state</option><option value="set">Set / select a value</option><option value="call">Call developer action</option><option value="navigate">Navigate to screen</option><option value="sheet">Present sheet</option><option value="dismiss">Dismiss sheet</option><option value="append">Add local item</option><option value="delete">Delete local item</option></select></label>
      {['toggle', 'set'].includes(kind) && stateSelect}
      {kind === 'dismiss' && <label>Dismissal<select aria-label="Dismissal target" value={state} onChange={e => setState(e.target.value)}><option value="">Current presentation</option>{info.states.filter(s => !s.optional && s.type === 'Bool').map(s => <option key={s.name}>{s.name}</option>)}</select></label>}
      {kind === 'set' && <label>Value{selected?.options || selected?.type === 'Bool' ? <select aria-label="Action value" value={value} onChange={e => setValue(e.target.value)}><option value="" disabled>Select value</option>{(selected?.options ?? ['true', 'false']).map(o => <option key={o}>{o}</option>)}</select> : <input aria-label="Action value" value={value} onChange={e => setValue(e.target.value)} />}</label>}
      {['navigate', 'sheet'].includes(kind) && <label>Destination<select aria-label="Action destination" value={destination} onChange={e => setDestination(e.target.value)}><option value="" disabled>Select screen</option>{info.destinations.map(d => <option key={d}>{d}</option>)}</select></label>}
      {kind === 'call' && <label>Developer action<select aria-label="Developer action" value={actionName} onChange={e => setActionName(e.target.value)}><option value="" disabled>Select action</option>{info.actions.map(a => <option key={a}>{a}</option>)}</select></label>}
      {['append', 'delete'].includes(kind) && <><label>Local collection<select aria-label="Action collection" value={collectionName} onChange={e => { setCollectionName(e.target.value); setItem([]) }}><option value="" disabled>Select collection</option>{info.collections.filter(c => c.mutable).map(c => <option key={c.name}>{c.name}</option>)}</select></label>{collection && (kind === 'append' ? <RecordEditor info={collection} value={item.length ? item : [defaultRecord(collection, collection.records)]} onChange={setItem} /> : <label>Item to delete<select aria-label="Delete item id" value={deleteId} onChange={e => setDeleteId(e.target.value)}><option value="" disabled>Select id</option>{collection.records.map(r => <option key={String(r.id)}>{String(r.id)}</option>)}</select></label>)}</>}
      <label><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />Replace the displayed action</label><button type="button" disabled={busy} onClick={configure}>Apply action</button>{recordError && <p role="alert" className={styles.error}>{recordError}</p>}
    </>}
    {!!info.states.length && <details><summary>Transition</summary>{stateSelect}<label>Style<select value={transition} onChange={e => setTransition(e.target.value as typeof transition)}><option>opacity</option><option>slide</option><option>scale</option></select></label><label>Duration in seconds<input value={duration} onChange={e => setDuration(e.target.value)} /></label><button type="button" disabled={busy} onClick={() => void onCommand({ kind: 'transition', state, style: transition, duration: Number(duration) })}>Add transition</button></details>}
  </section>
}

function ComponentDescriptionEditor({ node, descriptions, onSave }: { node: AuthoringNode; descriptions?: readonly ComponentDescription[]; onSave: (description: ComponentDescription) => string | null }) {
  const [name, setName] = useState(node.component!.propertyNames[0] ?? ''), [label, setLabel] = useState(''), [description, setDescription] = useState(''), [minimum, setMinimum] = useState(''), [maximum, setMaximum] = useState(''), [group, setGroup] = useState(''), [error, setError] = useState<string | null>(null)
  const current = descriptions?.find(d => d.owner === node.name && d.signature === node.component!.signature)
  return <details><summary>Describe component properties</summary><p>Labels and constraints apply to this Swift interface. Code changes invalidate outdated descriptions.</p>
    <label>Property<select aria-label="Described property" value={name} onChange={e => { setName(e.target.value); const p = current?.properties.find(p => p.name === e.target.value); setLabel(p?.label ?? ''); setDescription(p?.description ?? ''); setMinimum(p?.min === undefined ? '' : String(p.min)); setMaximum(p?.max === undefined ? '' : String(p.max)); setGroup(p?.group ?? '') }}>{node.component!.propertyNames.map(n => <option key={n}>{n}</option>)}</select></label>
    <label>Friendly label<input aria-label="Property label" value={label} onChange={e => setLabel(e.target.value)} /></label><label>Description<input aria-label="Property description" value={description} onChange={e => setDescription(e.target.value)} /></label><label>Group<input value={group} onChange={e => setGroup(e.target.value)} /></label>
    <label>Minimum (numbers only)<input value={minimum} onChange={e => setMinimum(e.target.value)} /></label><label>Maximum (numbers only)<input value={maximum} onChange={e => setMaximum(e.target.value)} /></label>
    <button type="button" onClick={() => {
      const min = minimum === '' ? undefined : Number(minimum), max = maximum === '' ? undefined : Number(maximum)
      if (min !== undefined && !Number.isFinite(min) || max !== undefined && !Number.isFinite(max) || min !== undefined && max !== undefined && min > max) { setError('Enter valid minimum and maximum values.'); return }
      setError(onSave({ owner: node.name, signature: node.component!.signature, properties: [...(current?.properties ?? []).filter(p => p.name !== name), { name, label: label || name, description, min, max, group }] }))
    }}>Save property description</button>{error && <p role="alert">{error}</p>}
  </details>
}
