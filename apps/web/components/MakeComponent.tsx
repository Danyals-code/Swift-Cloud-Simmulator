'use client'

import { useEffect, useState } from 'react'
import { parameterNames } from '@studio/swift-sema'
import type { AuthoringNode, CopyMatch, CopyValue } from '@studio/shared'
import styles from './AuthoringInspector.module.css'

export interface CopySearch {
  readonly copies: readonly CopyMatch[]
  readonly values: readonly CopyValue[]
  readonly eligible: boolean
  readonly reason?: string
}

export interface MakeComponentProps {
  node: AuthoringNode
  busy: boolean
  /** Looks for views with this one's shape. Asked once the designer opens the flow. */
  onFind: (node: AuthoringNode) => Promise<CopySearch>
  onMake: (name: string, copies: readonly string[], names: Readonly<Record<string, string>>) => Promise<string | null>
  /** Brings a copy into view, so "which one is that?" has an answer. */
  onShow?: (copy: CopyMatch) => void
  /** Set after the same view has been pasted a third time. */
  nudge?: boolean
  onDismissNudge?: () => void
}

/** A plain starting name, from what the view is: a row, a card, a button. */
const NAMES: Readonly<Record<string, string>> = { HStack: 'RowView', VStack: 'CardView', ZStack: 'OverlayView', Button: 'ActionButton', Label: 'LabelView' }
const suggestName = (node: AuthoringNode): string => NAMES[node.name] ?? `${node.name}View`

/**
 * Make component: the view becomes the Main, its copies become calls.
 *
 * The copies are found for the designer rather than asked for, because that is the
 * order the work actually happens in - people copy first and name the thing later.
 * Every value the ticked copies disagree on becomes a parameter, shown by name
 * before anything is written, so the result is never a surprise.
 */
export function MakeComponent({ node, busy, onFind, onMake, onShow, nudge, onDismissNudge }: MakeComponentProps) {
  const [open, setOpen] = useState(false)
  // Kept with the view it describes, so a different selection reads as "looking"
  // rather than showing the copies of something else.
  const [found, setFound] = useState<{ id: string; result: CopySearch } | null>(null)
  const search = found?.id === node.id ? found.result : null
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set())
  const [name, setName] = useState(() => suggestName(node))
  const [renames, setRenames] = useState<Readonly<Record<string, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (!open) return
    let live = true
    void onFind(node).then(result => {
      if (!live) return
      setFound({ id: node.id, result })
      setTicked(new Set(result.copies.map(copy => copy.id)))
    })
    return () => { live = false }
  }, [open, node, onFind])

  // Parameters are what the ticked copies disagree on, named by their role.
  const values = search?.values ?? []
  const chosen = search?.copies.filter(copy => ticked.has(copy.id)) ?? []
  const differing = values.map((value, index) => chosen.some(copy => copy.values[index]?.text !== value.text) ? index : -1).filter(index => index >= 0)
  const suggested = parameterNames(values, differing)
  const parameters = [...suggested].map(([index, base]) => ({ index, base, name: renames[base] ?? base, value: values[index]! }))

  return <details className={styles.makeComponent} data-testid="make-component" open={open} onToggle={event => setOpen((event.target as HTMLDetailsElement).open)}>
    <summary>Make component</summary>
    {/* The third paste is where copying starts to cost more than it saves. It is a
        suggestion with a way out, never a step in the way. */}
    {nudge && !open && <p className={styles.nudge} data-testid="paste-nudge">
      <span>You’ve used this 3 times. Make it a component?</span>
      <button type="button" onClick={event => { event.preventDefault(); setOpen(true) }}>Show copies</button>
      <button type="button" onClick={event => { event.preventDefault(); onDismissNudge?.() }}>Not now</button>
    </p>}
    {!search ? <p role="status">Looking for copies…</p> : !search.eligible ? <p>{search.reason}</p> : <>
      <label>Component name<input aria-label="New component name" value={name} onChange={event => { setName(event.target.value); setError(null) }} /></label>
      {search.copies.length > 0 ? <fieldset className={styles.copyList} data-testid="copy-list">
        <legend>{search.copies.length === 1 ? 'Link this copy too?' : `Link these ${search.copies.length} copies too?`}</legend>
        {search.copies.map(copy => {
          const differs = copy.values.filter((value, index) => value.text !== values[index]?.text).map(value => value.text.replace(/^"|"$/g, ''))
          return <label key={copy.id}>
            <input type="checkbox" checked={ticked.has(copy.id)} onChange={event => setTicked(previous => {
              const next = new Set(previous)
              if (event.target.checked) next.add(copy.id); else next.delete(copy.id)
              return next
            })} />
            <span>{copy.owner.split('.')[0]}{differs.length ? ` · ${differs.join(', ')}` : ' · identical'}</span>
            {onShow && <button type="button" onClick={event => { event.preventDefault(); onShow(copy) }}>Show</button>}
          </label>
        })}
      </fieldset> : <p>No other copies of this view yet. It becomes a Main you can reuse.</p>}
      {parameters.length > 0 && <fieldset className={styles.copyList} data-testid="component-parameters">
        <legend>Changeable per copy</legend>
        {parameters.map(parameter => <label key={parameter.base}>
          <input aria-label={`Name for the ${parameter.base} field`} value={parameter.name} onChange={event => setRenames({ ...renames, [parameter.base]: event.target.value })} />
          <small>{parameter.value.kind === 'action' ? 'what it does' : parameter.value.kind === 'symbol' ? 'symbol' : parameter.value.kind === 'color' ? 'colour' : parameter.value.kind === 'number' ? 'number' : 'text'}</small>
        </label>)}
      </fieldset>}
      <p>{parameters.length
        ? `Each copy keeps its own ${parameters.map(parameter => parameter.name).join(', ')}. Everything else follows the Main.`
        : 'Every ticked copy follows the Main exactly. One undo puts this back.'}</p>
      <button type="button" disabled={busy || working || !name.trim()} onClick={async () => {
        setWorking(true)
        try {
          const problem = await onMake(name.trim(), [...ticked], renames)
          setError(problem)
          if (!problem) setOpen(false)
        } finally { setWorking(false) }
      }}>Make component{chosen.length ? ` from ${chosen.length + 1} copies` : ''}</button>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </>}
  </details>
}
