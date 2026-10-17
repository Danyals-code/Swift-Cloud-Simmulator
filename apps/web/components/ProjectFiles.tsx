'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { imageDataURL, type ColorAsset, type FontAsset, type ImageAsset, type ImageVariant, type TreeNode } from '@studio/project-model'
import type { FileId } from '@studio/shared'
import { fontLabel } from '../lib/fonts'
import { ASSET_DRAG_TYPE, draggingFiles } from '../lib/images'
import { Icon } from './ui/Icon'
import { MenuButton } from './ui/Menu'
import styles from './ProjectFiles.module.css'

export interface AssetsFolderProps {
  images: readonly ImageAsset[]
  colors: readonly ColorAsset[]
  /** The project's font files, each one face, which `.custom(…)` and Typography's Family use. */
  fonts: readonly FontAsset[]
  busy: boolean
  /** Adds picked or dropped files to the folder; resolves to what to tell the user, or null. */
  onImport: (files: readonly File[]) => Promise<string | null>
  /** Puts an Image of this asset into the selected view. */
  onInsert: (name: string) => Promise<string | null>
  /** The App's image settings, where an image is renamed, given a dark version or deleted. */
  onManage: () => void
  /** Takes a font file out of the project; resolves to what to tell the user, or null. */
  onRemoveFont: (id: string) => Promise<string | null>
}

const INDENT = 16
const BASE = 4
/** Where a row without a disclosure starts its icon: past the chevron's slot and the gap after it. */
const LEAF = 22

/** Data URLs are a few megabytes of base64 for a large image, so each is made once per variant. */
const thumbnails = new WeakMap<ImageVariant, string>()
function thumbnail(variant: ImageVariant): string {
  let url = thumbnails.get(variant)
  if (!url) { url = imageDataURL(variant); thumbnails.set(variant, url) }
  return url
}

/** The Swift that shows an asset, which is also what a row carries when dropped into code. */
export const imageReference = (name: string) => `Image(${JSON.stringify(name)})`
/** The Swift that sets a project font, for its row's Copy. */
const fontReference = (postScriptName: string) => `.font(.custom(${JSON.stringify(postScriptName)}, size: 17, relativeTo: .body))`

/**
 * The project's Assets folder: everything bundled with the app that is not Swift.
 *
 * Images arrive here however they are added - the + button, a drop on the folder, or
 * a drop anywhere else in the studio - so the project keeps one place for them, and
 * it is the asset catalog an Xcode export writes. A row can be dragged onto a view
 * on the canvas to place it, or into the code editor, where it lands as `Image("…")`.
 * Font files are listed by face, with their file's name, and removed from their row.
 * Colours are listed for completeness; they are edited in the App's settings.
 */
export function AssetsFolder({ images, colors, fonts, busy, onImport, onInsert, onManage, onRemoveFont }: AssetsFolderProps) {
  const [open, setOpen] = useState(true)
  const [over, setOver] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<ImageAsset | null>(null)
  const disabled = busy || !!working
  async function run(task: () => Promise<string | null>, success: string | null = null, doing = 'Adding…') {
    if (disabled) return
    setWorking(doing); setMessage(null)
    try { const problem = await task(); setMessage(problem ? { text: problem, error: true } : success ? { text: success, error: false } : null) }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : 'That did not work.', error: true }) }
    finally { setWorking(null) }
  }
  const count = images.length + fonts.length + colors.length

  return <section className={styles.folder} aria-label="Assets" data-testid="assets-folder" data-drop={over || undefined}
    onDragOver={event => { if (!draggingFiles(event.dataTransfer)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; setOver(true) }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false) }}
    onDrop={event => {
      if (!draggingFiles(event.dataTransfer)) return
      event.preventDefault(); event.stopPropagation(); setOver(false); setOpen(true)
      const files = Array.from(event.dataTransfer.files)
      void run(() => onImport(files))
    }}>
    <div className={styles.row} style={{ paddingLeft: BASE }}>
      <button type="button" className={styles.label} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className={styles.disclosure}><Icon name="chevron-right" size={12} /></span>
        <Icon name="folder" size={14} /><span>Assets</span>{count > 0 && <small>{count}</small>}
      </button>
      <label className={styles.add} title="Add PNG or JPEG images, or TTF or OTF font files" aria-label="Add images" aria-disabled={disabled || undefined}>
        <Icon name="plus" size={14} />
        <input type="file" accept="image/png,image/jpeg,.ttf,.otf,font/ttf,font/otf" multiple hidden disabled={disabled} data-testid="assets-import"
          onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) { setOpen(true); void run(() => onImport(files)) } }} />
      </label>
    </div>
    {open && <ul className={styles.items} role="group" aria-label="Assets">
      {images.map(asset => <li key={asset.id} className={styles.row} style={{ paddingLeft: BASE + INDENT + LEAF }} data-testid="asset-image"
        draggable={!disabled} tabIndex={0} aria-label={`${asset.name}, image`}
        title={`Double-click to look closer. Drag onto a view to place it, or into code for ${imageReference(asset.name)}`}
        onDoubleClick={() => setPreviewing(asset)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPreviewing(asset) } }}
        onDragStart={event => {
          event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.name)
          event.dataTransfer.setData('text/plain', imageReference(asset.name))
          event.dataTransfer.effectAllowed = 'copy'
        }}>
        <img src={thumbnail(asset.light)} alt="" width={16} height={16} className={styles.thumb} draggable={false} />
        <span className={styles.name}>{asset.name}</span>
        <small>{asset.light.width / asset.scale} × {asset.light.height / asset.scale}</small>
        <span className={styles.actions}><MenuButton label={`Actions for ${asset.name}`} items={[
          { value: 'preview', label: 'Preview' },
          { value: 'insert', label: 'Insert into selection', disabled },
          { value: 'copy', label: `Copy ${imageReference(asset.name)}` },
          { value: 'manage', label: 'Rename, dark version or delete…', separated: true },
        ]} onSelect={value => {
          if (value === 'preview') setPreviewing(asset)
          else if (value === 'insert') void run(() => onInsert(asset.name), `Added ${asset.name} to the selection.`)
          else if (value === 'copy') void navigator.clipboard?.writeText(imageReference(asset.name))
          else onManage()
        }}><Icon name="ellipsis" size={14} /></MenuButton></span>
      </li>)}
      {fonts.map(font => <li key={font.id} className={styles.row} style={{ paddingLeft: BASE + INDENT + LEAF }} data-testid="asset-font"
        tabIndex={0} aria-label={`${fontLabel(font)}, font`} title={`Choose it in Typography's Family, or use it in code as ${fontReference(font.postScriptName)}`}>
        <Icon name="text-lines" size={14} />
        <span className={styles.name}>{fontLabel(font)}</span>
        <small>{font.postScriptName}.{font.format}</small>
        <span className={styles.actions}><MenuButton label={`Actions for ${fontLabel(font)}`} items={[
          { value: 'copy', label: `Copy ${fontReference(font.postScriptName)}` },
          { value: 'remove', label: 'Remove from project', disabled, separated: true },
        ]} onSelect={value => {
          if (value === 'copy') void navigator.clipboard?.writeText(fontReference(font.postScriptName))
          else void run(() => onRemoveFont(font.id), `Removed ${fontLabel(font)}.`, 'Removing…')
        }}><Icon name="ellipsis" size={14} /></MenuButton></span>
      </li>)}
      {colors.map(color => <li key={`color:${color.name}`} className={styles.row} style={{ paddingLeft: BASE + INDENT + LEAF }} data-testid="asset-color">
        <span className={styles.swatch} style={{ background: color.light }} aria-hidden="true" />
        <span className={styles.name}>{color.name}</span><small>Colour</small>
      </li>)}
      {!count && <li className={styles.empty} style={{ paddingLeft: BASE + INDENT + LEAF }}>Drop PNG or JPEG images here, or TTF or OTF font files, or use +.</li>}
    </ul>}
    {(working || message) && <p className={message?.error ? styles.error : styles.status} role={message?.error ? 'alert' : 'status'}>{working ?? message?.text}</p>}
    {previewing && <AssetPreview key={previewing.id} asset={images.find(asset => asset.id === previewing.id) ?? previewing} onClose={() => setPreviewing(null)} />}
  </section>
}

const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const

/**
 * An image from Assets, up close.
 *
 * It opens fitted to the window; a click on the image, or `1`, shows it at its real
 * pixel size and back, and the buttons or `+` and `-` step through sizes in between,
 * scrolling when it is larger than the window. A transparent PNG sits on a checker
 * so its edges show, and an image with a dark version can be flipped to it.
 */
function AssetPreview({ asset, onClose }: { asset: ImageAsset; onClose: () => void }) {
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [dark, setDark] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null), imageRef = useRef<HTMLImageElement>(null)
  const variant = dark && asset.dark ? asset.dark : asset.light
  /** The size Fit draws the image at, as a fraction of its pixels; kept while zoomed. */
  const [shown, setShown] = useState(1)
  useEffect(() => {
    const image = imageRef.current
    if (!image || zoom !== 'fit') return
    const measure = () => setShown(image.clientWidth / variant.width || 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(image)
    return () => observer.disconnect()
  }, [variant, zoom])
  /** The same, for the key handler, which outlives renders. */
  const fitted = useRef(shown)
  useEffect(() => { fitted.current = shown }, [shown])
  const step = (direction: 1 | -1) => setZoom(current => {
    // From Fit, a step goes to the next size from the one on screen.
    const now = current === 'fit' ? fitted.current : current
    const next = direction > 0 ? ZOOMS.find(value => value > now) : [...ZOOMS].reverse().find(value => value < now)
    return next ?? now
  })
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      else if (event.key === '+' || event.key === '=') { event.preventDefault(); step(1) }
      else if (event.key === '-') { event.preventDefault(); step(-1) }
      else if (event.key === '0') { event.preventDefault(); setZoom('fit') }
      else if (event.key === '1') { event.preventDefault(); setZoom(1) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); previous?.focus?.() }
  }, [onClose])
  return createPortal(<div className={styles.preview} role="dialog" aria-modal="true" aria-label={`${asset.name} preview`} data-testid="asset-preview"
    onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <header className={styles.previewBar}>
      <strong>{asset.name}</strong>
      <small>{variant.width} × {variant.height} px · {variant.width / asset.scale} × {variant.height / asset.scale} pt at {asset.scale}×</small>
      {asset.dark && <span className={styles.previewSwitch} role="group" aria-label="Appearance">
        <button type="button" aria-pressed={!dark} onClick={() => setDark(false)}>Light</button>
        <button type="button" aria-pressed={dark} onClick={() => setDark(true)}>Dark</button>
      </span>}
      <span className={styles.previewZoom} role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" title="Zoom out (-)" onClick={() => step(-1)}>−</button>
        <button type="button" aria-pressed={zoom === 'fit'} title="Fit to window (0)" onClick={() => setZoom('fit')}>Fit</button>
        <button type="button" aria-pressed={zoom === 1} title="Actual size (1)" onClick={() => setZoom(1)}>100%</button>
        <button type="button" aria-label="Zoom in" title="Zoom in (+)" onClick={() => step(1)}>+</button>
        <output aria-live="polite">{Math.round((zoom === 'fit' ? shown : zoom) * 100)}%</output>
      </span>
      <button ref={closeRef} type="button" className={styles.previewClose} aria-label="Close preview" title="Close (Esc)" onClick={onClose}><Icon name="xmark" size={14} /></button>
    </header>
    <div className={styles.previewStage} data-fit={zoom === 'fit' || undefined} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <img ref={imageRef} src={thumbnail(variant)} alt={asset.name} draggable={false} data-testid="asset-preview-image"
        style={zoom === 'fit' ? undefined : { width: variant.width * zoom, height: variant.height * zoom }}
        onClick={() => setZoom(current => current === 'fit' ? 1 : 'fit')} />
    </div>
  </div>, document.body)
}

export interface ProjectFilesProps {
  assets: AssetsFolderProps
  tree: readonly TreeNode[]
  activeFileId: FileId | null
  /** Swift is edited in Code, so a file opens there. */
  onOpenFile: (fileId: FileId) => void
}

/** Design's Files view: the Assets folder, then the Swift the app is made of. */
export function ProjectFiles({ assets, tree, activeFileId, onOpenFile }: ProjectFilesProps) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (path: string) => setClosed(current => { const next = new Set(current); if (!next.delete(path)) next.add(path); return next })
  const rows = (nodes: readonly TreeNode[], depth: number): React.ReactNode => nodes.map(node => node.kind === 'folder'
    ? <li key={`folder:${node.path}`}>
        <div className={styles.row} style={{ paddingLeft: BASE + depth * INDENT }}>
          <button type="button" className={styles.label} aria-expanded={!closed.has(node.path)} onClick={() => toggle(node.path)}>
            <span className={styles.disclosure}><Icon name="chevron-right" size={12} /></span>
            <Icon name="folder" size={14} /><span>{node.name}</span>
          </button>
        </div>
        {!closed.has(node.path) && <ul className={styles.items} role="group">{rows(node.children, depth + 1)}</ul>}
      </li>
    : <li key={node.id}>
        <div className={styles.row} style={{ paddingLeft: BASE + depth * INDENT + LEAF }} aria-current={node.id === activeFileId || undefined}>
          <button type="button" className={styles.label} title="Open in Code" onClick={() => onOpenFile(node.id)}><Icon name="code" size={14} /><span>{node.name}</span></button>
        </div>
      </li>)
  return <div className={styles.files} data-testid="project-files">
    <AssetsFolder {...assets} />
    <ul className={styles.items} aria-label="Source files">{rows(tree, 0)}</ul>
    <p className={styles.hint}>Drag an image onto a view to place it, or into code. Images dropped anywhere else are added to Assets.</p>
  </div>
}
