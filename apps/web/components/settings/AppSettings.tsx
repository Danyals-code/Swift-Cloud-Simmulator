'use client'

import { useState, type ReactNode } from 'react'
import type { ImageAsset, Project } from '@studio/project-model'
import type { AuthoringNode, AuthoringSnapshot, ResourceOperation } from '@studio/shared'
import type { DesignTree } from '../../lib/designTree'
import { ImageResources } from '../ProjectResources'
import { TokenLibrary } from './TokenLibrary'
import styles from './Settings.module.css'

export interface AppSettingsProps {
  project: Project
  tree: DesignTree
  snapshot?: AuthoringSnapshot
  screenViews: readonly string[]
  busy: boolean
  onRenameApp: (name: string) => boolean
  onResource: (operation: ResourceOperation) => Promise<string | null>
  onAssets: (assets: readonly ImageAsset[], operation?: ResourceOperation) => Promise<string | null>
  onSelect?: (node: AuthoringNode) => void
  /** The navigation section: tab setup and navigation style. */
  navigation?: ReactNode
}

/**
 * The App level: what every screen shares.
 *
 * Tokens, navigation and images are defined here once and picked everywhere else, the
 * way SwiftUI's environment flows from the app down to each view.
 */
export function AppSettings({ project, tree, snapshot, screenViews, busy, onRenameApp, onResource, onAssets, onSelect, navigation }: AppSettingsProps) {
  const [name, setName] = useState(project.manifest.name)
  const [saved, setSaved] = useState(project.manifest.name)
  const [nameError, setNameError] = useState(false)
  if (saved !== project.manifest.name) { setSaved(project.manifest.name); setName(project.manifest.name) }
  const screens = tree.lanes.length + tree.sheets.length + tree.detached.length
  return <div className={styles.panel} data-testid="app-settings">
    <div className={styles.lede}><strong>{project.manifest.name}</strong><small>{screens} {screens === 1 ? 'screen' : 'screens'} · {tree.components.length} {tree.components.length === 1 ? 'component' : 'components'} · iOS {project.manifest.deploymentTarget}</small></div>
    <section className={styles.section} aria-label="App">
      <div className={styles.row}><label htmlFor="app-name">App name</label><input id="app-name" aria-label="App name" aria-invalid={nameError} value={name} onChange={event => { setName(event.target.value); setNameError(false) }} onBlur={() => { if (name !== project.manifest.name && !onRenameApp(name)) setNameError(true) }} onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') setName(project.manifest.name) }} /></div>
      {nameError && <p className={styles.error} role="alert">Use a name without slashes or special file-name characters.</p>}
    </section>
    {navigation}
    <TokenLibrary snapshot={snapshot} screenViews={screenViews} busy={busy} imageNames={(project.assets ?? []).map(asset => asset.name)} onCommand={onResource} onSelect={onSelect} />
    <ImageResources project={project} stale={busy} onAssets={onAssets} />
    <p className={styles.note}>Symbols, fonts and colours can differ slightly from native iOS. Check the exported app on a device.</p>
  </div>
}
