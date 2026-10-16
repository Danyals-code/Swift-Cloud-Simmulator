import { ANIMATION_STYLE_WORDS, type ReadAnimation } from '@studio/shared'

/**
 * A tap action's statement, as When tapped reads it: its closure's body, and with `animated`
 * (Wave 5a) the body of the `withAnimation` it is all wrapped in, so "Now:" still says what it does.
 */
export function actionStatement(currentAction: string | undefined, animated: boolean): string {
  const body = currentAction?.replace(/^[\s{]*|[\s}]*$/g, '').trim() ?? ''
  return animated ? body.replace(/^withAnimation\b[^{]*\{\s*/, '').trim() : body
}

/** An action's animation in words (Wave 5a): Apple's name, its duration in seconds, or a curve Design doesn't name as the code writes it. */
export function animationWords(animation: ReadAnimation): string {
  if (!animation.style) return animation.written
  const words = ANIMATION_STYLE_WORDS[animation.style]
  return animation.duration === undefined ? words : `${words}, ${animation.duration} s`
}
