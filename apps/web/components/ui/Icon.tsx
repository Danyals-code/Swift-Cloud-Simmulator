/**
 * The studio's own chrome icons.
 *
 * Drawn here rather than pulled from a set, for two reasons. The whole vocabulary
 * is about twenty glyphs, which is smaller than any icon package's tree-shaken
 * floor; and every one of them has to sit on a 16pt grid at a 1.5pt stroke with
 * round joins, because that is what makes a row of them read as one family rather
 * than as a collection. A borrowed set gets the second part wrong in ways that are
 * hard to name and easy to see.
 *
 * These are *chrome* icons - toolbar, navigator, tabs. The symbols drawn inside
 * the simulated app are a separate vocabulary living in `swiftui-runtime`, because
 * they answer to Apple's proportions rather than to ours.
 */

/** Stroked paths, on a 16x16 grid. */
const STROKE: Readonly<Record<string, string>> = {
  undo: 'M6 3 2.5 6.5 6 10M3 6.5h6a4 4 0 0 1 0 8',
  redo: 'M10 3 13.5 6.5 10 10M13 6.5H7a4 4 0 0 0 0 8',
  keyboard: 'M2.5 3.5h11v9h-11v-9ZM5 6h.1M8 6h.1M11 6h.1M5 8h.1M8 8h.1M11 8h.1M5 10h6',
  collapse: 'M3 2.5h7v2M6 5.5h7v8H6v-8ZM8 9.5h3',
  expand: 'M3 2.5h7v2M6 5.5h7v8H6v-8ZM8 9.5h3M9.5 8v3',
  appearance: 'M8 2.25a5.75 5.75 0 1 0 0 11.5 5.75 5.75 0 0 0 0-11.5ZM8 2.25v11.5M10 3v10M12 4v8',
  'chevron-down': 'M4 6.25 8 10.25l4-4',
  'chevron-right': 'M6.25 4 10.25 8l-4 4',
  'chevron-up-down': 'M5 6.75 8 3.75l3 3M5 9.25l3 3 3-3',
  plus: 'M8 3.5v9M3.5 8h9',
  search: 'M7.25 2.5a4.75 4.75 0 1 0 0 9.5 4.75 4.75 0 0 0 0-9.5ZM10.75 10.75 13.5 13.5',
  xmark: 'M4 4l8 8M12 4l-8 8',
  check: 'M3.5 8.5 6.5 11.5 12.5 4.5',
  filter: 'M2.5 4h11M4.5 8h7M6.5 12h3',
  refresh: 'M13 8a5 5 0 1 1-1.6-3.67M13 2.6v2.9h-2.9',
  folder:
    'M2.25 4.75c0-.83.67-1.5 1.5-1.5h2.1c.4 0 .78.16 1.06.44l.9.9h4.94c.83 0 1.5.67 1.5 1.5v5.16c0 .83-.67 1.5-1.5 1.5H3.75c-.83 0-1.5-.67-1.5-1.5V4.75Z',
  inspect: 'M2.5 2.5h4M9.5 2.5h4M13.5 2.5v4M13.5 9.5v4M13.5 13.5h-4M6.5 13.5h-4M2.5 13.5v-4M2.5 6.5v-4M8 5.75v4.5M5.75 8h4.5',
  share: 'M8 10.5V2.75M5.25 5.5 8 2.75l2.75 2.75M3.5 9v3.25c0 .55.45 1 1 1h7c.55 0 1-.45 1-1V9',
  download: 'M8 2.75v7.75M5.25 7.75 8 10.5l2.75-2.75M3.5 12.75h9',
  'sidebar-left':
    'M2.75 3.75h10.5c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1v-6.5c0-.55.45-1 1-1ZM6.25 3.75v8.5',
  'sidebar-bottom':
    'M2.75 3.75h10.5c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1v-6.5c0-.55.45-1 1-1ZM1.75 9.75h12.5',
  'sidebar-right':
    'M2.75 3.75h10.5c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1v-6.5c0-.55.45-1 1-1ZM9.75 3.75v8.5',
  info: 'M8 2.25a5.75 5.75 0 1 0 0 11.5 5.75 5.75 0 0 0 0-11.5ZM8 7.25v3.75M8 5.1v.05',
  warning: 'M8 2.6 14 13H2L8 2.6ZM8 6.5v3M8 11.3v.05',
  error: 'M8 2.25a5.75 5.75 0 1 0 0 11.5 5.75 5.75 0 0 0 0-11.5ZM5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2',
  ellipsis: 'M4 8h.05M8 8h.05M12 8h.05',
  'new-file':
    'M9 1.75H4.75c-.83 0-1.5.67-1.5 1.5v9.5c0 .83.67 1.5 1.5 1.5h6.5c.83 0 1.5-.67 1.5-1.5V5.5L9 1.75ZM8.75 2v3.25H12M8 8v3.5M6.25 9.75h3.5',
  screens:
    'M2.25 3.25h7.5c.55 0 1 .45 1 1v7.5c0 .55-.45 1-1 1h-7.5c-.55 0-1-.45-1-1v-7.5c0-.55.45-1 1-1ZM5.25 3.25V1.75c0-.28.22-.5.5-.5h7c.55 0 1 .45 1 1v7c0 .28-.22.5-.5.5h-1.5M1.25 6.25h9.5',
  grid: 'M2.5 2.5h4.25v4.25H2.5V2.5ZM9.25 2.5h4.25v4.25H9.25V2.5ZM2.5 9.25h4.25v4.25H2.5V9.25ZM9.25 9.25h4.25v4.25H9.25V9.25Z',
  'new-folder':
    'M2.25 4.75c0-.83.67-1.5 1.5-1.5h2.1c.4 0 .78.16 1.06.44l.9.9h4.94c.83 0 1.5.67 1.5 1.5v5.16c0 .83-.67 1.5-1.5 1.5H3.75c-.83 0-1.5-.67-1.5-1.5V4.75ZM8 7.75v3.5M6.25 9.5h3.5',
}

/** Solid paths, filled rather than stroked. */
const FILL: Readonly<Record<string, string>> = {
  run: 'M5 3.4a.6.6 0 0 1 .92-.5l6.3 4.1a.6.6 0 0 1 0 1l-6.3 4.1a.6.6 0 0 1-.92-.5V3.4Z',
  stop: 'M4.4 4.4c0-.55.45-1 1-1h5.2c.55 0 1 .45 1 1v5.2c0 .55-.45 1-1 1H5.4c-.55 0-1-.45-1-1V4.4Z',
  'disclosure-closed': 'M6 3.8 10.6 8 6 12.2V3.8Z',
  'disclosure-open': 'M3.8 6H12.2L8 10.6 3.8 6Z',
  dot: 'M8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z',
  'stack-v': 'M3 3.25h10v3.25H3V3.25ZM3 9.5h10v3.25H3V9.5Z',
  'stack-h': 'M3.25 3v10h3.25V3H3.25ZM9.5 3v10h3.25V3H9.5Z',
  'stack-z': 'M2.5 5.5 8 2.75l5.5 2.75L8 8.25 2.5 5.5ZM2.5 10.5 8 13.25l5.5-2.75',
  rows: 'M2.5 4h11M2.5 8h11M2.5 12h11',
  'list-rows': 'M3 3.5h2v2H3v-2ZM7 4.5h6M3 7h2v2H3V7ZM7 8h6M3 10.5h2v2H3v-2ZM7 11.5h6',
  'text-lines': 'M3 4h10M3 8h10M3 12h6',
  button: 'M2.5 5.5h11c.55 0 1 .45 1 1v3c0 .55-.45 1-1 1h-11c-.55 0-1-.45-1-1v-3c0-.55.45-1 1-1Z',
  image: 'M2.5 3.5h11v9h-11v-9ZM2.5 10l3-2.5 2.5 2 2.5-2 3 2.5M10.5 6a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z',
  scroll: 'M8 2.5v11M5.5 5 8 2.5 10.5 5M5.5 11 8 13.5 10.5 11',
  section: 'M2.5 3.5h11v3h-11v-3ZM2.5 8.5h11v4h-11v-4Z',
  shape: 'M8 2.5 13.5 13H2.5L8 2.5Z',
  spacer: 'M2.5 3v10M13.5 3v10M5 8h6M5 8l1.5-1.5M5 8l1.5 1.5M11 8 9.5 6.5M11 8l-1.5 1.5',
  nav: 'M2.5 4.5h11M6 8l-2.5 2.5M3.5 10.5 6 13M3.5 10.5h10',
  eye: 'M1.75 8S4.3 3.75 8 3.75 14.25 8 14.25 8 11.7 12.25 8 12.25 1.75 8 1.75 8ZM8 6.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z',
  'eye-off': 'M6.3 6.4a1.75 1.75 0 0 0 2.4 2.4M4.2 4.6C2.6 5.8 1.75 8 1.75 8S4.3 12.25 8 12.25c1 0 1.9-.3 2.7-.75M12 10c1.4-1.1 2.25-2 2.25-2S11.7 3.75 8 3.75c-.4 0-.8.05-1.15.13M2.5 2.5l11 11',
}

export type IconName = keyof typeof STROKE | keyof typeof FILL

export interface IconProps {
  name: IconName
  /** Rendered size in px. The grid is 16, so anything else scales the stroke with it. */
  size?: number
  className?: string
  /** Stroke weight before scaling. 1.5 is the family default; 2 reads as "bold". */
  weight?: number
}

export function Icon({ name, size = 14, className, weight = 1.5 }: IconProps) {
  const stroke = STROKE[name]
  const fill = FILL[name]

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      focusable="false"
      className={className}
      style={{ display: 'block', flexShrink: 0 }}
    >
      {stroke ? (
        <path
          d={stroke}
          stroke="currentColor"
          strokeWidth={weight}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {fill ? <path d={fill} fill="currentColor" /> : null}
    </svg>
  )
}
