'use client'

import { useMemo, useState } from 'react'
import { imageDataURL, ASSET_LIMITS, type ImageAsset, type Project } from '@studio/project-model'
import type { ResourceOperation } from '@studio/shared'
import { decodeImportedImage, importedImageName } from '../lib/images'
import { Icon } from './ui/Icon'
import styles from './settings/Settings.module.css'

export interface ImageResourcesProps {
  project: Project
  stale: boolean
  onAssets: (assets: readonly ImageAsset[], operation?: ResourceOperation) => Promise<string | null>
}

/**
 * The App's images: PNG or JPEG files bundled into the asset catalog.
 *
 * Renaming or deleting one updates the Swift that names it in the same undo step, so an
 * image is never left pointing at nothing.
 */
/** `LogoCopy`, then `LogoCopy2`: duplicating twice used to fail validation. */
function unusedAssetName(assets: readonly ImageAsset[], base: string): string {
  let name = `${base}Copy`, suffix = 2
  while (assets.some(asset => asset.name === name)) name = `${base}Copy${suffix++}`
  return name
}

export function ImageResources({ project, stale, onAssets }: ImageResourcesProps) {
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  async function run(task: () => Promise<string | null>) { if (busy) return; setBusy(true); setError(null); try { setError(await task()) } catch (e) { setError(e instanceof Error ? e.message : 'The image could not be changed.') } finally { setBusy(false) } }
  const disabled = busy || stale
  async function importFile(file: File, asset?: ImageAsset, dark = false): Promise<string | null> {
    if (file.size > ASSET_LIMITS.variantBytes) return 'Each image must be 4 MB or smaller.'
    const variant = await decodeImportedImage(new Uint8Array(await file.arrayBuffer()))
    const next: ImageAsset = asset ? { ...asset, [dark ? 'dark' : 'light']: variant } : { id: crypto.randomUUID(), name: importedImageName(file.name, project.assets ?? []), scale: 1, light: variant }
    return onAssets([...(project.assets ?? []).filter(a => a.id !== next.id), next])
  }
  return <section className={styles.section} data-testid="project-resources" aria-label="Images">
    <div className={styles.sectionHeader}><h3>Images</h3><span><label className={styles.iconButton} title="Add a PNG or JPEG image" aria-label="Add image"><Icon name="plus" size={13} /><input aria-label="Add bundled image" type="file" accept="image/png,image/jpeg" disabled={disabled} hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void run(() => importFile(file)) }} /></label></span></div>
    {!(project.assets ?? []).length && <p className={styles.note}>PNG or JPEG, up to 4 MB each. Pick one in an Image’s settings once it is added.</p>}
    {(project.assets ?? []).map(asset => <AssetEditor key={`${asset.id}:${asset.name}:${asset.scale}`} asset={asset} assets={project.assets ?? []} open={open === asset.id} onToggle={() => setOpen(open === asset.id ? null : asset.id)} disabled={disabled} onEdit={(assets, op) => run(() => onAssets(assets, op))} onFile={(file, dark) => run(() => importFile(file, asset, dark))} />)}
    {busy && <p className={styles.note} role="status">Updating images…</p>}{error && <p className={styles.error} role="alert">{error}</p>}
  </section>
}

function AssetEditor({ asset, assets, open, onToggle, disabled, onEdit, onFile }: { asset: ImageAsset; assets: readonly ImageAsset[]; open: boolean; onToggle: () => void; disabled: boolean; onEdit: (assets: readonly ImageAsset[], op?: ResourceOperation) => Promise<void>; onFile: (file: File, dark: boolean) => Promise<void> }) {
  const previews = useMemo(() => ({ light: imageDataURL(asset.light), dark: asset.dark ? imageDataURL(asset.dark) : undefined }), [asset.light, asset.dark])
  const [name, setName] = useState(asset.name), [replacement, setReplacement] = useState('')
  const replace = (updated: ImageAsset) => assets.map(a => a.id === asset.id ? updated : a)
  return <div className={styles.tokenRow} data-open={open || undefined}>
    <button type="button" className={styles.tokenSummary} aria-expanded={open} onClick={onToggle}>
      <img src={previews.light} alt="" width={16} height={16} style={{ objectFit: 'contain', borderRadius: 3 }} />
      <strong>{asset.name}</strong><small>{asset.light.width / asset.scale} × {asset.light.height / asset.scale} pt{asset.dark ? ' · dark' : ''}</small>
    </button>
    {open && <>
      <div className={styles.row}><span>Name</span><span className={styles.inline}><input aria-label={`${asset.name} asset name`} value={name} onChange={e => setName(e.target.value)} /><button type="button" className={styles.button} disabled={disabled || name === asset.name} onClick={() => void onEdit(replace({ ...asset, name }), { kind: 'asset-references', from: asset.name, to: name })}>Rename</button></span></div>
      <p className={styles.note}>Renaming updates every Image that uses it.</p>
      <div className={styles.row}><span>Pixel scale</span><select aria-label={`${asset.name} pixel scale`} value={asset.scale} disabled={disabled} onChange={e => void onEdit(replace({ ...asset, scale: Number(e.target.value) as 1 | 2 | 3 }))}>{[1, 2, 3].map(scale => <option key={scale} value={scale}>{scale}×</option>)}</select></div>
      {(['light', 'dark'] as const).map(scheme => <label key={scheme} className={styles.fileInput}>{scheme === 'light' ? 'Replace image' : asset.dark ? 'Replace dark image' : 'Add a dark mode image'}<input aria-label={`${asset.name} ${scheme} image`} type="file" accept="image/png,image/jpeg" disabled={disabled} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void onFile(file, scheme === 'dark') }} /></label>)}
      <div className={styles.actions}>
        {asset.dark && <button type="button" className={styles.button} disabled={disabled} onClick={() => void onEdit(replace({ ...asset, dark: undefined }))}>Remove dark image</button>}
        <button type="button" className={styles.button} disabled={disabled} onClick={() => void onEdit([...assets, { ...asset, id: crypto.randomUUID(), name: unusedAssetName(assets, asset.name) }])}>Duplicate</button>
      </div>
      <div className={styles.row}><span>When deleting</span><select aria-label={`${asset.name} replacement`} value={replacement} onChange={e => setReplacement(e.target.value)}><option value="">Only if unused</option>{assets.filter(a => a.id !== asset.id).map(a => <option key={a.id} value={a.name}>Use {a.name} instead</option>)}</select></div>
      <div className={styles.actions}><button type="button" className={styles.button} disabled={disabled} onClick={() => void onEdit(assets.filter(a => a.id !== asset.id), { kind: 'asset-references', from: asset.name, to: replacement || null })}>Delete image</button></div>
    </>}
  </div>
}
