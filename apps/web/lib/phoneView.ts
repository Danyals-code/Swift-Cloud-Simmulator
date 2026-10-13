import type { RenderTree } from '@studio/shared'

/** What the phone shows: a tree, whether it is the last one that ran and so dimmed, and the notice over it. */
export interface PhoneView {
  readonly tree: RenderTree | null
  readonly dimmed: boolean
  readonly notice?: NonNullable<RenderTree['notice']>
  /** The preview stopped: a tap on the phone starts it again. */
  readonly stopped?: true
}

/**
 * The tree to draw on the phone, given the latest and the last one that ran.
 *
 * While the code has errors or stopped running, the latest tree only carries a
 * notice. The last screen that ran is kept instead, dimmed, with the notice over it
 * (requirement FR-6.3): a half-typed line shouldn't swap the design for a message.
 * With nothing run yet, the notice is all there is.
 */
export function phoneView(latest: RenderTree | null, lastRan: RenderTree | null, stoppedBecause?: string | null): PhoneView {
  const shown = latest?.notice && lastRan ? lastRan : latest
  // The worker itself stopped, not the user's code: the screen stays, dimmed, until a
  // tap, an edit or Reset starts the preview again.
  if (stoppedBecause) return { tree: shown, dimmed: true, notice: { title: 'Preview stopped', detail: `${stoppedBecause} Tap the phone, edit the code or press Reset to start it again.` }, stopped: true }
  if (latest?.notice && lastRan) return { tree: lastRan, dimmed: true, notice: latest.notice }
  return { tree: latest, dimmed: false }
}
