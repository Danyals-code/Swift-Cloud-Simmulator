'use client'

import dynamic from 'next/dynamic'
import type { ColorValue, FillValue } from '@studio/shared'
import { ColorField } from '../controls/ColorField'
import { cardColor, fillOfKind } from '../../lib/colorValue'
import { AddRemove, ColorCases, Note, Section } from './parts'
import { useLayerWrite, type SectionProps } from './section'
import shared from './LayerSection.module.css'
import styles from './FillSection.module.css'

/** The stops, angle and type of a gradient, loaded the first time a fill is one. */
const GradientEditor = dynamic(() => import('./GradientEditor').then(module => module.GradientEditor), { ssr: false, loading: () => <Note>Loading gradient…</Note> })

type Kind = FillValue['kind']
const KINDS: readonly { readonly kind: Kind; readonly label: string }[] = [
  { kind: 'color', label: 'Solid' }, { kind: 'gradient', label: 'Gradient' }, { kind: 'material', label: 'Material' }, { kind: 'glass', label: 'Glass' },
]
const THICKNESSES: readonly (readonly [Extract<FillValue, { kind: 'material' }>['thickness'], string])[] = [
  ['ultraThin', 'Ultra thin'], ['thin', 'Thin'], ['regular', 'Regular'], ['thick', 'Thick'], ['ultraThick', 'Ultra thick'],
]
/** What a native Card looks like before it has a fill of its own: the grouped background. */
const CARD_DEFAULT: ColorValue = { name: 'secondarySystemBackground' }

/**
 * The layer's Fill, as Figma's Fill section: a header that adds or removes it, the kind
 * (Solid, Gradient, Material or Glass), and the value for that kind.
 *
 * A kind the project cannot write is in the menu but off, with the reason under it: Glass
 * below iOS 26 points at Material. A native Card has a fill of its own, so choosing a
 * colour for one makes it an editable layer, as the canvas's Card fill always has.
 */
export function FillSection({ node, layer, set, busy, tokens, command }: SectionProps) {
  const { write, attempt, error } = useLayerWrite((fill: FillValue | null) => ({ section: 'fill', fill }), { set, busy })
  const fill = layer.fill
  if (!fill) return null
  if (node.kind === 'view' && node.name === 'GroupBox') {
    // Choosing a colour makes the card a Column with its own padding, corners and this fill, so its
    // title and content line up and every part can be set; Undo puts the native card back.
    const choose = (color: ColorValue) => attempt(() => {
      const written = cardColor(color, tokens)
      return written ? command({ kind: 'card-customize', color: written }) : 'This token has no color the card can take. Choose a system color or a hex.'
    })
    return <Section title="Card fill" testId="layer-fill" error={error}>
      <ColorField label="Card fill" value={fill.value?.kind === 'color' ? fill.value.color : CARD_DEFAULT} tokens={tokens} disabled={busy} onChange={choose} />
      <Note>Pick a color to make this card fully editable, with aligned title and content. Undo restores the original card.</Note>
    </Section>
  }
  const value = fill.value
  const editable = !busy && fill.state !== 'code'
  const reasons = KINDS.flatMap(({ kind }) => kind !== value?.kind && fill.unavailable?.[kind] ? [fill.unavailable[kind]!] : [])
  return <Section title="Fill" testId="layer-fill" error={error}
    action={<AddRemove name="fill" present={!!value || fill.state === 'code'} disabled={!editable} locked={layer.locked} blocked={!!fill.unavailable?.color}
      onAdd={() => void write(fillOfKind('color', null))} onRemove={() => void write(null)} />}>
    {fill.state === 'code' && <Note>{fill.disabledReason}</Note>}
    {value && <>
      <div className={styles.kind}>
        <label className={shared.row}><span>Type</span>
          <select aria-label="Fill type" value={value.kind} disabled={!editable} title={reasons.join(' ') || undefined} onChange={event => void write(fillOfKind(event.target.value as Kind, value))}>
            {KINDS.map(({ kind, label }) => <option key={kind} value={kind} disabled={kind !== value.kind && !!fill.unavailable?.[kind]} title={fill.unavailable?.[kind]}>{label}</option>)}
          </select>
        </label>
        {reasons.map(reason => <Note key={reason}>{reason}</Note>)}
      </div>
      {value.kind === 'color' && (value.when
        ? <ColorCases label="Fill" value={{ condition: value.when.condition, then: value.color, otherwise: value.when.otherwise }} tokens={tokens} disabled={!editable}
            onChange={next => write({ kind: 'color', color: next.then, when: { condition: next.condition, otherwise: next.otherwise } })} />
        : <ColorField label="Fill" value={value.color} tokens={tokens} disabled={!editable} onChange={color => write({ kind: 'color', color })} />)}
      {value.kind === 'gradient' && <GradientEditor fill={value} tokens={tokens} disabled={!editable} onChange={write} />}
      {value.kind === 'material' && <label className={shared.row}><span>Thickness</span>
        <select aria-label="Material thickness" value={value.thickness} disabled={!editable} onChange={event => void write({ kind: 'material', thickness: event.target.value as typeof value.thickness })}>
          {THICKNESSES.map(([thickness, label]) => <option key={thickness} value={thickness}>{label}</option>)}
        </select>
      </label>}
      {value.kind === 'glass' && <GlassFields value={value} tokens={tokens} disabled={!editable} onChange={write} />}
    </>}
  </Section>
}

/** Liquid Glass: regular or clear, an optional tint, and whether it reacts to touch. */
function GlassFields({ value, tokens, disabled, onChange }: { value: Extract<FillValue, { kind: 'glass' }>; tokens: SectionProps['tokens']; disabled: boolean; onChange: (fill: FillValue) => unknown }) {
  const { tint: _, ...untinted } = value
  return <>
    <label className={shared.row}><span>Glass</span>
      <select aria-label="Glass variant" value={value.variant} disabled={disabled} onChange={event => onChange({ ...value, variant: event.target.value as typeof value.variant })}>
        <option value="regular">Regular</option><option value="clear">Clear</option>
      </select>
    </label>
    <label className={shared.check}><input type="checkbox" checked={!!value.tint} disabled={disabled} onChange={event => onChange(event.target.checked ? { ...value, tint: { name: 'blue' } } : untinted)} />Tint</label>
    {value.tint && <ColorField label="Glass tint" value={value.tint} tokens={tokens} disabled={disabled} onChange={tint => onChange({ ...value, tint })} />}
    <label className={shared.check}><input type="checkbox" checked={!!value.interactive} disabled={disabled} onChange={event => onChange({ ...value, interactive: event.target.checked })} />Reacts to touch</label>
  </>
}
