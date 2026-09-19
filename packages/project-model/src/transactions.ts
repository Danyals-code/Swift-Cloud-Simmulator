import type { SourceChange } from '@studio/shared'
import type { Project } from './types'
import { readStudioMetadata, type StudioMetadata } from './studio-metadata'
import { validateAssets, type ImageAsset } from './assets'

export interface DocumentSelection { readonly file: string; readonly offset: number }
export interface ProjectTransaction {
  readonly projectId: string
  readonly baseRevision: number
  readonly changes: readonly SourceChange[]
  readonly studio?: { readonly before: StudioMetadata | undefined; readonly after: StudioMetadata }
  readonly assets?: { readonly before: readonly ImageAsset[] | undefined; readonly after: readonly ImageAsset[] }
  readonly selection?: DocumentSelection | null
}
export type TransactionResult = { readonly ok: true; readonly project: Project } | { readonly ok: false; readonly reason: string }

/** Compare-and-swap of an entire project revision, including untouched files and metadata. */
export function applyProjectTransaction(project: Project, revision: number, transaction: ProjectTransaction): TransactionResult {
  if (project.id !== transaction.projectId || revision !== transaction.baseRevision) return { ok: false, reason: 'The project changed while this edit was being prepared. Try again.' }
  const ids = new Set<string>()
  for (const change of transaction.changes) {
    if (ids.has(change.file) || !change.file.endsWith('.swift') || change.file.startsWith('/') || change.file.split('/').some(s => !s || s === '.' || s === '..')) return { ok: false, reason: 'The transaction contains an invalid or duplicate file path.' }
    ids.add(change.file)
    const existing = project.files.find(f => f.id === change.file)
    if ((existing?.text ?? null) !== change.before) return { ok: false, reason: 'A file changed while this edit was being prepared. Try again.' }
  }
  if (transaction.studio && (JSON.stringify(project.studio) !== JSON.stringify(transaction.studio.before) || readStudioMetadata(transaction.studio.after).status !== 'valid')) return { ok: false, reason: 'Studio metadata changed or is invalid.' }
  if (transaction.assets) {
    if (project.assets !== transaction.assets.before) return { ok: false, reason: 'Project images changed while this edit was being prepared.' }
    try { validateAssets(transaction.assets.after) } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : 'Invalid image resources.' } }
  }
  const changes = transaction.changes.filter(c => c.before !== c.after)
  if (!changes.length && !transaction.assets && (!transaction.studio || JSON.stringify(transaction.studio.before) === JSON.stringify(transaction.studio.after))) return { ok: true, project }
  const byId = new Map(changes.map(c => [c.file, c]))
  const files = project.files.map(f => byId.has(f.id) ? { ...f, text: byId.get(f.id)!.after } : f)
  for (const c of changes) if (c.before === null) files.push({ id: c.file, text: c.after })
  return { ok: true, project: { ...project, files: changes.length ? files : project.files, studio: transaction.studio?.after ?? project.studio, assets: transaction.assets?.after ?? project.assets, updatedAt: Date.now() } }
}

/** Translate a source selection through typing or an unambiguous file rename. */
export function translateDocumentSelection(before: Project | null, after: Project | null, selection: DocumentSelection | null): DocumentSelection | null {
  if (!before || !after || before.id !== after.id || !selection) return null
  const old = before.files.find(f => f.id === selection.file)
  if (!old) return null
  let next = after.files.find(f => f.id === selection.file)
  if (!next) {
    const renamed = after.files.filter(f => !before.files.some(previous => previous.id === f.id) && f.text === old.text)
    if (renamed.length !== 1) return null
    next = renamed[0]!
  }
  if (old.text === next.text) return { ...selection, file: next.id }
  let prefix = 0
  while (prefix < old.text.length && prefix < next.text.length && old.text[prefix] === next.text[prefix]) prefix++
  let suffix = 0
  while (suffix < old.text.length - prefix && suffix < next.text.length - prefix && old.text[old.text.length - suffix - 1] === next.text[next.text.length - suffix - 1]) suffix++
  const oldEnd = old.text.length - suffix
  if (oldEnd <= selection.offset) return { file: next.id, offset: selection.offset + next.text.length - old.text.length }
  if (prefix <= selection.offset) return null
  return { ...selection, file: next.id }
}

interface Entry { before: Project; after: Project; beforeSelection: DocumentSelection | null; afterSelection: DocumentSelection | null; group?: string; time: number }
const sameDocument = (a: Project, b: Project) => a.id === b.id && JSON.stringify([a.files, a.studio, a.folders, a.manifest]) === JSON.stringify([b.files, b.studio, b.folders, b.manifest]) && a.assets === b.assets

/** One bounded timeline for typing, structural edits and atomic project changes. */
export class DocumentHistory {
  private past: Entry[] = []
  private future: Entry[] = []
  get canUndo(): boolean { return this.past.length > 0 }
  get canRedo(): boolean { return this.future.length > 0 }
  clear(): void { this.past = []; this.future = [] }
  record(before: Project | null, after: Project | null, beforeSelection: DocumentSelection | null, afterSelection: DocumentSelection | null, group?: string, time = Date.now()): void {
    if (!before || !after || before.id !== after.id) { this.clear(); return }
    if (sameDocument(before, after)) return
    const last = this.past.at(-1)
    if (last && !sameDocument(last.after, before)) this.clear()
    if (group && last && this.past.at(-1) === last && last.group === group && time - last.time < 750 && !this.future.length) {
      last.after = after; last.afterSelection = afterSelection; last.time = time
    } else this.past.push({ before, after, beforeSelection, afterSelection, group, time })
    if (this.past.length > 200) this.past.shift()
    this.future = []
  }
  take(direction: 'undo' | 'redo', current: Project): { project: Project; selection: DocumentSelection | null } | null {
    const from = direction === 'undo' ? this.past : this.future
    const entry = from.at(-1)
    if (!entry) return null
    if (!sameDocument(current, direction === 'undo' ? entry.after : entry.before)) { this.clear(); return null }
    from.pop()
    ;(direction === 'undo' ? this.future : this.past).push(entry)
    // An undo/redo boundary always ends a typing group.
    entry.group = undefined
    const target = direction === 'undo' ? entry.before : entry.after
    return { project: { ...current, files: target.files, studio: target.studio, folders: target.folders, assets: target.assets, manifest: target.manifest, updatedAt: Date.now() }, selection: direction === 'undo' ? entry.beforeSelection : entry.afterSelection }
  }
}
