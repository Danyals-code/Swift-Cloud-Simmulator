'use client'

import { useState } from 'react'
import { reviewImport, resolveImport, type Handoff } from '@studio/exporter'
import { imageDataURL, type Project } from '@studio/project-model'
import { decodeImportedImage } from '../lib/images'
import styles from './ImportReview.module.css'

export function ImportReview({ local, incoming, handoff, onApply, onCancel }: { local: Project; incoming: Project; handoff: Handoff; onApply: (expected: Project, project: Project, removedNames: readonly string[], removedColors: readonly string[]) => Promise<string | null>; onCancel: () => void }) {
  const review = reviewImport(local, incoming, handoff)
  const [choices, setChoices] = useState<Record<string, 'local' | 'incoming'>>({}), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  async function apply(copy: boolean) {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const project = resolveImport(local, incoming, handoff, choices, copy)
      for (const asset of project.assets ?? []) for (const variant of [asset.light, asset.dark]) if (variant) await decodeImportedImage(variant.bytes)
      const removed = copy ? [] : [...new Set([...(local.assets ?? []), ...(incoming.assets ?? [])].map(a => a.name))].filter(name => !project.assets?.some(a => a.name === name))
      // A colour the merge drops is checked the same way an image is: the Swift that
      // reads it by name would otherwise be left pointing at nothing.
      const removedColors = copy ? [] : [...new Set([...(local.colors ?? []), ...(incoming.colors ?? [])].map(color => color.name))].filter(name => !project.colors?.some(color => color.name === name))
      setError(await onApply(local, project, removed, removedColors))
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not import the project.') } finally { setBusy(false) }
  }
  const sourceIds = new Set([...local.files.map(f => f.id), ...incoming.files.map(f => f.id)])
  return <section className={styles.review} aria-label="Review imported project" data-testid="import-review">
    <h3>Review {incoming.manifest.name}</h3>
    <p>{review.sameIdentity ? 'This archive belongs to the current project. Independent file changes merge automatically. Choose which version to keep where both changed.' : 'This archive has a different project ID. It will open as a separate editable project.'}</p>
    <p>{incoming.files.length} Swift files · {incoming.assets?.length ?? 0} images · iOS {incoming.manifest.deploymentTarget} · {incoming.manifest.bundleId}</p>
    <details><summary>Review source changes ({review.changedFiles.length})</summary>{[...sourceIds].filter(id => review.changedFiles.includes(id)).map(id => <div key={id}><strong>{id}</strong><div className={styles.versions}><section><h4>Current</h4><SourcePreview text={local.files.find(f => f.id === id)?.text ?? '(missing)'} /></section><section><h4>Imported</h4><SourcePreview text={incoming.files.find(f => f.id === id)?.text ?? '(missing)'} /></section></div></div>)}</details>
    {review.conflicts.map(conflict => <fieldset key={conflict.key}><legend>{conflict.label} · conflict</legend><div className={styles.versions}><section><h4>Current</h4><SourcePreview text={conflict.local} />{conflict.key === '$assets' && <ResourcePreview project={local} />}</section><section><h4>Imported</h4><SourcePreview text={conflict.incoming} />{conflict.key === '$assets' && <ResourcePreview project={incoming} />}</section></div><label>Keep<select aria-label={`Resolve ${conflict.label}`} value={choices[conflict.key] ?? ''} disabled={busy} onChange={e => setChoices({ ...choices, [conflict.key]: e.target.value as 'local' | 'incoming' })}><option value="" disabled>Choose a version</option><option value="local">Current project</option><option value="incoming">Imported archive</option></select></label></fieldset>)}
    <div className={styles.actions}><button type="button" disabled={busy} onClick={onCancel}>Cancel import</button><button type="button" disabled={busy} onClick={() => void apply(true)}>Open as separate copy</button>{review.sameIdentity && <button type="button" disabled={busy || review.conflicts.some(c => !choices[c.key])} onClick={() => void apply(false)}>Apply reviewed changes</button>}</div>
    {busy && <p role="status">Validating images and saving the project…</p>}{error && <p role="alert">{error}</p>}
  </section>
}
function ResourcePreview({ project }: { project: Project }) {
  return <div className={styles.images}>{project.assets?.map(asset => <figure key={asset.id}><figcaption>{asset.name}</figcaption>{[asset.light, asset.dark].map((variant, i) => variant && <img key={i} loading="lazy" src={imageDataURL(variant)} alt={`${asset.name} ${i ? 'dark' : 'light'} variant`} />)}</figure>)}</div>
}
function SourcePreview({ text }: { text: string }) {
  return <><pre>{text.slice(0, 50_000)}</pre>{text.length > 50_000 && <p>Preview limited to 50,000 characters. Review the complete file in your external editor before choosing a version.</p>}</>
}
