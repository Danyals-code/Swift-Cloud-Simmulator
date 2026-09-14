'use client'

import { useEffect, useState } from 'react'
import type { CompileResult, Diagnostic } from '@studio/shared'
import {
  clearCoverage,
  coverageRanking,
  subscribeCoverage,
  type CoverageEntry,
} from '../lib/telemetry'

export interface ConsolePaneProps {
  result: CompileResult | null
  workerError: string | null
  /** Jump the editor to a diagnostic's source position. */
  onRevealSpan: (start: number) => void
}

type Tab = 'problems' | 'console' | 'timings' | 'coverage'

const SEVERITY_STYLE: Record<Diagnostic['severity'], string> = {
  error: 'text-red-400',
  warning: 'text-amber-400',
  info: 'text-sky-400',
}

const SEVERITY_GLYPH: Record<Diagnostic['severity'], string> = {
  error: '✕',
  warning: '▲',
  info: 'ℹ',
}

export function ConsolePane({ result, workerError, onRevealSpan }: ConsolePaneProps) {
  const [tab, setTab] = useState<Tab>('problems')

  const diagnostics = result?.diagnostics ?? []
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length

  return (
    <section className="flex h-full flex-col bg-[#141418] text-[12px]" data-testid="console">
      <header className="flex shrink-0 items-center gap-1 border-b border-white/5 px-2">
        <TabButton active={tab === 'problems'} onClick={() => setTab('problems')}>
          Problems
          {errors > 0 ? <Badge tone="error">{errors}</Badge> : null}
          {warnings > 0 ? <Badge tone="warning">{warnings}</Badge> : null}
        </TabButton>
        <TabButton active={tab === 'console'} onClick={() => setTab('console')}>
          Console
        </TabButton>
        <TabButton active={tab === 'timings'} onClick={() => setTab('timings')}>
          Timings
        </TabButton>
        <TabButton active={tab === 'coverage'} onClick={() => setTab('coverage')}>
          Coverage
        </TabButton>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-2 py-1.5 font-mono">
        {workerError ? (
          <p className="mb-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-red-300">
            Compiler worker: {workerError}
            <span className="block text-red-400/70">It will be restarted on your next edit.</span>
          </p>
        ) : null}

        {tab === 'problems' ? (
          diagnostics.length === 0 ? (
            <Empty>No problems.</Empty>
          ) : (
            <ul className="space-y-0.5">
              {diagnostics.map((d, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onRevealSpan(d.span.start)}
                    className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left hover:bg-white/5"
                  >
                    <span className={`${SEVERITY_STYLE[d.severity]} shrink-0`}>
                      {SEVERITY_GLYPH[d.severity]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-zinc-200">{d.message}</span>
                      <span className="ml-2 text-zinc-500">{d.code}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === 'console' ? (
          !result || result.logs.length === 0 ? (
            <Empty>Nothing logged. `print()` output will appear here.</Empty>
          ) : (
            <ul className="space-y-0.5">
              {result.logs.map((log, i) => (
                <li key={i} className="flex gap-2 px-1.5 py-0.5">
                  <span className="shrink-0 text-zinc-600">{log.at.toFixed(1)}ms</span>
                  <span className={log.level === 'error' ? 'text-red-400' : 'text-zinc-300'}>
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
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-1.5">
              {(
                [
                  ['parse', result.timings.parse],
                  ['check', result.timings.check],
                  ['evaluate', result.timings.evaluate],
                  ['layout', result.timings.layout],
                  ['total', result.timings.total],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-zinc-500">{label}</dt>
                  <dd className={value > 250 ? 'text-amber-400' : 'text-zinc-300'}>
                    {value.toFixed(2)} ms
                  </dd>
                </div>
              ))}
            </dl>
          )
        ) : null}
      </div>
    </section>
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
        Nothing missing so far. Anything the preview cannot draw is counted here, and
        the counts never leave this browser.
      </Empty>
    )
  }

  const total = entries.reduce((sum, entry) => sum + entry.count, 0)

  return (
    <div data-testid="coverage-panel">
      <p className="px-1.5 py-1 text-zinc-500">
        {entries.length} feature{entries.length === 1 ? '' : 's'} the preview could not
        draw, {total} time{total === 1 ? '' : 's'}. Counted locally; never sent anywhere.
      </p>

      <ul className="space-y-0.5">
        {entries.map((entry) => (
          <li
            key={entry.feature}
            className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-white/5"
          >
            <span className="w-8 shrink-0 text-right text-amber-400">{entry.count}</span>
            <span className="min-w-0 flex-1 truncate text-zinc-200">{entry.feature}</span>
            <span className="shrink-0 text-zinc-600">{entry.kind}</span>
            <span className="w-16 shrink-0 text-right text-zinc-500">
              {entry.phase === null ? 'unplanned' : `phase ${entry.phase}`}
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={clearCoverage}
        className="mt-2 rounded px-1.5 py-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
      >
        Clear counts
      </button>
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
      className={`flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 transition-colors ${
        active
          ? 'border-sky-400 text-zinc-100'
          : 'border-transparent text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {children}
    </button>
  )
}

function Badge({ tone, children }: { tone: 'error' | 'warning'; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-full px-1.5 text-[10px] leading-4 ${
        tone === 'error' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'
      }`}
    >
      {children}
    </span>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-1.5 py-1 text-zinc-600">{children}</p>
}
