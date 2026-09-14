'use client'

import { fileBasename } from '@studio/project-model'
import type { FileId } from '@studio/shared'

export interface TabBarProps {
  openFileIds: readonly FileId[]
  activeFileId: FileId | null
  filesWithErrors: ReadonlySet<FileId>
  onSelect: (fileId: FileId) => void
  onClose: (fileId: FileId) => void
}

export function TabBar({
  openFileIds,
  activeFileId,
  filesWithErrors,
  onSelect,
  onClose,
}: TabBarProps) {
  if (openFileIds.length === 0) return null

  return (
    <div
      role="tablist"
      data-testid="tab-bar"
      className="flex shrink-0 items-stretch overflow-x-auto border-b border-white/5 bg-[#141418]"
    >
      {openFileIds.map((fileId) => {
        const active = fileId === activeFileId
        return (
          <div
            key={fileId}
            className={`group flex items-center gap-1.5 border-r border-white/5 pl-3 pr-1.5 text-[12px] transition-colors ${
              active ? 'bg-[#1c1c22] text-zinc-100' : 'text-zinc-500 hover:bg-white/5'
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(fileId)}
              className="flex items-center gap-1.5 py-1.5"
            >
              {filesWithErrors.has(fileId) ? (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" aria-hidden />
              ) : null}
              {fileBasename(fileId)}
            </button>

            <button
              type="button"
              onClick={() => onClose(fileId)}
              aria-label={`Close ${fileBasename(fileId)}`}
              className="rounded px-1 text-zinc-600 opacity-40 transition-opacity hover:bg-white/10 hover:text-zinc-200 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
