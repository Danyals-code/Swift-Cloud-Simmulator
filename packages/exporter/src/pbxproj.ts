import type { Project } from '@studio/project-model'
import { serializePlist, type PlistDict, type PlistValue } from './plist'

/**
 * Generates `project.pbxproj`.
 *
 * Two properties matter beyond "it opens":
 *
 * 1. **Determinism.** Object ids are derived from a hash of what the object *is*,
 *    never from a counter or a random UUID. Re-exporting an unchanged project
 *    produces a byte-identical file, which makes exports diffable and makes the
 *    whole thing testable.
 * 2. **Referential integrity.** Every id referenced by another object must exist.
 *    A dangling reference makes Xcode refuse to open the project with an error that
 *    names nothing useful, so the tests check the object graph directly.
 */

/** Xcode object ids are 24 uppercase hex characters. */
const ID_LENGTH = 24

/**
 * Deterministic id allocator.
 *
 * Ids come from a hash of a stable description ("source:Sources/App.swift"), so the
 * same project always yields the same file. Collisions would produce a silently
 * broken project — two objects sharing an id — so a collision re-hashes with a
 * suffix rather than being left to chance.
 */
export class IdAllocator {
  private readonly assigned = new Map<string, string>()
  private readonly taken = new Set<string>()

  id(key: string): string {
    const existing = this.assigned.get(key)
    if (existing) return existing

    let attempt = 0
    let candidate = hash96(key)
    while (this.taken.has(candidate)) candidate = hash96(`${key}#${++attempt}`)

    this.assigned.set(key, candidate)
    this.taken.add(candidate)
    return candidate
  }

  get size(): number {
    return this.assigned.size
  }
}

/**
 * A 96-bit hash rendered as 24 hex characters.
 *
 * Three FNV-1a passes with different offset bases. Not cryptographic — it does not
 * need to be. It needs to be stable across runs and platforms, which rules out
 * anything involving `Math.random`, object iteration order, or `crypto.subtle`
 * (async, and unavailable in some of the environments this runs in).
 */
function hash96(key: string): string {
  const bases = [0x811c9dc5, 0x01000193, 0x9e3779b9]
  return bases
    .map((base) => {
      let h = base >>> 0
      for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
      }
      return h.toString(16).toUpperCase().padStart(8, '0')
    })
    .join('')
    .slice(0, ID_LENGTH)
}

export interface XcodeProjectPlan {
  readonly pbxproj: string
  /** Source paths relative to the target group, in build order. */
  readonly sourcePaths: readonly string[]
  readonly targetName: string
  /**
   * The target's object id.
   *
   * Reported rather than recomputed by the caller: the scheme has to name the same
   * id the project defines, and an id-collision fallback would silently make a
   * separately-derived one disagree — leaving a scheme Xcode cannot run, with no
   * sign of trouble until you press Run.
   */
  readonly targetId: string
}

interface Built {
  readonly objects: Record<string, PlistDict>
  readonly comments: Map<string, string>
}

/** Swift files only — the target compiles nothing else. */
function swiftSources(project: Project): string[] {
  return project.files
    .filter((f) => f.id.endsWith('.swift'))
    .map((f) => f.id)
    .sort()
}

/**
 * Path inside the target group.
 *
 * Drops the workspace's `Sources/` prefix — the exported target folder plays that
 * role — but keeps everything below it. Flattening `Models/Item.swift` to
 * `Item.swift` would collide the moment two folders held a file of the same name,
 * and a file reference whose `path` contains a slash is perfectly valid: it resolves
 * relative to the enclosing group.
 */
export function targetRelativePath(fileId: string): string {
  return fileId.replace(/^Sources\//, '')
}

export function generatePbxproj(project: Project): XcodeProjectPlan {
  const ids = new IdAllocator()
  const name = project.manifest.name
  const sources = swiftSources(project)

  const objects: Record<string, PlistDict> = {}
  const comments = new Map<string, string>()
  const built: Built = { objects, comments }

  const productRef = ids.id('product')
  const assetsRef = ids.id('assets')
  const assetsBuildFile = ids.id('build:assets')
  const mainGroup = ids.id('group:main')
  const targetGroup = ids.id('group:target')
  const productsGroup = ids.id('group:products')
  const sourcesPhase = ids.id('phase:sources')
  const frameworksPhase = ids.id('phase:frameworks')
  const resourcesPhase = ids.id('phase:resources')
  const target = ids.id('target')
  const projectId = ids.id('project')
  const projectConfigList = ids.id('configlist:project')
  const targetConfigList = ids.id('configlist:target')
  const projectDebug = ids.id('config:project:Debug')
  const projectRelease = ids.id('config:project:Release')
  const targetDebug = ids.id('config:target:Debug')
  const targetRelease = ids.id('config:target:Release')

  // --- file references and build files ---------------------------------------
  const fileRefs = new Map<string, string>()
  const buildFiles: string[] = []

  for (const fileId of sources) {
    const path = targetRelativePath(fileId)
    const fileRef = ids.id(`fileref:${fileId}`)
    const buildFile = ids.id(`build:${fileId}`)

    fileRefs.set(fileId, fileRef)
    buildFiles.push(buildFile)

    define(built, fileRef, path, {
      isa: 'PBXFileReference',
      lastKnownFileType: 'sourcecode.swift',
      path,
      sourceTree: '<group>',
    })
    define(built, buildFile, `${path} in Sources`, {
      isa: 'PBXBuildFile',
      fileRef,
    })
  }

  define(built, productRef, `${name}.app`, {
    isa: 'PBXFileReference',
    explicitFileType: 'wrapper.application',
    includeInIndex: '0',
    path: `${name}.app`,
    sourceTree: 'BUILT_PRODUCTS_DIR',
  })

  define(built, assetsRef, 'Assets.xcassets', {
    isa: 'PBXFileReference',
    lastKnownFileType: 'folder.assetcatalog',
    path: 'Assets.xcassets',
    sourceTree: '<group>',
  })
  define(built, assetsBuildFile, 'Assets.xcassets in Resources', {
    isa: 'PBXBuildFile',
    fileRef: assetsRef,
  })

  // --- groups ----------------------------------------------------------------
  define(built, mainGroup, '', {
    isa: 'PBXGroup',
    children: [targetGroup, productsGroup],
    sourceTree: '<group>',
  })
  define(built, targetGroup, name, {
    isa: 'PBXGroup',
    children: [...sources.map((f) => fileRefs.get(f)!), assetsRef],
    path: name,
    sourceTree: '<group>',
  })
  define(built, productsGroup, 'Products', {
    isa: 'PBXGroup',
    children: [productRef],
    name: 'Products',
    sourceTree: '<group>',
  })

  // --- build phases -----------------------------------------------------------
  define(built, sourcesPhase, 'Sources', {
    isa: 'PBXSourcesBuildPhase',
    buildActionMask: '2147483647',
    files: buildFiles,
    runOnlyForDeploymentPostprocessing: '0',
  })
  define(built, frameworksPhase, 'Frameworks', {
    isa: 'PBXFrameworksBuildPhase',
    buildActionMask: '2147483647',
    files: [],
    runOnlyForDeploymentPostprocessing: '0',
  })
  define(built, resourcesPhase, 'Resources', {
    isa: 'PBXResourcesBuildPhase',
    buildActionMask: '2147483647',
    files: [assetsBuildFile],
    runOnlyForDeploymentPostprocessing: '0',
  })

  // --- target and project ------------------------------------------------------
  define(built, target, name, {
    isa: 'PBXNativeTarget',
    buildConfigurationList: targetConfigList,
    buildPhases: [sourcesPhase, frameworksPhase, resourcesPhase],
    buildRules: [],
    dependencies: [],
    name,
    productName: name,
    productReference: productRef,
    productType: 'com.apple.product-type.application',
  })

  define(built, projectId, 'Project object', {
    isa: 'PBXProject',
    attributes: {
      BuildIndependentTargetsInParallel: '1',
      LastSwiftUpdateCheck: '1520',
      LastUpgradeCheck: '1520',
      TargetAttributes: { [target]: { CreatedOnToolsVersion: '15.2' } },
    },
    buildConfigurationList: projectConfigList,
    compatibilityVersion: 'Xcode 14.0',
    developmentRegion: 'en',
    hasScannedForEncodings: '0',
    knownRegions: ['en', 'Base'],
    mainGroup,
    productRefGroup: productsGroup,
    projectDirPath: '',
    projectRoot: '',
    targets: [target],
  })

  // --- build configurations ----------------------------------------------------
  define(built, projectDebug, 'Debug', {
    isa: 'XCBuildConfiguration',
    buildSettings: { ...projectSettings(project), ...debugProjectSettings() },
    name: 'Debug',
  })
  define(built, projectRelease, 'Release', {
    isa: 'XCBuildConfiguration',
    buildSettings: { ...projectSettings(project), ...releaseProjectSettings() },
    name: 'Release',
  })
  define(built, targetDebug, 'Debug', {
    isa: 'XCBuildConfiguration',
    buildSettings: targetSettings(project),
    name: 'Debug',
  })
  define(built, targetRelease, 'Release', {
    isa: 'XCBuildConfiguration',
    buildSettings: targetSettings(project),
    name: 'Release',
  })

  define(built, projectConfigList, `Build configuration list for PBXProject "${name}"`, {
    isa: 'XCConfigurationList',
    buildConfigurations: [projectDebug, projectRelease],
    defaultConfigurationIsVisible: '0',
    defaultConfigurationName: 'Release',
  })
  define(built, targetConfigList, `Build configuration list for PBXNativeTarget "${name}"`, {
    isa: 'XCConfigurationList',
    buildConfigurations: [targetDebug, targetRelease],
    defaultConfigurationIsVisible: '0',
    defaultConfigurationName: 'Release',
  })

  const root: PlistDict = {
    archiveVersion: '1',
    classes: {},
    objectVersion: '56',
    // Sorted so the output depends only on content, never on insertion order.
    objects: Object.fromEntries(Object.entries(objects).sort(([a], [b]) => (a < b ? -1 : 1))),
    rootObject: projectId,
  }

  return {
    pbxproj: serializePlist(root, comments),
    sourcePaths: sources.map(targetRelativePath),
    targetName: name,
    targetId: target,
  }
}

function define(built: Built, id: string, comment: string, object: PlistDict): void {
  built.objects[id] = object
  if (comment) built.comments.set(id, comment)
}

/**
 * Project-level settings.
 *
 * Deliberately a small set: every one of these is needed to build, and a generated
 * project full of settings nobody chose is harder to read and harder to trust. Xcode
 * fills in its own defaults for everything omitted.
 */
function projectSettings(project: Project): PlistDict {
  return {
    ALWAYS_SEARCH_USER_PATHS: 'NO',
    CLANG_ENABLE_MODULES: 'YES',
    CLANG_ENABLE_OBJC_ARC: 'YES',
    ENABLE_STRICT_OBJC_MSGSEND: 'YES',
    GCC_C_LANGUAGE_STANDARD: 'gnu17',
    IPHONEOS_DEPLOYMENT_TARGET: project.manifest.deploymentTarget,
    SDKROOT: 'iphoneos',
    SWIFT_VERSION: '5.0',
  }
}

function debugProjectSettings(): PlistDict {
  return {
    DEBUG_INFORMATION_FORMAT: 'dwarf',
    ENABLE_TESTABILITY: 'YES',
    GCC_OPTIMIZATION_LEVEL: '0',
    ONLY_ACTIVE_ARCH: 'YES',
    SWIFT_ACTIVE_COMPILATION_CONDITIONS: 'DEBUG $(inherited)',
    SWIFT_OPTIMIZATION_LEVEL: '-Onone',
  }
}

function releaseProjectSettings(): PlistDict {
  return {
    DEBUG_INFORMATION_FORMAT: 'dwarf-with-dsym',
    ENABLE_NS_ASSERTIONS: 'NO',
    SWIFT_COMPILATION_MODE: 'wholemodule',
    VALIDATE_PRODUCT: 'YES',
  }
}

/**
 * Target settings.
 *
 * `GENERATE_INFOPLIST_FILE = YES` with `INFOPLIST_KEY_*` entries is how Xcode 13+
 * handles Info.plist. Emitting a physical plist instead would work but adds a file
 * that immediately drifts from the build settings beside it.
 */
function targetSettings(project: Project): PlistDict {
  const orientationsPhone =
    'UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight'
  const orientationsPad = `UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown ${'UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight'}`

  return {
    ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon',
    ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: 'AccentColor',
    CODE_SIGN_STYLE: 'Automatic',
    CURRENT_PROJECT_VERSION: '1',
    ENABLE_PREVIEWS: 'YES',
    GENERATE_INFOPLIST_FILE: 'YES',
    INFOPLIST_KEY_UIApplicationSceneManifest_Generation: 'YES',
    INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents: 'YES',
    INFOPLIST_KEY_UILaunchScreen_Generation: 'YES',
    INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad: orientationsPad,
    INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone: orientationsPhone,
    IPHONEOS_DEPLOYMENT_TARGET: project.manifest.deploymentTarget,
    LD_RUNPATH_SEARCH_PATHS: ['$(inherited)', '@executable_path/Frameworks'],
    MARKETING_VERSION: '1.0',
    PRODUCT_BUNDLE_IDENTIFIER: project.manifest.bundleId,
    PRODUCT_NAME: '$(TARGET_NAME)',
    SWIFT_EMIT_LOC_STRINGS: 'YES',
    SWIFT_VERSION: '5.0',
    TARGETED_DEVICE_FAMILY: '1,2',
  }
}

export type { PlistValue }
