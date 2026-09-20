import { colorSetContents, validateAssets, validateColors, type Project } from '@studio/project-model'
import { encodeText } from './bundle'

export function assetCatalog(project: Project, path: string): Map<string, Uint8Array> {
  validateAssets(project.assets ?? [])
  validateColors(project.colors ?? [])
  const files = new Map<string, Uint8Array>()
  files.set(`${path}/Contents.json`, encodeText(JSON.stringify({ info: { author: 'xcode', version: 1 } })))
  for (const asset of project.assets ?? []) {
    const images = []
    for (const appearance of ['light', 'dark'] as const) {
      const variant = asset[appearance]
      if (!variant) continue
      const filename = `${appearance}.${variant.mime === 'image/png' ? 'png' : 'jpg'}`
      files.set(`${path}/${asset.name}.imageset/${filename}`, variant.bytes.slice())
      images.push({ idiom: 'universal', scale: `${asset.scale}x`, filename, ...(appearance === 'dark' ? { appearances: [{ appearance: 'luminosity', value: 'dark' }] } : {}) })
    }
    files.set(`${path}/${asset.name}.imageset/Contents.json`, encodeText(JSON.stringify({ info: { author: 'xcode', version: 1 }, images }, null, 2)))
  }
  // Colour tokens: each a colour set holding its light and dark values, which the
  // token's `Color("name")` reads. The same arrangement Xcode's own templates use.
  for (const color of project.colors ?? []) files.set(`${path}/${color.name}.colorset/Contents.json`, encodeText(colorSetContents(color)))
  return files
}

/** Whether the project has anything for an asset catalog to hold. */
export function hasCatalog(project: Project): boolean {
  return !!project.assets?.length || !!project.colors?.length
}
