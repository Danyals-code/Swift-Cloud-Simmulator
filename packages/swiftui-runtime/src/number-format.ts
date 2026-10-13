/**
 * A number through a `FormatStyle`, by the style's token name.
 *
 * `Intl` does the work, so the grouping separators and currency symbols are the
 * platform's real ones rather than a transcription. Shared by `Text(_:format:)` and
 * `value.formatted(_:)`, which are the same formatting written two ways. Answers null
 * for a style it does not know, so each caller can fall back its own way.
 */
export function formatNumber(n: number, style: string): string | null {
  // `.currency(code:)` arrives as `currency:USD`, the same way `.system(size:)` does.
  const [name, detail] = style.split(':')
  switch (name) {
    case 'currency':
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: detail || 'USD' }).format(n)
    case 'percent':
      return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 }).format(n)
    case 'number':
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n)
    default:
      return null
  }
}
