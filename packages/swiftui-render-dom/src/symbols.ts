import { symbolCandidates } from '@studio/shared'

/**
 * SF Symbols, drawn.
 *
 * What this replaces was a table of Unicode characters: `person` was `○`, `house`
 * was `⌂`, `doc` was `▭`, and a list row's disclosure chevron was `›` - a
 * typographic quote mark, drawn by whatever face the browser picked, at roughly
 * twice the height and half the weight of the real thing. On a screen otherwise
 * trying to look like iOS it was the detail that gave the whole preview away, and
 * no amount of bezel or palette work could compensate for it.
 *
 * These are shapes on a 24-unit grid at a monoline weight, which is how SF Symbols
 * themselves are constructed. They are still **approximations** and the honesty
 * rule is unchanged: Apple's symbol font may not be redistributed to a browser
 * (risk R2), so the inspector still badges these as approximated, the hover title
 * still says so, and the exported Swift still reads `Image(systemName: "star.fill")`
 * - the real symbol appears the moment the project is built in Xcode. The
 * improvement is that the approximation is now a drawing of the right thing rather
 * than the nearest character in Unicode.
 *
 * The table lives on the main thread rather than in the worker, so a screen with
 * forty symbols on it posts forty short names across the worker boundary instead of
 * forty kilobytes of path data.
 */

export interface SymbolShape {
  /** Path data on a 24x24 grid. */
  readonly d: string
  /** Stroke width at weight 400, or omitted for a filled shape. */
  readonly stroke?: number
}

const S = 1.7

/** A stroked shape at the family's default weight. */
function s(d: string, width = S): SymbolShape {
  return { d, stroke: width }
}

/** A filled shape. */
function f(d: string): SymbolShape {
  return { d }
}

/** A filled dot, for the symbols built out of them. */
function dot(cx: number, cy: number, r = 1.55): SymbolShape {
  return f(`M${cx} ${cy - r}a${r} ${r} 0 1 0 0 ${r * 2}a${r} ${r} 0 1 0 0-${r * 2}Z`)
}

const CIRCLE_OUTLINE = 'M12 3.4a8.6 8.6 0 1 0 0 17.2a8.6 8.6 0 1 0 0-17.2Z'
const SQUARE_OUTLINE =
  'M5.6 4.6h12.8a1 1 0 0 1 1 1v12.8a1 1 0 0 1-1 1H5.6a1 1 0 0 1-1-1V5.6a1 1 0 0 1 1-1Z'
const STAR =
  'M12 3.6l2.55 5.5 6 .72-4.43 4.1 1.18 5.93L12 16.92l-5.3 2.93 1.18-5.93-4.43-4.1 6-.72L12 3.6Z'
const HEART =
  'M12 20.1S3.6 15.1 3.6 9.55A4.6 4.6 0 0 1 12 6.9a4.6 4.6 0 0 1 8.4 2.65C20.4 15.1 12 20.1 12 20.1Z'
const TRIANGLE = 'M12 4.2 21.2 19.8H2.8L12 4.2Z'
const ENVELOPE_BODY =
  'M3.4 7.4a1.6 1.6 0 0 1 1.6-1.6h14a1.6 1.6 0 0 1 1.6 1.6v9.2a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6V7.4Z'
const DOC_OUTLINE = 'M13.4 3.2H7a2 2 0 0 0-2 2v13.6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.8l-5.6-5.6Z'
const FOLDER_BODY =
  'M3.2 7.1a2 2 0 0 1 2-2h3.5a2 2 0 0 1 1.42.59l1.4 1.41h7.28a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2H5.2a2 2 0 0 1-2-2V7.1Z'
const BELL =
  'M6.2 16.6c1-1 1.3-2 1.3-4.6 0-3 1.9-5.2 4.5-5.2s4.5 2.2 4.5 5.2c0 2.6.3 3.6 1.3 4.6H6.2Z'
const CLOUD =
  'M7.4 18.2a4.2 4.2 0 0 1-.35-8.38A5.2 5.2 0 0 1 17 9.3a3.9 3.9 0 0 1 .5 8.9H7.4Z'
const PERSON_HEAD = 'M12 3.9a3.6 3.6 0 1 0 0 7.2a3.6 3.6 0 1 0 0-7.2Z'
const PERSON_BODY = 'M4.9 20.1a7.4 7.4 0 0 1 14.2 0'
const LOCK_BODY =
  'M5.6 11.6a1.4 1.4 0 0 1 1.4-1.4h10a1.4 1.4 0 0 1 1.4 1.4v7a1.4 1.4 0 0 1-1.4 1.4H7a1.4 1.4 0 0 1-1.4-1.4v-7Z'
const BAG =
  'M5 8.4h14l-1 11.2a1.4 1.4 0 0 1-1.4 1.3H7.4A1.4 1.4 0 0 1 6 19.6L5 8.4Z'

/**
 * The table.
 *
 * Ordered roughly by how often the names appear in real SwiftUI, and deliberately
 * finite: everything not here still resolves, through the suffix stripping in
 * `symbolCandidates`, to its base shape - and failing that, to the Unicode glyph
 * the worker supplies, which is what the whole table used to be.
 */
/** Shared by `gear` and `gearshape`, which are one drawing here. */
const COG: readonly SymbolShape[] = [
  s(
    'M10.6 3.4h2.8l.45 2.35a6.7 6.7 0 0 1 1.8 1.05l2.25-.8 1.4 2.4-1.8 1.55a6.8 6.8 0 0 1 0 2.1l1.8 1.55-1.4 2.4-2.25-.8a6.7 6.7 0 0 1-1.8 1.05L13.4 20.6h-2.8l-.45-2.35a6.7 6.7 0 0 1-1.8-1.05l-2.25.8-1.4-2.4 1.8-1.55a6.8 6.8 0 0 1 0-2.1L4.7 10.4l1.4-2.4 2.25.8a6.7 6.7 0 0 1 1.8-1.05L10.6 3.4Z',
  ),
  s('M12 9.4a2.6 2.6 0 1 0 0 5.2a2.6 2.6 0 1 0 0-5.2Z', 1.5),
]

const SYMBOLS: Readonly<Record<string, readonly SymbolShape[]>> = {
  // ---------------------------------------------------------- navigation
  'chevron.right': [s('M9.4 4.9 16.5 12l-7.1 7.1')],
  'chevron.left': [s('M14.6 4.9 7.5 12l7.1 7.1')],
  'chevron.up': [s('M4.9 15.4 12 8.3l7.1 7.1')],
  'chevron.down': [s('M4.9 8.6 12 15.7l7.1-7.1')],
  'chevron.forward': [s('M9.4 4.9 16.5 12l-7.1 7.1')],
  'chevron.backward': [s('M14.6 4.9 7.5 12l7.1 7.1')],
  'chevron.up.chevron.down': [s('M7.2 10.2 12 5.4l4.8 4.8'), s('M7.2 13.8 12 18.6l4.8-4.8')],
  'chevron.left.slash.chevron.right': [
    s('M7.6 7.6 3.6 12l4 4.4'),
    s('M16.4 7.6l4 4.4-4 4.4'),
    s('M13.6 5.4 10.4 18.6'),
  ],
  'arrow.left': [s('M19 12H5'), s('M10.6 6.4 5 12l5.6 5.6')],
  'arrow.right': [s('M5 12h14'), s('M13.4 6.4 19 12l-5.6 5.6')],
  'arrow.up': [s('M12 19V5'), s('M6.4 10.6 12 5l5.6 5.6')],
  'arrow.down': [s('M12 5v14'), s('M6.4 13.4 12 19l5.6-5.6')],
  'arrow.up.right': [s('M6.5 17.5 17.5 6.5'), s('M9.2 6.5h8.3v8.3')],
  'arrow.down.left': [s('M17.5 6.5 6.5 17.5'), s('M14.8 17.5H6.5V9.2')],
  'arrow.clockwise': [
    s('M20 12a8 8 0 1 1-2.6-5.9'),
    s('M20 4.8v4.4h-4.4'),
  ],
  'arrow.counterclockwise': [
    s('M4 12a8 8 0 1 0 2.6-5.9'),
    s('M4 4.8v4.4h4.4'),
  ],
  'arrow.up.arrow.down': [
    s('M7.5 19V5.6'),
    s('M4.2 8.9 7.5 5.6l3.3 3.3'),
    s('M16.5 5v13.4'),
    s('M13.2 15.1l3.3 3.3 3.3-3.3'),
  ],
  'arrow.uturn.backward': [s('M9.4 5.6 4.4 10.6l5 5'), s('M4.4 10.6h9.8a5.4 5.4 0 0 1 0 10.8h-2.6')],
  'arrow.triangle.2.circlepath': [
    s('M5 10.6A7.4 7.4 0 0 1 17.6 7.4'),
    s('M19 13.4A7.4 7.4 0 0 1 6.4 16.6'),
    f('M17.2 3.6l2.6 4.4h-5.2l2.6-4.4Z'),
    f('M6.8 20.4 4.2 16h5.2l-2.6 4.4Z'),
  ],
  'line.3.horizontal': [s('M4.2 7.4h15.6'), s('M4.2 12h15.6'), s('M4.2 16.6h15.6')],
  'list.bullet': [
    dot(5.2, 7.4, 1.35),
    dot(5.2, 12, 1.35),
    dot(5.2, 16.6, 1.35),
    s('M9.4 7.4h10.4'),
    s('M9.4 12h10.4'),
    s('M9.4 16.6h10.4'),
  ],
  'square.grid.2x2': [
    s('M4.6 4.6h5.6v5.6H4.6zM13.8 4.6h5.6v5.6h-5.6zM4.6 13.8h5.6v5.6H4.6zM13.8 13.8h5.6v5.6h-5.6z'),
  ],
  'slider.horizontal.3': [
    s('M4.2 7h15.6'),
    s('M4.2 12h15.6'),
    s('M4.2 17h15.6'),
    f('M8.6 4.9a2.1 2.1 0 1 1 0 4.2a2.1 2.1 0 1 1 0-4.2Z'),
    f('M15.4 9.9a2.1 2.1 0 1 1 0 4.2a2.1 2.1 0 1 1 0-4.2Z'),
    f('M9.8 14.9a2.1 2.1 0 1 1 0 4.2a2.1 2.1 0 1 1 0-4.2Z'),
  ],

  // ---------------------------------------------------------------- marks
  xmark: [s('M6.2 6.2 17.8 17.8'), s('M17.8 6.2 6.2 17.8')],
  multiply: [s('M6.2 6.2 17.8 17.8'), s('M17.8 6.2 6.2 17.8')],
  checkmark: [s('M4.6 12.6 9.6 17.6 19.4 6.6')],
  plus: [s('M12 4.6v14.8'), s('M4.6 12h14.8')],
  minus: [s('M4.6 12h14.8')],
  equal: [s('M5 9.4h14'), s('M5 14.6h14')],
  divide: [dot(12, 6.6), s('M5 12h14'), dot(12, 17.4)],
  ellipsis: [dot(5.4, 12), dot(12, 12), dot(18.6, 12)],

  // -------------------------------------------------------------- shapes
  circle: [s(CIRCLE_OUTLINE)],
  'circle.fill': [f(CIRCLE_OUTLINE)],
  square: [s(SQUARE_OUTLINE)],
  'square.fill': [f(SQUARE_OUTLINE)],
  triangle: [s(TRIANGLE)],
  'triangle.fill': [f(TRIANGLE)],
  star: [s(STAR)],
  'star.fill': [f(STAR)],
  heart: [s(HEART)],
  'heart.fill': [f(HEART)],
  diamond: [s('M12 3.6 20.4 12 12 20.4 3.6 12 12 3.6Z')],
  'diamond.fill': [f('M12 3.6 20.4 12 12 20.4 3.6 12 12 3.6Z')],
  capsule: [s('M7.5 7.5h9a4.5 4.5 0 0 1 0 9h-9a4.5 4.5 0 0 1 0-9Z')],

  // ------------------------------------------------------------- circled
  'checkmark.circle': [s(CIRCLE_OUTLINE), s('M7.8 12.2 10.8 15.2 16.4 8.8', 1.6)],
  'checkmark.circle.fill': [f(CIRCLE_OUTLINE), { d: 'M7.8 12.2 10.8 15.2 16.4 8.8', stroke: 1.9 }],
  'xmark.circle': [s(CIRCLE_OUTLINE), s('M8.8 8.8 15.2 15.2', 1.6), s('M15.2 8.8 8.8 15.2', 1.6)],
  'xmark.circle.fill': [f(CIRCLE_OUTLINE), s('M8.8 8.8 15.2 15.2', 1.9), s('M15.2 8.8 8.8 15.2', 1.9)],
  'plus.circle': [s(CIRCLE_OUTLINE), s('M12 8.1v7.8', 1.6), s('M8.1 12h7.8', 1.6)],
  'plus.circle.fill': [f(CIRCLE_OUTLINE), s('M12 8.1v7.8', 1.9), s('M8.1 12h7.8', 1.9)],
  'minus.circle': [s(CIRCLE_OUTLINE), s('M8.1 12h7.8', 1.6)],
  'minus.circle.fill': [f(CIRCLE_OUTLINE), s('M8.1 12h7.8', 1.9)],
  'info.circle': [s(CIRCLE_OUTLINE), s('M12 11v5.4', 1.7), dot(12, 7.9, 1.05)],
  'questionmark.circle': [
    s(CIRCLE_OUTLINE),
    s('M9.6 9.6a2.4 2.4 0 1 1 2.4 2.9v1.4', 1.6),
    dot(12, 16.6, 1.05),
  ],
  'exclamationmark.circle': [s(CIRCLE_OUTLINE), s('M12 7.4v5.6', 1.7), dot(12, 16.3, 1.05)],
  'exclamationmark.triangle': [s(TRIANGLE), s('M12 9.2v4.6', 1.7), dot(12, 17.1, 1.05)],
  'exclamationmark.triangle.fill': [f(TRIANGLE)],
  'ellipsis.circle': [s(CIRCLE_OUTLINE), dot(7.8, 12, 1.15), dot(12, 12, 1.15), dot(16.2, 12, 1.15)],
  'checkmark.seal': [
    s(
      'M12 3.2l2.2 1.7 2.7-.4 1 2.6 2.4 1.3-.7 2.7.7 2.7-2.4 1.3-1 2.6-2.7-.4L12 20.8l-2.2-1.7-2.7.4-1-2.6-2.4-1.3.7-2.7-.7-2.7 2.4-1.3 1-2.6 2.7.4L12 3.2Z',
    ),
    s('M8.6 12.2 11 14.6l4.4-4.6', 1.6),
  ],
  'checkmark.square': [s(SQUARE_OUTLINE), s('M8 12.2 10.8 15 16.2 8.9', 1.6)],

  // -------------------------------------------------------------- people
  person: [s(PERSON_HEAD), s(PERSON_BODY)],
  'person.fill': [f(PERSON_HEAD), f('M4.7 20.6a7.6 7.6 0 0 1 14.6 0 1 1 0 0 1-1 1.1H5.7a1 1 0 0 1-1-1.1Z')],
  'person.circle': [
    s(CIRCLE_OUTLINE),
    s('M12 7.3a2.9 2.9 0 1 0 0 5.8a2.9 2.9 0 1 0 0-5.8Z', 1.5),
    s('M6.6 18.9a5.9 5.9 0 0 1 10.8 0', 1.5),
  ],
  'person.circle.fill': [
    f(CIRCLE_OUTLINE),
    { d: 'M12 7.3a2.9 2.9 0 1 0 0 5.8a2.9 2.9 0 1 0 0-5.8Z', stroke: 1.5 },
    { d: 'M6.6 18.9a5.9 5.9 0 0 1 10.8 0', stroke: 1.5 },
  ],
  'person.2': [
    s('M9 4.6a3.2 3.2 0 1 0 0 6.4a3.2 3.2 0 1 0 0-6.4Z'),
    s('M2.8 19.4a6.4 6.4 0 0 1 12.4 0'),
    s('M16.2 5.4a3.2 3.2 0 0 1 0 5.6'),
    s('M17.4 13.4a6.2 6.2 0 0 1 3.8 6'),
  ],
  'hand.thumbsup': [
    s('M7.6 20.4V10.8h2l3-6.2a2.1 2.1 0 0 1 2.9 2.7l-1.2 3.5h4.3a1.8 1.8 0 0 1 1.75 2.25l-1.6 6.1a1.8 1.8 0 0 1-1.75 1.35H7.6Z'),
    s('M3.6 10.8h4v9.6h-4z'),
  ],

  // ------------------------------------------------------------- objects
  house: [s('M3.6 11.2 12 4.2l8.4 7'), s('M5.6 12.6v7.2h12.8v-7.2')],
  'house.fill': [f('M3.2 11.6 12 4.2l8.8 7.4-1.2 1.4v7.2a1 1 0 0 1-1 1H5.4a1 1 0 0 1-1-1v-7.2l-1.2-1.4Z')],
  gearshape: COG,
  // `gear` and `gearshape` are different drawings in SF Symbols and the same idea.
  // Drawing one as the other is an approximation; leaving `gear` to the Unicode
  // fallback while its sibling got a real shape was an inconsistency, and `gear` is
  // the name people actually type.
  gear: COG,
  magnifyingglass: [s('M10.9 3.9a6.6 6.6 0 1 0 0 13.2a6.6 6.6 0 1 0 0-13.2Z'), s('M15.7 15.7 20.4 20.4')],
  trash: [
    s('M4.6 6.6h14.8'),
    s('M9.4 6.6V4.9a1 1 0 0 1 1-1h3.2a1 1 0 0 1 1 1v1.7'),
    s('M6.6 6.6l.85 12.3a1.4 1.4 0 0 0 1.4 1.3h6.3a1.4 1.4 0 0 0 1.4-1.3L17.4 6.6'),
    s('M10.4 10.2v6.4', 1.4),
    s('M13.6 10.2v6.4', 1.4),
  ],
  pencil: [
    s('M16.1 3.9 20.1 7.9 8.3 19.7 3.6 20.4l.7-4.7L16.1 3.9Z'),
    s('M14.1 5.9 18.1 9.9', 1.4),
  ],
  'square.and.pencil': [
    s('M19.4 11.6v6.8a2 2 0 0 1-2 2H6.6a2 2 0 0 1-2-2V7.6a2 2 0 0 1 2-2h6.8'),
    s('M17.3 3.7 20.3 6.7 13.1 13.9l-3.6.6.6-3.6 7.2-7.2Z'),
  ],
  folder: [s(FOLDER_BODY)],
  'folder.fill': [f(FOLDER_BODY)],
  doc: [s(DOC_OUTLINE), s('M13.2 3.4v5.6h5.6', 1.4)],
  'doc.fill': [f(DOC_OUTLINE)],
  'doc.text': [
    s(DOC_OUTLINE),
    s('M13.2 3.4v5.6h5.6', 1.4),
    s('M8.4 13h7.2', 1.4),
    s('M8.4 16.4h5.2', 1.4),
  ],
  book: [
    s('M3.8 5.4a1.4 1.4 0 0 1 1.4-1.4h4.4A2.4 2.4 0 0 1 12 6.4v13a2 2 0 0 0-2-1.6H5.2a1.4 1.4 0 0 1-1.4-1.4V5.4Z'),
    s('M20.2 5.4a1.4 1.4 0 0 0-1.4-1.4h-4.4A2.4 2.4 0 0 0 12 6.4v13a2 2 0 0 1 2-1.6h4.8a1.4 1.4 0 0 0 1.4-1.4V5.4Z'),
  ],
  paperplane: [s('M20.6 3.4 3.6 10.3l6.7 2.9 2.9 6.7 7.4-16.5Z'), s('M10.3 13.2 20.6 3.4', 1.4)],
  'paperplane.fill': [f('M21 3 2.8 10.4l7.5 3.3 3.3 7.5L21 3Z')],
  envelope: [s(ENVELOPE_BODY), s('M3.9 8 12 13.2 20.1 8', 1.5)],
  'envelope.fill': [f(ENVELOPE_BODY)],
  'envelope.open': [
    s('M3.4 10.6 12 4.6l8.6 6v6.4a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6v-6.4Z'),
    s('M3.4 10.6 12 16.4l8.6-5.8', 1.5),
  ],
  message: [
    s('M4 6.6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2h-6.6L7 20.2v-4.2H6a2 2 0 0 1-2-2V6.6Z'),
  ],
  bell: [s(BELL), s('M10.2 18.6a1.9 1.9 0 0 0 3.6 0', 1.5)],
  'bell.fill': [f(BELL), f('M10.2 18.6a1.9 1.9 0 0 0 3.6 0h-3.6Z')],
  calendar: [
    s('M4.4 7.6a1.6 1.6 0 0 1 1.6-1.6h12a1.6 1.6 0 0 1 1.6 1.6v10.8a1.6 1.6 0 0 1-1.6 1.6H6a1.6 1.6 0 0 1-1.6-1.6V7.6Z'),
    s('M4.4 10.4h15.2', 1.5),
    s('M8.4 3.8v3.4', 1.5),
    s('M15.6 3.8v3.4', 1.5),
  ],
  clock: [s(CIRCLE_OUTLINE), s('M12 7.2V12l3.4 2', 1.5)],
  'clock.fill': [f(CIRCLE_OUTLINE)],
  timer: [
    s('M12 6.6a7.4 7.4 0 1 0 0 14.8a7.4 7.4 0 1 0 0-14.8Z'),
    s('M12 10.2V14', 1.5),
    s('M9.4 3.2h5.2', 1.5),
  ],
  bookmark: [s('M6.4 4.4h11.2a1 1 0 0 1 1 1v15.2L12 16.3l-6.6 4.3V5.4a1 1 0 0 1 1-1Z')],
  'bookmark.fill': [f('M6.4 4.4h11.2a1 1 0 0 1 1 1v15.2L12 16.3l-6.6 4.3V5.4a1 1 0 0 1 1-1Z')],
  tag: [
    s('M3.8 11V5.6a1.8 1.8 0 0 1 1.8-1.8H11l9 9-7.2 7.2-9-9Z'),
    dot(8, 8, 1.2),
  ],
  'tag.fill': [f('M3.8 11V5.6a1.8 1.8 0 0 1 1.8-1.8H11l9 9-7.2 7.2-9-9Z')],
  flag: [s('M5.6 3.8v17'), s('M5.6 5h12.6l-2.4 4.2 2.4 4.2H5.6')],
  'flag.fill': [s('M5.6 3.8v17'), f('M5.6 4.6h13.2l-2.6 4.6 2.6 4.6H5.6V4.6Z')],
  link: [
    s('M10.2 13.8a4 4 0 0 0 5.66 0l2.8-2.8a4 4 0 0 0-5.66-5.66l-1.3 1.3'),
    s('M13.8 10.2a4 4 0 0 0-5.66 0l-2.8 2.8a4 4 0 1 0 5.66 5.66l1.3-1.3'),
  ],
  at: [s('M15.6 12a3.6 3.6 0 1 0-7.2 0a3.6 3.6 0 1 0 7.2 0Z'), s('M15.6 8.4V13a2.9 2.9 0 0 0 5.2 1.4A9.4 9.4 0 1 0 17 20')],
  number: [s('M8.6 4.2 6.8 19.8'), s('M17.2 4.2l-1.8 15.6'), s('M4.6 9h15.2'), s('M3.8 15h15.2')],

  // --------------------------------------------------------------- media
  play: [s('M7.2 4.8 19 12 7.2 19.2V4.8Z')],
  'play.fill': [f('M7.2 4.8 19 12 7.2 19.2V4.8Z')],
  pause: [s('M8.6 5v14'), s('M15.4 5v14')],
  'pause.fill': [f('M7 5.2h3.6v13.6H7zM13.4 5.2H17v13.6h-3.6z')],
  stop: [s(SQUARE_OUTLINE)],
  'stop.fill': [f(SQUARE_OUTLINE)],
  forward: [s('M3.4 5.6 11.6 12 3.4 18.4V5.6Z'), s('M12.4 5.6 20.6 12l-8.2 6.4V5.6Z')],
  'forward.fill': [f('M3.4 5.6 11.6 12 3.4 18.4V5.6Z'), f('M12.4 5.6 20.6 12l-8.2 6.4V5.6Z')],
  backward: [s('M20.6 5.6 12.4 12l8.2 6.4V5.6Z'), s('M11.6 5.6 3.4 12l8.2 6.4V5.6Z')],
  'backward.fill': [f('M20.6 5.6 12.4 12l8.2 6.4V5.6Z'), f('M11.6 5.6 3.4 12l8.2 6.4V5.6Z')],
  speaker: [f('M11 5.2 6.4 9H3.2v6h3.2l4.6 3.8V5.2Z')],
  'speaker.wave.2': [
    f('M10 5.6 5.8 9H3v6h2.8l4.2 3.4V5.6Z'),
    s('M13.6 9.4a3.6 3.6 0 0 1 0 5.2', 1.5),
    s('M16.4 6.6a7.6 7.6 0 0 1 0 10.8', 1.5),
  ],
  'music.note': [s('M9.6 17.4V5.4l8-1.8v12'), dot(7.2, 17.6, 2.5), dot(15.2, 15.6, 2.5)],
  mic: [
    s('M12 3.6a2.8 2.8 0 0 1 2.8 2.8v5.2a2.8 2.8 0 0 1-5.6 0V6.4A2.8 2.8 0 0 1 12 3.6Z'),
    s('M6.2 11.2a5.8 5.8 0 0 0 11.6 0'),
    s('M12 17v3.4'),
  ],
  phone: [
    s('M7.2 3.8 9.9 8 8 10.6a12 12 0 0 0 5.4 5.4L16 14.1l4.2 2.7-1.3 3.2a2 2 0 0 1-2.1 1.2C10.4 20.3 3.7 13.6 2.8 7.2A2 2 0 0 1 4 5.1l3.2-1.3Z'),
  ],
  camera: [
    s('M3.6 9.4a1.8 1.8 0 0 1 1.8-1.8h2.2L9 5.2h6l1.4 2.4h2.2a1.8 1.8 0 0 1 1.8 1.8v8a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8v-8Z'),
    s('M12 9.8a3.6 3.6 0 1 0 0 7.2a3.6 3.6 0 1 0 0-7.2Z', 1.5),
  ],
  photo: [
    s('M3.8 6.6a1.8 1.8 0 0 1 1.8-1.8h12.8a1.8 1.8 0 0 1 1.8 1.8v10.8a1.8 1.8 0 0 1-1.8 1.8H5.6a1.8 1.8 0 0 1-1.8-1.8V6.6Z'),
    s('M3.8 15.6 9 11l4.4 4 2.6-2.2 4.2 3.4', 1.5),
    dot(8.4, 9, 1.2),
  ],

  // --------------------------------------------------------------- places
  'mountain.2': [
    s('M2.2 18.6 8 8.4l3.4 6'),
    s('M8.8 18.6 14.6 8.4l7.2 10.2H8.8Z'),
    s('M2.2 18.6h9.6', 1.5),
  ],
  mountain: [s('M2.2 18.6 12 5l9.8 13.6H2.2Z')],
  tree: [s('M12 3.4 5.4 12.4h3.6L3.8 19h16.4l-5.2-6.6h3.6L12 3.4Z'), s('M12 19v2', 1.5)],
  binoculars: [
    s('M7.4 6.6h3.2v10.8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2l1.4-8.8a2 2 0 0 1 2-2Z'),
    s('M16.6 6.6h-3.2v10.8a2 2 0 0 0 2 2H18a2 2 0 0 0 2-2l-1.4-8.8a2 2 0 0 0-2-2Z'),
    s('M10.6 10.6h2.8', 1.5),
  ],
  figure_walk: [
    dot(13.4, 4.6, 1.9),
    s('M13.2 20.6 12 15.4 9.4 12.6l1-5.2 3.4 2.2 2.6.8'),
    s('M10.4 12 7.6 15l-2.2 4.6'),
  ],

  // ------------------------------------------------------------- weather
  'sun.max': [
    s('M12 7.8a4.2 4.2 0 1 0 0 8.4a4.2 4.2 0 1 0 0-8.4Z'),
    s('M12 2.6v2.2', 1.5),
    s('M12 19.2v2.2', 1.5),
    s('M2.6 12h2.2', 1.5),
    s('M19.2 12h2.2', 1.5),
    s('M5.35 5.35 6.9 6.9', 1.5),
    s('M17.1 17.1l1.55 1.55', 1.5),
    s('M18.65 5.35 17.1 6.9', 1.5),
    s('M6.9 17.1 5.35 18.65', 1.5),
  ],
  moon: [s('M20 14.6A8.8 8.8 0 0 1 9.4 4a8.8 8.8 0 1 0 10.6 10.6Z')],
  'moon.fill': [f('M20 14.6A8.8 8.8 0 0 1 9.4 4a8.8 8.8 0 1 0 10.6 10.6Z')],
  cloud: [s(CLOUD)],
  'cloud.fill': [f(CLOUD)],
  bolt: [s('M13.4 2.6 5 13.4h5.2l-.6 8 8.4-10.8h-5.2l.6-8Z')],
  'bolt.fill': [f('M13.4 2.6 5 13.4h5.2l-.6 8 8.4-10.8h-5.2l.6-8Z')],
  drop: [s('M12 3.2c3.6 4.2 6 7.3 6 10a6 6 0 0 1-12 0c0-2.7 2.4-5.8 6-10Z')],
  'drop.fill': [f('M12 3.2c3.6 4.2 6 7.3 6 10a6 6 0 0 1-12 0c0-2.7 2.4-5.8 6-10Z')],
  flame: [
    s('M12 2.8c.6 3.4 3.2 4.6 4.6 7a6.6 6.6 0 1 1-11.2 3.4c.5 1.2 1.5 2 2.6 2.2-.9-3.2.7-6.6 4-12.6Z'),
  ],
  'flame.fill': [
    f('M12 2.8c.6 3.4 3.2 4.6 4.6 7a6.6 6.6 0 1 1-11.2 3.4c.5 1.2 1.5 2 2.6 2.2-.9-3.2.7-6.6 4-12.6Z'),
  ],
  leaf: [
    s('M19.8 4.2c.8 8-3.4 13.4-9.6 13.4a5.8 5.8 0 0 1-5.8-5.8C4.4 7 9.6 3.6 19.8 4.2Z'),
    s('M4.6 20 12 11.6', 1.5),
  ],
  'leaf.fill': [
    f('M19.8 4.2c.8 8-3.4 13.4-9.6 13.4a5.8 5.8 0 0 1-5.8-5.8C4.4 7 9.6 3.6 19.8 4.2Z'),
    s('M4.6 20 12 11.6', 1.5),
  ],
  snowflake: [
    s('M12 2.8v18.4'),
    s('M4 7.4 20 16.6'),
    s('M20 7.4 4 16.6'),
    s('M12 6.4 9.4 4.2M12 6.4l2.6-2.2', 1.4),
    s('M12 17.6 9.4 19.8M12 17.6l2.6 2.2', 1.4),
  ],
  sparkles: [
    f('M9 3.4 10.5 7.9 15 9.4 10.5 10.9 9 15.4 7.5 10.9 3 9.4 7.5 7.9 9 3.4Z'),
    f('M17 13 17.9 15.6 20.5 16.5 17.9 17.4 17 20 16.1 17.4 13.5 16.5 16.1 15.6 17 13Z'),
  ],
  globe: [
    s(CIRCLE_OUTLINE),
    s('M3.4 12h17.2', 1.5),
    s('M12 3.4a13 13 0 0 1 0 17.2a13 13 0 0 1 0-17.2Z', 1.5),
  ],
  map: [
    s('M3.6 6.4 9 4.2v13.4l-5.4 2.2V6.4Z'),
    s('M9 4.2 15 6.6v13.4L9 17.6V4.2Z'),
    s('M15 6.6 20.4 4.4v13.4L15 20V6.6Z'),
  ],
  location: [s('M20.6 3.4 3.8 10.4l7.4 2.4 2.4 7.4 7-16.8Z')],
  'location.fill': [f('M20.6 3.4 3.8 10.4l7.4 2.4 2.4 7.4 7-16.8Z')],

  // ---------------------------------------------------------- commerce
  cart: [
    s('M3 4.4h2.6l2.6 10.4h9L20 8H7.2'),
    dot(9.2, 19, 1.5),
    dot(16.8, 19, 1.5),
  ],
  'cart.fill': [f('M3 4.4h2.6l2.6 10.4h9L20 8H7.2l-.5-2H3v-1.6Z'), dot(9.2, 19, 1.5), dot(16.8, 19, 1.5)],
  creditcard: [
    s('M3.4 7.4a1.8 1.8 0 0 1 1.8-1.8h13.6a1.8 1.8 0 0 1 1.8 1.8v9.2a1.8 1.8 0 0 1-1.8 1.8H5.2a1.8 1.8 0 0 1-1.8-1.8V7.4Z'),
    s('M3.4 10.4h17.2', 1.6),
  ],
  bag: [s(BAG), s('M8.6 8.4V7a3.4 3.4 0 0 1 6.8 0v1.4', 1.5)],
  'bag.fill': [f(BAG), s('M8.6 8.4V7a3.4 3.4 0 0 1 6.8 0v1.4', 1.5)],
  gift: [
    s('M3.8 9.6h16.4v3.2H3.8z'),
    s('M5.4 12.8h13.2v7a1 1 0 0 1-1 1H6.4a1 1 0 0 1-1-1v-7Z'),
    s('M12 9.6v11.2', 1.5),
    s('M12 9.6C10.4 6.6 9 3.8 6.8 4.2A2.2 2.2 0 0 0 7 9.6', 1.5),
    s('M12 9.6c1.6-3 3-5.8 5.2-5.4a2.2 2.2 0 0 1-.2 5.4', 1.5),
  ],

  // -------------------------------------------------------------- system
  lock: [s(LOCK_BODY), s('M8.2 10.2V8a3.8 3.8 0 0 1 7.6 0v2.2')],
  'lock.fill': [f(LOCK_BODY), s('M8.2 10.2V8a3.8 3.8 0 0 1 7.6 0v2.2')],
  'lock.open': [s(LOCK_BODY), s('M8.2 10.2V8a3.8 3.8 0 0 1 7.6 0')],
  key: [
    s('M8.6 7.4a4.4 4.4 0 1 0 0 8.8a4.4 4.4 0 1 0 0-8.8Z'),
    s('M12.6 13 21 13'),
    s('M17.8 13v3.2', 1.5),
    s('M20.2 13v2.2', 1.5),
  ],
  wifi: [
    s('M2.8 8.6a13.4 13.4 0 0 1 18.4 0'),
    s('M6.2 12.4a8.6 8.6 0 0 1 11.6 0'),
    s('M9.4 16a4 4 0 0 1 5.2 0'),
    dot(12, 19, 1.3),
  ],
  eye: [
    s('M2.6 12S6.2 5.8 12 5.8 21.4 12 21.4 12 17.8 18.2 12 18.2 2.6 12 2.6 12Z'),
    s('M12 9.2a2.8 2.8 0 1 0 0 5.6a2.8 2.8 0 1 0 0-5.6Z', 1.5),
  ],
  'eye.slash': [
    s('M6 6.6C3.9 8.2 2.6 12 2.6 12S6.2 18.2 12 18.2c2 0 3.7-.7 5.1-1.7'),
    s('M9.9 5.9A8.8 8.8 0 0 1 12 5.8c5.8 0 9.4 6.2 9.4 6.2a17 17 0 0 1-2.9 3.6'),
    s('M4 3.6 20 19.6'),
  ],
  'chart.bar': [s('M4.4 19.6V13h4v6.6zM10 19.6V7.4h4v12.2zM15.6 19.6v-8.4h4v8.4z')],
  'chart.line.uptrend.xyaxis': [
    s('M4 4v16h16'),
    s('M7 15.6 11 11l3 2.6 4.6-5.6'),
    s('M14.6 8h4v4', 1.5),
  ],
  'square.and.arrow.up': [
    s('M12 3.6v11'),
    s('M8.4 7.2 12 3.6l3.6 3.6'),
    s('M5.6 11.6v7.4a1.4 1.4 0 0 0 1.4 1.4h10a1.4 1.4 0 0 0 1.4-1.4v-7.4'),
  ],
  'text.alignleft': [s('M4 5.6h16'), s('M4 10.2h11'), s('M4 14.8h16'), s('M4 19.4h11')],
  'battery.100': [
    s('M2.6 9.4a1.6 1.6 0 0 1 1.6-1.6h13.2a1.6 1.6 0 0 1 1.6 1.6v5.2a1.6 1.6 0 0 1-1.6 1.6H4.2a1.6 1.6 0 0 1-1.6-1.6V9.4Z'),
    f('M4.4 9.6h12.8v4.8H4.4z'),
    s('M20.8 10.8v2.4', 1.6),
  ],
}

/**
 * The shapes for a symbol name, or null when nothing in the table answers for it.
 *
 * Null is not a failure state: the caller falls back to the Unicode glyph the
 * worker supplied, which is what every symbol used to get. A name that reaches the
 * fallback is drawn less well, never blank.
 */
export function symbolShapes(name: string): readonly SymbolShape[] | null {
  for (const candidate of symbolCandidates(name)) {
    const shapes = SYMBOLS[candidate]
    if (shapes) return shapes
  }
  return null
}

/**
 * Stroke weight relative to the family's default.
 *
 * SF Symbols track the font weight they sit beside, which is what keeps a symbol in
 * a `.headline` row from looking thinner than the text next to it.
 */
export function symbolStrokeScale(fontWeight: number): number {
  return 0.72 + (Math.max(100, Math.min(900, fontWeight)) / 400) * 0.28
}
