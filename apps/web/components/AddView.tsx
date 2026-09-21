'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ASSET_LIMITS, imageDataURL, type ImageAsset } from '@studio/project-model'
import { decodeImportedImage, importedImageName } from '../lib/images'
import { searchCatalog, type ViewSnippet } from '../lib/viewCatalog'
import { Spotlight } from './Spotlight'
import { Icon } from './ui/Icon'
import styles from './AddView.module.css'

interface Props {
  /** Where it will land, said in the words the canvas uses: "into VStack", "after Title". */
  target: string
  onChoose: (snippet: ViewSnippet) => void
  onClose: () => void
  assets: readonly ImageAsset[]
  onImage: (name: string, asset?: ImageAsset) => Promise<string | null>
}

/**
 * The Add palette.
 *
 * A search field and a list, opened over the canvas and closed by the first choice.
 * It says where the view will land before anything is added, because "add" on a
 * canvas is ambiguous by nature - inside the thing I selected, or after it? - and a
 * palette that answers that in its header is one that never surprises.
 *
 * Keyboard first: the field takes focus, the arrows move the highlight, Return adds
 * the highlighted view and Escape leaves. That is the whole interaction for someone
 * who knows what they want, and the list is there for everyone else.
 */
export function AddView({ target, onChoose, onClose, assets, onImage }: Props) {
  const [images, setImages] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const results = useMemo(() => searchCatalog(query), [query])
  const current = results[Math.min(active, results.length - 1)]

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  if (images) return <ImagePicker target={target} assets={assets} onImage={onImage} onBack={() => setImages(false)} onClose={onClose} />
  const choose = (snippet: ViewSnippet, close: (after?: () => void) => void) => {
    if (snippet.action === 'image') setImages(true)
    else close(() => onChoose(snippet))
  }

  return (
    <Spotlight label="Add a view" testId="add-view-palette" onClose={onClose}>{close => <>
        <header className={styles.field}>
          <Icon name="search" size={16} />
          <input
            value={query}
            data-testid="add-view-search"
            aria-label="Search views"
            placeholder="Add a view…"
            spellCheck={false}
            onChange={(event) => { setQuery(event.target.value); setActive(0) }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.max(0, Math.min(i + 1, results.length - 1))) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
              else if (event.key === 'Enter' && current) { event.preventDefault(); choose(current, close) }
            }}
          />
          <span className={styles.target} data-testid="add-view-target">{target}</span>
        </header>

        <p className={styles.catalogNote}>Pick a view to add it. Select it afterwards to change it in the settings panel. Links set up navigation for you.</p>
        <div className={styles.list} ref={listRef} role="listbox" aria-label="Views">
          {results.map((snippet, index) => (
            <button
              key={snippet.id}
              type="button"
              role="option"
              aria-selected={index === active}
              data-active={index === active}
              data-testid={`add-view-${snippet.id}`}
              className={styles.row}
              onPointerMove={() => setActive(index)}
              onClick={() => choose(snippet, close)}
            >
              <span className={styles.name}>{snippet.name}</span>
              <span className={styles.hint}>{snippet.hint}</span>
              <span className={styles.group}>{snippet.group}</span>
            </button>
          ))}
          {!results.length ? <p className={styles.empty}>Nothing matches “{query}”.</p> : null}
        </div>

        <footer className={styles.footer}>
          <span>↑↓ to choose · ↩ to add · esc to close</span>
          <span>{results.length} of {searchCatalog('').length}</span>
        </footer>
      </>}</Spotlight>
  )
}

function ImagePicker({ target, assets, onImage, onBack, onClose }: Pick<Props, 'target' | 'assets' | 'onImage' | 'onClose'> & { onBack: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  const pending = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  async function insert(close: () => void, choice: ImageAsset | File) {
    if (pending.current) return
    pending.current = true
    setBusy(true); setError(null)
    try {
      let imported: ImageAsset | undefined
      if (choice instanceof File) {
        if (choice.size > ASSET_LIMITS.variantBytes) throw new Error('Each image must be 4 MB or smaller.')
        const light = await decodeImportedImage(new Uint8Array(await choice.arrayBuffer()))
        imported = { id: crypto.randomUUID(), name: importedImageName(choice.name, assets), scale: 1, light }
      }
      if (!mounted.current) return
      const problem = await onImage(imported?.name ?? (choice as ImageAsset).name, imported)
      if (!mounted.current) return
      if (problem) setError(problem)
      else close()
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not add this image.')
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return <Spotlight label="Add an image" testId="add-image-palette" onClose={onClose}>{close => <>
    <header className={styles.field}>
      <button type="button" className={styles.back} onClick={onBack} disabled={busy} aria-label="Back to views">←</button>
      <strong>Images</strong><span className={styles.target}>{target}</span>
    </header>
    <div className={styles.imageTools}>
      <button type="button" className={styles.upload} disabled={busy} onClick={() => input.current?.click()}>Upload image…</button>
      <input ref={input} hidden type="file" accept="image/png,image/jpeg" aria-label="Upload image" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void insert(close, file) }} />
      <p>PNG or JPEG · up to 4 MB. Images are bundled with your Xcode export.</p>
    </div>
    {error && <p role="alert" className={styles.imageError}>{error}</p>}
    {busy && <p role="status" className={styles.catalogNote}>Adding image…</p>}
    <div className={styles.imageGrid} aria-label="Bundled images">
      {assets.map(asset => <button key={asset.id} type="button" disabled={busy} className={styles.imageChoice} onClick={() => void insert(close, asset)} aria-label={`Add ${asset.name}`}>
        {/* Bundled data URLs are already decoded and bounded at import. */}
        <img src={imageDataURL(asset.light)} alt="" /><span>{asset.name}</span>
      </button>)}
      {!assets.length && <p className={styles.empty}>Upload your first image to add it to the canvas.</p>}
    </div>
    <footer className={styles.footer}>Choose an image to insert it. Manage variants in App settings → Images.</footer>
  </>}</Spotlight>
}
