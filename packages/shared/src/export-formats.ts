/**
 * The export formats, as data.
 *
 * In `shared` rather than in the exporter because the toolbar needs the *list* - four
 * names and four descriptions - while the code that builds a `.xcodeproj` is thirty
 * kilobytes that only runs when someone clicks. Keeping the menu here is what lets the
 * generator load on demand instead of on first paint.
 */

export type ExportFormat = 'xcodeproj' | 'swiftpm' | 'spm' | 'xcodegen'

export interface FormatInfo {
  readonly id: ExportFormat
  readonly name: string
  /** One line, shown beside the choice. */
  readonly description: string
  /**
   * What the archive holds, in the words a Swift developer already knows.
   *
   * The menu shows this rather than the sentence: four rows each ending in a
   * different clause are four rows nobody finishes reading, and the file name
   * answers "which one is this" faster than any description of it can.
   */
  readonly shortName: string
  /** What the download is called, minus the project name. */
  readonly suffix: string
}

export const EXPORT_FORMATS: readonly FormatInfo[] = [
  {
    id: 'xcodeproj',
    name: 'Xcode project',
    description: 'Open on a Mac and press Run.',
    shortName: '.xcodeproj',
    suffix: '.zip',
  },
  {
    id: 'swiftpm',
    name: 'Swift Playgrounds',
    description: 'An app package that builds and runs on iPad.',
    shortName: '.swiftpm',
    suffix: '-swiftpm.zip',
  },
  {
    id: 'spm',
    name: 'Swift package',
    description: 'Package.swift, for the command line or as a dependency.',
    shortName: 'Package.swift',
    suffix: '-package.zip',
  },
  {
    id: 'xcodegen',
    name: 'XcodeGen spec',
    description: 'project.yml - generate the .xcodeproj rather than commit it.',
    shortName: 'project.yml',
    suffix: '-xcodegen.zip',
  },
]
