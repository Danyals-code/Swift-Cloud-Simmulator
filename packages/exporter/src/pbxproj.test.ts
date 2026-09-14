import { describe, expect, it } from 'vitest'
import { createDefaultProject, type Project } from '@studio/project-model'
import { generatePbxproj, IdAllocator } from './pbxproj'
import { parsePlist, serializePlist, type PlistDict, type PlistValue } from './plist'

/**
 * Validating the Xcode project without an Xcode.
 *
 * This is the one deliverable in the product that cannot be verified on the machine
 * that produces it — gate 1 needs a Mac. So these tests stand in for one, checking
 * the two things that actually go wrong:
 *
 * 1. **Syntax.** The generated file is parsed back with an independent parser. A
 *    pbxproj that does not parse makes Xcode refuse to open the project with an
 *    error that names nothing useful.
 * 2. **Referential integrity.** Every id one object references must exist, and no
 *    two objects may share an id. A dangling reference fails the same silent way.
 *
 * What they cannot check is whether Xcode *likes* the settings — that still needs a
 * Mac, and is recorded as the outstanding gate.
 */

function projectWith(files: { id: string; text: string }[]): Project {
  const base = createDefaultProject(0)
  return { ...base, files }
}

const SAMPLE = projectWith([
  { id: 'Sources/CounterApp.swift', text: '// app\n' },
  { id: 'Sources/ContentView.swift', text: '// view\n' },
  { id: 'Sources/Models/Item.swift', text: '// model\n' },
])

function parsed(project: Project = SAMPLE): PlistDict {
  return parsePlist(generatePbxproj(project).pbxproj)
}

function objectsOf(root: PlistDict): Record<string, PlistDict> {
  return root.objects as Record<string, PlistDict>
}

function objectsOfKind(root: PlistDict, isa: string): PlistDict[] {
  return Object.values(objectsOf(root)).filter((o) => o.isa === isa)
}

/** Every 24-hex string appearing anywhere as a value. */
function referencedIds(value: PlistValue, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (/^[0-9A-F]{24}$/.test(value)) out.add(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const entry of value) referencedIds(entry, out)
    return out
  }
  for (const entry of Object.values(value)) referencedIds(entry, out)
  return out
}

// ===========================================================================

describe('the plist serialiser round-trips', () => {
  it('preserves a nested structure', () => {
    const source: PlistDict = {
      archiveVersion: '1',
      objects: { ABC: { isa: 'PBXGroup', children: ['A', 'B'], name: 'Sources' } },
      rootObject: 'ABC',
    }
    expect(parsePlist(serializePlist(source))).toEqual(source)
  })

  it('quotes strings that are not bare words', () => {
    const source: PlistDict = {
      plain: 'Hello',
      spaced: 'two words',
      empty: '',
      symbols: '$(inherited) @executable_path/Frameworks',
      quoted: 'a "quoted" value',
    }
    expect(parsePlist(serializePlist(source))).toEqual(source)
  })

  it('keeps a bundle identifier intact', () => {
    // Hyphens are legal in bundle ids and legal bare, but the round trip is what
    // proves it rather than the reading of a regex.
    const source: PlistDict = { id: 'com.example.My-App' }
    expect(parsePlist(serializePlist(source))).toEqual(source)
  })

  it('handles empty arrays and dictionaries', () => {
    const source: PlistDict = { classes: {}, files: [], nested: { inner: [] } }
    expect(parsePlist(serializePlist(source))).toEqual(source)
  })

  it('skips comments when parsing', () => {
    const text = serializePlist({ a: 'b' }, new Map([['a', 'a comment']]))
    expect(text).toContain('/* a comment */')
    expect(parsePlist(text)).toEqual({ a: 'b' })
  })

  it('rejects malformed input rather than guessing', () => {
    expect(() => parsePlist('{ a = b ')).toThrow()
    expect(() => parsePlist('{ a b; }')).toThrow()
  })
})

describe('the generated project parses', () => {
  it('produces a file that starts with the UTF-8 marker Xcode expects', () => {
    expect(generatePbxproj(SAMPLE).pbxproj.startsWith('// !$*UTF8*$!')).toBe(true)
  })

  it('parses back into an object graph', () => {
    const root = parsed()
    expect(root.archiveVersion).toBe('1')
    expect(root.objectVersion).toBe('56')
    expect(typeof root.rootObject).toBe('string')
    expect(Object.keys(objectsOf(root)).length).toBeGreaterThan(10)
  })

  it('names a root object that exists and is the PBXProject', () => {
    const root = parsed()
    const project = objectsOf(root)[root.rootObject as string]
    expect(project?.isa).toBe('PBXProject')
  })
})

describe('referential integrity', () => {
  it('resolves every referenced id to a real object', () => {
    // A dangling reference makes Xcode refuse the project with an unhelpful error.
    const root = parsed()
    const objects = objectsOf(root)
    const defined = new Set(Object.keys(objects))

    const dangling = [...referencedIds(root)].filter((id) => !defined.has(id))
    expect(dangling).toEqual([])
  })

  it('gives every object a unique id', () => {
    const root = parsed()
    const ids = Object.keys(objectsOf(root))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('formats every id as 24 uppercase hex characters', () => {
    for (const id of Object.keys(objectsOf(parsed()))) {
      expect(id).toMatch(/^[0-9A-F]{24}$/)
    }
  })

  it('gives every object an isa', () => {
    for (const [id, object] of Object.entries(objectsOf(parsed()))) {
      expect(typeof object.isa, `${id} has no isa`).toBe('string')
    }
  })

  it('leaves no object unreachable from the root', () => {
    // An orphan is harmless to Xcode but means the generator built something it then
    // forgot to attach — which is exactly how a missing source file happens.
    const root = parsed()
    const objects = objectsOf(root)
    const reachable = new Set<string>()

    const visit = (id: string) => {
      if (reachable.has(id) || !objects[id]) return
      reachable.add(id)
      for (const ref of referencedIds(objects[id]!)) visit(ref)
    }
    visit(root.rootObject as string)

    expect([...Object.keys(objects)].filter((id) => !reachable.has(id))).toEqual([])
  })
})

describe('project structure', () => {
  it('declares exactly one application target', () => {
    const targets = objectsOfKind(parsed(), 'PBXNativeTarget')
    expect(targets).toHaveLength(1)
    expect(targets[0]!.productType).toBe('com.apple.product-type.application')
    expect(targets[0]!.name).toBe(SAMPLE.manifest.name)
  })

  it('compiles every Swift source exactly once', () => {
    const root = parsed()
    const objects = objectsOf(root)
    const phase = objectsOfKind(root, 'PBXSourcesBuildPhase')[0]!
    const buildFiles = phase.files as string[]

    expect(buildFiles).toHaveLength(3)

    const compiled = buildFiles
      .map((id) => objects[objects[id]!.fileRef as string]!.path as string)
      .sort()
    // Nested paths are kept rather than flattened: two files named `Item.swift` in
    // different folders would otherwise collide into one group entry.
    expect(compiled).toEqual(['ContentView.swift', 'CounterApp.swift', 'Models/Item.swift'])
  })

  it('excludes non-Swift files from the compile phase', () => {
    const withReadme = projectWith([
      { id: 'Sources/App.swift', text: '// app\n' },
      { id: 'Notes.md', text: '# notes\n' },
    ])
    const root = parsePlist(generatePbxproj(withReadme).pbxproj)
    const phase = objectsOfKind(root, 'PBXSourcesBuildPhase')[0]!
    expect(phase.files as string[]).toHaveLength(1)
  })

  it('bundles the asset catalogue as a resource', () => {
    const root = parsed()
    const objects = objectsOf(root)
    const phase = objectsOfKind(root, 'PBXResourcesBuildPhase')[0]!
    const refs = (phase.files as string[]).map(
      (id) => objects[objects[id]!.fileRef as string]!.path,
    )
    expect(refs).toEqual(['Assets.xcassets'])
  })

  it('gives the target three build phases in the order Xcode expects', () => {
    const root = parsed()
    const objects = objectsOf(root)
    const target = objectsOfKind(root, 'PBXNativeTarget')[0]!
    const kinds = (target.buildPhases as string[]).map((id) => objects[id]!.isa)

    expect(kinds).toEqual([
      'PBXSourcesBuildPhase',
      'PBXFrameworksBuildPhase',
      'PBXResourcesBuildPhase',
    ])
  })

  it('provides Debug and Release for both the project and the target', () => {
    const root = parsed()
    const objects = objectsOf(root)

    for (const list of objectsOfKind(root, 'XCConfigurationList')) {
      const names = (list.buildConfigurations as string[]).map((id) => objects[id]!.name)
      expect(names).toEqual(['Debug', 'Release'])
    }
    expect(objectsOfKind(root, 'XCConfigurationList')).toHaveLength(2)
  })

  it('carries the manifest into the target settings', () => {
    const root = parsed()
    const target = objectsOfKind(root, 'PBXNativeTarget')[0]!
    const list = objectsOf(root)[target.buildConfigurationList as string]!
    const debug = objectsOf(root)[(list.buildConfigurations as string[])[0]!]!
    const settings = debug.buildSettings as PlistDict

    expect(settings.PRODUCT_BUNDLE_IDENTIFIER).toBe(SAMPLE.manifest.bundleId)
    expect(settings.IPHONEOS_DEPLOYMENT_TARGET).toBe(SAMPLE.manifest.deploymentTarget)
    expect(settings.GENERATE_INFOPLIST_FILE).toBe('YES')
    expect(settings.ASSETCATALOG_COMPILER_APPICON_NAME).toBe('AppIcon')
  })

  it('points the product reference at the built app', () => {
    const root = parsed()
    const target = objectsOfKind(root, 'PBXNativeTarget')[0]!
    const product = objectsOf(root)[target.productReference as string]!

    expect(product.path).toBe(`${SAMPLE.manifest.name}.app`)
    expect(product.sourceTree).toBe('BUILT_PRODUCTS_DIR')
  })
})

describe('determinism', () => {
  it('produces byte-identical output for the same project', () => {
    // Reproducible exports are what make the output diffable, and what make every
    // test above meaningful rather than a snapshot of one lucky run.
    expect(generatePbxproj(SAMPLE).pbxproj).toBe(generatePbxproj(SAMPLE).pbxproj)
  })

  it('does not depend on file ordering in the project', () => {
    const reversed = projectWith([...SAMPLE.files].reverse())
    expect(generatePbxproj(reversed).pbxproj).toBe(generatePbxproj(SAMPLE).pbxproj)
  })

  it('changes when a file is added', () => {
    const extra = projectWith([...SAMPLE.files, { id: 'Sources/New.swift', text: '' }])
    expect(generatePbxproj(extra).pbxproj).not.toBe(generatePbxproj(SAMPLE).pbxproj)
  })

  it('does not change when only file *contents* change', () => {
    // The project describes structure; edited source must not churn the pbxproj.
    const edited = projectWith(SAMPLE.files.map((f) => ({ ...f, text: `${f.text}// edited\n` })))
    expect(generatePbxproj(edited).pbxproj).toBe(generatePbxproj(SAMPLE).pbxproj)
  })
})

describe('IdAllocator', () => {
  it('is stable across instances', () => {
    expect(new IdAllocator().id('target')).toBe(new IdAllocator().id('target'))
  })

  it('gives different keys different ids', () => {
    const ids = new IdAllocator()
    expect(ids.id('a')).not.toBe(ids.id('b'))
  })

  it('never repeats an id, even under a collision', () => {
    const ids = new IdAllocator()
    const seen = new Set<string>()
    for (let i = 0; i < 5_000; i++) seen.add(ids.id(`key-${i}`))
    expect(seen.size).toBe(5_000)
  })

  it('produces 24 uppercase hex characters', () => {
    expect(new IdAllocator().id('anything')).toMatch(/^[0-9A-F]{24}$/)
  })
})
