import type { SourceSpan } from './source'

/**
 * The five kinds of design token.
 *
 * Spacing and radius are both `CGFloat` in Swift and are kept apart by name - spacing
 * tokens start with `space`, radius tokens with `radius` - so a corner field can offer
 * only corner values and the two never collide.
 */
export type StyleKind = 'color' | 'spacing' | 'radius' | 'font' | 'shadow'

/** A font token's recipe: a Dynamic Type style, optionally with its own size and weight. */
export interface FontTokenValue {
  readonly style: string
  readonly size?: number
  readonly weight?: string
}

/** A shadow token's recipe, as `ShadowToken(color:radius:x:y:)` takes it. */
export interface ShadowTokenValue {
  /** A system colour name (`black`) or `#RRGGBB`. */
  readonly color: string
  readonly opacity: number
  readonly radius: number
  readonly x: number
  readonly y: number
}

export interface SharedStyle {
  /** The Swift member name, which is also the name the designer sees. */
  readonly name: string
  readonly kind: StyleKind
  /** A one-line value for lists: `#0A84FF`, `16`, `Headline · 17 pt · Semibold`. */
  readonly value: string
  readonly source: SourceSpan
  readonly uses: readonly SourceSpan[]
  /**
   * `token` is a static member of a framework type, written in `Tokens.swift` and read
   * as `.name`. `legacy` is an older global or static `let`, read by its plain name,
   * which still works everywhere and can be moved to `Tokens.swift` in one step.
   */
  readonly form?: 'token' | 'legacy'
  /** How a property refers to it: `.accent` for a token, `brandColor` for a legacy style. */
  readonly reference?: string
  /** Colour tokens backed by a colour set: its values per appearance. */
  readonly light?: string
  readonly dark?: string
  readonly font?: FontTokenValue
  readonly shadow?: ShadowTokenValue
}

export interface StyleProperty {
  readonly property: string
  readonly label: string
  readonly kind: StyleKind
  readonly token?: string
  readonly value?: string
}

/**
 * A token's full value, for creating or editing one.
 *
 * `value` alone is enough for spacing and radius (points) and for a colour with one
 * appearance. The optional fields carry what the richer kinds need.
 */
export interface TokenDefinition {
  readonly value: string
  readonly dark?: string
  readonly font?: FontTokenValue
  readonly shadow?: ShadowTokenValue
}

export type ResourceOperation =
  | { readonly kind: 'style-create-link'; readonly property: string; readonly name: string; readonly style: StyleKind; readonly value: string; readonly token?: TokenDefinition }
  | { readonly kind: 'style-create'; readonly name: string; readonly style: StyleKind; readonly value: string; readonly token?: TokenDefinition }
  | { readonly kind: 'style-edit'; readonly name: string; readonly value: string; readonly token?: TokenDefinition }
  | { readonly kind: 'style-link'; readonly property: string; readonly name: string }
  | { readonly kind: 'style-local'; readonly property: string; readonly value: string }
  /** Moves a legacy global style into `Tokens.swift` and rewrites every reference, in one step. */
  | { readonly kind: 'style-migrate'; readonly name: string }
  | { readonly kind: 'asset-references'; readonly from: string; readonly to: string | null }
  | { readonly kind: 'asset-use'; readonly name: string }

/**
 * Whether a colour set of this name is the one every Xcode app already has, AccentColor.
 * Asset catalogs don't tell names apart by letter case, so neither does this.
 */
export function isAccentColorSetName(name: string): boolean {
  return name.toLowerCase() === 'accentcolor'
}
