/** Where the canvas looks: the world's offset in the viewport, and its zoom. */
export interface CanvasView { readonly x: number; readonly y: number; readonly scale: number }

/** A box in the world's own coordinates, as a phone's offsets give it. */
export interface WorldBox { readonly left: number; readonly top: number; readonly width: number; readonly height: number }

/**
 * The view with `box` in the middle of the viewport, at the zoom it is at unless all of
 * the box would not show there: then zoomed out as far as that takes, and never in.
 */
export function viewCentredOn(box: WorldBox, viewport: { readonly width: number; readonly height: number }, scale: number, padding: number): CanvasView {
  const at = Math.min(scale, (viewport.width - padding * 2) / box.width, (viewport.height - padding * 2) / box.height)
  return {
    x: viewport.width / 2 - (box.left + box.width / 2) * at,
    y: viewport.height / 2 - (box.top + box.height / 2) * at,
    scale: at,
  }
}

/**
 * What the view does when the canvas changes between one phone and every screen.
 *
 * Showing all the screens, or stopping, never moves the phone being looked at: it is
 * kept where it is, at its zoom. The first screens a workspace draws are its opening
 * view, though - its first compile is still running when the workspace is fitted to one
 * bare phone - and while Fit is chosen they are fitted as a workspace opens.
 */
export function galleryChangeView(change: { readonly first: boolean; readonly zoom: string }): 'fit' | 'keep' {
  return change.first && change.zoom === 'fit' ? 'fit' : 'keep'
}
