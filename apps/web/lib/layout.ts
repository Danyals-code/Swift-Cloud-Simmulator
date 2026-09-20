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
/** Every pane with a stored size. `settings` is Design's right-hand rail. */
export type SizeKey = PaneKey | 'settings'
export type WorkspaceMode = 'design' | 'develop'
export type NavigatorTab = 'project' | 'layers' | 'issues'
/**
 * How Design draws its one tree: App > Screens > Views in a single outline, or the
 * same tree as three stacked panels. Both read the same model, so they cannot
 * disagree - this only decides how much of it is on screen at once.
 */
export type NavigatorLayout = 'merged' | 'split'
/** The right-hand rail's two halves: what you are making, and how you are looking at it. */
export type InspectorTab = 'settings' | 'preview'
export type WorkspaceTheme = 'light' | 'dark'

export const PANE_LIMITS = {
  navigator: { min: 240, max: 420, initial: 260 },
  preview: { min: 300, max: 720, initial: 420 },
  debug: { min: 90, max: 520, initial: 196 },
  settings: { min: 200, max: 480, initial: 236 },
} as const

export interface LayoutState {
  mode: WorkspaceMode
  navigatorTab: NavigatorTab
  setNavigatorTab: (tab: NavigatorTab) => void
  navigatorLayout: NavigatorLayout
  setNavigatorLayout: (layout: NavigatorLayout) => void
  inspectorTab: InspectorTab
  setInspectorTab: (tab: InspectorTab) => void
  setMode: (mode: WorkspaceMode) => void
  theme: WorkspaceTheme
  setTheme: (theme: WorkspaceTheme) => void
  navigatorWidth: number
  previewWidth: number
  debugHeight: number
  settingsWidth: number
  shown: Record<PaneKey, boolean>

  setSize: (pane: SizeKey, size: number) => void
  togglePane: (pane: PaneKey) => void
  setPane: (pane: PaneKey, shown: boolean) => void
}

function clamp(pane: SizeKey, size: number): number {
  const { min, max } = PANE_LIMITS[pane]
  return Math.round(Math.max(min, Math.min(max, size)))
}

export function restoreLayout(persisted: unknown, current: LayoutState): LayoutState {
  const saved = (persisted ?? {}) as Partial<Omit<LayoutState, 'mode'>> & { mode?: string }
  /**
   * Every load opens in Design, whatever was open last.
   *
   * Sizes and the theme are how you like to look at the work and are restored; the
   * workspace is where you are *in* it, and a reload is a fresh look at the app
   * rather than a resumed editing session. Getting Code back is one click, and
   * landing in it because of something done twenty minutes ago is the surprise.
   */
  return {
    ...current,
    ...saved,
    mode: 'design',
    navigatorTab: 'layers',
    navigatorLayout: saved.navigatorLayout === 'split' ? 'split' : 'merged',
    inspectorTab: 'settings',
    theme: saved.theme === 'dark' ? 'dark' : 'light',
    navigatorWidth: clamp('navigator', saved.navigatorWidth ?? current.navigatorWidth),
    previewWidth: clamp('preview', saved.previewWidth ?? current.previewWidth),
    debugHeight: clamp('debug', saved.debugHeight ?? current.debugHeight),
    settingsWidth: clamp('settings', saved.settingsWidth ?? current.settingsWidth),
    shown: { ...current.shown, ...(saved.shown ?? {}), preview: saved.shown?.preview !== false },
  }
}

export const useLayout = create<LayoutState>()(
  persist(
    (set, get) => ({
      mode: 'design',
      navigatorTab: 'layers',
      setNavigatorTab(navigatorTab) { set({ navigatorTab }) },
      navigatorLayout: 'merged',
      setNavigatorLayout(navigatorLayout) { set({ navigatorLayout }) },
      inspectorTab: 'settings',
      setInspectorTab(inspectorTab) { set({ inspectorTab }) },
      theme: 'light',
      navigatorWidth: PANE_LIMITS.navigator.initial,
      previewWidth: PANE_LIMITS.preview.initial,
      debugHeight: PANE_LIMITS.debug.initial,
      settingsWidth: PANE_LIMITS.settings.initial,
      shown: { navigator: true, debug: false, preview: true },

      setMode(mode) {
        set({ mode, navigatorTab: mode === 'design' ? 'layers' : 'project', shown: { ...get().shown, navigator: true, preview: true } })
      },

      setTheme(theme) { set({ theme }) },

      setSize(pane, size) {
        const value = clamp(pane, size)
        if (pane === 'navigator') set({ navigatorWidth: value })
        else if (pane === 'preview') set({ previewWidth: value })
        else if (pane === 'settings') set({ settingsWidth: value })
        else set({ debugHeight: value })
      },

      togglePane(pane) {
        get().setPane(pane, !get().shown[pane])
      },

      /**
       * Showing or hiding a pane, and nothing else.
       *
       * This used to switch the workspace to Code, because the debug area and the
       * preview only existed there. Both are drawn in Design now - the debug area
       * under the canvas, the preview's settings in the right-hand rail - so a
       * toggle that also moved you to Code was answering a question nobody asked:
       * pressing "show problems" means show them, not leave what I was looking at.
       */
      setPane(pane, shown) {
        set({ shown: { ...get().shown, [pane]: shown } })
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
