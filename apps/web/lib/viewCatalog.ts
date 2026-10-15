import { deploymentVersion, needsNewerIOS, DOTS_BACKGROUND, LAYOUT_WORDS, MODIFIER_SLOTS, type AuthoringNode, type DesignEditRequest } from '@studio/shared'
import { SEARCH_PROMPT } from './screenBars'
import { sourceLayerSlot } from './sourceLayers'

/**
 * Visual building blocks and their SwiftUI source. Controls start with sample
 * values; the Interactions panel can connect them to state. Screen links gain
 * a navigation container through the source transaction when one is needed.
 */
export interface ViewSnippet {
  readonly id: string
  readonly name: string
  readonly swiftName?: string
  readonly group: 'Layout' | 'Content' | 'Controls' | 'Shapes' | 'Navigation' | 'System'
  /** What it does, shown beside the name. */
  readonly hint: string
  /** Extra words the search should match, for the names people reach for. */
  readonly keywords?: string
  readonly snippet: string
  /** The iOS that has everything it writes, when that is newer than 13, the oldest the studio writes for. */
  readonly minimumIOS?: number
  /** What it is written as for an app on an iOS older than `before`, which lacks a spelling `snippet` uses (Wave 4c). */
  readonly older?: { readonly before: number; readonly snippet: string }
  /**
   * Not inserted as written: chosen in a picker of its own (`image`), a modifier added to
   * the selected view with a starter button inside (Wave 4a), where `on` is what it goes on,
   * in the words its refusal uses, or a search field or a toolbar item on the screen (Wave 4c),
   * where a toolbar item shows `snippet`.
   */
  readonly action?: 'image' | 'search' | 'toolbar' | { readonly modifier: string; readonly on: 'row' | 'view' }
}

export const VIEW_CATALOG: readonly ViewSnippet[] = [
  // --------------------------------------------------------------- Layout
  { id: 'vstack', name: LAYOUT_WORDS.VStack, swiftName: 'VStack', group: 'Layout', hint: 'Views top to bottom', keywords: 'vertical stack', snippet: 'VStack {\n    Text("Item")\n}' },
  { id: 'hstack', name: LAYOUT_WORDS.HStack, swiftName: 'HStack', group: 'Layout', hint: 'Views side by side', keywords: 'horizontal stack', snippet: 'HStack {\n    Text("Item")\n}' },
  { id: 'zstack', name: LAYOUT_WORDS.ZStack, swiftName: 'ZStack', group: 'Layout', hint: 'Views front to back', keywords: 'overlay depth layer stack', snippet: 'ZStack {\n    Text("Item")\n}' },
  { id: 'spacer', name: 'Spacer', group: 'Layout', hint: 'Push the others apart', keywords: 'gap flexible', snippet: 'Spacer()' },
  { id: 'divider', name: 'Divider', group: 'Layout', hint: 'A hairline between views', keywords: 'line rule separator', snippet: 'Divider()' },
  { id: 'group', name: 'Group', group: 'Layout', hint: 'Treat several views as one', snippet: 'Group {\n    Text("Item")\n}' },
  { id: 'scrollview', name: 'Scroll', swiftName: 'ScrollView', group: 'Layout', hint: 'Scroll its contents', keywords: 'scrolling', snippet: 'ScrollView {\n    VStack {\n        Text("Item")\n    }\n}' },
  { id: 'list', name: 'List', group: 'Layout', hint: 'A table of rows', keywords: 'table rows', snippet: 'List {\n    Text("Row")\n}' },
  { id: 'form', name: 'Form', group: 'Layout', hint: 'A settings-style form', keywords: 'settings fields', snippet: 'Form {\n    Section("Section") {\n        Text("Field")\n    }\n}', older: { before: 15, snippet: 'Form {\n    Section(header: Text("Section")) {\n        Text("Field")\n    }\n}' } },
  { id: 'section', name: 'Section', group: 'Layout', hint: 'A titled group of rows', keywords: 'header group', snippet: 'Section("Section") {\n    Text("Row")\n}', older: { before: 15, snippet: 'Section(header: Text("Section")) {\n    Text("Row")\n}' } },
  { id: 'grid', name: 'Column grid', swiftName: 'LazyVGrid', group: 'Layout', hint: 'A grid of columns', keywords: 'columns tiles', minimumIOS: 14, snippet: 'LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())]) {\n    Text("Cell")\n}' },
  { id: 'foreach', name: 'Repeat', swiftName: 'ForEach', group: 'Layout', hint: 'One view per element', keywords: 'loop repeat', snippet: 'ForEach(0..<3, id: \\.self) { index in\n    Text("Row \\(index)")\n}' },
  { id: 'lazy-column', name: 'Lazy column', swiftName: 'LazyVStack', group: 'Layout', hint: 'A column that draws rows as they scroll in', keywords: 'vertical stack long', minimumIOS: 14, snippet: 'LazyVStack {\n    Text("Item")\n}' },
  { id: 'lazy-row', name: 'Lazy row', swiftName: 'LazyHStack', group: 'Layout', hint: 'A row that draws views as they scroll in', keywords: 'horizontal stack long', minimumIOS: 14, snippet: 'LazyHStack {\n    Text("Item")\n}' },
  { id: 'grid-rows', name: 'Grid', swiftName: 'Grid', group: 'Layout', hint: 'Rows of cells in lined-up columns', keywords: 'table cells rows columns', minimumIOS: 16, snippet: 'Grid {\n    GridRow {\n        Text("Cell")\n        Text("Cell")\n    }\n}' },
  { id: 'disclosure', name: 'Disclosure group', swiftName: 'DisclosureGroup', group: 'Layout', hint: 'Shows its views when opened', keywords: 'expand collapse accordion more', minimumIOS: 14, snippet: 'DisclosureGroup("Details") {\n    Text("Content")\n}' },

  // -------------------------------------------------------------- Content
  { id: 'text', name: 'Text', group: 'Content', hint: 'A run of text', keywords: 'label string title', snippet: 'Text("Text")' },
  { id: 'image', name: 'Symbols', group: 'Content', hint: 'An SF Symbol', keywords: 'icon symbol picture', snippet: 'Image(systemName: "star")' },
  { id: 'asset-image', name: 'Images', group: 'Content', hint: 'Upload a photo or choose a bundled image', keywords: 'picture photo upload png jpeg asset', snippet: '', action: 'image' },
  { id: 'label', name: 'Label', group: 'Content', hint: 'A symbol beside a title', keywords: 'icon row', minimumIOS: 14, snippet: 'Label("Label", systemImage: "star")' },
  { id: 'labeledcontent', name: 'Title and value', swiftName: 'LabeledContent', group: 'Content', hint: 'A title with a value', keywords: 'row detail value', minimumIOS: 16, snippet: 'LabeledContent("Title", value: "Value")' },
  { id: 'link', name: 'Link', group: 'Content', hint: 'Opens a URL', keywords: 'url web', minimumIOS: 14, snippet: 'Link("Link", destination: URL(string: "https://example.com")!)' },
  { id: 'share-link', name: 'Share link', swiftName: 'ShareLink', group: 'Content', hint: 'Opens the share sheet', keywords: 'share sheet send', minimumIOS: 16, snippet: 'ShareLink(item: URL(string: "https://example.com")!)' },
  { id: 'progress', name: 'Progress', swiftName: 'ProgressView', group: 'Content', hint: 'A bar or a spinner', keywords: 'loading spinner bar', minimumIOS: 14, snippet: 'ProgressView(value: 0.5)' },
  { id: 'gauge', name: 'Gauge', group: 'Content', hint: 'A value within a range', keywords: 'meter level', minimumIOS: 16, snippet: 'Gauge(value: 0.5) {\n    Text("Gauge")\n}' },
  { id: 'groupbox', name: 'Card', swiftName: 'GroupBox', group: 'Content', hint: 'A titled card', keywords: 'card panel', minimumIOS: 14, snippet: 'GroupBox("Title") {\n    Text("Content")\n        .frame(maxWidth: .infinity, alignment: .leading)\n}', older: { before: 15, snippet: 'GroupBox(label: Text("Title")) {\n    Text("Content")\n        .frame(maxWidth: .infinity, alignment: .leading)\n}' } },

  // ------------------------------------------------------------- Controls
  { id: 'button', name: 'Button', group: 'Controls', hint: 'Runs an action when pressed', keywords: 'tap press action', snippet: 'Button("Button") { }' },
  { id: 'toggle', name: 'Toggle', group: 'Controls', hint: 'An on/off switch', keywords: 'switch checkbox', snippet: 'Toggle("Toggle", isOn: .constant(true))' },
  { id: 'textfield', name: 'Text field', swiftName: 'TextField', group: 'Controls', hint: 'A single line of input', keywords: 'input entry', snippet: 'TextField("Placeholder", text: .constant(""))' },
  { id: 'secure-field', name: 'Secure field', swiftName: 'SecureField', group: 'Controls', hint: 'A field that hides what is typed', keywords: 'password input entry', snippet: 'SecureField("Password", text: .constant(""))' },
  { id: 'text-editor', name: 'Text editor', swiftName: 'TextEditor', group: 'Controls', hint: 'Several lines of input', keywords: 'multiline notes input', minimumIOS: 14, snippet: 'TextEditor(text: .constant("Text"))\n    .frame(height: 120)' },
  { id: 'slider', name: 'Slider', group: 'Controls', hint: 'Pick a value in a range', keywords: 'range drag', snippet: 'Slider(value: .constant(0.5))' },
  { id: 'stepper', name: 'Stepper', group: 'Controls', hint: 'Step a number up or down', keywords: 'increment plus minus', snippet: 'Stepper("Stepper", value: .constant(1))' },
  { id: 'picker', name: 'Picker', group: 'Controls', hint: 'Choose one of several', keywords: 'select menu segmented', snippet: 'Picker("Picker", selection: .constant(0)) {\n    Text("One").tag(0)\n    Text("Two").tag(1)\n}' },
  { id: 'menu', name: 'Menu', group: 'Controls', hint: 'A button that opens a list of actions', keywords: 'dropdown actions more', minimumIOS: 14, snippet: 'Menu("Menu") {\n    Button("Action") { }\n}' },
  { id: 'datepicker', name: 'Date picker', swiftName: 'DatePicker', group: 'Controls', hint: 'Pick a date', keywords: 'calendar time', snippet: 'DatePicker("Date", selection: .constant(Date()))' },
  { id: 'colorpicker', name: 'Color picker', swiftName: 'ColorPicker', group: 'Controls', hint: 'Pick a colour', keywords: 'colour swatch', minimumIOS: 14, snippet: 'ColorPicker("Colour", selection: .constant(.blue))' },

  // --------------------------------------------------------------- Shapes
  { id: 'rectangle', name: 'Rectangle', group: 'Shapes', hint: 'A filled rectangle', keywords: 'box square', snippet: 'Rectangle()\n    .fill(.blue)\n    .frame(height: 80)' },
  { id: 'roundedrect', name: 'Rounded rectangle', swiftName: 'RoundedRectangle', group: 'Shapes', hint: 'A rectangle with rounded corners', keywords: 'card box corner', snippet: 'RoundedRectangle(cornerRadius: 12)\n    .fill(.blue)\n    .frame(height: 80)' },
  { id: 'circle', name: 'Circle', group: 'Shapes', hint: 'A filled circle', keywords: 'dot round', snippet: 'Circle()\n    .fill(.blue)\n    .frame(width: 60, height: 60)' },
  { id: 'capsule', name: 'Capsule', group: 'Shapes', hint: 'A pill', keywords: 'pill rounded', snippet: 'Capsule()\n    .fill(.blue)\n    .frame(height: 44)' },
  { id: 'ellipse', name: 'Ellipse', group: 'Shapes', hint: 'A filled oval', keywords: 'oval round', snippet: 'Ellipse()\n    .fill(.blue)\n    .frame(width: 80, height: 60)' },
  { id: 'uneven-rect', name: 'Uneven rounded rectangle', swiftName: 'UnevenRoundedRectangle', group: 'Shapes', hint: 'Each corner rounded on its own', keywords: 'corner radius card tab', minimumIOS: 16, snippet: 'UnevenRoundedRectangle(topLeadingRadius: 12, bottomTrailingRadius: 12)\n    .fill(.blue)\n    .frame(height: 80)' },
  { id: 'gradient', name: 'Gradient', swiftName: 'LinearGradient', group: 'Shapes', hint: 'One colour fading into another', keywords: 'linear fade blend', snippet: 'LinearGradient(colors: [.blue, .purple], startPoint: .top, endPoint: .bottom)\n    .frame(height: 80)' },
  { id: 'color', name: 'Color', group: 'Shapes', hint: 'A colour that fills its space', keywords: 'colour fill swatch background', snippet: 'Color.blue\n    .frame(height: 80)' },

  // ----------------------------------------------------------- Navigation
  { id: 'navstack', name: 'Navigation container', swiftName: 'NavigationStack', group: 'Navigation', hint: 'A screen you can push from', keywords: 'navigation title bar', minimumIOS: 16, snippet: 'NavigationStack {\n    Text("Screen")\n        .navigationTitle("Title")\n}' },
  { id: 'navlink', name: 'Screen link', swiftName: 'NavigationLink', group: 'Navigation', hint: 'Pushes another screen', keywords: 'push detail', snippet: 'NavigationLink("Details") {\n    Text("Details")\n}' },
  { id: 'tabview', name: 'Tabs', swiftName: 'TabView', group: 'Navigation', hint: 'Tabs along the bottom', keywords: 'tabs pages', minimumIOS: 14, snippet: 'TabView {\n    Text("First")\n        .tabItem { Label("First", systemImage: "1.circle") }\n    Text("Second")\n        .tabItem { Label("Second", systemImage: "2.circle") }\n}' },

  // --------------------------------------------------------------- System
  { id: 'empty-state', name: 'Empty state', swiftName: 'ContentUnavailableView', group: 'System', hint: 'What a screen shows with nothing in it', keywords: 'empty no results nothing placeholder unavailable', minimumIOS: 17, snippet: 'ContentUnavailableView("No Results", systemImage: "magnifyingglass", description: Text("Try a different search."))' },
  { id: 'carousel', name: 'Carousel', swiftName: 'TabView', group: 'System', hint: 'Pages side by side, with dots to switch them', keywords: 'pages paging dots onboarding slides swipe pager', minimumIOS: 14, snippet: `TabView {\n    Text("Page 1")\n    Text("Page 2")\n    Text("Page 3")\n}\n.tabViewStyle(.page(indexDisplayMode: .always))\n${DOTS_BACKGROUND}\n.frame(height: 240)` },
  { id: 'search-field', name: 'Search field', swiftName: 'searchable', group: 'System', hint: 'A search field in the screen’s navigation bar', keywords: 'find filter query', minimumIOS: 15, snippet: '', action: 'search' },
  { id: 'toolbar-button', name: 'Toolbar button', swiftName: 'ToolbarItem', group: 'System', hint: 'A button in the screen’s navigation bar', keywords: 'navigation bar top add plus action', minimumIOS: 14, snippet: 'Button("Add", systemImage: "plus") { }', action: 'toolbar' },
  { id: 'swipe-action', name: 'Swipe action', swiftName: 'swipeActions', group: 'System', hint: 'A button a row shows when swiped', keywords: 'delete pin flag row leading trailing', snippet: '', action: { modifier: 'swipeActions', on: 'row' } },
  { id: 'context-menu', name: 'Context menu', swiftName: 'contextMenu', group: 'System', hint: 'A menu shown by a long press', keywords: 'long press hold menu copy share', snippet: '', action: { modifier: 'contextMenu', on: 'view' } },
]

/**
 * What choosing `snippet` asks for, and of which layer (Wave 4a). A swipe action or a context
 * menu is added to the selected view, when the modifiers it is offered hold it, or says why
 * not: not a row, or an iOS too old. A search field goes on `screen`, the definition of the
 * screen in focus, as the Bars section's switch puts one, and so does a toolbar button unless a
 * Toolbar is selected (Wave 4c). A view goes into a selected slot as its last view; anywhere
 * else it goes where Add always puts it, and `on` is left out. It is written as an app on
 * `deploymentTarget` can build it.
 */
export function paletteEdit(snippet: ViewSnippet, selected: AuthoringNode | undefined, screen?: AuthoringNode, deploymentTarget?: string): { readonly operation: DesignEditRequest['operation']; readonly on?: AuthoringNode; readonly problem?: string } {
  if (snippet.action === 'search') {
    const operation = { kind: 'searchable-add', prompt: SEARCH_PROMPT } as const
    const problem = !screen ? 'Select a screen to add a search field to.' : screen.bars?.search ? 'This screen has a search field already.' : screen.bars?.searchProblem
    return problem ? { operation, problem } : { operation, on: screen }
  }
  const slot = sourceLayerSlot(selected)
  if (snippet.action === 'toolbar' && slot?.name !== MODIFIER_SLOTS.toolbar) {
    const operation = { kind: 'toolbar-item-add', placement: 'trailing', snippet: snippet.snippet } as const
    const problem = !screen ? 'Select a screen to add a toolbar button to.' : screen.bars?.problem
    return problem ? { operation, problem } : { operation, on: screen }
  }
  if (typeof snippet.action === 'object') {
    const { modifier: name, on } = snippet.action, operation = { kind: 'modifier-add', name } as const
    const offered = selected?.modifierCatalog?.find(entry => entry.name === name)
    if (selected && offered?.available) return { operation, on: selected }
    const added = snippet.name.toLowerCase()
    return { operation, problem: offered?.reason || (selected && on === 'row' ? `A ${added} goes on a row of a List, Form or Section.` : `Select the ${on} to add a ${added} to.`) }
  }
  const written = snippet.older && deploymentVersion(deploymentTarget) < snippet.older.before ? snippet.older.snippet : snippet.snippet
  const operation = { kind: 'insert', snippet: written } as const
  return slot ? { operation, on: slot } : { operation }
}

/**
 * Why `snippet` can't be added to an app that runs on `deploymentTarget` (Wave 4c), in the words
 * the modifier picker uses for a modifier newer than the app; undefined when it can.
 */
export function paletteGate(snippet: ViewSnippet, deploymentTarget: string | undefined): string | undefined {
  const minimum = snippet.minimumIOS ?? 13
  return deploymentVersion(deploymentTarget) < minimum ? needsNewerIOS(minimum, 'use') : undefined
}

/**
 * Ranks the catalog against what has been typed.
 *
 * A prefix of the name beats a word inside it, which beats a keyword: typing "te"
 * should offer Text before LabeledContent, and typing "switch" should still find
 * Toggle. An empty query keeps the catalog's own order, which is grouped.
 */
export function searchCatalog(query: string): readonly ViewSnippet[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return VIEW_CATALOG

  const scored: { snippet: ViewSnippet; score: number }[] = []
  for (const snippet of VIEW_CATALOG) {
    const name = snippet.name.toLowerCase()
    const score = name.startsWith(needle)
      ? 0
      : name.includes(needle)
        ? 1
        : `${snippet.swiftName ?? ''} ${snippet.keywords ?? ''} ${snippet.hint}`.toLowerCase().includes(needle)
          ? 2
          : -1
    if (score >= 0) scored.push({ snippet, score })
  }
  return scored.sort((a, b) => a.score - b.score || a.snippet.name.localeCompare(b.snippet.name)).map((s) => s.snippet)
}
