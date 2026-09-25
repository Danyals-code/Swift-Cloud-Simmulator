import type { AuthoringModifier } from '@studio/shared'

const CLIPS = ['clipShape', 'cornerRadius', 'clipped']

export function modifierGuidance(modifiers: readonly AuthoringModifier[], index: number): { message: string; moveAfter?: number } | undefined {
  const current = modifiers[index]
  if (!current || current.enabled === false) return undefined
  if (current.name === 'clipShape' || current.name === 'cornerRadius') {
    const background = modifiers.reduce((last, modifier, at) => modifier.name === 'background' && modifier.enabled !== false ? at : last, -1)
    if (background > index) return { message: 'The background below this modifier stays square. Move rounding after the background to round the whole surface.', moveAfter: background }
    if (modifiers.some((modifier, at) => at !== index && modifier.enabled !== false && ['clipShape', 'cornerRadius'].includes(modifier.name))) return { message: 'Another corner modifier also clips this view. Remove the extra one if this radius appears to stop changing.' }
  }
  if (current.name === 'border') {
    // A clip after a border cuts what is drawn outside the edge; one before it leaves it whole (D8).
    const position = current.controls.find(control => control.id.endsWith(':position'))?.value
    const clip = modifiers.reduce((last, modifier, at) => at > index && CLIPS.includes(modifier.name) && modifier.enabled !== false ? at : last, -1)
    if (clip > index && position === 'center') return { message: 'The clip below cuts off the outer half of this border. Move the border after the clip to draw it whole.', moveAfter: clip }
    if (clip > index && position === 'outside') return { message: 'The clip below hides this border, which is outside the edge. Move the border after the clip to show it.', moveAfter: clip }
  }
  if (current.name === 'background' && modifiers.slice(0, index).some(modifier => modifier.name === 'background' && modifier.enabled !== false)) return { message: 'An earlier background is drawn on top of this one and may cover its color. Edit that background or switch it off.' }
  return undefined
}
