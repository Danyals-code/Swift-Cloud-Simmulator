import type { SourceFile } from '@studio/shared'
import { Parser, type SourceFileNode } from '@studio/swift-syntax'
import {
  completionsAt,
  definitionAt,
  hoverAt,
  referencesAt,
  type CompletionResult,
  type SymbolInfo,
} from '@studio/swift-sema'

/**
 * The editor-facing half of the compiler worker.
 *
 * Stateless on purpose. Completion could reuse the parse from the last compile, but
 * the editor asks between compiles — that is the whole point of a debounce — so the
 * cached tree would be one keystroke stale exactly when it is consulted. Re-parsing
 * the project costs about a millisecond for a project this size, and a cache that is
 * right only between keystrokes is worse than no cache at all.
 *
 * It lives here rather than in the worker file so that the worker keeps importing
 * from one package, which is the Phase 0 boundary that has not moved in eight phases.
 */

function parseAll(files: readonly SourceFile[]): SourceFileNode[] {
  return files.map((file) => Parser.parse(file.text, file.id).sourceFile)
}

export function completionsFor(
  files: readonly SourceFile[],
  fileId: string,
  offset: number,
): CompletionResult {
  const text = files.find((f) => f.id === fileId)?.text ?? ''
  return completionsAt(parseAll(files), fileId, text, offset)
}

export function definitionFor(
  files: readonly SourceFile[],
  fileId: string,
  offset: number,
): SymbolInfo | null {
  const text = files.find((f) => f.id === fileId)?.text ?? ''
  return definitionAt(parseAll(files), fileId, text, offset)
}

export function hoverFor(
  files: readonly SourceFile[],
  fileId: string,
  offset: number,
): SymbolInfo | null {
  const text = files.find((f) => f.id === fileId)?.text ?? ''
  return hoverAt(parseAll(files), fileId, text, offset)
}

export function referencesFor(
  files: readonly SourceFile[],
  fileId: string,
  offset: number,
): readonly { file: string; start: number; end: number }[] {
  const text = files.find((f) => f.id === fileId)?.text ?? ''
  return referencesAt(text, offset, fileId)
}

export type { CompletionResult, SymbolInfo }
