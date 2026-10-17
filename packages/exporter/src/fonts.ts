import { fontFileName, type Project } from '@studio/project-model'
import type { ExportFormat } from '@studio/shared'
import { encodeText } from './bundle'

/**
 * A project's font files in an export (Wave 6f). iOS loads a bundled font only when the
 * app's Info.plist lists it in `UIAppFonts`, a key no `INFOPLIST_KEY_*` setting can write,
 * so the Xcode formats get a real Info.plist holding just that key, named by
 * `INFOPLIST_FILE`, which Xcode merges with the one it still generates.
 */
/** Where a format keeps its font files below its sources: a package's go in `Resources`, which its manifest processes. */
export const fontFolder = (format: ExportFormat, sources: string): string => `${sources}/${format === 'spm' || format === 'swiftpm' ? 'Resources/' : ''}Fonts`

export function putFonts(project: Project, folder: string, put: (path: string, bytes: Uint8Array) => void): void {
  for (const font of project.fonts ?? []) put(`${folder}/${fontFileName(font)}`, font.bytes.slice())
}

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The Info.plist that lists the fonts, which sit at the bundle's top level. */
function appFontsPlist(project: Project): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>UIAppFonts</key>
\t<array>
${(project.fonts ?? []).map(font => `\t\t<string>${xml(fontFileName(font))}</string>\n`).join('')}\t</array>
</dict>
</plist>
`
}

/** The fonts for a bundle's Info.plist, or nothing to write when there are none. */
export const appFonts = (project: Project): Uint8Array | null => project.fonts?.length ? encodeText(appFontsPlist(project)) : null
