import type { AuthoringOperation, ComponentDescription, ComponentInputKind } from './authoring-features'
import type { AuthoringSnapshot } from './authoring'
import type { PreviewColorAsset, SourceFile, ViewEdit } from './protocol'
import type { SourceSpan } from './source'

/** A control is a source recipe, not permission to replace an evaluated value. */
export interface DesignControl {
  readonly id: string
  readonly source: SourceSpan
  readonly label: string
  readonly group?: string
  /** A toggle is a switch for a Swift `true` or `false`, which are its values. */
  readonly kind: 'text' | 'number' | 'select' | 'toggle'
  readonly integer?: boolean
  readonly value: string
  /** What an empty text field shows: what iOS shows when nothing is written, as a search field's “Search” (Wave 4b). */
  readonly placeholder?: string
  /**
   * What a number is measured in, shown beside it. A `%` value is a share of one, as
   * `.opacity(0.5)` takes it: the field shows and takes it times 100, and the value, min
   * and max stay as Swift writes them.
   */
  readonly unit?: 'pt' | '%' | '°'
  /** How much one step changes a number, in the value's own terms as min and max are: 0.01 is 1%. */
  readonly step?: number
  /** A select's choices; for a number, the words it takes besides numbers, such as a stack's Spacing `auto` (D4). */
  readonly options?: readonly string[]
  /**
   * What a copy's input is to its Main (Wave 5b), for the picker it takes: a symbol's name, an
   * asset's name, or a colour as a system name (`red`), `#RRGGBB` or `#RRGGBBAA`, or a token as
   * written (`Color.brand`, `.brand`). Absent for any other input.
   */
  readonly inputKind?: 'symbol' | 'image' | 'color'
  /**
   * On a view's control in a Main (Wave 5b): the kind of input each copy can set that this value
   * can become, as `component-expose`'s `as`, for a value written plainly where it is read.
   * Absent anywhere else, and for a value Changeable per copy can't take.
   */
  readonly exposeAs?: Exclude<ComponentInputKind, 'shown'>
  /**
   * On a Text's words, or a Button's, Label's, Toggle's, Link's or NavigationLink's title,
   * written as a literal whose Markdown changes what iOS draws (Wave 6a), by `markdownSpans`.
   * Absent for `Text(verbatim:)`, a String, and marks iOS draws as written (`snake_case`).
   */
  readonly markdown?: true
  /** A visible control that cannot currently be changed safely. */
  readonly disabledReason?: string
  readonly min?: number
  readonly max?: number
  readonly scope: string
  readonly description: string
}

/**
 * The words of a text with values among them, as a `…:parts` control holds them (Wave 3a):
 * a JSON array that starts and ends with words and has the Swift of one value between each
 * pair, `["Total: ", "count", ""]`. Null for anything else.
 */
export function readTextParts(value: string): string[] | null {
  try {
    const parts: unknown = JSON.parse(value)
    return Array.isArray(parts) && parts.length % 2 === 1 && parts.every(part => typeof part === 'string') ? parts : null
  } catch { return null }
}

/** Words and values as a `…:parts` control holds them (`readTextParts`). */
export const writeTextParts = (parts: readonly string[]): string => JSON.stringify(parts)

/** The words and values of a control that holds them (`readTextParts`), or null for any other control. */
export function textPartsOf(control: Pick<DesignControl, 'id' | 'kind' | 'value'>): string[] | null {
  return control.kind === 'text' && control.id.endsWith(':parts') ? readTextParts(control.value) : null
}

export interface DesignEditRequest {
  readonly projectId: string
  readonly baseRevision: number
  readonly scope: string
  readonly deploymentTarget?: string
  readonly componentDescriptions?: readonly ComponentDescription[]
  readonly authoringRevision?: number
  readonly files: readonly SourceFile[]
  /** The project's colour sets, which colour tokens read and write. */
  readonly colors?: readonly PreviewColorAsset[]
  readonly target: SourceSpan
  readonly fingerprint?: string
  readonly operation: { readonly kind: 'property'; readonly control: string; readonly value: string } | ViewEdit | AuthoringOperation
}

export interface SourceChange {
  readonly file: string
  /** null means a newly created file. */
  readonly before: string | null
  readonly after: string
  /** The file is removed. `after` is then empty and ignored. */
  readonly deleted?: boolean
}

/** A place in the source: a file and an offset in it. */
export interface SourcePoint { readonly file: string; readonly offset: number }

export type DesignEditPlan =
  | {
    readonly ok: false
    readonly reason: string
    /** Where the reason is, when it is somewhere in the source: a syntax error, which Code can show. */
    readonly location?: SourcePoint
  }
  | {
    readonly ok: true
    readonly projectId: string
    readonly baseRevision: number
    readonly changes: readonly SourceChange[]
    /** The complete new list of colour sets, when the edit changes one. */
    readonly colorSets?: readonly PreviewColorAsset[]
    readonly authoring?: AuthoringSnapshot
    readonly selection: SourcePoint | null
  }
