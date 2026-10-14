'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ColorValue, SharedStyle } from '@studio/shared'
import { Icon } from '../ui/Icon'
import { SYSTEM_COLOR_SWATCHES, colorFromText, colorHex, keepOpacity, pickerColor, swatchCss, systemColorLabel, tokenFor, tokenReference, withPickedColor } from '../../lib/colorValue'
import styles from './ColorField.module.css'

/** The Eyedropper API, where the browser has it: Chromium does, WebKit does not. */
interface EyeDropperResult { readonly sRGBHex: string }
type EyeDropperConstructor = new () => { open: () => Promise<EyeDropperResult> }
const eyeDropper = (): EyeDropperConstructor | undefined => typeof window === 'undefined' ? undefined : (window as unknown as { EyeDropper?: EyeDropperConstructor }).EyeDropper

export interface ColorPopoverProps {
  readonly label: string
  readonly value: ColorValue
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
 * Each choice keeps the opacity the field had, as Figma's does. It floats over the panel
 * in a portal, as the menus do, because every pane clips what grows past it.
 */
export function ColorPopover({ label, value, tokens, anchor, onChange, onClose }: ColorPopoverProps) {
  const panel = useRef<HTMLDivElement | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)
  const [placement, setPlacement] = useState({ left: anchor.left, top: anchor.bottom + 4 })
  const hex = colorHex(value, tokens) ?? '#000000'
  const [draft, setDraft] = useState(hex)
  /** A hex typed here, alpha and all, which a token's field has no box for. */
  const [typed, setTyped] = useState('')
  const colors = tokens.filter(token => token.kind === 'color')
  const linked = tokenFor(value, tokens)
  const Dropper = eyeDropper()
  const choose = (color: ColorValue) => onChange(keepOpacity(color, value))
  const commitTyped = () => {
    const color = colorFromText(typed)
    // A typed alpha is the opacity; without one the field's opacity stays.
    if (color && 'hex' in color) { choose(color); setTyped('') }
  }

  useLayoutEffect(() => {
    const element = panel.current
    if (!element) return
    const below = window.innerHeight - anchor.bottom - 8
    const top = element.offsetHeight <= below ? anchor.bottom + 4 : Math.max(8, anchor.top - element.offsetHeight - 4)
    setPlacement({ left: Math.min(Math.max(8, anchor.left), window.innerWidth - element.offsetWidth - 8), top })
  }, [anchor])

  // The field's close handler is new each time it draws; the listeners below are added once.
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })
  useEffect(() => {
    const chosen = panel.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ?? panel.current?.querySelector<HTMLButtonElement>('button')
    chosen?.focus()
    // The pane under it scrolling would leave it pointing at nothing.
    const dismiss = (event: Event) => { if (!(event.target instanceof Node && panel.current?.contains(event.target))) close.current() }
    // Escape closes it before the canvas hears it, which would let the view go.
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current() } }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', escape, true)
    return () => { window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss); window.removeEventListener('keydown', escape, true) }
  }, [])

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

  return createPortal(<>
    <div className={styles.scrim} onPointerDown={event => { event.stopPropagation(); onClose() }} />
    <div ref={panel} role="dialog" aria-label={`${label} colors`} className={styles.popover} style={placement} data-testid="color-popover">
      <p className={styles.group}>System colors</p>
      <div className={styles.swatches} role="group" aria-label="System colors">
        {Object.keys(SYSTEM_COLOR_SWATCHES).map(name => <button key={name} type="button" aria-label={systemColorLabel(name)} title={systemColorLabel(name)} aria-pressed={'name' in value && value.name === name}
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
    </div>
  </>, document.body)
}
