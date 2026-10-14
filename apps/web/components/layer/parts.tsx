import { Fragment, type ReactNode } from 'react'
import { helperPlaces, isConditional, type ColorValue, type Conditional, type Length, type TokenLength } from '@studio/shared'
import { ColorField } from '../controls/ColorField'
import { NumberField } from '../controls/NumberField'
import { TokenChip, type TokenActions } from '../controls/TokenChip'
import { Icon, type IconName } from '../ui/Icon'
import type { SectionProps } from './section'
import styles from './LayerSection.module.css'

/** A length as a field takes it: the number, or none for a token, which the field shows as a chip over it. */
const numberOf = (length: number | TokenLength | undefined) => typeof length === 'number' ? length : null
const tokenOf = (length: number | TokenLength | undefined) => length !== undefined && typeof length !== 'number' ? length.token : undefined

/** What a field can do with a token it shows: given the token, and how to write a number in its place. */
export type TokenLookup = (token: string, detach: (value: number) => unknown) => TokenActions | undefined

/**
 * What a section's fields can do with the tokens its layer reads (Wave 3b): each one's value
 * and uses, Edit at declaration as the token list edits a shared style, or by the constant's
 * name from anywhere, and Detach, which writes the value in the token's place.
 */
export function tokenLookup({ layer, tokens, command }: Pick<SectionProps, 'layer' | 'tokens' | 'command'>, unit = 'pt'): TokenLookup {
  return (token, detach) => {
    const known = layer.tokens?.[token]
    if (!known) return undefined
    const { span, name, uses } = known.declaration
    const shared = tokens.find(style => style.source.file === span.file && style.source.start === span.start && style.source.end === span.end)
    const value = known.value
    return {
      value, unit, uses: helperPlaces(uses), ...known.expression ? { expression: known.expression } : {},
      ...value === undefined ? {} : {
        onEdit: next => command({ kind: 'style-edit', name: shared?.name ?? name, value: String(next) }),
        onDetach: async () => { await detach(value); return null },
      },
    }
  }
}

export interface LengthFieldProps {
  /** Names the field for assistive tech; a condition's cases add "when … is true" and "otherwise". */
  readonly label: string
  readonly caption: ReactNode
  readonly value: Length | undefined
  readonly unit?: 'pt'
  readonly min?: number
  readonly step?: number
  readonly disabled: boolean
  /** Shown for no value at all. */
  readonly placeholder?: string
  readonly title?: string
  readonly lookup: TokenLookup
  /** Resolves to false when the change was refused, so the field shows the value it had. */
  readonly onCommit: (next: Length) => unknown
  readonly onClear?: () => unknown
}

/**
 * A length as Figma's fields take one, however the code writes it: a number; a token, as a
 * chip with its value that opens Edit at declaration and Detach; or the two a condition
 * chooses between, `selected ? 16 : 8`, each a field of its own (Wave 3b).
 */
export function LengthField(props: LengthFieldProps) {
  const { label, value, onCommit } = props
  if (!isConditional(value)) return <OneLength {...props} value={value} />
  return <Cases label={label} value={value} field={(which, names) => <OneLength {...props} {...names} value={value[which]} onClear={undefined}
    onCommit={next => onCommit({ ...value, [which]: next } as Conditional<number | TokenLength>)} />} />
}

/** What each case of a condition is called: for assistive tech, as its caption, and as its title. */
export interface CaseNames { readonly label: string; readonly caption: string; readonly title: string }

/**
 * The two values a condition chooses between, `selected ? 16 : 8` (Wave 3b), each a field of
 * its own in one group named for the condition, which stays as written: the field `If`, when
 * it is true, and `Else`, otherwise. `label` names the value; each case's names add to it.
 */
export function Cases<T>({ label, value, field }: { label: string; value: Conditional<T>; field: (which: 'then' | 'otherwise', names: CaseNames) => ReactNode }) {
  const names = (which: 'then' | 'otherwise'): CaseNames => which === 'then'
    ? { label: `${label}, when ${value.condition} is true`, caption: 'If', title: `When ${value.condition} is true` }
    : { label: `${label}, otherwise`, caption: 'Else', title: 'Otherwise' }
  return <div className={styles.branches} role="group" aria-label={`${label}, set by ${value.condition}`}>
    {(['then', 'otherwise'] as const).map(which => <Fragment key={which}>{field(which, names(which))}</Fragment>)}
  </div>
}

/** Two colours a condition chooses between (Wave 3b), each a colour field of its own under the case it is for. */
export function ColorCases({ label, value, tokens, disabled, onChange }: { label: string; value: Conditional<ColorValue>; tokens: SectionProps['tokens']; disabled: boolean; onChange: (next: Conditional<ColorValue>) => unknown }) {
  return <Cases label={label} value={value} field={(which, names) => <div className={styles.branches}>
    <span className={styles.eachNote}>{names.title}</span>
    <ColorField label={names.label} value={value[which]} tokens={tokens} disabled={disabled} onChange={next => onChange({ ...value, [which]: next })} />
  </div>} />
}

function OneLength({ label, caption, value, unit, min, step, disabled, placeholder, title, lookup, onCommit, onClear }: Omit<LengthFieldProps, 'value'> & { value: number | TokenLength | undefined }) {
  const token = tokenOf(value)
  const actions = token ? lookup(token, onCommit) : undefined
  return <NumberField label={label} caption={caption} unit={unit} min={min} step={step} disabled={disabled} title={title}
    value={numberOf(value)} placeholder={token ?? placeholder} overlay={token ? <TokenChip token={token} actions={actions} disabled={disabled} /> : undefined}
    onCommit={onCommit} onClear={onClear} />
}

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
