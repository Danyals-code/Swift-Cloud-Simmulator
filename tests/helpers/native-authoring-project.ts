import { buildExportBundle, generatePbxproj, IdAllocator, parsePlist, serializePlist, type PlistDict, type PlistValue } from '@studio/exporter'
import type { Project } from '@studio/project-model'

function dict(value: PlistValue | undefined): PlistDict {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a project object')
  return value as PlistDict
}
function list(value: PlistValue | undefined): readonly PlistValue[] {
  if (!Array.isArray(value)) throw new Error('Expected a project object list')
  return value
}

/** Add an independent UI-test target to a normal export. Application source is untouched. */
export function nativeAuthoringProject(project: Project, testSource: string): Map<string, Uint8Array> {
  const bundle = new Map(buildExportBundle(project))
  const name = project.manifest.name
  const path = `${name}/${name}.xcodeproj/project.pbxproj`
  const root = parsePlist(new TextDecoder().decode(bundle.get(path)))
  const objects: Record<string, PlistValue> = { ...dict(root.objects) }
  const ids = new IdAllocator()
  const id = (key: string) => ids.id(`authoring-verification:${key}`)
  const projectId = String(root.rootObject)
  const projectObject = dict(objects[projectId])
  const appTarget = generatePbxproj(project).targetId
  const testTarget = id('target')
  const testName = 'AuthoringUITests'
  objects[id('source')] = { isa: 'PBXFileReference', lastKnownFileType: 'sourcecode.swift', path: `${testName}.swift`, sourceTree: '<group>' }
  objects[id('build-source')] = { isa: 'PBXBuildFile', fileRef: id('source') }
  objects[id('product')] = { isa: 'PBXFileReference', explicitFileType: 'wrapper.cfbundle', path: `${testName}.xctest`, sourceTree: 'BUILT_PRODUCTS_DIR' }
  objects[id('sources')] = { isa: 'PBXSourcesBuildPhase', buildActionMask: '2147483647', files: [id('build-source')], runOnlyForDeploymentPostprocessing: '0' }
  objects[id('frameworks')] = { isa: 'PBXFrameworksBuildPhase', buildActionMask: '2147483647', files: [], runOnlyForDeploymentPostprocessing: '0' }
  objects[id('dependency')] = { isa: 'PBXTargetDependency', target: appTarget }
  for (const config of ['Debug', 'Release']) objects[id(config)] = {
    isa: 'XCBuildConfiguration', name: config,
    buildSettings: { GENERATE_INFOPLIST_FILE: 'YES', PRODUCT_NAME: '$(TARGET_NAME)', PRODUCT_BUNDLE_IDENTIFIER: `${project.manifest.bundleId}.uitests`, TEST_TARGET_NAME: name, SDKROOT: 'iphoneos', IPHONEOS_DEPLOYMENT_TARGET: project.manifest.deploymentTarget, TARGETED_DEVICE_FAMILY: '1', SWIFT_VERSION: '5.0', CODE_SIGNING_ALLOWED: 'NO', SWIFT_EMIT_LOC_STRINGS: 'NO' },
  }
  objects[id('configs')] = { isa: 'XCConfigurationList', buildConfigurations: [id('Debug'), id('Release')], defaultConfigurationIsVisible: '0', defaultConfigurationName: 'Debug' }
  objects[testTarget] = { isa: 'PBXNativeTarget', buildConfigurationList: id('configs'), buildPhases: [id('sources'), id('frameworks')], buildRules: [], dependencies: [id('dependency')], name: testName, productName: testName, productReference: id('product'), productType: 'com.apple.product-type.bundle.ui-testing' }
  objects[projectId] = { ...projectObject, targets: [...list(projectObject.targets), testTarget] }
  for (const [groupId, childId] of [[String(projectObject.mainGroup), id('source')], [String(projectObject.productRefGroup), id('product')]]) {
    const group = dict(objects[groupId!])
    objects[groupId!] = { ...group, children: [...list(group.children), childId!] }
  }
  const encode = (s: string) => new TextEncoder().encode(s)
  bundle.set(path, encode(serializePlist({ ...root, objects })))
  bundle.set(`${name}/${testName}.swift`, encode(testSource))
  const reference = (target: string, product: string, targetName: string) => `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${target}" BuildableName="${product}" BlueprintName="${targetName}" ReferencedContainer="container:${name}.xcodeproj"/>`
  bundle.set(`${name}/${name}.xcodeproj/xcshareddata/xcschemes/AuthoringVerification.xcscheme`, encode(`<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.7">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>
<BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">${reference(appTarget, `${name}.app`, name)}</BuildActionEntry>
<BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">${reference(testTarget, `${testName}.xctest`, testName)}</BuildActionEntry>
</BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">${reference(testTarget, `${testName}.xctest`, testName)}</TestableReference></Testables></TestAction>
</Scheme>`))
  return bundle
}
