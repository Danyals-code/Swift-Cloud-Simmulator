import { symbolDefinition, symbolEnclosure } from '@studio/shared'

/** How `symbolAsset` paints a symbol beyond its outline (Wave 6b). */
export interface SymbolAssetPaint {
  /** Paint containers, badges and drawn layers apart, for hierarchical, palette and multicolor. */
  readonly layered?: boolean
  /** `Image(systemName:variableValue:)`, 0 to 1. */
  readonly variableValue?: number
}

/** The sprite the Ionicons look-alikes are drawn from, `tooling/generate-ionicons.mjs`'s output. */
const SPRITE = '/ionicons-8.0.13.svg'
/** A stroke `width` wide in the 512 grid, round at its ends and corners. */
const stroke = (width = 32) => `fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`
const LINE = stroke()
/** A stroked path in the 512 grid, as most look-alikes are drawn. */
const line = (d: string, extra = '', width = 32) => `<path d="${d}" ${stroke(width)}${extra}/>`
const solid = (d: string, extra = '') => `<path d="${d}" fill="currentColor"${extra}/>`
/** A filled shape whose edge is drawn as round as its outline's. */
const filled = (d: string) => solid(d, ' stroke="currentColor" stroke-width="32" stroke-linejoin="round"')
/** Paints `body` in layer 2 or 3's colour, set on the `<svg>` by a rendering mode, or the foreground. */
const layer = (level: 2 | 3, body: string) => `<g style="color:var(--symbol-${level},currentColor)">${body}</g>`

/**
 * The opacity attribute `variableValue` gives part `index` of `count`: dimmed to 0.3 when the
 * value isn't above its share, rounded to hundredths. wifi lights its dot above 0, its first
 * arc above 0.33 and its last above 0.67, as iOS 27 draws them
 * (docs/parity/native/iphone18pro-symbols, variable).
 */
function variableOpacity(value: number | undefined, index: number, count: number): string {
  return value === undefined || value > Math.round(index / count * 100) / 100 ? '' : ' opacity=".3"'
}

/** A speaker with `waves` waves, which `variableValue` lights in turn, and which hierarchical paints as layer 2. */
function speaker(waves: number, filledBody: boolean) {
  return (paint: SymbolAssetPaint) => {
    const body = 'M48 192h88l104-96v320L136 320H48Z'
    const arcs = ['M291 195A80 80 0 0 1 291 317', 'M338 140A152 152 0 0 1 338 372', 'M384 84A224 224 0 0 1 384 428'].slice(0, waves)
      .map((d, index) => line(d, variableOpacity(paint.variableValue, index, waves))).join('')
    return (filledBody ? filled(body) : line(body)) + layer(2, arcs)
  }
}

/** person.crop.circle's head and shoulders, the shoulders cut by the circle. */
const PERSON = 'M256 112a84 84 0 1 0 0 168a84 84 0 1 0 0-168ZM110 425C140 340 196 304 256 304S372 340 402 425A224 224 0 0 1 110 425Z'

/**
 * Drawings whose parts follow the paint: layers, or bars and waves a variable value dims.
 * wifi's arcs are 0.14 of its width thick and its dot 0.21 across, as iOS 27 draws them
 * (variable.png: 12.5 and 19 of 91 px).
 */
const PAINTED: Readonly<Record<string, (paint: SymbolAssetPaint) => string>> = {
  "wifi": ({ variableValue: v }) => `<circle cx="256" cy="400" r="48" fill="currentColor"${variableOpacity(v, 0, 3)}/>` +
    line('M139 283A165 165 0 0 1 373 283', variableOpacity(v, 1, 3), 64) + line('M51 195A290 290 0 0 1 461 195', variableOpacity(v, 2, 3), 64),
  "cellularbars": ({ variableValue: v }) => [328, 248, 168, 88].map((y, index) => `<rect x="${36 + index * 120}" y="${y}" width="80" height="${448 - y}" rx="24" fill="currentColor"${variableOpacity(v, index, 4)}/>`).join(''),
  "speakerwave1": speaker(1, false), "speakerwave1fill": speaker(1, true),
  "speakerwave2": speaker(2, false), "speakerwave2fill": speaker(2, true),
  "speakerwave3": speaker(3, false), "speakerwave3fill": speaker(3, true),
  // A disc with the person knocked out, or in two layers, the disc under the person.
  "personcropfill": ({ layered }) => layered
    ? layer(3, '<circle cx="256" cy="256" r="224" fill="currentColor"/>') + solid(PERSON)
    : solid(`M256 32a224 224 0 1 1 0 448a224 224 0 1 1 0-448Z${PERSON}`, ' fill-rule="evenodd"'),
}

/** sun.horizon and sunrise and sunset, which draw an arrow where sun.horizon draws its top ray, filled or not. */
const horizon = (top: string, filledSun: boolean) => (filledSun ? solid('M144 416a112 112 0 0 1 224 0Z') : '') +
  line(`M32 416h448M144 416a112 112 0 0 1 224 0M96 272l40 32M416 272l-40 32M40 352h48M424 352h48${top}`)
/** server.rack's three servers, each with its light and slot. */
const RACK = [48, 200, 352].map(y => line(`M80 ${y}h352a32 32 0 0 1 32 32v48a32 32 0 0 1-32 32H80a32 32 0 0 1-32-32v-48a32 32 0 0 1 32-32ZM112 ${y + 56}h96`) + `<circle cx="392" cy="${y + 56}" r="20" fill="currentColor"/>`).join('')
/** moon.stars: the moon Ionicon, lower and smaller, with two sparkles above it. */
const moonStars = (moon: string) => `<g transform="translate(0 72) scale(.86)"><use href="${SPRITE}#${moon}"/></g>` +
  solid('M384 48q10 46 56 56-46 10-56 56-10-46-56-56 46-10 56-56ZM456 200q6 26 32 32-26 6-32 32-6-26-32-32 26-6 32-32Z')
const ROOF = 'M256 48 48 160h416Z'
const DIAMOND = 'M256 32 480 256 256 480 32 256Z'
const GRID_1X2 = 'M96 64h320a48 48 0 0 1 48 48v80a48 48 0 0 1-48 48H96a48 48 0 0 1-48-48v-80a48 48 0 0 1 48-48ZM96 272h320a48 48 0 0 1 48 48v80a48 48 0 0 1-48 48H96a48 48 0 0 1-48-48v-80a48 48 0 0 1 48-48Z'
const PILL = '<g transform="rotate(-45 256 256)"><rect x="48" y="160" width="416" height="192" rx="96" '
/** One quotation mark, and the same shifted right. */
const QUOTE = 'M112 240a64 64 0 1 1 128 0c0 72-40 128-104 152 20-32 28-60 28-88a64 64 0 0 1-52-64Z'

const PRIMITIVES: Readonly<Record<string, string>> = {
  "personcrop": '<circle cx="256" cy="256" r="224" ' + LINE + '/>' + line('M256 128a72 72 0 1 0 0 144a72 72 0 1 0 0-144ZM124 410C156 346 202 320 256 320S356 346 388 410'),
  "hearttext": solid('M160 104c-32-40-96-24-96 32 0 48 96 104 96 104s96-56 96-104c0-56-64-72-96-32Z') + line('M96 336h320M96 432h224'),
  // As thick as iOS 27 draws chevron.compact.down (names-2.png: 8 of 73 px, measured upright).
  "compact": line('M48 208 256 304 464 208', '', 46),
  "chevron2": line('M96 96l160 160-160 160M256 96l160 160-160 160'),
  "toline": line('M256 64v320M128 256l128 128 128-128M96 448h320'),
  "shareonsquare": line('M192 192h-24a48 48 0 0 0-48 48v144a48 48 0 0 0 48 48h176a48 48 0 0 0 48-48V240a48 48 0 0 0-48-48h-24M256 48v240M176 112l80-80 80 80M448 288v144a48 48 0 0 1-48 48H224'),
  "drive": line('M96 176h320a64 64 0 0 1 64 64v32a64 64 0 0 1-64 64H96a64 64 0 0 1-64-64v-32a64 64 0 0 1 64-64Z') + '<circle cx="384" cy="256" r="24" fill="currentColor"/>',
  "playpause": line('M48 128v256l176-128ZM336 128v256M432 128v256'),
  "playpausefill": filled('M48 128v256l176-128Z') + line('M336 128v256M432 128v256', '', 56),
  "lifting": '<circle cx="256" cy="80" r="48" fill="currentColor"/>' + line('M48 224h416M80 176v96M432 176v96M176 224l80 32 80-32M256 256v96M256 352l-64 128M256 352l64 128'),
  "sunhorizon": horizon('M256 128v64', false),
  "sunhorizonfill": horizon('M256 128v64', true),
  "sunrise": horizon('M256 224V64M200 120l56-56 56 56', false),
  "sunrisefill": horizon('M256 224V64M200 120l56-56 56 56', true),
  "sunset": horizon('M256 64v160M200 168l56 56 56-56', false),
  "sunsetfill": horizon('M256 64v160M200 168l56 56 56-56', true),
  "pill": PILL + LINE + '/>' + line('M256 160v192') + '</g>',
  "pillfill": PILL + 'fill="currentColor"/></g>',
  "brainhead": line('M320 480v-72h48a40 40 0 0 0 40-40v-72l48-24-48-88C384 96 320 32 224 32 120 32 56 112 64 208c6 64 40 104 80 136v136') + line('M176 168c-8-40 48-64 72-32 24-32 88-16 80 32 40 8 40 72 0 80 0 40-64 48-80 16-24 24-80 8-72-32-40-8-40-64 0-64Z'),
  "decrease": line('M64 128h384M128 256h256M192 384h128'),
  "grid1x2": line(GRID_1X2),
  "grid1x2fill": solid(GRID_1X2),
  "sidebar": line('M96 80h320a64 64 0 0 1 64 64v224a64 64 0 0 1-64 64H96a64 64 0 0 1-64-64V144a64 64 0 0 1 64-64ZM192 80v352M96 160h40M96 224h40'),
  "radiowaves": '<circle cx="256" cy="256" r="40" fill="currentColor"/>' + line('M352 160a136 136 0 0 1 0 192M416 96a226 226 0 0 1 0 320M160 160a136 136 0 0 0 0 192M96 96a226 226 0 0 0 0 320'),
  "antenna": '<circle cx="256" cy="208" r="40" fill="currentColor"/>' + line('M256 248v232M352 112a136 136 0 0 1 0 192M416 48a226 226 0 0 1 0 320M160 112a136 136 0 0 0 0 192M96 48a226 226 0 0 0 0 320'),
  "crown": line('M64 160l96 112 96-160 96 160 96-112-32 256H96Z'),
  "crownfill": filled('M64 160l96 112 96-160 96 160 96-112-32 256H96Z'),
  "hexagon": line('M256 32 450 144v224L256 480 62 368V144Z'),
  "hexagonfill": filled('M256 32 450 144v224L256 480 62 368V144Z'),
  "diamond": line(DIAMOND),
  "diamondfill": filled(DIAMOND),
  "eyeglasses": line('M56 288a80 80 0 1 0 160 0a80 80 0 1 0-160 0ZM296 288a80 80 0 1 0 160 0a80 80 0 1 0-160 0ZM216 280q40-32 80 0M56 288 32 200M456 288l24-88'),
  "columns": line(`${ROOF}M48 448h416M80 400h352M112 208v144M208 208v144M304 208v144M400 208v144`),
  "columnsfill": filled(ROOF) + line('M48 448h416M80 400h352') + line('M112 216v136M208 216v136M304 216v136M400 216v136', '', 56),
  // An oval head along the handle's line, strung across.
  "tennisracket": '<ellipse cx="304" cy="208" rx="120" ry="168" transform="rotate(45 304 208)" ' + LINE + '/>' + line('M185 327 423 89M219 123l170 170') + line('M185 327 64 448', '', 48),
  "serverrack": RACK,
  "docmagnify": line('M256 464H144a48 48 0 0 1-48-48V96a48 48 0 0 1 48-48h112l128 128v48M256 48v80a48 48 0 0 0 48 48h80M160 240h96M160 320h48') + '<circle cx="352" cy="368" r="72" ' + LINE + '/>' + line('M404 420l60 60'),
  "bookclosedfill": solid('M160 48h208a48 48 0 0 1 48 48v272H160a48 48 0 0 0-48 32V96a48 48 0 0 1 48-48Z') + line('M416 368H160a48 48 0 0 0 0 96h256M416 368v48'),
  "moonstars": moonStars('moon-outline'),
  "moonstarsfill": moonStars('moon'),
  "quote": solid(QUOTE) + `<g transform="translate(160 0)">${solid(QUOTE)}</g>`,
  // octagon and seal: a container with nothing in it.
  "blank": '',
  "checklist": line('M56 144a56 56 0 1 0 112 0a56 56 0 1 0-112 0ZM84 144l20 20 36-36M56 368a56 56 0 1 0 112 0a56 56 0 1 0-112 0ZM224 144h240M224 368h240'),
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

/** The shapes a glyph sits in, each open for its fill and stroke. */
const CONTAINERS = {
  circle: '<circle cx="256" cy="256" r="224"',
  square: '<rect x="32" y="32" width="448" height="448" rx="64"',
  octagon: '<path d="M164 32h184l132 132v184L348 480H164L32 348V164Z"',
  seal: '<path d="M256 30 328 82 416 96 430 184 482 256 430 328 416 416 328 430 256 482 184 430 96 416 82 328 30 256 82 184 96 96 184 82Z"',
  bubble: '<path d="M256 56c-116 0-208 80-208 180 0 52 26 98 66 130-4 30-20 58-42 78 44-2 84-18 112-42 22 6 46 10 72 10 116 0 208-80 208-176S372 56 256 56Z"',
  shield: '<path d="M256 40 72 104v128c0 120 80 200 184 240 104-40 184-120 184-240V104Z"',
}
/** Where the glyph sits in each container: centred in its body, a speech bubble's above its tail. */
const INSETS: Readonly<Record<keyof typeof CONTAINERS, string>> = {
  circle: 'translate(108 108) scale(.58)', square: 'translate(108 108) scale(.58)', octagon: 'translate(108 108) scale(.58)', seal: 'translate(108 108) scale(.58)',
  bubble: 'translate(128 108) scale(.5)', shield: 'translate(128 112) scale(.5)',
}

/**
 * Only trusted, bundled SVG strings reach the painter; user input is a map key.
 *
 * Containers, badges and slashes are composed around the glyph. With `layered`, a filled
 * container is painted under its glyph rather than knocked out of it, and a `.circle` or
 * `.square` name drawn by one Ionicon, checkmark.circle.fill, is composed from its glyph,
 * so hierarchical and palette can paint the two apart (Wave 6b). Both take one path,
 * `symbolEnclosure`, so the glyph turns and mirrors the same in either.
 */
export function symbolAsset(name: string, maskId = 'symbol-mask', paint: SymbolAssetPaint = {}): SymbolAsset | null {
  const definition = symbolDefinition(name)
  if (!definition) return null
  const enclosure = definition.container || paint.layered ? symbolEnclosure(name) : null
  const glyph = enclosure ? enclosure.glyph : definition
  const icon = glyph.icon
  const drawn = icon.startsWith('#') ? PAINTED[icon.slice(1)]?.(paint) ?? PRIMITIVES[icon.slice(1)] : `<use href="${SPRITE}#${icon}" />`
  if (drawn === undefined) return null
  const source = icon.startsWith('#') ? 'fallback' : 'ionicons'
  let body = drawn
  // Turned first and mirrored last, so arrow.right.to.line, the down arrow turned to the left
  // and then mirrored, points right.
  if (glyph.turned) body = `<g transform="rotate(90 256 256)">${body}</g>`
  if (glyph.flipped) body = `<g transform="translate(0 512) scale(1 -1)">${body}</g>`
  if (glyph.mirrored) body = `<g transform="translate(512 0) scale(-1 1)">${body}</g>`
  if (definition.slash) {
    // The glyph parts around the stroke, as `.slash` symbols do.
    body = `<defs><mask id="${maskId}-slash"><rect width="512" height="512" fill="white"/><path d="M64 64 448 448" stroke="black" stroke-width="112"/></mask></defs><g mask="url(#${maskId}-slash)">${body}</g>${line('M64 64 448 448')}`
  }
  if (definition.badge) body = badged(body, definition, maskId, paint.layered === true)
  if (!enclosure) return { body, viewBox: definition.viewBox ?? '0 0 512 512', source }
  const outline = CONTAINERS[enclosure.container]
  const inner = body && `<g transform="${INSETS[enclosure.container]}">${body}</g>`
  // Knock the icon out of filled containers, so their holes reveal any background; in two
  // layers the container goes under the icon instead, as iOS 27 paints them.
  let composed: string
  if (!enclosure.filled) {
    const shape = `${outline} fill="none" stroke="currentColor" stroke-width="32" stroke-linejoin="round"/>`
    composed = (paint.layered ? layer(2, shape) : shape) + inner
  } else if (paint.layered) composed = layer(3, `${outline} fill="currentColor"/>`) + inner
  else composed = `<defs><mask id="${maskId}"><rect width="512" height="512" fill="white"/><g fill="black" color="black">${inner.replaceAll('currentColor', 'black')}</g></mask></defs>${outline} fill="currentColor" mask="url(#${maskId})"/>`
  return { body: composed, viewBox: '0 0 512 512', source }
}

/**
 * A dot, plus or checkmark badge in the glyph's corner, cut out of the glyph around it. The
 * badge is the first layer and the glyph the second, as palette and multicolor paint them.
 */
function badged(body: string, definition: { readonly badge?: 'dot' | 'plus' | 'check'; readonly badgeTop?: boolean }, maskId: string, layered: boolean): string {
  const dot = definition.badge === 'dot'
  const [x, y, r] = dot ? [416, 96, 80] : [400, definition.badgeTop ? 112 : 400, 104]
  const sign = definition.badge === 'plus' ? `M${x} ${y - 56}v112M${x - 56} ${y}h112` : `M${x - 48} ${y}l32 32 64-64`
  const glyph = `<defs><mask id="${maskId}-badge"><rect width="512" height="512" fill="white"/><circle cx="${x}" cy="${y}" r="${r + 40}" fill="black"/></mask>${dot ? '' : `<mask id="${maskId}-sign"><rect width="512" height="512" fill="white"/><path d="${sign}" stroke="black" stroke-width="32" stroke-linecap="round" stroke-linejoin="round" fill="none"/></mask>`}</defs><g mask="url(#${maskId}-badge)">${body}</g>`
  return (layered ? layer(2, glyph) : glyph) + `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor"${dot ? '' : ` mask="url(#${maskId}-sign)"`}/>`
}

export function symbolStrokeScale(fontWeight: number): number {
  return 0.72 + (Math.max(100, Math.min(900, fontWeight)) / 400) * 0.28
}
