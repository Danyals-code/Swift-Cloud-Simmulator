'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { searchCatalog, type ViewSnippet } from '../lib/viewCatalog'
import { Spotlight } from './Spotlight'
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
    <Spotlight label="Add a view" testId="add-view-palette" onClose={onClose}>{close => <>
        <header className={styles.field}>
          <Icon name="search" size={16} />
          <input
            value={query}
            data-testid="add-view-search"
            aria-label="Search views"
            placeholder="Add a view…"
            spellCheck={false}
            onChange={(event) => { setQuery(event.target.value); setActive(0) }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.max(0, Math.min(i + 1, results.length - 1))) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
              else if (event.key === 'Enter' && current) { event.preventDefault(); close(() => onChoose(current)) }
            }}
          />
          <span className={styles.target} data-testid="add-view-target">{target}</span>
        </header>

        <p className={styles.catalogNote}>Pick a view to add it. Select it afterwards to change it in the settings panel. Links set up navigation for you.</p>
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
              onClick={() => close(() => onChoose(snippet))}
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
      </>}</Spotlight>
  )
}
