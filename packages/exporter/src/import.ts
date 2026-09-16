import { unzipSync } from 'fflate'
import type { OpenedFile } from '@studio/project-model'

/**
 * Reading back what Export wrote.
 *
 * Export produces a `.zip`; Open took loose `.swift` files. The round trip therefore
 * read "export, unzip it yourself, then pick the files out of `Sources`" - two steps
 * more than it should be, in the one workflow the whole product is built around.
 *
 * It lives in the exporter rather than the project model for two reasons. `fflate`'s
 * unzip is already here for the writing half, so nothing new reaches the initial
 * bundle; and the four formats put sources in four different places, which is
 * knowledge that belongs next to the code that put them there.
 *
 * Everything below treats the archive as what it is: a file a stranger could have
 * handed you. Entry names are never used as paths - only their last segments reach
 * the project model, which normalises them again - and both the count and the total
 * size are capped before anything is decoded.
 */

/** Enough for any project the studio can make, and far short of a decompression bomb. */
const MAX_ENTRIES = 512
const MAX_TOTAL_BYTES = 8 * 1024 * 1024

export interface ImportedArchive {
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
export function readProjectArchive(bytes: Uint8Array): ImportedArchive {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch {
    return { files: [], problem: 'That file is not a readable zip archive.' }
  }

  const names = Object.keys(entries)
  if (names.length > MAX_ENTRIES) {
    return { files: [], problem: `That archive has ${names.length} entries, which is too many.` }
  }

  const decoder = new TextDecoder()
  const files: OpenedFile[] = []
  let total = 0

  for (const name of names) {
    if (!name.endsWith('.swift') || isManifest(name)) continue

    const content = entries[name]
    if (!content) continue

    total += content.length
    if (total > MAX_TOTAL_BYTES) {
      return { files: [], problem: 'That archive holds more Swift than a project can.' }
    }
    files.push({ name: insideTarget(name), text: decoder.decode(content) })
  }

  if (files.length === 0) {
    return { files: [], problem: 'That archive has no .swift files in it.' }
  }
  return { files, problem: null }
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
 * Kept as a path rather than reduced to a basename so `Models/Item.swift` comes back
 * into its group - but a path that tries to climb out of one keeps only its name, and
 * the project model's own normaliser refuses it again afterwards.
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
    if (head === 'Sources' || head === root || head === bare) rest = rest.slice(1)
    else break
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
