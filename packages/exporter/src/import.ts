import { importSourceAssets } from './import-assets'
import { readArchiveEntries } from './archive-reader'
import { readHandoff, decodeText, type Handoff } from './portable'
import type { Project } from '@studio/project-model'
import type { OpenedFile } from '@studio/project-model'

/** Bounded archive import; all validation finishes before a project is offered to the editor. */
export interface ImportedArchive {
  readonly project?: Project
  readonly handoff?: Handoff
  readonly files: readonly OpenedFile[]
  /** Why nothing came back, in words a person can act on. */
  readonly problem: string | null
}

/**
 * The Swift files inside an exported archive.
 *
 * The path each one is given is *inside the target*: the four formats wrap sources in
 * `<Name>/<Name>/`, `<Name>/Sources/<Name>/` and so on, and none of that belongs in
 * the reopened project. Everything up to and including the last `Sources/` is
 * dropped, which recovers the group structure the project had and nothing else. An
 * archive with no `Sources/` at all keeps whatever folders it has below its root.
 */
/** The folders a project made in the studio owns, which are never a wrapper. */
const SHAPE_FOLDERS = new Set(['App', 'Features', 'DesignSystem'])

export function readProjectArchive(bytes: Uint8Array): ImportedArchive {
  try {
    const entries = readArchiveEntries(bytes)
    const portable = readHandoff(entries)
    if (portable) return { files: portable.project.files.map(f => ({ name: f.id, text: f.text })), problem: null, ...portable }
    const files = [...entries].filter(([path]) => path.endsWith('.swift') && !isManifest(path)).map(([path, data]) => ({ name: insideTarget(path), text: decodeText(data) }))
    const ids = new Set(files.map(f => f.name.normalize('NFC').toLowerCase()))
    if (ids.size !== files.length) throw new Error('That archive has ambiguous source paths.')
    const withAssets = importSourceAssets(files, entries)
    if (withAssets) return { files, problem: null, ...withAssets }
    return files.length ? { files, problem: null } : { files: [], problem: 'That archive has no .swift files in it.' }
  } catch (error) { return { files: [], problem: error instanceof Error ? error.message : 'That file is not a readable zip archive.' } }
}

/**
 * An entry's path with the wrapper the export added stripped back off.
 *
 * The four formats nest a project three different ways and the archive always adds a
 * root folder named after it, so the peeling is: drop the root, then a `Sources/`,
 * then the target folder if it repeats the root's name. Run in that order it inverts
 * all four:
 *
 * - `App/App/Models/Item.swift`          (.xcodeproj)
 * - `App/Sources/App/Models/Item.swift`  (.swiftpm and the package)
 * - `App/Sources/Models/Item.swift`      (XcodeGen)
 *
 * The archive reader rejects traversal and duplicate paths before target wrappers are removed.
 */
function insideTarget(entry: string): string {
  const segments = normalise(entry).split('/').filter((s) => s.length > 0)
  const root = segments[0] ?? ''
  // `.swiftpm` puts the extension on the *directory*, so the wrapper is
  // `App.swiftpm` while the target folder inside it is plain `App`.
  const bare = root.replace(/\.[^./]+$/, '')

  // Peeled rather than stripped in a fixed order, because the three layouts nest the
  // same two names differently: `App/App/`, `App/Sources/App/` and `App/Sources/`.
  // Bounded at three, which is one more than any of them needs and far short of
  // eating a folder somebody meant.
  let rest = segments.slice(1)
  for (let i = 0; i < 3 && rest.length > 1; i++) {
    const head = rest[0]
    if (head !== 'Sources' && head !== root && head !== bare) break
    // A project called "App" has both an `App/` wrapper and the project's own `App/`
    // group, and they look the same. The last one is the group: peeling it would put
    // the entry point loose at the root, so a folder the project owns is never the
    // last thing between the wrapper and a file.
    if (SHAPE_FOLDERS.has(head) && rest.length === 2) break
    rest = rest.slice(1)
  }

  const relative = rest.join('/')
  if (relative.length === 0 || relative.includes('..')) {
    return segments[segments.length - 1] ?? normalise(entry)
  }
  return relative
}

/**
 * Whether an entry is the package manifest rather than somebody's code.
 *
 * `Package.swift` is Swift and is not a source file: it describes the project to the
 * build system, the exporter writes it, and reading it back would put a target
 * definition in the navigator. It sits directly beside the archive's root folder,
 * which is what distinguishes it from a file a user happened to call the same thing.
 */
function isManifest(entry: string): boolean {
  const segments = normalise(entry).split('/').filter((s) => s.length > 0)
  return segments.length === 2 && segments[1] === 'Package.swift'
}

/** Zip entries use forward slashes; a writer that used the other kind is still read. */
function normalise(entry: string): string {
  return entry.split(String.fromCharCode(92)).join('/')
}
