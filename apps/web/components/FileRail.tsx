'use client'

import type { FileId, SourceFile } from '@studio/shared'

export interface FileRailProps {
  files: readonly SourceFile[]
  activeFileId: FileId | null
  onSelect: (fileId: FileId) => void
}

/**
 * Project file list.
 *
 * Phase 0 is read-only and the slice has a single file; create/rename/delete/move
 * and a real tree arrive in Phase 4 along with cross-file name resolution. The
 * component exists now so the three-pane layout is the real one from the start.
 */
export function FileRail({ files, activeFileId, onSelect }: FileRailProps) {
  return (
    <nav
      className="flex h-full w-56 shrink-0 flex-col border-r border-white/5 bg-[#101014]"
      data-testid="file-rail"
    >
      <h2 className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
        Sources
      </h2>

      <ul className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {files.map((file) => {
          const active = file.id === activeFileId
          return (
            <li key={file.id}>
              <button
                type="button"
                onClick={() => onSelect(file.id)}
                aria-current={active ? 'true' : undefined}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition-colors ${
                  active ? 'bg-sky-500/15 text-sky-200' : 'text-zinc-400 hover:bg-white/5'
                }`}
              >
                <SwiftGlyph />
                <span className="truncate">{basename(file.id)}</span>
              </button>
            </li>
          )
        })}
      </ul>

      <p className="border-t border-white/5 px-3 py-2 text-[10px] leading-relaxed text-zinc-600">
        Multi-file projects, creation and renaming land in Phase 4.
      </p>
    </nav>
  )
}

function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

function SwiftGlyph() {
  return (
    <span className="grid h-4 w-4 shrink-0 place-items-center rounded-[3px] bg-orange-500/20 text-[8px] font-bold text-orange-400">
      S
    </span>
  )
}
