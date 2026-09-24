import { assetCatalog, hasCatalog } from './resources'
import type { Project } from '@studio/project-model'
import { encodeText, newBundle, type ExportBundle } from './bundle'
import { targetRelativePath } from './pbxproj'
import { gitignoreContents } from './xcode-files'

/**
 * The export formats beyond `.xcodeproj`.
 *
 * Phase 5 shipped one format and recorded the other three as a shortfall. They are
 * here now, and they share the single guarantee the whole product rests on: every
 * `.swift` file is the editor buffer encoded as UTF-8 and nothing else. Everything
 * below generates scaffolding *around* those bytes, never over them.
 *
 * Each format answers a different question, which is why one is not enough:
 *
 * - **`.xcodeproj`** - "open this on a Mac and press Run."
 * - **`.swiftpm`** - "open this on an iPad." Swift Playgrounds builds and runs an app
 *   package with no Xcode at all, which is the only route from a browser to a device
 *   that does not involve a Mac.
 * - **`Package.swift`** - "build this from the command line, or depend on it."
 * - **`project.yml`** - "generate the Xcode project rather than committing it." A
 *   generated `.xcodeproj` is a merge conflict waiting to happen, and teams that have
 *   been bitten by one reach for XcodeGen.
 */

// The format list itself lives in `shared`, so the toolbar can show the menu without
// pulling in the generator behind it.
export { EXPORT_FORMATS, type ArchiveFormat, type ExportFormat, type FormatInfo } from '@studio/shared'

/**
 * Swift tools version.
 *
 * 5.9 is the floor for the `.swiftpm` app-package format and for the macro-based
 * syntax people write today; pinning it rather than tracking the newest keeps the
 * export openable in the Swift Playgrounds versions actually installed on iPads.
 */
const TOOLS_VERSION = '5.9'

function sourcesOf(project: Project): { path: string; text: string }[] {
  return project.files.map((file) => ({ path: targetRelativePath(file.id), text: file.text }))
}

/**
 * A `.swiftpm` app package, as Swift Playgrounds expects it.
 *
 * The `.swiftpm` extension is on the *directory*, which is what makes iPadOS treat it
 * as a document rather than a folder - so the zip has to carry it too, and the sources
 * live under `Sources/<name>/` rather than beside the manifest.
 */
export function buildSwiftPMAppBundle(project: Project): ExportBundle {
  const name = project.manifest.name
  const root = `${name}.swiftpm`
  const { files, put } = newBundle(root)

  for (const source of sourcesOf(project)) {
    put(`${root}/Sources/${name}/${source.path}`, encodeText(source.text))
  }

  if (hasCatalog(project)) for (const [path, bytes] of assetCatalog(project, `${root}/Sources/${name}/Resources/Assets.xcassets`)) put(path, bytes)
  put(`${root}/Package.swift`, encodeText(appPackageManifest(project)))
  put(`${root}/README.md`, encodeText(swiftpmReadme(project)))
  put(`${root}/.gitignore`, encodeText(gitignoreContents()))

  return files
}

function appPackageManifest(project: Project): string {
  const name = project.manifest.name
  return `// swift-tools-version: ${TOOLS_VERSION}

// This is an *app* package: Swift Playgrounds builds and runs it on iPad, and Xcode
// opens it as a project. The AppleProductTypes import is what marks it as an app
// rather than a library, and it is only available to Swift Playgrounds and Xcode.
import PackageDescription
import AppleProductTypes

let package = Package(
    name: "${name}",
    platforms: [
        .iOS("${project.manifest.deploymentTarget}")
    ],
    products: [
        .iOSApplication(
            name: "${name}",
            targets: ["${name}"],
            bundleIdentifier: "${project.manifest.bundleId}",
            teamIdentifier: "",
            displayVersion: "1.0",
            bundleVersion: "1",
            appIcon: .placeholder(icon: .sparkle),
            accentColor: .presetColor(.blue),
            supportedDeviceFamilies: [.phone, .pad],
            supportedInterfaceOrientations: [
                .portrait,
                .landscapeRight,
                .landscapeLeft,
                .portraitUpsideDown(.when(deviceFamilies: [.pad]))
            ]
        )
    ],
    targets: [
        .executableTarget(
            name: "${name}",
            path: "Sources/${name}"${hasCatalog(project) ? ', resources: [.process("Resources")]' : ''}
        )
    ]
)
`
}

/**
 * A plain SPM package.
 *
 * A library target, not an app: SPM alone cannot build an iOS application bundle, and
 * saying otherwise in a generated manifest would produce a build failure the user has
 * to diagnose. What this format is good for is depending on the code, or building and
 * testing it from the command line - and the README says exactly that rather than
 * leaving it to be discovered.
 */
export function buildPackageBundle(project: Project): ExportBundle {
  const name = project.manifest.name
  const { files, put } = newBundle(name)

  for (const source of sourcesOf(project)) {
    put(`${name}/Sources/${name}/${source.path}`, encodeText(source.text))
  }

  if (hasCatalog(project)) for (const [path, bytes] of assetCatalog(project, `${name}/Sources/${name}/Resources/Assets.xcassets`)) put(path, bytes)
  put(`${name}/Package.swift`, encodeText(libraryPackageManifest(project)))
  put(`${name}/README.md`, encodeText(packageReadme(project)))
  put(`${name}/.gitignore`, encodeText(gitignoreContents()))

  return files
}

function libraryPackageManifest(project: Project): string {
  const name = project.manifest.name
  return `// swift-tools-version: ${TOOLS_VERSION}

import PackageDescription

let package = Package(
    name: "${name}",
    platforms: [
        .iOS("${project.manifest.deploymentTarget}"),
        .macOS(.v14)
    ],
    products: [
        .library(name: "${name}", targets: ["${name}"])
    ],
    targets: [
        .target(name: "${name}", path: "Sources/${name}"${hasCatalog(project) ? ', resources: [.process("Resources")]' : ''})
    ]
)
`
}

/**
 * An XcodeGen spec.
 *
 * Deliberately minimal. XcodeGen fills in everything it is not told, and a generated
 * spec that pins every build setting is one that fights the tool at the first upgrade.
 */
export function buildXcodeGenBundle(project: Project): ExportBundle {
  const name = project.manifest.name
  const { files, put } = newBundle(name)

  for (const source of sourcesOf(project)) {
    put(`${name}/Sources/${source.path}`, encodeText(source.text))
  }

  if (hasCatalog(project)) for (const [path, bytes] of assetCatalog(project, `${name}/Sources/Assets.xcassets`)) put(path, bytes)
  put(`${name}/project.yml`, encodeText(xcodeGenSpec(project)))
  put(`${name}/README.md`, encodeText(xcodeGenReadme(project)))
  put(`${name}/.gitignore`, encodeText(`${gitignoreContents()}\n# Generated by XcodeGen\n*.xcodeproj/\n`))

  return files
}

function xcodeGenSpec(project: Project): string {
  const name = project.manifest.name
  return `name: ${name}

options:
  bundleIdPrefix: ${project.manifest.bundleId.split('.').slice(0, -1).join('.') || 'com.example'}
  deploymentTarget:
    iOS: "${project.manifest.deploymentTarget}"

targets:
  ${name}:
    type: application
    platform: iOS
    sources:
      - Sources
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: ${project.manifest.bundleId}
        GENERATE_INFOPLIST_FILE: YES
        INFOPLIST_KEY_UIApplicationSceneManifest_Generation: YES
        SWIFT_VERSION: "5.0"
        TARGETED_DEVICE_FAMILY: "1,2"
`
}

// ------------------------------------------------------------------- readmes

const APPROXIMATIONS = `## Resources and source compatibility

Swift files are preserved exactly. Swift package resources are processed into a
resource bundle. Named images in a package need the package bundle (for example,
\`Image("Photo", bundle: .module)\`) or integration into the host app's main asset
catalog. Use the Xcode project or XcodeGen app export for main-bundle images.
The export is scaffolding; build it with the appropriate Apple SDK and resolve any
unsupported code or external dependencies before distribution.

## What the preview approximated

The Swift is exactly what you wrote - byte for byte. The *preview* made some
substitutions that this build will not:

- **Fonts** - an open metric-compatible stack stood in for SF Pro.
- **SF Symbols** - Unicode substitutes stood in for Apple's symbol font. \`Image(systemName:)\`
  is unchanged, so the real symbols appear here.
- **Blur and springs** - approximated in CSS; this build uses the real ones.
- **Scrolling** - browser scrolling, not iOS deceleration.
- **Concurrency** - the preview ran everything async synchronously. This build does not.
`

function swiftpmReadme(project: Project): string {
  const name = project.manifest.name
  return `# ${name}

Exported from Swift Web Studio as a **Swift Playgrounds app package**.

## On iPad

1. Put the \`${name}.swiftpm\` folder in Files, or AirDrop it.
2. Open it in **Swift Playgrounds**.
3. Press Run.

No Mac and no Xcode needed - this is the one route from the browser to a real device
that does not involve one.

## On a Mac

\`open ${name}.swiftpm\` opens it in Xcode as an ordinary project.

## Signing

To run on a device rather than the simulator, set your team under **Signing &
Capabilities**. The manifest leaves \`teamIdentifier\` empty because there is no correct
value to guess.

${APPROXIMATIONS}`
}

function packageReadme(project: Project): string {
  const name = project.manifest.name
  return `# ${name}

Exported from Swift Web Studio as a **Swift package**.

\`\`\`bash
swift build
\`\`\`

## What this format is and is not

This is a **library** target. SPM on its own cannot build an iOS application bundle,
so this will not produce a runnable app - saying otherwise in the manifest would give
you a build failure to diagnose rather than a working project.

Use this format to depend on the code, or to build and test it from the command line.
For something you can run, export the **Xcode project** or the **Swift Playgrounds**
package instead.

${APPROXIMATIONS}`
}

function xcodeGenReadme(project: Project): string {
  const name = project.manifest.name
  return `# ${name}

Exported from Swift Web Studio as an **XcodeGen spec**.

\`\`\`bash
brew install xcodegen
xcodegen generate
open ${name}.xcodeproj
\`\`\`

The \`.xcodeproj\` is generated from \`project.yml\` and is in \`.gitignore\`, which is the
point of this format: a committed project file is a merge conflict waiting to happen.

## Signing

Set your team under **Signing & Capabilities** after generating, or add a
\`DEVELOPMENT_TEAM\` setting to \`project.yml\` so it survives regeneration.

${APPROXIMATIONS}`
}
