'use client'

import { useMemo, useState } from 'react'
import { assetName, imageDataURL, ASSET_LIMITS, type ImageAsset, type Project } from '@studio/project-model'
import type { AuthoringSnapshot, ResourceOperation, StyleKind } from '@studio/shared'
import { decodeImportedImage } from '../lib/images'
import { SharedStyleEditor, StyleValue } from './SharedStyles'
import styles from './AuthoringInspector.module.css'

export interface ProjectResourcesProps {
  project: Project
  snapshot?: AuthoringSnapshot
  stale: boolean
  onCommand: (operation: ResourceOperation) => Promise<string | null>
  onAssets: (assets: readonly ImageAsset[], operation?: ResourceOperation) => Promise<string | null>
}
export function ProjectResources({ project, snapshot, stale, onCommand, onAssets }: ProjectResourcesProps) {
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const [name, setName] = useState('brandColor'), [kind, setKind] = useState<StyleKind>('color'), [value, setValue] = useState('blue')
  async function run(task: () => Promise<string | null>) { if (busy) return; setBusy(true); setError(null); try { setError(await task()) } catch (e) { setError(e instanceof Error ? e.message : 'The resource could not be changed.') } finally { setBusy(false) } }
  const command = async (operation: ResourceOperation) => { await run(() => onCommand(operation)) }
  const disabled = busy || stale
  async function importFile(file: File, asset?: ImageAsset, dark = false): Promise<string | null> {
    if (file.size > ASSET_LIMITS.variantBytes) return 'Each image must be 4 MB or smaller.'
    const variant = await decodeImportedImage(new Uint8Array(await file.arrayBuffer()))
    const next: ImageAsset = asset ? { ...asset, [dark ? 'dark' : 'light']: variant } : { id: crypto.randomUUID(), name: assetName(file.name.replace(/\.[^.]+$/, '')), scale: 1, light: variant }
    return onAssets([...(project.assets ?? []).filter(a => a.id !== next.id), next])
  }
  return <details className={`${styles.inspector} ${styles.features}`} data-testid="project-resources"><summary>Project resources</summary>
    <section><h3>Bundled images</h3><p>PNG or JPEG · up to 4 MB each · 4096 pixels per side · 4 megapixels. Files stay on this device.</p>
      <label>Add image<input aria-label="Add bundled image" type="file" accept="image/png,image/jpeg" disabled={disabled} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void run(() => importFile(file)) }} /></label>
      {(project.assets ?? []).map(asset => <AssetEditor key={`${asset.id}:${asset.name}:${asset.scale}`} asset={asset} assets={project.assets ?? []} disabled={disabled} onEdit={(assets, op) => run(() => onAssets(assets, op))} onFile={(file, dark) => run(() => importFile(file, asset, dark))} />)}
    </section>
    <section><h3>Shared styles</h3><p>Colors, spacing, and text styles are real Swift declarations. Code edits update these controls.</p>
      {snapshot?.styles?.map(token => <SharedStyleEditor key={token.name + token.value} token={token} busy={disabled} onCommand={command} />)}
      <details><summary>Create shared style</summary><label>Swift name<input aria-label="Shared style name" value={name} onChange={e => setName(e.target.value)} /></label><label>Kind<select aria-label="Shared style kind" value={kind} onChange={e => { const next = e.target.value as StyleKind; setKind(next); setValue(next === 'font' ? 'body' : next === 'color' ? 'blue' : '16') }}><option value="color">Color</option><option value="spacing">Spacing</option><option value="font">Text style</option></select></label>
        <StyleValue kind={kind} value={value} onChange={setValue} /><button type="button" disabled={disabled || !snapshot?.nodes.length} onClick={() => void command({ kind: 'style-create', name, style: kind, value })}>Create Swift style</button>
      </details>
    </section>
    <p>Symbols, materials, fonts, and browser color rendering can differ from native SwiftUI. Verify the exported app on an Apple device.</p>
    {busy && <p role="status">Updating resources…</p>}{error && <p className={styles.error} role="alert">{error}</p>}
  </details>
}
function AssetEditor({ asset, assets, disabled, onEdit, onFile }: { asset: ImageAsset; assets: readonly ImageAsset[]; disabled: boolean; onEdit: (assets: readonly ImageAsset[], op?: ResourceOperation) => Promise<void>; onFile: (file: File, dark: boolean) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false)
  const previews = useMemo(() => expanded ? { light: imageDataURL(asset.light), dark: asset.dark ? imageDataURL(asset.dark) : undefined } : null, [asset.light, asset.dark, expanded])
  const [name, setName] = useState(asset.name), [replacement, setReplacement] = useState('')
  const replace = (updated: ImageAsset) => assets.map(a => a.id === asset.id ? updated : a)
  return <details onToggle={event => setExpanded(event.currentTarget.open)}><summary>{asset.name} · {asset.light.width / asset.scale} × {asset.light.height / asset.scale} pt</summary>
    {expanded && <div className={styles.assetPreviews}>{(['light', 'dark'] as const).map(scheme => <figure key={scheme}>{asset[scheme] ? <img src={previews?.[scheme]} alt={`${asset.name} ${scheme}`} /> : <span>Uses light image</span>}<figcaption>{scheme}</figcaption></figure>)}</div>}
    <p>Renaming updates literal image references across Swift in the same undo step. Dynamic names require a code review.</p>
    <label>Asset name<input aria-label={`${asset.name} asset name`} value={name} onChange={e => setName(e.target.value)} /></label>
    <button type="button" disabled={disabled || name === asset.name} onClick={() => void onEdit(replace({ ...asset, name }), { kind: 'asset-references', from: asset.name, to: name })}>Rename image and references</button>
    <button type="button" disabled={disabled} onClick={() => void onEdit([...assets, { ...asset, id: crypto.randomUUID(), name }])}>Duplicate as this name</button>
    <label>Pixel scale<select aria-label={`${asset.name} pixel scale`} value={asset.scale} disabled={disabled} onChange={e => void onEdit(replace({ ...asset, scale: Number(e.target.value) as 1 | 2 | 3 }))}>{[1, 2, 3].map(scale => <option key={scale} value={scale}>{scale}×</option>)}</select></label>
    {(['light', 'dark'] as const).map(scheme => <label key={scheme}>{scheme === 'light' ? 'Replace image' : 'Dark appearance'}<input aria-label={`${asset.name} ${scheme} image`} type="file" accept="image/png,image/jpeg" disabled={disabled} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void onFile(file, scheme === 'dark') }} /></label>)}
    {asset.dark && <button type="button" disabled={disabled} onClick={() => void onEdit(replace({ ...asset, dark: undefined }))}>Remove dark variant</button>}
    <label>Replacement when deleting<select aria-label={`${asset.name} replacement`} value={replacement} onChange={e => setReplacement(e.target.value)}><option value="">Delete only if unused</option>{assets.filter(a => a.id !== asset.id).map(a => <option key={a.id} value={a.name}>{a.name}</option>)}</select></label>
    <button type="button" disabled={disabled} onClick={() => void onEdit(assets.filter(a => a.id !== asset.id), { kind: 'asset-references', from: asset.name, to: replacement || null })}>Delete image</button>
  </details>
}
