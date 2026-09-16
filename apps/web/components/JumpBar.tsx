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

/**
 * The jump bar.
 *
 * Xcode's, and it earns its 24 pixels twice: it says where in the project the
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
    label: `${'   '.repeat(Math.max(0, decl.depth))}${decl.name}`,
    detail: decl.kind,
  }))

  return (
    <div
      data-testid="jump-bar"
      className="flex h-[24px] shrink-0 items-center gap-1 overflow-hidden border-b border-xc-line bg-xc-bar px-2 text-[11.5px] text-xc-text-3"
    >
      {path.map((segment, index) => (
        <span key={index} className="flex shrink-0 items-center gap-1">
          {index > 0 ? <Icon name="chevron-right" size={9} /> : null}
          <span className="truncate">{segment}</span>
        </span>
      ))}

      <Icon name="chevron-right" size={9} className="shrink-0" />
      <span className="shrink-0 truncate text-xc-text-2">{fileBasename(fileId)}</span>

      {items.length > 0 ? (
        <>
          <Icon name="chevron-right" size={9} className="shrink-0" />
          <MenuButton
            items={items}
            onSelect={(value) => onJump(Number(value))}
            label="Jump to a declaration"
            title="Everything this file declares"
            testId="jump-bar-symbols"
            className="flex min-w-0 items-center gap-1 rounded-[4px] px-1 py-0.5 text-xc-text transition-colors hover:bg-xc-line-soft"
          >
            {current ? (
              <>
                <span className="grid h-[13px] w-[13px] shrink-0 place-items-center rounded-[3px] bg-xc-accent/25 text-[8px] font-bold text-xc-accent">
                  {KIND_LABEL[current.kind]}
                </span>
                <span className="truncate">{current.name}</span>
              </>
            ) : (
              <span className="truncate text-xc-text-3">No selection</span>
            )}
            <Icon name="chevron-down" size={9} className="shrink-0 text-xc-text-3" />
          </MenuButton>
        </>
      ) : null}
    </div>
  )
}
