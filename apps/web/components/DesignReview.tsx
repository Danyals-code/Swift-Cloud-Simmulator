'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import { DEVICE_LIST, getDevice, type DeviceKey } from '@studio/sim-shell'
import { DYNAMIC_TYPE_SIZES, type DynamicTypeSize, type PagePreview, type RenderTree, type SourceSpan } from '@studio/shared'
import { useCompiler, type CompilerOptions } from '../lib/useCompiler'
import { reviewTree } from '../lib/designReview'
import { capturePreview, contactSheet, downloadPNG } from '../lib/designExport'
import styles from './DesignReview.module.css'

const ignoreEvent = () => {}

type Condition = { device: DeviceKey; colorScheme: 'light' | 'dark'; dynamicTypeSize: DynamicTypeSize }
type ReviewOptions = Pick<CompilerOptions, 'projectId' | 'files' | 'images' | 'scenario' | 'designScreens' | 'componentDescriptions' | 'deploymentTarget' | 'previewTarget'>
export function DesignReview({ name, options, pages, selectedPageId, onClose, onInspect }: { name: string; options: ReviewOptions; pages: readonly PagePreview[]; selectedPageId?: string; onClose: () => void; onInspect: (source: SourceSpan) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<'compare' | 'present'>('compare'), [selected, setSelected] = useState(selectedPageId ?? pages[0]?.id ?? '')
  const [conditions, setConditions] = useState<Condition[]>([{ device: 'iphone-se-3', colorScheme: 'light', dynamicTypeSize: 'large' }, { device: 'iphone-16-pro-max', colorScheme: 'dark', dynamicTypeSize: 'large' }, { device: 'iphone-15', colorScheme: 'light', dynamicTypeSize: 'accessibility3' }])
  const current = pages.find(p => p.id === selected) ?? pages[0], index = pages.findIndex(p => p.id === current?.id)
  const changeScreen = (delta: number) => { const next = pages[index + delta]; if (next) setSelected(next.id) }
  useEffect(() => { const previous = document.activeElement; dialog.current?.showModal(); return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() } }, [])
  return <dialog ref={dialog} className={styles.dialog} aria-label="Design review" onCancel={event => { event.preventDefault(); onClose() }} onKeyDown={event => {
    if (mode !== 'present' || (event.target as HTMLElement).matches('input, select, textarea')) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); changeScreen(event.key === 'ArrowRight' ? 1 : -1) }
  }}>
    <header className={styles.header}><div><h1>{name}</h1><p>{mode === 'compare' ? 'Compare screens and check the design before sharing.' : 'Presentation · use ← and → to move between screens.'}</p></div><button type="button" onClick={onClose} autoFocus aria-label="Close design review">Close</button></header>
    <div className={styles.toolbar}><div role="group" aria-label="Review mode"><button type="button" aria-pressed={mode === 'compare'} onClick={() => setMode('compare')}>Compare</button><button type="button" aria-pressed={mode === 'present'} onClick={() => setMode('present')}>Present</button></div>
      <label>Screen<select aria-label="Review screen" value={current?.id ?? ''} onChange={e => setSelected(e.target.value)}>{pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <button type="button" disabled={index <= 0} onClick={() => changeScreen(-1)}>Previous screen</button><span>{index + 1} / {pages.length}</span><button type="button" disabled={index === pages.length - 1} onClick={() => changeScreen(1)}>Next screen</button>
    </div>
    <p className={styles.context}>Snapshots use {options.scenario ? `the “${options.scenario.name}” preview scenario` : 'app starting content'}. Review settings do not change the design. Use Preview in the workspace to test interactions.</p>
    <div className={styles.grid} data-mode={mode}>
      {conditions.map((condition, i) => <ReviewCondition key={`${i}:${condition.device}:${condition.colorScheme}:${condition.dynamicTypeSize}`} number={i + 1} condition={condition} onChange={next => setConditions(conditions.map((value, index) => i === index ? { ...value, ...next } : value))} options={options} page={current} projectName={name} present={mode === 'present'} hidden={mode === 'present' && i > 0} onInspect={onInspect} />)}
    </div>
    {mode === 'compare' && <footer className={styles.footer}><p>Checks cover the visible preview and supported solid backgrounds. Gradients, images, materials, transforms, and other ambiguous compositing need manual contrast review. These checks do not establish accessibility conformance.</p><p>Targets follow <a href="https://developer.apple.com/design/tips/" target="_blank" rel="noreferrer">Apple’s 44 pt guidance</a>. Contrast follows <a href="https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html" target="_blank" rel="noreferrer">WCAG text contrast guidance</a>, using the preview’s rendered text size.</p></footer>}
  </dialog>
}

function ReviewCondition({ number, condition, onChange, options, page, projectName, present, hidden, onInspect }: { number: number; condition: Condition; onChange: (change: Partial<Condition>) => void; options: ReviewOptions; page?: PagePreview; projectName: string; present: boolean; hidden: boolean; onInspect: (source: SourceSpan) => void }) {
  const device = getDevice(condition.device)
  const { result, stale, workerError } = useCompiler({ ...options, ...condition, device, typeScale: 1, allPages: true })
  const current = result?.pages?.find(p => p.id === page?.id)
  const tree = current?.tree
  const valid = !!tree && !stale && !workerError && !result?.diagnostics.some(d => d.severity === 'error')
  const screen = useRef<HTMLDivElement>(null), sheet = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false), [error, setError] = useState<string | null>(null), [note, setNote] = useState(''), [highlight, setHighlight] = useState<string | null>(null)
  const report = useMemo(() => tree ? reviewTree(tree) : null, [tree])
  const describe = `${device.name} · ${condition.colorScheme} · text ${condition.dynamicTypeSize}`
  const runExport = async (all: boolean) => {
    if (!valid || exporting) return
    setExporting(true); setError(null); setNote('')
    try {
      if (all) {
        const items = (result?.pages ?? []).map((p, index) => ({ element: sheet.current?.children[index] as HTMLElement, name: p.name, ...p.tree.canvas }))
        if (items.some(p => !p.element)) throw new Error('The screen previews are still preparing. Try again.')
        await downloadPNG(await contactSheet(items, projectName, `${describe} · ${options.scenario?.name ?? 'App starting content'}`), `${projectName} contact sheet`)
      } else if (screen.current && tree) await downloadPNG(await capturePreview(screen.current, tree.canvas.width, tree.canvas.height), `${projectName} ${page?.name} ${condition.colorScheme}`)
      setNote(all ? 'Contact sheet downloaded.' : 'Screen PNG downloaded at 2× resolution.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The image could not be exported.') } finally { setExporting(false) }
  }
  return <section className={styles.condition} hidden={hidden} data-testid={`review-condition-${number}`} aria-label={`Comparison ${number}`}>
    <fieldset disabled={exporting} className={styles.controls}>
      <label>Device<select aria-label={`Comparison ${number} device`} value={condition.device} onChange={e => onChange({ device: e.target.value as DeviceKey })}>{DEVICE_LIST.map(d => <option key={d.key} value={d.key}>{d.name}</option>)}</select></label>
      <label>Theme<select aria-label={`Comparison ${number} theme`} value={condition.colorScheme} onChange={e => onChange({ colorScheme: e.target.value as 'light' | 'dark' })}><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label>Text size<select aria-label={`Comparison ${number} text size`} value={condition.dynamicTypeSize} onChange={e => onChange({ dynamicTypeSize: e.target.value as DynamicTypeSize })}>{DYNAMIC_TYPE_SIZES.map(size => <option key={size} value={size}>{size === 'large' ? 'Default' : size.startsWith('accessibility') ? `Accessibility ${size.slice(-1)}` : size}</option>)}</select></label>
    </fieldset>
    <p className={styles.status} role="status" aria-busy={!valid} data-testid="review-ready">{workerError ?? (result?.diagnostics.some(d => d.severity === 'error') ? 'Resolve source errors before reviewing or exporting.' : !valid ? 'Preparing this screen…' : describe)}</p>
    {tree && <ReviewScreen tree={tree} present={present} captureRef={screen} highlight={present ? null : highlight} />}
    <div className={styles.exportActions}><button type="button" disabled={!valid || exporting} onClick={() => void runExport(false)}>Export screen PNG</button>{number === 1 && <button type="button" disabled={!valid || exporting} onClick={() => void runExport(true)}>Export contact sheet</button>}</div>
    {number === 1 && <p className={styles.context}>Contact sheet: all {result?.pages?.length ?? 0} loaded screens in this device, theme, and text size.</p>}
    {exporting && <p role="status">Preparing image…</p>}{error && <p role="alert">{error}</p>}{note && <p role="status">{note}</p>}
    {!present && report && valid && <details className={styles.findings} open><summary>{report.findings.length} design {report.findings.length === 1 ? 'check' : 'checks'} to review</summary><p>{report.contrastChecked} text layers measured for contrast · {report.contrastSkipped} need manual review.</p>
      {!report.findings.length && <p>No issues found by these checks. Also review reading order, VoiceOver labels, and interaction behavior.</p>}
      <ul>{report.findings.map((finding, index) => <li key={`${finding.kind}:${finding.nodeId}`}><button type="button" onClick={() => setHighlight(highlight === finding.nodeId ? null : finding.nodeId)} aria-pressed={highlight === finding.nodeId}>{index + 1}. {finding.title}</button><p>{finding.detail}</p>{finding.source && <button type="button" onClick={() => onInspect(finding.source!)}>Find layer in Design</button>}</li>)}</ul>
    </details>}
    {number === 1 && <div ref={sheet} className={styles.exportOnly} aria-hidden="true" inert>{result?.pages?.map(p => <div key={p.id} style={{ width: p.tree.canvas.width, height: p.tree.canvas.height, background: p.tree.colorScheme === 'dark' ? '#000' : '#fff' }}><RenderTreeView tree={p.tree} onEvent={ignoreEvent} /></div>)}</div>}
  </section>
}
function ReviewScreen({ tree, present, captureRef, highlight }: { tree: RenderTree; present: boolean; captureRef: React.RefObject<HTMLDivElement | null>; highlight: string | null }) {
  const host = useRef<HTMLDivElement>(null), [width, setWidth] = useState(300)
  useEffect(() => { const node = host.current; if (!node) return; const measure = () => setWidth(Math.min(node.clientWidth, (present ? Math.max(240, window.innerHeight - 420) : Math.max(260, Math.min(510, window.innerHeight - 465))) * tree.canvas.width / tree.canvas.height)); measure(); const observer = new ResizeObserver(measure); observer.observe(node); window.addEventListener('resize', measure); return () => { observer.disconnect(); window.removeEventListener('resize', measure) } }, [present, tree.canvas.width, tree.canvas.height])
  const scale = Math.max(0.1, width / tree.canvas.width), selected = tree.nodes.find(n => n.id === highlight)
  return <div ref={host} className={styles.screenHost}><div style={{ width: tree.canvas.width * scale, height: tree.canvas.height * scale }} className={styles.screenFrame}>
    <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', position: 'relative', width: tree.canvas.width, height: tree.canvas.height }}>
      <div ref={captureRef} inert style={{ width: tree.canvas.width, height: tree.canvas.height, background: tree.colorScheme === 'dark' ? '#000' : '#fff' }}><RenderTreeView tree={tree} onEvent={ignoreEvent} /></div>
      {selected && <div className={styles.highlight} aria-hidden="true" style={{ left: selected.frame.x, top: selected.frame.y, width: selected.frame.width, height: selected.frame.height }} />}
    </div>
  </div></div>
}
