import { symbolDefinition } from '@studio/shared'

const PRIMITIVES: Readonly<Record<string, string>> = {
  "mountains": '<path d="M32 432 192 112 352 432ZM288 304 368 160 480 432H352M128 240l64 32 48-64" fill="none" stroke="currentColor" stroke-width="32" stroke-linejoin="round"/>',
  "tree": '<path d="M256 32 112 208h72L80 352h352L328 208h72ZM256 352V480" fill="none" stroke="currentColor" stroke-width="32" stroke-linejoin="round"/>',
  "number": "<path d=\"M180 64 140 448M372 64 332 448M64 180H448M64 332H448\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "keyboard": "<path d=\"M48 128H464V384H48ZM104 200H128M184 200H208M264 200H288M344 200H376M104 268H128M184 268H208M264 268H288M344 268H376M152 336H360\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "alignleft": "<path d=\"M64 96H448M64 208H320M64 320H448M64 432H320\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "aligncenter": "<path d=\"M64 96H448M128 208H384M64 320H448M128 432H384\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "alignright": "<path d=\"M64 96H448M192 208H448M64 320H448M192 432H448\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "percent": "<path d=\"M96 416 416 96M128 64a64 64 0 1 0 0 128a64 64 0 1 0 0-128ZM384 320a64 64 0 1 0 0 128a64 64 0 1 0 0-128Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "divide": "<path d=\"M80 256H432M256 96h1M256 416h1\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "equal": "<path d=\"M80 176H432M80 336H432\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "chevrons": "<path d=\"M128 176 256 48 384 176M128 336 256 464 384 336\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "arrowupright": "<path d=\"M96 416 416 96M160 96H416V352\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "arrowdownleft": "<path d=\"M416 96 96 416M96 160V416H352\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>"
}

export interface SymbolAsset {
  readonly body: string
  readonly viewBox: string
  readonly source: 'ionicons' | 'fallback'
}

/** Only trusted, bundled SVG strings reach the painter; user input is a map key. */
export function symbolAsset(name: string, maskId = 'symbol-mask'): SymbolAsset | null {
  const definition = symbolDefinition(name)
  if (!definition) return null
  const fallback = definition.icon.startsWith('#')
  const raw = fallback ? PRIMITIVES[definition.icon.slice(1)] : `<use href="/ionicons-8.0.13.svg#${definition.icon}" />`
  if (!raw) return null
  const body = definition.mirrored ? `<g transform="translate(512 0) scale(-1 1)">${raw}</g>` : raw
  if (!definition.container) return { body, viewBox: definition.viewBox ?? '0 0 512 512', source: fallback ? 'fallback' : 'ionicons' }
  const outline = definition.container === 'circle'
    ? '<circle cx="256" cy="256" r="224"'
    : '<rect x="32" y="32" width="448" height="448" rx="64"'
  const inner = `<g transform="translate(108 108) scale(.58)">${body}</g>`
  // Knock the icon out of filled containers, so their holes reveal any background.
  const composed = definition.filled
    ? `<defs><mask id="${maskId}"><rect width="512" height="512" fill="white"/><g fill="black" color="black">${inner.replaceAll('currentColor', 'black')}</g></mask></defs>${outline} fill="currentColor" mask="url(#${maskId})"/>`
    : `${outline} fill="none" stroke="currentColor" stroke-width="32"/>${inner}`
  return { body: composed, viewBox: '0 0 512 512', source: fallback ? 'fallback' : 'ionicons' }
}

export function symbolStrokeScale(fontWeight: number): number {
  return 0.72 + (Math.max(100, Math.min(900, fontWeight)) / 400) * 0.28
}
