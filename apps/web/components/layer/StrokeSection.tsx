'use client'

import type { StrokeValue } from '@studio/shared'
import { ColorField } from '../controls/ColorField'
import { NumberField } from '../controls/NumberField'
import { AddRemove, chip, Note, numberOf, Section, tokenOf } from './parts'
import { useLayerWrite, type SectionProps } from './section'
import styles from './LayerSection.module.css'

const POSITIONS: readonly (readonly [StrokeValue['position'], string])[] = [['inside', 'Inside'], ['center', 'Center'], ['outside', 'Outside']]
/** A new stroke, as a new border is: a hairline of SwiftUI's `.gray` inside the edge. */
const NEW_STROKE: StrokeValue = { color: { name: 'gray' }, width: 1, position: 'inside' }

/** A stroke with a dash and gap, or none for a dash of nothing; a gap as long as the dash is written once. */
function dashed(value: StrokeValue, dash: number, gap: number): StrokeValue {
  const { dash: _, ...solid } = value
  return dash ? { ...solid, dash: gap === dash ? [dash] : [dash, gap] } : solid
}

/**
 * The layer's Stroke, as Figma's Stroke section: a header that adds or removes it, its
 * colour, width, where it sits on the edge (Inside, Center or Outside) and an optional
 * dash. On a view it is a border that follows the corners; on a shape, its own stroke.
 */
export function StrokeSection({ layer, set, busy, tokens }: SectionProps) {
  const stroke = layer.stroke
  const { write, error } = useLayerWrite((next: StrokeValue | null) => ({ section: 'stroke', stroke: next }), { set, busy })
  if (!stroke) return null
  const value = stroke.value
  const editable = !busy && stroke.state !== 'code'
  const [dash, gap] = value?.dash ?? []
  return <Section title="Stroke" testId="layer-stroke" error={error}
    action={<AddRemove name="stroke" present={!!value || stroke.state === 'code'} disabled={!editable} locked={layer.locked} onAdd={() => void write(NEW_STROKE)} onRemove={() => void write(null)} />}>
    <Note>{stroke.disabledReason}</Note>
    {value && <>
      <ColorField label="Stroke" value={value.color} tokens={tokens} disabled={!editable} onChange={color => write({ ...value, color })} />
      <div className={styles.row}><span>Width</span>
        <NumberField label="Stroke width" caption="W" unit="pt" min={0} step={0.5} disabled={!editable} value={numberOf(value.width)} placeholder={tokenOf(value.width)} overlay={chip(tokenOf(value.width))} onCommit={width => write({ ...value, width })} />
      </div>
      <label className={styles.row}><span>Position</span>
        <select aria-label="Stroke position" value={value.position} disabled={!editable} onChange={event => void write({ ...value, position: event.target.value as StrokeValue['position'] })}>
          {POSITIONS.map(([position, label]) => <option key={position} value={position}>{label}</option>)}
        </select>
      </label>
      <div className={styles.row}><span>Dash</span>
        <div className={styles.pair}>
          <NumberField label="Stroke dash" caption="Dash" min={0} disabled={!editable} value={dash ?? null} placeholder="None" onCommit={next => write(dashed(value, next, gap ?? dash ?? next))} onClear={() => write(dashed(value, 0, 0))} />
          <NumberField label="Stroke gap" caption="Gap" min={0} disabled={!editable || !dash} value={gap ?? dash ?? null} placeholder="None" onCommit={next => write(dashed(value, dash!, next))} />
        </div>
      </div>
    </>}
  </Section>
}
