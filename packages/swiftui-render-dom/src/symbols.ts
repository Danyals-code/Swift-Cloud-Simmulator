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
  "arrowdownleft": "<path d=\"M416 96 96 416M96 160V416H352\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "digit1": "<path d=\"M200 144 272 96V416M200 416H344\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "digit2": "<path d=\"M168 176a88 88 0 0 1 176 0c0 64-72 112-176 240h176\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "suitcase": "<path d=\"M48 208a64 64 0 0 1 64-64h288a64 64 0 0 1 64 64v160a64 64 0 0 1-64 64H112a64 64 0 0 1-64-64ZM192 144v-40a24 24 0 0 1 24-24h80a24 24 0 0 1 24 24v40M144 144v288M368 144v288\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "chartbar": "<path d=\"M32 232h59a28 28 0 0 1 28 28v151a28 28 0 0 1-28 28h-59a28 28 0 0 1-28-28v-151a28 28 0 0 1 28-28ZM228 145h59a28 28 0 0 1 28 28v238a28 28 0 0 1-28 28h-59a28 28 0 0 1-28-28v-238a28 28 0 0 1 28-28ZM424 73h59a28 28 0 0 1 28 28v310a28 28 0 0 1-28 28h-59a28 28 0 0 1-28-28v-310a28 28 0 0 1 28-28Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "chartbarfill": "<path d=\"M24 216h75a36 36 0 0 1 36 36v167a36 36 0 0 1-36 36h-75a36 36 0 0 1-36-36v-167a36 36 0 0 1 36-36ZM220 129h75a36 36 0 0 1 36 36v254a36 36 0 0 1-36 36h-75a36 36 0 0 1-36-36v-254a36 36 0 0 1 36-36ZM416 57h75a36 36 0 0 1 36 36v326a36 36 0 0 1-36 36h-75a36 36 0 0 1-36-36v-326a36 36 0 0 1 36-36Z\" fill=\"currentColor\"/>",
  "bookclosed": "<path d=\"M416 368V96a48 48 0 0 0-48-48H160a48 48 0 0 0-48 48v304M416 368H160a48 48 0 0 0 0 96h256M416 368v48M176 48v320\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "waveform": "<path d=\"M64 224v64M128 176v160M192 96v320M256 160v192M320 128v256M384 192v128M448 240v32\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "arrowuturnbackward": "<path d=\"M176 144 80 240l96 96M80 240h256a96 96 0 0 1 0 192h-64\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "chartlineuptrendxyaxis": "<path d=\"M64 64v384h384M112 336l96-96 64 64 128-128\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M448 128 352 144l80 80Z\" fill=\"currentColor\" stroke=\"currentColor\" stroke-width=\"24\" stroke-linejoin=\"round\"/>",
  "thermometer": "<path d=\"M176 304V96a64 64 0 0 1 128 0v208a96 96 0 1 1-128 0Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M240 176v176\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"240\" cy=\"376\" r=\"48\" fill=\"currentColor\"/><path d=\"M368 112h48M368 176h48M368 240h48\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "flamefill": "<path fill-rule=\"evenodd\" d=\"M256 504c-96 0-176-64-176-164 0-60 16-100 30-126 6-34 10-54 16-70 20 16 32 32 36 40 8-44-12-104-29-154 97 0 197 40 267 110 40 50 40 120 32 160-12 120-92 204-176 204Zm0-52c-42 0-66-28-64-60 2-40 30-62 44-96 4-8 8-26 14-46 12 30 40 50 56 90 14 40 6 112-50 112Z\" fill=\"currentColor\"/>",
  "cupandsaucerfill": "<path fill-rule=\"evenodd\" d=\"M-12 383a272 76 0 1 0 544 0a272 76 0 1 0-544 0ZM61 190c0 110 89 185 199 185s200-75 200-185Z\" fill=\"currentColor\"/><path fill-rule=\"evenodd\" d=\"M75 111c0-33 83-60 185-60s185 27 185 60v79c0 100-86 171-186 171S75 290 75 190Zm40 6c0 22 65 40 145 40s145-18 145-40-65-40-145-40-145 18-145 40Z\" fill=\"currentColor\"/><path d=\"M446 160h26a36 36 0 0 1 0 72h-26\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"26\" stroke-linecap=\"round\"/>",
  "mugfill": "<path fill-rule=\"evenodd\" d=\"M54 79c0-22 74-40 165-40s164 18 164 40v294a100 100 0 0 1-100 100H154A100 100 0 0 1 54 373Zm38 3c0 12 57 22 127 22s126-10 126-22-56-22-126-22-127 10-127 22Z\" fill=\"currentColor\"/><path d=\"M383 150h29a36 36 0 0 1 36 36v124a36 36 0 0 1-36 36h-29\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"26\" stroke-linecap=\"round\"/>",
  "leaffill": "<path fill-rule=\"evenodd\" d=\"M36 61c74 49 164 19 264 27 100 8 150 82 146 141-6 71-86 143-186 143C140 372 40 300 32 160c-2-50 0-80 4-99ZM157 185c73 30 163 30 243 85 5 10-5 20-15 15-75-40-155-45-235-80-10-5-5-20 7-20Z\" fill=\"currentColor\"/><path d=\"M405 292c30 40 45 90 51 148\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "photo": "<rect x=\"48\" y=\"96\" width=\"416\" height=\"320\" rx=\"48\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"176\" cy=\"192\" r=\"40\" fill=\"currentColor\"/><path d=\"M64 400l112-112 64 64 112-112 96 96v64a32 32 0 0 1-32 32H96a32 32 0 0 1-32-32Z\" fill=\"currentColor\"/>",
  "chartpie": "<circle cx=\"256\" cy=\"256\" r=\"195\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M256 61v195l172-91.5M256 256l138 138\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "squaregrid2x2": "<path d=\"M96 64h96a32 32 0 0 1 32 32v96a32 32 0 0 1-32 32H96a32 32 0 0 1-32-32V96a32 32 0 0 1 32-32ZM320 64h96a32 32 0 0 1 32 32v96a32 32 0 0 1-32 32h-96a32 32 0 0 1-32-32V96a32 32 0 0 1 32-32ZM96 288h96a32 32 0 0 1 32 32v96a32 32 0 0 1-32 32H96a32 32 0 0 1-32-32v-96a32 32 0 0 1 32-32ZM320 288h96a32 32 0 0 1 32 32v96a32 32 0 0 1-32 32h-96a32 32 0 0 1-32-32v-96a32 32 0 0 1 32-32Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "squareandpencil": "<path d=\"M365 128H164a76 76 0 0 0-76 76v155a76 76 0 0 0 76 76h177a76 76 0 0 0 76-76V208\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"32\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M211 343l20.7-50 209-214a20 20 0 0 1 28.6 28L260.3 321Z\" fill=\"currentColor\"/>"
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
