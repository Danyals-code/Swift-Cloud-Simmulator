import type { DesignControl } from './design-edit'
import type { SourceSpan } from './source'

export type ModifierCategory = 'layout' | 'appearance' | 'text' | 'behavior' | 'custom'
/** Every source occurrence has a separate, snapshot-local identity. */
export interface AuthoringModifier {
  readonly id: string
  readonly name: string
  readonly label: string
  readonly category: ModifierCategory
  readonly summary: string
  readonly expression: string
  readonly source: SourceSpan
  readonly controls: readonly DesignControl[]
  readonly propertyIds: readonly string[]
  /**
   * False when the modifier is switched off: commented out in place, with its exact
   * text kept in the comment, so switching it on restores it byte for byte.
   */
  readonly enabled?: boolean
  readonly capabilities: {
    readonly edit: boolean
    readonly remove: boolean
    readonly duplicate: boolean
    readonly moveUp: boolean
    readonly moveDown: boolean
    /** Can be switched off and on without deleting it. */
    readonly toggle?: boolean
    readonly reason?: string
  }
}
export interface ModifierCatalogEntry {
  readonly name: string
  readonly label: string
  readonly category: ModifierCategory
  readonly available: boolean
  readonly reason?: string
  /** A short line under the name in the Add menu: what it does, in plain words. */
  readonly description?: string
  /** An older spelling still accepted by name, never offered in the Add menu. */
  readonly hidden?: boolean
}
export type ModifierOperation =
  | { readonly kind: 'modifier-add'; readonly name: string; readonly before?: string }
  | { readonly kind: 'modifier-remove'; readonly modifier: string }
  | { readonly kind: 'modifier-duplicate'; readonly modifier: string }
  | { readonly kind: 'modifier-move'; readonly modifier: string; readonly toIndex: number }
  | { readonly kind: 'modifier-toggle'; readonly modifier: string; readonly enabled: boolean }
