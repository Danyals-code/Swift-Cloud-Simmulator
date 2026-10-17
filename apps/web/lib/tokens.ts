import { TEXT_STYLE_POINTS, type AuthoringNode, type AuthoringSnapshot, type SharedStyle, type StyleKind } from '@studio/shared'
import { SYSTEM_COLOR_SWATCHES, isHexColor } from './colorValue'
import { sourceLayerAround } from './sourceLayers'

/** The order and wording of the token kinds, everywhere they are listed. */
export const TOKEN_KINDS: readonly { kind: StyleKind; title: string; singular: string; prefix?: string; example: string }[] = [
  { kind: 'color', title: 'Colors', singular: 'color', example: 'accent' },
  { kind: 'spacing', title: 'Spacing', singular: 'spacing', prefix: 'space', example: 'space16' },
  { kind: 'radius', title: 'Corner radius', singular: 'corner radius', prefix: 'radius', example: 'radiusMedium' },
  { kind: 'font', title: 'Text styles', singular: 'text style', example: 'sectionTitle' },
  { kind: 'shadow', title: 'Shadows', singular: 'shadow', example: 'low' },
]

export const TEXT_STYLES: readonly { value: string; label: string; size: number; weight: string }[] = [
  { value: 'largeTitle', label: 'Large title', size: TEXT_STYLE_POINTS.largeTitle!, weight: 'regular' },
  { value: 'title', label: 'Title', size: TEXT_STYLE_POINTS.title!, weight: 'regular' },
  { value: 'title2', label: 'Title 2', size: TEXT_STYLE_POINTS.title2!, weight: 'regular' },
  { value: 'title3', label: 'Title 3', size: TEXT_STYLE_POINTS.title3!, weight: 'regular' },
  { value: 'headline', label: 'Headline', size: TEXT_STYLE_POINTS.headline!, weight: 'semibold' },
  { value: 'body', label: 'Body', size: TEXT_STYLE_POINTS.body!, weight: 'regular' },
  { value: 'callout', label: 'Callout', size: TEXT_STYLE_POINTS.callout!, weight: 'regular' },
  { value: 'subheadline', label: 'Subheadline', size: TEXT_STYLE_POINTS.subheadline!, weight: 'regular' },
  { value: 'footnote', label: 'Footnote', size: TEXT_STYLE_POINTS.footnote!, weight: 'regular' },
  { value: 'caption', label: 'Caption', size: TEXT_STYLE_POINTS.caption!, weight: 'regular' },
  { value: 'caption2', label: 'Caption 2', size: TEXT_STYLE_POINTS.caption2!, weight: 'regular' },
]
export const FONT_WEIGHTS = ['ultraLight', 'thin', 'light', 'regular', 'medium', 'semibold', 'bold', 'heavy', 'black'] as const

/** A CSS colour for a swatch: a token's light value, a hex, or a system colour name. */
export function swatchFor(value: string | undefined, dark = false, token?: SharedStyle): string {
  const chosen = token?.form === 'token' && token.light ? (dark && token.dark ? token.dark : token.light) : value
  if (!chosen) return 'transparent'
  if (isHexColor(chosen)) return chosen
  return SYSTEM_COLOR_SWATCHES[chosen] ?? 'transparent'
}

/** How much a token edit reaches, before it is made: "Used in 84 places across 14 screens". */
export function tokenImpact(token: SharedStyle, snapshot: AuthoringSnapshot | undefined, screenViews: readonly string[]): { places: number; screens: number; components: number; nodes: AuthoringNode[] } {
  const nodes: AuthoringNode[] = []
  for (const use of token.uses) {
    const owner = sourceLayerAround(snapshot, use)
    if (owner) nodes.push(owner)
  }
  const owners = new Set(nodes.map(node => node.owner.split('.')[0]!))
  const screens = [...owners].filter(owner => screenViews.includes(owner)).length
  return { places: token.uses.length, screens, components: owners.size - screens, nodes }
}

export function impactSentence(impact: { places: number; screens: number; components: number }): string {
  if (!impact.places) return 'Not used yet.'
  const where = [impact.screens ? `${impact.screens} ${impact.screens === 1 ? 'screen' : 'screens'}` : '', impact.components ? `${impact.components} ${impact.components === 1 ? 'component' : 'components'}` : ''].filter(Boolean).join(' and ')
  return `Used in ${impact.places} ${impact.places === 1 ? 'place' : 'places'}${where ? ` across ${where}` : ''}.`
}

/** A name that follows the kind's rule, for the create form to start from. */
export function suggestedName(kind: StyleKind, existing: readonly string[], value = ''): string {
  const base = kind === 'spacing' ? `space${Math.round(Number(value) || 16)}` : kind === 'radius' ? 'radiusMedium' : kind === 'color' ? 'brandColor' : kind === 'font' ? 'sectionTitle' : 'low'
  let name = base, n = 2
  while (existing.includes(name)) name = `${base}${n++}`
  return name
}

/** The one-line rule a name breaks, before asking the planner. The planner has the final word. */
export function nameHint(kind: StyleKind, name: string): string | null {
  if (!/^[a-z][A-Za-z0-9_]*$/.test(name)) return 'Use letters and numbers, starting with a lowercase letter.'
  if (kind === 'spacing' && !name.startsWith('space')) return 'Spacing tokens start with “space”, like space16.'
  if (kind === 'radius' && !name.startsWith('radius')) return 'Corner radius tokens start with “radius”, like radiusMedium.'
  return null
}
