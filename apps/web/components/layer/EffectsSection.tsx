'use client'

import { isConditional, type ColorValue, type Conditional, type SharedStyle, type ShadowValue } from '@studio/shared'
import { ColorField } from '../controls/ColorField'
import { NumberField } from '../controls/NumberField'
import { TokenChip } from '../controls/TokenChip'
import { Icon } from '../ui/Icon'
import { AddRemove, Cases, Note, Section } from './parts'
import { useLayerWrite, type SectionChange, type SectionProps } from './section'
import styles from './LayerSection.module.css'

/** A new blur's radius in points, as the modifier menu's Blur starts. */
const NEW_BLUR = 4
/** A new drop shadow, as Figma's: black at 25%, 4 points down and 4 of blur. */
const NEW_SHADOW: ShadowValue = { color: { name: 'black', opacity: 0.25 }, radius: 4, x: 0, y: 4 }
/** SwiftUI's own shadow colour, `Color(.sRGBLinear, white: 0, opacity: 0.33)`, shown where a shadow leaves it out. */
const SWIFTUI_SHADOW: ColorValue = { name: 'black', opacity: 0.33 }

const percent = (amount: number) => Math.round(amount * 1000) / 10

/**
 * The layer's Effects, as Figma's Layer and Effects sections: the layer's opacity as a
 * percent, a drop shadow and a blur, each added, set and taken away on its own row.
 *
 * Full opacity, no shadow and no blur are no modifier at all, so 100%, a removed shadow and
 * a cleared radius take theirs away. An opacity a condition chooses shows both cases.
 */
export function EffectsSection({ layer, set, busy, tokens }: SectionProps) {
  const { write, error } = useLayerWrite((change: SectionChange<'effects'>) => ({ section: 'effects', ...change }), { set, busy })
  const { opacity, blur, shadow = { value: null, state: 'absent' } } = layer.effects
  const blurred = blur.state !== 'absent'
  const shadowed = shadow.state !== 'absent'
  const amount = opacity.value
  return <Section title="Effects" testId="layer-effects" error={error}>
    <div className={styles.row}><span>Opacity</span>
      {isConditional(amount) ? <Cases label="Layer opacity" value={amount} field={(which, names) => <NumberField {...names} unit="%" min={0} max={100} disabled={busy || !!opacity.disabledReason}
        value={percent(amount[which])} onCommit={next => write({ opacity: { ...amount, [which]: next / 100 } as Conditional<number> })} />} /> : <NumberField label="Layer opacity" caption={<Icon name="opacity" size={12} />} unit="%" min={0} max={100} disabled={busy || !!opacity.disabledReason}
        value={opacity.disabledReason ? null : percent(amount)} placeholder="Code" onCommit={next => write({ opacity: next / 100 })} />}
    </div>
    <Note>{opacity.disabledReason}</Note>

    <div className={styles.heading}><h4>Drop shadow</h4>
      <AddRemove name="drop shadow" present={shadowed} disabled={busy || !!shadow.disabledReason} locked={layer.locked} onAdd={() => void write({ shadow: NEW_SHADOW })} onRemove={() => void write({ shadow: null })} />
    </div>
    {shadow.value && <ShadowFields value={shadow.value} tokens={tokens} disabled={busy || !!shadow.disabledReason} onChange={next => write({ shadow: next })} />}
    <Note>{shadow.disabledReason}</Note>

    <div className={styles.heading}><h4>Blur</h4>
      <AddRemove name="blur" present={blurred} disabled={busy || !!blur.disabledReason} locked={layer.locked} onAdd={() => void write({ blur: NEW_BLUR })} onRemove={() => void write({ blur: null })} />
    </div>
    {blurred && <div className={styles.row}><span>Radius</span>
      <NumberField label="Blur radius" caption={<Icon name="blur" size={12} />} unit="pt" min={0} disabled={busy || !!blur.disabledReason} value={blur.value as number | null} placeholder="Code"
        onCommit={radius => write({ blur: radius })} onClear={() => write({ blur: null })} />
    </div>}
    <Note>{blur.disabledReason}</Note>
  </Section>
}

/** A shadow token's values as a shadow the layer can take, for Detach: its colour, opacity, blur and offset. */
function tokenShadow(token: string, tokens: readonly SharedStyle[]): ShadowValue | undefined {
  const style = tokens.find(candidate => candidate.kind === 'shadow' && [`.${candidate.name}`, candidate.reference, `ShadowToken.${candidate.name}`].includes(token))
  const value = style?.shadow
  if (!value) return undefined
  const color: ColorValue = value.color.startsWith('#') ? { hex: value.color } : { name: value.color }
  return { color: value.opacity < 1 ? { ...color, opacity: value.opacity } : color, radius: value.radius, x: value.x, y: value.y }
}

/** A drop shadow's colour, offset and blur, or a shadow token as a chip that detaches into them. */
function ShadowFields({ value, tokens, disabled, onChange }: { value: ShadowValue; tokens: readonly SharedStyle[]; disabled: boolean; onChange: (shadow: ShadowValue) => Promise<boolean> }) {
  if ('token' in value) {
    const detached = tokenShadow(value.token, tokens)
    return <div className={styles.row}><span>Token</span>
      <TokenChip token={value.token} disabled={disabled} actions={detached ? { onDetach: async () => (await onChange(detached)) ? null : 'This shadow could not be detached.' } : undefined} />
    </div>
  }
  return <>
    <ColorField label="Shadow" value={value.color ?? SWIFTUI_SHADOW} tokens={tokens} disabled={disabled} onChange={color => onChange({ ...value, color })} />
    <div className={styles.row}><span>Offset</span>
      <div className={styles.pair}>{(['x', 'y'] as const).map(axis => <NumberField key={axis} label={`Shadow ${axis.toUpperCase()}`} caption={axis.toUpperCase()} unit="pt" disabled={disabled}
        value={value[axis]} onCommit={next => onChange({ ...value, [axis]: next })} />)}</div>
    </div>
    <div className={styles.row}><span>Blur</span>
      <NumberField label="Shadow blur" caption={<Icon name="blur" size={12} />} unit="pt" min={0} disabled={disabled} value={value.radius} onCommit={radius => onChange({ ...value, radius })} />
    </div>
    {!value.color && <Note>SwiftUI’s own shadow color. Choose one to set it.</Note>}
  </>
}
