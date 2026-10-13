'use client'

import { useMemo } from 'react'
import { fileBasename } from '@studio/project-model'
import type { FileId } from '@studio/shared'
import { declarationPathAt, declarationsIn, type Declaration } from '../lib/outline'
import { Icon } from './ui/Icon'
import { MenuButton, type MenuItem } from './ui/Menu'

export interface JumpBarProps {
  fileId: FileId
  text: string
  /** Caret offset, so the trailing crumb names the declaration you are inside. */
  caret: number
  onJump: (offset: number) => void
}

const KIND_LABEL: Record<Declaration['kind'], string> = {
  struct: 'S',
  class: 'C',
  enum: 'E',
  protocol: 'P',
  extension: 'X',
  func: 'M',
  init: 'M',
  var: 'V',
  let: 'V',
}

/** The badge's tint: the colour the editor draws that kind of name in, as completion's badges use. */
const KIND_COLOR: Record<Declaration['kind'], string> = {
  struct: 'var(--editor-systemType)',
  class: 'var(--editor-systemType)',
  enum: 'var(--editor-systemType)',
  protocol: 'var(--editor-systemType)',
  extension: 'var(--editor-systemType)',
  func: 'var(--editor-otherDeclaration)',
  init: 'var(--editor-otherDeclaration)',
  var: 'var(--editor-projectMember)',
  let: 'var(--editor-projectMember)',
}

/**
 * The jump bar.
 *
 * Xcode's, and it earns its 28 pixels twice: it says where in the project the
 * open file lives - which a tab showing only a basename cannot - and its last
 * segment is a menu of everything declared in the file, which is how people
 * actually move around a 400-line view.
 *
 * The path segments are not clickable. They name folders, and a folder is not
 * somewhere the editor can go; making them look interactive would promise a
 * navigation that has nowhere to land.
 */
export function JumpBar({ fileId, text, caret, onJump }: JumpBarProps) {
  const declarations = useMemo(() => declarationsIn(text), [text])
  const path = fileId.split('/').slice(0, -1)

  const enclosing = declarationPathAt(declarations, caret)
  const current = enclosing[enclosing.length - 1]

  const items: readonly MenuItem[] = declarations.map((decl) => ({
    value: String(decl.start),
    // Indented by nesting depth, which is what makes `body` read as belonging to
    // the type above it rather than as another top-level declaration.
    // Em spaces: a menu row collapses ordinary ones, and the nesting went with them.
    label: `${'\u2003'.repeat(Math.max(0, decl.depth))}${decl.name}`,
    detail: decl.kind,
  }))

  return (
    <div
      data-testid="jump-bar"
      className="flex h-7 shrink-0 items-center gap-1 overflow-hidden border-b border-xc-line bg-xc-editor px-3 text-footnote text-xc-text-2"
    >
      {path.map((segment, index) => (
        <span key={index} className="flex shrink-0 items-center gap-1">
          {index > 0 ? <Icon name="chevron-right" size={10} className="shrink-0 text-xc-text-3" /> : null}
          <Icon name="folder" size={14} className="shrink-0 text-xc-text-3" />
          <span className="truncate">{segment}</span>
        </span>
      ))}

      {path.length > 0 ? <Icon name="chevron-right" size={10} className="shrink-0 text-xc-text-3" /> : null}
      <Icon name="code" size={14} className="shrink-0 text-xc-text-3" />
      <span className="shrink-0 truncate">{fileBasename(fileId)}</span>

      {items.length > 0 ? (
        <>
          <Icon name="chevron-right" size={10} className="shrink-0 text-xc-text-3" />
          <MenuButton
            items={items}
            onSelect={(value) => onJump(Number(value))}
            label="Jump to a declaration"
            title="Everything this file declares"
            testId="jump-bar-symbols"
            className="-ml-1 flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-xc-text transition-colors duration-[120ms] hover:bg-xc-fill aria-expanded:bg-xc-fill"
          >
            {current ? (
              <>
                <span
                  className="grid size-4 shrink-0 place-items-center rounded-sm text-caption font-semibold"
                  style={{
                    color: KIND_COLOR[current.kind],
                    backgroundColor: `color-mix(in srgb, ${KIND_COLOR[current.kind]} 16%, transparent)`,
                  }}
                >
                  {KIND_LABEL[current.kind]}
                </span>
                <span className="truncate font-semibold">{current.name}</span>
              </>
            ) : (
              <span className="truncate text-xc-text-3">No selection</span>
            )}
            <Icon name="chevron-down" size={10} className="shrink-0 text-xc-text-3" />
          </MenuButton>
        </>
      ) : null}
    </div>
  )
}
