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
