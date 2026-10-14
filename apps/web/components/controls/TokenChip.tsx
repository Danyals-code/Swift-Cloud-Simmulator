'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import styles from './TokenChip.module.css'

/** What can be done with a linked token, loaded the first time its chip is pressed. */
const TokenPopover = dynamic(() => import('./TokenPopover').then(module => module.TokenPopover), { ssr: false })

/**
 * What the panel can say about a token and do with it (Wave 3b): what it is declared as,
 * how many places read it, a change where it is declared, and Detach, which writes its
 * value in its place at this one view.
 */
export interface TokenActions {
  readonly value?: number
  /** What it is, in words, for a token that is no number: `Title 2, Bold`. */
  readonly detail?: string
  /** How many places read it, in words: `Used in 4 places`. */
  readonly uses?: string
  /** What it is worked out from in Swift, where it is no number, `8 * 2`: shown, with no value to change. */
  readonly expression?: string
  /** Why it is only shown, where nothing can be done with it, such as a custom face. */
  readonly note?: string
  readonly unit?: string
  /** Writes a new value where it is declared, for every place; resolves to why it was refused, or null. */
  readonly onEdit?: (value: number) => Promise<string | null>
  /** Writes its value in its place, at this view only; resolves to why it was refused, or null. */
  readonly onDetach?: () => Promise<string | null>
}

/** A number as a chip shows it: to two places, with no float noise. */
export const chipNumber = (value: number) => String(Math.round(value * 100) / 100)

/**
 * A linked token, as a chip with its name and, when the panel can read it, its value:
 * `rowSpacing · 12`. With something to do with it, the chip opens it.
 */
export function TokenChip({ token, actions, disabled = false }: { token: string; actions?: TokenActions; disabled?: boolean }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const detail = actions?.value !== undefined ? chipNumber(actions.value) : actions?.expression ?? actions?.detail
  const text = detail === undefined ? token : `${token} · ${detail}`
  if (!actions?.onEdit && !actions?.onDetach) {
    const title = actions?.note ?? (actions?.expression ? `Linked to ${token}, worked out in Swift as ${actions.expression}. Type a number to replace it.` : `Linked to ${token}. Type a number to replace it.`)
    return <span className={styles.chip} title={title}>{text}</span>
  }
  return <>
    <button type="button" className={styles.chip} aria-label={`${token} token`} aria-haspopup="dialog" aria-expanded={!!anchor} disabled={disabled}
      title={`Linked to ${token}${actions.uses ? `, ${actions.uses.toLowerCase()}` : ''}. ${actions.onEdit ? 'Press to change it where it is declared, or to detach it.' : 'Press to detach it.'}`}
      onClick={event => setAnchor(anchor ? null : event.currentTarget.getBoundingClientRect())}>{text}</button>
    {anchor && <TokenPopover token={token} actions={actions} anchor={anchor} onClose={() => setAnchor(null)} />}
  </>
}
