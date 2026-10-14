import { useState } from 'react'
import type { AuthoringNode, LayerChange, LayerProperties, SharedStyle, Size } from '@studio/shared'
import type { FeatureChange } from '../AuthoringFeatures'

/** What every section of the layer panel is given. */
export interface SectionProps {
  readonly node: AuthoringNode
  readonly layer: LayerProperties
  /** Writes the changes as one edit and one undo step; resolves to the reason it was refused, or null. */
  readonly set: (changes: readonly LayerChange[]) => Promise<string | null>
  /** An edit is on its way, or the preview is updating: controls wait. */
  readonly busy: boolean
  /** The size the preview draws the view at, in points, when it is drawn: what Fixed starts from. */
  readonly measure?: Size
  /** The project's tokens, as the token fields get them; each section offers the kinds it takes. */
  readonly tokens: readonly SharedStyle[]
  /** Another kind of edit, for a value a layer change cannot make, such as a native Card's own fill. */
  readonly command: FeatureChange
  /**
   * Gives the Overlap the view is in its drawn size, as Fixed, when it hugs and so can't take
   * a pin (plan recommendation 7); resolves to the reason it was refused, or null.
   */
  readonly sizeOverlap?: () => Promise<string | null>
}

/** One section's change, without the section it goes to. */
export type SectionChange<S extends LayerChange['section']> = Omit<Extract<LayerChange, { section: S }>, 'section'>

/**
 * A section's edits, and why the last one was refused, which the section shows until the
 * next. `change` turns what a field gives into the section's `layer-set` change.
 *
 * Each edit resolves to false when it was refused, or not made because another was on its
 * way, so a field shows the value it had.
 */
export function useLayerWrite<T>(change: (value: T) => LayerChange, { set, busy }: Pick<SectionProps, 'set' | 'busy'>) {
  const [error, setError] = useState<string | null>(null)
  /** Makes an edit that resolves to the reason it was refused, or null: a layer change, or another kind. */
  const attempt = async (edit: () => Promise<string | null> | string | null) => {
    if (busy) return false
    const problem = await edit()
    setError(problem)
    return !problem
  }
  return { error, attempt, write: (value: T) => attempt(() => set([change(value)])) }
}
