/**
 * The font stacks, in `shared` because both sides of the worker boundary need them.
 *
 * The main thread measures these faces and sends the metrics to the worker; the worker
 * lays out against them. Importing them from `swiftui-runtime` would work and did -
 * and it pulled the entire SwiftUI runtime, interpreter included, into the main
 * thread's bundle for the sake of three string constants. An eighty-kilobyte import of
 * something the main thread never runs is the kind of cost that is invisible until
 * something measures it.
 *
 * `-apple-system` leads every stack deliberately. A Mac or an iPad then renders the
 * *real* SF Pro, SF Pro Rounded and SF Mono, which is as faithful as a browser can
 * be; everyone else gets the substitute behind it. That the two differ is fine and
 * is not hidden: layout is computed against whichever face actually resolved, because
 * the main thread measures the resolved font rather than reading a transcribed table.
 *
 * SF Pro itself is not licensed for web redistribution (risk R2), which is why there
 * is a substitute at all.
 *
 * `--font-ui` is supplied by `next/font` in the root layout, which self-hosts Inter.
 * A stack naming a face nothing loads is what this file used to contain, and the
 * result was every simulated screen drawn in Segoe UI.
 */

export const UI_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, var(--font-ui), "Segoe UI", system-ui, sans-serif'

/**
 * `.rounded`, as `Font.system(design: .rounded)` selects.
 *
 * `ui-rounded` resolves to SF Pro Rounded on Apple platforms and to nothing
 * anywhere else, so the stack falls through to the same face as the default
 * design. A genuinely rounded substitute would mean a second webfont for a design
 * axis that appears in a minority of code; the coverage matrix records the gap.
 */
export const ROUNDED_FAMILY =
  'ui-rounded, -apple-system, BlinkMacSystemFont, var(--font-ui), "Segoe UI", system-ui, sans-serif'

export const MONO_FAMILY =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, "JetBrains Mono", "Cascadia Mono", Consolas, monospace'

/** SwiftUI's serif design resolves to New York on Apple platforms. */
export const SERIF_FAMILY = 'ui-serif, "New York", Georgia, "Times New Roman", serif'

/** Every stack the layout engine can be asked to measure. */
export const MEASURED_FAMILIES: readonly string[] = [
  UI_FONT_FAMILY,
  ROUNDED_FAMILY,
  MONO_FAMILY,
  SERIF_FAMILY,
]

/**
 * How tall one line of text is at a point size: SF Pro's ascender and descender, 1.19336
 * of its size, rounded up to the 1/3 pt pixel grid of an iPhone. Measured in the iOS 27
 * simulator on iPhone 18 Pro for every text style, from 40.67 pt for `.largeTitle` to
 * 13.33 pt for `.caption2`; Apple's published leading (22 pt for `.body`) is taller than
 * a line is drawn.
 */
export function textLineHeight(size: number): number {
  return Math.ceil(size * 1.19336 * 3 - 1e-6) / 3
}
