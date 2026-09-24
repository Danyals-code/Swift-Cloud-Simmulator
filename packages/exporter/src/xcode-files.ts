import type { Project } from '@studio/project-model'

/**
 * The supporting files an Xcode project needs beyond `project.pbxproj`.
 *
 * All small, all fixed-format, and all required for "opens and builds with zero
 * edits" - the asset catalogue because the target's build settings name `AppIcon`
 * and `AccentColor`, the workspace because Xcode expects one inside every
 * `.xcodeproj`, and the scheme because without a shared one the user has to wait for
 * Xcode to generate it before Cmd+R does anything.
 */

/** Every `Contents.json` in an asset catalogue carries this. */
const CATALOG_INFO = { author: 'xcode', version: 1 }

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function assetCatalogContents(): string {
  return json({ info: CATALOG_INFO })
}

/**
 * A modern single-size app icon slot.
 *
 * Xcode 14+ takes one 1024×1024 image and derives every other size. The older
 * multi-entry form still works but produces a catalogue full of empty wells.
 */
export function appIconContents(): string {
  return json({
    images: [{ idiom: 'universal', platform: 'ios', size: '1024x1024' }],
    info: CATALOG_INFO,
  })
}

/**
 * The accent colour.
 *
 * Left unspecified rather than given a value: an empty colour set means "use the
 * system default", which is what an app with no chosen tint should do. Writing a
 * concrete blue here would silently override the platform.
 */
export function accentColorContents(): string {
  return json({
    colors: [{ idiom: 'universal' }],
    info: CATALOG_INFO,
  })
}

export function workspaceContents(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Workspace
   version = "1.0">
   <FileRef
      location = "self:">
   </FileRef>
</Workspace>
`
}

/**
 * A shared scheme, so Cmd+R works the moment the project opens.
 *
 * Xcode autocreates a scheme if none exists, but it does so asynchronously on first
 * open - which means the run button is briefly disabled and the "zero edits" promise
 * feels less true than it is.
 */
export function schemeContents(project: Project, blueprintId: string): string {
  // Names may hold `&`, which an XML attribute has to spell as an entity; `<`, `>` and
  // `"` never reach here, since project names refuse them.
  const name = project.manifest.name.replace(/&/g, '&amp;')
  const container = `container:${name}.xcodeproj`

  const buildableReference = `            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "${blueprintId}"
               BuildableName = "${name}.app"
               BlueprintName = "${name}"
               ReferencedContainer = "${container}">
            </BuildableReference>`

  return `<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "1520"
   version = "1.7">
   <BuildAction
      parallelizeBuildables = "YES"
      buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry
            buildForTesting = "YES"
            buildForRunning = "YES"
            buildForProfiling = "YES"
            buildForArchiving = "YES"
            buildForAnalyzing = "YES">
${buildableReference}
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      shouldUseLaunchSchemeArgsEnv = "YES"
      shouldAutocreateTestPlan = "YES">
   </TestAction>
   <LaunchAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      launchStyle = "0"
      useCustomWorkingDirectory = "NO"
      ignoresPersistentStateOnLaunch = "NO"
      debugDocumentVersioning = "YES"
      debugServiceExtension = "internal"
      allowLocationSimulation = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
${buildableReference}
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction
      buildConfiguration = "Release"
      shouldUseLaunchSchemeArgsEnv = "YES"
      savedToolIdentifier = ""
      useCustomWorkingDirectory = "NO"
      debugDocumentVersioning = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
${buildableReference}
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction
      buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction
      buildConfiguration = "Release"
      revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
`
}

export function gitignoreContents(): string {
  return `# Xcode
build/
DerivedData/
*.xcuserstate
xcuserdata/
*.moved-aside
*.hmap
*.ipa
*.dSYM.zip
*.dSYM

# macOS
.DS_Store
`
}
