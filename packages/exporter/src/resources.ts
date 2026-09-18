import { validateAssets, type Project } from '@studio/project-model'
import { encodeText } from './bundle'

export function assetCatalog(project: Project, path: string): Map<string, Uint8Array> {
  validateAssets(project.assets ?? [])
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
  return files
}
