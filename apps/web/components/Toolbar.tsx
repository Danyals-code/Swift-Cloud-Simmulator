'use client'

import { DEVICE_LIST, type DeviceKey } from '@studio/sim-shell'

export interface ToolbarProps {
  projectName: string
  device: DeviceKey
  savedAt: number | null
  busy: boolean
  onDeviceChange: (device: DeviceKey) => void
  onExport: () => void
  onResetState: () => void
  onResetTemplate: () => void
}

export function Toolbar({
  projectName,
  device,
  savedAt,
  busy,
  onDeviceChange,
  onExport,
  onResetState,
  onResetTemplate,
}: ToolbarProps) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-white/5 bg-[#141418] px-3 text-[12px]">
      <span className="flex items-center gap-2 font-semibold text-zinc-200">
        <span className="grid h-5 w-5 place-items-center rounded bg-gradient-to-br from-orange-500 to-rose-500 text-[10px] font-bold text-white">
          S
        </span>
        SwiftUI Web Studio
      </span>

      <span className="text-zinc-600">/</span>
      <span className="text-zinc-400" data-testid="project-name">
        {projectName}
      </span>

      <span className="ml-auto flex items-center gap-2">
        <SaveIndicator savedAt={savedAt} busy={busy} />

        <label className="flex items-center gap-1.5 text-zinc-500">
          <span className="sr-only">Device</span>
          <select
            value={device}
            onChange={(e) => onDeviceChange(e.target.value as DeviceKey)}
            className="rounded border border-white/10 bg-[#1c1c22] px-2 py-1 text-zinc-300 outline-none focus:border-sky-500"
            data-testid="device-select"
          >
            {DEVICE_LIST.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={onResetState}
          className="rounded border border-white/10 px-2.5 py-1 text-zinc-300 transition-colors hover:bg-white/5"
          title="Discard the preview's @State and re-run from scratch"
        >
          Reset state
        </button>

        <button
          type="button"
          onClick={onResetTemplate}
          className="rounded border border-white/10 px-2.5 py-1 text-zinc-300 transition-colors hover:bg-white/5"
          title="Replace the project with the starter template"
        >
          Reset code
        </button>

        <button
          type="button"
          onClick={onExport}
          className="rounded bg-sky-600 px-3 py-1 font-medium text-white transition-colors hover:bg-sky-500"
          data-testid="export-button"
        >
          Export .zip
        </button>
      </span>
    </header>
  )
}

function SaveIndicator({ savedAt, busy }: { savedAt: number | null; busy: boolean }) {
  const label = busy ? 'Compiling…' : savedAt ? 'Saved' : 'Not saved yet'
  return (
    <span
      className={`flex items-center gap-1.5 ${busy ? 'text-sky-400' : 'text-zinc-600'}`}
      data-testid="save-indicator"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${busy ? 'animate-pulse bg-sky-400' : savedAt ? 'bg-emerald-500' : 'bg-zinc-600'}`}
      />
      {label}
    </span>
  )
}
