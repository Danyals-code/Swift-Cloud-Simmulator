'use client'

import { useEffect, useRef, useState } from 'react'
import type { ColorValue, SharedStyle } from '@studio/shared'
import { Icon } from '../ui/Icon'
import { Popover } from './Popover'
import { SYSTEM_COLOR_SWATCHES, colorFromText, colorHex, keepOpacity, pickerColor, swatchCss, systemColorLabel, tokenFor, tokenReference, withPickedColor } from '../../lib/colorValue'
import styles from './ColorField.module.css'

/** The Eyedropper API, where the browser has it: Chromium does, WebKit does not. */
interface EyeDropperResult { readonly sRGBHex: string }
type EyeDropperConstructor = new () => { open: () => Promise<EyeDropperResult> }
const eyeDropper = (): EyeDropperConstructor | undefined => typeof window === 'undefined' ? undefined : (window as unknown as { EyeDropper?: EyeDropperConstructor }).EyeDropper

export interface ColorPopoverProps {
  readonly label: string
  /** Null for a field with no colour written, such as a stroke in the foreground style. */
  readonly value: ColorValue | null
  readonly tokens: readonly SharedStyle[]
  /** The swatch it opened from, in the viewport. */
  readonly anchor: DOMRect
  readonly onChange: (value: ColorValue) => void
  readonly onClose: () => void
}

/**
 * The colours a colour field offers: the system colours, the project's colour tokens, any
 * colour from the system picker, and the eyedropper where the browser has one.
 *
 * Each choice keeps the opacity the field had, as Figma's does.
 */
export function ColorPopover({ label, value, tokens, anchor, onChange, onClose }: ColorPopoverProps) {
  const picker = useRef<HTMLInputElement | null>(null)
  const hex = (value && colorHex(value, tokens)) ?? '#000000'
  const [draft, setDraft] = useState(hex)
  /** A hex typed here, alpha and all, which a token's field has no box for. */
  const [typed, setTyped] = useState('')
  const colors = tokens.filter(token => token.kind === 'color')
  const linked = value ? tokenFor(value, tokens) : undefined
  const Dropper = eyeDropper()
  const choose = (color: ColorValue) => onChange(value ? keepOpacity(color, value) : color)
  const commitTyped = () => {
    const color = colorFromText(typed)
    // A typed alpha is the opacity; without one the field's opacity stays.
    if (color && 'hex' in color) { choose(color); setTyped('') }
  }

  // The system picker reports every step of a drag as input, and its choice as change: only the choice is an edit.
  useEffect(() => {
    const input = picker.current
    if (!input) return
    const commit = () => choose({ hex: input.value.toUpperCase() })
    input.addEventListener('change', commit)
    return () => input.removeEventListener('change', commit)
  })

  const pick = async () => {
    if (!Dropper) return
    try { choose({ hex: (await new Dropper().open()).sRGBHex.toUpperCase() }) }
    catch { /* The designer pressed Escape: nothing was picked. */ }
  }

  return <Popover label={`${label} colors`} testId="color-popover" anchor={anchor} focus={['button[aria-pressed="true"]', 'button']} onClose={onClose}>
    <p className={styles.group}>System colors</p>
    <div className={styles.swatches} role="group" aria-label="System colors">
      {Object.keys(SYSTEM_COLOR_SWATCHES).map(name => <button key={name} type="button" aria-label={systemColorLabel(name)} title={systemColorLabel(name)} aria-pressed={!!value && 'name' in value && value.name === name}
        onClick={() => choose({ name })}><i style={{ background: swatchCss({ name }, tokens) }} /></button>)}
    </div>
    {!!colors.length && <>
      <p className={styles.group}>Tokens</p>
      <div className={styles.tokens} role="group" aria-label="Color tokens">
        {colors.map(token => <button key={token.name} type="button" aria-pressed={linked?.name === token.name} onClick={() => choose({ token: tokenReference(token) })}>
          <i style={{ background: swatchCss({ token: tokenReference(token) }, tokens) }} /><span>{token.name}</span>
        </button>)}
      </div>
    </>}
    <div className={styles.custom}>
      <input ref={picker} type="color" aria-label={`${label} picker`} value={pickerColor(draft, '#000000')} onChange={event => setDraft(withPickedColor(draft, event.target.value))} />
      <input className={styles.hex} aria-label={`${label} custom hex`} placeholder="#RRGGBBAA" value={typed} spellCheck={false} maxLength={9}
        aria-invalid={!!typed && !colorFromText(typed) || undefined} onChange={event => setTyped(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitTyped() } }} onBlur={commitTyped} />
      {Dropper && <button type="button" className={styles.dropper} aria-label="Pick a color on screen" title="Pick a color on screen" onClick={() => void pick()}><Icon name="eyedropper" /></button>}
    </div>
  </Popover>
}
