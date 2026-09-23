import type { RenderTree } from '@studio/shared'

/** What the phone shows: a tree, whether it is the last one that ran and so dimmed, and the notice over it. */
export interface PhoneView {
  readonly tree: RenderTree | null
  readonly dimmed: boolean
  readonly notice?: NonNullable<RenderTree['notice']>
}

/**
 * The tree to draw on the phone, given the latest and the last one that ran.
 *
 * While the code has errors or stopped running, the latest tree only carries a
 * notice. The last screen that ran is kept instead, dimmed, with the notice over it
 * (requirement FR-6.3): a half-typed line shouldn't swap the design for a message.
 * With nothing run yet, the notice is all there is.
 */
export function phoneView(latest: RenderTree | null, lastRan: RenderTree | null): PhoneView {
  if (latest?.notice && lastRan) return { tree: lastRan, dimmed: true, notice: latest.notice }
  return { tree: latest, dimmed: false }
}
