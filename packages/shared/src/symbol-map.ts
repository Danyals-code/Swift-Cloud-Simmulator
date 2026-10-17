/**
 * The SF Symbol names the preview draws, as look-alikes, and how (Wave 6b). No Apple artwork
 * is included; every substitution is approximate.
 *
 * One line a name, `name|icon|flags|viewBox|widthEm|heightEm`, trailing fields left out, parsed
 * once: about a third smaller than an object literal a name. The icon is an Ionicons id in the
 * sprite, or `#name` for a drawing in `swiftui-render-dom`'s `symbols.ts`.
 * Flags:
 * - `p` draws `name` with the icon's `-outline` form, and adds `name.fill` with the icon itself;
 * - `c`, `s`, `o`, `w`, `u` and `h` enclose the icon in a circle, square, octagon, seal, speech
 *   bubble or shield, `f` filling it;
 * - `m` mirrors the icon, `v` turns it upside down, and `r` turns it a quarter clockwise;
 * - `/` strikes it through, as `.slash` does;
 * - `b`, `+` and `k` add a dot, plus or checkmark badge in its corner, `t` the top one;
 * - `2` marks a drawing with layers of its own.
 */
const TABLE = `
square.and.pencil.circle|#squareandpencil|c
mug.fill|#mugfill
chart.bar.fill|#chartbarfill||-24 0 560 512|1.29
rectangle.on.rectangle|copy|p
book|book|p
book.closed|#bookclosed
book.closed.fill|#bookclosedfill
shippingbox|cube|p
suitcase|#suitcase
suitcase.fill|briefcase
cup.and.saucer|cafe-outline
cup.and.saucer.fill|#cupandsaucerfill||-40 0 592 512|1.36
books.vertical|library|p
mountain.2|#mountains
snowflake|snow-outline
tree|#tree
trash|trash|p
chevron.left|chevron-back||144 80 224 352|0.7|1.1
chevron.right|chevron-forward||144 80 224 352|0.7|1.1
chevron.up|chevron-up
chevron.down|chevron-down
chevron.left.slash.chevron.right|code-slash
arrow.left|arrow-back
arrow.right|arrow-forward
arrow.up|arrow-up
arrow.down|arrow-down
arrow.clockwise|refresh
arrow.counterclockwise|refresh|m
arrow.uturn.backward|#arrowuturnbackward
arrow.uturn.forward|#arrowuturnbackward|m
xmark|close
checkmark|checkmark
plus|add
minus|remove
multiply|close
ellipsis|ellipsis-horizontal
line.3.horizontal|menu
magnifyingglass|search
pencil|pencil
square.and.pencil|#squareandpencil
music.note|musical-note
link|link
at|at
number|#number
paperclip|attach
waveform|#waveform
thermometer|#thermometer
iphone|phone-portrait
tv|tv
keyboard|#keyboard
airplane|airplane
chart.pie|#chartpie
chart.bar|#chartbar||-24 0 560 512|1.29
chart.line.uptrend.xyaxis|#chartlineuptrendxyaxis
list.bullet|list
list.dash|list
slider.horizontal.3|options
square.grid.2x2|#squaregrid2x2
text.alignleft|#alignleft
text.aligncenter|#aligncenter
text.alignright|#alignright
percent|#percent
divide|#divide
equal|#equal
chevron.up.chevron.down|#chevrons
arrow.up.arrow.down|swap-vertical
arrow.up.right|#arrowupright
arrow.down.left|#arrowdownleft
star|star|p
heart|heart|p
circle|ellipse|p
square|square|p
triangle|triangle|p
diamond|#diamond
diamond.fill|#diamondfill
person|person|p
person.2|people|p
person.3|people|p
house|home|p
gear|settings-outline
gearshape|settings|p
folder|folder|p
doc|document|p
doc.text|document-text|p
paperplane|paper-plane|p
envelope|mail|p
envelope.open|mail-open|p
bell|notifications|p
bell.slash|notifications-off|p
calendar|calendar-outline
clock|time|p
timer|timer-outline
bookmark|bookmark|p
tag|pricetag|p
bolt|flash|p
bolt.slash|flash-off|p
flame|flame-outline
flame.fill|#flamefill
drop|water|p
leaf|leaf-outline
leaf.fill|#leaffill
globe|globe|p
map|map|p
location|navigate|p
camera|camera|p
photo|#photo
photo.fill|image
play|play|p
pause|pause|p
stop|stop|p
forward|play-forward|p
backward|play-back|p
speaker|volume-off|p
speaker.slash|volume-mute|p
lock|lock-closed|p
lock.open|lock-open|p
key|key|p
battery.100|battery-full-outline
cart|cart|p
creditcard|card|p
bag|bag|p
gift|gift|p
flag|flag|p
sun.max|sunny|p
moon|moon|p
cloud|cloud|p
sparkles|sparkles-outline
wand.and.stars|color-wand-outline
hand.thumbsup|thumbs-up|p
eye|eye|p
eye.slash|eye-off|p
tray|file-tray|p
shield|shield|p
hourglass|hourglass-outline
alarm|alarm|p
square.and.arrow.up|share|p
checkmark.circle|checkmark-circle|p
xmark.circle|close-circle|p
plus.circle|add-circle|p
minus.circle|remove-circle|p
checkmark.square|checkbox|p
exclamationmark.triangle|warning|p
exclamationmark.circle|alert-circle|p
questionmark.circle|help-circle|p
info.circle|information-circle|p
person.circle|person-circle|p
star.circle|star|pc
1.circle|#digit1|c
2.circle|#digit2|c
star.square|star|ps
heart.circle|heart|pc
heart.square|heart|ps
bolt.circle|flash|pc
bolt.square|flash|ps
bell.circle|notifications|pc
bell.square|notifications|ps
house.circle|home|pc
plus.square|add|s
plus.square.fill|add|sf
minus.square|remove|s
minus.square.fill|remove|sf
xmark.square|close|s
xmark.square.fill|close|sf
person.crop.circle|#personcrop
person.crop.circle.fill|#personcropfill|2
person.crop.circle.badge.plus|#personcrop|+
person.crop.circle.badge.checkmark|#personcrop|k
person.crop.circle.fill.badge.checkmark|#personcropfill|k
person.crop.square|person|ps
person.2.circle|people|pc
person.badge.plus|person-add-outline
person.fill.badge.plus|person-add
person.text.rectangle|id-card|p
person.crop.rectangle|id-card-outline
bell.badge|notifications-outline|b
bell.badge.fill|notifications|b
heart.slash|heart-dislike|p
heart.text.square|#hearttext|s
heart.text.square.fill|#hearttext|sf
star.leadinghalf.filled|star-half
star.slash|star-outline|/
star.slash.fill|star|/
bookmark.circle|bookmark|pc
bookmark.slash|bookmark-outline|/
bookmark.slash.fill|bookmark|/
plus.app|add|ps
plus.bubble|add|u
plus.bubble.fill|add|uf
xmark.bin|trash-bin|p
xmark.octagon|close|po
exclamationmark.octagon|alert|po
checkmark.seal|checkmark|pw
checkmark.shield|shield-checkmark|p
xmark.shield|close|h
xmark.shield.fill|close|hf
chevron.forward|chevron-forward||144 80 224 352|0.7|1.1
chevron.backward|chevron-back||144 80 224 352|0.7|1.1
chevron.left.circle|chevron-back-circle|p
chevron.right.circle|chevron-forward-circle|p
chevron.down.circle|chevron-down-circle|p
chevron.up.circle|chevron-up-circle|p
chevron.forward.circle|chevron-forward-circle|p
chevron.backward.circle|chevron-back-circle|p
chevron.compact.down|#compact
chevron.compact.up|#compact|v
chevron.right.2|#chevron2
chevron.left.2|#chevron2|m
arrow.up.left|#arrowupright|m
arrow.down.right|#arrowdownleft|m
arrow.up.forward|#arrowupright
arrow.backward|arrow-back
arrow.forward|arrow-forward
arrow.triangle.2.circlepath|sync
arrow.2.circlepath|sync
arrow.trianglehead.2.clockwise|sync
arrow.clockwise.circle|refresh-circle|p
arrow.counterclockwise.circle|refresh|pcm
arrow.up.circle|arrow-up-circle|p
arrow.down.circle|arrow-down-circle|p
arrow.left.circle|arrow-back-circle|p
arrow.right.circle|arrow-forward-circle|p
arrow.backward.circle|arrow-back-circle|p
arrow.forward.circle|arrow-forward-circle|p
arrow.up.right.circle|#arrowupright|c
arrow.up.right.circle.fill|#arrowupright|cf
arrow.up.right.square|#arrowupright|s
arrow.up.right.square.fill|#arrowupright|sf
arrow.right.square|arrow-forward|ps
arrow.up.and.down|swap-vertical
arrow.left.arrow.right|swap-horizontal
arrow.up.and.down.circle|swap-vertical|pc
arrow.uturn.left|#arrowuturnbackward
arrow.uturn.right|#arrowuturnbackward|m
arrow.down.to.line|#toline
arrow.up.to.line|#toline|v
arrow.left.to.line|#toline|r
arrow.right.to.line|#toline|rm
arrow.triangle.branch|git-branch
arrow.turn.up.right|return-up-forward
arrow.triangle.swap|swap-horizontal
square.and.arrow.down|download|p
square.and.arrow.up.on.square|#shareonsquare
rectangle.portrait.and.arrow.right|log-out|p
rectangle.portrait.and.arrow.forward|log-out|p
trash.circle|trash|pc
trash.slash|trash-outline|/
trash.slash.fill|trash|/
pencil.circle|pencil|pc
pencil.line|pencil
pencil.and.outline|create-outline
pencil.tip|pencil
doc.on.doc|documents|p
doc.plaintext|document-text|p
doc.richtext|document-text|p
doc.badge.plus|document-outline|+
doc.text.magnifyingglass|#docmagnify
clipboard|clipboard|p
folder.badge.plus|folder-outline|+t
folder.circle|folder|pc
archivebox|archive|p
tray.full|file-tray-full|p
tray.and.arrow.down|download|p
tray.and.arrow.up|push|p
externaldrive|#drive
internaldrive|#drive
paperplane.circle|paper-plane|pc
envelope.badge|mail-outline|b
envelope.badge.fill|mail|b
envelope.circle|mail|pc
message|chatbubble|p
message.circle|chatbubble|pc
bubble.left|chatbubble|p
bubble.right|chatbubble|pm
bubble.left.and.bubble.right|chatbubbles|p
text.bubble|chatbox-ellipses|p
ellipsis.bubble|chatbubble-ellipses|p
quote.bubble|#quote|u
quote.bubble.fill|#quote|uf
exclamationmark.bubble|alert|u
exclamationmark.bubble.fill|alert|uf
phone|call|p
phone.circle|call|pc
video|videocam|p
video.slash|videocam-off|p
video.circle|videocam|pc
camera.circle|camera|pc
camera.rotate|camera-reverse|p
viewfinder|scan
photo.on.rectangle|images|p
photo.on.rectangle.angled|images-outline
photo.stack|images|p
photo.badge.plus|#photo|+
photo.circle|image|pc
livephoto|disc-outline
mic|mic|p
mic.slash|mic-off|p
mic.circle|mic-circle|p
speaker.wave.1|#speakerwave1|2
speaker.wave.1.fill|#speakerwave1fill|2
speaker.wave.2|#speakerwave2|2
speaker.wave.2.fill|#speakerwave2fill|2
speaker.wave.3|#speakerwave3|2
speaker.wave.3.fill|#speakerwave3fill|2
play.circle|play-circle|p
pause.circle|pause-circle|p
stop.circle|stop-circle|p
play.square|play|ps
play.rectangle|play|ps
playpause|#playpause
playpause.fill|#playpausefill
forward.end|play-skip-forward|p
backward.end|play-skip-back|p
shuffle|shuffle
repeat|repeat
music.note.list|musical-notes
music.quarternote.3|musical-notes
music.mic|mic
headphones|headset
headphones.circle|headset|pc
waveform.circle|#waveform|c
waveform.circle.fill|#waveform|cf
waveform.path.ecg|pulse
film|film|p
tv.fill|tv
calendar.circle|calendar|pc
calendar.badge.plus|calendar-outline|+
clock.badge.checkmark|time-outline|k
stopwatch|stopwatch|p
cart.badge.plus|cart-outline|+t
cart.circle|cart|pc
bag.badge.plus|bag-add-outline
bag.circle|bag|pc
basket|basket|p
banknote|cash|p
dollarsign|logo-usd
dollarsign.circle|logo-usd|c
dollarsign.circle.fill|logo-usd|cf
dollarsign.square|logo-usd|s
dollarsign.square.fill|logo-usd|sf
eurosign.circle|logo-euro|c
eurosign.circle.fill|logo-euro|cf
yensign.circle|logo-yen|c
yensign.circle.fill|logo-yen|cf
tag.circle|pricetag|pc
tag.slash|pricetag-outline|/
ticket|ticket|p
storefront|storefront|p
wallet.bifold|wallet|p
wallet.pass|wallet|p
creditcard.circle|card|pc
receipt|receipt|p
gift.circle|gift|pc
location.circle|navigate|pc
location.slash|navigate-outline|/
location.slash.fill|navigate|/
mappin|pin
mappin.circle|pin|pc
mappin.and.ellipse|pin
mappin.slash|pin-outline|/
map.circle|map|pc
globe.americas|earth|p
globe.europe.africa|earth|p
globe.asia.australia|earth|p
network|globe-outline
signpost.right|trail-sign|p
scope|locate
safari|compass|p
airplane.circle|airplane|pc
airplane.departure|airplane
airplane.arrival|airplane
car|car|p
car.circle|car|pc
bus|bus|p
tram|train|p
train.side.front.car|train
bicycle|bicycle
ferry|boat|p
sailboat|boat|p
figure.walk|walk
figure.run|walk
figure.walk.circle|walk|pc
figure.run.circle|walk|pc
figure.hiking|walk
figure.outdoor.cycle|bicycle
figure.yoga|body
figure.cooldown|body
figure.mind.and.body|body
figure.dance|body
figure.wave|body
figure.stand|man
figure.child|man
figure.2|people
figure.strengthtraining.traditional|#lifting
drop.circle|water|pc
leaf.circle|leaf|pc
sun.min|sunny|p
sun.horizon|#sunhorizon
sun.horizon.fill|#sunhorizonfill
sunrise|#sunrise
sunrise.fill|#sunrisefill
sunset|#sunset
sunset.fill|#sunsetfill
moon.stars|#moonstars
moon.stars.fill|#moonstarsfill
moon.circle|moon|pc
cloud.rain|rainy|p
cloud.drizzle|rainy|p
cloud.heavyrain|rainy|p
cloud.sun|partly-sunny|p
cloud.bolt|thunderstorm|p
cloud.moon|cloudy-night|p
umbrella|umbrella|p
cross.case|medkit|p
pills|#pill
pills.fill|#pillfill
pill|#pill
bandage|bandage|p
medical.thermometer|#thermometer
waveform.path.ecg.rectangle|pulse|s
bed.double|bed|p
bed.double.circle|bed|pc
brain.head.profile|#brainhead
hand.raised|hand-left|p
hand.raised.slash|hand-left-outline|/
hand.wave|hand-right|p
hand.thumbsdown|thumbs-down|p
touchid|finger-print
ellipsis.circle|ellipsis-horizontal-circle|p
line.3.horizontal.decrease|#decrease
line.3.horizontal.decrease.circle|#decrease|c
line.3.horizontal.decrease.circle.fill|#decrease|cf
line.horizontal.3|menu
line.3.horizontal.circle|menu|pc
list.bullet.circle|list-circle|p
text.justify|reorder-four
textformat|text
square.grid.2x2.fill|grid
square.grid.3x3|apps|p
rectangle.grid.1x2|#grid1x2
rectangle.grid.1x2.fill|#grid1x2fill
rectangle.grid.2x2|grid|p
square.stack|layers|p
square.stack.3d.up|layers|p
rectangle.stack|albums|p
square.on.square|copy-outline
sidebar.left|#sidebar
sidebar.leading|#sidebar
sidebar.right|#sidebar|m
info|information
questionmark|help
exclamationmark|alert
nosign|ban
wifi|#wifi
wifi.slash|#wifi|/
cellularbars|#cellularbars
antenna.radiowaves.left.and.right|#antenna
dot.radiowaves.left.and.right|#radiowaves
battery.0|battery-dead
battery.25|battery-dead
battery.50|battery-half
battery.75|battery-half
battery.100.bolt|battery-charging
link.circle|link|pc
paperclip.circle|attach|pc
printer|print|p
qrcode|qr-code
barcode|barcode
graduationcap|school|p
newspaper|newspaper|p
magazine|newspaper|p
book.circle|book|pc
text.book.closed|#bookclosed
text.book.closed.fill|#bookclosedfill
chart.bar.xaxis|bar-chart
chart.pie.fill|pie-chart
chart.line.downtrend.xyaxis|trending-down
gauge|speedometer-outline
speedometer|speedometer-outline
crown|#crown
crown.fill|#crownfill
trophy|trophy|p
trophy.circle|trophy|pc
medal|medal|p
rosette|ribbon-outline
flag.circle|flag|pc
pin|pin|p
pin.circle|pin|pc
pin.slash|pin-outline|/
archivebox.circle|archive|pc
cube|cube|p
fork.knife|restaurant
fork.knife.circle|restaurant|pc
takeoutbag.and.cup.and.straw|fast-food|p
wineglass|wine|p
dumbbell|barbell|p
soccerball|football
football|american-football|p
basketball|basketball|p
baseball|baseball|p
tennis.racket|#tennisracket
tennisball|tennisball|p
face.smiling|happy|p
laptopcomputer|laptop
macbook|laptop
desktopcomputer|desktop
display|desktop
applewatch|watch-outline
iphone.gen3|phone-portrait
ipad|tablet-portrait-outline
gamecontroller|game-controller|p
printer.dotmatrix|print|p
power|power
power.circle|power|pc
hexagon|#hexagon
hexagon.fill|#hexagonfill
octagon|#blank|o
octagon.fill|#blank|of
seal|#blank|w
seal.fill|#blank|wf
app|square|p
app.badge|square-outline|b
app.badge.fill|square|b
record.circle|radio-button-on|p
largecircle.fill.circle|radio-button-on
checklist|#checklist
checklist.checked|#checklist
note.text|reader-outline
lightbulb|bulb|p
lightbulb.slash|bulb-outline|/
flashlight.on.fill|flashlight
cpu|hardware-chip|p
memorychip|hardware-chip|p
building.2|business|p
building|business|p
building.columns|#columns
building.columns.fill|#columnsfill
house.lodge|home|p
key.horizontal|key|p
lock.circle|lock-closed|pc
lock.square|lock-closed|ps
eye.circle|eye|pc
tshirt|shirt|p
eyeglasses|#eyeglasses
sunglasses|glasses|p
scissors|cut
paintbrush|brush|p
paintbrush.pointed|brush|p
paintpalette|color-palette|p
swatchpalette|color-palette|p
eyedropper|eyedrop
eyedropper.halffull|eyedrop
camera.filters|color-filter
camera.aperture|aperture
photo.artframe|#photo
crop|crop
hammer|hammer|p
wrench|build|p
wrench.adjustable|build|p
wrench.and.screwdriver|construct|p
gearshape.circle|settings|pc
gearshape.2|cog|p
puzzlepiece|extension-puzzle|p
icloud|cloud|p
icloud.and.arrow.down|cloud-download|p
icloud.and.arrow.up|cloud-upload|p
icloud.slash|cloud-offline|p
server.rack|#serverrack
number.circle|#number|c
number.circle.fill|#number|cf
1.circle.fill|#digit1|cf
2.circle.fill|#digit2|cf
shield.lefthalf.filled|shield-half
magnifyingglass.circle|search|pc
`

export interface SymbolDefinition {
  readonly icon: string
  readonly viewBox?: string
  readonly widthEm?: number
  readonly heightEm?: number
  readonly container?: 'circle' | 'square' | 'octagon' | 'seal' | 'bubble' | 'shield'
  readonly filled?: boolean
  readonly mirrored?: boolean
  readonly flipped?: boolean
  readonly turned?: boolean
  readonly slash?: boolean
  readonly badge?: 'dot' | 'plus' | 'check'
  /** A plus or checkmark badge in the top corner rather than the bottom one. */
  readonly badgeTop?: boolean
  /** A drawing whose parts are painted as layers of their own, as `person.crop.circle` is. */
  readonly layered?: boolean
}

const CONTAINERS = { c: 'circle', s: 'square', o: 'octagon', w: 'seal', u: 'bubble', h: 'shield' } as const
const BADGES = { b: 'dot', '+': 'plus', k: 'check' } as const

function parseTable(table: string): Record<string, SymbolDefinition> {
  const map: Record<string, SymbolDefinition> = {}
  for (const line of table.split('\n')) {
    if (!line) continue
    const [name = '', icon = '', flags = '', viewBox, widthEm, heightEm] = line.split('|')
    const definition: { -readonly [K in keyof SymbolDefinition]: SymbolDefinition[K] } = { icon }
    for (const flag of flags) {
      if (flag in CONTAINERS) definition.container = CONTAINERS[flag as keyof typeof CONTAINERS]
      else if (flag in BADGES) definition.badge = BADGES[flag as keyof typeof BADGES]
      else if (flag === 'f') definition.filled = true
      else if (flag === 'm') definition.mirrored = true
      else if (flag === 'v') definition.flipped = true
      else if (flag === 'r') definition.turned = true
      else if (flag === '/') definition.slash = true
      else if (flag === '2') definition.layered = true
      else if (flag === 't') definition.badgeTop = true
    }
    if (viewBox) definition.viewBox = viewBox
    if (widthEm) definition.widthEm = Number(widthEm)
    if (heightEm) definition.heightEm = Number(heightEm)
    if (flags.includes('p')) {
      map[name] = { ...definition, icon: `${icon}-outline` }
      map[`${name}.fill`] = definition.container ? { ...definition, filled: true } : definition
    } else map[name] = definition
  }
  return map
}

// Marked pure: a call the bundler can't prove free of side effects at the top of a module the
// studio page and the worker share makes it ship that module's chunk twice, once for each.
export const SYMBOL_MAP: Readonly<Record<string, SymbolDefinition>> = /*#__PURE__*/ parseTable(TABLE)

export function symbolDefinition(name: string): SymbolDefinition | null {
  return Object.hasOwn(SYMBOL_MAP, name) ? SYMBOL_MAP[name]! : null
}

/** One measurement source for worker layout and DOM paint. */
export function symbolMetrics(name?: string): { widthEm: number; heightEm: number } {
  const symbol = name ? symbolDefinition(name) : null
  return { widthEm: symbol?.widthEm ?? 1.18, heightEm: symbol?.heightEm ?? 1.18 }
}

