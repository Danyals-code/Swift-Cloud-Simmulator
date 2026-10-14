'use client'

import { useState } from 'react'
import type { CornersValue } from '@studio/shared'
import { NumberField } from '../controls/NumberField'
import { Icon } from '../ui/Icon'
import { chip, IconButton, Note, numberOf, Section, tokenOf } from './parts'
import { useLayerWrite, type SectionProps } from './section'
import styles from './LayerSection.module.css'

type Shape = CornersValue['shape']
const SHAPES: readonly (readonly [Shape, string])[] = [['rect', 'Rect'], ['rounded', 'Rounded'], ['capsule', 'Capsule'], ['circle', 'Circle']]
type CornerName = keyof NonNullable<CornersValue['radii']>
/** Each corner's field, laid out as the corners sit, the top two then the bottom two, with its icon's quarter turns from the top start. */
const CORNERS: readonly (readonly [CornerName, string, number])[] = [['topLeading', 'top start', 0], ['topTrailing', 'top end', 1], ['bottomLeading', 'bottom start', 3], ['bottomTrailing', 'bottom end', 2]]

/** One rounded corner, turned a quarter at a time from the top start: the corner its field sets. */
const Corner = ({ turn = 0 }: { turn?: number }) => <span style={{ display: 'block', transform: `rotate(${turn * 90}deg)` }}><Icon name="corner" size={12} /></span>

/**
 * The layer's Corners, as Figma's corner radius: the shape (Rect, Rounded, Capsule or
 * Circle), one radius or each corner's, Start and End as SwiftUI names them in either
 * writing direction, and Apple's smooth corners, which SwiftUI draws by default.
 */
/** Views that paint themselves, which corners round even with no fill of their own. */
const PAINTS_ITSELF: ReadonlySet<string> = new Set(['Image', 'AsyncImage', 'Color', 'LinearGradient', 'RadialGradient', 'AngularGradient', 'Map', 'VideoPlayer'])

export function CornersSection({ node, layer, set, busy }: SectionProps) {
  const corners = layer.corners
  const { write, error } = useLayerWrite((next: CornersValue) => ({ section: 'corners', corners: next }), { set, busy })
  const [open, setOpen] = useState(corners?.value.shape === 'uneven')
  if (!corners) return null
  // Corners round what a layer paints. A text with no fill or stroke paints nothing they would round.
  if (corners.state === 'absent' && !layer.fill?.value && !layer.stroke?.value && !PAINTS_ITSELF.has(node.name)) return null
  const value = corners.value
  // A chain with a modifier the studio does not know takes no new clip, but corners already there can change.
  const reason = corners.disabledReason ?? (corners.state === 'absent' ? layer.locked : undefined)
  const editable = !busy && !reason
  const smooth = value.continuous !== false
  const radius = value.shape === 'uneven' ? undefined : value.radius ?? 0
  const radii = value.radii ?? { topLeading: radius, topTrailing: radius, bottomTrailing: radius, bottomLeading: radius } as NonNullable<CornersValue['radii']>
  const corner = (at: CornerName, next: number) => write({ shape: 'uneven', radii: { ...radii, [at]: next }, continuous: smooth })
  const square = value.shape !== 'capsule' && value.shape !== 'circle'
  return <Section title="Corners" testId="layer-corners" error={error}>
    <label className={styles.row}><span>Shape</span>
      <select aria-label="Corner shape" value={value.shape === 'uneven' ? 'rounded' : value.shape} disabled={!editable}
        onChange={event => { const shape = event.target.value as Shape; void write(shape === 'rounded' ? { shape, radius: 12, continuous: smooth } : { shape, continuous: smooth }) }}>
        {SHAPES.map(([shape, label]) => <option key={shape} value={shape}>{label}</option>)}
      </select>
    </label>
    {square && <div className={styles.row}><span>Radius</span>
      <div className={styles.inset}>
        {open ? <span className={styles.eachNote}>Each corner</span>
          : <NumberField label="Corner radius" caption={<Corner />} unit="pt" min={0} disabled={!editable} value={numberOf(radius)}
              placeholder={radius === undefined ? 'Mixed' : tokenOf(radius)} overlay={chip(tokenOf(radius))} onCommit={next => write({ shape: 'rounded', radius: next, continuous: smooth })} />}
        <IconButton icon="corners" label="Corner radius on each corner" expanded={open} title={open ? 'One radius for every corner' : 'A radius for each corner'}
          disabled={!editable && !open} onClick={() => setOpen(current => !current)} />
      </div>
    </div>}
    {square && open && <div className={styles.row}><span aria-hidden="true" />
      <div className={styles.pair}>{CORNERS.map(([at, name, turn]) => <NumberField key={at} label={`Corner ${name}`} caption={<Corner turn={turn} />} min={0} disabled={!editable}
        value={numberOf(radii[at])} placeholder={tokenOf(radii[at])} overlay={chip(tokenOf(radii[at]))} onCommit={next => corner(at, next)} />)}</div>
    </div>}
    {value.shape !== 'rect' && value.shape !== 'circle' && <label className={styles.check}>
      <input type="checkbox" checked={smooth} disabled={!editable} onChange={event => void write({ ...value, continuous: event.target.checked })} />Smooth corners
    </label>}
    <Note>{reason}</Note>
  </Section>
}
