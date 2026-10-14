'use client'

import { useState, type ReactNode } from 'react'
import { evenInsets, sameLength, type Alignment9, type AxisSize, type Insets, type LayerValue, type Length, type Offset } from '@studio/shared'
import { Icon } from '../ui/Icon'
import { Choices, PLACES } from '../PropertyControl'
import { fixedStart } from '../../lib/drawnSize'
import { withMode } from '../../lib/axisSize'
import { IconButton, LengthField, Note, Section, tokenLookup, type TokenLookup } from './parts'
import { useLayerWrite, type SectionChange, type SectionProps } from './section'
import shared from './LayerSection.module.css'
import styles from './LayoutSection.module.css'

type LayoutChange = SectionChange<'layout'>
type Axis = 'width' | 'height'
type Side = keyof Insets

/** The offer, on the canvas and here, that makes room for a pin in an Overlap that hugs. */
export const OVERLAP_SIZE = 'Give the Overlap its current size'

const MODES: readonly (readonly [AxisSize['mode'], string])[] = [['hug', 'Hug'], ['fill', 'Fill'], ['fixed', 'Fixed']]
const SIDES: readonly (readonly [Side, string])[] = [['top', 'Top'], ['leading', 'Start'], ['bottom', 'Bottom'], ['trailing', 'End']]
const AXIS_WORDS: Readonly<Record<Axis, { readonly title: string; readonly caption: string }>> = { width: { title: 'Width', caption: 'W' }, height: { title: 'Height', caption: 'H' } }

const axisChange = (axis: Axis, size: AxisSize): LayoutChange => axis === 'width' ? { width: size } : { height: size }
/** A size with its minimum or maximum taken away. */
const without = (size: AxisSize, key: 'min' | 'max'): AxisSize => ({ mode: size.mode, ...key !== 'min' && size.min !== undefined ? { min: size.min } : {}, ...key !== 'max' && size.max !== undefined ? { max: size.max } : {} })

/**
 * The layer's Layout, as Figma's Layout section: Width and Height as Hug, Fill or Fixed with
 * an optional minimum and maximum, where the content sits in a size larger than it,
 * padding inside the fill and a margin outside it, an offset, and a pin inside an Overlap.
 *
 * Each change is one `layer-set` edit, so it is one undo step. A value written through a
 * token shows the token as a chip, and typing a number replaces it; one the panel cannot
 * rewrite is shown with the reason, and is changed in Code.
 */
export function LayoutSection(props: SectionProps) {
  const { node, layer, set, busy, measure, sizeOverlap } = props
  const layout = layer.layout
  const lookup = tokenLookup(props)
  const { write, attempt, error } = useLayerWrite((change: LayoutChange) => ({ section: 'layout', ...change }), { set, busy })
  const limitsSet = [layout.width.value, layout.height.value].some(size => size.mode !== 'fixed' && (size.min !== undefined || size.max !== undefined))
  const [limitsOpen, setLimitsOpen] = useState(limitsSet)
  /** An axis switched to Fixed with no size to start from: its field waits for one. */
  const [asking, setAsking] = useState<Axis | null>(null)
  const button = node.kind === 'view' && node.name === 'Button'
  const start = button ? measure : fixedStart(measure, layout)
  const sizeReason = layout.width.disabledReason ?? layout.height.disabledReason
  const sizing = (axis: Axis) => {
    const value = layout[axis]
    const words = AXIS_WORDS[axis]
    const size = value.value
    const editable = !busy && !value.disabledReason
    const fixed = size.mode === 'fixed' || asking === axis
    const choose = (mode: AxisSize['mode']) => {
      if (asking === axis) setAsking(null)
      if (mode === size.mode) return
      // Fixed starts from the drawn size, or the maximum or minimum it had; with none, the field asks for one.
      if (mode === 'fixed' && !start && size.max === undefined && size.min === undefined) { setAsking(axis); return }
      // A minimum and maximum go along between Hug and Fill; a Hug's maximum needs a fill to hug.
      void write({ ...axisChange(axis, withMode(size, mode, layout.context.surface)), ...mode === 'fixed' && start ? { measured: start } : {} })
    }
    return <div className={shared.row} key={axis}><span>{words.title}</span>
      <div className={styles.sizing}>
        <select aria-label={`${words.title} sizing`} value={fixed ? 'Fixed' : MODES.find(([mode]) => mode === size.mode)![1]} disabled={!editable}
          title={button ? 'Fill and Fixed size the label, so the button’s shape grows with it.' : undefined}
          onChange={event => choose(MODES.find(([, label]) => label === event.target.value)![0])}>
          {MODES.map(([mode, label]) => <option key={mode} value={label}>{label}</option>)}
        </select>
        {fixed && <LengthField label={words.title} caption={words.caption} unit="pt" min={0} value={size.mode === 'fixed' ? size.size : undefined} disabled={!editable}
          placeholder="Points" lookup={lookup}
          onCommit={async next => { const done = await write(axisChange(axis, { mode: 'fixed', size: next })); if (done) setAsking(null); return done }} />}
      </div>
    </div>
  }
  const limits = (axis: Axis) => {
    const value = layout[axis], size = value.value, words = AXIS_WORDS[axis]
    if (size.mode === 'fixed') return null
    const editable = !busy && !value.disabledReason
    const bound = (key: 'min' | 'max', title: string) => <LengthField label={`${title} ${axis}`} caption={key === 'min' ? 'Min' : 'Max'} unit="pt" min={0} value={size[key]}
      disabled={!editable || key === 'max' && size.mode === 'hug' && !layout.context.surface} placeholder="None" lookup={lookup}
      title={key === 'max' && size.mode === 'hug' && !layout.context.surface ? 'Hug up to a maximum keeps a fill to its content. Add a fill, or choose Fill with a maximum.' : undefined}
      onCommit={next => write(axisChange(axis, { ...size, [key]: next }))} onClear={() => write(axisChange(axis, without(size, key)))} />
    return <div className={shared.row} key={axis}><span>{words.title}</span>
      <div className={shared.pair}>{bound('min', 'Minimum')}{bound('max', 'Maximum')}</div>
    </div>
  }
  const flexible = layout.width.value.mode !== 'fixed' || layout.height.value.mode !== 'fixed'

  return <Section title="Layout" testId="layer-layout" error={error}
    action={flexible && <button type="button" className={styles.disclosure} aria-expanded={limitsOpen} onClick={() => setLimitsOpen(open => !open)}>Min / max</button>}>
    {sizing('width')}
    {sizing('height')}
    <Note>{sizeReason}</Note>
    {limitsOpen && flexible && <div className={styles.limits}>{limits('width')}{limits('height')}</div>}
    {layout.alignment.value && <Places label="Content alignment" title="Alignment" value={layout.alignment.value} disabled={busy || !!layout.alignment.disabledReason} onChoose={alignment => void write({ alignment })} />}
    <InsetsField kind="Padding" value={layout.padding} busy={busy} lookup={lookup} onChange={padding => write({ padding })} />
    {layout.context.surface && <InsetsField kind="Margin" value={layout.margin} busy={busy} lookup={lookup} onChange={margin => write({ margin })} />}
    <OffsetField value={layout.offset} busy={busy} lookup={lookup} onChange={offset => write({ offset })} />
    {layout.context.parent === 'overlap' && <>
      <Places label="Pin" title="Pin" value={layout.pin.value} disabled={busy || !!layout.pin.disabledReason} onChoose={pin => void write({ pin })}
        none={<button type="button" className={styles.none} aria-pressed={!layout.pin.value} disabled={busy || !layout.pin.value} onClick={() => void write({ pin: null })}>None</button>} />
      <Note>{layout.pin.disabledReason}</Note>
      {/* An Overlap that hugs can't take a pin: offered its drawn size, as Fixed (plan recommendation 7). */}
      {sizeOverlap && layout.pin.disabledReason && <div className={shared.row}><span aria-hidden="true" />
        <button type="button" className={styles.none} disabled={busy} onClick={() => void attempt(sizeOverlap)}>{OVERLAP_SIZE}</button>
      </div>}
    </>}
  </Section>
}

/** Nine places in a 3 by 3 grid, as the inspector draws an Overlap's alignment, with a None beside them for a pin. */
function Places({ label, title, value, disabled, onChoose, none }: { label: string; title: string; value: Alignment9 | null; disabled: boolean; onChoose: (place: Alignment9) => void; none?: ReactNode }) {
  return <div className={shared.row}><span>{title}</span>
    <div className={styles.places}>
      <Choices label={label} options={PLACES} value={value} disabled={disabled} onChoose={onChoose} />
      {none}
    </div>
  </div>
}

/**
 * Padding or a margin: one field for every side, and a button that shows a field for each
 * side, Top, Start, Bottom and End, as SwiftUI names them in either writing direction.
 */
function InsetsField({ kind, value, busy, lookup, onChange }: { kind: 'Padding' | 'Margin'; value: LayerValue<Insets | null>; busy: boolean; lookup: TokenLookup; onChange: (insets: Insets | null) => Promise<boolean> }) {
  const insets = value.value
  const lengths = insets ? SIDES.map(([side]) => insets[side]) : []
  const even = !insets || lengths.every(length => sameLength(length, lengths[0]!))
  const [open, setOpen] = useState(!even)
  const editable = !busy && !value.disabledReason
  const word = kind.toLowerCase()
  const all = insets ? lengths[0] : value.disabledReason ? undefined : 0
  const side = (name: Side, next: Length) => onChange({ ...(insets ?? evenInsets(0)), [name]: next })
  return <>
    <div className={shared.row}><span>{kind}</span>
      <div className={shared.inset}>
        {!open && <LengthField label={`${kind}, all sides`} caption={<Icon name="sides" />} unit="pt" min={0} disabled={!editable} lookup={lookup}
          value={even ? all : undefined} placeholder={value.state === 'code' ? 'Code' : even ? undefined : 'Mixed'}
          onCommit={next => onChange(evenInsets(next))} />}
        {open && <span className={shared.eachNote}>Each side</span>}
        <IconButton icon="sides" label={`${kind} on each side`} expanded={open} title={open ? `One ${word} for every side` : `A ${word} for each side`}
          disabled={!editable && !open} onClick={() => setOpen(current => !current)} />
      </div>
    </div>
    {open && <div className={shared.row}><span aria-hidden="true" />
      <div className={shared.pair}>{SIDES.map(([name, caption]) => <LengthField key={name} label={`${caption} ${word}`} caption={caption} min={0} disabled={!editable} lookup={lookup}
        value={insets ? insets[name] : value.state === 'code' ? undefined : 0} placeholder={value.state === 'code' ? 'Code' : undefined} onCommit={next => side(name, next)} />)}</div>
    </div>}
    {/* Code the panel leaves alone, or a padding the view can't have, as a shape can't: said why. */}
    <Note>{value.disabledReason}</Note>
  </>
}

/** Where the layer is drawn, moved from where it is laid out: X and Y, in points. */
function OffsetField({ value, busy, lookup, onChange }: { value: LayerValue<Offset | null>; busy: boolean; lookup: TokenLookup; onChange: (offset: Offset | null) => Promise<boolean> }) {
  const offset = value.value ?? { x: 0, y: 0 }
  const editable = !busy && !value.disabledReason
  return <>
    <div className={shared.row}><span>Offset</span>
      <div className={shared.pair}>{(['x', 'y'] as const).map(axis => <LengthField key={axis} label={`Offset ${axis.toUpperCase()}`} caption={axis.toUpperCase()} unit="pt" disabled={!editable} lookup={lookup}
        value={offset[axis]} onCommit={next => onChange({ ...offset, [axis]: next })} />)}</div>
    </div>
    <Note>{value.disabledReason}</Note>
  </>
}
