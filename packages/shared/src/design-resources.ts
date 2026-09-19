import type { SourceSpan } from './source'

export type StyleKind = 'color' | 'spacing' | 'font'
export interface SharedStyle {
  readonly name: string
  readonly kind: StyleKind
  readonly value: string
  readonly source: SourceSpan
  readonly uses: readonly SourceSpan[]
}
export interface StyleProperty {
  readonly property: string
  readonly label: string
  readonly kind: StyleKind
  readonly token?: string
  readonly value?: string
}
export type ResourceOperation =
  | { readonly kind: 'style-create-link'; readonly property: string; readonly name: string; readonly style: StyleKind; readonly value: string }
  | { readonly kind: 'style-create'; readonly name: string; readonly style: StyleKind; readonly value: string }
  | { readonly kind: 'style-edit'; readonly name: string; readonly value: string }
  | { readonly kind: 'style-link'; readonly property: string; readonly name: string }
  | { readonly kind: 'style-local'; readonly property: string; readonly value: string }
  | { readonly kind: 'asset-references'; readonly from: string; readonly to: string | null }
  | { readonly kind: 'asset-use'; readonly name: string }
