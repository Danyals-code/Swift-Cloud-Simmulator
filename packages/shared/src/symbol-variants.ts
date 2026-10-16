/**
 * The symbol name `.symbolVariant(variant)` asks for on `name`, `fill.circle` on star giving
 * star.circle.fill: the variant's parts in SF Symbols' order, the shape, then slash, then
 * fill (Wave 6a). A module of its own, as `ios-fonts.ts` is. Whether the preview has a drawing for it is `symbolDefinition`'s to say.
 */
export function symbolVariantName(name: string, variant: string | undefined): string {
  if (!variant || variant === 'none') return name
  const parts = variant.split('.')
  const shape = ['circle', 'square', 'rectangle'].find(part => parts.includes(part) && !name.split('.').includes(part))
  const base = name.replace(/\.fill$/, '')
  return `${base}${shape ? `.${shape}` : ''}${parts.includes('slash') && !base.endsWith('.slash') ? '.slash' : ''}${parts.includes('fill') || base !== name ? '.fill' : ''}`
}
