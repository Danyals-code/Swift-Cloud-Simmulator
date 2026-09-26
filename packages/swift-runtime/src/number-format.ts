/**
 * Numbers as Foundation's format styles write them, in the preview's locale, en-US.
 *
 * `formatted()`, `.number`, `.percent` and `.currency(code:)`, measured in the iOS 27
 * simulator. A Double keeps up to six decimals and drops trailing zeros (3.14159265 is
 * 3.141593, 2.0 is 2). A percent multiplies a Double by 100 and an Int not at all (25
 * is 25%). Foundation rounds the number as it is written, half to even: 2.675 is $2.68,
 * 2.665 is $2.66, and 0.005 is $0.00, where rounding the binary value gives $0.01. So
 * the digits `String(n)` writes, which are Swift's own, are what gets rounded.
 */

import type { SwiftValue } from './values'

/** `roundingMode` and exact decimal input are Intl's own, newer than the ES2022 types. */
type Options = Intl.NumberFormatOptions & { readonly roundingMode?: 'halfEven' }
interface ExactFormat { format(value: string): string }

const formatters = new Map<string, Intl.NumberFormat>()

function write(value: number, options: Options): string {
  const key = JSON.stringify(options)
  let formatter = formatters.get(key)
  if (!formatter) formatters.set(key, (formatter = new Intl.NumberFormat('en-US', { roundingMode: 'halfEven', ...options } as Intl.NumberFormatOptions)))
  return (formatter as unknown as ExactFormat).format(String(value))
}

/**
 * An Int or a Double in the style a `FormatStyle` token names: '' or `number`,
 * `percent`, or `currency:EUR` as `.currency(code:)` arrives. Null for any other value,
 * and for a style this does not know.
 */
export function formatNumber(value: SwiftValue, style: string): string | null {
  if ((value.kind !== 'int' && value.kind !== 'double') || !Number.isFinite(value.value)) return null
  const integer = value.kind === 'int'
  const [name, detail] = style.split(':')
  switch (name) {
    case '':
    case 'number':
      return write(value.value, { maximumFractionDigits: integer ? 0 : 6 })
    case 'percent':
      return integer ? `${write(value.value, { maximumFractionDigits: 0 })}%` : write(value.value, { style: 'percent', maximumFractionDigits: 6 })
    case 'currency':
      return write(value.value, { style: 'currency', currency: detail || 'USD' })
    default:
      return null
  }
}
