'use client'

import { useEffect, useState } from 'react'
import { DEVICE_LIST, type DeviceKey } from '@studio/sim-shell'
import { EXPORT_FORMATS, type ExportFormat } from '@studio/shared'
import { Icon } from './ui/Icon'
import { MenuButton, PopupButton, type MenuItem } from './ui/Menu'
import { PaneToggles, PushButton, ToolButton } from './ui/Control'

export type PaneKey = 'navigator' | 'debug' | 'preview'

export interface ToolbarProps {
  projectName: string
  device: DeviceKey
  savedAt: number | null
  /** A compile is in flight and the tree on screen is from an older revision. */
  busy: boolean
  /** Live recompilation is suspended; edits are not being run. */
  paused: boolean
  errors: number
  warnings: number
  /** Total pipeline time of the last compile, in ms. */
  lastCompileMs: number | null
  workerError: string | null
  inspecting: boolean
  panes: ReadonlySet<PaneKey>
  /** Panes that are switched on but have no room in the current window. */
  suppressed: ReadonlySet<PaneKey>
  onTogglePane: (pane: PaneKey) => void
  onDeviceChange: (device: DeviceKey) => void
  /** Re-run the preview from scratch: drop every `@State` box and re-evaluate. */
  onRun: () => void
  onTogglePaused: () => void
  onToggleInspect: () => void
  onExport: (format: ExportFormat) => void
  /** Copies a share link, and reports what happened so the button can say it. */
  onShare: () => Promise<'copied' | 'too-large' | 'failed'>
}

const PANES: readonly { key: PaneKey; icon: 'sidebar-left' | 'sidebar-bottom' | 'sidebar-right'; label: string; title: string }[] = [
  { key: 'navigator', icon: 'sidebar-left', label: 'Navigator', title: 'Hide or show the navigator (⌘0)' },
  { key: 'debug', icon: 'sidebar-bottom', label: 'Debug area', title: 'Hide or show the debug area (⌘⇧Y)' },
  { key: 'preview', icon: 'sidebar-right', label: 'Preview', title: 'Hide or show the preview (⌘⌥↩)' },
]

/**
 * The toolbar.
 *
 * Laid out the way Xcode's is, because the arrangement carries meaning that a row
 * of equal buttons does not: what *runs* the thing is hard left, what the thing
 * currently *is* sits in the middle where nothing competes with it, and what
 * changes the *view* is hard right. The old toolbar had eight controls in a line
 * with the loudest colour on the least-used one.
 *
 * Preview settings - appearance, Dynamic Type, zoom - are deliberately not here.
 * They describe how you are looking at the simulated app rather than what the
 * project is, so they live on the preview pane's own bar, next to the thing they
 * affect.
 */
export function Toolbar({
  projectName,
  device,
  savedAt,
  busy,
  paused,
  errors,
  warnings,
  lastCompileMs,
  workerError,
  inspecting,
  panes,
  suppressed,
  onTogglePane,
  onDeviceChange,
  onRun,
  onTogglePaused,
  onToggleInspect,
  onExport,
  onShare,
}: ToolbarProps) {
  const devices: MenuItem[] = DEVICE_LIST.map((d) => ({
    value: d.key,
    label: d.name,
    detail: `${d.width}×${d.height}`,
  }))

  const formats: MenuItem[] = EXPORT_FORMATS.map((format) => ({
    value: format.id,
    label: format.name,
    detail: format.description,
  }))

  return (
    <header
      data-testid="toolbar"
      className="@container/toolbar flex h-[38px] shrink-0 items-center gap-2 overflow-hidden border-b border-xc-line bg-xc-bar px-2.5"
    >
      <span className="flex shrink-0 items-center gap-2 pr-1">
        <span className="grid h-[18px] w-[18px] place-items-center rounded-[5px] bg-gradient-to-b from-[#ff7a45] to-xc-swift text-[10px] font-bold text-white shadow-[0_1px_2px_rgb(0_0_0/0.4)]">
          S
        </span>
      </span>

      <ToolButton
        icon="run"
        label="Run"
        title="Run the preview from scratch, dropping its state (⌘R)"
        onClick={onRun}
        tone="text-xc-ok"
        testId="run-button"
      />
      <ToolButton
        icon="stop"
        label={paused ? 'Resume live preview' : 'Pause live preview'}
        title={
          paused
            ? 'Resume: run the preview again on every edit'
            : 'Pause: stop recompiling while you type'
        }
        onClick={onTogglePaused}
        active={paused}
        tone={paused ? 'text-xc-warn' : 'text-xc-error'}
        testId="pause-button"
        size={13}
      />

      <span className="mx-1 h-[18px] w-px shrink-0 bg-white/10" />

      {/*
        The scheme, as Xcode states it: what is being built, on what. One control
        rather than two naked dropdowns, because the two halves are read together.

        Hidden outright in a window too narrow for it rather than allowed to shrink
        to nothing: a flex item at zero width still *paints* its children, so the
        project name and the destination were drawing on top of the buttons to
        their right.
      */}
      <span className="hidden min-w-0 shrink items-center gap-1.5 overflow-hidden text-[12px] @[620px]/toolbar:flex">
        <span className="truncate font-medium text-xc-text" data-testid="project-name">
          {projectName}
        </span>
        <Icon name="chevron-right" size={10} className="text-xc-text-3" />
        <PopupButton
          items={devices}
          value={device}
          onChange={(value) => onDeviceChange(value as DeviceKey)}
          label="Destination"
          title="The device the preview is laid out for"
          testId="device-select"
        />
      </span>

      <StatusView
        busy={busy}
        paused={paused}
        errors={errors}
        warnings={warnings}
        savedAt={savedAt}
        lastCompileMs={lastCompileMs}
        workerError={workerError}
      />

      <span className="ml-auto flex shrink-0 items-center gap-2">
        <PushButton
          onClick={onToggleInspect}
          active={inspecting}
          label="Inspect views"
          title="Inspect views (⌘I)"
          testId="inspect-toggle"
          icon="inspect"
        >
          Inspect
        </PushButton>

        <ShareButton onShare={onShare} />

        {/*
          A split button. Four formats exist and almost everyone wants the same one,
          so the default stays a single click and the menu answers the question only
          for the people who actually have it.
        */}
        <span className="inline-flex h-[22px] items-stretch overflow-hidden rounded-[5px] border border-white/10 bg-white/[0.06]">
          <button
            type="button"
            onClick={() => onExport('xcodeproj')}
            data-testid="export-button"
            title="Export an .xcodeproj as a .zip"
            className="inline-flex items-center gap-1.5 px-2.5 text-[12px] leading-none text-xc-text transition-colors hover:bg-white/[0.12] active:bg-white/[0.18]"
          >
            <Icon name="download" size={13} />
            Export
          </button>
          <MenuButton
            items={formats}
            onSelect={(value) => onExport(value as ExportFormat)}
            label="Export format"
            title="Export in another format"
            testId="export-format"
            className="inline-flex w-[20px] items-center justify-center border-l border-white/10 text-xc-text-2 transition-colors hover:bg-white/[0.12] hover:text-xc-text active:bg-white/[0.18]"
          >
            <Icon name="chevron-down" size={10} />
          </MenuButton>
        </span>

        <span className="mx-0.5 h-[18px] w-px shrink-0 bg-white/10" />

        <PaneToggles
          options={PANES}
          shown={panes}
          suppressed={suppressed}
          onToggle={(key) => onTogglePane(key as PaneKey)}
        />
      </span>
    </header>
  )
}

/**
 * The activity view.
 *
 * Xcode's central status panel, and it is central for a reason: it is the one
 * thing in the window that answers "is my code all right?" without being asked.
 * The old toolbar reported that as a grey dot labelled "Saved", which answers a
 * different and much less interesting question.
 *
 * Save state is still in here, quietly, at the right - it matters exactly once,
 * when you are about to close the tab.
 */
function StatusView({
  busy,
  paused,
  errors,
  warnings,
  savedAt,
  lastCompileMs,
  workerError,
}: {
  busy: boolean
  paused: boolean
  errors: number
  warnings: number
  savedAt: number | null
  lastCompileMs: number | null
  workerError: string | null
}) {
  const state = workerError
    ? { tone: 'text-xc-error', icon: 'error' as const, text: 'Compiler stopped' }
    : paused
      ? { tone: 'text-xc-warn', icon: 'stop' as const, text: 'Paused' }
      : busy
        ? { tone: 'text-xc-text-2', icon: 'refresh' as const, text: 'Running…' }
        : errors > 0
          ? {
              tone: 'text-xc-error',
              icon: 'error' as const,
              text: `Failed · ${errors} ${errors === 1 ? 'error' : 'errors'}`,
            }
          : warnings > 0
            ? {
                tone: 'text-xc-warn',
                icon: 'warning' as const,
                text: `Succeeded · ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`,
              }
            : { tone: 'text-xc-text-2', icon: 'check' as const, text: 'Succeeded' }

  return (
    <div
      data-testid="status-view"
      className="mx-auto hidden h-[24px] w-[clamp(200px,26vw,420px)] shrink items-center gap-2 overflow-hidden rounded-[6px] border border-black/40 bg-black/25 px-2.5 text-[11px] shadow-[0_1px_0_rgb(255_255_255/0.04)_inset] @[900px]/toolbar:flex"
    >
      <span className={`flex items-center gap-1.5 ${state.tone}`}>
        <Icon name={state.icon} size={12} weight={2} className={busy ? 'animate-spin' : undefined} />
        <span className="whitespace-nowrap">{state.text}</span>
      </span>

      {lastCompileMs !== null && !busy && !workerError ? (
        <span className="hidden whitespace-nowrap text-xc-text-3 @[1060px]/toolbar:inline">
          {lastCompileMs.toFixed(1)} ms
        </span>
      ) : null}

      <span
        className="ml-auto hidden items-center gap-1.5 whitespace-nowrap text-xc-text-3 @[1180px]/toolbar:flex"
        data-testid="save-indicator"
      >
        <span
          className={`h-[5px] w-[5px] rounded-full ${savedAt ? 'bg-xc-ok/70' : 'bg-xc-text-3/60'}`}
        />
        {savedAt ? 'Saved' : 'Not saved yet'}
      </span>
    </div>
  )
}

/**
 * Copies a share link and says what happened, in place.
 *
 * The result has to be visible: a button that silently did nothing is
 * indistinguishable from one that worked, and the failure that matters - a project
 * too big for a URL - is invisible until someone pastes a truncated link. The
 * label reverts on its own, because a permanent "Copied" is a lie after the first
 * second.
 */
function ShareButton({ onShare }: { onShare: ToolbarProps['onShare'] }) {
  const [result, setResult] = useState<'copied' | 'too-large' | 'failed' | null>(null)

  useEffect(() => {
    if (!result) return
    const timer = setTimeout(() => setResult(null), 2600)
    return () => clearTimeout(timer)
  }, [result])

  const label =
    result === 'copied'
      ? 'Link copied'
      : result === 'too-large'
        ? 'Too big to link'
        : result === 'failed'
          ? 'Copy failed'
          : 'Share'

  return (
    <PushButton
      onClick={() => void onShare().then(setResult)}
      title="Copy a link that carries this project - no account, no server"
      testId="share-button"
      icon="share"
    >
      {label}
    </PushButton>
  )
}
