/**
 * Visual building blocks and their SwiftUI source. Controls start with sample
 * values; the Interactions panel can connect them to state. Screen links gain
 * a navigation container through the source transaction when one is needed.
 */
export interface ViewSnippet {
  readonly id: string
  readonly name: string
  readonly swiftName?: string
  readonly group: 'Layout' | 'Content' | 'Controls' | 'Shapes' | 'Navigation'
  /** What it does, shown beside the name. */
  readonly hint: string
  /** Extra words the search should match, for the names people reach for. */
  readonly keywords?: string
  readonly snippet: string
  readonly action?: 'image'
}

export const VIEW_CATALOG: readonly ViewSnippet[] = [
  // --------------------------------------------------------------- Layout
  { id: 'vstack', name: 'Vertical Stack', swiftName: 'VStack', group: 'Layout', hint: 'Stack views top to bottom', keywords: 'column vertical', snippet: 'VStack {\n    Text("Item")\n}' },
  { id: 'hstack', name: 'Horizontal Stack', swiftName: 'HStack', group: 'Layout', hint: 'Stack views side by side', keywords: 'row horizontal', snippet: 'HStack {\n    Text("Item")\n}' },
  { id: 'zstack', name: 'ZStack', swiftName: 'ZStack', group: 'Layout', hint: 'Stack views front to back', keywords: 'overlay depth layer', snippet: 'ZStack {\n    Text("Item")\n}' },
  { id: 'spacer', name: 'Spacer', group: 'Layout', hint: 'Push the others apart', keywords: 'gap flexible', snippet: 'Spacer()' },
  { id: 'divider', name: 'Divider', group: 'Layout', hint: 'A hairline between views', keywords: 'line rule separator', snippet: 'Divider()' },
  { id: 'group', name: 'Group', group: 'Layout', hint: 'Treat several views as one', snippet: 'Group {\n    Text("Item")\n}' },
  { id: 'scrollview', name: 'Scroll', swiftName: 'ScrollView', group: 'Layout', hint: 'Scroll its contents', keywords: 'scrolling', snippet: 'ScrollView {\n    VStack {\n        Text("Item")\n    }\n}' },
  { id: 'list', name: 'List', group: 'Layout', hint: 'A table of rows', keywords: 'table rows', snippet: 'List {\n    Text("Row")\n}' },
  { id: 'form', name: 'Form', group: 'Layout', hint: 'A settings-style form', keywords: 'settings fields', snippet: 'Form {\n    Section("Section") {\n        Text("Field")\n    }\n}' },
  { id: 'section', name: 'Section', group: 'Layout', hint: 'A titled group of rows', keywords: 'header group', snippet: 'Section("Section") {\n    Text("Row")\n}' },
  { id: 'grid', name: 'Column grid', swiftName: 'LazyVGrid', group: 'Layout', hint: 'A grid of columns', keywords: 'columns tiles', snippet: 'LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())]) {\n    Text("Cell")\n}' },
  { id: 'foreach', name: 'Repeat', swiftName: 'ForEach', group: 'Layout', hint: 'One view per element', keywords: 'loop repeat', snippet: 'ForEach(0..<3, id: \\.self) { index in\n    Text("Row \\(index)")\n}' },

  // -------------------------------------------------------------- Content
  { id: 'text', name: 'Text', group: 'Content', hint: 'A run of text', keywords: 'label string title', snippet: 'Text("Text")' },
  { id: 'image', name: 'Symbols', group: 'Content', hint: 'An SF Symbol', keywords: 'icon symbol picture', snippet: 'Image(systemName: "star")' },
  { id: 'asset-image', name: 'Images', group: 'Content', hint: 'Upload a photo or choose a bundled image', keywords: 'picture photo upload png jpeg asset', snippet: '', action: 'image' },
  { id: 'label', name: 'Label', group: 'Content', hint: 'A symbol beside a title', keywords: 'icon row', snippet: 'Label("Label", systemImage: "star")' },
  { id: 'labeledcontent', name: 'Title and value', swiftName: 'LabeledContent', group: 'Content', hint: 'A title with a value', keywords: 'row detail value', snippet: 'LabeledContent("Title", value: "Value")' },
  { id: 'link', name: 'Link', group: 'Content', hint: 'Opens a URL', keywords: 'url web', snippet: 'Link("Link", destination: URL(string: "https://example.com")!)' },
  { id: 'progress', name: 'Progress', swiftName: 'ProgressView', group: 'Content', hint: 'A bar or a spinner', keywords: 'loading spinner bar', snippet: 'ProgressView(value: 0.5)' },
  { id: 'groupbox', name: 'Card', swiftName: 'GroupBox', group: 'Content', hint: 'A titled card', keywords: 'card panel', snippet: 'GroupBox("Title") {\n    Text("Content")\n        .frame(maxWidth: .infinity, alignment: .leading)\n}' },

  // ------------------------------------------------------------- Controls
  { id: 'button', name: 'Button', group: 'Controls', hint: 'Runs an action when pressed', keywords: 'tap press action', snippet: 'Button("Button") { }' },
  { id: 'toggle', name: 'Toggle', group: 'Controls', hint: 'An on/off switch', keywords: 'switch checkbox', snippet: 'Toggle("Toggle", isOn: .constant(true))' },
  { id: 'textfield', name: 'Text field', swiftName: 'TextField', group: 'Controls', hint: 'A single line of input', keywords: 'input entry', snippet: 'TextField("Placeholder", text: .constant(""))' },
  { id: 'slider', name: 'Slider', group: 'Controls', hint: 'Pick a value in a range', keywords: 'range drag', snippet: 'Slider(value: .constant(0.5))' },
  { id: 'stepper', name: 'Stepper', group: 'Controls', hint: 'Step a number up or down', keywords: 'increment plus minus', snippet: 'Stepper("Stepper", value: .constant(1))' },
  { id: 'picker', name: 'Picker', group: 'Controls', hint: 'Choose one of several', keywords: 'select menu segmented', snippet: 'Picker("Picker", selection: .constant(0)) {\n    Text("One").tag(0)\n    Text("Two").tag(1)\n}' },
  { id: 'datepicker', name: 'Date picker', swiftName: 'DatePicker', group: 'Controls', hint: 'Pick a date', keywords: 'calendar time', snippet: 'DatePicker("Date", selection: .constant(Date()))' },
  { id: 'colorpicker', name: 'Color picker', swiftName: 'ColorPicker', group: 'Controls', hint: 'Pick a colour', keywords: 'colour swatch', snippet: 'ColorPicker("Colour", selection: .constant(.blue))' },

  // --------------------------------------------------------------- Shapes
  { id: 'rectangle', name: 'Rectangle', group: 'Shapes', hint: 'A filled rectangle', keywords: 'box square', snippet: 'Rectangle()\n    .fill(.blue)\n    .frame(height: 80)' },
  { id: 'roundedrect', name: 'Rounded rectangle', swiftName: 'RoundedRectangle', group: 'Shapes', hint: 'A rectangle with rounded corners', keywords: 'card box corner', snippet: 'RoundedRectangle(cornerRadius: 12)\n    .fill(.blue)\n    .frame(height: 80)' },
  { id: 'circle', name: 'Circle', group: 'Shapes', hint: 'A filled circle', keywords: 'dot round', snippet: 'Circle()\n    .fill(.blue)\n    .frame(width: 60, height: 60)' },
  { id: 'capsule', name: 'Capsule', group: 'Shapes', hint: 'A pill', keywords: 'pill rounded', snippet: 'Capsule()\n    .fill(.blue)\n    .frame(height: 44)' },

  // ----------------------------------------------------------- Navigation
  { id: 'navstack', name: 'Navigation container', swiftName: 'NavigationStack', group: 'Navigation', hint: 'A screen you can push from', keywords: 'navigation title bar', snippet: 'NavigationStack {\n    Text("Screen")\n        .navigationTitle("Title")\n}' },
  { id: 'navlink', name: 'Screen link', swiftName: 'NavigationLink', group: 'Navigation', hint: 'Pushes another screen', keywords: 'push detail', snippet: 'NavigationLink("Details") {\n    Text("Details")\n}' },
  { id: 'tabview', name: 'Tabs', swiftName: 'TabView', group: 'Navigation', hint: 'Tabs along the bottom', keywords: 'tabs pages', snippet: 'TabView {\n    Text("First")\n        .tabItem { Label("First", systemImage: "1.circle") }\n    Text("Second")\n        .tabItem { Label("Second", systemImage: "2.circle") }\n}' },
]

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
