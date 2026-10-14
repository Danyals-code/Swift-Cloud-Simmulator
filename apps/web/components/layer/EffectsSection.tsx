'use client'

import { NumberField } from '../controls/NumberField'
import { Icon } from '../ui/Icon'
import { AddRemove, IconButton, Note, Section } from './parts'
import { useLayerWrite, type SectionChange, type SectionProps } from './section'
import styles from './LayerSection.module.css'

/** A new blur's radius in points, as the modifier menu's Blur starts. */
const NEW_BLUR = 4

/**
 * The layer's Effects, as Figma's Layer and Effects sections: the layer's opacity as a
 * percent, and a blur added, set and taken away from the heading as an effect is.
 *
 * Full opacity and no blur are no modifier at all, so 100% and a cleared radius take
 * theirs away.
 */
export function EffectsSection({ layer, set, busy }: SectionProps) {
  const { write, error } = useLayerWrite((change: SectionChange<'effects'>) => ({ section: 'effects', ...change }), { set, busy })
  const { opacity, blur } = layer.effects
  const blurred = blur.state !== 'absent'
  return <Section title="Effects" testId="layer-effects" error={error}
    action={<AddRemove name="blur" present={blurred} disabled={busy} locked={layer.locked} onAdd={() => void write({ blur: NEW_BLUR })} />}>
    <div className={styles.row}><span>Opacity</span>
      <NumberField label="Layer opacity" caption={<Icon name="opacity" size={12} />} unit="%" min={0} max={100} disabled={busy || !!opacity.disabledReason}
        value={opacity.disabledReason ? null : Math.round(opacity.value * 1000) / 10} placeholder="Code" onCommit={percent => write({ opacity: percent / 100 })} />
    </div>
    {blurred && <div className={styles.row}><span>Blur</span>
      <div className={styles.inset}>
        <NumberField label="Blur radius" caption={<Icon name="blur" size={12} />} unit="pt" min={0} disabled={busy || !!blur.disabledReason} value={blur.value} placeholder="Code"
          onCommit={radius => write({ blur: radius })} onClear={() => write({ blur: null })} />
        <IconButton icon="minus" label="Remove blur" disabled={busy || !!blur.disabledReason} onClick={() => void write({ blur: null })} />
      </div>
    </div>}
    <Note>{opacity.disabledReason}</Note>
    <Note>{blur.disabledReason}</Note>
  </Section>
}
