'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { dirname, fileBasename, type TreeNode } from '@studio/project-model'
import { useLayout } from '../lib/layout'
import { LogicalLayers } from './LogicalLayers'
import { Layers } from './Layers'
import type { AuthoringNode, AuthoringSelection, AuthoringSnapshot, DesignEditRequest, HiddenViewInfo, SourceFile, ViewLayer } from '@studio/shared'
import type { Diagnostic, FileId } from '@studio/shared'
import { Icon } from './ui/Icon'
import { ContextMenu, MenuButton, type MenuItem } from './ui/Menu'
import styles from './Workspace.module.css'
import { ToolButton } from './ui/Control'

export interface NavigatorProps {
  authoringFiles: readonly SourceFile[]
  authoringSelection?: AuthoringSelection
  authoring?: AuthoringSnapshot
  selectedAuthoringId?: string
  onSelectAuthoring?: (node: AuthoringNode) => void
  onEditAuthoring?: (node: AuthoringNode, operation: DesignEditRequest['operation']) => Promise<string | null>
  layers: readonly ViewLayer[]
  selectedLayerId: string | null
  /** The layer under the inspector's pointer, highlighted while it is there. */
  hoveredLayerId?: string | null
  stale: boolean
  onSelectLayer: (layer: ViewLayer, page: ViewLayer) => void
  onReorderLayer?: (layer: ViewLayer, target: ViewLayer, position: 'before' | 'after') => void
  hiddenViews?: readonly HiddenViewInfo[]
  onHideLayer?: (layer: ViewLayer) => void
  onShowHidden?: (view: HiddenViewInfo) => void
  layersEditable?: boolean
  tree: readonly TreeNode[]
  activeFileId: FileId | null
  filesWithErrors: ReadonlySet<FileId>
  diagnostics: readonly Diagnostic[]
  /** False when one file is left, so the last source cannot be deleted. */
  canDelete: boolean
  onSelect: (fileId: FileId) => void
  onCreateFile: (name: string, parentFolder?: string) => void
  onCreateFolder: (name: string, parentFolder?: string) => void
  onRenameFile: (fileId: FileId, name: string) => boolean
  onTogglePanel: () => void
  onRenameFolder: (path: string, name: string) => void
  onDeleteFile: (fileId: FileId) => void
  onDeleteFolder: (path: string) => void
  onDuplicateFile: (fileId: FileId) => void
  onMoveFile: (fileId: FileId, folder: string) => void
  onRevealDiagnostic: (file: FileId, offset: number) => void
  onOpenTemplates: () => void
}

/** An inline text field the tree is currently showing, for a new item or a rename. */
type Editing =
  | { readonly mode: 'new-file'; readonly parent: string }
  | { readonly mode: 'new-folder'; readonly parent: string }
  | { readonly mode: 'rename'; readonly target: string; readonly isFolder: boolean }

const INDENT = 13
const ROW = 'flex h-[30px] w-full items-center gap-1.5 rounded-[5px] pr-1.5 text-[14px]'

/**
 * The project navigator.
 *
 * What this replaces was a flat list of basenames with a `+` character for a
 * button and a `<select>` pinned to the bottom. The difference that matters is not
 * the styling: a flat list cannot express a project with any structure in it, and
 * the model underneath has always stored full paths, so the structure was there
 * and simply not drawn.
 *
 * Everything here is one of the four things a file tree has to do - show the
 * hierarchy, let you make things in it, let you move things around it, and get
 * out of the way when you are looking for one file by name.
 */
export function Navigator({
  tree,
  authoring, authoringFiles, authoringSelection, selectedAuthoringId, onSelectAuthoring, onEditAuthoring,
  layers, selectedLayerId, hoveredLayerId, stale, onSelectLayer, onReorderLayer, hiddenViews, onHideLayer, onShowHidden, layersEditable,
  activeFileId,
  filesWithErrors,
  diagnostics,
  canDelete,
  onSelect,
  onCreateFile,
  onCreateFolder,
  onRenameFile,
  onRenameFolder,
  onDeleteFile,
  onDeleteFolder,
  onDuplicateFile,
  onMoveFile,
  onRevealDiagnostic,
  onOpenTemplates, onTogglePanel,
}: NavigatorProps) {
  const [runtimeLayers, setRuntimeLayers] = useState(false)
  const tab = useLayout(s => s.navigatorTab)
  const setTab = useLayout(s => s.setNavigatorTab)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; node: TreeNode | null } | null>(
    null,
  )
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  /** A group the user clicked. Cleared when a file is selected instead. */
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)

  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length

  const shown = useMemo(() => filterTree(tree, filter), [tree, filter])

  /**
   * The folder a new item lands in.
   *
   * Xcode's rule, and the only one that is never surprising: whatever is selected.
   * A selected group means that group; a selected file means *its* group, not the
   * root - "New File" while looking at `Models/Trail.swift` almost always means
   * another model.
   */
  const targetFolder = selectedFolder ?? (activeFileId ? dirname(activeFileId) : 'Sources')

  const newItems: readonly MenuItem[] = [
    { value: 'file', label: 'New File…', icon: 'new-file' },
    { value: 'folder', label: 'New Group…', icon: 'new-folder' },
    { value: 'template', label: 'New Project from Template…', separated: true },
  ]

  const startNew = (kind: string, parent = targetFolder) => {
    if (kind === 'template') {
      onOpenTemplates()
      return
    }
    // A new item inside a collapsed group would be invisible while being typed.
    setCollapsed((current) => {
      const next = new Set(current)
      next.delete(parent)
      return next
    })
    setEditing({ mode: kind === 'folder' ? 'new-folder' : 'new-file', parent })
  }

  return (
    <nav
      className="flex h-full min-w-0 flex-col bg-xc-sidebar"
      data-testid="file-rail"
      aria-label="Project navigator"
    >
      <header className={`${styles.tabs} ${styles.navigatorTabs} h-[46px] shrink-0 border-b border-xc-line px-1.5`}>
        <button type="button" data-testid="pane-toggle-navigator" aria-pressed="true" title="Collapse left panel (⌘0)" aria-label="Collapse left panel" onClick={onTogglePanel}><Icon name="sidebar-left" size={15} /></button>
        <NavTab active={tab === 'project'} onClick={() => setTab('project')} label="Project">
          <span className="text-[14px] font-medium">Files</span>
        </NavTab>
        <NavTab active={tab === 'layers'} onClick={() => setTab('layers')} label="Layers">
          <span className="text-[14px] font-medium">Layers</span>
        </NavTab>
        <NavTab active={tab === 'issues'} onClick={() => setTab('issues')} label="Issues">
          <span className="text-[14px] font-medium">Issues</span>
          {errors + warnings > 0 ? (
            <span
              className={`rounded-full px-1 text-[11px] leading-[13px] ${
                errors > 0 ? 'bg-xc-error/25 text-xc-error' : 'bg-xc-warn/25 text-xc-warn'
              }`}
            >
              {errors + warnings}
            </span>
          ) : null}
        </NavTab>

        <span className="ml-auto" hidden={tab !== 'project'}>
          <MenuButton
            items={newItems}
            onSelect={(value) => startNew(value)}
            label="New file or group"
            title="Add a file, a group, or start from a template"
            testId="new-file"
            className="inline-flex h-[20px] w-[22px] items-center justify-center rounded-[5px] text-xc-text-2 transition-colors hover:bg-xc-line-soft hover:text-xc-text"
          >
            <Icon name="plus" size={13} weight={1.8} />
          </MenuButton>
        </span>
      </header>

      {tab === 'project' ? (
        <>
          <div
            className="min-h-0 flex-1 overflow-auto px-1.5 py-1.5"
            // Dropping on empty space below the tree means the root group.
            onDragOver={(event) => {
              event.preventDefault()
              setDropTarget('Sources')
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(event) => {
              const fileId = event.dataTransfer.getData('text/studio-file')
              setDropTarget(null)
              if (fileId) onMoveFile(fileId, 'Sources')
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenu({ at: { x: event.clientX, y: event.clientY }, node: null })
            }}
          >
            <Tree
              nodes={shown}
              depth={0}
              activeFileId={activeFileId}
              filesWithErrors={filesWithErrors}
              collapsed={collapsed}
              editing={editing}
              dropTarget={dropTarget}
              // A filter is a temporary flat view of what matched; honouring the
              // collapsed set while one is active would hide the results.
              forceOpen={filter.trim().length > 0}
              selectedFolder={selectedFolder}
              onSelect={(fileId) => {
                setSelectedFolder(null)
                onSelect(fileId)
              }}
              onSelectFolder={setSelectedFolder}
              onToggleFolder={(path) =>
                setCollapsed((current) => {
                  const next = new Set(current)
                  if (next.has(path)) next.delete(path)
                  else next.add(path)
                  return next
                })
              }
              onCommitEdit={(name) => {
                const active = editing
                if (!active || !name.trim()) return false
                if (active.mode === 'new-file') onCreateFile(name, active.parent)
                else if (active.mode === 'new-folder') onCreateFolder(name, active.parent)
                else if (active.isFolder) onRenameFolder(active.target, name)
                else if (!onRenameFile(active.target, name)) return false
                setEditing(null)
                return true
              }}
              onCancelEdit={() => setEditing(null)}
              onStartRename={(target, isFolder) => setEditing({ mode: 'rename', target, isFolder })}
              onContextMenu={(node, at) => setMenu({ at, node })}
              onDragFile={() => setMenu(null)}
              onDropInto={(folder, fileId) => {
                setDropTarget(null)
                onMoveFile(fileId, folder)
              }}
              onDropTargetChange={setDropTarget}
            />
          </div>

          <FilterField value={filter} onChange={setFilter} />
        </>
      ) : tab === 'layers' ? (
        <>
        {!runtimeLayers && authoring && onSelectAuthoring ? <LogicalLayers snapshot={authoring} files={authoringFiles} selection={authoringSelection} selected={selectedAuthoringId} stale={stale} onSelect={onSelectAuthoring} onEdit={onEditAuthoring} hidden={hiddenViews} onShow={onShowHidden} editable={layersEditable} /> : <Layers pages={layers} selectedId={selectedLayerId} hoveredId={hoveredLayerId} stale={stale} onSelect={onSelectLayer}
          onReorder={onReorderLayer} hidden={hiddenViews} onHide={onHideLayer} onShow={onShowHidden} editable={layersEditable} />}
        <div className="flex shrink-0 items-center justify-between border-t border-xc-line-soft px-3 py-2 text-[11px] text-xc-text-3" aria-label="Developer layer inspection"><span>Developer</span><button type="button" aria-pressed={runtimeLayers} onClick={() => setRuntimeLayers(value => !value)} className="rounded px-1 py-0.5 hover:bg-xc-line-soft">{runtimeLayers ? 'Back to design layers' : 'Runtime detail'}</button></div>
        </>
      ) : (
        <IssueList diagnostics={diagnostics} onReveal={onRevealDiagnostic} />
      )}

      {menu ? (
        <ContextMenu
          at={menu.at}
          testId="navigator-menu"
          items={contextItemsFor(menu.node, canDelete)}
          onDismiss={() => setMenu(null)}
          onSelect={(value) => {
            const node = menu.node
            const folder =
              node?.kind === 'folder' ? node.path : node ? dirname(node.id) : 'Sources'

            if (value === 'file' || value === 'folder') startNew(value, folder)
            else if (value === 'rename' && node)
              setEditing({
                mode: 'rename',
                target: node.kind === 'folder' ? node.path : node.id,
                isFolder: node.kind === 'folder',
              })
            else if (value === 'duplicate' && node?.kind === 'file') onDuplicateFile(node.id)
            else if (value === 'delete' && node?.kind === 'folder') onDeleteFolder(node.path)
            else if (value === 'delete' && node?.kind === 'file') onDeleteFile(node.id)
          }}
        />
      ) : null}
    </nav>
  )
}

function contextItemsFor(node: TreeNode | null, canDelete: boolean): readonly MenuItem[] {
  const create: MenuItem[] = [
    { value: 'file', label: 'New File…', icon: 'new-file' },
    { value: 'folder', label: 'New Group…', icon: 'new-folder' },
  ]
  if (!node) return create

  return [
    ...create,
    { value: 'rename', label: 'Rename', separated: true },
    ...(node.kind === 'file'
      ? [{ value: 'duplicate', label: 'Duplicate' } satisfies MenuItem]
      : []),
    {
      value: 'delete',
      label: node.kind === 'folder' ? 'Delete Group' : `Delete ${node.name}`,
      disabled: node.kind === 'file' && !canDelete,
    },
  ]
}

/**
 * Prunes the tree to what matches, keeping the folders on the way down.
 *
 * Dropping the ancestors and showing a flat list of hits would be easier and is
 * what a naive filter does; it also throws away the one thing you are usually
 * filtering in order to find out, which is where the file lives.
 */
function filterTree(nodes: readonly TreeNode[], query: string): readonly TreeNode[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return nodes

  const keep = (node: TreeNode): TreeNode | null => {
    if (node.kind === 'file') {
      return node.name.toLowerCase().includes(needle) ? node : null
    }
    const children = node.children.map(keep).filter((child): child is TreeNode => child !== null)
    if (children.length === 0 && !node.name.toLowerCase().includes(needle)) return null
    return { ...node, children }
  }

  return nodes.map(keep).filter((node): node is TreeNode => node !== null)
}

function Tree({
  nodes,
  depth,
  activeFileId,
  filesWithErrors,
  collapsed,
  editing,
  dropTarget,
  selectedFolder,
  forceOpen,
  onSelect,
  onSelectFolder,
  onToggleFolder,
  onCommitEdit,
  onCancelEdit,
  onStartRename,
  onContextMenu,
  onDragFile,
  onDropInto,
  onDropTargetChange,
}: {
  nodes: readonly TreeNode[]
  depth: number
  activeFileId: FileId | null
  filesWithErrors: ReadonlySet<FileId>
  collapsed: ReadonlySet<string>
  editing: Editing | null
  dropTarget: string | null
  selectedFolder: string | null
  forceOpen: boolean
  onSelect: (fileId: FileId) => void
  onSelectFolder: (path: string) => void
  onToggleFolder: (path: string) => void
  onCommitEdit: (name: string) => boolean | void
  onCancelEdit: () => void
  onStartRename: (target: string, isFolder: boolean) => void
  onContextMenu: (node: TreeNode, at: { x: number; y: number }) => void
  onDragFile: () => void
  onDropInto: (folder: string, fileId: FileId) => void
  onDropTargetChange: (folder: string | null) => void
}) {
  const shared = {
    depth: depth + 1,
    activeFileId,
    filesWithErrors,
    collapsed,
    editing,
    dropTarget,
    selectedFolder,
    forceOpen,
    onSelect,
    onSelectFolder,
    onToggleFolder,
    onCommitEdit,
    onCancelEdit,
    onStartRename,
    onContextMenu,
    onDragFile,
    onDropInto,
    onDropTargetChange,
  }

  return (
    <ul className="min-w-0">
      {nodes.map((node) => {
        if (node.kind === 'file') {
          const renaming =
            editing?.mode === 'rename' && !editing.isFolder && editing.target === node.id

          return (
            <li key={node.id}>
              {renaming ? (
                <NameField
                  depth={depth}
                  initial={node.name}
                  onCommit={onCommitEdit}
                  onCancel={onCancelEdit}
                  testId="file-rename-input"
                />
              ) : (
                <FileRow
                  node={node}
                  depth={depth}
                  active={node.id === activeFileId}
                  hasError={filesWithErrors.has(node.id)}
                  onSelect={onSelect}
                  onStartRename={onStartRename}
                  onContextMenu={onContextMenu}
                  onDragStart={onDragFile}
                />
              )}
            </li>
          )
        }

        const open = forceOpen || !collapsed.has(node.path)
        const renaming =
          editing?.mode === 'rename' && editing.isFolder && editing.target === node.path
        const isDropTarget = dropTarget === node.path
        const draftHere =
          editing && editing.mode !== 'rename' && editing.parent === node.path ? editing : null

        return (
          <li key={node.path}>
            {renaming ? (
              <NameField
                depth={depth}
                initial={node.name}
                onCommit={onCommitEdit}
                onCancel={onCancelEdit}
                testId="file-rename-input"
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelectFolder(node.path)}
                onDoubleClick={() => onToggleFolder(node.path)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onContextMenu(node, { x: event.clientX, y: event.clientY })
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onDropTargetChange(node.path)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  const fileId = event.dataTransfer.getData('text/studio-file')
                  if (fileId) onDropInto(node.path, fileId)
                }}
                style={{ paddingLeft: depth * INDENT + 4 }}
                data-testid={`group-${node.path}`}
                className={`${ROW} transition-colors ${
                  isDropTarget
                    ? 'bg-xc-accent/30 text-xc-text'
                    : selectedFolder === node.path
                      ? 'bg-xc-select text-xc-text'
                      : 'text-xc-text hover:bg-xc-line-soft'
                }`}
              >
                {/*
                  The triangle is its own control, as it is in every file tree:
                  clicking the row selects the group - which is what decides where
                  "New File" puts things - and only the triangle opens it.
                */}
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
                  data-testid={`disclosure-${node.path}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onToggleFolder(node.path)
                  }}
                  className="-my-1 grid h-[22px] w-[12px] shrink-0 place-items-center"
                >
                  <Icon
                    name={open ? 'disclosure-open' : 'disclosure-closed'}
                    size={10}
                    className={selectedFolder === node.path ? 'text-xc-text/80' : 'text-xc-text-3'}
                  />
                </span>
                <Icon
                  name="folder"
                  size={14}
                  className={selectedFolder === node.path ? 'text-xc-text' : 'text-[#8ab4f8]'}
                />
                <span className="truncate">{node.name}</span>
              </button>
            )}

            {open ? (
              <>
                <Tree {...shared} nodes={node.children} />
                {draftHere ? (
                  <NameField
                    depth={depth + 1}
                    initial=""
                    placeholder={draftHere.mode === 'new-folder' ? 'Group' : 'NewView.swift'}
                    onCommit={onCommitEdit}
                    onCancel={onCancelEdit}
                    testId="new-file-input"
                  />
                ) : null}
              </>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function FileRow({
  node,
  depth,
  active,
  hasError,
  onSelect,
  onStartRename,
  onContextMenu,
  onDragStart,
}: {
  node: Extract<TreeNode, { kind: 'file' }>
  depth: number
  active: boolean
  hasError: boolean
  onSelect: (fileId: FileId) => void
  onStartRename: (target: string, isFolder: boolean) => void
  onContextMenu: (node: TreeNode, at: { x: number; y: number }) => void
  onDragStart: () => void
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/studio-file', node.id)
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onClick={() => onSelect(node.id)}
      onDoubleClick={(event) => { event.preventDefault(); onStartRename(node.id, false) }}
      onKeyDown={(event) => { if (event.key === 'F2') { event.preventDefault(); onStartRename(node.id, false) } }}
      title="Double-click to rename"
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onSelect(node.id)
        onContextMenu(node, { x: event.clientX, y: event.clientY })
      }}
      aria-current={active ? 'true' : undefined}
      style={{ paddingLeft: depth * INDENT + 4 }}
      className={`${ROW} transition-colors ${
        active ? 'bg-xc-select text-xc-text' : 'text-xc-text hover:bg-xc-line-soft'
      }`}
    >
      <span className="w-[10px] shrink-0" />
      <SwiftFileIcon error={hasError} />
      <span className="truncate">{node.name}</span>
      {hasError ? (
        <Icon name="error" size={11} weight={2} className="ml-auto shrink-0 text-xc-error" />
      ) : null}
    </button>
  )
}

/**
 * The source-file icon.
 *
 * A page with a folded corner in Swift's orange - close enough to read as "a Swift
 * file" at 14px, and deliberately not Apple's, which ships with Xcode and is not
 * ours to redraw. The error state recolours it rather than adding a second mark,
 * because a 14px icon has no room for a badge that is still legible.
 */
function SwiftFileIcon({ error }: { error: boolean }) {
  const tint = error ? 'var(--color-xc-error)' : 'var(--color-xc-swift)'
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <path
        d="M3.25 2.6c0-.5.4-.9.9-.9h4.6l3.9 3.85v7.85c0 .5-.4.9-.9.9H4.15c-.5 0-.9-.4-.9-.9V2.6Z"
        fill={tint}
        opacity={0.22}
      />
      <path
        d="M3.25 2.6c0-.5.4-.9.9-.9h4.6l3.9 3.85v7.85c0 .5-.4.9-.9.9H4.15c-.5 0-.9-.4-.9-.9V2.6ZM8.6 1.8v3.8h3.9"
        fill="none"
        stroke={tint}
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M6 11.6c1.9.95 3.55.5 4.25-.15-.6.1-1.5-.15-2.4-.85-1-.8-1.8-1.9-2.2-2.85.35.5.95 1.1 1.65 1.6C6.5 8.3 5.75 6.9 5.4 5.9c.75 1 2 2.1 3 2.7-.55-.7-1.1-1.7-1.35-2.6 1.05 1.35 2.6 2.4 3.35 2.8.1-.75-.15-1.7-.6-2.5 1.35 1.5 1.5 3.3 1.05 4.15.5.35.7.9.5 1.35-.15-.35-.5-.6-.95-.6-1.1.5-3.3.6-4.4-.6Z"
        fill={tint}
      />
    </svg>
  )
}

function NavTab({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      aria-label={label}
      data-testid={`navigator-tab-${label.toLowerCase()}`}
    >
      {children}
    </button>
  )
}

/** Xcode's navigator filter, in the same place Xcode puts it. */
function FilterField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex h-[34px] shrink-0 items-center gap-1.5 border-t border-xc-line px-2">
      <Icon name="search" size={12} className="shrink-0 text-xc-text-3" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onChange('')
        }}
        placeholder="Filter"
        spellCheck={false}
        aria-label="Filter files"
        data-testid="navigator-filter"
        className="min-w-0 flex-1 bg-transparent text-[14px] text-xc-text placeholder:text-xc-text-3"
      />
      {value ? (
        <ToolButton icon="xmark" label="Clear filter" onClick={() => onChange('')} size={11} />
      ) : null}
    </div>
  )
}

/**
 * The issue navigator.
 *
 * The diagnostics were already being computed for the editor's gutter and the
 * debug area; grouping them by file costs nothing and answers the question the
 * console cannot, which is *where* the project is broken rather than how.
 */
function IssueList({
  diagnostics,
  onReveal,
}: {
  diagnostics: readonly Diagnostic[]
  onReveal: (file: FileId, offset: number) => void
}) {
  const byFile = useMemo(() => {
    const groups = new Map<FileId, Diagnostic[]>()
    for (const diagnostic of diagnostics) {
      const bucket = groups.get(diagnostic.span.file)
      if (bucket) bucket.push(diagnostic)
      else groups.set(diagnostic.span.file, [diagnostic])
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [diagnostics])

  if (byFile.length === 0) {
    return (
      <p className="p-3 text-[14px] text-xc-text-3" data-testid="issue-navigator">
        No issues.
      </p>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-1.5 py-1.5" data-testid="issue-navigator">
      {byFile.map(([file, items]) => (
        <div key={file} className="mb-1.5">
          <div className="flex items-center gap-1.5 px-1 py-1 text-[14px] text-xc-text">
            <SwiftFileIcon error={items.some((d) => d.severity === 'error')} />
            <span className="truncate">{fileBasename(file)}</span>
            <span className="ml-auto text-[13px] text-xc-text-3">{items.length}</span>
          </div>

          <ul>
            {items.map((diagnostic, index) => (
              <li key={index}>
                <button
                  type="button"
                  onClick={() => onReveal(diagnostic.span.file, diagnostic.span.start)}
                  className="flex w-full items-start gap-1.5 rounded-[5px] py-1 pl-5 pr-1.5 text-left text-[13px] leading-snug text-xc-text-2 transition-colors hover:bg-xc-line-soft"
                >
                  <Icon
                    name={diagnostic.severity === 'error' ? 'error' : 'warning'}
                    size={11}
                    weight={2}
                    className={`mt-px shrink-0 ${
                      diagnostic.severity === 'error' ? 'text-xc-error' : 'text-xc-warn'
                    }`}
                  />
                  <span className="min-w-0">{diagnostic.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export function NameField({
  depth,
  initial,
  placeholder,
  onCommit,
  onCancel,
  testId,
}: {
  depth: number
  initial: string
  placeholder?: string
  onCommit: (name: string) => boolean | void
  onCancel: () => void
  testId: string
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement | null>(null)
  const finished = useRef(false)
  const [error, setError] = useState(false)
  const finish = () => {
    if (finished.current) return
    if (!value.trim()) { finished.current = true; onCancel(); return }
    finished.current = true
    if (onCommit(value) === false) { finished.current = false; setError(true); ref.current?.focus(); return }
  }

  useEffect(() => {
    ref.current?.focus()
    // Selects the stem, not the extension: renaming a file almost never means
    // renaming `.swift`.
    const stem = initial.replace(/\.swift$/, '').length
    ref.current?.setSelectionRange(0, stem || initial.length)
  }, [initial])

  return (
    <div style={{ paddingLeft: depth * INDENT + 4 }} className="py-px pr-1.5">
      <input
        ref={ref}
        value={value}
        placeholder={placeholder}
        data-testid={testId}
        spellCheck={false}
        onChange={(event) => { setValue(event.target.value); setError(false) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            finish()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            finished.current = true
            onCancel()
          }
        }}
        // Enter and clicking away both save; Escape cancels before blur can save.
        onBlur={finish}
        title={error ? 'Use a unique file name without path separators.' : undefined}
        aria-invalid={error}
        aria-label="File or group name"
        className="h-[22px] w-full rounded-[4px] border border-xc-accent bg-xc-panel px-1.5 text-[14px] text-xc-text outline-none"
      />
      {error ? <span role="alert" className="text-[11px] text-xc-error">Choose a valid, unique name.</span> : null}
    </div>
  )
}
