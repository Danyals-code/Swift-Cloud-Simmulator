import type { SourceSpan } from '@studio/shared'
import type { SwiftValue } from './values'
import { PreviewLimitExceeded } from './errors'

/** Browser preview limits, not restrictions on the exported Swift source. */
export const PREVIEW_LIMITS = {
  collectionElements: 100_000,
  stringLength: 1_000_000,
  copiedValues: 1_000_000,
  collectionViews: 1_000,
  totalViews: 10_000,
} as const

export function checkPreviewSize(size: number, maximum: number, what: string, span: SourceSpan): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > maximum) {
    throw new PreviewLimitExceeded(`${what} exceeds the preview limit of ${maximum.toLocaleString()}. Reduce the preview data; the source exports unchanged.`, span)
  }
}

/** Bound nested value copies before Array(repeating:) allocates them. */
export function checkRepeatedValue(value: SwiftValue, count: number, span: SourceSpan): void {
  if (count === 0) return
  let remaining = Math.floor(PREVIEW_LIMITS.copiedValues / count)
  const visit = (part: SwiftValue, depth: number): void => {
    if (--remaining < 0 || depth > 120) throw new PreviewLimitExceeded('Repeated nested values exceed the preview memory limit. Reduce the preview data.', span)
    if (part.kind === 'array') part.elements.forEach((child) => visit(child, depth + 1))
    else if (part.kind === 'tuple') part.elements.forEach((child) => visit(child, depth + 1))
    else if (part.kind === 'dictionary') part.entries.forEach((child) => visit(child, depth + 1))
    else if (part.kind === 'enum') part.associated.forEach((child) => visit(child, depth + 1))
    else if (part.kind === 'struct' && !part.reference) part.fields.forEach((child) => visit(child, depth + 1))
  }
  visit(value, 0)
}
