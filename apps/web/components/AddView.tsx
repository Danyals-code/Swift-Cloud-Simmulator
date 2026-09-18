'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { searchCatalog, type ViewSnippet } from '../lib/viewCatalog'
import { Icon } from './ui/Icon'
import styles from './AddView.module.css'

interface Props {
  /** Where it will land, said in the words the canvas uses: "into VStack", "after Title". */
  target: string
  onChoose: (snippet: ViewSnippet) => void
  onClose: () => void
}

/**
 * The Add palette.
 *
 * A search field and a list, opened over the canvas and closed by the first choice.
 * It says where the view will land before anything is added, because "add" on a
 * canvas is ambiguous by nature - inside the thing I selected, or after it? - and a
 * palette that answers that in its header is one that never surprises.
 *
 * Keyboard first: the field takes focus, the arrows move the highlight, Return adds
 * the highlighted view and Escape leaves. That is the whole interaction for someone
 * who knows what they want, and the list is there for everyone else.
 */
export function AddView({ target, onChoose, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const results = useMemo(() => searchCatalog(query), [query])
  const current = results[Math.min(active, results.length - 1)]

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  return (
    <div className={styles.backdrop} data-testid="add-view-palette" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className={styles.palette} role="dialog" aria-label="Add a view" aria-modal="true">
        <header className={styles.field}>
          <Icon name="search" size={16} />
          <input
            autoFocus
            value={query}
            data-testid="add-view-search"
            aria-label="Search views"
            placeholder="Add a view…"
            spellCheck={false}
            onChange={(event) => { setQuery(event.target.value); setActive(0) }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); onClose() }
              else if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
              else if (event.key === 'Enter' && current) { event.preventDefault(); onChoose(current) }
            }}
          />
          <span className={styles.target} data-testid="add-view-target">{target}</span>
        </header>

        <div className={styles.list} ref={listRef} role="listbox" aria-label="Views">
          {results.map((snippet, index) => (
            <button
              key={snippet.id}
              type="button"
              role="option"
              aria-selected={index === active}
              data-active={index === active}
              data-testid={`add-view-${snippet.id}`}
              className={styles.row}
              onPointerMove={() => setActive(index)}
              onClick={() => onChoose(snippet)}
            >
              <span className={styles.name}>{snippet.name}</span>
              <span className={styles.hint}>{snippet.hint}</span>
              <span className={styles.group}>{snippet.group}</span>
            </button>
          ))}
          {!results.length ? <p className={styles.empty}>Nothing matches “{query}”.</p> : null}
        </div>

        <footer className={styles.footer}>
          <span>↑↓ to choose · ↩ to add · esc to close</span>
          <span>{results.length} of {searchCatalog('').length}</span>
        </footer>
      </div>
    </div>
  )
}
