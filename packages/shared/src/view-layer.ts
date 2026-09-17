import type { SourceSpan } from './source'

/** Serializable, evaluated SwiftUI hierarchy. Never contains executable closures. */
export interface ViewLayer {
  readonly id: string
  readonly name: string
  readonly type: string
  readonly source?: SourceSpan
  readonly children: readonly ViewLayer[]
  /** Only page selection has an action; selecting a control never activates it. */
  readonly page?: { readonly active: boolean; readonly handlerId?: string }
}
