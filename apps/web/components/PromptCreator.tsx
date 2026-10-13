'use client'

import { useEffect, useRef, useState } from 'react'
import type { OpenedFile, PromptMessage } from '@studio/project-model'
import { DEFAULT_MODELS, parseGeneratedApp, parseOptions, type GeneratedApp, type GenerationOptions, type Provider } from '../lib/generation/schema'
import { applyRepair, repairable, repairInput } from '../lib/generation/repair'
import { checkPreview, issueText, type PreviewIssue } from '../lib/generation/validate'
import { Icon } from './ui/Icon'
import styles from './PromptCreator.module.css'

const INITIAL: GenerationOptions = { provider: 'openai', model: DEFAULT_MODELS.openai, prompt: '', pageCount: 4, navigation: 'tabs', accent: 'indigo', sampleData: true, includeSettings: false }

export function PromptCreator({ onOpenFiles, onBusy }: { onOpenFiles: (files: readonly OpenedFile[], history?: readonly PromptMessage[]) => Promise<boolean>; onBusy: (busy: boolean) => void }) {
  const [options, setOptions] = useState(INITIAL)
  const [apiKey, setApiKey] = useState('')
  const [revealKey, setRevealKey] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'generating' | 'checking' | 'repairing' | 'opening'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<GeneratedApp | null>(null)
  const [history, setHistory] = useState<readonly PromptMessage[]>([])
  const [issues, setIssues] = useState<PreviewIssue[]>([])
  /** What the last repair said it changed, shown until the draft changes again. */
  const [repaired, setRepaired] = useState<string | null>(null)
  /** Repairs requested for this draft; the first is the automatic one. */
  const [attempts, setAttempts] = useState(0)
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
      const common = { provider: input.provider, model: input.model, kind: 'create' as const }
      const conversation: PromptMessage[] = [
        { ...common, id: crypto.randomUUID(), role: 'user', content: `${input.prompt}\n\nGeneration settings: ${JSON.stringify({ pageCount: input.pageCount, navigation: input.navigation, accent: input.accent, sampleData: input.sampleData, includeSettings: input.includeSettings })}`, createdAt: Date.now() },
        { ...common, id: crypto.randomUUID(), role: 'assistant', content: app.summary, status: 'applied', changedFiles: app.files.map(file => file.path), createdAt: Date.now() },
      ]
      setHistory(conversation)
      setDraft(app); setIssues(found); setRepaired(null); setAttempts(0); setSelectedFile(0)
      // A draft the preview cannot run gets one repair straight away, shown on the
      // review while it works and cancellable there. Only one: a repair that still
      // leaves errors is the person's call to retry, since each request is billed.
      if (repairable(found)) {
        try { await repairDraft(app, found, conversation, request) }
        catch (e) { if (!request.signal.aborted) setError(`The automatic repair did not work, so the draft is unchanged. ${e instanceof Error ? e.message : ''}`.trim()) }
      }
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : 'Could not connect. Please try again.')
    } finally {
      if (controller.current === request) { controller.current = null; setPhase('idle'); onBusy(false) }
    }
  }
  function cancel() { controller.current?.abort() }
  /**
   * One request asking the model to fix what the preview reported, through the same
   * edit endpoint prompt editing uses, billed like any request. The draft only
   * changes when the repaired files are a complete app again, and they are checked
   * like the first draft was. Throws, leaving the draft as it was, when it cannot.
   */
  async function repairDraft(app: GeneratedApp, found: readonly PreviewIssue[], conversation: readonly PromptMessage[], request: AbortController) {
    setPhase('repairing'); setAttempts(count => count + 1)
    const input = repairInput(app, found, { provider: options.provider, model: options.model }, conversation)
    const response = await fetch('/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` }, body: JSON.stringify(input), signal: request.signal })
    const body = await response.json().catch(() => { throw new Error('The studio server could not finish the repair.') })
    if (!response.ok) throw new Error(body.error ?? 'The repair failed.')
    const fixed = applyRepair(app, body.edit)
    setPhase('checking')
    const after = await checkPreview(fixed.app, request.signal)
    if (request.signal.aborted) return
    const common = { provider: options.provider, model: options.model, kind: 'edit' as const }
    setHistory([...conversation,
      { ...common, id: crypto.randomUUID(), role: 'user', content: 'Fix the problems the preview check reported.', createdAt: Date.now() },
      { ...common, id: crypto.randomUUID(), role: 'assistant', content: fixed.reply, status: fixed.changed.length ? 'applied' : 'replied', changedFiles: fixed.changed, createdAt: Date.now() },
    ])
    setDraft(fixed.app); setIssues(after); setRepaired(fixed.changed.length ? fixed.reply : `No files changed. ${fixed.reply}`)
    setSelectedFile(index => Math.min(index, fixed.app.files.length - 1))
  }
  /** Another repair, when the automatic one still left errors. */
  async function repair() {
    if (!draft || controller.current) return
    if (!apiKey.trim()) { setError('Enter your provider API key again to request a repair.'); return }
    setError(null)
    const request = new AbortController()
    controller.current = request
    onBusy(true)
    try { await repairDraft(draft, issues, history, request) }
    catch (e) { if (!request.signal.aborted) setError(`${e instanceof Error ? e.message : 'The repair failed.'} The draft is unchanged.`) }
    finally {
      if (controller.current === request) { controller.current = null; setPhase('idle'); onBusy(false) }
    }
  }
  async function open() {
    if (!draft || busy) return
    setPhase('opening'); onBusy(true); setError(null)
    try {
      if (!await onOpenFiles(draft.files.map(f => ({ name: f.path, text: f.code })), history)) throw new Error('The generated files could not be opened.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open this project.') }
    finally { setPhase('idle'); onBusy(false) }
  }

  const errors = issues.filter(issue => issue.severity === 'error').length
  const provider = options.provider === 'openai' ? 'OpenAI' : 'Anthropic'
  if (draft) return <div ref={review} tabIndex={-1} className={styles.review} data-testid="generated-review" aria-label="Generated project review">
    <div className={styles.summary}><span className={styles.check}><Icon name="check" size={18} /></span><div><h3>{draft.name}</h3><p>{draft.summary}</p></div></div>
    <div className={styles.pages}>{draft.pages.map((p, i) => <span key={`${p.file}:${i}`}>{p.title}</span>)}</div>
    <p className={styles.validation} role="status" data-state={errors ? 'error' : issues.length ? 'warning' : 'ok'}>{errors ? `This draft has ${errors} preview ${errors === 1 ? 'error' : 'errors'}. It will not run in the preview until ${errors === 1 ? 'it is' : 'they are'} fixed.` : issues.length ? 'This draft needs attention in the preview.' : 'Every screen passed the preview check. Review the flows after opening.'}</p>
    {repaired && <p className={styles.repaired} data-testid="repair-reply">AI repair: {repaired}</p>}
    {issues.length > 0 && <details className={styles.issues} open={errors > 0}><summary>{issues.length} preview {issues.length === 1 ? 'issue' : 'issues'}</summary><ul>{issues.map(issue => { const text = issueText(issue); return <li key={text} data-severity={issue.severity}>{text}</li> })}</ul></details>}
    {repairable(issues) && <div className={styles.repair}>
      <button type="button" className={styles.secondary} disabled={busy} onClick={() => void repair()} data-testid="repair-generated"><Icon name="refresh" size={13} className={phase === 'repairing' ? 'animate-spin' : undefined} />{phase === 'repairing' ? 'Fixing…' : phase === 'checking' ? 'Checking…' : attempts ? 'Try again with AI' : 'Fix with AI'}</button>
      <span data-testid="repair-note">{phase === 'repairing' || phase === 'checking'
        ? `Fixing ${errors === 1 ? 'this error' : 'these errors'} with one request to ${provider}. The draft only changes if the fix passes the same checks.`
        : `${attempts ? 'Errors remain after the repair. ' : ''}Sends the files and these errors to ${provider} for one more repair, billed to your key like any request.`}</span>
      {(phase === 'repairing' || phase === 'checking') && <button type="button" className={styles.link} onClick={cancel}>Cancel</button>}
    </div>}
    <div className={styles.files}><nav aria-label="Generated files">{draft.files.map((file, i) => <button type="button" key={file.path} aria-pressed={selectedFile === i} onClick={() => setSelectedFile(i)}><Icon name="new-file" size={14} />{file.path.replace('Sources/', '')}</button>)}</nav><pre tabIndex={0} aria-label="Generated Swift source"><code>{draft.files[selectedFile]?.code}</code></pre></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <footer className={styles.footer}><span>{draft.files.length} Swift files · Opens as a separate project</span><div><button type="button" className={styles.secondary} disabled={busy} onClick={() => { setDraft(null); setError(null) }}>Back to prompt</button><button type="button" className={styles.primary} disabled={busy} onClick={() => void open()} data-testid="open-generated">{phase === 'opening' ? 'Opening…' : issues.length ? 'Open draft' : 'Open project'}<Icon name="chevron-right" size={13} /></button></div></footer>
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
        <p className={styles.hint}>Your key is held only while this window is open. Your description and options go through this server to {options.provider === 'openai' ? 'OpenAI' : 'Anthropic'}. Keys are not saved in projects or browser storage. Your provider bills API usage, including one automatic repair request if the draft fails the preview check.</p>
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
    <div className={styles.bottom}>{error && <p role="alert" className={styles.error}>{error}</p>}{busy && <p role="status" aria-live="polite" className={styles.progress}><Icon name="refresh" size={14} className="animate-spin" />{phase === 'checking' ? 'Checking the preview…' : 'Writing your SwiftUI project. This can take a few minutes…'}</p>}</div>
    <footer className={styles.footer}><span>Review the generated files before opening.</span><div>{busy && <button type="button" className={styles.secondary} onClick={cancel}>Cancel generation</button>}<button className={styles.primary} type="submit" disabled={busy}>{busy ? 'Working…' : 'Generate app'}<Icon name="chevron-right" size={13} /></button></div></footer>
  </form>
}
