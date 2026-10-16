/**
 * The symbol picker's categories and search. The categories are the studio's own groups,
 * one to a symbol, where the SF Symbols app files a symbol under several of its categories.
 * Four take the app's names because the app files every one of their symbols there too
 * (Human, Arrows, Privacy & Security, Objects & Tools); the rest are the studio's, some
 * sharing a word with an app category but holding more (Media has cameras and photos).
 *
 * A category is a list of name prefixes, the more common first, and a symbol belongs to
 * the category of the longest prefix it starts with ("square.and.arrow" is Arrows, "square"
 * is Shapes). Prefixes are whole dotted parts, so "car" never takes "cart". Only prefixes a
 * drawn symbol has are listed; the test says when a new symbol has none.
 */
const CATEGORIES: readonly (readonly [string, string])[] = [
  ['Essentials', 'house magnifyingglass gear gearshape bell heart star bookmark plus minus xmark checkmark info questionmark exclamationmark ellipsis sparkles multiply divide equal at'],
  ['Human', 'person face hand'],
  ['Arrows', 'chevron arrow square.and.arrow rectangle.portrait.and.arrow'],
  ['Communication', 'message bubble text.bubble quote.bubble ellipsis.bubble exclamationmark.bubble plus.bubble paperplane envelope phone video mic'],
  ['Media', 'play pause stop playpause forward backward shuffle repeat music speaker headphones radio waveform film tv camera photo viewfinder livephoto'],
  ['Editing', 'trash pencil square.and.pencil crop wand slider line list text textformat scissors paintbrush paintpalette eyedropper swatchpalette'],
  ['Documents', 'doc clipboard list.clipboard list.bullet.clipboard folder archivebox tray externaldrive internaldrive icloud server link paperclip printer qrcode barcode book books text.book.closed newspaper magazine note checklist graduationcap number 1 2 chart rectangle.on.rectangle'],
  ['Time', 'calendar clock alarm timer stopwatch hourglass'],
  ['Commerce', 'cart bag basket creditcard banknote dollarsign eurosign yensign gift tag ticket storefront wallet receipt percent'],
  ['Travel', 'location map mappin globe network signpost scope safari airplane car bus tram train bicycle ferry sailboat suitcase'],
  ['Weather & Nature', 'cloud sun moon snowflake thermometer umbrella flame bolt drop leaf tree sunrise sunset mountain'],
  ['Health & Fitness', 'cross pills pill bandage medical brain heart.text.square waveform.path.ecg figure dumbbell soccerball basketball football tennis tennisball baseball'],
  ['Privacy & Security', 'lock key shield checkmark.shield xmark.shield eye hand.raised touchid nosign'],
  ['Devices', 'iphone ipad laptopcomputer desktopcomputer applewatch keyboard gamecontroller macbook display wifi battery antenna dot.radiowaves cellularbars power restart lightbulb flashlight cpu memorychip'],
  ['Home & Food', 'house.lodge building bed cup mug fork.knife takeoutbag wineglass carrot'],
  ['Objects & Tools', 'tshirt eyeglasses sunglasses hammer wrench puzzlepiece crown trophy medal rosette flag pin cube shippingbox gauge speedometer'],
  ['Shapes', 'circle square rectangle triangle diamond hexagon octagon seal app largecircle record sidebar square.grid rectangle.grid'],
]

export const SYMBOL_CATEGORIES: readonly string[] = CATEGORIES.map(([label]) => label)

/** Each prefix with its category and its place in the picker's order, built once. */
const PREFIXES = new Map<string, { category: number; order: number }>()
CATEGORIES.forEach(([, prefixes], category) => prefixes.split(' ').forEach(prefix => PREFIXES.set(prefix, { category, order: PREFIXES.size })))

/** The prefix a name belongs under: the longest one it starts with, as whole parts. */
function prefixOf(name: string) {
  for (let parts = name.split('.'), count = parts.length; count > 0; count--) {
    const found = PREFIXES.get(parts.slice(0, count).join('.'))
    if (found) return found
  }
  return undefined
}

export function symbolCategory(name: string): string | undefined {
  const found = prefixOf(name)
  return found && SYMBOL_CATEGORIES[found.category]
}

/** Everyday words for what a symbol is, which its name doesn't say, each with the start of the names it finds. */
const WORDS: Readonly<Record<string, string>> = {
  settings: 'gear', home: 'house', search: 'magnifyingglass', delete: 'trash', close: 'xmark', add: 'plus', done: 'checkmark', edit: 'pencil', share: 'square.and.arrow.up',
  profile: 'person', user: 'person', like: 'heart', favorite: 'star', menu: 'line.3.horizontal', more: 'ellipsis', back: 'chevron', chat: 'message', call: 'phone', mail: 'envelope',
  image: 'photo', notification: 'bell', place: 'mappin', money: 'dollarsign', pay: 'creditcard', time: 'clock', save: 'bookmark', download: 'arrow.down', refresh: 'arrow.clockwise',
  filter: 'line.3.horizontal.decrease', food: 'fork.knife', shop: 'cart', workout: 'figure', help: 'questionmark', password: 'lock',
}

/** Whether a typed word starts one of a name's parts, as "gear" starts gearshape and "up" doesn't match cup. */
const startsPart = (parts: readonly string[], word: string) => parts.some(part => part.startsWith(word))

/**
 * The names to show for a search and a category, in the picker's order: by category, by
 * how common the kind is, then plainest first (heart before heart.fill). Every typed word
 * must start a part of the name, or of its category's name, or be an everyday word for it
 * ("settings" finds gear). The name typed in full comes first, then names that start with
 * the whole search.
 */
export function findSymbols(names: readonly string[], query: string, category: string | null): string[] {
  const typed = query.trim().toLowerCase().replaceAll('.', ' ').split(/\s+/).filter(Boolean)
  const phrase = typed.join('.')
  const ranked: { name: string; starts: number; category: number; order: number; parts: number }[] = []
  for (const name of names) {
    const found = prefixOf(name)
    if (!found || (category && SYMBOL_CATEGORIES[found.category] !== category)) continue
    const parts = name.split('.'), label = SYMBOL_CATEGORIES[found.category]!.toLowerCase().split(' ')
    const matches = (word: string) => startsPart(parts, word) || startsPart(label, word) || (Object.hasOwn(WORDS, word) && name.startsWith(WORDS[word]!))
    if (typed.every(matches)) ranked.push({ name, starts: name === phrase ? 0 : name.startsWith(phrase) ? 1 : 2, category: found.category, order: found.order, parts: parts.length })
  }
  return ranked.sort((a, b) => a.starts - b.starts || a.category - b.category || a.order - b.order || a.parts - b.parts || a.name.length - b.name.length || (a.name < b.name ? -1 : 1)).map(entry => entry.name)
}
