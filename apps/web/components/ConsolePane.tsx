'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CompileResult, Diagnostic } from '@studio/shared'
import { fileBasename } from '@studio/project-model'
import {
  clearCoverage,
  coverageRanking,
  subscribeCoverage,
  type CoverageEntry,
} from '../lib/telemetry'
import { Icon } from './ui/Icon'
import { ToolButton } from './ui/Control'

export interface ConsolePaneProps {
  result: CompileResult | null
  workerError: string | null
  /** Jump the editor to a diagnostic's source position, in whichever file it is in. */
  onRevealSpan: (file: string, start: number) => void
}

type Tab = 'problems' | 'console' | 'timings' | 'coverage'

/** One shared empty array, so "nothing yet" keeps a stable identity. */
const EMPTY: readonly never[] = []

/**
 * The debug area.
 *
 * Four tabs, and a filter over whichever is showing - which is the thing that
 * makes a console usable once a project is big enough to produce more than a
 * screenful. Xcode puts its filter bottom-right; this puts it in the header,
 * because the pane can be collapsed to two rows and a control on the last line
 * would be the first thing to disappear.
 */
export function ConsolePane({ result, workerError, onRevealSpan }: ConsolePaneProps) {
  const [tab, setTab] = useState<Tab>('problems')
  const [filter, setFilter] = useState('')

  // Stable identities: `result?.x ?? []` builds a new array every render, which
  // would make the memos below recompute on each one and defeat the point of them.
  const diagnostics = useMemo(() => result?.diagnostics ?? EMPTY, [result])
  const logs = useMemo(() => result?.logs ?? EMPTY, [result])

  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length

  const needle = filter.trim().toLowerCase()
  const shownDiagnostics = useMemo(
    () =>
      needle
        ? diagnostics.filter(
            (d) =>
              d.message.toLowerCase().includes(needle) ||
              d.code.toLowerCase().includes(needle) ||
              fileBasename(d.span.file).toLowerCase().includes(needle),
          )
        : diagnostics,
    [diagnostics, needle],
  )

  const shownLogs = useMemo(
    () => (needle ? logs.filter((log) => log.message.toLowerCase().includes(needle)) : logs),
    [logs, needle],
  )

  return (
    <section className="flex h-full min-h-0 flex-col bg-xc-editor" data-testid="console">
      <header className="flex h-9 shrink-0 items-center gap-3 border-b border-xc-line bg-xc-bar px-2">
        <div className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md bg-xc-fill p-0.5">
        <TabButton active={tab === 'problems'} onClick={() => setTab('problems')}>
          Problems
          {errors > 0 ? <Badge tone="error">{errors}</Badge> : null}
          {warnings > 0 ? <Badge tone="warning">{warnings}</Badge> : null}
        </TabButton>
        <TabButton active={tab === 'console'} onClick={() => setTab('console')}>
          Console
          {logs.length > 0 ? <Badge tone="quiet">{logs.length}</Badge> : null}
        </TabButton>
        <TabButton active={tab === 'timings'} onClick={() => setTab('timings')}>
          Timings
        </TabButton>
        <TabButton active={tab === 'coverage'} onClick={() => setTab('coverage')}>
          Coverage
        </TabButton>
        </div>

        {tab === 'problems' || tab === 'console' ? (
          <span className="relative ml-auto flex min-w-0 items-center">
            <Icon name="filter" size={12} className="pointer-events-none absolute left-2 text-xc-text-3" />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setFilter('')
              }}
              placeholder="Filter"
              spellCheck={false}
              aria-label="Filter output"
              data-testid="console-filter"
              className="h-6 w-40 min-w-0 pl-6"
            />
          </span>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {workerError ? (
          <p className="mx-2 mt-2 rounded-lg bg-xc-error/10 px-3 py-2 text-footnote text-xc-error">
            Compiler worker: {workerError}
            <span className="block text-xc-text-2">It will be restarted on your next edit.</span>
          </p>
        ) : null}

        {tab === 'problems' ? (
          diagnostics.length === 0 ? (
            <Empty>No problems.</Empty>
          ) : shownDiagnostics.length === 0 ? (
            <Empty>No problems match “{filter}”.</Empty>
          ) : (
            <ul className="p-1">
              {shownDiagnostics.map((d, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onRevealSpan(d.span.file, d.span.start)}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-body leading-5 transition-colors duration-[120ms] hover:bg-xc-fill"
                  >
                    <span className="flex h-5 shrink-0 items-center">
                      <Icon
                        name={d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info'}
                        size={14}
                        weight={1.75}
                        className={SEVERITY_TONE[d.severity]}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-xc-text">{d.message}</span>
                      <span className="ml-2 text-caption text-xc-text-3">{d.code}</span>
                    </span>
                    <span className="shrink-0 pl-2 text-caption leading-5 text-xc-text-3">
                      {fileBasename(d.span.file)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === 'console' ? (
          logs.length === 0 ? (
            <Empty>Nothing logged yet. Output from <code className="text-xc-text-2">print()</code> appears here.</Empty>
          ) : shownLogs.length === 0 ? (
            <Empty>No output matches “{filter}”.</Empty>
          ) : (
            <ul className="px-1 py-2 font-mono text-footnote">
              {shownLogs.map((log, i) => (
                <li key={i} className="flex gap-3 px-2 py-0.5 leading-[18px]">
                  <span className="shrink-0 tabular-nums text-xc-text-3">{log.at.toFixed(1)}ms</span>
                  <span className={log.level === 'error' ? 'text-xc-error' : 'text-xc-text'}>
                    {log.message}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === 'coverage' ? <CoveragePanel /> : null}

        {tab === 'timings' ? (
          !result ? (
            <Empty>No compile yet.</Empty>
          ) : (
            <div><Timings timings={result.timings} /><p className="px-4 pb-3 text-footnote text-xc-text-2">Text measurement: {!result.textMeasurement ? 'unavailable' : result.textMeasurement.provisional ? 'estimated in part' : 'measured'}</p></div>
          )
        ) : null}
      </div>
    </section>
  )
}

const SEVERITY_TONE: Record<Diagnostic['severity'], string> = {
  error: 'text-xc-error',
  warning: 'text-xc-warn',
  info: 'text-xc-accent',
}

/**
 * Per-stage timings, as bars rather than a column of numbers.
 *
 * The number that matters is not any one stage, it is which stage is the problem -
 * and that is a comparison, which a bar answers at a glance and five right-aligned
 * decimals do not.
 */
function Timings({ timings }: { timings: CompileResult['timings'] }) {
  const stages = [
    ['parse', timings.parse],
    ['check', timings.check],
    ['evaluate', timings.evaluate],
    ['layout', timings.layout],
  ] as const
  const peak = Math.max(...stages.map(([, value]) => value), 0.01)

  return (
    <div className="px-4 py-2 text-body tabular-nums">
      {stages.map(([label, value]) => (
        <div key={label} className="flex h-6 items-center gap-3">
          <span className="w-16 shrink-0 text-xc-text-2">{label}</span>
          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-xc-fill">
            <span
              className={`block h-full rounded-full ${value > 40 ? 'bg-xc-warn' : 'bg-xc-accent'}`}
              style={{ width: `${Math.max(1.5, (value / peak) * 100)}%` }}
            />
          </span>
          <span className="w-20 shrink-0 text-right text-xc-text">{value.toFixed(2)} ms</span>
        </div>
      ))}

      <div className="mt-1 flex h-7 items-center gap-3 border-t border-xc-line-soft pt-1">
        <span className="w-16 shrink-0 text-xc-text-2">total</span>
        <span className="min-w-0 flex-1" />
        <span
          className={`w-20 shrink-0 text-right font-semibold ${
            timings.total > 120 ? 'text-xc-warn' : 'text-xc-text'
          }`}
        >
          {timings.total.toFixed(2)} ms
        </span>
      </div>
      <p className="mt-1 text-footnote text-xc-text-3">
        Budget is 120 ms for the full pipeline; anything above it is reported rather than
        hidden.
      </p>
    </div>
  )
}

/**
 * The coverage ranking - what this browser has reached for and not found.
 *
 * Shown rather than shipped anywhere: there is no endpoint and no account, so the
 * only reader of these numbers is the person who generated them. That makes it both
 * the Phase 6 prioritisation instrument and an honest statement of what the tool
 * cannot yet do, in the user's own terms rather than a generic feature list.
 */
function CoveragePanel() {
  const [entries, setEntries] = useState<CoverageEntry[]>([])

  useEffect(() => {
    const refresh = () => setEntries(coverageRanking())
    refresh()
    return subscribeCoverage(refresh)
  }, [])

  if (entries.length === 0) {
    return (
      <Empty>
        Nothing missing so far. Anything the preview cannot draw is counted here, and the
        counts never leave this browser.
      </Empty>
    )
  }

  const total = entries.reduce((sum, entry) => sum + entry.count, 0)

  return (
    <div data-testid="coverage-panel">
      <p className="px-4 py-3 text-footnote text-xc-text-3">
        {entries.length} feature{entries.length === 1 ? '' : 's'} the preview could not draw,{' '}
        {total} time{total === 1 ? '' : 's'}. Counted locally; never sent anywhere.
      </p>

      <ul className="px-1">
        {entries.map((entry) => (
          <li
            key={entry.feature}
            className="flex h-7 items-center gap-3 rounded-md px-2 text-body transition-colors duration-[120ms] hover:bg-xc-fill"
          >
            <span className="w-8 shrink-0 text-right tabular-nums text-xc-warn">{entry.count}</span>
            <span className="min-w-0 flex-1 truncate text-xc-text">{entry.feature}</span>
            <span className="shrink-0 text-caption text-xc-text-3">{entry.kind}</span>
            <span className="w-20 shrink-0 text-right text-caption text-xc-text-3">
              {entry.recognised ? 'known gap' : 'unrecognised'}
            </span>
          </li>
        ))}
      </ul>

      <span className="mx-2 mb-2 mt-1 inline-block">
        <ToolButton icon="refresh" label="Clear counts" onClick={clearCoverage} size={14} />
      </span>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-6 items-center justify-center gap-1.5 rounded-[var(--radius-thumb)] px-2.5 text-body transition-[background-color,color,box-shadow] duration-[120ms] ${
        active ? 'bg-xc-thumb text-xc-text shadow-[var(--shadow-thumb)]' : 'text-xc-text-2 hover:text-xc-text'
      }`}
    >
      {children}
    </button>
  )
}

/** A count in a tab: Xcode's issue counts, the severity's glyph and a number; a plain chip otherwise. */
function Badge({ tone, children }: { tone: 'error' | 'warning' | 'quiet'; children: React.ReactNode }) {
  if (tone === 'quiet') {
    return <span className="rounded-sm bg-xc-fill px-1.5 text-caption tabular-nums text-xc-text-2">{children}</span>
  }
  return (
    <span className={`inline-flex items-center gap-0.5 text-caption tabular-nums ${tone === 'error' ? 'text-xc-error' : 'text-xc-warn'}`}>
      <Icon name={tone} size={12} weight={1.75} />
      {children}
    </span>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-3 text-footnote text-xc-text-3">{children}</p>
}
