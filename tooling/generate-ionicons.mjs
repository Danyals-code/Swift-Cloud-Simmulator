import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mapping = readFileSync(resolve(root, 'packages/shared/src/symbol-map.ts'), 'utf8')
const icons = [...new Set([...mapping.matchAll(/"icon": "([^"#]+)"/g)].map((m) => m[1]))].sort()
const version = JSON.parse(readFileSync(resolve(root, 'node_modules/ionicons/package.json'), 'utf8')).version
if (version !== '8.0.13') throw new Error('Review icon changes before updating the pinned version')
const assets = {}
for (const icon of icons) {
  const svg = readFileSync(resolve(root, `node_modules/ionicons/dist/svg/${icon}.svg`), 'utf8')
  if (!svg.includes('viewBox="0 0 512 512"') || /<(script|foreignObject|image|use)\b|on\w+=|href=/i.test(svg)) {
    throw new Error(`Unexpected SVG content: ${icon}`)
  }
  assets[icon] = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/stroke-width="([\d.]+)(?:px)?"/g, (_, width) => `stroke-width="${width}" style="stroke-width:calc(${width}px * var(--symbol-weight, 1))"`)
}
const sprite = '<svg xmlns="http://www.w3.org/2000/svg"><defs>' +
  Object.entries(assets).map(([icon, body]) => `<g id="${icon}">${body}</g>`).join('') + '</defs></svg>\n'
writeFileSync(resolve(root, 'apps/web/public/ionicons-8.0.13.svg'), sprite)
console.log(`Bundled ${icons.length} Ionicons SVG assets`)
