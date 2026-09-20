'use client'

import { useState } from 'react'
import type { AuthoringNode, AuthoringSnapshot, FontTokenValue, ResourceOperation, ShadowTokenValue, SharedStyle, StyleKind, TokenDefinition } from '@studio/shared'
import { FONT_WEIGHTS, SYSTEM_COLOR_SWATCHES, TEXT_STYLES, TOKEN_KINDS, impactSentence, nameHint, suggestedName, swatchFor, tokenImpact } from '../../lib/tokens'
import { propertyOptionLabel } from '../PropertyControl'
import { sourceLayerLabel } from '../../lib/sourceLayers'
import { Icon } from '../ui/Icon'
import styles from './Settings.module.css'

export interface TokenLibraryProps {
  snapshot?: AuthoringSnapshot
  screenViews: readonly string[]
  busy: boolean
  /** Asset names already taken by images, which a colour set may not reuse. */
  imageNames: readonly string[]
  onCommand: (operation: ResourceOperation) => Promise<string | null>
  onSelect?: (node: AuthoringNode) => void
}

/** A token's value while it is being edited, before it is saved. */
export interface TokenDraft { value: string; dark?: string; font?: FontTokenValue; shadow?: ShadowTokenValue }

export function draftOf(token: SharedStyle): TokenDraft {
  if (token.kind === 'color') return { value: token.light ?? token.value, ...(token.dark ? { dark: token.dark } : {}) }
  if (token.kind === 'font') return { value: token.font?.style ?? token.value, font: token.font ?? { style: token.value } }
  if (token.kind === 'shadow') return { value: '', shadow: token.shadow ?? { color: 'black', opacity: 0.12, radius: 8, x: 0, y: 4 } }
  return { value: token.value }
}
const SYSTEM_COLORS = ['primary', 'secondary', 'accentColor', 'black', 'white', 'gray', 'red', 'orange', 'yellow', 'green', 'mint', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'brown']
const blank = (kind: StyleKind): TokenDraft => kind === 'color' ? { value: '#0A84FF' } : kind === 'font' ? { value: 'headline', font: { style: 'headline' } } : kind === 'shadow' ? { value: '', shadow: { color: 'black', opacity: 0.12, radius: 8, x: 0, y: 4 } } : { value: kind === 'radius' ? '12' : '16' }
export const definitionOf = (draft: TokenDraft): TokenDefinition => ({ value: draft.value, ...(draft.dark ? { dark: draft.dark } : {}), ...(draft.font ? { font: draft.font } : {}), ...(draft.shadow ? { shadow: draft.shadow } : {}) })

/**
 * The App's tokens: named values defined once and picked in every field.
 *
 * Each kind is a section, and each token shows its value and how widely it is used.
 * Editing one says what it will reach before anything changes, because a token edit
 * is the one change in the studio that lands in many places at once.
 */
export function TokenLibrary({ snapshot, screenViews, busy, imageNames, onCommand, onSelect }: TokenLibraryProps) {
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState<StyleKind | null>(null)
  const tokens = snapshot?.styles ?? []
  return <>{TOKEN_KINDS.map(({ kind, title, singular }) => {
    const list = tokens.filter(token => token.kind === kind)
    return <section key={kind} className={styles.section} data-testid={`tokens-${kind}`} aria-label={title}>
      <div className={styles.sectionHeader}><h3>{title}</h3><span><button type="button" className={styles.iconButton} aria-label={`New ${singular} token`} title={`New ${singular} token`} aria-expanded={creating === kind} disabled={busy} onClick={() => setCreating(creating === kind ? null : kind)}><Icon name="plus" size={13} /></button></span></div>
      {creating === kind && <CreateToken kind={kind} existing={tokens.map(t => t.name)} imageNames={imageNames} busy={busy} onCancel={() => setCreating(null)} onCreate={async (name, draft) => { const problem = await onCommand({ kind: 'style-create', name, style: kind, value: draft.value, token: definitionOf(draft) }); if (!problem) { setCreating(null); setOpen(name) } return problem }} />}
      <div className={styles.tokenList}>
        {list.map(token => <TokenRow key={token.name} token={token} open={open === token.name} onToggle={() => setOpen(open === token.name ? null : token.name)} snapshot={snapshot} screenViews={screenViews} busy={busy} onCommand={onCommand} onSelect={onSelect} />)}
        {!list.length && creating !== kind && <p className={styles.note}>No {singular} tokens yet.</p>}
      </div>
    </section>
  })}</>
}

export function TokenSwatch({ token, kind, value, dark }: { token?: SharedStyle; kind: StyleKind; value?: string; dark?: string }) {
  if (kind === 'color') {
    const light = swatchFor(value, false, token), night = token?.dark ?? dark
    return <span className={styles.swatch} data-split={night ? true : undefined} aria-hidden><i style={{ background: light }} />{night && <i style={{ background: swatchFor(night) }} />}</span>
  }
  const glyph = kind === 'spacing' ? '↔' : kind === 'radius' ? '◜' : kind === 'font' ? 'Aa' : '▢'
  return <span className={styles.glyph} aria-hidden>{glyph}</span>
}

function TokenRow({ token, open, onToggle, snapshot, screenViews, busy, onCommand, onSelect }: { token: SharedStyle; open: boolean; onToggle: () => void; snapshot?: AuthoringSnapshot; screenViews: readonly string[]; busy: boolean; onCommand: TokenLibraryProps['onCommand']; onSelect?: TokenLibraryProps['onSelect'] }) {
  const [draft, setDraft] = useState<TokenDraft>(() => draftOf(token))
  const [saved, setSaved] = useState(token)
  const [error, setError] = useState<string | null>(null)
  const [showUses, setShowUses] = useState(false)
  if (saved !== token) { setSaved(token); setDraft(draftOf(token)) }
  const impact = tokenImpact(token, snapshot, screenViews)
  const changed = JSON.stringify(draft) !== JSON.stringify(draftOf(token))
  const legacy = token.form === 'legacy'
  return <div className={styles.tokenRow} data-open={open || undefined} data-testid="token-row" data-token={token.name}>
    <button type="button" className={styles.tokenSummary} aria-expanded={open} onClick={onToggle}>
      <TokenSwatch token={token} kind={token.kind} value={token.value} />
      <strong>{token.name}</strong>
      {legacy && <span className={styles.legacy} title="Written before Tokens.swift. It still works everywhere.">Older style</span>}
      <small>{token.kind === 'color' ? '' : token.value}{token.uses.length ? `${token.kind === 'color' ? '' : ' · '}${token.uses.length} ${token.uses.length === 1 ? 'use' : 'uses'}` : ''}</small>
    </button>
    {open && <>
      <TokenValueInputs kind={token.kind} draft={draft} onChange={next => { setDraft(next); setError(null) }} disabled={busy || legacy && !['color', 'spacing', 'font'].includes(token.kind)} legacy={legacy} />
      <p className={styles.note} data-testid="token-impact">{impactSentence(impact)}{impact.places > 0 && <> <button type="button" className={styles.link} onClick={() => setShowUses(!showUses)}>{showUses ? 'Hide' : 'Show'}</button></>}</p>
      {showUses && <div className={styles.uses}>{impact.nodes.map((node, index) => <button key={`${node.id}:${index}`} type="button" onClick={() => onSelect?.(node)}>{sourceLayerLabel(node)} · {node.owner.split('.')[0]}</button>)}</div>}
      {changed && <p className={styles.warning}>{impact.places > 1 ? `Saving changes all ${impact.places} places at once.` : 'Saving changes this token everywhere it is used.'}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={busy || !changed} onClick={async () => setError(await onCommand({ kind: 'style-edit', name: token.name, value: draft.value, token: definitionOf(draft) }))}>{impact.places > 1 ? 'Update everywhere' : 'Save'}</button>
        {changed && <button type="button" className={styles.button} onClick={() => setDraft(draftOf(token))}>Revert</button>}
        {legacy && !token.name.includes('.') && <button type="button" className={styles.button} disabled={busy} title="Moves this style into DesignSystem/Tokens.swift and updates every reference in one step" onClick={async () => setError(await onCommand({ kind: 'style-migrate', name: token.name }))}>Move to Tokens.swift</button>}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </>}
  </div>
}

function CreateToken({ kind, existing, imageNames, busy, onCreate, onCancel }: { kind: StyleKind; existing: readonly string[]; imageNames: readonly string[]; busy: boolean; onCreate: (name: string, draft: TokenDraft) => Promise<string | null>; onCancel: () => void }) {
  const [draft, setDraft] = useState<TokenDraft>(() => blank(kind))
  const [name, setName] = useState(() => suggestedName(kind, existing))
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const hint = nameHint(kind, name) ?? (existing.includes(name) ? 'This name is already a token.' : kind === 'color' && imageNames.some(image => image.toLowerCase() === name.toLowerCase()) ? 'An image already uses this name in the asset catalog.' : null)
  return <form className={styles.tokenRow} data-open onSubmit={async event => { event.preventDefault(); if (hint || pending) return; setPending(true); try { setError(await onCreate(name.trim(), draft)) } finally { setPending(false) } }} data-testid="token-create">
    <div className={styles.row}><label htmlFor={`token-name-${kind}`}>Name</label><input id={`token-name-${kind}`} aria-label="Token name" autoFocus value={name} spellCheck={false} onChange={event => { setName(event.target.value); setError(null) }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onCancel() } }} /></div>
    <TokenValueInputs kind={kind} draft={draft} onChange={setDraft} disabled={busy || pending} />
    {hint && <p className={styles.note}>{hint}</p>}
    <p className={styles.note}>Written to DesignSystem/Tokens.swift{kind === 'color' ? ', with its light and dark values in the asset catalog' : ''}. Use it as <code>.{name || 'name'}</code>.</p>
    <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy || pending || !!hint}>Create token</button><button type="button" className={styles.button} onClick={onCancel}>Cancel</button></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </form>
}

/** The value inputs for one token kind. */
export function TokenValueInputs({ kind, draft, onChange, disabled, legacy = false }: { kind: StyleKind; draft: TokenDraft; onChange: (draft: TokenDraft) => void; disabled?: boolean; legacy?: boolean }) {
  if (kind === 'color') {
    const hex = (value: string) => /^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : '#000000'
    const system = !draft.value.startsWith('#')
    return <>
      <div className={styles.row}><span>Color</span><select aria-label="Color source" value={system ? draft.value : '#custom'} disabled={disabled} onChange={event => onChange(event.target.value === '#custom' ? { value: SYSTEM_COLOR_SWATCHES[draft.value]?.slice(0, 7) ?? '#0A84FF' } : { value: event.target.value })}>
        <option value="#custom">{legacy ? 'Custom color' : 'Custom · light and dark'}</option>
        <optgroup label="System · adapts to dark mode">{SYSTEM_COLORS.map(name => <option key={name} value={name}>{propertyOptionLabel(name)}</option>)}</optgroup>
      </select></div>
      {system ? <p className={styles.note}>A system color. It adapts to light and dark mode on its own.</p> : <>
        <div className={styles.row}><span>{legacy ? 'Value' : 'Light'}</span><span className={styles.inline}><input type="color" aria-label="Light value swatch" value={hex(draft.value)} disabled={disabled} onChange={event => onChange({ ...draft, value: event.target.value.toUpperCase() })} /><input aria-label="Light value" value={draft.value} disabled={disabled} spellCheck={false} onChange={event => onChange({ ...draft, value: event.target.value })} /></span></div>
        {!legacy && <div className={styles.row}><span>Dark</span><span className={styles.inline}>
          {draft.dark !== undefined ? <><input type="color" aria-label="Dark value swatch" value={hex(draft.dark)} disabled={disabled} onChange={event => onChange({ ...draft, dark: event.target.value.toUpperCase() })} /><input aria-label="Dark value" value={draft.dark} disabled={disabled} spellCheck={false} onChange={event => onChange({ ...draft, dark: event.target.value })} /><button type="button" className={styles.iconButton} aria-label="Use the light value in dark mode" title="Same as light" disabled={disabled} onClick={() => { const { dark: _dark, ...rest } = draft; void _dark; onChange(rest) }}><Icon name="xmark" size={11} /></button></>
            : <button type="button" className={styles.link} disabled={disabled} onClick={() => onChange({ ...draft, dark: draft.value })}>Same as light · Add dark value</button>}
        </span></div>}
      </>}
    </>
  }
  if (kind === 'spacing' || kind === 'radius') return <div className={styles.row}><span>{kind === 'radius' ? 'Radius' : 'Size'}</span><span className={styles.inline}><input aria-label="Token value" inputMode="decimal" value={draft.value} disabled={disabled} onChange={event => onChange({ ...draft, value: event.target.value })} /><span className={styles.unit}>pt</span></span></div>
  if (kind === 'font') {
    const font = draft.font ?? { style: draft.value }
    const custom = font.size !== undefined || font.style === 'custom'
    const set = (next: FontTokenValue) => onChange({ ...draft, value: next.style, font: next })
    return <>
      <div className={styles.row}><span>Based on</span><select aria-label="Text style" value={custom ? 'custom' : font.style} disabled={disabled} onChange={event => set(event.target.value === 'custom' ? { style: 'custom', size: TEXT_STYLES.find(s => s.value === font.style)?.size ?? 17, ...(font.weight ? { weight: font.weight } : {}) } : { style: event.target.value, ...(font.weight ? { weight: font.weight } : {}) })}>{TEXT_STYLES.map(style => <option key={style.value} value={style.value}>{style.label} · {style.size} pt</option>)}<option value="custom">Fixed size (does not scale)</option></select></div>
      {custom && <div className={styles.row}><span>Size</span><span className={styles.inline}><input aria-label="Text size" inputMode="decimal" value={font.size ?? ''} disabled={disabled} onChange={event => set({ ...font, style: 'custom', size: Number(event.target.value) })} /><span className={styles.unit}>pt</span></span></div>}
      {!legacy && <div className={styles.row}><span>Weight</span><select aria-label="Text weight" value={font.weight ?? ''} disabled={disabled} onChange={event => { const { weight: _weight, ...rest } = font; void _weight; set(event.target.value ? { ...rest, weight: event.target.value } : rest) }}><option value="">Style default</option>{FONT_WEIGHTS.map(weight => <option key={weight} value={weight}>{weight.charAt(0).toUpperCase() + weight.slice(1)}</option>)}</select></div>}
      {!custom && <p className={styles.note}>Scales with the reader’s text size, like every Dynamic Type style.</p>}
    </>
  }
  const shadow = draft.shadow ?? { color: 'black', opacity: 0.12, radius: 8, x: 0, y: 4 }
  const set = (next: Partial<ShadowTokenValue>) => onChange({ ...draft, shadow: { ...shadow, ...next } })
  const number = (label: string, key: 'radius' | 'x' | 'y', unit = 'pt') => <div className={styles.row}><span>{label}</span><span className={styles.inline}><input aria-label={`Shadow ${label.toLowerCase()}`} inputMode="decimal" value={shadow[key]} disabled={disabled} onChange={event => set({ [key]: Number(event.target.value) })} /><span className={styles.unit}>{unit}</span></span></div>
  return <>
    <div className={styles.row}><span>Color</span><span className={styles.inline}><input type="color" aria-label="Shadow colour" value={/^#/.test(shadow.color) ? shadow.color : shadow.color === 'white' ? '#FFFFFF' : '#000000'} disabled={disabled} onChange={event => set({ color: event.target.value.toUpperCase() === '#000000' ? 'black' : event.target.value.toUpperCase() })} /><input aria-label="Shadow opacity" inputMode="decimal" value={Math.round(shadow.opacity * 100)} disabled={disabled} onChange={event => set({ opacity: Math.max(0, Math.min(100, Number(event.target.value))) / 100 })} /><span className={styles.unit}>%</span></span></div>
    {number('Blur', 'radius')}{number('X', 'x')}{number('Y', 'y')}
  </>
}
