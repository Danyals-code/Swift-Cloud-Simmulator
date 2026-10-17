'use client'

import { DESIGN_NEEDS_SYSTEM, FAMILY_DROPS_DESIGN, IOS_FONT_FAMILIES, TEXT_STYLES, helperPlaces, isConditional } from '@studio/shared'
import { ColorField } from '../controls/ColorField'
import { NumberField } from '../controls/NumberField'
import { TokenChip } from '../controls/TokenChip'
import { CHOICES, Choices, propertyOptionLabel } from '../PropertyControl'
import { familyOptions } from '../../lib/fonts'
import { FONT_WEIGHTS, TEXT_STYLES as STYLE_SIZES } from '../../lib/tokens'
import { ColorCases, IconButton, Note, Section } from './parts'
import { useLayerWrite, type SectionChange, type SectionProps } from './section'
import styles from './LayerSection.module.css'

type TextChange = SectionChange<'text'>

/** A style's name, size and weight at the default text size. */
const styleOf = (style: string | null) => STYLE_SIZES.find(entry => entry.value === style)
/** The text styles as Apple names them, in `TEXT_STYLES` order. */
const STYLE_OPTIONS = TEXT_STYLES.map(style => <option key={style} value={style}>{styleOf(style)?.label}</option>)
/**
 * The text style nearest a size, whose Dynamic Type curve a size in points follows unless
 * the designer picks another: Title for 30, Body (not Headline, its bold twin) for 17.
 */
const nearest = (size: number) => STYLE_SIZES.filter(entry => entry.value !== 'headline').reduce((best, entry) => Math.abs(entry.size - size) < Math.abs(best.size - size) ? entry : best).value

/**
 * The layer's Text, as Figma's Text section: the family, the style or a size in points,
 * weight, design and italic, the colour, alignment, letter and line spacing, and case.
 *
 * A size in points scales with the reader's text size by default, as an `@ScaledMetric`
 * that follows the nearest style. Each control writes one `layer-set` change. A font the
 * panel can't rewrite, such as a family worked out in Swift, locks only the font's controls.
 *
 * Family is System, the project's font files, then iOS's own families (Wave 6f). A font
 * file is one face, so a project font writes its PostScript name, and its weight starts
 * at regular rather than the style's own; Design applies only to the system font.
 */
export function TextSection({ node, layer, set, busy, tokens, fonts = [] }: SectionProps) {
  const { write, error } = useLayerWrite((change: TextChange) => ({ section: 'text', ...change }), { set, busy })
  const text = layer.text
  if (!text) return null
  const { font, color, alignment, tracking, lineSpacing, textCase } = text
  const value = font.value
  const fontOff = busy || !!font.disabledReason
  const size = value.size ?? styleOf(value.style)?.size ?? 17
  const inherited = font.state === 'absent' && node.properties.some(property => property.id.endsWith(':inherited-font') && property.source)
  const chooseStyle = (style: string) => {
    if (style !== 'custom') return void write({ font: { style } })
    // A size in points starts as the style it was, with the style's own weight.
    const from = styleOf(value.style), weight = value.weight ?? (value.face || from?.weight === 'regular' ? undefined : from?.weight)
    void write({ font: { style: null, size, relativeTo: text.scalingUnavailable ? null : value.style, ...weight ? { weight } : {} } })
  }
  // No alignment is SwiftUI's own, the start.
  const aligned = alignment.disabledReason ? null : alignment.value ?? 'leading'

  // A font read through a constant (Wave 3b): its name, what it is, and Detach, which writes the font itself here.
  // A custom face behind one is shown read only, with its name and size (Wave 3b).
  const linked = value.token, declared = linked ? layer.tokens?.[linked]?.declaration : undefined
  const families = familyOptions(fonts, IOS_FONT_FAMILIES, value.face)
  const described = [value.face ?? styleOf(value.style)?.label ?? `${size} pt`, ...value.face && value.size !== undefined ? [`${value.size} pt`] : [], ...value.weight ? [propertyOptionLabel(value.weight)] : []].join(', ')
  return <Section title="Text" testId="layer-text" error={error}>
    {linked && <div className={styles.row}><span>Font</span>
      <TokenChip token={linked} disabled={fontOff} actions={{ detail: described, ...declared ? { uses: helperPlaces(declared.uses) } : {}, ...value.face
        ? { note: font.disabledReason }
        : { onDetach: async () => (await write({ font: {} })) ? null : 'This font could not be detached.' } }} />
    </div>}
    {linked && !value.face && <Note>A change here sets this text’s own font, no longer linked to {linked}.</Note>}
    <label className={styles.row}><span>Family</span>
      <select aria-label="Font family" value={value.face ?? ''} disabled={fontOff} onChange={event => void write({ font: { face: event.target.value || null } })}>
        <option value="">System</option>
        {families.written && <option value={families.written.value}>{families.written.label}</option>}
        {families.project.length > 0 && <optgroup label="In this project">{families.project.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>}
        <optgroup label="iOS">{families.ios.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>
      </select>
    </label>
    {value.design && value.design !== 'default' && !value.face && !font.disabledReason && <Note>{FAMILY_DROPS_DESIGN}</Note>}
    <label className={styles.row}><span>Style</span>
      <select aria-label="Text style" value={value.style ?? 'custom'} disabled={fontOff} onChange={event => chooseStyle(event.target.value)}>
        {STYLE_OPTIONS}<option value="custom">Custom size</option>
      </select>
    </label>
    {value.style === null && <>
      <div className={styles.row}><span>Size</span>
        <NumberField label="Font size" caption="Aa" unit="pt" min={1} value={size} disabled={fontOff}
          onCommit={next => write({ font: { size: next, ...value.relativeTo === nearest(size) ? { relativeTo: nearest(next) } : {} } })} />
      </div>
      <label className={styles.check}><input type="checkbox" checked={!!value.relativeTo} disabled={fontOff || !!text.scalingUnavailable}
        onChange={event => void write({ font: { relativeTo: event.target.checked ? nearest(size) : null } })} />Scales with text size</label>
      <Note>{text.scalingUnavailable}</Note>
      {value.relativeTo && <label className={styles.row}><span>Follows</span>
        <select aria-label="Follows text style" title="The text style whose scaling this size follows" value={value.relativeTo} disabled={fontOff} onChange={event => void write({ font: { relativeTo: event.target.value } })}>{STYLE_OPTIONS}</select>
      </label>}
    </>}
    <label className={styles.row}><span>Weight</span>
      <select aria-label="Font weight" value={value.weight ?? (value.face ? 'regular' : styleOf(value.style)?.weight ?? 'regular')} disabled={fontOff} onChange={event => void write({ font: { weight: event.target.value } })}>
        {FONT_WEIGHTS.map(weight => <option key={weight} value={weight}>{weight === 'ultraLight' ? 'Ultralight' : propertyOptionLabel(weight)}</option>)}
      </select>
    </label>
    <label className={styles.row}><span>Design</span>
      <select aria-label="Font design" value={value.design ?? 'default'} disabled={fontOff || !!value.face} onChange={event => void write({ font: { design: event.target.value } })}>
        {['default', 'serif', 'rounded', 'monospaced'].map(design => <option key={design} value={design}>{propertyOptionLabel(design)}</option>)}
      </select>
    </label>
    {value.face && !font.disabledReason && <Note>{DESIGN_NEEDS_SYSTEM}</Note>}
    <label className={styles.check}><input type="checkbox" checked={!!value.italic} disabled={fontOff} onChange={event => void write({ font: { italic: event.target.checked } })} />Italic</label>
    <Note>{font.disabledReason}</Note>
    {inherited && <Note>This font comes from the view around it.</Note>}

    <div className={styles.heading}><h4>Color</h4>
      {color.value && <IconButton icon="minus" label="Remove text color" disabled={busy || !!color.disabledReason} onClick={() => void write({ color: null })} />}
    </div>
    {isConditional(color.value)
      ? <ColorCases label="Text" value={color.value} tokens={tokens} disabled={busy || !!color.disabledReason} onChange={next => write({ color: next })} />
      : <ColorField label="Text" value={color.value ?? { name: 'primary' }} tokens={tokens} disabled={busy || !!color.disabledReason} onChange={next => write({ color: next })} />}
    <Note>{color.disabledReason}</Note>

    <div className={styles.row}><span>Alignment</span>
      <Choices label="Text alignment" options={CHOICES.across} value={aligned} disabled={busy || !!alignment.disabledReason} onChoose={place => void write({ alignment: place })} />
    </div>
    <Note>{alignment.disabledReason}</Note>
    {([['tracking', tracking, 'Letter spacing', '↔', 0.1], ['lineSpacing', lineSpacing, 'Line spacing', '↕', 1]] as const).map(([field, spacing, label, caption, step]) => <div key={field} className={styles.row}><span>{label}</span>
      {/* No spacing is no modifier, so 0 or an emptied field takes it away. */}
      <NumberField label={label} caption={caption} unit="pt" step={step} min={field === 'lineSpacing' ? 0 : undefined} disabled={busy || !!spacing.disabledReason}
        value={spacing.disabledReason ? null : spacing.value ?? 0} placeholder="Code" onCommit={next => write({ [field]: next || null })} onClear={() => write({ [field]: null })} />
    </div>)}
    <Note>{tracking.disabledReason}</Note>
    <Note>{lineSpacing.disabledReason}</Note>
    <label className={styles.row}><span>Case</span>
      <select aria-label="Text case" value={textCase.value ?? ''} disabled={busy || !!textCase.disabledReason} onChange={event => void write({ textCase: (event.target.value || null) as TextChange['textCase'] })}>
        <option value="">None</option><option value="uppercase">Uppercase</option><option value="lowercase">Lowercase</option>
      </select>
    </label>
    <Note>{textCase.disabledReason}</Note>
  </Section>
}

