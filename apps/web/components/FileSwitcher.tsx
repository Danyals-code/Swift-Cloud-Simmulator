'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { fileBasename } from '@studio/project-model'
import type { FileId, SourceFile } from '@studio/shared'

export interface FileSwitcherProps {
  files: readonly SourceFile[]
  onSelect: (fileId: FileId) => void
  onClose: () => void
}

/**
 * Ctrl+P file switcher.
 *
 * Subsequence matching rather than substring, so `cv` finds `ContentView.swift` -
 * the behaviour every editor's quick-open has trained people to expect, and the
 * reason the feature is worth having over the file list.
 *
 * Rendered only while open, so each invocation is a fresh mount. Keeping it mounted
 * and clearing the query in an effect is a state reset masquerading as a side effect,
 * which React now flags - and mounting is what "this dialog is open" actually means.
 */
export function FileSwitcher({ files, onSelect, onClose }: FileSwitcherProps) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const matches = useMemo(() => {
    if (query.trim().length === 0) return files
    return files
      .map((file) => ({ file, score: subsequenceScore(fileBasename(file.id), query) }))
      .filter((entry) => entry.score !== null)
      .sort((a, b) => a.score! - b.score!)
      .map((entry) => entry.file)
  }, [files, query])

  const choose = (index: number) => {
    const file = matches[index]
    if (file) onSelect(file.id)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onClick={onClose}
      data-testid="file-switcher"
    >
      <div
        className="w-[min(520px,90vw)] overflow-hidden rounded-lg border border-white/10 bg-[#17171c] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          placeholder="Go to file…"
          data-testid="file-switcher-input"
          onChange={(e) => {
            setQuery(e.target.value)
            setHighlight(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'Enter') {
              e.preventDefault()
              choose(highlight)
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHighlight((h) => Math.min(h + 1, matches.length - 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlight((h) => Math.max(h - 1, 0))
            }
          }}
          className="w-full border-b border-white/10 bg-transparent px-4 py-3 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600"
        />

        <ul className="max-h-[50vh] overflow-auto py-1">
          {matches.length === 0 ? (
            <li className="px-4 py-2 text-[12px] text-zinc-600">No matching files.</li>
          ) : (
            matches.map((file, index) => (
              <li key={file.id}>
                <button
                  type="button"
                  onClick={() => onSelect(file.id)}
                  onMouseEnter={() => setHighlight(index)}
                  className={`flex w-full items-baseline gap-2 px-4 py-1.5 text-left text-[12px] ${
                    index === highlight ? 'bg-sky-500/15 text-sky-100' : 'text-zinc-300'
                  }`}
                >
                  <span>{fileBasename(file.id)}</span>
                  <span className="truncate text-[11px] text-zinc-600">{file.id}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}

/**
 * Scores a subsequence match. Lower is better; null means no match.
 *
 * The score is the span the match occupies, so a tight run of characters beats one
 * scattered across the name - `cv` should rank `CView.swift` above
 * `ContentViewModel.swift`.
 */
function subsequenceScore(candidate: string, query: string): number | null {
  const haystack = candidate.toLowerCase()
  const needle = query.toLowerCase().replace(/\s+/g, '')

  let index = 0
  let first = -1
  let last = -1

  for (const char of needle) {
    const found = haystack.indexOf(char, index)
    if (found === -1) return null
    if (first === -1) first = found
    last = found
    index = found + 1
  }

  return first === -1 ? null : last - first
}
