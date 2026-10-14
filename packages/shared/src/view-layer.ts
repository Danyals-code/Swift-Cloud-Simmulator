import type { SourceSpan } from './source'

/** A user component call site that contributed this evaluated content. */
export interface ComponentSource {
  readonly name: string
  readonly source: SourceSpan
  /** A helper of a view, `header` or `stats(count:)`, rather than a view of its own (Wave 3a). */
  readonly helper?: true
}

/** Serializable, evaluated SwiftUI hierarchy. Never contains executable closures. */
export interface ViewLayer {
  readonly id: string
  readonly name: string
  readonly type: string
  readonly source?: SourceSpan
  /** Outer-to-inner component call sites; distinct instances retain distinct spans. */
  readonly componentSources?: readonly ComponentSource[]
  readonly children: readonly ViewLayer[]
  /** Only page selection has an action; selecting a control never activates it. */
  readonly page?: { readonly active: boolean; readonly handlerId?: string; /** A tab's SF Symbol. */ readonly icon?: string }
}
