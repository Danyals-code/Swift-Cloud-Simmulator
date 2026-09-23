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

/** The name of a leading-dot member such as `.day`, which the host answers as a token. */
export function tokenNameOf(value: SwiftValue | undefined): string {
  return value?.kind === 'opaque' ? String((value.payload as { name?: string }).name ?? '') : ''
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
      const part = date === null ? undefined : localParts(date)[tokenNameOf(arg(0)) as keyof LocalParts]
      return part === undefined ? undefined : int(part)
    }
    case 'date': {
      const date = seconds(labelled('to'))
      const value = labelled('value')
      if (date === null || value?.kind !== 'int') return undefined
      const added = adding(date, tokenNameOf(labelled('byAdding')), value.value)
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
      const b = seconds(labelled('inSameDayAs'))
      return a === null || b === null ? undefined : bool(startOfDay(a) === startOfDay(b))
    }
    case 'dateComponents': {
      const units = arg(0)?.kind === 'array' ? (arg(0) as { elements: readonly SwiftValue[] }).elements.map(tokenNameOf) : []
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
 * `date.formatted()` and `date.formatted(date:time:)`. With no arguments it is a
 * numeric date and a short time, as in iOS: "9/23/2026, 9:41 PM".
 */
export function formatDate(epochSeconds: number, args: readonly CallArgument[]): SwiftValue {
  const style = (label: string): string | null => {
    const given = args.find((a) => a.label === label)
    return given ? tokenNameOf(given.value) : null
  }
  const labelled = args.some((a) => a.label === 'date' || a.label === 'time')
  const date = labelled ? style('date') ?? 'omitted' : 'numeric'
  const time = labelled ? style('time') ?? 'omitted' : 'shortened'
  const options: Intl.DateTimeFormatOptions = { ...DATE_STYLES[date], ...TIME_STYLES[time] }
  return str(new Intl.DateTimeFormat(undefined, options).format(new Date(epochSeconds * 1000)))
}

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
