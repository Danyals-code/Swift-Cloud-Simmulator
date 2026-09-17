/** Short taps and stationary holds must be mutually exclusive. Moving cancels
 * the hold so a scroll does not accidentally open a context menu. */
export function beginContextPress(
  down: { clientX: number; clientY: number; pointerId: number },
  tap: () => void,
  hold: () => void,
  target: EventTarget = window,
): () => void {
  let active = true
  const cancel = () => {
    active = false
    clearTimeout(timer)
    target.removeEventListener('pointerup', up)
    target.removeEventListener('pointercancel', pointerCancel)
    target.removeEventListener('pointermove', move)
  }
  const up = (event: Event) => {
    if ((event as PointerEvent).pointerId !== down.pointerId || !active) return
    cancel()
    tap()
  }
  const pointerCancel = (event: Event) => {
    if ((event as PointerEvent).pointerId === down.pointerId) cancel()
  }
  const move = (event: Event) => {
    const pointer = event as PointerEvent
    if (pointer.pointerId === down.pointerId && Math.hypot(pointer.clientX - down.clientX, pointer.clientY - down.clientY) > 8) cancel()
  }
  const timer = setTimeout(() => { if (active) { cancel(); hold() } }, 500)
  target.addEventListener('pointerup', up)
  target.addEventListener('pointercancel', pointerCancel)
  target.addEventListener('pointermove', move)
  return cancel
}
