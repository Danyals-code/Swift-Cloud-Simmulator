/**
 * The built-in image library (Wave 7b): photos every project can draw by name, served from
 * `apps/web/public/library/v1/` and never stored in `project.assets`.
 *
 * A JS constant rather than a fetched JSON file, because the preview needs the names and sizes
 * synchronously at compile time and tests need them without a network. `v1` is immutable: names
 * are permanent and new bytes go in a `v2/` folder, so older tabs keep working.
 *
 * Sizes are in pixels; every image is `scale: 3`, so an unresized `Image("snowy-peak")` is
 * 227x341 pt in the preview and the export fills the imageset's 3x slot. The alt text gives the
 * aspect ratio, and describes people only by what the photo shows, never by name.
 */
export interface LibraryImage {
  readonly name: string
  readonly width: number
  readonly height: number
  readonly scale: 3
  readonly alt: string
}

export const LIBRARY_PATH = '/library/v1/'

export const LIBRARY_IMAGES: readonly LibraryImage[] = [
  { name: 'blue-mosaic', width: 1200, height: 1834, scale: 3, alt: 'Ornate ceiling of blue, white and amber painted tiles in a geometric star pattern. Portrait, about 2:3.' },
  { name: 'terracotta-figures', width: 532, height: 800, scale: 3, alt: 'Rows of terracotta warrior statues standing in an excavated earth pit. Portrait, 2:3.' },
  { name: 'stone-circle-moon', width: 736, height: 1105, scale: 3, alt: 'Ancient standing-stone circle at dusk under a full moon and pink clouds, a grassy field in front. Portrait, 2:3.' },
  { name: 'giant-redwoods', width: 735, height: 918, scale: 3, alt: 'Towering red trunks of giant sequoias in hazy light, a tiny hiker between them for scale. Portrait, 4:5.' },
  { name: 'arch-view', width: 600, height: 900, scale: 3, alt: 'Scalloped white marble arch framing a domed white mausoleum across a river, blue sky. Portrait, 2:3. Photographer watermark bottom right.' },
  { name: 'portrait-card-table', width: 303, height: 348, scale: 3, alt: 'Film still of a smiling man in a yellow jacket at a casino table with chips, men in suits behind. About 7:8; small, use at thumbnail size.' },
  { name: 'portrait-sword', width: 1200, height: 1801, scale: 3, alt: 'Black-and-white photo of a bearded man seated on a mat raising a long sword, a suit of samurai armor beside him. Portrait, 2:3.' },
  { name: 'portrait-village', width: 895, height: 1114, scale: 3, alt: 'Two older men outside a wooden building with green lattice windows in warm evening light, one holding out a cigarette. Portrait, 4:5.' },
  { name: 'red-roof-house', width: 680, height: 1002, scale: 3, alt: 'Lone white house with a red roof on green grass by a dark blue sea, low hills beyond. Portrait, 2:3.' },
  { name: 'sea-tram', width: 736, height: 736, scale: 3, alt: 'Small yellow tram car on an elevated rail above a calm blue sea, framed by pines. Square, 1:1.' },
  { name: 'red-bus-bridge', width: 1200, height: 1500, scale: 3, alt: 'Motion-blurred red double-decker bus crossing an ornate stone bridge with a lamp post, at sunset. Portrait, 4:5.' },
  { name: 'portrait-press', width: 402, height: 612, scale: 3, alt: 'Man in glasses, a gray suit and a dark tie at a bank of microphones, a patterned mural behind. Portrait, 2:3.' },
  { name: 'basketball-player', width: 564, height: 1002, scale: 3, alt: 'Basketball player in a red team jersey with the number 23, crowd blurred behind. Tall, about 9:16. Team logos visible.' },
  { name: 'portrait-pipe', width: 1200, height: 1797, scale: 3, alt: 'Black-and-white photo of a man in a tweed jacket lighting a pipe in front of bookshelves. Portrait, 2:3.' },
  { name: 'snowy-peak', width: 681, height: 1024, scale: 3, alt: 'Snow-covered pyramid-shaped mountain peak under a deep blue sky, rocky moraine in front. Portrait, 2:3. Photographer watermark bottom right.' },
]

/** The library image `Image("name")` names, matched exactly as the preview's `bitmapOf` matches. */
export function libraryImage(name: string): LibraryImage | undefined {
  return LIBRARY_IMAGES.find(image => image.name === name)
}

/** Where the full image is served, same-origin, the only non-`data:` URL the preview draws. */
export const libraryImageURL = (name: string) => `${LIBRARY_PATH}${name}.jpg`
/** The 160 px thumbnail the Assets panel lists. */
export const libraryThumbURL = (name: string) => `${LIBRARY_PATH}thumbs/${name}.jpg`
