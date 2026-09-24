'use client'

import { useEffect, useRef, useState } from 'react'
import type { PromptMessage, PromptSelection } from '@studio/project-model'
import { useStudio } from '../lib/store'
import { DEFAULT_MODELS, type Provider } from '../lib/generation/schema'
import { parsePromptEditInput, promptConversationContext } from '../lib/generation/edit-schema'
import { preparePromptEdit, promptPreviewProblem } from '../lib/generation/applyPromptEdit'
import { compileSnapshot } from '../lib/compileSnapshot'
import { events } from '../lib/eventLog'
import { promptAttempts } from '../lib/promptAttempts'
import { Icon } from './ui/Icon'
import styles from './PromptEditor.module.css'

export function PromptEditor({ selection, stale, onApplied }: { selection: PromptSelection | null; stale: boolean; onApplied: () => void }) {
  const project = useStudio(state => state.project)
  const [provider, setProvider] = useState<Provider>('openai'), [model, setModel] = useState(DEFAULT_MODELS.openai), [apiKey, setApiKey] = useState('')
  const [prompt, setPrompt] = useState(''), [phase, setPhase] = useState<'idle' | 'editing' | 'checking'>('idle')
  const [error, setError] = useState<string | null>(null), [connectionOpen, setConnectionOpen] = useState(false)
  const [dismissedSelection, setDismissedSelection] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null), conversation = useRef<HTMLDivElement>(null)
  const [attempts] = useState(() => promptAttempts(events, 'edit'))
  const selectionKey = JSON.stringify(selection), context = dismissedSelection === selectionKey ? null : selection
  const busy = phase !== 'idle'
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { conversation.current?.scrollTo({ top: conversation.current.scrollHeight }) }, [project?.chatHistory?.length, phase])

  async function send() {
    if (!project || controller.current || stale) return
    setError(null)
    const before = useStudio.getState()
    if (!before.project || before.project.id !== project.id) return
    let input
    try {
      if (!/^[\x21-\x7e]{20,512}$/.test(apiKey.trim())) { setConnectionOpen(true); throw new Error('Enter your provider API key to start editing.') }
      input = parsePromptEditInput({ provider, model, prompt, files: before.project.files, selection: context, history: promptConversationContext(before.project.chatHistory ?? []), project: { name: before.project.manifest.name, deploymentTarget: before.project.manifest.deploymentTarget, images: before.project.assets?.map(asset => asset.name) ?? [], colors: before.project.colors?.map(color => color.name) ?? [] } })
      // Reserve space for the answer; never silently truncate a saved conversation.
      if ((before.project.chatHistory?.length ?? 0) > 998) throw new Error('This conversation is full. Export the project to keep its history.')
      if (JSON.stringify(before.project.chatHistory ?? []).length + input.prompt.length + 16000 > 2_000_000) throw new Error('This conversation is full. Export the project to keep its history.')
    } catch (error) { setError(error instanceof Error ? error.message : 'Check the prompt settings.'); return }
    const request = new AbortController(), projectId = project.id
    const common = { provider, model, kind: 'edit' as const }
    const user: PromptMessage = { ...common, id: crypto.randomUUID(), role: 'user', content: input.prompt, createdAt: Date.now(), ...(context ? { selection: context } : {}) }
    const problem = before.appendPromptMessages(projectId, [user])
    if (problem) { setError(problem); return }
    attempts.sent(projectId, { prompt: input.prompt, provider, model, ...(context ? { selection: true } : {}) })
    const current = useStudio.getState(), expected = current.project!, revision = current.documentRevision
    controller.current = request; setPrompt(''); setPhase('editing'); setConnectionOpen(false)
    const reply = (content: string, status: PromptMessage['status'], changedFiles?: readonly string[]) => useStudio.getState().appendPromptMessages(projectId, [{ ...common, id: crypto.randomUUID(), role: 'assistant', content, status, createdAt: Date.now(), changedFiles }])
    // How far the attempt got, for the event log.
    let stage: 'request' | 'answer' | 'preview' = 'request', status: number | undefined, movedOn = false
    try {
      const response = await fetch('/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` }, body: JSON.stringify(input), signal: request.signal })
      if (!response.ok) status = response.status
      const body = await response.json().catch(() => { throw new Error('The server could not finish this edit. No changes applied.') })
      if (!response.ok) throw new Error(body.error ?? 'The edit failed. No changes applied.')
      request.signal.throwIfAborted()
      stage = 'answer'
      const prepared = preparePromptEdit(expected, revision, body.edit)
      if (prepared.transaction.changes.length) {
        setPhase('checking')
        stage = 'preview'
        const result = await compileSnapshot(prepared.candidate, request.signal)
        const problem = promptPreviewProblem(result)
        if (problem) throw new Error(problem)
      }
      request.signal.throwIfAborted()
      const problem = useStudio.getState().commitTransaction(expected, prepared.transaction, null)
      if (problem) { movedOn = true; throw new Error(`${problem} No AI changes applied.`) }
      const applied = prepared.transaction.changes.length > 0
      attempts.ended(applied ? { action: 'applied', files: prepared.transaction.changes.length } : { action: 'replied' })
      const historyError = reply(prepared.edit.reply, applied ? 'applied' : 'replied', prepared.transaction.changes.map(change => change.file))
      if (historyError) setError(historyError)
      if (applied) onApplied()
    } catch (error) {
      attempts.ended(request.signal.aborted ? { action: 'cancelled' } : movedOn ? { action: 'discarded' } : { action: 'failed', stage, ...(status ? { status } : {}) })
      const message = request.signal.aborted ? 'Cancelled. No changes applied.' : error instanceof Error ? error.message.slice(0, 500) : 'The edit failed. No changes applied.'
      const historyError = reply(message, request.signal.aborted ? 'cancelled' : 'failed')
      if (historyError && useStudio.getState().project?.id === projectId) setError(historyError)
    } finally { if (controller.current === request) { controller.current = null; setPhase('idle') } }
  }

  return <section className={styles.panel} aria-label="Prompt Editing" data-testid="prompt-editor">
    <header className={styles.header}><div><strong>Prompt Editing</strong><small>Edit your app by describing it.</small></div><button type="button" aria-label="AI connection settings" aria-expanded={connectionOpen} onClick={() => setConnectionOpen(open => !open)}><Icon name="settings" size={15} /></button></header>
    {connectionOpen && <fieldset className={styles.connection} disabled={busy}><legend>AI connection</legend>
      <label>Provider<select value={provider} onChange={event => { const next = event.target.value as Provider; setProvider(next); setModel(DEFAULT_MODELS[next]); setApiKey('') }}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></label>
      <label>Model<input value={model} maxLength={100} spellCheck={false} onChange={event => setModel(event.target.value)} /></label>
      <label>API key<input type="password" autoComplete="off" spellCheck={false} value={apiKey} maxLength={512} onChange={event => setApiKey(event.target.value)} placeholder="Paste your API key" /></label>
      <p>The key stays in memory. Your prompt, recent chat and project source are sent to {provider === 'openai' ? 'OpenAI' : 'Anthropic'} when you send. API usage is billed by your provider.</p>
    </fieldset>}
    <div className={styles.conversation} ref={conversation} role="log" aria-label="Prompt conversation" aria-live="polite">
      {!project?.chatHistory?.length && <div className={styles.empty}><Icon name="text-lines" size={24} /><h3>What would you like to change?</h3><p>Select a view on the canvas to target it, or describe a change to the whole app.</p><p>Edits update the canvas and Swift together. Use Undo to reverse them.</p></div>}
      {project?.chatHistory?.map(message => <article key={message.id} className={styles.message} data-role={message.role} data-status={message.status}>
        <div><strong>{message.role === 'user' ? 'You' : 'AI'}</strong>{message.status === 'applied' && <span>Applied</span>}{message.status === 'failed' && <span>Not applied</span>}{message.status === 'cancelled' && <span>Cancelled</span>}</div>
        {message.selection && <small className={styles.messageContext}>{message.selection.label}</small>}
        <p>{message.content}</p>
        {!!message.changedFiles?.length && <details><summary>{message.changedFiles.length} {message.changedFiles.length === 1 ? 'file' : 'files'} changed</summary>{message.changedFiles.map(file => <small key={file}>{file}</small>)}</details>}
      </article>)}
      {busy && <p className={styles.progress} role="status"><Icon name="refresh" size={13} className="animate-spin" />{phase === 'checking' ? 'Checking the changes…' : 'Editing your app…'}</p>}
    </div>
    <form className={styles.composer} onSubmit={event => { event.preventDefault(); void send() }}>
      {context && <div className={styles.selection} data-testid="prompt-selection" title={`${context.owner} · ${context.file}`}><Icon name="focus" size={12} /><span>{context.label}</span><button type="button" aria-label="Remove selection context" onClick={() => setDismissedSelection(selectionKey)}>×</button></div>}
      <label className={styles.promptLabel} htmlFor="edit-prompt">Describe a change</label>
      <textarea id="edit-prompt" value={prompt} maxLength={6000} rows={3} disabled={busy} placeholder={context ? `Change ${context.label}…` : 'What should we change?'} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.composerActions}><small>{stale ? 'Preview updating…' : 'Enter to send · Shift+Enter for a new line'}</small>{busy ? <button type="button" onClick={() => controller.current?.abort()}>Stop</button> : <button type="submit" disabled={!prompt.trim() || stale}>Send<Icon name="chevron-right" size={12} /></button>}</div>
      <small className={styles.saved}>Chat is saved with this project and included in exports.</small>
    </form>
  </section>
}
