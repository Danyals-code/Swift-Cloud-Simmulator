'use client'

import { useMemo, useState } from 'react'
import { Spotlight } from './Spotlight'
import { Icon } from './ui/Icon'
import styles from './AddView.module.css'
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
  const matches = useMemo(() => {
    if (query.trim().length === 0) return files
    return files
      // Matched against the whole path, which is what the row shows: two screens in
      // different feature folders share a basename and nothing else.
      .map((file) => ({ file, score: subsequenceScore(fileBasename(file.id), query) ?? subsequenceScore(file.id, query) }))
      .filter((entry) => entry.score !== null)
      .sort((a, b) => a.score! - b.score!)
      .map((entry) => entry.file)
  }, [files, query])

  return (
    <Spotlight label="Go to file" testId="file-switcher" onClose={onClose}>{close => <>
      {/* The same search row, list and rows as Add a view: one palette, two catalogs. */}
      <header className={styles.field}>
        <Icon name="search" size={16} />
        <input
          value={query}
          placeholder="Go to file…"
          aria-label="Search files"
          data-testid="file-switcher-input"
          onChange={(e) => {
            setQuery(e.target.value)
            setHighlight(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              const file = matches[highlight]
              if (file) close(() => onSelect(file.id))
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHighlight((h) => Math.max(0, Math.min(h + 1, matches.length - 1)))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlight((h) => Math.max(h - 1, 0))
            }
          }}
        />
      </header>

      <ul className={styles.list}>
        {matches.length === 0 ? (
          <li className={styles.empty}>No matching files.</li>
        ) : (
          matches.map((file, index) => (
            <li key={file.id}>
              <button
                type="button"
                onClick={() => close(() => onSelect(file.id))}
                onMouseEnter={() => setHighlight(index)}
                data-active={index === highlight}
                className={styles.row}
              >
                <span className={styles.name}>{fileBasename(file.id)}</span>
                <span className={styles.hint}>{file.id}</span>
              </button>
            </li>
          ))
        )}
      </ul>
      <footer className={styles.footer}><span>↑↓ to choose · ↩ to open</span><span>esc to close</span></footer>
    </>}</Spotlight>
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
