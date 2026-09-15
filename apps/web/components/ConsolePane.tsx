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

const MONO =
  'font-[ui-monospace,"SF_Mono",SFMono-Regular,Menlo,"JetBrains_Mono",Consolas,monospace]'

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
      <header className="flex h-[26px] shrink-0 items-center gap-0.5 border-b border-black/30 bg-xc-bar px-1.5">
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

        {tab === 'problems' || tab === 'console' ? (
          <span className="ml-auto flex h-[18px] min-w-0 items-center gap-1.5 rounded-[5px] border border-white/10 bg-black/25 px-1.5">
            <Icon name="filter" size={11} className="shrink-0 text-xc-text-3" />
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
              className="w-[130px] min-w-0 bg-transparent text-[11px] text-xc-text placeholder:text-xc-text-3"
            />
          </span>
        ) : null}
      </header>

      <div className={`min-h-0 flex-1 overflow-auto px-1.5 py-1 text-[11.5px] ${MONO}`}>
        {workerError ? (
          <p className="mb-1.5 rounded-[5px] border border-xc-error/30 bg-xc-error/10 px-2 py-1.5 text-xc-error">
            Compiler worker: {workerError}
            <span className="block opacity-70">It will be restarted on your next edit.</span>
          </p>
        ) : null}

        {tab === 'problems' ? (
          diagnostics.length === 0 ? (
            <Empty>No problems.</Empty>
          ) : shownDiagnostics.length === 0 ? (
            <Empty>No problems match “{filter}”.</Empty>
          ) : (
            <ul>
              {shownDiagnostics.map((d, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onRevealSpan(d.span.file, d.span.start)}
                    className="flex w-full items-start gap-2 rounded-[4px] px-1.5 py-[3px] text-left transition-colors hover:bg-white/[0.06]"
                  >
                    <Icon
                      name={d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info'}
                      size={12}
                      weight={2}
                      className={`mt-[2px] shrink-0 ${SEVERITY_TONE[d.severity]}`}
                    />
                    <span className="min-w-0 flex-1 leading-snug">
                      <span className="text-xc-text">{d.message}</span>
                      <span className="ml-2 text-xc-text-3">{d.code}</span>
                    </span>
                    <span className="shrink-0 pl-2 text-xc-text-3">
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
            <Empty>Nothing logged. `print()` output will appear here.</Empty>
          ) : shownLogs.length === 0 ? (
            <Empty>No output matches “{filter}”.</Empty>
          ) : (
            <ul>
              {shownLogs.map((log, i) => (
                <li key={i} className="flex gap-2 px-1.5 py-[2px] leading-snug">
                  <span className="shrink-0 text-xc-text-3">{log.at.toFixed(1)}ms</span>
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
            <Timings timings={result.timings} />
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
    <div className="px-1.5 py-1">
      {stages.map(([label, value]) => (
        <div key={label} className="flex items-center gap-2 py-[2px]">
          <span className="w-16 shrink-0 text-xc-text-3">{label}</span>
          <span className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
            <span
              className={`block h-full rounded-full ${value > 40 ? 'bg-xc-warn' : 'bg-xc-accent'}`}
              style={{ width: `${Math.max(1.5, (value / peak) * 100)}%` }}
            />
          </span>
          <span className="w-[68px] shrink-0 text-right text-xc-text">{value.toFixed(2)} ms</span>
        </div>
      ))}

      <div className="mt-1.5 flex items-center gap-2 border-t border-white/[0.08] pt-1.5">
        <span className="w-16 shrink-0 text-xc-text-3">total</span>
        <span className="min-w-0 flex-1" />
        <span
          className={`w-[68px] shrink-0 text-right ${
            timings.total > 120 ? 'text-xc-warn' : 'text-xc-text'
          }`}
        >
          {timings.total.toFixed(2)} ms
        </span>
      </div>
      <p className="mt-1.5 px-0 text-[10.5px] text-xc-text-3">
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
      <p className="px-1.5 py-1 text-xc-text-3">
        {entries.length} feature{entries.length === 1 ? '' : 's'} the preview could not draw,{' '}
        {total} time{total === 1 ? '' : 's'}. Counted locally; never sent anywhere.
      </p>

      <ul>
        {entries.map((entry) => (
          <li
            key={entry.feature}
            className="flex items-center gap-2 rounded-[4px] px-1.5 py-[3px] hover:bg-white/[0.06]"
          >
            <span className="w-8 shrink-0 text-right text-xc-warn">{entry.count}</span>
            <span className="min-w-0 flex-1 truncate text-xc-text">{entry.feature}</span>
            <span className="shrink-0 text-xc-text-3">{entry.kind}</span>
            <span className="w-16 shrink-0 text-right text-xc-text-3">
              {entry.phase === null ? 'unplanned' : `phase ${entry.phase}`}
            </span>
          </li>
        ))}
      </ul>

      <span className="mt-2 inline-block">
        <ToolButton icon="refresh" label="Clear counts" onClick={clearCoverage} size={12} />
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
      className={`flex h-[18px] items-center gap-1.5 rounded-[5px] px-2 text-[11.5px] transition-colors ${
        active ? 'bg-white/[0.14] text-xc-text' : 'text-xc-text-3 hover:text-xc-text-2'
      }`}
    >
      {children}
    </button>
  )
}

function Badge({ tone, children }: { tone: 'error' | 'warning' | 'quiet'; children: React.ReactNode }) {
  const style =
    tone === 'error'
      ? 'bg-xc-error/25 text-xc-error'
      : tone === 'warning'
        ? 'bg-xc-warn/25 text-xc-warn'
        : 'bg-white/10 text-xc-text-3'
  return <span className={`rounded-full px-1 text-[9px] leading-[13px] ${style}`}>{children}</span>
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-1.5 py-1 text-xc-text-3">{children}</p>
}
