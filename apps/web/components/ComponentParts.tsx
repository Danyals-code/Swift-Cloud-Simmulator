'use client'

import { useState } from 'react'
import { swiftName, variantCaseWords, type AuthoringNode, type AuthoringOperation, type VariantProperty } from '@studio/shared'
import { differsChoices, exposeChoices } from '../lib/componentInputs'
import styles from './AuthoringInspector.module.css'

type Command = (operation: AuthoringOperation) => Promise<string | null>

/**
 * Changeable per copy (Wave 5b): what the view has that each copy can set, its text, its
 * symbol or image, a colour or a number written on it, or whether it is shown. Copies that
 * exist now keep what they show. An empty name lets the planner pick a free one.
 */
export function ChangeablePerCopy({ node, busy, command }: { node: AuthoringNode; busy: boolean; command: Command }) {
  const choices = exposeChoices(node)
  const [index, setIndex] = useState(0), [name, setName] = useState(choices[0]?.as === 'text' ? 'label' : '')
  const choice = choices[index] ?? choices[0]
  if (!choice) return null
  const word = choice.as
  return <details data-testid="changeable-per-copy"><summary>Changeable per copy</summary>
    <p>{choice.as === 'shown' ? 'Let each copy show or hide this view. Copies that exist now keep showing it.' : choice.as === 'text' ? `Let each copy set its own text. Copies that exist now keep “${node.controls?.find(control => control.id === choice.control)?.value ?? ''}”.` : `Let each copy set its own ${word}. Copies that exist now keep what they show.`}</p>
    {choices.length > 1 && <label>Value<select aria-label="Value each copy sets" value={index} disabled={busy} onChange={event => { const next = Number(event.target.value); setIndex(next); setName(choices[next]?.as === 'text' ? 'label' : '') }}>
      {choices.map((option, at) => <option key={`${option.as}:${option.control}`} value={at}>{option.label}</option>)}
    </select></label>}
    <label>Field name<input aria-label="Component input name" value={name} placeholder="Automatic" maxLength={64} onChange={event => setName(event.target.value)} /></label>
    <button type="button" disabled={busy} onClick={() => void command({ kind: 'component-expose', control: choice.control, name: name.trim(), as: choice.as })}>{choice.as === 'shown' ? 'Let each copy show or hide it' : `Make ${word} changeable per copy`}</button>
  </details>
}

/**
 * Variants of a Main (Wave 5b): properties of two values each copy picks, written as a
 * nested enum. A value in the Main can differ by one, and then shows a field for each case.
 * Three or more values are written in Code.
 */
export function Variants({ node, variants, busy, command }: { node: AuthoringNode; /** The variant properties of the Main the view is in, or of the Main itself. */ variants: readonly VariantProperty[]; busy: boolean; command: Command }) {
  const values = node.kind === 'definition' ? [] : differsChoices(node)
  const [property, setProperty] = useState('Style'), [first, setFirst] = useState('Primary'), [second, setSecond] = useState('Secondary')
  const [control, setControl] = useState(values[0]?.control ?? ''), [by, setBy] = useState(variants[0]?.name ?? '')
  const differs = variants.find(variant => variant.name === by) ?? variants[0]
  // Sent as typed: the planner names them in Swift, "Extra large" as `extraLarge`; here only to tell one that can't be (Wave 5b).
  const names = [property, first, second].map(swiftName)
  return <section data-testid="component-variant-properties"><h3>Variants</h3>
    {variants.length ? <ul>{variants.map(variant => <li key={variant.name}><strong>{variantCaseWords(variant.name)}</strong> · {variant.cases.map(variantCaseWords).join(', ')}</li>)}</ul>
      : <p>Each copy picks one value of a variant property. Values in the Main can differ by it.</p>}
    {differs && !!values.length && <div>
      <label>Value<select aria-label="Value that differs" value={control} disabled={busy} onChange={event => setControl(event.target.value)}>{values.map(value => <option key={value.control} value={value.control}>{value.label}</option>)}</select></label>
      {variants.length > 1 && <label>Property<select aria-label="Differs by property" value={differs.name} disabled={busy} onChange={event => setBy(event.target.value)}>{variants.map(variant => <option key={variant.name} value={variant.name}>{variantCaseWords(variant.name)}</option>)}</select></label>}
      <button type="button" disabled={busy || !control} onClick={() => void command({ kind: 'component-differs', control, property: differs.name })}>Differs by {variantCaseWords(differs.name)}</button>
      <p>It then has a value for each case: When {variantCaseWords(differs.cases[0])} and When {variantCaseWords(differs.cases[1])}.</p>
    </div>}
    <details><summary>Add variant property</summary>
      <label>Property<input aria-label="Variant property name" value={property} maxLength={64} onChange={event => setProperty(event.target.value)} /></label>
      <label>First value<input aria-label="First variant value" value={first} maxLength={64} onChange={event => setFirst(event.target.value)} /></label>
      <label>Second value<input aria-label="Second variant value" value={second} maxLength={64} onChange={event => setSecond(event.target.value)} /></label>
      <p>Copies that exist now are the first value. Three or more values are written in Code.</p>
      <button type="button" disabled={busy || names.some(part => !part) || names[1] === names[2]} onClick={() => void command({ kind: 'component-variant-add', name: property.trim(), cases: [first.trim(), second.trim()] })}>Add variant property</button>
    </details>
  </section>
}

/**
 * Swap and Detach at a copy (Wave 5b). Swap lists every other component, never a screen,
 * those whose inputs don't fit disabled with the reason, as the planner reads them; Detach
 * puts the views the copy shows in its place and keeps the Main.
 */
export function CopyActions({ node, busy, command }: { node: AuthoringNode; busy: boolean; command: Command }) {
  const instance = node.instance
  if (!instance) return null
  const swaps = instance.swap
  const refusals = swaps.filter(choice => choice.disabledReason)
  return <div data-testid="copy-actions">
    {!!swaps.length && <label>Swap to<select aria-label="Swap component" value="" disabled={busy || refusals.length === swaps.length} onChange={event => { if (event.target.value) void command({ kind: 'instance-swap', component: event.target.value }) }}>
      <option value="" disabled>Choose a component</option>
      {swaps.map(choice => <option key={choice.component} value={choice.component} disabled={!!choice.disabledReason} title={choice.disabledReason}>{choice.component}{choice.disabledReason ? ' (doesn’t fit)' : ''}</option>)}
    </select></label>}
    {refusals.map(choice => <p key={choice.component} className={styles.note}>{choice.disabledReason}</p>)}
    <button type="button" disabled={busy || !!instance.detachDisabledReason} title={instance.detachDisabledReason} onClick={() => void command({ kind: 'instance-detach' })}>Detach copy</button>
    <p className={styles.note}>{instance.detachDisabledReason ?? `The copy becomes the views it shows. ${node.name} stays under Components.`}</p>
  </div>
}
