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
 * instead of a row of chips. The close control only appears under the pointer, so
 * a wide row of tabs is a row of filenames rather than a row of ✕.
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
      className="flex h-[34px] shrink-0 items-stretch overflow-x-auto border-b border-xc-line bg-xc-bar"
    >
      {openFileIds.map((fileId) => {
        const active = fileId === activeFileId
        const hasError = filesWithErrors.has(fileId)

        return (
          <div
            key={fileId}
            className={`group relative flex min-w-[112px] max-w-[220px] shrink-0 items-center transition-colors ${
              active
                ? 'bg-xc-editor text-xc-text'
                : 'bg-transparent text-xc-text-2 hover:bg-xc-line-soft'
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
              className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 text-[14px]"
            >
              {hasError ? (
                <Icon name="error" size={11} weight={2} className="shrink-0 text-xc-error" />
              ) : null}
              <span className="truncate">{fileBasename(fileId)}</span>
            </button>}

            <button
              type="button"
              onClick={() => onClose(fileId)}
              aria-label={`Close ${fileBasename(fileId)}`}
              className="mr-1 grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[4px] text-xc-text-3 opacity-0 transition hover:bg-xc-line-soft hover:text-xc-text focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Icon name="xmark" size={9} weight={1.8} />
            </button>

            {/* One hairline between neighbours, drawn by the tab on the right. */}
            <span aria-hidden className="absolute inset-y-0 right-0 w-px bg-xc-line" />
            {active ? (
              <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-xc-accent/70" />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
