'use client'

import dynamic from 'next/dynamic'
import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { ColorValue, SharedStyle } from '@studio/shared'
import { colorFromText, colorHex, colorLabel, keepOpacity, opacityPercent, swatchCss, tokenFor, withOpacity } from '../../lib/colorValue'
import { Icon } from '../ui/Icon'
import { NumberField } from './NumberField'
import styles from './ColorField.module.css'

/** The swatches, tokens and eyedropper, loaded the first time a swatch is pressed. */
const ColorPopover = dynamic(() => import('./ColorPopover').then(module => module.ColorPopover), { ssr: false })

export interface ColorFieldProps {
  /** Names the field's parts for assistive tech: "Fill" gives "Fill color", "Fill hex" and "Fill opacity". */
  readonly label: string
  /** Null for no colour written, which the field shows as `unset` says until one is chosen. */
  readonly value: ColorValue | null
  /** What no colour written draws, in words: `Foreground`, for a stroke in the foreground style. */
  readonly unset?: string
  /** The project's tokens; the colour ones are offered. */
  readonly tokens: readonly SharedStyle[]
  readonly disabled?: boolean
  /** Resolves to false when the change was refused, so the field shows the value it had. */
  readonly onChange: (value: ColorValue) => unknown
}

/**
 * One colour, as Figma's colour row has it: a swatch that opens the colours, the hex,
 * and the opacity as a percent.
 *
 * The hex field also takes a system colour's name. A typed `#RRGGBBAA` sets the opacity
 * from its alpha, as Figma does. A token shows as a chip with its name, so a value linked
 * to the design system reads as one. No colour written, as a stroke in the foreground style
 * has, reads as `unset` says until one is chosen.
 */
export function ColorField({ label, value, unset, tokens, disabled = false, onChange }: ColorFieldProps) {
  const swatch = useRef<HTMLButtonElement | null>(null)
  /** Where the swatch was when it opened the colours, or null while they are closed. */
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const toggle = (event: MouseEvent<HTMLButtonElement>) => setAnchor(anchor ? null : (swatch.current ?? event.currentTarget).getBoundingClientRect())
  const text = value ? colorLabel(value, tokens) : ''
  // Drafts start again from the value whenever it changes, as after an Undo.
  const key = JSON.stringify(value)
  const [base, setBase] = useState(key)
  const [hex, setHex] = useState(text)
  const [invalid, setInvalid] = useState(false)
  if (base !== key) { setBase(key); setHex(text); setInvalid(false) }
  const commitHex = () => {
    if (hex.trim() === text) return
    const typed = colorFromText(hex)
    if (!typed) { setInvalid(true); return }
    // A typed alpha is the opacity; without one the opacity stays as it was.
    onChange(value ? keepOpacity(typed, value) : typed)
  }
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); commitHex() }
    // The canvas would take Escape as letting go of the selection.
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setHex(text); setInvalid(false) }
  }
  const linked = value && 'token' in value ? tokenFor(value, tokens) : undefined
  return <div className={styles.field} data-testid="color-field">
    <button ref={swatch} type="button" className={styles.swatch} aria-label={`${label} color`} aria-haspopup="dialog" aria-expanded={!!anchor} title={value ? colorHex(value, tokens) ?? text : unset} disabled={disabled} onClick={toggle}>
      {value ? <i style={{ background: swatchCss(value, tokens) }} /> : <i className={styles.unset} />}
    </button>
    {value && 'token' in value
      ? <button type="button" className={styles.chip} aria-label={`${label} token`} title={linked ? `${linked.name}: ${linked.light ?? linked.value}` : value.token} disabled={disabled} onClick={toggle}>{text}</button>
      : <input className={styles.hex} aria-label={`${label} hex`} value={hex} placeholder={value ? '#RRGGBB' : unset} spellCheck={false} maxLength={32} disabled={disabled} aria-invalid={invalid || undefined}
          onChange={event => { setHex(event.target.value); setInvalid(false) }} onBlur={commitHex} onKeyDown={keys} />}
    <NumberField label={`${label} opacity`} caption={<Icon name="opacity" size={12} />} value={value && opacityPercent(value)} unit="%" min={0} max={100} disabled={disabled || !value}
      title={value ? undefined : 'Choose a color to set its opacity.'} onCommit={percent => value && onChange(withOpacity(value, percent))} />
    {invalid && <p className={styles.error} role="alert">Use a hex such as #0A84FF, or a system color’s name.</p>}
    {anchor && <ColorPopover label={label} value={value} tokens={tokens} anchor={anchor} onChange={onChange} onClose={() => { setAnchor(null); swatch.current?.focus() }} />}
  </div>
}
