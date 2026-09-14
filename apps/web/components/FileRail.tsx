'use client'

import { useEffect, useRef, useState } from 'react'
import { fileBasename } from '@studio/project-model'
import { TEMPLATES } from '@studio/project-model'
import type { FileId, SourceFile } from '@studio/shared'

export interface FileRailProps {
  files: readonly SourceFile[]
  activeFileId: FileId | null
  /** Files with a diagnostic, so the rail can mark them without opening each one. */
  filesWithErrors: ReadonlySet<FileId>
  onSelect: (fileId: FileId) => void
  onCreate: (name: string) => void
  onRename: (fileId: FileId, name: string) => void
  onDelete: (fileId: FileId) => void
  onApplyTemplate: (templateId: string) => void
}

export function FileRail({
  files,
  activeFileId,
  filesWithErrors,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onApplyTemplate,
}: FileRailProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<FileId | null>(null)

  return (
    <nav
      className="flex h-full w-56 shrink-0 flex-col border-r border-white/5 bg-[#101014]"
      data-testid="file-rail"
    >
      <header className="flex items-center justify-between px-3 py-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Sources</h2>
        <button
          type="button"
          onClick={() => setDraft('')}
          title="New file"
          aria-label="New file"
          data-testid="new-file"
          className="rounded px-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
        >
          +
        </button>
      </header>

      <ul className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {files.map((file) => {
          const active = file.id === activeFileId
          if (renaming === file.id) {
            return (
              <li key={file.id}>
                <NameInput
                  initial={fileBasename(file.id)}
                  onCommit={(name) => {
                    setRenaming(null)
                    onRename(file.id, name)
                  }}
                  onCancel={() => setRenaming(null)}
                  testId="rename-input"
                />
              </li>
            )
          }

          return (
            <li key={file.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(file.id)}
                onDoubleClick={() => setRenaming(file.id)}
                aria-current={active ? 'true' : undefined}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition-colors ${
                  active ? 'bg-sky-500/15 text-sky-200' : 'text-zinc-400 hover:bg-white/5'
                }`}
              >
                <SwiftGlyph error={filesWithErrors.has(file.id)} />
                <span className="truncate">{fileBasename(file.id)}</span>
              </button>

              {files.length > 1 ? (
                <button
                  type="button"
                  onClick={() => onDelete(file.id)}
                  title={`Delete ${fileBasename(file.id)}`}
                  aria-label={`Delete ${fileBasename(file.id)}`}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1.5 text-zinc-600 opacity-40 transition hover:bg-white/10 hover:text-red-300 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
                >
                  ×
                </button>
              ) : null}
            </li>
          )
        })}

        {draft !== null ? (
          <li>
            <NameInput
              initial=""
              placeholder="NewView.swift"
              onCommit={(name) => {
                setDraft(null)
                onCreate(name)
              }}
              onCancel={() => setDraft(null)}
              testId="new-file-input"
            />
          </li>
        ) : null}
      </ul>

      <div className="border-t border-white/5 p-2">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
          Start from a template
        </label>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onApplyTemplate(e.target.value)
          }}
          data-testid="template-select"
          className="mt-1.5 w-full rounded border border-white/10 bg-[#1c1c22] px-2 py-1 text-[11px] text-zinc-300 outline-none focus:border-sky-500"
        >
          <option value="">Choose…</option>
          {TEMPLATES.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[10px] leading-snug text-zinc-600">
          Replaces the current project.
        </p>
      </div>
    </nav>
  )
}

function NameInput({
  initial,
  placeholder,
  onCommit,
  onCancel,
  testId,
}: {
  initial: string
  placeholder?: string
  onCommit: (name: string) => void
  onCancel: () => void
  testId: string
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      value={value}
      placeholder={placeholder}
      data-testid={testId}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          if (value.trim()) onCommit(value)
          else onCancel()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
      // Committing on blur would lose the name whenever focus moves for any other
      // reason; cancelling is recoverable, a silently dropped rename is not.
      onBlur={onCancel}
      className="w-full rounded border border-sky-500/60 bg-[#1c1c22] px-2 py-1.5 text-[12px] text-zinc-100 outline-none"
    />
  )
}

function SwiftGlyph({ error }: { error: boolean }) {
  return (
    <span
      className={`grid h-4 w-4 shrink-0 place-items-center rounded-[3px] text-[8px] font-bold ${
        error ? 'bg-red-500/25 text-red-300' : 'bg-orange-500/20 text-orange-400'
      }`}
      title={error ? 'This file has problems' : undefined}
    >
      S
    </span>
  )
}
