'use client'

import { useEffect, useRef, useState } from 'react'
import type { OpenedFile } from '@studio/project-model'
import { DEFAULT_MODELS, parseGeneratedApp, parseOptions, type GeneratedApp, type GenerationOptions, type Provider } from '../lib/generation/schema'
import { checkPreview } from '../lib/generation/validate'
import { Icon } from './ui/Icon'
import styles from './PromptCreator.module.css'

const INITIAL: GenerationOptions = { provider: 'openai', model: DEFAULT_MODELS.openai, prompt: '', pageCount: 4, navigation: 'tabs', accent: 'indigo', sampleData: true, includeSettings: false }

export function PromptCreator({ onOpenFiles, onBusy }: { onOpenFiles: (files: readonly OpenedFile[]) => Promise<boolean>; onBusy: (busy: boolean) => void }) {
  const [options, setOptions] = useState(INITIAL)
  const [apiKey, setApiKey] = useState('')
  const [revealKey, setRevealKey] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'generating' | 'checking' | 'opening'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<GeneratedApp | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [selectedFile, setSelectedFile] = useState(0)
  const controller = useRef<AbortController | null>(null)
  const review = useRef<HTMLDivElement | null>(null)
  const busy = phase !== 'idle'
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { if (draft) review.current?.focus() }, [draft])
  const update = <K extends keyof GenerationOptions>(key: K, value: GenerationOptions[K]) => setOptions(current => ({ ...current, [key]: value }))

  async function generate() {
    if (controller.current) return
    setError(null)
    let input: GenerationOptions
    try {
      input = parseOptions(options)
      if (!apiKey.trim()) throw new Error('Enter your provider API key.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Check your project options.'); return }
    const request = new AbortController()
    controller.current = request
    setPhase('generating'); onBusy(true)
    try {
      const response = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` }, body: JSON.stringify(input), signal: request.signal })
      const result = await response.json().catch(() => { throw new Error('The studio server could not finish this request. Check your connection or try a smaller app.') })
      if (!response.ok) throw new Error(result.error ?? 'Could not generate the app.')
      const app = parseGeneratedApp(result.app, input.pageCount)
      setPhase('checking')
      const found = await checkPreview(app, request.signal)
      if (request.signal.aborted) return
      setDraft(app); setIssues(found); setSelectedFile(0)
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : 'Could not connect. Please try again.')
    } finally {
      if (controller.current === request) { controller.current = null; setPhase('idle'); onBusy(false) }
    }
  }
  function cancel() { controller.current?.abort() }
  async function open() {
    if (!draft || busy) return
    setPhase('opening'); onBusy(true); setError(null)
    try {
      if (!await onOpenFiles(draft.files.map(f => ({ name: f.path, text: f.code })))) throw new Error('The generated files could not be opened.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open this project.') }
    finally { setPhase('idle'); onBusy(false) }
  }

  if (draft) return <div ref={review} tabIndex={-1} className={styles.review} data-testid="generated-review" aria-label="Generated project review">
    <div className={styles.summary}><span className={styles.check}><Icon name="check" size={18} /></span><div><h3>{draft.name}</h3><p>{draft.summary}</p></div></div>
    <div className={styles.pages}>{draft.pages.map((p, i) => <span key={`${p.file}:${i}`}>{p.title}</span>)}</div>
    <p className={styles.validation} role="status">{issues.length ? 'This draft needs attention in the preview.' : 'First screen passed the preview check. Review all flows after opening.'}</p>
    {issues.length > 0 && <details className={styles.issues}><summary>{issues.length} preview {issues.length === 1 ? 'issue' : 'issues'}</summary><ul>{issues.map(i => <li key={i}>{i}</li>)}</ul></details>}
    <div className={styles.files}><nav aria-label="Generated files">{draft.files.map((file, i) => <button type="button" key={file.path} aria-pressed={selectedFile === i} onClick={() => setSelectedFile(i)}><Icon name="new-file" size={14} />{file.path.replace('Sources/', '')}</button>)}</nav><pre tabIndex={0} aria-label="Generated Swift source"><code>{draft.files[selectedFile]?.code}</code></pre></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <footer className={styles.footer}><span>{draft.files.length} Swift files · Opens as a separate project</span><div><button type="button" className={styles.secondary} disabled={busy} onClick={() => { setDraft(null); setError(null) }}>Back to prompt</button><button type="button" className={styles.primary} disabled={busy} onClick={() => void open()} data-testid="open-generated">{busy ? 'Opening…' : issues.length ? 'Open draft' : 'Open project'}<Icon name="chevron-right" size={13} /></button></div></footer>
  </div>

  return <form className={styles.form} onSubmit={e => { e.preventDefault(); void generate() }} data-testid="prompt-creator">
    <div className={styles.content}>
      <div className={styles.brief}>
        <label className={styles.label} htmlFor="app-prompt">App description</label>
        <textarea id="app-prompt" value={options.prompt} onChange={e => update('prompt', e.target.value)} disabled={busy} minLength={20} maxLength={6000} required placeholder="A travel planner for weekend trips. Show an itinerary, saved places, and a packing checklist. Let me add stops and mark items as packed. Keep the design calm and simple." />
        <p className={styles.hint}>Describe who it’s for, the screens you need, and what people can do.</p>
        <div className={styles.connection}>
          <label className={styles.label}>Provider<select value={options.provider} disabled={busy} onChange={e => { const provider = e.target.value as Provider; setOptions(o => ({ ...o, provider, model: DEFAULT_MODELS[provider] })); setApiKey(''); setRevealKey(false) }}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></label>
          <label className={styles.label}>Model<input value={options.model} disabled={busy} required maxLength={100} spellCheck={false} onChange={e => update('model', e.target.value)} /></label>
        </div>
        <label className={styles.label} htmlFor="provider-key">API key</label>
        <div className={styles.key}><input id="provider-key" type={revealKey ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={apiKey} onChange={e => setApiKey(e.target.value)} disabled={busy} placeholder={options.provider === 'openai' ? 'sk-…' : 'sk-ant-…'} required maxLength={512} /><button type="button" disabled={busy} onClick={() => setRevealKey(v => !v)} aria-label={revealKey ? 'Hide API key' : 'Show API key'}>{revealKey ? 'Hide' : 'Show'}</button></div>
        <p className={styles.hint}>Your key is held only while this window is open. Your description and options go through this server to {options.provider === 'openai' ? 'OpenAI' : 'Anthropic'}. Keys are not saved in projects or browser storage. Your provider bills API usage.</p>
      </div>
      <aside className={styles.options} aria-label="Project options">
        <h3>Project options</h3>
        <label className={styles.label}>Pages<select value={options.pageCount} disabled={busy} onChange={e => update('pageCount', Number(e.target.value))}>{[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} {n === 1 ? 'page' : 'pages'}</option>)}</select></label>
        <p className={styles.hint}>Includes detail, form, and settings screens.</p>
        <label className={styles.label}>Navigation<select value={options.navigation} disabled={busy || options.pageCount === 1} onChange={e => update('navigation', e.target.value as GenerationOptions['navigation'])}><option value="tabs">Tab bar</option><option value="stack">Navigation stack</option></select></label>
        <fieldset disabled={busy} className={styles.accents}><legend>Accent color</legend>{(['indigo','blue','teal','orange','purple'] as const).map(color => <label key={color} title={color}><input type="radio" name="accent" value={color} checked={options.accent === color} onChange={() => update('accent', color)} aria-label={color} /><span style={{ background: { indigo:'#6666d9', blue:'#3388ee', teal:'#279f9b', orange:'#dd873b', purple:'#9b65d1' }[color] }} /></label>)}</fieldset>
        <label className={styles.toggle}><span><strong>Sample content</strong><small>Start with realistic example data</small></span><input type="checkbox" checked={options.sampleData} disabled={busy} onChange={e => update('sampleData', e.target.checked)} /></label>
        <label className={styles.toggle}><span><strong>Settings page</strong><small>Included in your page count</small></span><input type="checkbox" checked={options.includeSettings} disabled={busy} onChange={e => update('includeSettings', e.target.checked)} /></label>
        <p className={styles.scope}>Creates a first version with SwiftUI screens and local interactions. Services such as login and payments need separate implementation.</p>
      </aside>
    </div>
    <div className={styles.bottom}>{error && <p role="alert" className={styles.error}>{error}</p>}{busy && <p role="status" aria-live="polite" className={styles.progress}><Icon name="refresh" size={14} className="animate-spin" />{phase === 'checking' ? 'Checking the preview…' : 'Writing your SwiftUI project. This may take a minute…'}</p>}</div>
    <footer className={styles.footer}><span>Review the generated files before opening.</span><div>{busy && <button type="button" className={styles.secondary} onClick={cancel}>Cancel generation</button>}<button className={styles.primary} type="submit" disabled={busy}>{busy ? 'Working…' : 'Generate app'}<Icon name="chevron-right" size={13} /></button></div></footer>
  </form>
}
