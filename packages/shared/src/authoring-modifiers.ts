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
  readonly capabilities: {
    readonly edit: boolean
    readonly remove: boolean
    readonly duplicate: boolean
    readonly moveUp: boolean
    readonly moveDown: boolean
    readonly reason?: string
  }
}
export interface ModifierCatalogEntry {
  readonly name: string
  readonly label: string
  readonly category: ModifierCategory
  readonly available: boolean
  readonly reason?: string
}
export type ModifierOperation =
  | { readonly kind: 'modifier-add'; readonly name: string; readonly before?: string }
  | { readonly kind: 'modifier-remove'; readonly modifier: string }
  | { readonly kind: 'modifier-duplicate'; readonly modifier: string }
  | { readonly kind: 'modifier-move'; readonly modifier: string; readonly toIndex: number }
