/**
 * The font stacks, in `shared` because both sides of the worker boundary need them.
 *
 * The main thread measures these faces and sends the metrics to the worker; the worker
 * lays out against them. Importing them from `swiftui-runtime` would work and did —
 * and it pulled the entire SwiftUI runtime, interpreter included, into the main
 * thread's bundle for the sake of three string constants. An eighty-kilobyte import of
 * something the main thread never runs is the kind of cost that is invisible until
 * something measures it.
 *
 * A metric-compatible open stack rather than SF Pro, which is not licensed for web
 * redistribution (risk R2).
 */

export const UI_FONT_FAMILY =
  '"Inter", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", sans-serif'

export const ROUNDED_FAMILY = '"Inter", ui-rounded, system-ui, sans-serif'

export const MONO_FAMILY = 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace'
