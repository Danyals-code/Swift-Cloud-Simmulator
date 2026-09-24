import { isAccentColorSetName } from '@studio/shared'
import { assetCatalog } from './resources'
import type { Project } from '@studio/project-model'
import { generatePbxproj, targetRelativePath } from './pbxproj'
import {
  accentColorContents,
  appIconContents,
  gitignoreContents,
  schemeContents,
  workspaceContents,
} from './xcode-files'

/** Export path -> file bytes. Paths are POSIX, relative to the zip root. */
export type ExportBundle = ReadonlyMap<string, Uint8Array>

const encoder = new TextEncoder()

export function encodeText(text: string): Uint8Array {
  return encoder.encode(text)
}

/**
 * An entry map that refuses any path leaving the archive root.
 *
 * Shared by all four export formats. The values these paths are built from are
 * validated where they enter the project - a typed name through `normalizeFileName`,
 * a shared one through `decodeProject` - so nothing should ever fail here. It is
 * checked anyway because this is where the invariant lives: *every entry in the
 * archive is inside its own root*. Phase 9 added three formats after the first, each
 * repeating the same path arithmetic; one of them forgetting is exactly the shape of
 * mistake this removes.
 */
export function newBundle(root: string): {
  readonly files: Map<string, Uint8Array>
  put(path: string, bytes: Uint8Array): void
} {
  const files = new Map<string, Uint8Array>()
  return {
    files,
    put(path, bytes) {
      const resolved = resolveInside(path, root)
      if (resolved === null) {
        throw new Error(`Refusing to export an entry outside the project: ${path}`)
      }
      if ([...files.keys()].some(p => p.normalize('NFC').toLowerCase() === resolved.normalize('NFC').toLowerCase())) throw new Error(`Duplicate export path: ${path}`)
      files.set(resolved, bytes)
    },
  }
}

/**
 * An entry's path once `.` and `..` are applied, or null if it leaves `root`.
 *
 * Resolved rather than pattern-matched, because the presence of `..` is not the
 * question: `MyApp/x/../y` is fine, and how many are too many depends on how deep the
 * prefix is. The `.swiftpm` layout nests three deep where `.xcodeproj` nests two, so
 * the same three `..` escape one archive and land at the top of the other - which is
 * why the test is "still inside its own root" rather than "still inside the archive".
 *
 * An absolute path or a Windows drive letter is refused outright: an extractor
 * resolves those against something other than the archive.
 */
function resolveInside(path: string, root: string): string | null {
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\\')) return null

  const out: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment !== '..') {
      out.push(segment)
      continue
    }
    if (out.length === 0) return null
    out.pop()
  }

  const resolved = out.join('/')
  return resolved.startsWith(`${root}/`) ? resolved : null
}

/**
 * Builds the file set for export: a complete, openable Xcode project.
 *
 * ```
 * MyApp/
 *   MyApp.xcodeproj/
 *     project.pbxproj
 *     project.xcworkspace/contents.xcworkspacedata
 *     xcshareddata/xcschemes/MyApp.xcscheme
 *   MyApp/
 *     MyApp.swift              <- the user's sources, byte for byte
 *     Assets.xcassets/...
 *   README.md
 *   .gitignore
 * ```
 *
 * The guarantee the whole product rests on (FR-7.8, goal G3): every `.swift` file is
 * the editor buffer encoded as UTF-8 and nothing else. No reformatting, no
 * regeneration from an AST, no transformation of any kind. Everything else in the
 * bundle is scaffolding generated *around* those bytes, which is why the guarantee
 * holds by construction rather than by vigilance.
 */
export function buildExportBundle(project: Project): ExportBundle {
  const name = project.manifest.name
  const root = name
  const { files, put } = newBundle(root)

  const add = (path: string, text: string) => put(`${root}/${path}`, encodeText(text))

  // The user's sources, untouched.
  for (const file of project.files) {
    put(`${root}/${name}/${targetRelativePath(file.id)}`, encodeText(file.text))
  }

  const plan = generatePbxproj(project)
  add(`${name}.xcodeproj/project.pbxproj`, plan.pbxproj)
  add(`${name}.xcodeproj/project.xcworkspace/contents.xcworkspacedata`, workspaceContents())

  // The scheme names the target by the id the project actually assigned it.
  add(
    `${name}.xcodeproj/xcshareddata/xcschemes/${name}.xcscheme`,
    schemeContents(project, plan.targetId),
  )

  for (const [path, bytes] of assetCatalog(project, `${root}/${name}/Assets.xcassets`)) put(path, bytes)
  add(`${name}/Assets.xcassets/AppIcon.appiconset/Contents.json`, appIconContents())
  // An app with its own colour set of this name already has the folder.
  if (!project.colors?.some(color => isAccentColorSetName(color.name))) add(`${name}/Assets.xcassets/AccentColor.colorset/Contents.json`, accentColorContents())

  add('.gitignore', gitignoreContents())
  add('README.md', readme(project, plan.sourcePaths))

  return files
}

function readme(project: Project, sourcePaths: readonly string[]): string {
  const { name, bundleId, deploymentTarget } = project.manifest
  const sources = sourcePaths.map((p) => `- \`${name}/${p}\``).join('\n')

  return `# ${name}

Exported from Swift Web Studio.

| | |
| --- | --- |
| Bundle identifier | \`${bundleId}\` |
| Deployment target | iOS ${deploymentTarget} |
| Sources | ${sourcePaths.length} file(s) |

## Building

\`\`\`
open ${name}.xcodeproj
\`\`\`

Then press Cmd+R with a compatible Xcode and iOS SDK. Resolve source diagnostics and add any external dependencies required by your Swift.

To run on a physical device, select the target, open **Signing & Capabilities**, and
choose your team - the project ships with automatic signing and no team set, because
a team identifier is specific to your Apple developer account.

## Sources

${sources}

## Preview approximations

The browser preview is driven by an interpreter, not by the real Swift compiler and
SwiftUI. These differences are expected, and none of them affect the exported code:

- System fonts are approximated with a metric-compatible open font stack, so line
  breaking is very close but not identical to CoreText.
- SF Symbol names map to an open icon set; glyph shapes differ.
- Materials and blur use CSS filters rather than Apple's exact blur.
- Scrolling uses native browser physics, not iOS rubber-band deceleration.
- The interpreter is far slower than compiled Swift; do not judge frame rates by it.

Your Swift source is exported exactly as written - byte for byte. Anything the
preview could not draw is still here, unchanged. Export preserves source; it does not certify that arbitrary Swift compiles.
`
}
