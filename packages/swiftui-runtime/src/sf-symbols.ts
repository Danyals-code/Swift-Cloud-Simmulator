/**
 * SF Symbol names, mapped to open substitutes.
 *
 * Apple's SF Symbols font is licensed for use in apps on Apple platforms and may not
 * be redistributed to a browser (risk R2 in docs/01-REQUIREMENTS.md). Every symbol
 * here is therefore an *approximation*: a Unicode character that carries the same
 * meaning at the same rough weight and width.
 *
 * The honesty rule that makes this acceptable: a substituted glyph is flagged, the
 * inspector badges it as approximated, and the exported Swift still says
 * `Image(systemName: "star.fill")` - the real symbol appears the moment the project
 * is built in Xcode. What the preview must never do is silently draw something that
 * looks final and is not.
 *
 * `︎` is the text-presentation selector: without it, browsers render several of
 * these as full-colour emoji, which would be a much bigger lie than a monochrome
 * approximation.
 */

import { symbolCandidates } from '@studio/shared'

const TEXT = '︎'

/**
 * Curated mappings, ordered roughly by how often the names appear in real code.
 *
 * Variants (`.fill`, `.circle`, `.square`) are resolved by the lookup rather than
 * enumerated here, so `star`, `star.fill` and `star.circle.fill` all find something
 * sensible without the table growing combinatorially.
 */
const SYMBOLS: Readonly<Record<string, string>> = {
  // navigation and chrome
  'chevron.left': '‹',
  'chevron.right': '›',
  'chevron.up': '˄',
  'chevron.down': '˅',
  'chevron.left.slash.chevron.right': '‹›',
  'arrow.left': '←',
  'arrow.right': '→',
  'arrow.up': '↑',
  'arrow.down': '↓',
  'arrow.clockwise': '↻',
  'arrow.counterclockwise': '↺',
  'arrow.up.arrow.down': '⇅',
  'arrow.uturn.backward': '↩',
  xmark: '✕',
  checkmark: '✓',
  plus: '＋',
  minus: '−',
  multiply: '×',
  divide: '÷',
  equal: '=',
  ellipsis: '…',
  line_3_horizontal: '≡',

  // status
  star: '☆',
  'star.fill': '★',
  heart: '♡',
  'heart.fill': '♥',
  circle: '○',
  'circle.fill': '●',
  square: '□',
  'square.fill': '■',
  triangle: '△',
  'triangle.fill': '▲',
  diamond: '◇',
  'diamond.fill': '◆',
  'checkmark.circle': '✔' + TEXT,
  'checkmark.circle.fill': '✔' + TEXT,
  'checkmark.square': '☑' + TEXT,
  'exclamationmark.triangle': '⚠' + TEXT,
  'exclamationmark.circle': '❗' + TEXT,
  'questionmark.circle': '?',
  'info.circle': 'ℹ' + TEXT,
  'xmark.circle': '✖' + TEXT,
  'xmark.circle.fill': '✖' + TEXT,
  'plus.circle': '⊕',
  'plus.circle.fill': '⊕',
  'minus.circle': '⊖',
  'minus.circle.fill': '⊖',

  // objects
  person: '○',
  'person.fill': '●',
  'person.circle': '○',
  'person.circle.fill': '●',
  'person.2': '●●',
  house: '⌂',
  'house.fill': '⌂',
  gear: '⚙' + TEXT,
  gearshape: '⚙' + TEXT,
  magnifyingglass: '⌕',
  trash: '⌧',
  pencil: '✎' + TEXT,
  square_and_pencil: '✎' + TEXT,
  folder: '▱',
  doc: '▭',
  'doc.text': '▭',
  paperplane: '➤',
  'paperplane.fill': '➤',
  envelope: '✉' + TEXT,
  bell: '\u{1F56D}',
  'bell.fill': '\u{1F56D}',
  calendar: '▦',
  clock: '◴',
  'clock.fill': '◴',
  timer: '◴',
  bookmark: '⚑' + TEXT,
  'bookmark.fill': '⚑' + TEXT,
  tag: '➦',
  bolt: '⚡' + TEXT,
  'bolt.fill': '⚡' + TEXT,
  flame: '▲',
  drop: '●',
  leaf: '❧',
  globe: '◔',
  map: '▦',
  location: '➤',
  camera: '▣',
  photo: '▧',
  music_note: '♪',
  play: '▶' + TEXT,
  'play.fill': '▶' + TEXT,
  pause: '‖',
  'pause.fill': '‖',
  stop: '■',
  forward: '▶▶',
  backward: '◀◀',
  speaker: '◀',
  'speaker.wave.2': '◀)',
  lock: '⚿' + TEXT,
  'lock.fill': '⚿' + TEXT,
  key: '⚿' + TEXT,
  wifi: '◠',
  battery_100: '▭',
  cart: '▮',
  creditcard: '▭',
  bag: '▭',
  gift: '▦',
  flag: '⚑' + TEXT,
  'flag.fill': '⚑' + TEXT,
  sun_max: '☀' + TEXT,
  moon: '☽' + TEXT,
  'moon.fill': '☾' + TEXT,
  cloud: '☁' + TEXT,
  sparkles: '✦',
  wand_and_stars: '✦',
  'list.bullet': '≡',
  'square.grid.2x2': '⊞',
  'text.alignleft': '≡',
  'slider.horizontal.3': '≡',
  'arrow.up.right': '↗',
  'arrow.down.left': '↙',
  'hand.thumbsup': '☝' + TEXT,
  eye: '◉',
  'eye.slash': '◌',
  link: '⚭',
  at: '@',
  number: '#',
}

/** Drawn when nothing matches, so a missing symbol is visible rather than blank. */
const FALLBACK = '▢'

export interface ResolvedSymbol {
  readonly glyph: string
  /**
   * True for every symbol, always.
   *
   * Kept as a field rather than implied because the inspector and the exported
   * README both read it, and because it should stay true if a licensed font ever
   * makes some symbols exact - at which point only this flag needs to change.
   */
  readonly approximated: boolean
  /** False when the name is not in the table at all, so telemetry can rank it. */
  readonly known: boolean
}

/**
 * Resolves an SF Symbol name to its fallback glyph.
 *
 * Variant suffixes are stripped progressively by `symbolCandidates` - the same
 * walk the renderer uses to find a drawn shape, shared so that the two cannot
 * disagree about which base a name falls back to.
 *
 * Since the renderer gained a table of drawn shapes this is the *second* thing
 * tried, not the first: it answers for names nothing has been drawn for, and it
 * decides `known`, which is what the coverage panel ranks. A name that is known
 * here and undrawn there still renders - as the character below - which is exactly
 * what every symbol used to get.
 */
export function resolveSymbol(name: string): ResolvedSymbol {
  for (const candidate of symbolCandidates(name)) {
    const match = SYMBOLS[candidate]
    if (match) return { glyph: match, approximated: true, known: true }
  }
  return { glyph: FALLBACK, approximated: true, known: false }
}

export function isKnownSymbol(name: string): boolean {
  return resolveSymbol(name).known
}

/** Every name the table maps directly. Used by completions and by the docs. */
export function symbolNames(): string[] {
  return Object.keys(SYMBOLS)
    .map((k) => k.replace(/_/g, '.'))
    .sort()
}
