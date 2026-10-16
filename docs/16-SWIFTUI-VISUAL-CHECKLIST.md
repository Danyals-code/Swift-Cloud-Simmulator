# SwiftUI visual and interaction audit, 2026-09-17

**No: the preview does not implement this entire checklist correctly.** It is a browser
implementation of a SwiftUI subset. Several common controls work; others are simplified,
and system integrations are absent. Successful compilation alone does not establish parity.

This audit adds 81 independent snippets across six configurations: small iPhone, iPhone
18 Pro light/dark, iPad light/dark, and iPhone accessibility3 text. The 503 checks include
render geometry, visible content, expected unsupported diagnostics, and interaction regressions.
A passing **gap test** means the limitation was reported; it does not mean the feature works.
These are structural and behavioral tests, not 503 native screenshot comparisons.

## Native comparison evidence

Update: the user subsequently supplied **15 clean native iPhone screenshots**, including
light/dark controls, containers, presentations and alert keyboard states. Originals and
hashes are in [the controls reference](parity/native/iphone18pro-controls/measurements.json).
The measurement-driven changes and remaining limits are in [the follow-up report](17-IOS-CONTROL-PARITY.md).
The Device Hub limitations below describe the earlier capture attempt, not missing evidence
for the newly supplied screenshots.


- Installed Xcode: **27.0, build 27A266a**. The new `ios27-visual-stress.swift` fixture
  exported, built, and ran on the selected **iPhone 18 Pro** destination in Xcode.
- Device Hub continued timing out after the requested five-minute loading window.
  Direct `simctl` access was also unavailable from the command sandbox. No new clean
  simulator PNGs or pixel-difference scores are claimed.
- Xcode's **Debug View Hierarchy** successfully captured the running Controls screen.
  This confirmed capsule-like toggle-button/stepper shapes, distinct circular gauges,
  and a visible native tab badge. The debugger capture had missing clipping/material
  artifacts, so it is unsuitable for precise color, spacing, or pixel baselines.
- The **identical Swift source** was imported into the production web app. Browser
  checks exercised the alert field and persistence after dismissal/reopening, the yellow
  200-point sheet, and presentation controls. The screenshot showed the intended sheet
  color, hidden grabber, and rounded corners. Existing glass effects remain blur substitutes.
- The six previously supplied native screenshots remain the reliable reference for
  Library, Settings, Details, alert, sheet, and scrolled Library. Their source/image hashes
  and measured geometry tests still pass. That establishes a limited reference, not parity
  for every control or for iPad/dark/accessibility configurations.

## Fixes made during this audit

1. Alert actions no longer discard `TextField`/`SecureField` views. Their bindings update
   and retain edits. Tapping the alert backdrop no longer dismisses an alert. Empty alerts receive a dismissible OK action.
2. `.presentationBackground` applies Color and Material values, including `.clear`.
   Custom view-builder backgrounds remain unsupported and now warn.
3. `.interactiveDismissDisabled()` now defaults to true; `false` restores backdrop
   dismissal. This does **not** add native swipe-to-dismiss gestures.
4. Automatic sheet grabbers depend on multiple detents; explicit visible/hidden wins.
   Height/fraction/medium/large bounds remain tested independently.
5. Circular gauges use value-dependent arcs/markers instead of loading spinners.
   Linear gauges preserve the label and optional current/minimum/maximum labels.
   The follow-up calibrates default/circular gauge metrics and labels from screenshots;
   gradient tinting and all native styles remain incomplete.
6. Menu pickers show the selected option's **label**, rather than its raw numeric tag.
7. Toggle buttons and steppers use rounded shapes consistent with the native capture.
   Bound DisclosureGroup chevrons now follow the expanded state rather than always pointing right.
8. Remaining inert APIs report limitations: custom swipe actions, row moving, focus,
   search scopes/suggestions, TipKit and file dialogs. The follow-up implements common
   badges, context-menu actions, submit/input hints, iPhone inspectors and background interaction. Link/ShareLink warn
   that their labels are the only supported behavior. Unsupported toolbar placements
   no longer show up as unrelated top-right navigation buttons.
9. The generation prompt excludes these unavailable interactions. The source still
   exports unchanged; generated code is not guaranteed to fit the interpreter.

## Your checklist, item by item

“Works” below means the common tested form, **not** complete native visual parity.
“Partial” means a visible or behavioral substitute. “Missing” means no implementation
of the requested behavior, even if a name or placeholder is recognized.

| Feature | State | Current behavior / remaining gap |
| --- | --- | --- |
| `.sheet` | Partial | Binding/item presentation and nested navigation work; no native slide/drag lifecycle |
| `.presentationDetents` | Partial | Medium, large, fraction, height and supplied selection resolve; no drag between detents or selection write-back from dragging |
| `.presentationDragIndicator` | Works | Explicit visible/hidden and automatic multiple-detent grabber; it is not a drag handle yet |
| `.presentationCornerRadius` | Works | Explicit radius, clipped surface |
| `.presentationBackground` | Partial | Colors/material blur work; custom view backgrounds warn |
| `.presentationBackgroundInteraction` | Partial | Enabled/disabled and upThrough threshold control background interaction at the current sheet height; no dragging between heights |
| `.interactiveDismissDisabled` | Partial | Blocks preview backdrop dismissal, including its default argument; no native swipe gesture |
| `.fullScreenCover` | Partial | Covers full canvas, explicit dismissal works; native transition/keyboard behavior absent |
| `.popover` | Partial | A sheet on iPhone, as iOS adapts it in compact width. Wave 6c: with `.presentationCompactAdaptation(.popover)`, a bubble sized to its content (corners about 28, an arrow 13 tall) above its source when it fits, below otherwise, as captured in `native/iphone18pro-chrome`; `attachmentAnchor:` and `arrowEdge:` warn and are not drawn; no iPad/Mac popover |
| `.alert` | Partial | Title/message/actions and bound text/secure fields; native keyboard/focus, sizing under extreme content and every overload not reproduced |
| `.confirmationDialog` | Partial | Floating capsule-action panel from the supplied iPhone reference, visible title option and destructive actions; native placement/adaptation approximate |
| `.inspector` | Partial | Binding-driven iPhone sheet; no iPad trailing-column adaptation |
| Segmented `Picker` | Works | Options, binding changes and capsule metrics/colors checked against light/dark native captures |
| Menu `Picker` | Partial | Opens options and writes binding; selected label fixed; native menu layout differs |
| Wheel `Picker` | Partial | Clickable dimmed column, no scrolling wheel physics |
| Inline `Picker` | Partial | Clickable rows; native Form/list integration differs |
| Navigation-link / palette picker | Missing | Unsupported style warning; navigation/color-palette behavior absent |
| `Toggle` / button toggle | Works | State changes and distinct visuals; control-size/context fidelity incomplete |
| `Slider` | Works | Numeric binding, range/step; native interaction/accessibility differences remain |
| `Stepper` | Works | Increment/decrement, bounds and step; system repeat behavior not reproduced |
| `DatePicker` | Partial | Wave 6d: drawn in its style, at the sizes captured in `native/iphone18pro-controls`; pressing it opens the calendar to pick a day; no time-of-day editing |
| Date compact/graphical/wheel styles | Works | Wave 6d: compact (the default) draws the date and time on grey capsules, round at half their height, 34.33 or 36 pt tall, with no chevron, in a Form and outside one; `.graphical` the month in place without the title, 370 by 354 pt (416.67 with the time row); `.wheel` still columns 216 pt tall and 320 wide on a grey band, beside the title or under it in a Form; `displayedComponents:` respected in each. A style written on any view around it, a NavigationStack included, reaches it. Design's Style select writes them. A token iOS has no style for warns |
| `MultiDatePicker` | Missing | Placeholder |
| `ColorPicker` | Partial | Wave 6d: the 28 pt swatch iOS 27 draws, the colour on a disc inside a ring of twelve hues; opens onto the named-color palette; no native grid/spectrum/sliders/opacity picker |
| `PhotosPicker` | Missing | Placeholder; no Photos library, permissions, or transfer support |
| Bordered/prominent/borderless/plain buttons | Works | Distinct common styles, actions, tint and disabled state; native metrics still need broader calibration |
| `Menu` | Partial | Anchored browser action popup; nested menus, previews and platform adaptation incomplete |
| `ControlGroup` | Partial | Horizontal control row; no native contextual/segmented menu grouping |
| `.contextMenu` + preview | Partial | Hold/right-click/keyboard opens action menu; ordinary button taps preserved; custom previews warn; nested/selection menus incomplete |
| `Link` / `ShareLink` | Partial | Label only; no URL-opening or system share-sheet action |
| `EditButton` / `PasteButton` / `RenameButton` | Missing | Placeholders; system actions absent |
| String `TextField` / `SecureField` | Works | Editable binding, masked secure input; value/format overloads and native focus/keyboard are incomplete |
| `TextEditor` | Partial | Bound multiline browser textarea; native editor selection APIs absent |
| `.searchable` | Partial | Search field/binding, placement approximation; native search lifecycle incomplete |
| `.searchScopes` / `.searchSuggestions` | Missing | Warn; scopes and suggestions are not drawn |
| Keyboard toolbar | Missing | `.keyboard` placement warns and is omitted |
| Submit / keyboard hints | Partial | Enter calls common onSubmit closures; keyboardType/submitLabel/capitalization/correction map to browser hints; no native keyboard or focus synchronization |
| `NavigationStack` / destination `NavigationLink` | Partial | Push/back and value destinations work; path synchronization and binding-driven destinations do not |
| `NavigationSplitView` | Partial | Collapsed sidebar stack only, including on iPad; no multi-column detail layout |
| `TabView` / modern `Tab` | Works | Common labels, selection and content switching. Wave 6c: `Tab(role: .search)` is a Search tab with a magnifying glass at the end of the bar, as iOS 27.0 draws it (two tabs and a search tab make a bar as wide as three tabs; four items or more sit 20.33 in from each edge, as native), where it was an empty tab |
| `.sidebarAdaptable` tabs | Missing | Warn; no adaptable sidebar |
| `.page` tabs | Partial | Page dots switch content; no swipe paging |
| Navigation toolbar / `ToolbarItem` | Partial | Leading, trailing, `.principal`, confirmation and cancellation work. Wave 6c, from native captures: `.navigation` leading, `.secondaryAction` behind an ellipsis button, `.primaryAction` and `.confirmationAction` trailing as iOS 27 draws them; `ToolbarSpacer(.fixed)` splits a glass group into two capsules 11 apart and `.flexible` pushes groups to the edges |
| Bottom toolbar | Works | `.bottomBar` items in glass capsules at the foot of the screen (Wave 4b). Wave 6c: `.status` centred in its own capsule, and `DefaultToolbarItem(kind: .search, placement: .bottomBar)` as the bottom search field |
| Navigation title / display mode | Works | Large/inline and browser scroll collapse; limited native reference verified |
| `List` / `Form` / `Section` | Partial | Common grouped/plain forms, headers/footers/insets; binding collections and all list styles incomplete |
| `.swipeActions` | Works | Leading and trailing actions, tints, roles, icons and full swipe, measured against iOS 27 (`native/iphone18pro-system-ui`); `.onDelete` is one case of it |
| `.onDelete` | Works | Standard delete gesture/action updates the collection |
| `.onMove` | Missing | Array move helper exists, but this modifier has no reorder UI/callback path; now warns |
| `.refreshable` | Missing | Warns; no pull-to-refresh callback |
| `DisclosureGroup` | Works | Expanded/collapsed content and binding |
| `OutlineGroup` | Missing | Placeholder; no recursive tree rendering |
| `GroupBox` / `LabeledContent` | Works | Common titled card and label/value row; platform/context defaults approximate |
| `LazyVGrid` / `LazyHGrid` / `Grid` | Partial | Tracks, rows, common alignment; not genuinely virtualized; spans and advanced grid behavior missing |
| `Table` | Missing | Placeholder; no selection/sorting/columns on iPad or Mac |
| `ContentUnavailableView` | Works | Common title/image/description and stock search form; not every initializer audited |
| `ProgressView` | Partial | Linear determinate bar / spinner; richer labels, styles and native sizing incomplete |
| `Gauge` | Partial | Linear bars and distinct circular arcs/markers; further native style/label/metric work needed |
| `.badge` | Partial | Integer/string/Text labels on tabs and list rows; zero integer hidden; advanced styling incomplete |
| `.popoverTip` | Missing | No TipKit tip presentation or eligibility logic |
| `.fileImporter` / `.fileExporter` | Missing | No picker/dialog; file document/Foundation types may also prevent evaluation |
| Markdown in `Text`, `Button`, `Label`, `Toggle`, `Link` and `NavigationLink` titles | Works | Wave 6a: bold, italic, strikethrough, code and links in a literal title, the link in the accent colour, as captured in `native/iphone18pro-text`, with Apple's parser deciding what is Markdown (`snake_case` stays as written; bare links and `&amp;` read as Apple reads them). The marks reach across an interpolated `Image` or `Text`; the characters of an interpolated value, a `String` and `verbatim:` stay as written. The Design field keeps the marks, as the code writes them, and notes "Drawn as Markdown" only where something is formatted. A `LocalizedStringKey` variable is drawn as written, where iOS formats it |
| `AttributedString` | Partial | Wave 6a: drawn by `Text`, directly or interpolated into one, with its common initialisers (`localized:` too), whole-string attributes, the `.swiftUI` scope, an `AttributeContainer`, `inlinePresentationIntent` and range subscripts, where it used to blank the screen; `backgroundColor` is kept but not drawn, and warns; members it doesn't model warn |
| Images in text | Works | Wave 6a: an interpolated `Image` and `Text(Image) + Text` draw the symbol inline, at the size and baseline captured at body and largeTitle, in the text's colour or its gradient; a project image in text draws inline too |
| `.symbolVariant` | Partial | Wave 6a: variant chains such as `.fill.circle` draw the variant symbol instead of stopping the screen; a composed name the preview can't draw draws the base symbol, with a warning, as iOS draws the base where it has no such symbol; `.environment(\.symbolVariants, …)` and `TabView`'s `.symbolVariant(.none)`, which keeps tab icons filled, draw as on iOS. A Filled switch in Design writes `.symbolVariant(.fill)` (Wave 6b) |
| SF Symbols | Partial | Wave 6b: 836 names draw a look-alike, among them all 241 everyday names of the October audit, as Ionicons, Ionicons in a circle, square, octagon, seal, bubble or shield, or one of 80 shapes drawn here after the iOS 27 glyph; a real name with no drawing draws a question mark, with a warning, as does a name whose look-alike would lose its meaning. The symbol picker searches them by name or by an everyday word ("settings" finds gear) and shows them by the studio's own categories. `square.grid.2x2.fill`, the selected tab in the Dispatch and Market templates, is filled now, as iOS draws it, where it drew the outline |
| `.symbolRenderingMode` | Partial | Wave 6b: hierarchical and palette paint a symbol in a container, with a badge, or drawn with layers as layers, under a gradient foreground style too, at the opacities captured on iOS 27; multicolor paints 26 common symbols in their captured colours; a symbol drawn here with one layer stays one colour, with a warning that says so. Design's Rendering select writes the mode, and Palette its Primary and Secondary colors |
| `Image(systemName:variableValue:)` | Partial | Wave 6b: wifi, cellularbars and the speaker waves dim past the value, as captured at 0, 0.5 and 1; other symbols draw in full, with a warning |
| `.symbolEffect` | Partial | Wave 6b: the symbol is drawn still, with no warning, as iOS draws it before and after the effect; `.disappear`, and `.appear` while active, hide it and keep its space; `.scale` warns that the preview doesn't scale it |
| `.mask` | Partial | Wave 6a: gradient, colour, shape, `Text` and symbol masks, so gradient text through a mask draws; a translucent mask lets its opacity through, as iOS does; other views as masks warn and draw unmasked |
| `.zIndex` | Works | Wave 6a: changes the paint order among siblings, keeping layout |
| `.tabViewBottomAccessory` | Works | Wave 6c: a glass capsule 48 tall, 7.67 above the tab bar and 20.33 from the screen's edges, as captured in `native/iphone18pro-chrome`; the bar stretches to the same width; `isEnabled: false` draws none |
| `.navigationSubtitle` | Works | Wave 6c: a 12-pt secondary line (caption) under the inline title, which draws at 16 pt semibold, and under the large title, as captured in `native/iphone18pro-chrome`; a string or a `Text` |
| `GlassEffectContainer` | Partial | Wave 6c: its content is laid out as a centred VStack, as iOS 27 does, each view with its own glass; nearby glass shapes are not merged |
| Views beside `NavigationStack` / `TabView` | Partial | Wave 6c: a button in a `ZStack` beside a stack paints above its bars and takes taps (a `.padding(20)` 56-pt circle at 326..382 x 764..820, as native); a view in a `VStack` under a `TabView` takes its height and the bar moves up above it; an `.overlay` on the stack paints above the screen and below sheets and alerts; popovers and context menus open at their source, and those views are outlined and dragged where they are drawn. The app's outermost container only: beside a NavigationStack inside a tab's page, a view still warns and is left out |
| `.contentMargins` | Works | Wave 6d: insets a scroll view's content on the edges and by the lengths written, for `.scrollContent` or automatically, so the next card of a carousel shows beside the first, as captured in `native/iphone18pro-controls`; `.scrollIndicators` moves nothing drawn; on an inset grouped List the top margin and the row inset follow iOS 27, and a margin on one side of a List or a Form moves that side only. Design's Peek field writes the horizontal one and reads only `.contentMargins`; beside a sideways `.safeAreaPadding` it shows that padding read only |
| `.safeAreaPadding` | Works | Wave 6d: insets a scroll view's content as a content margin does, and pads any other view |
| `.scrollTargetBehavior(.viewAligned)` / `.scrollTargetLayout()` | Partial | Wave 6d: a scroll comes to rest on the nearest view's start in the stack marked `.scrollTargetLayout()`, less its leading margin, and without the marker it scrolls freely, as on iOS; `limitBehavior:` is not applied; the motion is the browser's |
| `MeshGradient` | Partial | Wave 6d: painted from its grid, smoothed or not, as captured on a 3 by 3 mesh, and sized by its frame, as a view, a background or a shape's fill, where it was a labelled box; `background:` and `colorSpace:` are not applied, and as the colour of a text, a label or a symbol, or as a stroke, it is one colour, with a warning, while a shape styled with it paints the full mesh |
| Fonts iOS ships (`.custom("Avenir Next", size:)`) | Partial | Wave 6a: drawn in the browser's copy of the family, or the closest web face, with no "not in this project" warning; a PostScript name counts only if it is a face iOS ships, so `Georgia-Light` warns and draws the system font, as iOS does. A project's own font files are Wave 6f |

## How to reproduce

```sh
npm run test:visual
npm run verify
npm run build
WRITE_IOS27_EXPORT=/tmp/swiftui-comparison npm test -- tests/ios27-export.test.ts
```

The export includes `VisualStressApp/VisualStressApp.xcodeproj`. Open it in Xcode,
select iPhone 18 Pro and Run. Its three tabs exercise controls, presentations and
containers. Use the exact same `tests/fixtures/ios27-visual-stress.swift` in the web app.
Start with matching device, light appearance and default text size; then repeat dark,
accessibility text, and iPad after the first comparison is stable.

The browser regression is `e2e/visual-stress.spec.ts`. No provider key or network model
request is needed for any of these fixtures.

## Remaining work in useful order

1. Native keyboard/focus behavior and bottom/keyboard toolbars.
2. User-defined swipe actions, row reordering and refresh callbacks.
3. Draggable sheet detents, selection write-back, richer picker/date/time editing.
4. Native-only integrations or explicit browser substitutes for photos, files, clipboard,
   sharing and TipKit. These require platform capabilities, not just CSS.
5. Additional iPhone sizes and accessibility captures; then iPad split navigation,
   adaptive inspectors, tables and trees.

Do not label the overall renderer “fully SwiftUI compatible” when these checks pass.

## Original audit validation (before screenshot follow-up)

See [the follow-up report](17-IOS-CONTROL-PARITY.md) for current measurements and checks.

- `npm run verify`: type checks and lint passed; **2,737 tests passed, one skipped**.
- New visual suite: **503 checks passed** (including explicit gap diagnostics).
- Production build passed. Client bundle remains within budget at 460.8 KB / 470 KB,
  with the existing near-limit warning.
- Existing native reference geometry/provenance tests passed unchanged.
- Browser smoke checks: alert editing survived dismissal/reopening; fixed-height sheet
  rendered yellow (height was 234 points at this stage; the follow-up corrects it to
  226 for the floating sheet margin); switching tabs
  and dark appearance worked; no browser console errors were observed.
- The new Playwright spec could not launch locally because its expected Chromium
  headless-shell executable was absent. It was not counted as a passing automated E2E run.
- No commit or push was made.
