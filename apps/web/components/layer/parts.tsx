import type { ReactNode } from 'react'
import type { Length } from '@studio/shared'
import { Icon, type IconName } from '../ui/Icon'
import styles from './LayerSection.module.css'

/** A length as a field takes it: the number, or none for a token, which shows as a chip over the field. */
export const numberOf = (length: Length | undefined) => typeof length === 'number' ? length : null
export const tokenOf = (length: Length | undefined) => length !== undefined && typeof length !== 'number' ? length.token : undefined
export const chip = (token: string | undefined) => token ? <span className={styles.token} title={`Linked to ${token}. Type a number to replace it.`}>{token}</span> : undefined

/** Why a value is as it is, or can't be changed here, under its control; nothing without a reason. */
export const Note = ({ children }: { children?: ReactNode }) => children ? <p className={styles.note}>{children}</p> : null

/**
 * A section, as Figma's panel draws one: its heading, with an add or remove button where it
 * has one, its rows, and why the last change was refused.
 */
export function Section({ title, testId, action, error, children }: { title: string; testId: string; action?: ReactNode; error: string | null; children?: ReactNode }) {
  return <section className={styles.section} aria-label={title} data-testid={testId}>
    <div className={styles.heading}><h3>{title}</h3>{action}</div>
    {children}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>
}

/** A small icon button, named for assistive tech by `label`, which is its title too unless one is given. */
export function IconButton({ icon, label, title = label, expanded, disabled, onClick }: { icon: IconName; label: string; title?: string; expanded?: boolean; disabled: boolean; onClick: () => void }) {
  return <button type="button" className={styles.iconButton} aria-label={label} aria-expanded={expanded} title={title} disabled={disabled} onClick={onClick}><Icon name={icon} /></button>
}

/**
 * The add or remove button in a section's heading, as Figma's Fill, Stroke and Effects
 * have: remove while the layer has one, add while it has none. Adding is off in a chain the
 * studio cannot insert into, with the reason as its title, or when `blocked`.
 */
export function AddRemove({ name, present, disabled, locked, blocked = false, onAdd, onRemove }: { name: string; present: boolean; disabled: boolean; locked?: string; blocked?: boolean; onAdd: () => void; onRemove?: () => void }) {
  if (present) return onRemove ? <IconButton icon="minus" label={`Remove ${name}`} disabled={disabled} onClick={onRemove} /> : null
  return <IconButton icon="plus" label={`Add ${name}`} title={locked} disabled={disabled || !!locked || blocked} onClick={onAdd} />
}
