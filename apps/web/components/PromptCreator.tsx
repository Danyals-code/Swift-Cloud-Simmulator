'use client'

import { useEffect, useRef, useState } from 'react'
import { projectFromFiles, type OpenedFile, type PromptMessage } from '@studio/project-model'
import { useStudio, type SwitchResult } from '../lib/store'
import { createAttempts, type DraftStamp } from '../lib/promptAttempts'
import { useAiConnection } from '../lib/generation/connection'
import { clearDraft, loadDraft, saveDraft } from '../lib/generation/draft'
import { parseGeneratedApp, parseOptions, type GeneratedApp, type GenerationOptions, type Provider } from '../lib/generation/schema'
import { askAiRoute } from '../lib/generation/aiRoute'
import { describeProblem, previewCheck } from '../lib/generation/problems'
import { answerWithOneRetry } from '../lib/generation/retry'
import { compileSnapshot } from '../lib/compileSnapshot'
import { Icon } from './ui/Icon'
import styles from './PromptCreator.module.css'

/** The project open behind Create with AI, which its attempts are logged in. */
const openProjectId = () => useStudio.getState().project?.id ?? null

/** A draft's files, as a project opens them. */
const openedFiles = (app: GeneratedApp) => app.files.map(file => ({ name: file.path, text: file.code }))

type Phase = 'idle' | 'generating' | 'checking' | 'fixing' | 'opening'
/** What the panel says while it works, in each phase. */
const PROGRESS = { generating: 'Writing your SwiftUI project. This may take a minute…', checking: 'Checking every screen in the preview…', fixing: 'The draft had an error. Asking the AI to fix it…', opening: 'Opening your app…' } satisfies Record<Exclude<Phase, 'idle'>, string>

/** The options besides the connection, which is the tab's. */
type AppOptions = Omit<GenerationOptions, 'provider' | 'model'>
// The study's apps have 2 or 3 screens (G2).
const INITIAL: AppOptions = { prompt: '', pageCount: 3, navigation: 'tabs', accent: 'indigo', sampleData: true, includeSettings: false }

/**
 * Create with AI.
 *
 * The connection is the tab's, shared with Prompt Editing (G3), and a draft is kept
 * for the tab until it is opened or thrown away (G13): the panel closing loses neither.
 * Every screen of a draft is checked in the preview, and a draft with errors is asked
 * for once more, with them; one still broken is shown with its problems (G2).
 * `onDraft` tells the gallery whether a draft is waiting, and `onConfirmDiscard` asks
 * before one is thrown away.
 */
export function PromptCreator({ onOpenFiles, onBusy, onDraft, onConfirmDiscard }: {
  onOpenFiles: (files: readonly OpenedFile[], history?: readonly PromptMessage[]) => Promise<SwitchResult>
  onBusy: (busy: boolean) => void
  onDraft: (waiting: boolean) => void
  onConfirmDiscard: (discard: () => void) => void
}) {
  const [kept] = useState(loadDraft)
  const { connection, chooseProvider, setModel, setKey } = useAiConnection()
  const [options, setOptions] = useState(INITIAL)
  const [revealKey, setRevealKey] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<GeneratedApp | null>(kept?.app ?? null)
  const [history, setHistory] = useState<readonly PromptMessage[]>(kept?.history ?? [])
  const [issues, setIssues] = useState<readonly string[]>(kept?.issues ?? [])
  const [stamp, setStamp] = useState<DraftStamp | undefined>(kept?.stamp)
  const [selectedFile, setSelectedFile] = useState(0)
  const controller = useRef<AbortController | null>(null)
  const review = useRef<HTMLDivElement | null>(null)
  const busy = phase !== 'idle'
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    onDraft(draft !== null)
    return () => onDraft(false)
  }, [draft, onDraft])
  useEffect(() => { if (draft) review.current?.focus() }, [draft])
  const update = <K extends keyof AppOptions>(key: K, value: AppOptions[K]) => setOptions(current => ({ ...current, [key]: value }))

  async function generate() {
    if (controller.current) return
    setError(null)
    let input: GenerationOptions
    try {
      input = parseOptions({ ...options, provider: connection.provider, model: connection.model })
      if (!connection.key.trim()) throw new Error('Enter your provider API key.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Check your project options.'); return }
    const request = new AbortController()
    controller.current = request
    setPhase('generating'); onBusy(true)
    const settings = { pageCount: input.pageCount, navigation: input.navigation, accent: input.accent, sampleData: input.sampleData, includeSettings: input.includeSettings }
    const attempt = createAttempts.sent(openProjectId(), { prompt: input.prompt, provider: input.provider, model: input.model, settings })
    // A new app has no errors of its own yet, so every error the preview finds in a draft is
    // the answer's. It checks every screen, on the device and target the new project gets.
    const check = previewCheck(project => compileSnapshot(project, request.signal), null)
    /** A check that could not finish, which must not cost the paid draft. */
    let unchecked = false
    try {
      const { answer: app, problems, secondTryFailed } = await answerWithOneRetry({
        ask: previousAttempt => askAiRoute('/api/generate', {
          key: connection.key, body: input, previousAttempt, signal: request.signal, responded: status => attempt.responded(status),
          defaultError: 'The studio server could not finish this request. Check your connection or try a smaller app.',
          read: answer => parseGeneratedApp(answer.app, input.pageCount),
        }),
        check: async app => {
          setPhase('checking')
          attempt.checking()
          try { return await check(projectFromFiles(openedFiles(app))!) }
          catch (error) {
            if (request.signal.aborted) throw error
            unchecked = true
            return []
          }
        },
        retrying: found => { setPhase('fixing'); attempt.retried(found.length) },
      })
      if (request.signal.aborted) { attempt.stopped(request.signal); return }
      const found = [
        ...problems.map(describeProblem),
        ...(secondTryFailed ? [`The AI could not be asked to fix this: ${secondTryFailed.message}`] : []),
        ...(unchecked ? ['The preview check could not finish, so some screens were not checked. Try them after opening.'] : []),
      ]
      const common = { provider: input.provider, model: input.model, kind: 'create' as const }
      const conversation: PromptMessage[] = [
        { ...common, id: crypto.randomUUID(), role: 'user', content: `${input.prompt}\n\nGeneration settings: ${JSON.stringify(settings)}`, createdAt: Date.now() },
        { ...common, id: crypto.randomUUID(), role: 'assistant', content: app.summary, status: 'applied', changedFiles: app.files.map(file => file.path), createdAt: Date.now() },
      ]
      saveDraft({ app, issues: found, history: conversation, stamp: attempt.stamp })
      setHistory(conversation); setDraft(app); setIssues(found); setStamp(attempt.stamp); setSelectedFile(0)
      attempt.ended({ action: 'answered', files: app.files.length, issues: found.length })
    } catch (e) {
      attempt.stopped(request.signal)
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
      // Staying with an unsaved project is a choice, not a failure: the draft waits here.
      const opened = await onOpenFiles(openedFiles(draft), history)
      if (opened === 'failed') throw new Error('The generated files could not be opened.')
      if (opened === 'opened') {
        const project = openProjectId()
        if (stamp && project) createAttempts.draftOpened(stamp, project)
        clearDraft()
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open this project.') }
    finally { setPhase('idle'); onBusy(false) }
  }

  if (draft) return <div ref={review} tabIndex={-1} className={styles.review} data-testid="generated-review" aria-label="Generated project review">
    <div className={styles.summary}><span className={styles.check}><Icon name="check" size={18} /></span><div><h3>{draft.name}</h3><p>{draft.summary}</p></div></div>
    <div className={styles.pages}>{draft.pages.map((p, i) => <span key={`${p.file}:${i}`}>{p.title}</span>)}</div>
    <p className={styles.validation} role="status">{issues.length ? 'The preview found problems in this draft. You can open it and fix them, or go back to the prompt.' : 'Every screen passed the preview check.'}</p>
    {issues.length > 0 && <details className={styles.issues} open><summary>{issues.length} preview {issues.length === 1 ? 'problem' : 'problems'}</summary><ul>{issues.map(i => <li key={i}>{i}</li>)}</ul></details>}
    <div className={styles.files}><nav aria-label="Generated files">{draft.files.map((file, i) => <button type="button" key={file.path} aria-pressed={selectedFile === i} onClick={() => setSelectedFile(i)}><Icon name="new-file" size={14} />{file.path.replace('Sources/', '')}</button>)}</nav><pre tabIndex={0} aria-label="Generated Swift source"><code>{draft.files[selectedFile]?.code}</code></pre></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <footer className={styles.footer}><span>{draft.files.length} Swift files · Opens as a separate project</span><div><button type="button" className={styles.secondary} disabled={busy} onClick={() => onConfirmDiscard(() => { if (stamp) createAttempts.draftDiscarded(stamp); clearDraft(); setDraft(null); setStamp(undefined); setError(null) })}>Back to prompt</button><button type="button" className={styles.primary} disabled={busy} onClick={() => void open()} data-testid="open-generated">{busy ? 'Opening…' : issues.length ? 'Open draft' : 'Open project'}<Icon name="chevron-right" size={13} /></button></div></footer>
  </div>

  return <form className={styles.form} onSubmit={e => { e.preventDefault(); void generate() }} data-testid="prompt-creator">
    <div className={styles.content}>
      <div className={styles.brief}>
        <label className={styles.label} htmlFor="app-prompt">App description</label>
        <textarea id="app-prompt" value={options.prompt} onChange={e => update('prompt', e.target.value)} disabled={busy} minLength={20} maxLength={6000} required placeholder="A travel planner for weekend trips. Show an itinerary, saved places, and a packing checklist. Let me add stops and mark items as packed. Keep the design calm and simple." />
        <p className={styles.hint}>Describe who it’s for, the screens you need, and what people can do.</p>
        <div className={styles.connection}>
          <label className={styles.label}>Provider<select value={connection.provider} disabled={busy} onChange={e => { chooseProvider(e.target.value as Provider); setRevealKey(false) }}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></label>
          <label className={styles.label}>Model<input value={connection.model} disabled={busy} required maxLength={100} spellCheck={false} onChange={e => setModel(e.target.value)} /></label>
        </div>
        <label className={styles.label} htmlFor="provider-key">API key</label>
        <div className={styles.key}><input id="provider-key" type={revealKey ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={connection.key} onChange={e => setKey(e.target.value)} disabled={busy} placeholder={connection.provider === 'openai' ? 'sk-…' : 'sk-ant-…'} required maxLength={512} /><button type="button" disabled={busy} onClick={() => setRevealKey(v => !v)} aria-label={revealKey ? 'Hide API key' : 'Show API key'}>{revealKey ? 'Hide' : 'Show'}</button></div>
        <p className={styles.hint}>Your key is kept in this browser tab until you close it, and never in a project. Your description and options go through this server to {connection.provider === 'openai' ? 'OpenAI' : 'Anthropic'}. Your provider bills API usage.</p>
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
    <div className={styles.bottom}>{error && <p role="alert" className={styles.error}>{error}</p>}{busy && <p role="status" aria-live="polite" className={styles.progress}><Icon name="refresh" size={14} className="animate-spin" />{PROGRESS[phase]}</p>}</div>
    <footer className={styles.footer}><span>Review the generated files before opening.</span><div>{busy && <button type="button" className={styles.secondary} onClick={cancel}>Cancel generation</button>}<button className={styles.primary} type="submit" disabled={busy}>{busy ? 'Working…' : 'Generate app'}<Icon name="chevron-right" size={13} /></button></div></footer>
  </form>
}
