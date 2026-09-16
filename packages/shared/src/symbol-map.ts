/** Curated SF-name aliases. No Apple artwork is included. All substitutions remain approximate. */
export interface SymbolDefinition {
  readonly icon: string
  readonly viewBox?: string
  readonly widthEm?: number
  readonly heightEm?: number
  readonly container?: 'circle' | 'square'
  readonly filled?: boolean
  readonly mirrored?: boolean
}

export const SYMBOL_MAP: Readonly<Record<string, SymbolDefinition>> = {
  "books.vertical": { "icon": "library-outline" },
  "books.vertical.fill": { "icon": "library" },
  "mountain.2": {
    "icon": "#mountains"
  },
  "snowflake": {
    "icon": "snow-outline"
  },
  "tree": {
    "icon": "#tree"
  },
  "trash": {
    "icon": "trash-outline"
  },
  "trash.fill": {
    "icon": "trash"
  },
  "chevron.left": {
    "icon": "chevron-back",
    "viewBox": "144 80 224 352",
    "widthEm": 0.7,
    "heightEm": 1.1
  },
  "chevron.right": {
    "icon": "chevron-forward",
    "viewBox": "144 80 224 352",
    "widthEm": 0.7,
    "heightEm": 1.1
  },
  "chevron.up": {
    "icon": "chevron-up"
  },
  "chevron.down": {
    "icon": "chevron-down"
  },
  "chevron.left.slash.chevron.right": {
    "icon": "code-slash"
  },
  "arrow.left": {
    "icon": "arrow-back"
  },
  "arrow.right": {
    "icon": "arrow-forward"
  },
  "arrow.up": {
    "icon": "arrow-up"
  },
  "arrow.down": {
    "icon": "arrow-down"
  },
  "arrow.clockwise": {
    "icon": "refresh"
  },
  "arrow.counterclockwise": {
    "mirrored": true,
    "icon": "refresh"
  },
  "arrow.uturn.backward": {
    "icon": "arrow-undo"
  },
  "arrow.uturn.forward": {
    "icon": "arrow-redo"
  },
  "xmark": {
    "icon": "close"
  },
  "checkmark": {
    "icon": "checkmark"
  },
  "plus": {
    "icon": "add"
  },
  "minus": {
    "icon": "remove"
  },
  "multiply": {
    "icon": "close"
  },
  "ellipsis": {
    "icon": "ellipsis-horizontal"
  },
  "line.3.horizontal": {
    "icon": "menu"
  },
  "magnifyingglass": {
    "icon": "search"
  },
  "pencil": {
    "icon": "pencil"
  },
  "square.and.pencil": {
    "icon": "create"
  },
  "music.note": {
    "icon": "musical-note"
  },
  "wifi": {
    "icon": "wifi"
  },
  "link": {
    "icon": "link"
  },
  "at": {
    "icon": "at"
  },
  "number": {
    "icon": "#number"
  },
  "paperclip": {
    "icon": "attach"
  },
  "waveform": {
    "icon": "pulse"
  },
  "thermometer": {
    "icon": "thermometer"
  },
  "iphone": {
    "icon": "phone-portrait"
  },
  "tv": {
    "icon": "tv"
  },
  "keyboard": {
    "icon": "#keyboard"
  },
  "airplane": {
    "icon": "airplane"
  },
  "chart.pie": {
    "icon": "pie-chart"
  },
  "chart.bar": {
    "icon": "bar-chart"
  },
  "chart.line.uptrend.xyaxis": {
    "icon": "trending-up"
  },
  "list.bullet": {
    "icon": "list"
  },
  "list.dash": {
    "icon": "list"
  },
  "slider.horizontal.3": {
    "icon": "options"
  },
  "square.grid.2x2": {
    "icon": "grid"
  },
  "text.alignleft": {
    "icon": "#alignleft"
  },
  "text.aligncenter": {
    "icon": "#aligncenter"
  },
  "text.alignright": {
    "icon": "#alignright"
  },
  "percent": {
    "icon": "#percent"
  },
  "divide": {
    "icon": "#divide"
  },
  "equal": {
    "icon": "#equal"
  },
  "chevron.up.chevron.down": {
    "icon": "#chevrons"
  },
  "arrow.up.arrow.down": {
    "icon": "swap-vertical"
  },
  "arrow.up.right": {
    "icon": "#arrowupright"
  },
  "arrow.down.left": {
    "icon": "#arrowdownleft"
  },
  "star": {
    "icon": "star-outline"
  },
  "star.fill": {
    "icon": "star"
  },
  "heart": {
    "icon": "heart-outline"
  },
  "heart.fill": {
    "icon": "heart"
  },
  "circle": {
    "icon": "ellipse-outline"
  },
  "circle.fill": {
    "icon": "ellipse"
  },
  "square": {
    "icon": "square-outline"
  },
  "square.fill": {
    "icon": "square"
  },
  "triangle": {
    "icon": "triangle-outline"
  },
  "triangle.fill": {
    "icon": "triangle"
  },
  "diamond": {
    "icon": "diamond-outline"
  },
  "diamond.fill": {
    "icon": "diamond"
  },
  "person": {
    "icon": "person-outline"
  },
  "person.fill": {
    "icon": "person"
  },
  "person.2": {
    "icon": "people-outline"
  },
  "person.2.fill": {
    "icon": "people"
  },
  "person.3": {
    "icon": "people-outline"
  },
  "person.3.fill": {
    "icon": "people"
  },
  "house": {
    "icon": "home-outline"
  },
  "house.fill": {
    "icon": "home"
  },
  "gear": {
    "icon": "settings-outline"
  },
  "gear.fill": {
    "icon": "settings"
  },
  "gearshape": {
    "icon": "settings-outline"
  },
  "gearshape.fill": {
    "icon": "settings"
  },
  "folder": {
    "icon": "folder-outline"
  },
  "folder.fill": {
    "icon": "folder"
  },
  "doc": {
    "icon": "document-outline"
  },
  "doc.fill": {
    "icon": "document"
  },
  "doc.text": {
    "icon": "document-text-outline"
  },
  "doc.text.fill": {
    "icon": "document-text"
  },
  "paperplane": {
    "icon": "paper-plane-outline"
  },
  "paperplane.fill": {
    "icon": "paper-plane"
  },
  "envelope": {
    "icon": "mail-outline"
  },
  "envelope.fill": {
    "icon": "mail"
  },
  "envelope.open": {
    "icon": "mail-open-outline"
  },
  "envelope.open.fill": {
    "icon": "mail-open"
  },
  "bell": {
    "icon": "notifications-outline"
  },
  "bell.fill": {
    "icon": "notifications"
  },
  "bell.slash": {
    "icon": "notifications-off-outline"
  },
  "bell.slash.fill": {
    "icon": "notifications-off"
  },
  "calendar": {
    "icon": "calendar-outline"
  },
  "calendar.fill": {
    "icon": "calendar"
  },
  "clock": {
    "icon": "time-outline"
  },
  "clock.fill": {
    "icon": "time"
  },
  "timer": {
    "icon": "timer-outline"
  },
  "timer.fill": {
    "icon": "timer"
  },
  "bookmark": {
    "icon": "bookmark-outline"
  },
  "bookmark.fill": {
    "icon": "bookmark"
  },
  "tag": {
    "icon": "pricetag-outline"
  },
  "tag.fill": {
    "icon": "pricetag"
  },
  "bolt": {
    "icon": "flash-outline"
  },
  "bolt.fill": {
    "icon": "flash"
  },
  "bolt.slash": {
    "icon": "flash-off-outline"
  },
  "bolt.slash.fill": {
    "icon": "flash-off"
  },
  "flame": {
    "icon": "flame-outline"
  },
  "flame.fill": {
    "icon": "flame"
  },
  "drop": {
    "icon": "water-outline"
  },
  "drop.fill": {
    "icon": "water"
  },
  "leaf": {
    "icon": "leaf-outline"
  },
  "leaf.fill": {
    "icon": "leaf"
  },
  "globe": {
    "icon": "globe-outline"
  },
  "globe.fill": {
    "icon": "globe"
  },
  "map": {
    "icon": "map-outline"
  },
  "map.fill": {
    "icon": "map"
  },
  "location": {
    "icon": "navigate-outline"
  },
  "location.fill": {
    "icon": "navigate"
  },
  "camera": {
    "icon": "camera-outline"
  },
  "camera.fill": {
    "icon": "camera"
  },
  "photo": {
    "icon": "image-outline"
  },
  "photo.fill": {
    "icon": "image"
  },
  "play": {
    "icon": "play-outline"
  },
  "play.fill": {
    "icon": "play"
  },
  "pause": {
    "icon": "pause-outline"
  },
  "pause.fill": {
    "icon": "pause"
  },
  "stop": {
    "icon": "stop-outline"
  },
  "stop.fill": {
    "icon": "stop"
  },
  "forward": {
    "icon": "play-forward-outline"
  },
  "forward.fill": {
    "icon": "play-forward"
  },
  "backward": {
    "icon": "play-back-outline"
  },
  "backward.fill": {
    "icon": "play-back"
  },
  "speaker": {
    "icon": "volume-off-outline"
  },
  "speaker.fill": {
    "icon": "volume-off"
  },
  "speaker.wave.2": {
    "icon": "volume-high-outline"
  },
  "speaker.wave.2.fill": {
    "icon": "volume-high"
  },
  "speaker.slash": {
    "icon": "volume-mute-outline"
  },
  "speaker.slash.fill": {
    "icon": "volume-mute"
  },
  "lock": {
    "icon": "lock-closed-outline"
  },
  "lock.fill": {
    "icon": "lock-closed"
  },
  "lock.open": {
    "icon": "lock-open-outline"
  },
  "lock.open.fill": {
    "icon": "lock-open"
  },
  "key": {
    "icon": "key-outline"
  },
  "key.fill": {
    "icon": "key"
  },
  "battery.100": {
    "icon": "battery-full-outline"
  },
  "battery.100.fill": {
    "icon": "battery-full"
  },
  "cart": {
    "icon": "cart-outline"
  },
  "cart.fill": {
    "icon": "cart"
  },
  "creditcard": {
    "icon": "card-outline"
  },
  "creditcard.fill": {
    "icon": "card"
  },
  "bag": {
    "icon": "bag-outline"
  },
  "bag.fill": {
    "icon": "bag"
  },
  "gift": {
    "icon": "gift-outline"
  },
  "gift.fill": {
    "icon": "gift"
  },
  "flag": {
    "icon": "flag-outline"
  },
  "flag.fill": {
    "icon": "flag"
  },
  "sun.max": {
    "icon": "sunny-outline"
  },
  "sun.max.fill": {
    "icon": "sunny"
  },
  "moon": {
    "icon": "moon-outline"
  },
  "moon.fill": {
    "icon": "moon"
  },
  "cloud": {
    "icon": "cloud-outline"
  },
  "cloud.fill": {
    "icon": "cloud"
  },
  "sparkles": {
    "icon": "sparkles-outline"
  },
  "sparkles.fill": {
    "icon": "sparkles"
  },
  "wand.and.stars": {
    "icon": "color-wand-outline"
  },
  "wand.and.stars.fill": {
    "icon": "color-wand"
  },
  "hand.thumbsup": {
    "icon": "thumbs-up-outline"
  },
  "hand.thumbsup.fill": {
    "icon": "thumbs-up"
  },
  "eye": {
    "icon": "eye-outline"
  },
  "eye.fill": {
    "icon": "eye"
  },
  "eye.slash": {
    "icon": "eye-off-outline"
  },
  "eye.slash.fill": {
    "icon": "eye-off"
  },
  "tray": {
    "icon": "file-tray-outline"
  },
  "tray.fill": {
    "icon": "file-tray"
  },
  "shield": {
    "icon": "shield-outline"
  },
  "shield.fill": {
    "icon": "shield"
  },
  "hourglass": {
    "icon": "hourglass-outline"
  },
  "hourglass.fill": {
    "icon": "hourglass"
  },
  "alarm": {
    "icon": "alarm-outline"
  },
  "alarm.fill": {
    "icon": "alarm"
  },
  "square.and.arrow.up": {
    "icon": "share-outline"
  },
  "square.and.arrow.up.fill": {
    "icon": "share"
  },
  "checkmark.circle": {
    "icon": "checkmark-circle-outline"
  },
  "checkmark.circle.fill": {
    "icon": "checkmark-circle"
  },
  "xmark.circle": {
    "icon": "close-circle-outline"
  },
  "xmark.circle.fill": {
    "icon": "close-circle"
  },
  "plus.circle": {
    "icon": "add-circle-outline"
  },
  "plus.circle.fill": {
    "icon": "add-circle"
  },
  "minus.circle": {
    "icon": "remove-circle-outline"
  },
  "minus.circle.fill": {
    "icon": "remove-circle"
  },
  "checkmark.square": {
    "icon": "checkbox-outline"
  },
  "checkmark.square.fill": {
    "icon": "checkbox"
  },
  "exclamationmark.triangle": {
    "icon": "warning-outline"
  },
  "exclamationmark.triangle.fill": {
    "icon": "warning"
  },
  "exclamationmark.circle": {
    "icon": "alert-circle-outline"
  },
  "exclamationmark.circle.fill": {
    "icon": "alert-circle"
  },
  "questionmark.circle": {
    "icon": "help-circle-outline"
  },
  "questionmark.circle.fill": {
    "icon": "help-circle"
  },
  "info.circle": {
    "icon": "information-circle-outline"
  },
  "info.circle.fill": {
    "icon": "information-circle"
  },
  "person.circle": {
    "icon": "person-circle-outline"
  },
  "person.circle.fill": {
    "icon": "person-circle"
  },
  "star.circle": {
    "icon": "star-outline",
    "container": "circle",
    "filled": false
  },
  "star.circle.fill": {
    "icon": "star",
    "container": "circle",
    "filled": true
  },
  "star.square": {
    "icon": "star-outline",
    "container": "square",
    "filled": false
  },
  "star.square.fill": {
    "icon": "star",
    "container": "square",
    "filled": true
  },
  "heart.circle": {
    "icon": "heart-outline",
    "container": "circle",
    "filled": false
  },
  "heart.circle.fill": {
    "icon": "heart",
    "container": "circle",
    "filled": true
  },
  "heart.square": {
    "icon": "heart-outline",
    "container": "square",
    "filled": false
  },
  "heart.square.fill": {
    "icon": "heart",
    "container": "square",
    "filled": true
  },
  "bolt.circle": {
    "icon": "flash-outline",
    "container": "circle",
    "filled": false
  },
  "bolt.circle.fill": {
    "icon": "flash",
    "container": "circle",
    "filled": true
  },
  "bolt.square": {
    "icon": "flash-outline",
    "container": "square",
    "filled": false
  },
  "bolt.square.fill": {
    "icon": "flash",
    "container": "square",
    "filled": true
  },
  "bell.circle": {
    "icon": "notifications-outline",
    "container": "circle",
    "filled": false
  },
  "bell.circle.fill": {
    "icon": "notifications",
    "container": "circle",
    "filled": true
  },
  "bell.square": {
    "icon": "notifications-outline",
    "container": "square",
    "filled": false
  },
  "bell.square.fill": {
    "icon": "notifications",
    "container": "square",
    "filled": true
  },
  "house.circle": {
    "icon": "home-outline",
    "container": "circle",
    "filled": false
  },
  "house.circle.fill": {
    "icon": "home",
    "container": "circle",
    "filled": true
  },
  "house.square": {
    "icon": "home-outline",
    "container": "square",
    "filled": false
  },
  "house.square.fill": {
    "icon": "home",
    "container": "square",
    "filled": true
  },
  "plus.square": {
    "icon": "add",
    "container": "square",
    "filled": false
  },
  "plus.square.fill": {
    "icon": "add",
    "container": "square",
    "filled": true
  },
  "minus.square": {
    "icon": "remove",
    "container": "square",
    "filled": false
  },
  "minus.square.fill": {
    "icon": "remove",
    "container": "square",
    "filled": true
  },
  "xmark.square": {
    "icon": "close",
    "container": "square",
    "filled": false
  },
  "xmark.square.fill": {
    "icon": "close",
    "container": "square",
    "filled": true
  }
}

export function symbolDefinition(name: string): SymbolDefinition | null {
  return Object.hasOwn(SYMBOL_MAP, name) ? SYMBOL_MAP[name]! : null
}

/** One measurement source for worker layout and DOM paint. */
export function symbolMetrics(name?: string): { widthEm: number; heightEm: number } {
  const symbol = name ? symbolDefinition(name) : null
  return { widthEm: symbol?.widthEm ?? 1.18, heightEm: symbol?.heightEm ?? 1.18 }
}
