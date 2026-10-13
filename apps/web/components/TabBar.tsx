'use client'

import { useState } from 'react'
import { NameField } from './Navigator'
import { fileBasename } from '@studio/project-model'
import type { FileId } from '@studio/shared'
import { Icon } from './ui/Icon'

export interface TabBarProps {
  openFileIds: readonly FileId[]
  activeFileId: FileId | null
  filesWithErrors: ReadonlySet<FileId>
  onSelect: (fileId: FileId) => void
  onClose: (fileId: FileId) => void
  onRenameFile: (fileId: FileId, name: string) => boolean
}

/**
 * The editor's tabs.
 *
 * Xcode's are full-height and share a single hairline between neighbours rather
 * than each carrying a border, which is why a row of them reads as one strip
 * instead of a row of chips. The selected tab is the editor's own surface and opens
 * into it: the strip's bottom rule is an inset shadow, which the tab's background
 * covers. The close control only appears under the pointer, so a wide row of tabs
 * is a row of filenames rather than a row of ✕.
 */
export function TabBar({
  openFileIds,
  activeFileId,
  filesWithErrors,
  onSelect,
  onClose,
  onRenameFile,
}: TabBarProps) {
  const [editing, setEditing] = useState<FileId | null>(null)
  if (openFileIds.length === 0) return null

  return (
    <div
      role="tablist"
      data-testid="tab-bar"
      className="flex h-8 shrink-0 items-stretch overflow-x-auto bg-xc-bar shadow-[inset_0_-1px_0_var(--color-xc-line)]"
    >
      {openFileIds.map((fileId) => {
        const active = fileId === activeFileId
        const hasError = filesWithErrors.has(fileId)

        return (
          <div
            key={fileId}
            className={`group relative flex min-w-[112px] max-w-[224px] shrink-0 items-center transition-colors duration-[120ms] ${
              active
                ? 'bg-xc-editor text-xc-text'
                : 'text-xc-text-2 hover:bg-xc-fill hover:text-xc-text'
            }`}
          >
            {editing === fileId ? <NameField depth={0} initial={fileBasename(fileId)} testId="tab-rename-input" onCancel={() => setEditing(null)}
              onCommit={name => { if (!onRenameFile(fileId, name)) return false; setEditing(null); return true }} /> : <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(fileId)}
              onDoubleClick={() => setEditing(fileId)}
              onKeyDown={e => { if (e.key === 'F2') { e.preventDefault(); setEditing(fileId) } }}
              // Middle-click closes, as it does in every editor and browser.
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault()
                  onClose(fileId)
                }
              }}
              title={`${fileId} · Double-click to rename`}
              className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-3 pr-1 text-body"
            >
              {hasError ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-xc-error" /> : null}
              <span className="truncate">{fileBasename(fileId)}</span>
            </button>}

            <button
              type="button"
              onClick={() => onClose(fileId)}
              aria-label={`Close ${fileBasename(fileId)}`}
              className="mr-2 grid size-4 shrink-0 place-items-center rounded-sm text-xc-text-2 opacity-0 transition-[opacity,background-color,color] duration-[120ms] hover:bg-xc-fill-strong hover:text-xc-text focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Icon name="xmark" size={10} weight={1.75} />
            </button>

            {/* One hairline between neighbours, drawn by the tab on the left. */}
            <span aria-hidden className="absolute inset-y-0 right-0 w-px bg-xc-line" />
          </div>
        )
      })}
    </div>
  )
}
