import { array, NIL, str, type HostCall, type SwiftValue } from '@studio/swift-runtime'
import { markdownSpans } from '@studio/shared'
import { TOKEN_TYPE, type ModifierValue, type TokenPayload, type ViewArg, type ViewValue } from './view-value'

/**
 * `AttributedString` (Wave 6a): a struct, so `text.foregroundColor = .red` is an ordinary
 * field write. Its `runs` field holds one struct per run, its words in `text` and its own
 * attributes beside them; an attribute written on the whole string sits on the string
 * itself and is pushed into every run when strings are joined or drawn. Markdown's marks
 * are kept as `_bold`, `_italic`, `_code`, `_strike` and `_link`. `AttributeContainer` is
 * a struct of attributes alone.
 */
export const ATTRIBUTED_TYPE = 'AttributedString'
const RUN_TYPE = 'AttributedString.Run'
const CONTAINER_TYPE = 'AttributeContainer'

type Struct = Extract<SwiftValue, { kind: 'struct' }>
type Run = ReadonlyMap<string, SwiftValue>

/** Whether a value is an `AttributedString`; a plain boolean, so a caller's other structs stay in its type. */
export function isAttributed(value: SwiftValue | undefined): boolean {
  return asAttributed(value) !== null
}

function asAttributed(value: SwiftValue | undefined, type = ATTRIBUTED_TYPE): Struct | null {
  return value?.kind === 'struct' && value.typeName === type ? value : null
}

function attributed(runs: readonly Run[]): Struct {
  return { kind: 'struct', typeName: ATTRIBUTED_TYPE, fields: new Map([['runs', array(runs.map((fields) => ({ kind: 'struct', typeName: RUN_TYPE, fields: new Map(fields) })))]]) }
}

/** `into` made `runs`, in place: what `append`, `mergeAttributes` and a range's write change. */
function replaceRuns(into: Struct, runs: readonly Run[]): void {
  into.fields.clear()
  for (const [name, value] of attributed(runs).fields) into.fields.set(name, value)
}

/** Each run's attributes, with what was written on the whole string over them. */
function runsOf(value: Struct): Run[] {
  const runs = value.fields.get('runs')
  const whole = [...value.fields].filter(([name]) => name !== 'runs')
  return runs?.kind === 'array' ? runs.elements.flatMap((run) => run.kind === 'struct' ? [new Map([...run.fields, ...whole])] : []) : []
}

/**
 * `AttributedString("Hi")`, `AttributedString("Hi", attributes: container)`, Markdown from
 * `AttributedString(markdown:)` and `(localized:)`, a copy of another, and `AttributeContainer()`.
 */
export function makeAttributed(name: string, call: HostCall): SwiftValue | undefined {
  if (name === CONTAINER_TYPE) return call.args.length ? undefined : { kind: 'struct', typeName: CONTAINER_TYPE, fields: new Map() }
  const given = call.args[0]
  const copied = asAttributed(given?.value)
  if (copied) return attributed(runsOf(copied))
  if (given?.value.kind !== 'string') return undefined
  const words = given.value.value
  if (given.label === null) return attributed([new Map([['text', str(words)], ...asAttributed(call.args[1]?.value, CONTAINER_TYPE)?.fields ?? []])])
  if (given.label !== 'markdown' && given.label !== 'localized') return undefined
  return attributed((markdownSpans(words) ?? [{ text: words }]).map((span) => new Map<string, SwiftValue>([
    ['text', str(span.text)],
    ...Object.keys(span).filter((name) => name !== 'text').map((name): [string, SwiftValue] => [`_${name}`, { kind: 'bool', value: true }]),
  ])))
}

/** `a + b`: the runs of both, each keeping what was written on its own string. */
export function joinAttributed(left: SwiftValue, right: SwiftValue): SwiftValue | undefined {
  const a = asAttributed(left), b = asAttributed(right)
  return a && b ? attributed([...runsOf(a), ...runsOf(b)]) : undefined
}

/**
 * The members that change a string in place: `append(more)`, `mergeAttributes(container)`,
 * which writes the container's attributes over each run's, and `setAttributes(container)`,
 * which leaves each run only the container's.
 */
export function changeAttributed(target: SwiftValue, member: string, call: HostCall): SwiftValue | undefined {
  const into = asAttributed(target)
  const given = call.args[0]?.value
  const more = member === 'append' ? asAttributed(given) : asAttributed(given, CONTAINER_TYPE)
  if (!into || !more || !['append', 'mergeAttributes', 'setAttributes'].includes(member)) return undefined
  replaceRuns(into, member === 'append' ? [...runsOf(into), ...runsOf(more)]
    : runsOf(into).map((run) => new Map([...member === 'setAttributes' ? [['text', run.get('text')!] as const] : run, ...more.fields])))
  return { kind: 'void' }
}

/** The attributes a string may be given; one it wasn't given reads as nil. */
const ATTRIBUTES = new Set(['font', 'foregroundColor', 'backgroundColor', 'underlineStyle', 'strikethroughStyle', 'kern', 'tracking', 'baselineOffset', 'link', 'inlinePresentationIntent'])

/**
 * `text.characters`, its words, which count and read as a String's do, an attribute not
 * set, and `text.swiftUI`, the scope SwiftUI's attributes are written through, which is the
 * string itself (`isSelfMember`).
 */
export function attributedMember(target: SwiftValue, member: string): SwiftValue | undefined {
  const text = asAttributed(target)
  if (!text) return undefined
  if (member === 'characters') return str(wordsOfAll(text))
  if (member === 'swiftUI') return text
  return ATTRIBUTES.has(member) ? NIL : undefined
}

/** Whether `member` of `target` is `target` itself under a scope's name: `text.swiftUI.font`. */
export function isAttributeScope(target: SwiftValue, member: string): boolean {
  return member === 'swiftUI' && isAttributed(target)
}

function wordsOfAll(value: Struct): string {
  return runsOf(value).map(wordsOf).join('')
}

/** `text.range(of: "terms")`: where the words first are, or nil. */
export function attributedRange(target: SwiftValue, call: HostCall): SwiftValue | undefined {
  const words = call.args[0]?.label === 'of' ? call.args[0].value : undefined
  const text = asAttributed(target)
  if (!text || words?.kind !== 'string') return undefined
  const lower = wordsOfAll(text).indexOf(words.value)
  return lower < 0 ? NIL : { kind: 'range', lower, upper: lower + words.value.length, closed: false }
}

/** A substring's attributes, each written as it is set to the runs of the string it covers. */
class WrittenThrough extends Map<string, SwiftValue> {
  constructor(private readonly write: (name: string, value: SwiftValue) => void) { super() }
  override set(name: string, value: SwiftValue): this {
    this.write(name, value)
    return super.set(name, value)
  }
}

/**
 * `text[range]`: the words in the range, whose attributes are written through to the
 * runs of `text` they cover, split at the range's ends: `text[range].font = .headline`.
 */
export function attributedSlice(target: SwiftValue, index: SwiftValue): SwiftValue | undefined {
  const text = asAttributed(target)
  if (!text || index.kind !== 'range') return undefined
  const fields = new WrittenThrough((name, value) => {
    const runs: Run[] = []
    let at = 0
    for (const run of runsOf(text)) {
      const words = wordsOf(run), end = at + words.length
      const from = Math.max(at, index.lower), to = Math.min(end, index.upper + (index.closed ? 1 : 0))
      const part = (a: number, b: number, set?: true) => { if (b > a) runs.push(new Map([...run, ['text', str(words.slice(a - at, b - at))], ...set ? [[name, value] as const] : []])) }
      if (from >= to) runs.push(run)
      else { part(at, from); part(from, to, true); part(to, end) }
      at = end
    }
    replaceRuns(text, runs)
  })
  return { kind: 'struct', typeName: 'AttributedSubstring', fields, reference: true }
}

function wordsOf(run: Run): string {
  const text = run.get('text')
  return text?.kind === 'string' ? text.value : ''
}

/** The modifier each mark draws as, Markdown's and an inline presentation intent's. */
const MARKS: readonly (readonly [string, string, string])[] = [['bold', 'stronglyEmphasized', 'bold'], ['italic', 'emphasized', 'italic'], ['code', 'code', 'monospaced'], ['strike', 'strikethrough', 'strikethrough']]

/**
 * The modifiers marks draw as on a `Text` (Wave 6a), shared by a literal title's Markdown
 * and `AttributedString`: bold, italic, monospaced and struck through, and a link in the
 * tint, as iOS 27 draws them (docs/parity/native/iphone18pro-text).
 */
export function markModifiers(has: (mark: string, intent: string) => unknown, span: ViewValue['span'], tint: SwiftValue): ModifierValue[] {
  const out: ModifierValue[] = []
  for (const [mark, intent, name] of MARKS) if (has(mark, intent)) out.push({ name, args: [], span, closure: null })
  if (has('link', '')) out.push({ name: 'foregroundStyle', args: [{ label: null, value: tint }], span, closure: null })
  return out
}

/** The modifier each attribute draws as, on a `Text` of the run's words. */
const ATTRIBUTE_MODIFIERS: Readonly<Record<string, string>> = {
  foregroundColor: 'foregroundColor', font: 'font', underlineStyle: 'underline', strikethroughStyle: 'strikethrough',
  kern: 'kerning', tracking: 'tracking', baselineOffset: 'baselineOffset',
}

/** The intents a run's `inlinePresentationIntent` holds: one, or a set of them. */
function intentsOf(run: Run): string[] {
  const value = run.get('inlinePresentationIntent')
  return (value?.kind === 'array' ? value.elements : value ? [value] : []).map((v) => v.kind === 'opaque' && v.typeName === TOKEN_TYPE ? (v.payload as TokenPayload).name : '')
}

/** `Text(attributed)`: a `Text` of one run per run, as `+` builds it. */
export function attributedText(value: SwiftValue, span: ViewValue['span'], view: (v: ViewValue) => SwiftValue, tint: SwiftValue): SwiftValue {
  const children = runsOf(asAttributed(value)!).map((run): ViewValue => {
    const modifiers: ModifierValue[] = []
    for (const [name, attribute] of run) {
      const modifier = ATTRIBUTE_MODIFIERS[name]
      if (modifier && attribute.kind !== 'nil') modifiers.push({ name: modifier, args: attribute.kind === 'bool' ? [] : [{ label: null, value: attribute } satisfies ViewArg], span, closure: null })
    }
    // After the attributes, so a link's tint is drawn over a foregroundColor, as iOS does.
    const intents = intentsOf(run), link = run.get('link')
    modifiers.push(...markModifiers((mark, intent) => run.has(`_${mark}`) || intents.includes(intent) || (mark === 'link' && link !== undefined && link.kind !== 'nil'), span, tint))
    return { name: 'Text', args: [{ label: null, value: str(wordsOf(run)) }], children: [], modifiers, action: null, span }
  })
  return view({ name: 'Text', args: [], children, modifiers: [], action: null, span })
}
