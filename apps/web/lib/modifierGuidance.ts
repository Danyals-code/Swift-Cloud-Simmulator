import type { AuthoringModifier } from '@studio/shared'

export function modifierGuidance(modifiers: readonly AuthoringModifier[], index: number): { message: string; moveAfter?: number } | undefined {
  const current = modifiers[index]
  if (!current || current.enabled === false) return undefined
  if (current.name === 'clipShape' || current.name === 'cornerRadius') {
    const background = modifiers.reduce((last, modifier, at) => modifier.name === 'background' && modifier.enabled !== false ? at : last, -1)
    if (background > index) return { message: 'The background below this modifier stays square. Move rounding after the background to round the whole surface.', moveAfter: background }
    if (modifiers.some((modifier, at) => at !== index && modifier.enabled !== false && ['clipShape', 'cornerRadius'].includes(modifier.name))) return { message: 'Another corner modifier also clips this view. Remove the extra one if this radius appears to stop changing.' }
  }
  if (current.name === 'background' && modifiers.slice(0, index).some(modifier => modifier.name === 'background' && modifier.enabled !== false)) return { message: 'An earlier background is drawn on top of this one and may cover its color. Edit that background or switch it off.' }
  return undefined
}
