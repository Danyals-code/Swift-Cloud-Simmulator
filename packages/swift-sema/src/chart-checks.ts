import type { SourceSpan } from '@studio/shared'
import type { CallExpr, Expr } from '@studio/swift-syntax'
import { CHART_MARKS } from './builtins'

/**
 * The Swift Charts modifiers the preview draws as written (Wave 6e): the checker says
 * nothing for these forms, and Design doesn't list them as not drawn. Every other form, on a
 * chart or on its marks, still says it isn't drawn. Pure, and only for the names it lists.
 */

const SHOWN: ReadonlySet<string> = /*#__PURE__*/ new Set(['hidden', 'visible', 'automatic'])
const ANNOTATED: ReadonlySet<string> = /*#__PURE__*/ new Set(['top', 'overlay', 'automatic'])
const CENTER: ReadonlySet<string> = /*#__PURE__*/ new Set(['center'])

/** `.hidden` or `Visibility.hidden`: a case of `type` written plainly. */
const caseOf = (e: Expr | undefined, cases: ReadonlySet<string>, type: string) => e?.kind === 'memberAccess' && (!e.base || e.base.kind === 'identifier' && e.base.name === type) && cases.has(e.member)

/** Whether a chart's own modifier, on a chain that starts at `Chart`, is drawn as written. */
export function drawnOnChart(name: string, call: CallExpr): boolean {
  const first = call.args[0], one = call.args.length === 1 && !call.trailingClosure
  if (name === 'chartXAxis' || name === 'chartYAxis' || name === 'chartLegend') return one && first!.label === null && caseOf(first!.value, SHOWN, 'Visibility')
  // A domain is drawn, or the chart is a box saying why, as on an axis of dates; a scale's range or type is neither.
  if (name === 'chartXScale' || name === 'chartYScale') return one && first!.label === 'domain'
  return false
}

/** Whether a mark's modifier, on a chain that starts at a drawn mark, is drawn as written. */
export function drawnOnMark(name: string, call: CallExpr): boolean {
  const first = call.args[0], one = call.args.length === 1 && !call.trailingClosure
  if (name === 'foregroundStyle') return one && (first!.label === null || first!.label === 'by')
  if (name === 'position') return one && first!.label === 'by'
  if (name === 'annotation') return !!call.trailingClosure && annotationDrawn(call)
  return false
}

/**
 * `.annotation(position:alignment:) { … }` as the preview draws it: centred, above the mark
 * or over it. Above a sector, iOS draws nothing, as the preview doesn't. Each argument is
 * written once, in Swift's order.
 */
function annotationDrawn(call: CallExpr): boolean {
  const [position, alignment] = call.args
  const at = position?.label === 'position' ? position : undefined, aligned = at ? alignment : position
  if (call.args.length > (at ? 1 : 0) + (aligned ? 1 : 0)) return false
  if (at && !caseOf(at.value, ANNOTATED, 'AnnotationPosition')) return false
  return !aligned || aligned.label === 'alignment' && caseOf(aligned.value, CENTER, 'Alignment')
}

/** What the preview does with a chart's part it doesn't draw, in the overload checks' `Feature: …` form, or undefined. */
export function chartPartWarning(name: string): string | undefined {
  if (AXIS_PARTS.has(name)) return `${name}: the preview keeps the chart’s default axis. Xcode draws it as written.`
  return CHART_MARKS.has(name) ? `${name}: the preview leaves it out of the chart. Xcode draws it as written.` : undefined
}
const AXIS_PARTS: ReadonlySet<string> = /*#__PURE__*/ new Set(['AxisMarks', 'AxisGridLine', 'AxisTick', 'AxisValueLabel'])

export interface ChartWarning { readonly span: SourceSpan; readonly message: string; readonly feature: string }

const XY: ReadonlySet<string> = /*#__PURE__*/ new Set(['x', 'y']), SECTOR: ReadonlySet<string> = /*#__PURE__*/ new Set(['angle', 'innerRadius', 'angularInset'])
/** `.name(…)`, a call of a member written plainly. */
const plainCall = (e: Expr, member: string): e is CallExpr => e.kind === 'call' && e.callee.kind === 'memberAccess' && !e.callee.base && e.callee.member === member

/**
 * What a drawn mark's own call is written with that the preview leaves out, each said the
 * same short way: another label (a RuleMark takes x or y alone), an inner radius not as a
 * ratio, and dates by a unit other than a day, which draw the whole chart as a box.
 */
export function markWarnings(call: CallExpr): ChartWarning[] {
  const name = call.callee.kind === 'identifier' ? call.callee.name : '', labels = name === 'SectorMark' ? SECTOR : XY, found: ChartWarning[] = []
  const say = (span: SourceSpan, what: string, feature = what) => found.push({ span, message: `The preview doesn’t draw ${what}.`, feature })
  for (const arg of call.args) {
    if (!labels.has(arg.label ?? '')) say(arg.span, `${name}(${arg.label ?? '_'}:)`)
    else if (arg.label === 'innerRadius' && !plainCall(arg.value, 'ratio')) say(arg.value.span, 'SectorMark(innerRadius:) except as .ratio(…)', 'SectorMark(innerRadius:)')
    const unit = plainCall(arg.value, 'value') && arg.value.args.find(a => a.label === 'unit')
    if (unit && !isDay(unit.value)) say(unit.span, 'a chart of dates by any unit but .day; it shows a box', `${name}(unit:)`)
  }
  return found
}
/** `.day`, or `Calendar.Component.day` written in full. */
const isDay = (e: Expr) => e.kind === 'memberAccess' && e.member === 'day' && (!e.base || e.base.kind === 'memberAccess' && e.base.member === 'Component')
