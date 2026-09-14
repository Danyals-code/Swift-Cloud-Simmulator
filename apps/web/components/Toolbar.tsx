'use client'

import { DEVICE_LIST, type DeviceKey } from '@studio/sim-shell'
import type { PreviewSettings } from '../lib/store'

export interface ToolbarProps {
  projectName: string
  device: DeviceKey
  preview: PreviewSettings
  savedAt: number | null
  busy: boolean
  inspecting: boolean
  onDeviceChange: (device: DeviceKey) => void
  onPreviewChange: (settings: Partial<PreviewSettings>) => void
  onToggleInspect: () => void
  onExport: () => void
  onResetState: () => void
}

/** Dynamic Type steps, matching the iOS accessibility slider's usable range. */
const TYPE_SCALES: readonly { label: string; value: number }[] = [
  { label: 'XS', value: 0.82 },
  { label: 'S', value: 0.91 },
  { label: 'M', value: 1 },
  { label: 'L', value: 1.12 },
  { label: 'XL', value: 1.35 },
  { label: 'XXL', value: 1.6 },
]

export function Toolbar({
  projectName,
  device,
  preview,
  savedAt,
  busy,
  inspecting,
  onDeviceChange,
  onPreviewChange,
  onToggleInspect,
  onExport,
  onResetState,
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

        <SegmentedToggle
          label="Appearance"
          testId="scheme-toggle"
          options={[
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' },
          ]}
          value={preview.colorScheme}
          onChange={(value) => onPreviewChange({ colorScheme: value as 'light' | 'dark' })}
        />

        <label className="flex items-center gap-1.5 text-zinc-500">
          <span className="sr-only">Dynamic Type size</span>
          <select
            value={String(preview.typeScale)}
            onChange={(e) => onPreviewChange({ typeScale: Number(e.target.value) })}
            title="Dynamic Type size"
            data-testid="type-scale-select"
            className="rounded border border-white/10 bg-[#1c1c22] px-2 py-1 text-zinc-300 outline-none focus:border-sky-500"
          >
            {TYPE_SCALES.map((step) => (
              <option key={step.label} value={step.value}>
                Text {step.label}
              </option>
            ))}
          </select>
        </label>

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
          onClick={onToggleInspect}
          aria-pressed={inspecting}
          data-testid="inspect-toggle"
          title="Inspect views (Ctrl+I)"
          className={`rounded border px-2.5 py-1 transition-colors ${
            inspecting
              ? 'border-sky-500 bg-sky-500/20 text-sky-200'
              : 'border-white/10 text-zinc-300 hover:bg-white/5'
          }`}
        >
          Inspect
        </button>

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

function SegmentedToggle({
  label,
  testId,
  options,
  value,
  onChange,
}: {
  label: string
  testId: string
  options: readonly { label: string; value: string }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-testid={testId}
      className="flex overflow-hidden rounded border border-white/10"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`px-2.5 py-1 transition-colors ${
            value === option.value
              ? 'bg-white/10 text-zinc-100'
              : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
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
