'use client'

import { useEffect, useRef, useState } from 'react'
import type { PromptMessage, PromptSelection } from '@studio/project-model'
import { useStudio, type AiEditPhase } from '../lib/store'
import type { Provider } from '../lib/generation/schema'
import { useAiConnection } from '../lib/generation/connection'
import { parsePromptEditInput, promptConversationContext } from '../lib/generation/edit-schema'
import { preparePromptEdit } from '../lib/generation/applyPromptEdit'
import { askAiRoute } from '../lib/generation/aiRoute'
import { describeProblem, previewCheck } from '../lib/generation/problems'
import { answerWithOneRetry } from '../lib/generation/retry'
import { compileSnapshot } from '../lib/compileSnapshot'
import { editAttempts } from '../lib/promptAttempts'
import { Icon } from './ui/Icon'
import styles from './PromptEditor.module.css'

/** What the conversation says while the AI edits, in each phase of the edit. */
const PROGRESS = { editing: 'Editing your app…', checking: 'Checking the changes…', fixing: 'The change had an error. Asking the AI to fix it…' } satisfies Record<AiEditPhase, string>

/**
 * Prompt Editing.
 *
 * Its request holds the project through the store rather than living with this panel
 * (G12): nothing else changes the project until the answer lands, collapsing the panel
 * leaves the request running, and Stop is offered wherever the studio shows it. The
 * connection is the tab's, shared with Create with AI (G3). An answer that brings the
 * preview new errors is asked for once more, with them, and a second broken answer
 * leaves the project as it was (G2).
 */
export function PromptEditor({ selection, stale, onApplied }: { selection: PromptSelection | null; stale: boolean; onApplied: () => void }) {
  const project = useStudio(state => state.project)
  const aiEdit = useStudio(state => state.aiEdit)
  const { connection, chooseProvider, setModel, setKey } = useAiConnection()
  const { provider, model, key: apiKey } = connection
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string | null>(null), [connectionOpen, setConnectionOpen] = useState(false)
  const [dismissedSelection, setDismissedSelection] = useState<string | null>(null)
  const conversation = useRef<HTMLDivElement>(null)
  const selectionKey = JSON.stringify(selection), context = dismissedSelection === selectionKey ? null : selection
  const busy = aiEdit !== null
  useEffect(() => { conversation.current?.scrollTo({ top: conversation.current.scrollHeight }) }, [project?.chatHistory?.length, aiEdit])

  async function send() {
    if (!project || busy || stale) return
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
    const projectId = project.id
    const common = { provider, model, kind: 'edit' as const }
    const user: PromptMessage = { ...common, id: crypto.randomUUID(), role: 'user', content: input.prompt, createdAt: Date.now(), ...(context ? { selection: context } : {}) }
    const problem = before.appendPromptMessages(projectId, [user])
    if (problem) { setError(problem); return }
    const request = new AbortController()
    const hold = useStudio.getState().holdForAi(() => request.abort())
    if (!hold) { setError('The AI is already editing this project.'); return }
    const current = useStudio.getState(), expected = current.project!, revision = current.documentRevision
    setPrompt(''); setConnectionOpen(false)
    const attempt = editAttempts.sent(projectId, { prompt: input.prompt, provider, model, ...(context ? { selection: true } : {}) })
    const reply = (content: string, status: PromptMessage['status'], changedFiles?: readonly string[]) => useStudio.getState().appendPromptMessages(projectId, [{ ...common, id: crypto.randomUUID(), role: 'assistant', content, status, createdAt: Date.now(), changedFiles }])
    /** An answer that came to a project which had moved on since. */
    let movedOn = false
    try {
      // An error the project already had is not the answer's doing, so it blocks nothing.
      const check = previewCheck(project => compileSnapshot(project, request.signal), expected)
      const { answer: prepared, problems, secondTryFailed } = await answerWithOneRetry({
        ask: previousAttempt => askAiRoute('/api/edit', {
          key: apiKey, body: input, previousAttempt, signal: request.signal, responded: status => attempt.responded(status),
          defaultError: 'The server could not finish this edit. No changes applied.',
          read: answer => preparePromptEdit(expected, revision, answer.edit),
        }),
        check: async next => {
          if (!next.transaction.changes.length) return []
          hold.checking()
          attempt.checking()
          return check(next.candidate)
        },
        retrying: found => { hold.fixing(); attempt.retried(found.length) },
      })
      if (problems.length) throw new Error(secondTryFailed
        ? `The AI's change had an error, and asking it again failed: ${secondTryFailed.message}`
        : `The AI's change still had an error after a second try, so nothing was changed: ${describeProblem(problems[0]!)} Try a smaller change, or describe it another way.`)
      request.signal.throwIfAborted()
      const problem = hold.commit(expected, prepared.transaction)
      if (problem) { movedOn = true; throw new Error(`${problem} No AI changes applied.`) }
      const applied = prepared.transaction.changes.length > 0
      attempt.ended(applied ? { action: 'applied', files: prepared.transaction.changes.length } : { action: 'replied' })
      const historyError = reply(prepared.edit.reply, applied ? 'applied' : 'replied', prepared.transaction.changes.map(change => change.file))
      if (historyError) setError(historyError)
      if (applied) onApplied()
    } catch (error) {
      if (movedOn) attempt.ended({ action: 'discarded' })
      else attempt.stopped(request.signal)
      const message = request.signal.aborted ? 'Cancelled. No changes applied.' : error instanceof Error ? error.message.slice(0, 500) : 'The edit failed. No changes applied.'
      const historyError = reply(message, request.signal.aborted ? 'cancelled' : 'failed')
      if (historyError && useStudio.getState().project?.id === projectId) setError(historyError)
    } finally { hold.release() }
  }

  return <section className={styles.panel} aria-label="Prompt Editing" data-testid="prompt-editor">
    <header className={styles.header}><div><strong>Prompt Editing</strong><small>Edit your app by describing it.</small></div><button type="button" aria-label="AI connection settings" aria-expanded={connectionOpen} onClick={() => setConnectionOpen(open => !open)}><Icon name="settings" size={15} /></button></header>
    {connectionOpen && <fieldset className={styles.connection} disabled={busy}><legend>AI connection</legend>
      <label>Provider<select value={provider} onChange={event => chooseProvider(event.target.value as Provider)}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></label>
      <label>Model<input value={model} maxLength={100} spellCheck={false} onChange={event => setModel(event.target.value)} /></label>
      <label>API key<input type="password" autoComplete="off" spellCheck={false} value={apiKey} maxLength={512} onChange={event => setKey(event.target.value)} placeholder="Paste your API key" /></label>
      <p>The key is kept in this browser tab until you close it, and never in the project. Your prompt, recent chat and project source are sent to {provider === 'openai' ? 'OpenAI' : 'Anthropic'} when you send. API usage is billed by your provider.</p>
    </fieldset>}
    <div className={styles.conversation} ref={conversation} role="log" aria-label="Prompt conversation" aria-live="polite">
      {!project?.chatHistory?.length && <div className={styles.empty}><Icon name="text-lines" size={24} /><h3>What would you like to change?</h3><p>Select a view on the canvas to target it, or describe a change to the whole app.</p><p>Edits update the canvas and Swift together. Use Undo to reverse them.</p></div>}
      {project?.chatHistory?.map(message => <article key={message.id} className={styles.message} data-role={message.role} data-status={message.status}>
        <div><strong>{message.role === 'user' ? 'You' : 'AI'}</strong>{message.status === 'applied' && <span>Applied</span>}{message.status === 'failed' && <span>Not applied</span>}{message.status === 'cancelled' && <span>Cancelled</span>}</div>
        {message.selection && <small className={styles.messageContext}>{message.selection.label}</small>}
        <p>{message.content}</p>
        {!!message.changedFiles?.length && <details><summary>{message.changedFiles.length} {message.changedFiles.length === 1 ? 'file' : 'files'} changed</summary>{message.changedFiles.map(file => <small key={file}>{file}</small>)}</details>}
      </article>)}
      {aiEdit && <p className={styles.progress} role="status"><Icon name="refresh" size={13} className="animate-spin" />{PROGRESS[aiEdit.phase]}</p>}
    </div>
    <form className={styles.composer} onSubmit={event => { event.preventDefault(); void send() }}>
      {context && <div className={styles.selection} data-testid="prompt-selection" title={`${context.owner} · ${context.file}`}><Icon name="focus" size={12} /><span>{context.label}</span><button type="button" aria-label="Remove selection context" onClick={() => setDismissedSelection(selectionKey)}>×</button></div>}
      <label className={styles.promptLabel} htmlFor="edit-prompt">Describe a change</label>
      <textarea id="edit-prompt" value={prompt} maxLength={6000} rows={3} disabled={busy} placeholder={context ? `Change ${context.label}…` : 'What should we change?'} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} />
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.composerActions}><small>{stale ? 'Preview updating…' : 'Enter to send · Shift+Enter for a new line'}</small>{busy ? <button type="button" onClick={() => useStudio.getState().stopAiEdit()}>Stop</button> : <button type="submit" disabled={!prompt.trim() || stale}>Send<Icon name="chevron-right" size={12} /></button>}</div>
      <small className={styles.saved}>Chat is saved with this project and included in exports.</small>
    </form>
  </section>
}
