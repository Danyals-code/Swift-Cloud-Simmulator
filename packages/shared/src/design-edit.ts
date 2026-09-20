import type { AuthoringOperation, ComponentDescription } from './authoring-features'
import type { AuthoringSnapshot } from './authoring'
import type { PreviewColorAsset, SourceFile, ViewEdit } from './protocol'
import type { SourceSpan } from './source'

/** A control is a source recipe, not permission to replace an evaluated value. */
export interface DesignControl {
  readonly id: string
  readonly source: SourceSpan
  readonly label: string
  readonly group?: string
  readonly kind: 'text' | 'number' | 'select'
  readonly value: string
  readonly options?: readonly string[]
  readonly min?: number
  readonly max?: number
  readonly scope: string
  readonly description: string
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

export type DesignEditPlan =
  | { readonly ok: false; readonly reason: string }
  | {
    readonly ok: true
    readonly projectId: string
    readonly baseRevision: number
    readonly changes: readonly SourceChange[]
    /** The complete new list of colour sets, when the edit changes one. */
    readonly colorSets?: readonly PreviewColorAsset[]
    readonly authoring?: AuthoringSnapshot
    readonly selection: { readonly file: string; readonly offset: number } | null
  }
