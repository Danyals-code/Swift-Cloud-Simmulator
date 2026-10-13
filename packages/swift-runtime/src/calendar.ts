import type { CallArgument } from './host'
import { asDate, bool, dateValue, int, NIL, str, VOID, type OpaqueValue, type SwiftValue } from './values'

/**
 * The Foundation that view code reaches for around a `Date`: `Calendar.current`, a
 * `Timer`, and `formatted(date:time:)`.
 *
 * Dates are read in the preview's local time zone, as `Calendar.current` reads them in
 * the app's. A timer is a stand-in that never fires: the preview draws a moment, not a
 * running clock, and the checker says so where one is made.
 */

export const CALENDAR_TYPE = 'Calendar'
export const TIMER_TYPE = 'Timer'

export function calendarValue(): OpaqueValue {
  return { kind: 'opaque', typeName: CALENDAR_TYPE, payload: {} }
}

export function timerValue(): OpaqueValue {
  return { kind: 'opaque', typeName: TIMER_TYPE, payload: {} }
}

/** The name of a leading-dot member such as `.day`, which the host answers as a token; '' for anything else. */
export function leadingDotName(value: SwiftValue | undefined): string {
  return value?.kind === 'opaque' ? String((value.payload as { name?: string } | null)?.name ?? '') : ''
}

/** `Timer.publish(every:on:in:).autoconnect()`, `timer.invalidate()`: a timer that never fires. */
export function callTimerMember(target: OpaqueValue, member: string): SwiftValue | undefined {
  if (member === 'autoconnect' || member === 'connect') return target
  if (member === 'invalidate' || member === 'fire') return VOID
  return undefined
}

/** The members of `Calendar.current` that view code uses. */
export function callCalendarMember(member: string, args: readonly CallArgument[]): SwiftValue | undefined {
  const arg = (i: number): SwiftValue | undefined => args[i]?.value
  const labelled = (name: string): SwiftValue | undefined => args.find((a) => a.label === name)?.value
  const seconds = (value: SwiftValue | undefined): number | null => asDate(value)?.epochSeconds ?? null

  switch (member) {
    case 'component': {
      const date = seconds(labelled('from'))
      const part = date === null ? undefined : localParts(date)[leadingDotName(arg(0)) as keyof LocalParts]
      return part === undefined ? undefined : int(part)
    }
    case 'date': {
      const date = seconds(labelled('to'))
      const value = labelled('value')
      if (date === null || value?.kind !== 'int') return undefined
      const added = adding(date, leadingDotName(labelled('byAdding')), value.value)
      return added === null ? NIL : dateValue(added)
    }
    case 'startOfDay': {
      const date = seconds(labelled('for'))
      return date === null ? undefined : dateValue(startOfDay(date))
    }
    case 'isDateInToday':
    case 'isDateInTomorrow':
    case 'isDateInYesterday': {
      const date = seconds(arg(0))
      const offset = member === 'isDateInToday' ? 0 : member === 'isDateInTomorrow' ? 1 : -1
      return date === null ? undefined : bool(startOfDay(date) === adding(startOfDay(Date.now() / 1000), 'day', offset))
    }
    case 'isDate': {
      const a = seconds(arg(0))
      if (labelled('inSameDayAs') !== undefined) {
        const b = seconds(labelled('inSameDayAs'))
        return a === null || b === null ? undefined : bool(startOfDay(a) === startOfDay(b))
      }
      // `isDate(_:equalTo:toGranularity:)`: the same month, week or year, as a budget totals this month.
      const b = seconds(labelled('equalTo'))
      const period = GRANULARITIES[leadingDotName(labelled('toGranularity'))]
      return a === null || b === null || !period ? undefined : bool(period(a) === period(b))
    }
    case 'dateComponents': {
      const units = arg(0)?.kind === 'array' ? (arg(0) as { elements: readonly SwiftValue[] }).elements.map(leadingDotName) : []
      const from = seconds(labelled('from'))
      const to = seconds(labelled('to'))
      if (from === null) return undefined
      const found = to === null ? partsOf(from, units) : between(from, to, units)
      return { kind: 'struct', typeName: 'DateComponents', fields: new Map(COMPONENTS.map((unit) => [unit, found.has(unit) ? int(found.get(unit)!) : NIL])) }
    }
    default:
      return undefined
  }
}

/**
 * `date.formatted()` and `date.formatted(date:time:)`. With no arguments it is
 * Foundation's default, a numeric date and a short time: "9/23/2026, 9:41 PM".
 */
export function formatDate(epochSeconds: number, args: readonly CallArgument[]): SwiftValue {
  const style = (label: string): string | null => {
    const given = args.find((a) => a.label === label)
    return given ? leadingDotName(given.value) : null
  }
  const labelled = args.some((a) => a.label === 'date' || a.label === 'time')
  const date = labelled ? style('date') ?? 'omitted' : 'numeric'
  const time = labelled ? style('time') ?? 'omitted' : 'shortened'
  const options: Intl.DateTimeFormatOptions = { ...DATE_STYLES[date], ...TIME_STYLES[time] }
  return str(new Intl.DateTimeFormat(undefined, options).format(new Date(epochSeconds * 1000)))
}

/** `formatted()` with no style: a numeric date and a short time. */
function defaultDateText(epochSeconds: number): string {
  return new Intl.DateTimeFormat(undefined, { ...DATE_STYLES.numeric, ...TIME_STYLES.shortened }).format(new Date(epochSeconds * 1000))
}

/**
 * `.dateTime.weekday().hour().minute()`: a `Date.FormatStyle` built field by field.
 *
 * `.dateTime` arrives as a contextual token, and every field call returns it again
 * with the field written into its name, `dateTime;weekday=;hour=twoDigits.omitted`,
 * the way `.currency(code:)` carries its code. The fields' order is not what Swift
 * writes either: like Foundation, ICU's pattern generator puts them in the locale's
 * order, en_US as the simulator starts in. A member the preview does not draw, such as
 * `.quarter()` or `.locale(_:)`, leaves the style as it was rather than stopping the view.
 */
export function callDateFormatMember(target: OpaqueValue, member: string, args: readonly CallArgument[]): SwiftValue | undefined {
  if (target.typeName !== 'Token') return undefined
  const name = leadingDotName(target)
  if (name !== 'dateTime' && !name.startsWith('dateTime;')) return undefined
  if (!DATE_FIELDS.has(member)) return target
  const option = args[0]?.value
  // `.hour(.defaultDigits(amPM: .omitted))` arrives as a token carrying its argument.
  const amPM = option?.kind === 'opaque' ? leadingDotName((option.payload as { args?: readonly SwiftValue[] }).args?.[0]) : ''
  const fields = name.split(';').slice(1).filter((field) => !field.startsWith(`${member}=`))
  fields.push(`${member}=${leadingDotName(option)}${amPM ? `.${amPM}` : ''}`)
  return { ...target, payload: { ...(target.payload as object), name: ['dateTime', ...fields].join(';') } }
}

/** A value written in a `.dateTime` style; null for anything else, a date or a style. */
export function formatDateValue(value: SwiftValue, style: string): string | null {
  const date = asDate(value)
  return date ? formatDateStyle(date.epochSeconds, style) : null
}

/** A date in a `.dateTime` style; null for a style that is not one. */
export function formatDateStyle(epochSeconds: number, style: string): string | null {
  // `.dateTime` with no fields is Foundation's default, as `formatted()` writes it.
  if (style === 'dateTime') return defaultDateText(epochSeconds)
  if (!style.startsWith('dateTime;')) return null
  const options: Intl.DateTimeFormatOptions = {}
  const written = new Map(style.split(';').slice(1).map((field) => field.split('=') as [string, string]))
  for (const [field, given] of written) {
    const width = given.split('.')[0]!
    const digits = width === 'twoDigits' ? '2-digit' : 'numeric'
    const words = width === 'wide' ? 'long' : width === 'narrow' ? 'narrow' : 'short'
    if (field === 'era') options.era = words
    if (field === 'year') options.year = digits
    if (field === 'month') options.month = width === 'defaultDigits' ? 'numeric' : width === 'twoDigits' ? '2-digit' : words
    if (field === 'day') options.day = digits
    if (field === 'weekday') options.weekday = words
    if (field === 'hour') options.hour = width.startsWith('two') || width.startsWith('conversationalTwo') ? '2-digit' : 'numeric'
    if (field === 'minute') options.minute = digits
    if (field === 'second') options.second = digits
    if (field === 'timeZone') options.timeZoneName = 'short'
  }
  if (Object.keys(options).length === 0) return defaultDateText(epochSeconds)
  const amPM = written.get('hour')?.split('.')[1] ?? ''
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(new Date(epochSeconds * 1000))
  return parts.map((part, i) => {
    // `.weekday(.short)` is two letters, "Su", which Intl has no width for.
    if (part.type === 'weekday' && written.get('weekday') === 'short') return part.value.slice(0, 2)
    if (part.type === 'dayPeriod') return amPM === 'omitted' ? '' : amPM === 'narrow' ? part.value.charAt(0).toLowerCase() : part.value
    if (part.type !== 'literal') return part.value
    // iOS 27 writes a narrow no-break space before the day period, where browsers differ,
    // and "Sep 9, 2001 at 9:41 AM" for a month in words, where Intl writes a comma.
    if (parts[i + 1]?.type === 'dayPeriod') return amPM === 'omitted' ? '' : '\u202f'
    const joinsTime = DATE_PARTS.has(parts[i - 1]?.type ?? '') && TIME_PARTS.has(parts[i + 1]?.type ?? '')
    return joinsTime && part.value === ', ' && (options.month === 'short' || options.month === 'long') ? ' at ' : part.value
  }).join('').trim()
}

const DATE_PARTS: ReadonlySet<string> = new Set(['era', 'year', 'month', 'day', 'weekday'])
const TIME_PARTS: ReadonlySet<string> = new Set(['hour', 'minute', 'second'])

const DATE_FIELDS: ReadonlySet<string> = new Set([
  'era', 'year', 'quarter', 'month', 'week', 'day', 'dayOfYear', 'weekday', 'hour', 'minute', 'second', 'secondFraction', 'timeZone',
])

const DATE_STYLES: Readonly<Record<string, Intl.DateTimeFormatOptions>> = {
  omitted: {},
  numeric: { year: 'numeric', month: 'numeric', day: 'numeric' },
  abbreviated: { year: 'numeric', month: 'short', day: 'numeric' },
  long: { year: 'numeric', month: 'long', day: 'numeric' },
  complete: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
}

const TIME_STYLES: Readonly<Record<string, Intl.DateTimeFormatOptions>> = {
  omitted: {},
  shortened: { hour: 'numeric', minute: '2-digit' },
  standard: { hour: 'numeric', minute: '2-digit', second: '2-digit' },
  complete: { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' },
}

/**
 * What two dates share when they are equal to a granularity: the start of that period,
 * in the preview's time zone. Weeks start on Sunday, as they do for the United States
 * region the simulator starts in.
 */
const GRANULARITIES: Readonly<Record<string, (epochSeconds: number) => number>> = {
  year: (s) => new Date(localParts(s).year, 0, 1).getTime() / 1000,
  month: (s) => { const p = localParts(s); return new Date(p.year, p.month - 1, 1).getTime() / 1000 },
  weekOfYear: (s) => adding(startOfDay(s), 'day', 1 - localParts(s).weekday) ?? NaN,
  day: startOfDay,
  hour: (s) => { const p = localParts(s); return new Date(p.year, p.month - 1, p.day, p.hour).getTime() / 1000 },
  minute: (s) => Math.floor(s / 60) * 60,
  second: Math.floor,
}

/** The components a `DateComponents` carries here, largest first. */
const COMPONENTS = ['year', 'month', 'day', 'hour', 'minute', 'second', 'weekday'] as const

interface LocalParts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
  /** Sunday is 1, as in Foundation. */
  readonly weekday: number
}

function localParts(epochSeconds: number): LocalParts {
  const date = new Date(epochSeconds * 1000)
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds(), weekday: date.getDay() + 1 }
}

function partsOf(epochSeconds: number, units: readonly string[]): Map<string, number> {
  const parts = localParts(epochSeconds)
  return new Map(units.filter((unit): unit is keyof LocalParts => unit in parts).map((unit) => [unit, parts[unit]]))
}

function startOfDay(epochSeconds: number): number {
  const date = new Date(epochSeconds * 1000)
  date.setHours(0, 0, 0, 0)
  return date.getTime() / 1000
}

/** `date(byAdding:value:to:)`, by the calendar rather than by seconds, so a day is a day across a clock change. */
function adding(epochSeconds: number, unit: string, value: number): number | null {
  const date = new Date(epochSeconds * 1000)
  switch (unit) {
    case 'second': date.setSeconds(date.getSeconds() + value); break
    case 'minute': date.setMinutes(date.getMinutes() + value); break
    case 'hour': date.setHours(date.getHours() + value); break
    case 'day': date.setDate(date.getDate() + value); break
    case 'weekOfYear':
    case 'weekOfMonth': date.setDate(date.getDate() + value * 7); break
    case 'month': date.setMonth(date.getMonth() + value); break
    case 'year': date.setFullYear(date.getFullYear() + value); break
    default: return null
  }
  return date.getTime() / 1000
}

/**
 * `dateComponents(_:from:to:)`: whole units from one date to the other, largest unit
 * first, the way Foundation counts them. From noon on one day to eleven the next
 * morning is 0 days, not 1.
 */
function between(from: number, to: number, units: readonly string[]): Map<string, number> {
  const found = new Map<string, number>()
  const direction = to >= from ? 1 : -1
  let cursor = from
  for (const unit of COMPONENTS) {
    if (!units.includes(unit) || unit === 'weekday') continue
    const a = localParts(cursor)
    const b = localParts(to)
    let count = unit === 'year' ? b.year - a.year
      : unit === 'month' ? (b.year - a.year) * 12 + b.month - a.month
      : Math.trunc((to - cursor) / { day: 86_400, hour: 3_600, minute: 60, second: 1 }[unit])
    // An estimate from the calendar fields can pass the end by one; step back until it doesn't.
    while (count !== 0 && (adding(cursor, unit, count)! - to) * direction > 0) count -= direction
    found.set(unit, count)
    cursor = adding(cursor, unit, count)!
  }
  return found
}
