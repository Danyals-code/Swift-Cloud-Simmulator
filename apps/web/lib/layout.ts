'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Where the panes are, and which of them are showing.
 *
 * Separate from the project store on purpose: this is how you are looking at the
 * work, not the work. It is also the one piece of state that should survive a
 * reload without being part of what a share link carries - somebody opening your
 * link should get their own pane widths, not yours.
 *
 * Persisted to `localStorage` rather than IndexedDB, because these preferences are small
 * and reading them has to be synchronous - an async read would paint the default
 * layout first and then jump.
 */

export type PaneKey = 'navigator' | 'debug' | 'preview'
export type WorkspaceMode = 'design' | 'develop'
export type NavigatorTab = 'project' | 'layers' | 'issues'
export type WorkspaceTheme = 'light' | 'dark'

export const PANE_LIMITS = {
  navigator: { min: 240, max: 420, initial: 260 },
  preview: { min: 300, max: 720, initial: 420 },
  debug: { min: 90, max: 520, initial: 196 },
} as const

export interface LayoutState {
  mode: WorkspaceMode
  navigatorTab: NavigatorTab
  setNavigatorTab: (tab: NavigatorTab) => void
  setMode: (mode: WorkspaceMode) => void
  theme: WorkspaceTheme
  setTheme: (theme: WorkspaceTheme) => void
  navigatorWidth: number
  previewWidth: number
  debugHeight: number
  shown: Record<PaneKey, boolean>

  setSize: (pane: PaneKey, size: number) => void
  togglePane: (pane: PaneKey) => void
  setPane: (pane: PaneKey, shown: boolean) => void
}

function clamp(pane: PaneKey, size: number): number {
  const { min, max } = PANE_LIMITS[pane]
  return Math.round(Math.max(min, Math.min(max, size)))
}

export function restoreLayout(persisted: unknown, current: LayoutState): LayoutState {
  const saved = (persisted ?? {}) as Partial<Omit<LayoutState, 'mode'>> & { mode?: string }
  // Older Canvas/Split/Code preferences map onto the two workspaces.
  const mode = ['develop', 'split', 'code'].includes(saved.mode ?? '') ? 'develop' : 'design'
  return {
    ...current,
    ...saved,
    mode,
    navigatorTab: mode === 'design' ? 'layers' : 'project',
    theme: saved.theme === 'dark' ? 'dark' : 'light',
    navigatorWidth: clamp('navigator', saved.navigatorWidth ?? current.navigatorWidth),
    previewWidth: clamp('preview', saved.previewWidth ?? current.previewWidth),
    debugHeight: clamp('debug', saved.debugHeight ?? current.debugHeight),
    shown: { ...current.shown, ...(saved.shown ?? {}), preview: saved.mode === 'develop' ? saved.shown?.preview !== false : true },
  }
}

export const useLayout = create<LayoutState>()(
  persist(
    (set, get) => ({
      mode: 'design',
      navigatorTab: 'layers',
      setNavigatorTab(navigatorTab) { set({ navigatorTab }) },
      theme: 'light',
      navigatorWidth: PANE_LIMITS.navigator.initial,
      previewWidth: PANE_LIMITS.preview.initial,
      debugHeight: PANE_LIMITS.debug.initial,
      shown: { navigator: true, debug: false, preview: true },

      setMode(mode) {
        set({ mode, navigatorTab: mode === 'design' ? 'layers' : 'project', shown: { ...get().shown, navigator: true, preview: true } })
      },

      setTheme(theme) { set({ theme }) },

      setSize(pane, size) {
        const value = clamp(pane, size)
        if (pane === 'navigator') set({ navigatorWidth: value })
        else if (pane === 'preview') set({ previewWidth: value })
        else set({ debugHeight: value })
      },

      togglePane(pane) {
        get().setPane(pane, !get().shown[pane])
      },

      setPane(pane, shown) {
        const mode = pane === 'preview' || (pane === 'debug' && shown) ? 'develop' : get().mode
        set({ mode, navigatorTab: mode === get().mode ? get().navigatorTab : 'project', shown: { ...get().shown, [pane]: shown } })
      },
    }),
    {
      name: 'studio.layout',
      version: 1,
      // Sizes are clamped on the way back in as well as on the way out: the limits
      // can change between releases, and a stored 900px navigator from an older
      // build would otherwise eat the window.
      merge: restoreLayout,
    },
  ),
)
