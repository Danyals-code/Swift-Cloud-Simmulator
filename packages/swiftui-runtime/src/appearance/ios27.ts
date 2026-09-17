import { CONTROL_METRICS, CONTROL_PARTS } from './controls'
import { rgba, type RGBA, normalizePreviewTarget, type PreviewTarget } from '@studio/shared'

interface TextStyle {
  readonly size: number
  readonly lineHeight: number
  readonly weight: number
}

/** iOS text styles at the default (Large) Dynamic Type size. */
const TEXT_STYLES: Readonly<Record<string, TextStyle>> = {
  largeTitle: { size: 34, lineHeight: 41, weight: 400 },
  title: { size: 28, lineHeight: 34, weight: 400 },
  title2: { size: 22, lineHeight: 28, weight: 400 },
  title3: { size: 20, lineHeight: 25, weight: 400 },
  headline: { size: 17, lineHeight: 22, weight: 600 },
  body: { size: 17, lineHeight: 22, weight: 400 },
  callout: { size: 16, lineHeight: 21, weight: 400 },
  subheadline: { size: 15, lineHeight: 20, weight: 400 },
  footnote: { size: 13, lineHeight: 18, weight: 400 },
  caption: { size: 12, lineHeight: 16, weight: 400 },
  caption2: { size: 11, lineHeight: 13, weight: 400 },
}

const LIGHT_COLORS: Readonly<Record<string, RGBA>> = {
  red: rgba(255, 59, 48),
  orange: rgba(255, 149, 0),
  yellow: rgba(255, 204, 0),
  green: rgba(52, 199, 89),
  mint: rgba(0, 199, 190),
  teal: rgba(48, 176, 199),
  cyan: rgba(50, 173, 230),
  blue: rgba(0, 136, 255),
  indigo: rgba(88, 86, 214),
  purple: rgba(203, 48, 224),
  pink: rgba(255, 45, 85),
  brown: rgba(162, 132, 94),
  gray: rgba(142, 142, 147),
  black: rgba(0, 0, 0),
  white: rgba(255, 255, 255),
  clear: rgba(0, 0, 0, 0),
  /**
   * Opaque, which is what `UIColor.label` is in both appearances.
   *
   * This was 85% black, and the 15% was on every string in every preview at once:
   * every title, every row, every button, every navigation bar. Nothing looked
   * broken and nothing looked like iOS either, and a washed-out screenshot is the
   * hardest kind of wrong to find, because there is no single view to point at.
   *
   * The *secondary* levels really are translucent, and they stay so - that is how
   * they keep working over a coloured background.
   */
  primary: rgba(0, 0, 0),
  secondary: rgba(60, 60, 67, 0.6),
  accentColor: rgba(0, 136, 255),
  accent: rgba(0, 136, 255),
  /**
   * `.tint` as a *style*: `Text("New").foregroundStyle(.tint)`.
   *
   * The accent colour, which is what the tint is until something changes it. Inherited tint is resolved by the converter; these values are the root defaults.
   */
  tint: rgba(0, 136, 255),

  // Semantic colours. These adapt, which is the entire reason for two tables -
  // `Color(white: 0.95)` does not adapt, and a preview that treats them alike would
  // hide the most common dark-mode mistake there is.
  label: rgba(0, 0, 0),
  secondaryLabel: rgba(60, 60, 67, 0.6),
  tertiaryLabel: rgba(60, 60, 67, 0.3),
  separator: rgba(60, 60, 67, 0.12),
  systemBackground: rgba(255, 255, 255),
  secondarySystemBackground: rgba(242, 242, 247),
  tertiarySystemBackground: rgba(255, 255, 255),
  systemGroupedBackground: rgba(242, 242, 247),
  secondarySystemGroupedBackground: rgba(255, 255, 255),
  systemFill: rgba(120, 120, 128, 0.2),
  secondarySystemFill: rgba(120, 120, 128, 0.16),
  // The two lighter fills. A search field and a segmented track are both
  // `tertiarySystemFill` on iOS and were both drawn at `systemFill` here, which is
  // nearly twice as dark - the difference between a control resting on a surface and
  // one cut into it.
  tertiarySystemFill: rgba(118, 118, 128, 0.12),
  quaternarySystemFill: rgba(116, 116, 128, 0.08),
}

const DARK_COLORS: Readonly<Record<string, RGBA>> = {
  ...LIGHT_COLORS,
  red: rgba(255, 69, 58),
  orange: rgba(255, 159, 10),
  yellow: rgba(255, 214, 10),
  green: rgba(48, 209, 88),
  mint: rgba(99, 230, 226),
  teal: rgba(64, 200, 224),
  cyan: rgba(100, 210, 255),
  blue: rgba(0, 145, 255),
  indigo: rgba(94, 92, 230),
  purple: rgba(191, 90, 242),
  pink: rgba(255, 55, 95),
  brown: rgba(172, 142, 104),
  primary: rgba(255, 255, 255),
  secondary: rgba(235, 235, 245, 0.6),
  accentColor: rgba(0, 145, 255),
  accent: rgba(0, 145, 255),
  tint: rgba(0, 145, 255),

  label: rgba(255, 255, 255),
  secondaryLabel: rgba(235, 235, 245, 0.6),
  tertiaryLabel: rgba(235, 235, 245, 0.3),
  separator: rgba(84, 84, 88, 0.6),
  systemBackground: rgba(0, 0, 0),
  secondarySystemBackground: rgba(28, 28, 30),
  tertiarySystemBackground: rgba(44, 44, 46),
  systemGroupedBackground: rgba(0, 0, 0),
  secondarySystemGroupedBackground: rgba(28, 28, 30),
  systemFill: rgba(120, 120, 128, 0.36),
  secondarySystemFill: rgba(120, 120, 128, 0.32),
  tertiarySystemFill: rgba(118, 118, 128, 0.24),
  quaternarySystemFill: rgba(116, 116, 128, 0.18),
}

/** iOS 27 target. Metrics and materials are preview approximations pending native calibration. */
export const IOS_27 = {
  id: 'ios-27',
  controls: CONTROL_METRICS,
  controlParts: CONTROL_PARTS,
  textStyles: TEXT_STYLES,
  colors: { light: LIGHT_COLORS, dark: DARK_COLORS },
  spacing: {
    text: { top: 3, bottom: 3, leading: 4, trailing: 4 },
    control: { top: 8, bottom: 8, leading: 8, trailing: 8 },
    image: { top: 6, bottom: 6, leading: 6, trailing: 6 },
  },
  metrics: { padding: 16, spacerMinimum: 8, labelGap: 6, controlGap: 8, navigationBar: 54, largeTitle: 48, tabBar: 49, row: 44, rowInset: 16, separator: 0.5, stackSpacing: 8 },
  button: { automatic: { content: 'borderless', list: 'borderless', form: 'borderless', toolbar: 'glass' }, paddingVertical: 7, paddingHorizontal: 14, cornerRadius: 999, roundedRectangleRadius: 8 },
  switch: CONTROL_PARTS.switch,
  materials: {
    ultraThinMaterial: { opacity: 0.3, blur: 8 },
    thinMaterial: { opacity: 0.45, blur: 12 },
    regularMaterial: { opacity: 0.65, blur: 20 },
    thickMaterial: { opacity: 0.8, blur: 28 },
    ultraThickMaterial: { opacity: 0.92, blur: 36 },
    bar: { opacity: 0.72, blur: 20 },
  } as Readonly<Record<string, { readonly opacity: number; readonly blur: number }>>,
} as const

export function appearanceFor(target?: PreviewTarget): typeof IOS_27 {
  // Keep normalization at the worker boundary as well as the persistence boundary.
  const profiles = { 'ios-27': IOS_27 }
  return profiles[normalizePreviewTarget(target).appearance]
}
