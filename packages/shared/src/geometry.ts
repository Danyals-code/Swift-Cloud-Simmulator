import type { Rect } from './render-tree'
import type { SourceSpan } from './source'

/**
 * Where the selected view is drawn, box by box, for the handles the canvas draws on it
 * (Wave 2b): its outline to resize, its padding to drag, the gaps between a stack's
 * views, and the Overlap it can be moved or pinned inside.
 *
 * Rects are in the render tree's points, the same space as `RenderNode.frame`. The
 * canvas places a handle by finding the anchor node in the DOM and offsetting from it by
 * the difference to `anchorFrame`, scaled by the zoom, so the worker never needs to know
 * how the canvas is zoomed or scrolled.
 */

/** One modifier's box around the view: what a padding, frame or offset at that place in the chain makes. */
export interface ModifierBox {
  /**
   * The modifier's position in the view's chain, as the layer reads it: the view's modifiers
   * that are switched on, in order. Its id says which layout value a box is, a padding's or a
   * margin's, by which value's `from` holds it.
   */
  readonly index: number
  readonly kind: 'padding' | 'frame' | 'offset' | 'other'
  /** For an offset, where it moves the view to; for the others, the box it makes around what it holds. */
  readonly rect: Rect
  /**
   * In a Button's label rather than the Button's own chain: where a Button's padding and
   * size are written, so `index` counts in the label's chain.
   */
  readonly label?: true
  /**
   * Drawn by a draft and not written yet: `index` is the first call it replaces, or the call
   * it goes before (the chain's length for its end), in the chain the layer reads now.
   */
  readonly draft?: true
}

/** One drawn copy of the selected view. A row design repeated in a list has several. */
export interface ViewInstance {
  /** The render node the rects are measured against: the view's outermost drawn element. */
  readonly anchor: string
  readonly anchorFrame: Rect
  /** The view itself, before any of its modifiers. */
  readonly content: Rect
  /** Each padding, frame and offset in the chain, inside out. */
  readonly boxes: readonly ModifierBox[]
  /** For a stack: each of its views' outermost boxes, in order and Spacers included, for the spacing handles. */
  readonly children?: readonly Rect[]
  /** What lays the view out, and its own box: an Overlap's is what the view moves or is pinned in. */
  readonly parent?: { readonly kind: 'column' | 'row' | 'overlap' | 'other'; readonly rect: Rect }
  /** A Button's label, before its own modifiers: the view its padding and size are written on. */
  readonly label?: Rect
  /**
   * The page this copy is drawn on, by `PagePreview.id`, when the result has pages (the
   * canvas's gallery); absent when it is drawn on the one phone, `CompileResult.renderTree`.
   * The anchor's id is found in that page's tree, as page trees can share ids.
   */
  readonly page?: string
}

export interface ViewGeometry {
  readonly view: SourceSpan
  readonly instances: readonly ViewInstance[]
}

/** Each side's inset, in points. */
export interface DraftInsets {
  readonly top: number
  readonly leading: number
  readonly bottom: number
  readonly trailing: number
}

/**
 * What a drag shows before it is written: the selected view laid out again as if its
 * size, padding, margin, offset or spacing were these values. Nothing is parsed, checked
 * or planned for a draft, so it can follow the pointer frame by frame; letting go writes
 * the same values as one `layer-set` edit.
 */
export interface LayerDraft {
  readonly width?: number | 'hug' | 'fill'
  readonly height?: number | 'hug' | 'fill'
  readonly padding?: DraftInsets
  readonly margin?: DraftInsets
  readonly offset?: { readonly x: number; readonly y: number }
  /** A stack's spacing between its views. */
  readonly spacing?: number
}
