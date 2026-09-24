/** The part of pngjs the tests read images with; the package ships no types. */
declare module 'pngjs' {
  export const PNG: { readonly sync: { read(data: Buffer): { readonly width: number; readonly height: number; readonly data: Buffer } } }
}
