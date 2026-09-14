import type { Project } from '@studio/project-model'
import { generatePbxproj, targetRelativePath } from './pbxproj'
import {
  accentColorContents,
  appIconContents,
  assetCatalogContents,
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
  const files = new Map<string, Uint8Array>()
  const name = project.manifest.name
  const root = name

  const add = (path: string, text: string) => files.set(`${root}/${path}`, encodeText(text))

  // The user's sources, untouched.
  for (const file of project.files) {
    files.set(`${root}/${name}/${targetRelativePath(file.id)}`, encodeText(file.text))
  }

  const plan = generatePbxproj(project)
  add(`${name}.xcodeproj/project.pbxproj`, plan.pbxproj)
  add(`${name}.xcodeproj/project.xcworkspace/contents.xcworkspacedata`, workspaceContents())

  // The scheme names the target by the id the project actually assigned it.
  add(
    `${name}.xcodeproj/xcshareddata/xcschemes/${name}.xcscheme`,
    schemeContents(project, plan.targetId),
  )

  add(`${name}/Assets.xcassets/Contents.json`, assetCatalogContents())
  add(`${name}/Assets.xcassets/AppIcon.appiconset/Contents.json`, appIconContents())
  add(`${name}/Assets.xcassets/AccentColor.colorset/Contents.json`, accentColorContents())

  add('.gitignore', gitignoreContents())
  add('README.md', readme(project, plan.sourcePaths))

  return files
}

function readme(project: Project, sourcePaths: readonly string[]): string {
  const { name, bundleId, deploymentTarget } = project.manifest
  const sources = sourcePaths.map((p) => `- \`${name}/${p}\``).join('\n')

  return `# ${name}

Exported from SwiftUI Web Studio.

| | |
| --- | --- |
| Bundle identifier | \`${bundleId}\` |
| Deployment target | iOS ${deploymentTarget} |
| Sources | ${sourcePaths.length} file(s) |

## Building

\`\`\`
open ${name}.xcodeproj
\`\`\`

Then press Cmd+R. The project builds and runs in the Simulator as-is.

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
preview could not draw is still here, unchanged, and will build normally.
`
}
