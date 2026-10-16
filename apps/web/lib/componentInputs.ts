import { variantCaseWords, type AuthoringNode, type ColorValue, type ComponentInputKind, type VariantProperty } from '@studio/shared'
import { colorFromText } from './colorValue'

/**
 * Components beyond text (Wave 5b): what a view in a Main offers to change per copy,
 * what a copy's input is drawn as, which of a Main's values can differ by a variant
 * property, and which components a copy can swap to.
 *
 * The planner writes the Swift and refuses what it can't; these only choose what the
 * panel offers, from what the view already has written.
 */

/** One value a view can let each copy set: its kind, the control it is read from, and how the panel lists it. */
export interface ExposeChoice { readonly as: ComponentInputKind; readonly control: string; readonly label: string }

/** A value modifier's own control, `modifier:1:0`, rather than its advanced parts or a ternary's sides. */
const MODIFIER_VALUE = /^modifier:\d+:\d+$/

/** The kinds in the order Changeable per copy lists them, each as the panel names it. */
const KINDS = { text: 'Text', symbol: 'Symbol', image: 'Image', color: 'Color', number: 'Number' } as const

/**
 * What a view offers in Changeable per copy, in the order text, symbol, image, colour,
 * number, shown: each value the planner says can become an input (`exposeAs`, Wave 5b).
 * Shown is offered on a view inside a Main, never on the Main itself, whose copies are
 * shown or not where they are called.
 */
export function exposeChoices(node: AuthoringNode): ExposeChoice[] {
  const controls = (node.controls ?? []).filter(control => control.exposeAs && !control.disabledReason && control.value !== '')
  const choices: ExposeChoice[] = (Object.keys(KINDS) as (keyof typeof KINDS)[]).flatMap(kind => controls.filter(control => control.exposeAs === kind)
    .map(control => ({ as: kind, control: control.id, label: `${KINDS[kind]} · ${kind === 'color' || kind === 'number' ? control.label : control.value}` })))
  if (node.kind !== 'definition') choices.push({ as: 'shown', control: '', label: 'Shown' })
  return choices
}

/** A token as a copy writes it, `Color.brand`, `.brand` or `Theme.accent`. */
const TOKEN = /^(?:[A-Za-z_]\w*)?(?:\.[A-Za-z_]\w*)+$/

/** A copy's colour input as the colour field reads it: a system colour, a hex with its alpha as the opacity, or a token. */
export function copyColor(value: string): ColorValue | null {
  const text = value.trim()
  if (!text) return null
  return colorFromText(text) ?? (TOKEN.test(text) ? { token: text } : null)
}

/**
 * The cases a ternary's two sides are for, when its condition is a variant property
 * against its first or second case: `style == .primary` is When Primary, then When
 * Secondary. Undefined for any other condition, whose sides stay If and Else.
 */
export function variantCases(condition: string, variants: readonly VariantProperty[] | undefined): { then: string; otherwise: string } | undefined {
  const match = /^(?:self\.)?(\w+)\s*==\s*(?:\w+)?\.(\w+)$/.exec(condition.trim())
  const variant = match && variants?.find(property => property.name === match[1])
  const at = variant ? variant.cases.indexOf(match[2]!) : -1
  return variant && at >= 0 ? { then: variantCaseWords(variant.cases[at]!), otherwise: variantCaseWords(variant.cases[1 - at]!) } : undefined
}

/** One value in the Main that can differ by a variant property. */
export interface DiffersChoice { readonly control: string; readonly label: string }

/**
 * The values in the Main a variant property can make differ: the view's own text,
 * symbol or image, and the text, numbers, switches and colours of its modifiers, written
 * and not differing already. A choice such as a font style is left to Code.
 */
export function differsChoices(node: AuthoringNode): DiffersChoice[] {
  return (node.controls ?? []).filter(control => !control.disabledReason && control.value !== '' && (control.kind !== 'select' || control.exposeAs === 'color') && (['content', 'title', 'image', 'icon'].includes(control.id) || MODIFIER_VALUE.test(control.id)))
    .map(control => ({ control: control.id, label: control.label }))
}
