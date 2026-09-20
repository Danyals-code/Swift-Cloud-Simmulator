'use client'

import { useState } from 'react'
import { symbolAsset } from '@studio/swiftui-render-dom'
import type { AppNavigationModel, NavigationOperation, SourceSpan } from '@studio/shared'
import { TAB_LIMIT } from '@studio/swift-sema'
import type { DesignScreen } from '../../lib/screens'
import { SymbolPicker } from '../SymbolPicker'
import { Icon } from '../ui/Icon'
import styles from './Settings.module.css'

export interface AppNavigationProps {
  navigation?: AppNavigationModel
  /** Every screen a tab can show, by the name the studio calls it. */
  screens: readonly DesignScreen[]
  busy: boolean
  onCommand: (operation: NavigationOperation) => Promise<string | null>
  onReveal: (span: SourceSpan) => void
}

/**
 * How the app is navigated, at the App level.
 *
 * Tabs are a list here because that is what they are to a designer: a name, a
 * symbol and a screen, in an order. Everything this panel does is written back as
 * ordinary SwiftUI - `TabView` with one `.tabItem` per row - so the tab bar the
 * canvas draws and the tab bar the app ships are the same code. When the tabs were
 * written by hand in a way the editor cannot reproduce, it says so and offers the
 * code instead of guessing.
 */
export function AppNavigationSettings({ navigation, screens, busy, onCommand, onReveal }: AppNavigationProps) {
  const [error, setError] = useState<string | null>(null)
  const [choosingIcon, setChoosingIcon] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ screen: '', name: '', icon: 'circle' })
  const tabs = navigation?.tabs ?? []
  const nameOf = (view: string) => screens.find(screen => screen.view === view)?.name ?? view
  const run = async (operation: NavigationOperation) => {
    setError(await onCommand(operation))
  }
  const free = screens.filter(screen => !tabs.some(tab => tab.screen === screen.view))

  return <section className={styles.section} aria-label="Navigation" data-testid="app-navigation">
    <div className={styles.sectionHeader}><h3>Navigation</h3></div>
    {navigation?.style === 'none' || !navigation
      ? <p className={styles.note}>This project has no app entry point yet.</p>
      : <>
        {/* Two shapes, said plainly. A designer picks how the app is organised,
            not which SwiftUI container builds it. */}
        <div className={styles.segmented} role="group" aria-label="Navigation style">
          <button type="button" aria-pressed={navigation.style === 'stack'} disabled={busy || !navigation.editable} title="One screen that leads to others" onClick={() => void run({ kind: 'navigation-style', style: 'stack' })}>One screen</button>
          <button type="button" aria-pressed={navigation.style === 'tabs'} disabled={busy || !navigation.editable} title="A tab bar along the bottom" onClick={() => void run({ kind: 'navigation-style', style: 'tabs', name: nameOf(navigation.root ?? ''), icon: 'house' })}>Tabs</button>
        </div>
        {navigation.style === 'tabs' && <div className={styles.tabs} data-testid="tab-list">
          {tabs.map((tab, index) => {
            const asset = symbolAsset(tab.icon || 'circle', `tab-${index}`)
            return <div key={`${tab.screen}:${index}`} className={styles.tabRow} data-testid="tab-row">
              <button type="button" className={styles.iconButton} aria-label={`Symbol for ${tab.name || nameOf(tab.screen)}`} aria-expanded={choosingIcon === index} disabled={busy || !navigation.editable} title={tab.icon || 'Choose a symbol'} onClick={() => setChoosingIcon(choosingIcon === index ? null : index)}>
                {asset ? <svg viewBox={asset.viewBox} width="15" height="15" aria-hidden="true" dangerouslySetInnerHTML={{ __html: asset.body }} /> : <Icon name="circle" size={13} />}
              </button>
              {navigation.editable
                ? <input aria-label={`Tab ${index + 1} name`} defaultValue={tab.name} key={`name:${tab.name}`} disabled={busy} onBlur={event => { if (event.target.value !== tab.name) void run({ kind: 'tab-update', index, name: event.target.value }) }} onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') { (event.target as HTMLInputElement).value = tab.name; (event.target as HTMLInputElement).blur() } }} />
                : <span>{tab.name || nameOf(tab.screen)}</span>}
              {navigation.editable
                ? <select aria-label={`Tab ${index + 1} screen`} value={tab.screen} disabled={busy || !screens.some(screen => screen.view === tab.screen)} title={screens.some(screen => screen.view === tab.screen) ? 'The screen this tab shows' : 'This tab’s screen is written in Swift. Open the code to change it.'} onChange={event => void run({ kind: 'tab-update', index, screen: event.target.value })}>
                  {screens.map(screen => <option key={screen.view} value={screen.view} disabled={screen.view !== tab.screen && tabs.some(other => other.screen === screen.view)}>{screen.name}</option>)}
                  {!screens.some(screen => screen.view === tab.screen) && <option value={tab.screen}>{tab.screen || 'Written in Swift'}</option>}
                </select>
                : <span>{nameOf(tab.screen)}</span>}
              {navigation.editable && <span className={styles.inline}>
                <button type="button" className={styles.iconButton} aria-label={`Move ${tab.name} up`} disabled={busy || index === 0} onClick={() => void run({ kind: 'tab-move', index, toIndex: index - 1 })}><Icon name="chevron-up" size={11} /></button>
                <button type="button" className={styles.iconButton} aria-label={`Move ${tab.name} down`} disabled={busy || index === tabs.length - 1} onClick={() => void run({ kind: 'tab-move', index, toIndex: index + 1 })}><Icon name="chevron-down" size={11} /></button>
                <button type="button" className={styles.iconButton} aria-label={`Remove ${tab.name}`} disabled={busy || tabs.length === 1} onClick={() => void run({ kind: 'tab-remove', index })}><Icon name="xmark" size={11} /></button>
              </span>}
            </div>
          })}
        </div>}
        {choosingIcon !== null && navigation.editable && <SymbolPicker selected={tabs[choosingIcon]?.icon ?? ''} onChoose={async name => {
          const problem = await onCommand({ kind: 'tab-update', index: choosingIcon, icon: name })
          setError(problem)
          if (!problem) setChoosingIcon(null)
          return problem
        }} />}
        {navigation.style === 'tabs' && tabs.length > TAB_LIMIT && <p className={styles.warning} role="status">iPhone shows {TAB_LIMIT} tabs; the rest are grouped under “More”. Consider moving some screens inside a tab.</p>}
        {!navigation.editable && <p className={styles.note}>{navigation.reason} {navigation.source && <button type="button" className={styles.link} onClick={() => onReveal(navigation.source!)}>Open in Code</button>}</p>}
        {navigation.editable && navigation.style === 'tabs' && (adding
          ? <div className={styles.states} data-testid="add-tab">
            <div className={styles.row}><label htmlFor="tab-screen">Screen</label><select id="tab-screen" aria-label="New tab screen" value={draft.screen} onChange={event => setDraft({ ...draft, screen: event.target.value, name: draft.name || nameOf(event.target.value) })}><option value="" disabled>Choose…</option>{free.map(screen => <option key={screen.view} value={screen.view}>{screen.name}</option>)}</select></div>
            <div className={styles.row}><label htmlFor="tab-name">Name</label><input id="tab-name" aria-label="New tab name" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></div>
            <SymbolPicker selected={draft.icon} onChoose={async name => { setDraft({ ...draft, icon: name }); return null }} />
            <div className={styles.actions}>
              <button type="button" className={styles.primary} disabled={busy || !draft.screen || !draft.name.trim()} onClick={async () => { const problem = await onCommand({ kind: 'tab-add', screen: draft.screen, name: draft.name.trim(), icon: draft.icon }); setError(problem); if (!problem) { setAdding(false); setDraft({ screen: '', name: '', icon: 'circle' }) } }}>Add tab</button>
              <button type="button" className={styles.button} onClick={() => { setAdding(false); setError(null) }}>Cancel</button>
            </div>
          </div>
          : <div className={styles.actions}><button type="button" className={styles.button} disabled={busy || !free.length} title={free.length ? 'Add a tab for one of your screens' : 'Every screen is already a tab'} onClick={() => { setAdding(true); setError(null); setDraft({ screen: free[0]?.view ?? '', name: free[0] ? nameOf(free[0].view) : '', icon: 'circle' }) }}>Add tab</button></div>)}
        {navigation.style === 'stack' && <p className={styles.note}>The app starts on {navigation.root ? nameOf(navigation.root) : 'a screen built in Swift'}. Screens lead to each other through the Navigate to action on a button.</p>}
      </>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>
}
