'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { AuthoringNode, NavigationDestination, SourceSpan } from '@studio/shared'
import type { FeatureProps } from './AuthoringFeatures'
import { Icon } from './ui/Icon'
import styles from './AuthoringInspector.module.css'

interface Props {
  owner: AuthoringNode
  features?: Omit<FeatureProps, 'node'>
  onReveal?: (source: SourceSpan) => void
}

export const navigationDestinationEditorId = (owner: AuthoringNode) => `navigation-destination-${owner.id}`

/** The label is friendly; the selected Swift expression, including its arguments, is retained. */
export function NavigationDestinationEditor({ owner, features, onReveal }: Props) {
  const info = owner.navigation
  const current = info?.destination ?? owner.properties.find(property => property.name === 'destination' || property.name === 'value')?.expression ?? ''
  const choices = info?.destinations ?? []
  const selected = choices.find(choice => choice.expression === current)
  const initial = { text: selected?.title ?? info?.display ?? current, expression: current }
  const [draft, setDraft] = useState<{ text: string; expression?: string }>(initial)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [busy, setBusy] = useState<'apply' | 'pick' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const mounted = useRef(true)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const editable = info?.editable === true
  const disabled = !!busy || !editable || !features?.onNodeCommand
  const matches = choices.filter(choice => `${choice.title} ${choice.viewName} ${choice.expression}`.toLowerCase().includes(query.trim().toLowerCase()))
  const enabled = matches.flatMap((choice, index) => choice.available ? [index] : [])
  const choose = (choice: NavigationDestination) => {
    if (!choice.available || disabled) return
    setDraft({ text: choice.title, expression: choice.expression })
    setQuery(''); setOpen(false); setActive(-1); setError(null); setSaved(false)
    input.current?.focus()
  }
  const destination = () => {
    if (draft.expression !== undefined) return draft.expression
    const typed = draft.text.trim()
    const named = choices.filter(choice => choice.available && [choice.title, choice.viewName, choice.expression].some(name => name.toLowerCase() === typed.toLowerCase()))
    return named.length === 1 ? named[0]!.expression : typed
  }
  const apply = async () => {
    if (disabled || !features?.onNodeCommand) return
    const expression = destination()
    if (!expression.trim()) { setError('Choose a screen or enter its view name.'); return }
    if (expression === current) { setOpen(false); return }
    setBusy('apply'); setError(null); setSaved(false); setOpen(false)
    try {
      const problem = await features.onNodeCommand(owner, { kind: 'navigation-target', destination: expression })
      if (mounted.current) { setError(problem); setSaved(!problem) }
    } catch { if (mounted.current) setError('The destination could not be updated. Try again.') }
    finally { if (mounted.current) setBusy(null) }
  }
  const pick = async () => {
    if (disabled || !features?.onPickNavigation) return
    setBusy('pick'); setError(null); setSaved(false); setOpen(false)
    try {
      const expression = await features.onPickNavigation(choices)
      if (mounted.current && expression) {
        const choice = choices.find(item => item.expression === expression)
        setDraft({ text: choice?.title ?? expression, expression }); setQuery(''); setActive(-1)
      }
    } catch { if (mounted.current) setError('The screen could not be picked. Try again.') }
    finally { if (mounted.current) setBusy(null) }
  }
  if (!editable) return <div id={navigationDestinationEditorId(owner)} className={styles.destinationEditor} data-testid="navigation-destination-editor">
    {current && <p>Current destination: <code>{current}</code></p>}
    <p>{info?.reason ?? 'This navigation uses a destination that cannot be edited visually yet.'}</p>
    {onReveal && <button type="button" onClick={() => onReveal(owner.source)}>Open in Code</button>}
  </div>
  return <div id={navigationDestinationEditorId(owner)} className={styles.destinationEditor} data-testid="navigation-destination-editor" data-settings-owner={`${owner.owner}:${owner.name}:${owner.source.file}:${owner.source.start}`} aria-busy={!!busy} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false) }}>
    <label htmlFor={`${listId}-input`}>Navigate to</label>
    <div className={styles.destinationPicker}>
      <div className={styles.destinationInput}>
        <input ref={input} id={`${listId}-input`} type="text" role="combobox" aria-label="Navigate to" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && active >= 0 && matches[active] ? `${listId}-${active}` : undefined} aria-invalid={!!error} autoComplete="off" spellCheck={false} disabled={disabled} value={draft.text} placeholder="Search screens or type a view name" onFocus={() => setOpen(true)}
          onChange={event => { setDraft({ text: event.target.value }); setQuery(event.target.value); setOpen(true); setActive(-1); setError(null); setSaved(false) }}
          onKeyDown={event => {
            if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1) }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setOpen(true)
              const position = enabled.indexOf(active), next = position < 0 ? event.key === 'ArrowDown' ? 0 : enabled.length - 1 : (position + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length
              setActive(enabled[next] ?? -1)
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              if (open && active >= 0 && matches[active]?.available) choose(matches[active]!)
              else void apply()
            }
          }} />
        <button type="button" aria-label="Choose destination" title="Choose destination" aria-expanded={open} aria-controls={listId} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => { setQuery(''); setActive(-1); setOpen(!open); input.current?.focus() }}><Icon name="chevron-down" /></button>
      </div>
      {open && !disabled && <div id={listId} role="listbox" aria-label="Screens" className={styles.destinationOptions}>
        {matches.map((choice, index) => <button key={choice.expression} id={`${listId}-${index}`} type="button" role="option" aria-selected={draft.expression === choice.expression} aria-disabled={!choice.available} data-active={active === index || undefined} tabIndex={-1} disabled={!choice.available} onMouseDown={event => event.preventDefault()} onClick={() => choose(choice)}>
          <span>{choice.title}</span><small>{choice.available ? choice.expression : choice.reason ?? 'This screen needs additional inputs.'}</small>
        </button>)}
        {!matches.length && <p>No matching screens. You can enter a view name or destination expression.</p>}
      </div>}
    </div>
    <p className={styles.destinationCurrent}>Current: <code>{current || 'No destination'}</code></p>
    {info.scopeDescription && <p className={styles.note}>{info.scopeDescription}</p>}
    {/* WebKit moves focus on a press, which closed the list above and moved these buttons out from under the click (D13). */}
    <div className={styles.destinationActions} onMouseDown={event => event.preventDefault()}>
      <button type="button" disabled={disabled || !draft.text.trim() || destination() === current} onClick={() => void apply()}>Apply destination</button>
      {features?.onPickNavigation && <button type="button" className={styles.destinationPick} disabled={disabled || !choices.some(choice => choice.available)} onClick={() => void pick()}><Icon name="inspect" />Pick screen from canvas</button>}
    </div>
    {busy && <p role="status">{busy === 'pick' ? 'Choose a screen on the canvas. Press Escape to cancel.' : 'Updating destination…'}</p>}
    {saved && !busy && <p role="status">Destination updated.</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>
}
