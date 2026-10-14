'use client'

import type { FillValue, SharedStyle } from '@studio/shared'
import { ColorField } from '../controls/ColorField'
import { NumberField } from '../controls/NumberField'
import { Icon } from '../ui/Icon'
import { addStop, gradientOfType, removeStop, stopTrack } from '../../lib/colorValue'
import { IconButton, Note } from './parts'
import shared from './LayerSection.module.css'
import styles from './FillSection.module.css'

type Gradient = Extract<FillValue, { kind: 'gradient' }>

const TYPES: readonly (readonly [Gradient['type'], string])[] = [['linear', 'Linear'], ['radial', 'Radial'], ['angular', 'Angular']]

/**
 * A gradient as Figma edits one: its type, its angle when it is linear, and its stops,
 * each a colour at a position along it, which can be added and taken away. A colour's
 * own gradient (`.blue.gradient`) shows its one colour; adding a stop makes it one the
 * designer sets.
 *
 * Loaded only when a fill is a gradient, so the panel's first load stays small.
 */
export function GradientEditor({ fill, tokens, disabled, onChange }: { fill: Gradient; tokens: readonly SharedStyle[]; disabled: boolean; onChange: (fill: FillValue) => unknown }) {
  const stops = fill.stops
  const setStop = (index: number, stop: Partial<Gradient['stops'][number]>) => onChange({ ...fill, stops: stops.map((current, at) => at === index ? { ...current, ...stop } : current) })
  return <div className={styles.gradient} data-testid="gradient-editor">
    <label className={shared.row}><span>Gradient</span>
      <select aria-label="Gradient type" value={fill.type} disabled={disabled} onChange={event => onChange(gradientOfType(fill, event.target.value as Gradient['type']))}>
        {TYPES.map(([type, label]) => <option key={type} value={type}>{label}</option>)}
      </select>
    </label>
    {fill.type === 'linear' && !fill.automatic && <div className={shared.row}><span>Angle</span>
      <NumberField label="Gradient angle" caption={<Icon name="angle" size={12} />} value={Math.round((fill.angle ?? 0) * 10) / 10} disabled={disabled} onCommit={angle => onChange({ ...fill, angle: (angle % 360 + 360) % 360 })} />
    </div>}
    {fill.type === 'radial' && <div className={shared.row}><span>Radius</span>
      <NumberField label="Gradient radius" caption="R" value={fill.endRadius ?? 100} unit="pt" min={0} disabled={disabled} onCommit={radius => onChange({ ...fill, endRadius: radius })} />
    </div>}
    <i className={styles.preview} style={{ backgroundImage: stopTrack(fill, tokens) }} aria-hidden="true" />
    <div className={shared.heading}>
      <h4>Stops</h4>
      <IconButton icon="plus" label="Add stop" disabled={disabled} onClick={() => { const { automatic: _, ...rest } = fill; onChange({ ...rest, stops: addStop(stops) }) }} />
    </div>
    {stops.map((stop, index) => <div key={index} className={styles.stop} data-testid="gradient-stop">
      {!fill.automatic && <>
        <NumberField label={`Stop ${index + 1} position`} caption={<Icon name="gradient-stop" size={12} />} value={Math.round(stop.location * 1000) / 10} unit="%" min={0} max={100} disabled={disabled} onCommit={percent => setStop(index, { location: Math.round(percent * 10) / 1000 })} />
        <span className={styles.stopName} aria-hidden="true">Stop {index + 1}</span>
        <IconButton icon="minus" label={`Remove stop ${index + 1}`} title="Remove stop" disabled={disabled || stops.length <= 2} onClick={() => onChange({ ...fill, stops: removeStop(stops, index) })} />
      </>}
      <ColorField label={`Stop ${index + 1}`} value={stop.color} tokens={tokens} disabled={disabled} onChange={color => setStop(index, { color })} />
    </div>)}
    {fill.automatic && <Note>iOS shades this gradient from one color. Add a stop to set its colors yourself.</Note>}
  </div>
}
