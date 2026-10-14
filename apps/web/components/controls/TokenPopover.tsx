'use client'

import { useState } from 'react'
import { Icon } from '../ui/Icon'
import { NumberField } from './NumberField'
import { Popover } from './Popover'
import { chipNumber, type TokenActions } from './TokenChip'
import styles from './TokenChip.module.css'

/**
 * A linked token, opened from its chip (Wave 3b): its name, how many places read it, its
 * value changed where it is declared, and Detach.
 */
export function TokenPopover({ token, actions, anchor, onClose }: { token: string; actions: TokenActions; anchor: DOMRect; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  /** Runs one of its actions, closing it once the change is made and showing why when it is not. */
  const run = async (action: () => Promise<string | null>) => {
    if (pending) return false
    setPending(true)
    try {
      const problem = await action()
      setError(problem)
      if (!problem) onClose()
      return !problem
    } finally { setPending(false) }
  }

  const { value, onEdit, onDetach } = actions
  return <Popover label={token} testId="token-popover" anchor={anchor} focus={['input, button']} onClose={onClose}>
    <div className={styles.head}><code>{token}</code>{actions.uses && <span>{actions.uses}</span>}</div>
    {onEdit && value !== undefined && <>
      <NumberField label={`Value of ${token}`} caption={<Icon name="token" size={12} />} unit={actions.unit === 'pt' ? 'pt' : undefined} value={value} disabled={pending}
        onCommit={next => run(() => onEdit(next))} />
      <p className={styles.note}>Changes it where it is declared, for every place that reads it.</p>
    </>}
    {onDetach && <button type="button" className={styles.detach} disabled={pending} title={value === undefined ? undefined : `Write ${chipNumber(value)} here, no longer linked to ${token}`}
      onClick={() => void run(onDetach)}><Icon name="unlink" size={12} />Detach</button>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </Popover>
}
