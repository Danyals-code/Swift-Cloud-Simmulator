'use client'

import { SymbolPicker } from './SymbolPicker'
import { GuidedInteraction } from './GuidedInteraction'
import { useState } from 'react'
import type { AuthoringNode, AuthoringOperation, AuthoringSnapshot, ComponentDescription, ComponentVariant, BehaviorAction, DesignRecord, DesignValue, RecordField, PreviewInput, NavigationDestination } from '@studio/shared'
import { defaultRecord, RecordEditor } from './RecordEditor'
import { parseRecordDrafts } from '../lib/recordDrafts'
import { newValueDefaults } from '../lib/newValue'
import { repeatsOverRange, settingsVisualChildren } from '../lib/authoringSettings'
import { sourceLayerLabel } from '../lib/sourceLayers'
import styles from './AuthoringInspector.module.css'
import { ComponentVariants } from './ComponentVariants'
import { MakeComponent, type CopySearch } from './MakeComponent'

export type FeatureChange = (operation: AuthoringOperation | { kind: 'insert'; snippet: string }) => Promise<string | null>
export interface FeatureProps {
  node: AuthoringNode
  assets?: readonly { readonly name: string; readonly id: string }[]
  snapshot?: AuthoringSnapshot
  onCommand?: FeatureChange
  onNodeCommand?: (node: AuthoringNode, operation: Parameters<FeatureChange>[0]) => Promise<string | null>
  onPickNavigation?: (destinations: readonly NavigationDestination[]) => Promise<string | null>
  onNodeChange?: (node: AuthoringNode, control: string, value: string) => Promise<string | null>
  onSelect?: (node: AuthoringNode) => void
  variants?: readonly ComponentVariant[]
  onSaveVariant?: (variant: ComponentVariant) => string | null
  onDeleteVariant?: (owner: string, name: string) => string | null
  previewInputs?: readonly PreviewInput[]
  descriptions?: readonly ComponentDescription[]
  onDescribe?: (description: ComponentDescription) => string | null
  onPreview?: (name: string, inputs: readonly PreviewInput[]) => string | null
  /** Looks for views shaped like this one, for Make component. */
  onFindCopies?: (node: AuthoringNode) => Promise<CopySearch>
  /** The views that are screens, so copies inside components are left alone. */
  screens?: readonly string[]
  /** True once the same view has been pasted a third time. */
  pasteNudge?: boolean
  onDismissNudge?: () => void
}
export function AuthoringFeatures({ node, snapshot, onCommand, onNodeChange, onSelect, onPreview, onDescribe, onFindCopies, screens = [], pasteNudge, onDismissNudge, descriptions, variants, onSaveVariant, onDeleteVariant, previewInputs, assets, section = 'basics' }: FeatureProps & { section?: 'basics' | 'interaction' | 'field' | 'data' | 'advanced' }) {
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const [name, setName] = useState('CardView'), [collectionName, setCollectionName] = useState('items'), [recordType, setRecordType] = useState('ItemRecord')
  const [emptyText, setEmptyText] = useState('No items yet'), [field, setField] = useState(node.fields?.[0] ?? '')
  const [shared, setShared] = useState(false)
  const [inputName, setInputName] = useState('label')
  const [records, setRecords] = useState<readonly DesignRecord[]>(() => { const preview = previewInputs?.find(i => i.owner === node.collection?.owner && i.name === node.collection?.name && i.signature === node.collection?.signature)?.value; return Array.isArray(preview) ? preview as readonly DesignRecord[] : node.collection?.records ?? [] })
  const [newField, setNewField] = useState('price'), [fieldType, setFieldType] = useState<RecordField['type']>('Double'), [fieldDefault, setFieldDefault] = useState('0'), [optional, setOptional] = useState(false)
  const [recordScope, setRecordScope] = useState<'preview' | 'app'>('preview')
  const command = async (operation: Parameters<FeatureChange>[0]) => { if (!onCommand || busy) return; setBusy(true); try { setError(await onCommand(operation)) } finally { setBusy(false) } }
  if (!onCommand) return null
  const children = node.children.map(id => snapshot?.nodes.find(n => n.id === id)).filter((n): n is AuthoringNode => !!n)
  const template = children.find(n => n.kind === 'template')
  const visualChildren = settingsVisualChildren(snapshot, node)
  const callSites = snapshot?.nodes.filter(n => n.definitionId === node.id) ?? []
  const reusableOwner = snapshot?.nodes.some(n => n.kind === 'component' && n.name === node.owner && snapshot.nodes.find(parent => parent.id === n.parentId)?.name !== 'WindowGroup')
  const textInput = node.controls?.find(c => ['content', 'title'].includes(c.id) && c.kind === 'text')
  // Text rows written alike, or the library's Repeat over a range, become records (D13).
  const collectionForm = <details><summary>Use a collection</summary><p>Text rows written alike, or a Repeat over a range, can become a typed collection: one record for each row. Rows that differ stay static.</p><label>Collection name<input value={collectionName} onChange={e => setCollectionName(e.target.value)} /></label><label>Record type<input value={recordType} onChange={e => setRecordType(e.target.value)} /></label><button type="button" disabled={busy} onClick={() => void command({ kind: 'collection-convert', name: collectionName, recordType })}>Convert to collection</button></details>
  return <div className={styles.features}>
    {section === 'basics' && node.kind === 'view' && node.name === 'GroupBox' && <section aria-label="Card layout">
      <h3>Card layout</h3>
      <p>The standard card includes 16 pt of inner padding. Customize it to align the title and content together.</p>
      <button type="button" disabled={busy} onClick={() => void command({ kind: 'card-customize' })}>Customize card layout</button>
      <p>Creates a left-aligned Column with editable title, content, spacing and padding. Undo restores the original card.</p>
    </section>}
    {section === 'basics' && node.controls?.some(c => c.id === 'image' && c.label === 'System symbol') && onNodeChange && <SymbolPicker selected={node.controls.find(c => c.id === 'image')?.value ?? ''} onChoose={value => onNodeChange(node, 'image', value)} />}

    {section === 'basics' && node.name === 'Image' && node.properties.some(p => ['argument 1', 'systemName'].includes(p.name) && p.valueKind === 'literal') && !!assets?.length && <label>Bundled image<select aria-label="Bundled image" disabled={busy} value={node.properties.find(p => p.name === 'argument 1')?.expression.replace(/^"|"$/g, '') ?? ''} onChange={e => void command({ kind: 'asset-use', name: e.target.value })}><option value="" disabled>Choose image</option>{assets.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}</select></label>}
    {section === 'basics' && node.component && <section><h3>Copy of {node.name}</h3><p>The fields above change only this copy. Everything else comes from its Main.</p>
      <button type="button" aria-expanded={shared} onClick={() => setShared(!shared)}>Edit the Main…</button>
      {shared && <div><p>Editing the Main changes all {node.component.callSites.length} copies, including repeated rows:</p><ul>{snapshot?.nodes.filter(n => n.definitionId === node.component!.definitionId).map((site, index) => <li key={site.id}><button type="button" onClick={() => onSelect?.(site)}>{site.owner} · copy {index + 1}</button></li>)}</ul><button type="button" onClick={() => { const definition = snapshot?.nodes.find(n => n.id === node.component!.definitionId); if (definition) onSelect?.(definition); else setError('The Main for this copy is not in the project any more. Open it in Code.') }}>Open the Main</button></div>}
    </section>}
    {section === 'advanced' && node.component && <section><h3>Saved inputs</h3>
      {onSaveVariant && onDeleteVariant && <ComponentVariants node={node} variants={variants ?? []} onSave={onSaveVariant} onDelete={onDeleteVariant} onApply={variant => command({ kind: 'component-variant', variant })} busy={busy} />}
      {onDescribe && <ComponentDescriptionEditor node={node} descriptions={descriptions} onSave={onDescribe} />}
    </section>}
    {section === 'basics' && reusableOwner && textInput && <details><summary>Changeable per copy</summary><p>Let each copy set its own text. Copies that exist now keep “{textInput.value}”.</p><label>Field name<input aria-label="Component input name" value={inputName} onChange={e => setInputName(e.target.value)} /></label><button type="button" disabled={busy} onClick={() => void command({ kind: 'component-expose', control: textInput.id, name: inputName })}>Make text changeable per copy</button></details>}
    {section === 'basics' && node.kind === 'definition' && <section><h3>The Main</h3><p>Changes here reach all {callSites.length} copies of {node.name}.</p><details><summary>Copies</summary><ul>{callSites.map(site => <li key={site.id}><button type="button" onClick={() => onSelect?.(site)}>{site.owner} · {site.source.file}</button></li>)}</ul></details></section>}
    {section === 'data' && (node.name === 'List' || node.kind === 'collection') && <section><h3>List content</h3>
      <p>{node.kind === 'collection' ? 'Repeat for each item · one design is used by every row.' : 'Each row has its own content and structure.'}</p>
      {template && <button type="button" onClick={() => onSelect?.(template)}>Edit row design</button>}
      {node.kind !== 'collection' && <><button type="button" disabled={busy} onClick={() => void command({ kind: 'insert', snippet: 'Text("New row")' })}>Add static row</button>
        {collectionForm}</>}
      {node.collection ? <><p>Content edits affect one selected item. “Edit row design” changes the appearance of every item.</p><label>Editing<select aria-label="Record edit scope" value={recordScope} onChange={e => setRecordScope(e.target.value as 'preview' | 'app')}><option value="preview">Preview records only</option><option value="app">App starting content</option></select></label>
        <details><summary>Add record field</summary><label>Field name<input aria-label="New record field" value={newField} onChange={e => setNewField(e.target.value)} /></label><label>Field type<select aria-label="Record field type" value={fieldType} onChange={e => { setFieldType(e.target.value as RecordField['type']); setFieldDefault(e.target.value === 'Bool' ? 'false' : e.target.value === 'String' ? '' : '0') }}>{['String', 'Double', 'Int', 'Bool'].map(t => <option key={t}>{t}</option>)}</select></label><label><input type="checkbox" checked={optional} onChange={e => setOptional(e.target.checked)} />Optional, starts with no value</label>{!optional && <label>Default value{fieldType === 'Bool' ? <select aria-label="Field default" value={fieldDefault} onChange={e => setFieldDefault(e.target.value)}><option value="false">False</option><option value="true">True</option></select> : <input aria-label="Field default" value={fieldDefault} onChange={e => setFieldDefault(e.target.value)} />}</label>}<button type="button" disabled={busy} onClick={() => void command({ kind: 'collection-field', name: newField, type: fieldType, optional, value: optional ? null : fieldType === 'String' ? fieldDefault : fieldType === 'Bool' ? fieldDefault === 'true' : fieldDefault === '' ? null : Number(fieldDefault) })}>Add field to record type</button><p>Changes the app’s record type. A default preserves existing records and initializers.</p></details>
        <div className={styles.actions}><button type="button" disabled={busy || !onPreview} onClick={() => setError(onPreview?.('Collection preview', [{ owner: node.collection!.owner, name: node.collection!.name, signature: node.collection!.signature, value: [] }]) ?? null)}>Preview empty list</button><button type="button" disabled={busy} onClick={() => setRecords(node.collection!.records)}>Load app records</button></div>
        <p>{recordScope === 'app' ? 'Apply saves the records below as app starting content. Undo restores the previous records.' : 'Apply changes only the preview. App starting content and native exports stay unchanged.'}</p>
        <RecordEditor info={node.collection} value={records} onChange={setRecords} />
        <button type="button" disabled={busy} onClick={() => { const parsed = parseRecordDrafts(node.collection!, records); if (!parsed.ok) { setError(parsed.error); return }; if (recordScope === 'app') void command({ kind: 'records', records: parsed.records }); else setError(onPreview?.('Collection preview', [{ owner: node.collection!.owner, name: node.collection!.name, signature: node.collection!.signature, value: parsed.records }]) ?? null) }}>{recordScope === 'app' ? 'Apply app initial data' : 'Apply preview records'}</button>
        <label>Empty-state message<input aria-label="Empty-state message" value={emptyText} onChange={e => setEmptyText(e.target.value)} /></label><button type="button" disabled={busy} onClick={() => void command({ kind: 'empty-state', text: emptyText })}>Add empty-state branch</button>
      </> : node.kind === 'collection' && <><p>Data comes from Swift. Typed local Identifiable records with literal initial data expose a record editor here.</p>{repeatsOverRange(node) && collectionForm}</>}
    </section>}
    {section === 'basics' && node.kind === 'template' && <section><h3>Row design</h3><p>Select a view to edit the design used by every row.</p>{visualChildren.map(child => <button key={child.id} type="button" onClick={() => onSelect?.(child)}>{sourceLayerLabel(child)}</button>)}<button type="button" disabled={busy} onClick={() => { let parent = snapshot?.nodes.find(n => n.id === node.parentId); const collection = parent; while (parent && parent.name !== 'List') parent = snapshot?.nodes.find(n => n.id === parent!.parentId); if (parent ?? collection) onSelect?.((parent ?? collection)!) }}>List settings</button><button type="button" disabled={busy} onClick={() => void command({ kind: 'insert', snippet: 'Text("New element")' })}>Add element to row template</button><p>Added elements appear in every row.</p></section>}
    {section === 'field' && !!node.fields?.length && <section><h3>Shows the field</h3><label>Field<select aria-label="Row field" value={field} onChange={e => setField(e.target.value)}>{node.fields.map(f => <option key={f}>{f}</option>)}</select></label><button type="button" disabled={busy} onClick={() => void command({ kind: 'bind-field', field })}>Use this field in every row</button></section>}
    {section === 'basics' && !!children.length && node.kind === 'definition' && <section><h3>Inside the Main</h3>{visualChildren.map(child => <button key={child.id} type="button" onClick={() => onSelect?.(child)}>{sourceLayerLabel(child)}</button>)}</section>}
    {(section === 'interaction' || section === 'advanced') && node.behavior && (node.behavior.canConfigureAction || node.behavior.binding || node.behavior.states.length > 0) && <BehaviorEditor key={node.id} part={section === 'interaction' ? 'basic' : 'advanced'} snapshot={snapshot} onSelect={onSelect} node={node} onCommand={command} busy={busy} />}
    {/* Components are made from the copies a designer already has, so the flow
        starts by finding them rather than by asking for a name. */}
    {section === 'basics' && ['view', 'component'].includes(node.kind) && node.name !== 'WindowGroup' && (onFindCopies
      ? <MakeComponent node={node} busy={busy} nudge={pasteNudge} onDismissNudge={onDismissNudge} onFind={onFindCopies} onShow={copy => { const found = snapshot?.nodes.find(n => n.id === copy.id); if (found) onSelect?.(found) }} onMake={async (componentName, copies, names) => {
          if (!onCommand) return 'Select a view first.'
          setBusy(true)
          try { const problem = await onCommand({ kind: 'make-component', name: componentName, copies, names, screens }); setError(problem); return problem }
          finally { setBusy(false) }
        }} />
      : <details><summary>Make component</summary><label>Component name<input aria-label="New component name" value={name} onChange={e => setName(e.target.value)} /></label><p>This view becomes a Main under Components, and this spot becomes its first copy. One undo step.</p><button type="button" disabled={busy} onClick={() => void command({ kind: 'extract-component', name })}>Make component</button></details>)}
    {error && <p role="alert" className={styles.error}>{error}</p>}{busy && <p role="status">Preparing source changes…</p>}
  </div>
}

function BehaviorEditor({ node, snapshot, onSelect, onCommand, busy, part }: { snapshot?: AuthoringSnapshot; onSelect?: (node: AuthoringNode) => void; node: AuthoringNode; onCommand: (op: Parameters<FeatureChange>[0]) => Promise<void>; busy: boolean; part: 'basic' | 'advanced' }) {
  const info = node.behavior!
  const [recordError, setRecordError] = useState<string | null>(null)
  const [kind, setKind] = useState<BehaviorAction['type']>('toggle'), [state, setState] = useState(info.states[0]?.name ?? '')
  const [destination, setDestination] = useState(info.destinations[0] ?? ''), [actionName, setActionName] = useState(info.actions[0] ?? '')
  // A new value starts with a name free on the screen, as the value the control shows (D13).
  const [defaults] = useState(() => info.binding ? newValueDefaults(info.binding) : null)
  const [value, setValue] = useState(defaults?.value ?? ''), [replace, setReplace] = useState(false), [newState, setNewState] = useState(defaults?.name ?? 'value')
  const [collectionName, setCollectionName] = useState(info.collections[0]?.name ?? ''), [item, setItem] = useState<readonly DesignRecord[]>([])
  const [deleteId, setDeleteId] = useState('')
  const [transition, setTransition] = useState<'opacity' | 'slide' | 'scale'>('opacity'), [duration, setDuration] = useState('0.25')
  const selected = info.states.find(s => s.name === state), collection = info.collections.find(c => c.name === collectionName)
  const parse = (type: string): DesignValue => type === 'Date' ? (value ? Date.parse(value) / 1000 : null) : type === 'Color' ? value || '#6D28D9' : type === 'Bool' ? value === 'true' : ['Int', 'Double'].includes(type) ? (value === '' ? null : Number(value)) : value
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
  if (part === 'advanced') return <section>
    {info.canConfigureAction && <details><summary>Other actions</summary><details><summary>Current action source</summary><pre>{info.currentAction}</pre></details><label>Action<select aria-label="Action type" value={kind} onChange={e => setKind(e.target.value as BehaviorAction['type'])}><option value="toggle">Toggle state</option><option value="set">Set / select a value</option><option value="call">Call developer action</option><option value="navigate">Navigate to screen</option><option value="sheet">Present sheet</option><option value="dismiss">Dismiss sheet</option><option value="append">Add local item</option><option value="delete">Delete local item</option></select></label>
      {['toggle', 'set'].includes(kind) && stateSelect}
      {kind === 'dismiss' && <label>Dismissal<select aria-label="Dismissal target" value={state} onChange={e => setState(e.target.value)}><option value="">Current presentation</option>{info.states.filter(s => !s.optional && s.type === 'Bool').map(s => <option key={s.name}>{s.name}</option>)}</select></label>}
      {kind === 'set' && <label>Value{selected?.options || selected?.type === 'Bool' ? <select aria-label="Action value" value={value} onChange={e => setValue(e.target.value)}><option value="" disabled>Select value</option>{(selected?.options ?? ['true', 'false']).map(o => <option key={o}>{o}</option>)}</select> : <input aria-label="Action value" value={value} onChange={e => setValue(e.target.value)} />}</label>}
      {['navigate', 'sheet'].includes(kind) && <label>Destination<select aria-label="Action destination" value={destination} onChange={e => setDestination(e.target.value)}><option value="" disabled>Select screen</option>{info.destinations.map(d => <option key={d}>{d}</option>)}</select></label>}
      {kind === 'call' && <label>Developer action<select aria-label="Developer action" value={actionName} onChange={e => setActionName(e.target.value)}><option value="" disabled>Select action</option>{info.actions.map(a => <option key={a}>{a}</option>)}</select></label>}
      {['append', 'delete'].includes(kind) && <><label>Local collection<select aria-label="Action collection" value={collectionName} onChange={e => { setCollectionName(e.target.value); setItem([]) }}><option value="" disabled>Select collection</option>{info.collections.filter(c => c.mutable).map(c => <option key={c.name}>{c.name}</option>)}</select></label>{collection && (kind === 'append' ? <RecordEditor info={collection} value={item.length ? item : [defaultRecord(collection, collection.records)]} onChange={setItem} /> : <label>Item to delete<select aria-label="Delete item id" value={deleteId} onChange={e => setDeleteId(e.target.value)}><option value="" disabled>Select id</option>{collection.records.map(r => <option key={String(r.id)}>{String(r.id)}</option>)}</select></label>)}</>}
      <label><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />Replace the displayed action</label><button type="button" disabled={busy} onClick={configure}>Apply action</button>{recordError && <p role="alert" className={styles.error}>{recordError}</p>}
    </details>}
    {!!info.states.length && <details><summary>Appear animation</summary>{stateSelect}<label>Style<select value={transition} onChange={e => setTransition(e.target.value as typeof transition)}><option>opacity</option><option>slide</option><option>scale</option></select></label><label>Duration in seconds<input value={duration} onChange={e => setDuration(e.target.value)} /></label><button type="button" disabled={busy} onClick={() => void onCommand({ kind: 'transition', state, style: transition, duration: Number(duration) })}>Add transition</button></details>}
  </section>
  return <section>{info.canConfigureAction && <h3>When tapped</h3>}<GuidedInteraction node={node} snapshot={snapshot} onSelect={onSelect} onCommand={onCommand} busy={busy} />
    {info.binding && <><h3>Saves to</h3><p>{info.binding.label || 'This control'} keeps its value in <code>{info.binding.current}</code>.</p><label>Save to another value<select aria-label="Bind to state" value="" onChange={e => void onCommand({ kind: 'bind-state', name: e.target.value })}><option value="" disabled>Select state</option>{info.states.filter(s => !s.optional && s.type === info.binding!.type).map(s => <option key={s.name}>{s.name}</option>)}</select></label><details><summary>Save to a new value</summary><label>Name<input aria-label="New state name" value={newState} onChange={e => setNewState(e.target.value)} /></label><label>Initial value{info.binding.type === 'Bool' ? <select aria-label="State initial value" value={value || 'false'} onChange={e => setValue(e.target.value)}><option value="false">False</option><option value="true">True</option></select> : <input type={info.binding.type === 'Date' ? 'date' : info.binding.type === 'Color' ? 'color' : 'text'} aria-label="State initial value" value={info.binding.type === 'Color' ? value || '#6D28D9' : value} onChange={e => setValue(e.target.value)} />}</label><button type="button" disabled={busy} onClick={() => void onCommand({ kind: 'bind-state', name: newState, create: { value: parse(info.binding!.type) } })}>Create value and save to it</button></details></>}
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
