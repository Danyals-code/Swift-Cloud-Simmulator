import { describe, expect, it } from 'vitest'
import {
  addFolder,
  buildFileTree,
  dirname,
  duplicateFile,
  folderPaths,
  isInFolder,
  moveFile,
  normalizeFileName,
  normalizeFolderPath,
  removeFolder,
  renameFolder,
  uniqueFileId,
  type Project,
} from './types'

/**
 * Groups.
 *
 * The model has always stored full paths, so the hierarchy was representable long
 * before anything drew it. What these cover is the part that is not representable
 * by a path - an empty group - and the operations where a path being a *string*
 * makes a plausible implementation quietly wrong: renaming a group has to carry its
 * descendants, and `Sources/Model` must not be treated as living inside
 * `Sources/Models`.
 */

function project(ids: readonly string[], folders?: readonly string[]): Project {
  return {
    id: 'test',
    manifest: {
      name: 'App',
      bundleId: 'com.example.App',
      deploymentTarget: '17.0',
      device: 'iphone-15',
      colorScheme: 'light',
    },
    files: ids.map((id) => ({ id, text: `// ${id}\n` })),
    ...(folders ? { folders } : {}),
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('normalizeFileName', () => {
  it('roots a bare name under Sources', () => {
    expect(normalizeFileName('Badge')).toBe('Sources/Badge.swift')
    expect(normalizeFileName('Badge.swift')).toBe('Sources/Badge.swift')
  })

  it('keeps a typed path inside Sources rather than beside it', () => {
    // The bug this replaced: `Models/Item` became a sibling of `Sources`, so it
    // exported to a different place in the target than every other file.
    expect(normalizeFileName('Models/Item')).toBe('Sources/Models/Item.swift')
  })

  it('does not double the prefix on a name that already has it', () => {
    expect(normalizeFileName('Sources/Models/Item.swift')).toBe('Sources/Models/Item.swift')
  })

  it('creates inside the parent group when one is given', () => {
    expect(normalizeFileName('Trail', 'Sources/Models')).toBe('Sources/Models/Trail.swift')
  })

  it('rejects anything that would escape the project', () => {
    expect(normalizeFileName('../outside')).toBeNull()
    expect(normalizeFileName('')).toBeNull()
    expect(normalizeFileName('   ')).toBeNull()
    expect(normalizeFileName('bad<name>')).toBeNull()
    expect(normalizeFileName('a//b')).toBeNull()
    expect(normalizeFileName('.')).toBeNull()
  })
})

describe('normalizeFolderPath', () => {
  it('roots a group under Sources and nests under a parent', () => {
    expect(normalizeFolderPath('Models')).toBe('Sources/Models')
    expect(normalizeFolderPath('Discover', 'Sources/Features')).toBe(
      'Sources/Features/Discover',
    )
  })

  it('refuses a group named like a source file', () => {
    // Otherwise a group and a file could occupy the same path.
    expect(normalizeFolderPath('Models.swift')).toBeNull()
  })
})

describe('folderPaths', () => {
  it('derives every intermediate folder from the files', () => {
    const p = project(['Sources/Features/Discover/View.swift'])
    expect(folderPaths(p)).toEqual([
      'Sources',
      'Sources/Features',
      'Sources/Features/Discover',
    ])
  })

  it('includes empty groups, which no path implies', () => {
    const p = project(['Sources/App.swift'], ['Sources/Models'])
    expect(folderPaths(p)).toContain('Sources/Models')
  })
})

describe('isInFolder', () => {
  it('does not treat a prefix match as containment', () => {
    expect(isInFolder('Sources/Models/A.swift', 'Sources/Models')).toBe(true)
    expect(isInFolder('Sources/Model', 'Sources/Models')).toBe(false)
    expect(isInFolder('Sources/ModelsExtra/A.swift', 'Sources/Models')).toBe(false)
  })
})

describe('addFolder', () => {
  it('records an empty group', () => {
    const p = addFolder(project(['Sources/App.swift']), 'Sources/Models')
    expect(p.folders).toEqual(['Sources/Models'])
  })

  it('is a no-op for a group that already exists in either form', () => {
    const implied = project(['Sources/Models/A.swift'])
    expect(addFolder(implied, 'Sources/Models')).toBe(implied)

    const recorded = project(['Sources/App.swift'], ['Sources/Models'])
    expect(addFolder(recorded, 'Sources/Models')).toBe(recorded)
  })
})

describe('renameFolder', () => {
  it('carries every descendant file and sub-group', () => {
    const p = renameFolder(
      project(
        ['Sources/Features/Discover/View.swift', 'Sources/App.swift'],
        ['Sources/Features/Empty'],
      ),
      'Sources/Features',
      'Sources/Screens',
    )

    expect(p.files.map((f) => f.id).sort()).toEqual([
      'Sources/App.swift',
      'Sources/Screens/Discover/View.swift',
    ])
    expect(p.folders).toEqual(['Sources/Screens/Empty'])
  })

  it('refuses a destination that already exists rather than merging', () => {
    const p = project(['Sources/A/x.swift', 'Sources/B/y.swift'])
    expect(renameFolder(p, 'Sources/A', 'Sources/B')).toBe(p)
  })

  it('refuses to move a group inside itself', () => {
    const p = project(['Sources/A/x.swift'])
    expect(renameFolder(p, 'Sources/A', 'Sources/A/B')).toBe(p)
  })
})

describe('removeFolder', () => {
  it('removes the group and everything under it', () => {
    const p = removeFolder(
      project(['Sources/App.swift', 'Sources/Old/a.swift', 'Sources/Old/b.swift']),
      'Sources/Old',
    )
    expect(p.files.map((f) => f.id)).toEqual(['Sources/App.swift'])
  })

  it('refuses when that would empty the project', () => {
    // Same invariant `removeFile` keeps: a project with no sources has nothing to
    // show and no way back, and undo does not exist yet.
    const p = project(['Sources/Only/a.swift'])
    expect(removeFolder(p, 'Sources/Only')).toBe(p)
  })
})

describe('uniqueFileId and moveFile', () => {
  it('numbers around a collision', () => {
    const p = project(['Sources/A.swift', 'Sources/A 2.swift'])
    expect(uniqueFileId(p, 'Sources/A.swift')).toBe('Sources/A 3.swift')
  })

  it('moves a file into a group', () => {
    const p = moveFile(project(['Sources/A.swift']), 'Sources/A.swift', 'Sources/Models')
    expect(p.files.map((f) => f.id)).toEqual(['Sources/Models/A.swift'])
  })

  it('renames around a name already taken in the destination', () => {
    const p = moveFile(
      project(['Sources/A.swift', 'Sources/Models/A.swift']),
      'Sources/A.swift',
      'Sources/Models',
    )
    expect(p.files.map((f) => f.id).sort()).toEqual([
      'Sources/Models/A 2.swift',
      'Sources/Models/A.swift',
    ])
  })

  it('leaves the project alone when the file is already there', () => {
    const p = project(['Sources/Models/A.swift'])
    expect(moveFile(p, 'Sources/Models/A.swift', 'Sources/Models')).toBe(p)
  })
})

describe('duplicateFile', () => {
  it('copies the text under an unused name beside the original', () => {
    const p = duplicateFile(project(['Sources/A.swift']), 'Sources/A.swift')
    expect(p.files).toHaveLength(2)
    expect(p.files[1]!.id).toBe('Sources/A 2.swift')
    expect(p.files[1]!.text).toBe(p.files[0]!.text)
  })
})

describe('buildFileTree', () => {
  it('nests files under the groups their paths name', () => {
    const tree = buildFileTree(
      project(['Sources/App.swift', 'Sources/Models/Trail.swift'], ['Sources/Empty']),
    )

    expect(tree).toHaveLength(1)
    const sources = tree[0]!
    expect(sources.kind).toBe('folder')
    if (sources.kind !== 'folder') return

    // Groups before files, each sorted by name.
    expect(sources.children.map((n) => n.name)).toEqual(['Empty', 'Models', 'App.swift'])

    const models = sources.children[1]!
    expect(models.kind).toBe('folder')
    if (models.kind !== 'folder') return
    expect(models.children.map((n) => n.name)).toEqual(['Trail.swift'])
  })
})

describe('dirname', () => {
  it('is the folder a path sits in', () => {
    expect(dirname('Sources/Models/A.swift')).toBe('Sources/Models')
    expect(dirname('A.swift')).toBe('')
  })
})

it('avoids case and Unicode collisions when importing or moving files', async () => {
  const { projectFromFiles, moveFile, applyProjectTransaction } = await import('./index')
  const project = projectFromFiles([
    { name: 'A/Home.swift', text: '// A' },
    { name: 'B/home.swift', text: '// B' },
    { name: 'Café.swift', text: '// composed' },
    { name: 'Cafe\u0301.swift', text: '// decomposed' },
  ])!
  expect(project.files[3]!.id).toBe('Sources/Cafe\u0301 2.swift')
  const moved = moveFile(project, 'Sources/B/home.swift', 'Sources/A')
  expect(moved.files[1]!.id).toBe('Sources/A/home 2.swift')
  expect(applyProjectTransaction(project, 1, { projectId: project.id, baseRevision: 1, changes: [{ file: 'Sources/A/HOME.swift', before: null, after: '// conflict' }] })).toMatchObject({ ok: false })
})
