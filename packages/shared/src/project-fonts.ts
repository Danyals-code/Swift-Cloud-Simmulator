import type { PreviewFontAsset, ProjectFontFile } from './protocol'

/**
 * The project's own font files (Wave 6f), as `.custom(name, size:)` finds them and the page
 * and the worker draw them. The main thread and the worker each register the files here, so
 * the two can't name a face differently.
 */

/**
 * The face `.custom(name, …)` draws from the project's fonts: the one whose PostScript name
 * it is, or else one of the family it names, the face nearest regular weight and upright
 * first. Undefined for a name the project has no file for.
 */
export function projectFont(name: string, fonts: readonly PreviewFontAsset[] | undefined): PreviewFontAsset | undefined {
  let best: PreviewFontAsset | undefined
  for (const font of fonts ?? []) {
    if (font.postScriptName === name) return font
    if (font.family === name && (!best || rank(font) < rank(best))) best = font
  }
  return best
}

const rank = (font: PreviewFontAsset) => Math.abs(font.weight - 400) + (font.italic ? 1000 : 0)

/**
 * The CSS family a project font family is drawn as: every face of it under one name, with
 * its weight and style, so `.bold()` on `.custom("Brand", …)` draws the Brand-Bold file as
 * iOS picks the family's bold face. A prefix keeps it apart from a font of that name the
 * computer has.
 */
export function projectFontFamily(family: string): string {
  return `Studio Font ${family.replace(/["\\]/g, '')}`
}

const NO_FAMILIES: ReadonlyMap<string, PreviewFontAsset> = /*#__PURE__*/ new Map()

/**
 * Each project font family by the CSS family it is drawn as, with the face `.custom(family)`
 * draws: the one whose metrics stand for the family's line. Empty, and allocated once, when
 * the project has no fonts.
 */
export function projectFamilies(fonts: readonly PreviewFontAsset[] | undefined): ReadonlyMap<string, PreviewFontAsset> {
  if (!fonts?.length) return NO_FAMILIES
  const families = new Map<string, PreviewFontAsset>()
  for (const font of fonts) {
    const name = projectFontFamily(font.family)
    if (!families.has(name)) families.set(name, projectFont(font.family, fonts)!)
  }
  return families
}

/** What this needs of the DOM's `FontFace` and `FontFaceSet`, which `shared` is compiled without. */
interface Face { load(): Promise<unknown> }
interface FaceSet { add(face: Face): unknown; delete(face: Face): unknown }
declare const FontFace: new (family: string, source: Uint8Array, descriptors: { weight: string; style: string }) => Face

/** The faces each set was given last, so the next call replaces them. */
const added = /*#__PURE__*/ new WeakMap<FaceSet, Face[]>()

/**
 * Registers the project's font files in `document.fonts` or a worker's `self.fonts`, in
 * place of those registered there before, and gives back the files that loaded. A file the
 * browser can't load is left out, and its text draws in the faces behind it in the stack.
 */
export async function replaceProjectFonts(set: FaceSet, files: readonly ProjectFontFile[]): Promise<readonly ProjectFontFile[]> {
  for (const face of added.get(set) ?? []) set.delete(face)
  const faces = files.map(file => new FontFace(projectFontFamily(file.family), file.bytes, { weight: String(file.weight), style: file.italic ? 'italic' : 'normal' }))
  added.set(set, faces)
  const loaded = await Promise.all(faces.map((face, index) => face.load().then(() => { set.add(face); return files[index] }, () => undefined)))
  return loaded.filter(file => file !== undefined)
}
