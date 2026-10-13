import { SURFACES } from '../appearance/surfaces'

/** A presentation, as far as where it sits depends on it. */
interface Presented {
  readonly kind: string
  /** 1 is `.large`, a fraction of the screen below it, and a height in points negative. */
  readonly detent: number
  readonly detents?: readonly number[]
  readonly showsDragIndicator?: boolean
}

/**
 * A sheet that opens at its large detent on a phone. iOS 27 attaches it to the screen's
 * sides and bottom, from just under the status bar, where a sheet at a smaller detent
 * floats 8 pt in from the edges (docs/parity/native/iphone18pro-misrenders, sheet-on-stack).
 */
export function attachedSheet(presented: Presented, viewportWidth: number): boolean {
  if (presented.kind !== 'sheet' && presented.kind !== 'popover') return false
  return viewportWidth < 600 && Math.min(...(presented.detents?.length ? presented.detents : [presented.detent])) === 1
}

/**
 * How far below a sheet's top edge its screen starts. An attached sheet puts its content
 * right at its edge, and its bar starts `barTop` down, 16 pt taller than a screen's bar
 * (docs/parity/native/iphone18pro-under-bars, the sheet screens). A floating sheet keeps
 * room for its grabber.
 */
export function sheetContentTop(presented: Presented, attached: boolean, hasBar: boolean): number {
  if (attached && !presented.showsDragIndicator) return hasBar ? SURFACES.sheet.barTop : 0
  return presented.showsDragIndicator !== false ? 10 : 12
}
