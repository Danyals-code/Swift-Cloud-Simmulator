import { FONT_LIMITS, fontAsset, type FontAsset, type ImageAsset } from '@studio/project-model'
import { replaceProjectFonts, type PreviewFontAsset, type ProjectFontFile } from '@studio/shared'
import { importImageFiles } from './images'

/** A project font face as the panels name and offer it: what `.custom(name)` matches, without its metrics or file. */
export type ProjectFace = Pick<PreviewFontAsset, 'postScriptName' | 'family' | 'weight' | 'italic'>

/** Whether a picked or dropped file is a font file Assets takes: by its extension, or the type a browser gave it. */
const isFontFile = (file: File) => /\.(ttf|otf)$/i.test(file.name) || ['font/ttf', 'font/otf', 'font/sfnt', 'application/x-font-ttf', 'application/x-font-otf'].includes(file.type)

/** A drop's font files, and everything else in it, which goes to the images path as before. */
export function fontFiles(files: readonly File[]): { fonts: File[]; others: File[] } {
  const fonts: File[] = [], others: File[] = []
  for (const file of files) (isFontFile(file) ? fonts : others).push(file)
  return { fonts, others }
}

/**
 * Font files from a picker or a drop, read for their names, ready to add to Assets.
 *
 * Each file is checked on its own, as images are: one that can't be read is reported with
 * the reason `readFont` gives, and the rest still come in. A face the project already has,
 * by PostScript name, and a file past the project's count or total size, are refused here
 * rather than by the project's check, so the designer learns which file it was and the
 * rest of the drop still comes in.
 */
export async function importFontFiles(files: readonly File[], existing: readonly Pick<FontAsset, 'postScriptName' | 'bytes'>[]): Promise<{ added: FontAsset[]; problems: string[] }> {
  const added: FontAsset[] = [], problems: string[] = []
  const names = new Set(existing.map(font => font.postScriptName.toLowerCase()))
  let total = existing.reduce((sum, font) => sum + font.bytes.length, 0)
  for (const file of files) {
    if (file.size > FONT_LIMITS.fileBytes) { problems.push(`${file.name} is larger than ${FONT_LIMITS.fileBytes / 1024 / 1024} MB.`); continue }
    if (existing.length + added.length >= FONT_LIMITS.count) { problems.push(`${file.name}: A project can contain up to ${FONT_LIMITS.count} fonts.`); continue }
    if (total + file.size > FONT_LIMITS.totalBytes) { problems.push(`${file.name}: Project fonts must total no more than ${FONT_LIMITS.totalBytes / 1024 / 1024} MB.`); continue }
    try {
      const font = fontAsset(crypto.randomUUID(), new Uint8Array(await file.arrayBuffer()))
      if (names.has(font.postScriptName.toLowerCase())) { problems.push(`${file.name}: ${font.postScriptName} is already in Assets.`); continue }
      names.add(font.postScriptName.toLowerCase())
      total += font.bytes.length
      added.push(font)
    } catch (error) {
      problems.push(`${file.name}: ${error instanceof Error ? error.message : 'it could not be read.'}`)
    }
  }
  return { added, problems }
}

/**
 * A picked or dropped set of files for Assets: the font files read for their names, and
 * everything else as images. Each file is refused on its own, with its reason, so fonts
 * past the project's limits don't keep out the images that came with them.
 */
export async function importAssetFiles(files: readonly File[], project: { readonly assets: readonly Pick<ImageAsset, 'name'>[]; readonly fonts: readonly Pick<FontAsset, 'postScriptName' | 'bytes'>[] }): Promise<{ fonts: FontAsset[]; images: ImageAsset[]; problems: string[] }> {
  const split = fontFiles(files)
  const fonts = split.fonts.length ? await importFontFiles(split.fonts, project.fonts) : { added: [], problems: [] }
  const images = split.others.length ? await importImageFiles(split.others, project.assets) : { added: [], problems: [] }
  return { fonts: fonts.added, images: images.added, problems: [...fonts.problems, ...images.problems] }
}

/** Style names by CSS weight, as font menus on Apple platforms say them. */
const STYLES: Readonly<Record<number, string>> = { 100: 'Thin', 200: 'Ultralight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Heavy', 900: 'Black' }

/** A face as a font menu names it: its family, then its style, `Brand Semibold Italic`, or `Brand Italic` for the regular weight. */
export function fontLabel(font: ProjectFace): string {
  const weight = STYLES[Math.min(900, Math.max(100, Math.round(font.weight / 100) * 100))]!
  return `${font.family} ${font.italic ? weight === 'Regular' ? 'Italic' : `${weight} Italic` : weight}`
}

export interface FamilyOption { readonly value: string; readonly label: string }

/**
 * The Family select's choices after System: the project's faces, by family then weight,
 * each writing its PostScript name, since one file is one face; then iOS's own families
 * by name. `written` is a name in the code that is in neither list, such as a family
 * name of a project font, so the select can still show what the text uses.
 */
export function familyOptions(fonts: readonly ProjectFace[], iosFamilies: readonly string[], face?: string | null): { project: FamilyOption[]; ios: FamilyOption[]; written?: FamilyOption } {
  const project = fonts.slice().sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight || Number(a.italic) - Number(b.italic))
    .map(font => ({ value: font.postScriptName, label: fontLabel(font) }))
  const ios = iosFamilies.map(family => ({ value: family, label: family }))
  const known = !face || project.some(option => option.value === face) || iosFamilies.includes(face)
  return { project, ios, ...known ? {} : { written: { value: face, label: face } } }
}

/**
 * What a compile is told about the project's fonts: names, weight, slant and metrics. The
 * bytes go to the worker once, through `setProjectFonts`, rather than with every compile.
 */
export function previewFonts(fonts: readonly PreviewFontAsset[] | undefined): PreviewFontAsset[] | undefined {
  if (!fonts?.length) return undefined
  return fonts.map(({ postScriptName, family, weight, italic, metrics }) => ({ postScriptName, family, weight, italic, metrics }))
}

/** The files the page last registered, and when they are ready. */
let page: { readonly fonts: readonly ProjectFontFile[]; readonly ready: Promise<unknown> } | undefined

/**
 * Registers the project's font files in the page's `document.fonts`, where the canvas draws
 * text and `measureTextBatch` measures it, in place of the last set. Every compiler on the
 * page shares the one set, so the same files are registered once however many ask.
 */
export function pageFonts(fonts: readonly ProjectFontFile[]): Promise<unknown> {
  if (page?.fonts !== fonts) page = { fonts, ready: replaceProjectFonts(document.fonts, fonts) }
  return page.ready
}
