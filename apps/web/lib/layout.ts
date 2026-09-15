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
 * Persisted to `localStorage` rather than IndexedDB, because it is four numbers
 * and reading them has to be synchronous - an async read would paint the default
 * layout first and then jump.
 */

export type PaneKey = 'navigator' | 'debug' | 'preview'

export const PANE_LIMITS = {
  navigator: { min: 180, max: 420, initial: 232 },
  preview: { min: 300, max: 720, initial: 420 },
  debug: { min: 90, max: 520, initial: 196 },
} as const

export interface LayoutState {
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

export const useLayout = create<LayoutState>()(
  persist(
    (set, get) => ({
      navigatorWidth: PANE_LIMITS.navigator.initial,
      previewWidth: PANE_LIMITS.preview.initial,
      debugHeight: PANE_LIMITS.debug.initial,
      shown: { navigator: true, debug: true, preview: true },

      setSize(pane, size) {
        const value = clamp(pane, size)
        if (pane === 'navigator') set({ navigatorWidth: value })
        else if (pane === 'preview') set({ previewWidth: value })
        else set({ debugHeight: value })
      },

      togglePane(pane) {
        set({ shown: { ...get().shown, [pane]: !get().shown[pane] } })
      },

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
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<LayoutState>
        return {
          ...current,
          ...saved,
          navigatorWidth: clamp('navigator', saved.navigatorWidth ?? current.navigatorWidth),
          previewWidth: clamp('preview', saved.previewWidth ?? current.previewWidth),
          debugHeight: clamp('debug', saved.debugHeight ?? current.debugHeight),
          shown: { ...current.shown, ...(saved.shown ?? {}) },
        }
      },
    },
  ),
)
