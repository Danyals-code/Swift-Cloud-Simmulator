'use client'

import { useState } from 'react'
import { colorInputText, type DesignControl, type SharedStyle } from '@studio/shared'
import { ColorField } from './controls/ColorField'
import { PropertyControl, type PropertyChange } from './PropertyControl'
import { SymbolPicker } from './SymbolPicker'
import { copyColor } from '../lib/componentInputs'
import { libraryChoices } from '../lib/library'
import { SYSTEM_COLOR_SWATCHES } from '../lib/colorValue'
import styles from './AuthoringInspector.module.css'

/** A token is one value as written, so an opacity on it is no input a copy can take (Wave 5b). */
const TOKEN_OPACITY = 'A token takes no opacity here. Change it in Code.'

/**
 * A copy's input drawn by what it is (Wave 5b): a symbol with the symbol picker, an image
 * with the bundled and Library images, a colour with the colour field. Any other input is drawn as a
 * value is, so a name list never stands in for a symbol or a colour.
 */
export function CopyInput({ control, assets, tokens, onChange }: { control: DesignControl; assets?: readonly { readonly name: string; readonly id: string }[]; tokens: readonly SharedStyle[]; onChange: PropertyChange }) {
  // Only a copy's input has a kind: the planner says which (Wave 5b).
  const kind = control.inputKind
  const [error, setError] = useState<string | null>(null)
  const change = async (value: string) => { const problem = await onChange(control.id, value); setError(problem); return problem }
  const locked = !!control.disabledReason
  // The project's images, then the Library's it doesn't replace (Wave 7b). The image the copy
  // shows now stays a choice even when it is neither.
  const names = [...(assets ?? []).map(asset => asset.name), ...libraryChoices(assets ?? [])]
  const images = names.includes(control.value) || !control.value ? names : [control.value, ...names]
  // The symbol picker says its own refusal, so only the image and colour fields set one here (Wave 5b).
  const field = kind === 'symbol' ? <><div className={styles.row}><span>{control.label}</span><span><code>{control.value}</code></span></div>{!locked && <SymbolPicker selected={control.value} onChoose={value => onChange(control.id, value)} />}</>
    : kind === 'image' && images ? <label className={styles.controlLabel}><span>{control.label}</span>
      <select aria-label={control.label} data-control-id={control.id} value={control.value} disabled={locked} onChange={event => void change(event.target.value)}>
        {!control.value && <option value="" disabled>Choose image</option>}
        {images.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
    </label>
    : kind === 'color' ? <div className={styles.row}><span>{control.label}</span><span><ColorField label={control.label} value={copyColor(control.value)} tokens={tokens} disabled={locked} onChange={color => { const text = colorInputText(color, SYSTEM_COLOR_SWATCHES); if (text === undefined) setError(TOKEN_OPACITY); else void change(text) }} /></span></div>
    : null
  if (!field) return <PropertyControl control={control} onChange={onChange} />
  return <div className={styles.control} data-testid="copy-input" data-input-kind={kind}>
    {field}
    {locked && <p className={styles.note}>{control.disabledReason}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>
}
