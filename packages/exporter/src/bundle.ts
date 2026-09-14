import type { Project } from '@studio/project-model'

/** Export path -> file bytes. Paths are POSIX, relative to the zip root. */
export type ExportBundle = ReadonlyMap<string, Uint8Array>

const encoder = new TextEncoder()

export function encodeText(text: string): Uint8Array {
  return encoder.encode(text)
}

/**
 * Build the file set for export.
 *
 * The guarantee that makes this whole product worth using (requirement FR-7.8, goal
 * G3): every `.swift` file is the editor buffer encoded as UTF-8 and nothing else.
 * No reformatting, no regeneration from an AST, no transformation of any kind. The
 * preview is allowed to be imperfect; the output never is.
 *
 * Phase 0 emits sources plus a README. Phase 5 adds `project.pbxproj`,
 * `Assets.xcassets` and `Info.plist` around them — none of which changes the
 * sources, which is exactly why the guarantee holds by construction rather than by
 * vigilance.
 */
export function buildExportBundle(project: Project): ExportBundle {
  const files = new Map<string, Uint8Array>()
  const root = project.manifest.name

  for (const file of project.files) {
    files.set(`${root}/${file.id}`, encodeText(file.text))
  }

  files.set(`${root}/README.md`, encodeText(readme(project)))

  return files
}

function readme(project: Project): string {
  const { name, bundleId, deploymentTarget } = project.manifest
  const sources = project.files.map((f) => `- \`${f.id}\``).join('\n')

  return `# ${name}

Exported from SwiftUI Web Studio.

| | |
| --- | --- |
| Bundle identifier | \`${bundleId}\` |
| Deployment target | iOS ${deploymentTarget} |
| Sources | ${project.files.length} file(s) |

## Sources

${sources}

## Building

Phase 0 exports sources only — Xcode project generation lands in Phase 5.

Until then, to build this on a Mac:

1. Create a new iOS App project in Xcode named \`${name}\`.
2. Set the bundle identifier to \`${bundleId}\` and the deployment target to iOS ${deploymentTarget}.
3. Replace the generated Swift files with the ones in \`Sources/\`.

## Preview approximations

The browser preview is driven by an interpreter, not by the real Swift compiler and
SwiftUI. These differences are expected and do not affect the exported code:

- System fonts are approximated with a metric-compatible open font stack.
- SF Symbol names map to an open icon set; glyph shapes differ.
- Materials and blur use CSS filters rather than Apple's exact blur.
- Scrolling uses native browser physics.

Your Swift source is exported exactly as written — byte for byte.
`
}
