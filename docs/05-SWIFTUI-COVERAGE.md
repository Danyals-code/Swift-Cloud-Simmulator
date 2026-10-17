# 05 - SwiftUI coverage matrix

The public contract for what renders. Updated in the same PR as any runtime change.

Status: ✅ done · 🟡 partial (limitations noted) · ⬜ planned, phase given · ✗ declined (reason given)

Last audited on 2026-09-17 with independent snippets and interaction tests. See
[the compatibility audit](15-SWIFTUI-COMPATIBILITY-AUDIT.md) for confirmed failures,
fixes, remaining gaps, resource limits, and reproduction commands. The later
[visual checklist audit](16-SWIFTUI-VISUAL-CHECKLIST.md) covers presentations, controls,
containers and system APIs item by item, with native comparison limitations.

**This is a browser implementation of a subset, not the Apple SwiftUI runtime.** A supported
name does not guarantee every overload, modifier combination, or Swift language feature.
The status rows are a feature inventory, not a measured percentage of SwiftUI compatibility.

Known unsupported view names produce placeholders and diagnostics. So does a capitalised name the
preview doesn't know, written where a view goes: it draws a labelled placeholder with a warning, and
what it was given is not run. A name close to a type the project or SwiftUI declares stays an error
that offers that type, and elsewhere, as in `let formatter = DateFormatter()`, an unknown name is
still an unresolved-identifier error. Recognized unsupported modifiers warn; unknown
modifiers warn when the checker can establish that the receiver is a view. The Coverage panel
records these reports locally. It cannot detect all silent semantic differences.

A ⬜ row is not a promise of a date - it is a statement that the construct is recognised, reported by
name, and exported to Xcode unchanged. A row with a phase number is a commitment; a row with a `-` is
a judgement that the construct does not belong in a browser preview, or that it is a larger piece of
work to be chosen deliberately rather than swept up.

A 🟡 row always names its limitation, either in its own Notes column or under **Known
approximations** below. "Partial" with nothing said is indistinguishable from a bug.

## Layout

| View | Status | Phase | Notes |
| --- | --- | --- | --- |
| `VStack` / `HStack` / `ZStack` | ✅ | 3 | alignment, spacing |
| `Spacer` | ✅ | 3 | minLength; the canonical test of the layout engine. The views beside it take what they need first and it keeps back only its minimum, so a long label stays on one line beside it, as in the iOS 27 simulator |
| `Divider` | ✅ | 6 | hairline across its stack's axis |
| `Group` | ✅ | 3 | a modifier on one applies to each *child*, as SwiftUI's does - it is not a container, so `Group { … }.font(.caption)` is the same as writing the font on both |
| `ForEach` | 🟡 | 6 | ranges, `Identifiable`, `id:` key paths, a computed `id` and `\.rawValue` included; each row is tagged with its id, as SwiftUI tags it. Every row keeps its own identity: ids that differ only in punctuation ("C", "C++"), several rows drawn for one element, and an id two elements share, which warns as SwiftUI does. Binding collection closures (`ForEach($items) { $item in }`) are unsupported. Preview limit: 1,000 elements, with a diagnostic instead of truncation |
| `ScrollView` | ✅ | 6 | both axes; scrolls natively, so the physics are the browser's. Vertical content keeps its own height at the top, centred across, as in iOS 27 |
| `GeometryReader` | ✅ | 7 | reports its real size through `size` and where it is on the screen through `frame(in: .global)`, in a sheet too, and through `safeAreaInsets` the insets of the edges it touches, bars included, as iOS 27 does. A reader inside another reader reads no insets. It is its own coordinate space. A named coordinate space is read as the screen |
| `LazyVStack` / `LazyHStack` | 🟡 | 6 | laid out as stacks: correct, and not virtualised. A 200-row stack measures in 7.6 ms against a 120 ms budget, so the cost is real and not yet worth the identity complexity |
| `LazyVGrid` / `LazyHGrid` | ✅ | 6 | fixed, flexible and adaptive columns |
| `Grid` / `GridRow` | ✅ | 7 | columns align across rows |
| `ViewThatFits` | ✅ | 7 | |
| `AnyView` | ✅ | 7 | erasure is a compile-time concern; at runtime it is its content, wherever the content arrives - as the argument it is written as, not only as a builder closure |
| `Layout` protocol (custom layouts) | ✗ | - | needs a `Subviews` proxy and callbacks from the engine back into the interpreter for sizing as well as placement - a real seam, and custom conformances are rare in app code |
| `AnyLayout` | ✗ | - | the same seam |

## Content views

| View | Status | Phase | Notes |
| --- | --- | --- | --- |
| `Text` | ✅ | 3 | interpolation, with `specifier:` and `format:` inside it too, `verbatim:`, `format:` number styles (`.number`, `.percent`, `.currency(code:)`), a `Date` with `style:` (`.time`, `.date`, `.relative`, `.offset`, `.timer`), and `Date.FormatStyle` field chains (`.dateTime.weekday(.wide).hour().minute()`) written in en-US order as Foundation writes them. `Text + Text` concatenates, and each half keeps its own face, colour and attributes, as does a `Text` interpolated into a `Text`. Interpolated into a `Button`'s or a navigation title, it is drawn as its words, without its styling. A title written as a literal, a `Text`'s or a `Button`'s, a `Label`'s, a `Section`'s or a navigation title, writes a number put into it as iOS 27 does: 2,000, and a Double with six decimals, 3.500000; a `String`, `verbatim:` and a project's own views keep Swift's text, 2000 |
| Markdown in a literal title | ✅ | Wave 6a | a `Text`'s, `Button`'s, `Label`'s, `Toggle`'s, `Link`'s or `NavigationLink`'s title written as a literal is drawn as iOS 27 draws it: `**bold**`, `*italic*`, `***both***`, `~~strike~~` and `~strike~`, `` `code` `` in the monospaced face, and `[a link](url)` in the accent colour, with the marks left out. One parser, Apple's rules, decides what is Markdown for both the canvas and the Design panel: the flanking rules hold, so `5 * 3 * 2` and `snake_case` stay as written; a bare `https://apple.com`, `www.apple.com` or `support@apple.com`, and `<https://apple.com>`, are links; and `&amp;` is `&`. The marks reach across what is interpolated: `Text("**Rated \(Image(systemName: "star.fill")) 4.8**")` draws the words bold around the star, and a `Text` put into the title keeps its own styling inside the marks around it. The characters of an interpolated value are never parsed, and a `String` variable and `verbatim:` keep theirs, as on iOS. A `LocalizedStringKey` held in a variable is drawn as written, where iOS formats it. Before Wave 6a the marks were drawn as written, with no warning |
| Images in text | ✅ | Wave 6a | `Text("Rated \(Image(systemName: "star.fill")) 4.8")` and `Text(Image(systemName: "heart.fill")) + Text(" Favourites")` draw the symbol inline, at the size iOS 27 gives it beside the text's font and on its baseline, in the text's colour or, under a gradient `.foregroundStyle`, in the gradient. A project image, `Text("Named \(Image("photo")) here")`, draws inline too. Before Wave 6a the first drew "View" and the second dropped the image |
| `Label` | ✅ | 6 | icon then title. In a list row, as iOS 27 draws it, the icon is a quarter larger than the row's text, tinted and centred in a 24-pt column, with the title at 72 on the phone |
| `Image(systemName:)` | 🟡 | Wave 6b | 836 names draw a look-alike, among them all 241 everyday names of the October audit and 680 of a wider list of 902: Ionicons where one is close, enclosed in a circle or a square and filled for the `.circle`, `.square` and `.fill` names, and shapes drawn here after the iOS 27 simulator's glyph where nothing is close (person.crop.circle, checklist, line.3.horizontal.decrease, a cup and saucer, a flame, a waveform, outlined charts). A name Apple ships that the preview has no drawing for draws a question mark, and the checker says so, as do names whose nearest look-alike would draw like a plainer neighbour and lose the meaning (`person.wave.2`, `moon.zzz`, `qrcode.viewfinder`, `restart`); Xcode draws the real symbol. Never Apple artwork. A `.fill` name draws filled where the preview drew the outline before: the selected tab in the Dispatch and Market templates (Overview and Discover, `square.grid.2x2`, which iOS fills when selected) is filled now, as iOS draws it. Before Wave 6b 84 of the audit's 241 everyday names drew the question mark |
| `Image(systemName:variableValue:)` | 🟡 | Wave 6b | `wifi`, `cellularbars` and `speaker.wave.1`, `.2` and `.3`, filled or not, dim the bars or waves past the value, as iOS 27 does at 0, 0.5 and 1. Any other symbol is drawn in full, and the checker says so; iOS fills it part way where the symbol can be. Before Wave 6b every symbol was drawn in full |
| `Image("asset")` | ✅ | - | PNG and JPEG images in the project's Assets, with light and dark variants, resized, scaled and clipped as iOS does. SVG, PDF and HEIC are rejected when added, rather than drawn wrongly |
| `GroupBox` | ✅ | - | a titled card: the label above, the contents on a rounded secondary panel |
| `LabeledContent` | ✅ | - | label leading, value trailing in the secondary colour; both the `value:` and content forms |
| `ContentUnavailableView` | ✅ | 13 | the empty state as iOS 27 draws it: a 40-pt symbol in the secondary colour, a bold title3 title, and a title3 description in centred lines 32 pt in from each side, centred with 30 pt of space under it. `.search` is the stock spelling and carries its own text. The form built from content closures, and its actions, are not drawn |
| `ControlGroup` | 🟡 | - | its controls in a row. Drawn as the toolbar form, not the segmented form a menu gives it |
| `ScrollViewReader` | 🟡 | - | what it holds is drawn, and handed a proxy whose `scrollTo` does nothing: there is no channel from the worker to the browser's scroll position. Warns at the reader |
| `AsyncImage` | 🟡 | 7 | draws its `placeholder:`, because there is no network in the worker. Its content closure is not run: there is no `Image` to hand it |
| `Link` / `ShareLink` | 🟡 | 6 | drawn as iOS 27 draws them: the title or the label given, in the accent colour, and a share link without a label is the share icon and "Share…". Tapping opens nothing, and says so. `URL(string:)` exists, so the `destination:` can be written |
| `ProgressView` | ✅ | 6 | determinate bar filling from its leading edge; `.circular` and the indeterminate form are the turning activity indicator |
| `Gauge` | 🟡 | 7 | linear labelled bars and value-dependent circular arcs/markers; native metrics and all label/style arrangements remain approximate |
| `Canvas` | ✅ | 7 | `fill` and `stroke`; drawings become the same vector nodes a `Path` does |
| `TimelineView` | 🟡 | - | its content is drawn once, for the moment of the render: `context.date` is now. The schedule is a clock the preview does not run |
| `Chart` (Swift Charts) | ⬜ | Wave 6e | drawn as a labelled box until Wave 6e draws the marks, axes and legend. Since Wave 6a every mark (`SectorMark` too) and the chart modifiers (`.chartXAxis`, `.chartYScale`, `.chartLegend`, `.annotation`) are known names, so none of them says Xcode won't build |
| `Map` (MapKit) | ✗ | - | Needs a licensed tile source; placeholder with a note |
| `UIViewRepresentable` | ✗ | - | Cannot run UIKit; labelled placeholder |

## Controls

| View | Status | Phase | Notes |
| --- | --- | --- | --- |
| `Button` | ✅ | 3 | every action form: a trailing closure, `action:` with a closure or a named function, `action:label:`, and with `role:` or `systemImage:` |
| `Toggle` | ✅ | 6 | |
| `Slider` | ✅ | 6 | |
| `Stepper` | ✅ | 6 | each half is its own target; `step:` and `in:` are both honoured |
| `TextField` / `SecureField` | 🟡 | 6 | String-backed inputs with a caret; `SecureField` masks using a password input. Numeric value/format/formatter bindings and axis-based multiline fields warn as unsupported |
| `TextEditor` | 🟡 | 7 | editable multiline textarea with String binding, wrapping and scrolling; native selection, keyboard and advanced TextEditor APIs remain incomplete |
| `Picker` | 🟡 | 6 | opens onto its options, ticks the chosen one, writes the selection. `.segmented`, `.inline` and `.wheel` draw them in place instead. A row selects by its `.tag`, or over `ForEach` by its id, when that has the selection's type, as measured in iOS 27: an enum whose `id` is a `String` selects nothing, and nor do `ForEach`'s own tags for an Optional selection. Where no row can be selected it warns, and a menu picker shows no value. The popup is drawn at the bottom rather than anchored to the control |
| `DatePicker` | 🟡 | 7, Wave 6d | drawn in its style as iOS 27 draws it (`native/iphone18pro-controls`), in a Form and outside one. Compact, the default, puts the date and the time on grey capsules at the trailing edge: tertiary system fill, round at half their height, 12 pt each side of the text and 4 pt apart, 34.33 pt tall for a date alone and 36 with a time, with no chevron. `.graphical` draws the month in place without the title, 370 by 354 pt across a padded 402 pt screen, its name and arrows over the weekdays and the chosen day on a disc, and 416.67 tall with the time row under it, a semibold "Time" and a time capsule. `.wheel` draws spinning columns 216 pt tall and 320 wide beside the title, or under it in a Form: seven rows to a column, the chosen one on a grey band and three either side, closer together and flatter away from it, as on a cylinder. It is a still drawing. `displayedComponents:` chooses date, time or both in every style. Pressing a capsule or a wheel opens the calendar: pick a day, page the month. No time-of-day editor, so the time is the binding's own. `.datePickerStyle` reaches every DatePicker inside the view it is written on, a NavigationStack included. A style iOS has no such token for, such as `.field`, warns. Design's Style select writes the style (Compact and Graphical need iOS 14). Before Wave 6d every DatePicker was a menu row with a chevron |
| `ColorPicker` | 🟡 | 7, Wave 6d | drawn as iOS 27 draws it: the title, and at the trailing edge a 28 pt swatch, the selected colour on an 18 pt disc inside a 3 pt ring of twelve hues from the top clockwise, 2 pt apart. A translucent colour is drawn as it is over what is behind it, with no checkerboard, as on iOS. Opens onto SwiftUI's named colours as swatches. Not a continuous surface - see approximations. Before Wave 6d it drew an empty value and a chevron |
| `Menu` | 🟡 | 7 | opens onto its buttons, over `ForEach` too; pressing one runs its action. Drawn at the bottom rather than anchored to the control |

## Collections and navigation

| View | Status | Phase | Notes |
| --- | --- | --- | --- |
| `List` | 🟡 | 6 | plain/grouped/sidebar styles; binding collection closures are unsupported. A row's separator starts under its first text, as iOS 27 draws it: a Label's title, the text beside an icon, or the row's inset with no text |
| `Section` | ✅ | 6 | header and footer, the footer in the secondary colour under the card |
| `Form` | ✅ | 6 | the grouped-list form |
| `.onDelete` | ✅ | 7 | swipe a row to reveal it; `remove(atOffsets:)` included, given the place of the element the row was drawn for; `perform:` takes a closure or a named function, as do `.onAppear`, `.task` and `.onTapGesture` |
| `.onMove` | ⬜ | - | warns; no reorder UI or modifier callback. The array move helper is separate |
| `.swipeActions` | ✅ | Wave 4a | leading and trailing actions drawn as iOS 27 draws them: tints, roles, icons, titles and full swipe; a tap runs the action and closes the row. `.onDelete` is one case of it. The Design canvas draws a row open while one of its actions is selected |
| `.searchable` | ✅ | 7 | a field with its magnifying glass, writing its binding. On a phone it is at the bottom of the screen, or under the title in a tab app, and on iPad in the toolbar. Written on the NavigationStack, it searches the stack's root screen only, and on a TabView without a search tab it draws nothing, as in iOS 27 |
| `.refreshable` | ⬜ | - | pull-to-refresh callback is not implemented |
| `DisclosureGroup` | ✅ | 7 | opens and closes; `isExpanded:` is read where the user gave one |
| `Table` / `OutlineGroup` | ⬜ | - | a labelled placeholder. The closure of a view the preview does not draw is no longer run, so a `TableColumn`'s row parameter cannot trap |
| `NavigationStack` + `NavigationLink` | 🟡 | 6 | destination/value links work. Bound `NavigationStack(path:)` is not synchronized and now warns |
| `.navigationDestination` | 🟡 | 6 | `for:` with a metatype, resolved on link push. `isPresented:` and `item:` overloads warn as unsupported |
| `.navigationTitle` | ✅ | 6 | large and inline, with `navigationBarTitleDisplayMode` |
| `.toolbar` | 🟡 | 6 | items drawn as iOS 27 draws them: a Label as its icon alone in a 44-pt glass circle, text in a 44-pt capsule, the label colour unless a tint is written, and items side by side in one capsule. A NavigationLink in the toolbar pushes. Leading and trailing (and their older names), `.principal` in the title's place and `.bottomBar` at the foot of the screen since Wave 4b. Since Wave 6c, as captured in `native/iphone18pro-chrome`: `.navigation` at the leading side, `.status` in the middle of the bottom bar in a glass capsule of its own, `.secondaryAction` behind an ellipsis button named More at the trailing side, whose menu lists them, and `.confirmationAction` and `.primaryAction` at the trailing side as iOS 27 draws them. The `.keyboard` placement warns and is omitted |
| `ToolbarSpacer`, `DefaultToolbarItem` | ✅ | Wave 6c | a `.fixed` spacer splits a glass group into two capsules 11 pt apart, and a `.flexible` one pushes the groups to the edges, in the navigation bar and the bottom bar. `DefaultToolbarItem(kind: .search, placement: .bottomBar)` draws the bottom search field, as iOS 27 draws it; at other placements it draws nothing |
| `.toolbarBackground` | 🟡 | - | navigation bar only: `.hidden` paints no bar background, so the content behind shows, and a colour or gradient paints that. `.visible` and the other bars draw as before. A view extending under the bar with `.ignoresSafeArea` also clears the bar, as iOS does at the top of the content |
| `TabView` | ✅ | 6 | tab bar with `.tabItem` or `Tab`, bound or unbound selection, pages from `ForEach` selected by their ids, a `TabSection`'s tabs in the bar with the others, and `.page`, whose dots are also the way through - a preview has no swipe. Since Wave 6c, `Tab(role: .search)` is drawn as iOS 27.0 draws it: a tab labelled Search with a magnifying glass at the end of the bar, as wide as the others, where it was an empty tab; a tap on it opens its tab. A bar of four items or more, a search tab among them, is 20.33 pt in from each edge, as native draws it (it was 17); a bar of three or fewer draws as before |
| `.tabViewBottomAccessory` | ✅ | Wave 6c | a glass capsule 48 pt tall, 7.67 pt above the tab bar and 20.33 pt from the screen's edges, holding the accessory's views, as measured in the iOS 27 simulator; the tab bar stretches to the same width. With `isEnabled: false` there is no capsule and the bar keeps its own width, as on iOS |
| `.navigationSubtitle` | ✅ | Wave 6c | a 12-pt line in the secondary colour (the caption style) under the title, as measured in the iOS 27 simulator: inline, the title draws at 16 pt semibold and the two sit centred together on the bar's row; large, the title moves down 3 pt and the content 19.33 pt. Written as a string or as a `Text`; a `Text` the preview can't read as one string warns |
| Views beside a `NavigationStack` or `TabView` | 🟡 | Wave 6c | a view in a `ZStack` beside the container, a view in a `VStack` above or below it, and an `.overlay` or `.safeAreaInset` written on it are drawn. The screen, with its bars, is laid out in the space the container is given: a `ZStack` sibling paints above the bars, a `VStack` sibling takes its height, so a tab bar moves up above a mini player, and an overlay paints above the screen and below a sheet or alert. A popover or a context menu opens at its source, and a view beside the container, or inside a container that doesn't start at the screen's corner, is outlined and dragged where it is drawn. A screen with nothing beside its containers draws as before. Only the app's outermost container: a view beside a NavigationStack inside a tab's page still warns and is not drawn |
| `NavigationSplitView` | 🟡 | - | collapsed sidebar stack on every device; no iPad multi-column layout |
| Back gesture | ✗ | - | the preview offers the back *button*; an edge swipe has no analogue here |

## Presentation

| Modifier | Status | Phase | Notes |
| --- | --- | --- | --- |
| `.sheet` (+ `presentationDetents`) | 🟡 | 6 | medium/large/fraction/height and supplied selection; no detent dragging |
| `.fullScreenCover` | ✅ | 6 |
| `.alert` | 🟡 | 6 | title/message, action pills and bound text/secure fields; backdrop does not dismiss. Native keyboard/focus and all overloads incomplete |
| `.confirmationDialog` | 🟡 | 6 | floating capsule-action panel matched to supplied iPhone capture; explicit title visibility, destructive actions and backdrop dismissal; platform adaptation approximate |
| `.popover` | 🟡 | Wave 6c | a sheet on iPhone, as iOS adapts a popover in compact width. With `.presentationCompactAdaptation(.popover)` it is a bubble sized to its content, with corners of about 28 pt and an arrow 13 pt tall, above the view that opens it when it fits there and below it otherwise, its arrow at the middle of that edge. `attachmentAnchor:` and `arrowEdge:` are not drawn and warn. A popover on a toolbar button presents nothing. No regular-width (iPad) popover |
| `.presentationBackground` | 🟡 | - | Color and Material work; custom view backgrounds warn |
| `.presentationBackgroundInteraction` | 🟡 | - | enabled/disabled and enabled(upThrough:) control background hit testing for the current sheet detent; no detent dragging |
| `.inspector` | 🟡 | - | iPhone sheet adaptation and binding dismissal; no iPad trailing-column implementation |
| `.presentationDragIndicator` / `.presentationCornerRadius` | ✅ | - | explicit visibility/radius; automatic grabber for multiple detents |
| `.interactiveDismissDisabled` | 🟡 | - | prevents preview backdrop dismissal; native swipe gesture absent |
| `@Environment(\.dismiss)` | ✅ | 7 | closes whatever is presented when it is called |

## Modifiers - layout and sizing

| Modifier | Status | Phase | Notes |
| --- | --- | --- | --- |
| `.frame(width:height:alignment:)` | ✅ | 3 | |
| `.frame(minWidth:idealWidth:maxWidth:...)` | ✅ | 3 | min/max constraints, maximum infinity, and ideal dimensions where a parent asks for them (`fixedSize`) |
| `.padding` | ✅ | 3 | all edge-set forms |
| `.fixedSize` | ✅ | 6 | both the whole-view and per-axis forms |
| `.layoutPriority` | ✅ | 7 | the highest-priority group takes its space first |
| `.offset` | ✅ | 6 | paint-time, so neighbours do not move; `x:y:` or a `CGSize` |
| `.position` | ✅ | 7 | centres the view on a point in its parent's space; `x:y:` or a `CGPoint` |
| `.aspectRatio` / `.scaledToFit` / `.scaledToFill` | ✅ | 7 | |
| `.ignoresSafeArea` | ✅ | 7 | per view, as in iOS 27: a view reaches into the safe area only across the edges it touches, and moves rather than grows. `.keyboard` alone changes nothing; `.edgesIgnoringSafeArea` is read the same way |
| `.safeAreaInset` | ✅ | - | all four edges; the content is *inset*, not overlaid, so a bar drawn this way does not cover the last row |
| `.alignmentGuide` | ✅ | - | the stack aligns guides rather than edges, so a guide can be replaced. `d.width`, `d.height` and `d[.leading]` and friends all read |
| `.containerRelativeFrame` | 🟡 | - | takes the container's size along the named axes, divided by `count`. The container is whatever proposed the size, which is the scroll view or stack above it |
| `.contentMargins` | ✅ | Wave 6d | insets what a scroll view holds, not the scroll view, as measured in iOS 27: `.contentMargins(.horizontal, 24, for: .scrollContent)` puts the first card 24 pt in, the scroll view keeps its full width, and the next card shows beside the first. Any edges and lengths (16 pt when none is given) and an `EdgeInsets`; with no `for:` (automatic) the same, and `for: .scrollIndicators` moves nothing the preview draws. A `.scrollContent` margin written around an automatic one replaces it. A horizontal ScrollView grows by its top and bottom margins (`.contentMargins(10)` makes a row of 120 pt cards 140 tall), and a vertical one starts its first view below the top margin. On an inset grouped List, `.contentMargins(.top, 40)` is a floor on the gap above an unheaded first section and adds 40 above a header, and a horizontal margin for `.scrollContent` replaces the 16 pt inset of its rows. A margin on one side of a List or a Form moves that side only: `.contentMargins(.leading, 40)` puts the rows 40 in from the leading edge and leaves the trailing inset as it was. It reaches the scroll views and lists inside the view it is written on. Needs iOS 17. Design's Peek field on a horizontal ScrollView writes the horizontal one, and reads only `.contentMargins`: on a ScrollView with its own sideways `.safeAreaPadding` Peek shows that modifier as written, read only, to change in Code |
| `.safeAreaPadding` | ✅ | Wave 6d | on a scroll view it insets the content as a content margin does (`.safeAreaPadding(.horizontal, 24)` puts the first card at 24); on any other view it pads, as `.padding` does (a `Text` grows by 20 on each side with `.safeAreaPadding(20)`). Needs iOS 17 |
| `.scrollTargetBehavior`, `.scrollTargetLayout` | 🟡 | Wave 6d | `.paging` comes to rest a page at a time (Wave 4c), and `.viewAligned` on the nearest view's start, as iOS 27 does: 300 pt cards 12 apart settle at 0, 312 and 624, and with a 24 pt content margin each comes to rest 24 from the edge. `.viewAligned(limitBehavior:)` comes to rest the same way, its limit not applied. The views aligned to are the ones in the stack marked `.scrollTargetLayout()`, which draws nothing, lazy or not and at any depth in the content; without that marker `.viewAligned` comes to rest wherever the scroll stops, as measured on iOS 27. The scroll's motion is the browser's |
| `.zIndex` | ✅ | Wave 6a | raises or lowers a view in the paint order of its `ZStack`, stack or overlay, keeping the written order among equal values. Layout doesn't change, as on iOS |

## Modifiers - appearance

| Modifier | Status | Phase |
| --- | --- | --- |
| `.foregroundStyle` / `.foregroundColor` | ✅ | 3 |
| `.background` (colour, gradient, shape, view) | ✅ | 6 | materials, content builders, alignment, and built-in shape clipping via `in:`; `fillStyle:` warns as unsupported. A colour, gradient or material reaches into the safe area its view touches, as the ShapeStyle form does in iOS 27; a view given as the background stays inside |
| `.overlay` | ✅ | 6 | view arguments and content builders, including interactive content and alignment |
| `.font` (text styles and `.system(size:weight:design:)`) | ✅ | 6 | a size from an `@ScaledMetric` property grows with Dynamic Type, as `.font(.system(size: iconSize, weight: .semibold))` does in the app |
| `.font(.custom(_:size:))` with a family iOS ships | 🟡 | Wave 6a | Avenir Next, Georgia, Menlo, Helvetica Neue, Futura, Didot, Baskerville, Gill Sans, Palatino, Optima, American Typewriter, Courier New, Times New Roman, Verdana, Snell Roundhand, Marker Felt, Noteworthy, Rockwell, Chalkboard SE and Zapfino, by family name or by the exact PostScript name of a face iOS ships (`AvenirNext-DemiBold` is weight 600), with `relativeTo:` and `fixedSize:`. A name that looks like a face but isn't one, such as `Georgia-Light`, is a font iOS doesn't have: iOS draws the system font for it, and the checker warns rather than drawing Georgia. Drawn in the browser's own copy of the face where it has one, and in the closest web face otherwise, with no warning. A family iOS doesn't ship still warns that it is not in this project; font files of a project's own come in Wave 6f |
| `.bold` / `.italic` / `.fontWeight` | ✅ | 6 | compose with `.font` in either order |
| `.opacity` | ✅ | 3 |
| `.cornerRadius` | ✅ | 3 |
| `.clipShape` / `.clipped` | ✅ | 6 | a real clipping container, so children are clipped too |
| `.shadow` | ✅ | 6 |
| `.border` | ✅ | 6 |
| `.rotationEffect` / `.scaleEffect` | ✅ | 6 | paint-time, so layout keeps the untransformed size |
| `.blur` / `.saturation` / `.brightness` / `.contrast` / `.grayscale` | ✅ | 7 |
| `.mask` | 🟡 | Wave 6a | a gradient or a colour, as an argument or in the closure, the fade of an image into its background. Since Wave 6a also a shape (`Color.blue.mask(Circle())`, drawn as its clip), a `Text` (the masked gradient or colour paints the letters, so a gradient masked by a Text is gradient text, as is `.overlay(gradient).mask(sameText)`), and a symbol `Image`, in either the argument or the `alignment:` closure form. A mask's own opacity counts, as on iOS: `.mask(Circle().fill(.black.opacity(0.3)))` shows the view at 30% inside the circle, and a mask painted with a translucent colour lets that much through. Any other view as a mask warns and is drawn unmasked |
| `.blendMode` | 🟡 | - | the sixteen modes CSS shares with SwiftUI; `.plusLighter` and the `sourceAtop` family warn rather than drawing the nearest one |
| `.hueRotation` / `.colorMultiply` | ✅ | - | the multiply is an overlay, since no CSS filter multiplies by a colour |
| `.rotation3DEffect` | ✅ | - | a real rotation with a perspective, about the axis vector given |
| `.redacted` / `.unredacted` | ✅ | - | text and images become bars of the size the engine laid out for them |
| `.tint` / `.accentColor` | ✅ | 6 | a destructive button stays red whatever its tint, as on iOS; its own `.foregroundStyle` recolours it. A screen pushed by a link takes the stack's styles, not ones written on the link - a row's `.buttonStyle(.plain)` no longer greys the buttons on the screen it opens |
| `.buttonStyle` | 🟡 | 6 | `.bordered` and `.borderedProminent`; others fall back to plain. `.controlSize` scales it and `.buttonBorderShape` rounds it |
| `.toggleStyle` | ✅ | - | `.switch`, `.button` and `.checkbox` each draw differently, and all three stay pressable |
| `.pickerStyle` | 🟡 | - | segmented/menu/inline selection; wheel is a dimmed column. Navigation-link and palette styles warn. Menu displays the selected label |
| `.labelStyle` | ✅ | - | `.iconOnly` and `.titleOnly` drop the half they name; inherited, so a Button can set it for its Label |
| `.controlSize` / `.buttonBorderShape` | ✅ | - | the first scales a bordered button's padding, the second its corner |
| `.listStyle` / `.textFieldStyle` | ✅ | 6 |
| `.lineLimit` / `.multilineTextAlignment` / `.textCase` | ✅ | 7 | inherited, so a stack can set them for its text. The `2...4` form reserves its floor as well as capping at its ceiling |
| `.monospaced` | ✅ | 7 |
| `.fontDesign` | ✅ | 10 | inherited separately from size, as in SwiftUI |
| `.fontWidth` / `Font.width(_:)` | ⬜ | - | drawn at the standard width, and warns. Both browsers stretch the system font, but the text measurer cannot: WebKit's canvas ignores a font's stretch and Chromium's takes only the named stretches, which miss `.expanded` by 5%. iOS 27 draws `.condensed` at 0.80 of the standard width, `.compressed` at 0.68 and `.expanded` at 1.28 |
| `.underline` / `.strikethrough` | ✅ | - | inherited like the font, and each takes the `Bool` form so a binding can switch one off |
| `.kerning` / `.tracking` | ✅ | - | measured, not painted: the extra advance is in the width the engine reports. The two are applied identically - see approximations |
| `.baselineOffset` / `.lineSpacing` | ✅ | - | `lineSpacing` is a gap *between* lines, so a single line is unaffected |
| `.minimumScaleFactor` | ✅ | - | re-measures at smaller sizes until the text fits its line limit, then truncates what is still over. Stepped in tenths of the range rather than continuously |
| `.truncationMode` | ✅ | - | `.head`, `.middle` and `.tail`, decided against the whole remaining text rather than the last visible line |
| `.allowsTightening` | ✅ | - | condenses up to half a point per character, and only where the text would otherwise break |
| `.monospacedDigit` | ✅ | - | every digit takes the widest one's advance, in the measured frame as well as the paint |
| `.symbolVariant` | 🟡 | Wave 6a | `.fill`, `.circle`, `.square`, `.slash` and their chains, such as `.fill.circle`, draw the variant symbol (`star` becomes `star.circle.fill`) where iOS has that symbol, in SF Symbols' order whichever way the chain is written. Where the preview has no drawing for the composed name it draws the symbol as written, and the checker says so; iOS does the same where it has no such symbol (`folder` with `.square` draws `folder`). A variant on a container reaches every symbol inside it, and `.environment(\.symbolVariants, .fill)` does the same. `.symbolVariant(.none)` on a `TabView` changes nothing: iOS 27 keeps the tab icons filled, and so does the preview. `SymbolVariants` is a known type, so `let v: SymbolVariants = .fill` draws without a warning. Before Wave 6a a chain stopped the screen |
| `.symbolRenderingMode` | 🟡 | Wave 6b | `.hierarchical` and `.palette` paint a symbol in a circle or a square (`checkmark.circle.fill`), with a badge (`bell.badge`), or drawn here with layers (`person.crop.circle.fill`) as layers: hierarchical in the foreground colour, the second layer at half its opacity and a filled shape at a quarter, as measured on iOS 27; palette in the two colours of `.foregroundStyle(a, b)`; under a gradient foreground style too. `.multicolor` paints 26 common symbols in their own colours as captured on iOS 27 (heart and trash red, leaf green, star, bolt and the warning triangle yellow, a badge red or green, a filled checkmark circle blue); any other draws in the foreground style, as iOS draws flame and drop. A symbol drawn here with one layer stays one colour, and the checker says so. In Design, a symbol Image's Rendering (Automatic, Monochrome, Hierarchical, Palette with its Primary and Secondary colors, Multicolor) and Filled (`.symbolVariant(.fill)`) write these, from iOS 15. A mode, styles or a variant set on a view around the Image show read only, saying where to change them. Before Wave 6b every mode drew one colour, with a warning |
| `.symbolEffect` | 🟡 | Wave 6b | draws the symbol as it is, with no warning: the preview doesn't play the effect, and the symbol is where iOS draws it before and after. `.disappear`, and `.appear` while it is active, hide the symbol and keep its space, as iOS does once the effect has run; `.symbolEffectsRemoved()` between the effect and the symbol draws it. `.scale` warns that the preview draws the symbol at its own size, where the app scales it while the effect is active. Before Wave 6b every effect warned that it was not applied |

## Shapes and styles

| Item | Status | Phase |
| --- | --- | --- |
| `Rectangle` `RoundedRectangle` `Circle` `Ellipse` `Capsule` | ✅ | 3 | a rounded shape's corners are continuous unless `style: .circular` is written, as the Xcode 27 SDK defaults `RoundedRectangle`, `.rect(cornerRadius:)`, `Capsule` and `.cornerRadius(_:)`. The continuous curve is fitted to the iOS 27 simulator, within 0.07 pt for corners of 8 to 30 pt: a cubic easing off the edge into a circular arc, its depth showing about 1.5 times the radius along each edge. A side with less room makes that half of the corner rounder, and with exactly one radius circular, so a capsule's ends are half circles and its long sides still ease in. A circular corner is a plain arc. A sheet's clip and the toolbar's glass outlines are still circular |
| `UnevenRoundedRectangle`, `.rect(topLeadingRadius:…)`, `.rect(cornerRadii:)`, `RectangleCornerRadii` | ✅ | - | each corner with its own radius, as a shape, a clip and a background's shape. Leading is the left, as the preview lays out left to right. As in the simulator, corners too big for a side all shrink by one factor, and each side is shared by its two corners in proportion to their radii |
| `Path` (custom) | ✅ | 7 | lines, curves, arcs, rects and ellipses, serialised to SVG |
| `.fill` / `.stroke` | 🟡 | 7 | takes a colour, a gradient or a `StrokeStyle`: line width, dash pattern, cap and join |
| `.trim` | 🟡 | 7 | on shapes and paths, from where iOS 27 starts each shape (3 o'clock; a rectangle's top-left corner) and in an arc's own direction. On the built-in shapes, strokes only: a trimmed fill, or a trimmed stroke with a dash pattern, is drawn whole and warns. A path's arcs are trimmed whether filled or stroked |
| `.strokeBorder` | ✅ | 7 | drawn inside the shape's edge; a Design panel Border is one (D8) |
| Custom `Shape` conformances | ✅ | 11 | `struct Arc: Shape { func path(in rect: CGRect) -> Path }`, with `.fill`, `.stroke` and `.trim` on the path it draws and `.frame` on the box it draws into. The rect is the one the shape was laid out in last pass, converging on the next - the same answer `GeometryReader` gives to the same ordering problem. `rect.minX` and the rest are derived, as `CGRect` derives them |
| `Color` literals and semantic colours (`.primary`, `.secondary`, `.accentColor`) | ✅ | 3 | and the iOS 27 system, label, fill and grey colours by any of their names (`Color(.systemGray6)`, `Color(uiColor:)`, `UIColor.systemGray6`), the hierarchy down to `.quinary` including a colour's own (`.blue.secondary`), and `hue:saturation:brightness:`; measured in the iOS 27 simulator. An unknown name warns |
| Dark-mode colour resolution | ✅ | 4 |
| `LinearGradient` | ✅ | 6 | named unit points |
| `RadialGradient` / `AngularGradient` | ✅ | 6 | drawn as radial and conic gradients |
| `Material` (`.ultraThinMaterial` etc.) | ✅ | 7 | a real translucent, blurred panel via `backdrop-filter`. `Material.ultraThin` and `.ultraThinMaterial` are the same value. Cut to a shape, as `.background(.regularMaterial, in: .capsule)` and `.fill(.regularMaterial)` are, the panel is cut itself, because a browser blurs nothing behind a box whose parent is cut |
| `.glassEffect(_:in:)`, `Glass` | 🟡 | - | approximated as a material cut to the shape (a capsule unless `in:` gives another), with a light rim inside a hairline, measured over colour in the iOS 27 simulator: `.regular` lightens what is behind it by about 40% and blurs it over about 6 pt, `.clear` by about 12% with almost no blur, and `.tint(_:)` covers it at about 90%. `.interactive()` draws as the glass does at rest, and `.identity` draws nothing. The lens refraction, the highlights and the shadow are not drawn, and neither is `GlassEffectContainer`'s merging |
| `GlassEffectContainer` | 🟡 | Wave 6c | lays out its content as a centred VStack, as iOS 27 does, and each view in it draws its own glass. The merging of nearby glass shapes into one is not drawn. It builds at iOS 26 |
| `MeshGradient` | 🟡 | Wave 6d | `width:height:points:colors:` and `smoothsColors:`, painted on a 64 by 64 pixel canvas stretched over its frame, as a view, a background or a shape's fill. Each patch's points are bilinear; its colours follow a cubic Hermite across the grid with `smoothsColors` (the default) and are bilinear in each patch without it, as measured in iOS 27 on a 3 by 3 mesh with a moved middle point (within about 12 per channel smoothed and 7 without). It takes the whole size proposed to it, as a `Color` does, so `.frame(height: 300)` sizes it. `background:` and `colorSpace:` are not applied, and as the colour of a text, a label or a symbol, or as a stroke or a border, it is one colour, its middle one, with a warning; a shape styled with it, by `.fill` or `.foregroundStyle`, paints the full mesh. Needs iOS 18. Before Wave 6d a labelled box |
| `ShapeStyle` conformances generally | 🟡 | 6 | colours, tokens and gradients anywhere a style is taken |

## Interaction and lifecycle

| Modifier | Status | Phase |
| --- | --- | --- |
| `.onTapGesture` | ✅ | 6 |
| `.onLongPressGesture` | 🟡 | 6 | fires on tap; the press duration is not modelled |
| `DragGesture` | ✅ | 7 | cumulative translation, with `.onChanged` and `.onEnded` |
| `MagnificationGesture` / `RotationGesture` | ✅ | 7 | driven by events; no trackpad or touch source yet |
| `@GestureState` / `.updating` | ✅ | 7 | transient, reverting when the gesture ends |
| `.simultaneously(with:)` | ✅ | 7 | each gesture responds to its own kind of input |
| `.sequenced` / `.exclusively` | 🟡 | 7 | accepted; treated as simultaneous |
| `.onAppear` / `.onDisappear` | ✅ | 7 | run once per appearance, not per render. Several on one view all run, in the order written |
| `.task` | 🟡 | 7 | run synchronously; the preview has no concurrency. `.task(id:)` runs again when its id changes |
| `.id(_:)` | ✅ | - | a new id is a new view: its state starts over, and its appear and disappear hooks run, when the id changes |
| `.onChange(of:)` | ✅ | 7 | one-value and explicit zero/two-parameter callbacks; `initial: true` runs on first appearance. Independent modifiers track independent previous values |
| `.onReceive` | ⬜ | - | needs Combine, which needs publishers and a scheduler the preview does not have |
| `.disabled` / `.allowsHitTesting` | ✅ | 7 | a disabled button is grey, as iOS 27 draws it: its title by where it sits (on its own, in a row, in the toolbar), and a bordered or prominent button's fill too. A plain button, one with its own foreground style, and other controls fade |
| `.focused` | ⬜ | - | warns; `@FocusState` storage exists but native focus synchronization is absent |
| `.onSubmit` / `.keyboardType` / `.submitLabel` | 🟡 | - | common text-field Enter submission and browser input/return-key hints, including inherited modifiers; no iOS keyboard rendering or complete submit-scope semantics |
| `.textInputAutocapitalization` / `.autocorrectionDisabled` | 🟡 | - | browser input hints; actual behavior depends on the browser and keyboard |
| `.contextMenu` | 🟡 | - | action menu on hold, right-click or Shift-F10; normal child button taps preserved; custom previews warn; nested/selection menus incomplete |
| `.badge` | 🟡 | - | integer/string/Text badges on tabs and list rows; zero integer hidden; advanced styling incomplete |
| `.searchScopes` / `.searchSuggestions` | ⬜ | - | warn; no UI |
| `.popoverTip` / `.fileImporter` / `.fileExporter` | ⬜ | - | warn; platform integration absent |

## Animation

| Feature | Status | Phase | Notes |
| --- | --- | --- | --- |
| `withAnimation` | ✅ | 6 | animates every change in its transaction, for one frame |
| `.animation(_:value:)` | ✅ | 6 | animates its subtree only when `value` changes, and not on the first render |
| `Animation` - `.delay`, `.speed`, `.repeatForever`, `.repeatCount` | 🟡 | - | a delay and a speed change the one animation the preview plays; a repeat plays once, and says so where it is written |
| Curves: `.linear .easeIn .easeOut .easeInOut` | ✅ | 6 | CSS timing functions |
| `.spring` (and `.bouncy` / `.snappy` / `.smooth`) | 🟡 | 6 | an overshooting bezier, not a real solver |
| `.transition` (`.slide .opacity .scale .move`) | 🟡 | 7 | in and out: the renderer keeps a bounded, inert copy of a leaving view for its exit. `.asymmetric` plays its insertion both ways, with a warning |
| `AnyTransition.combined(with:)` | 🟡 | - | constructs, and the preview draws the first of the two: the render tree carries one transition kind per node |
| `matchedGeometryEffect` | ✗ | - | FLIP across an identity change needs the renderer to own both trees at once - the same shadow copy exit transitions need |
| `.phaseAnimator` / `.keyframeAnimator` | ✗ | - | both drive frames from a clock the preview does not run |
| `PhaseAnimator` / `KeyframeAnimator` views | 🟡 | - | the content is drawn at rest: at the first phase, and at the initial value. The animation needs the same clock, and warns |
| `Animatable` / `animatableData` | ✗ | - | interpolating an arbitrary value needs an animation system that owns the frames; ours is CSS keyframes, deliberately |
| Custom `ViewModifier` + `.modifier(…)` | ✅ | 8 | `body(content:)` is called with the view as a value |
| `extension View { func … }` | ✅ | 8 | the idiom for a reusable modifier chain |
| Custom `ButtonStyle` | ✅ | 9 | applies to every button below it, not only the one it is written on |
| Custom `ToggleStyle` / `LabelStyle` | ✅ | - | the same mechanism as `ButtonStyle`: `makeBody(configuration:)` runs, and a Toggle's configuration carries the toggle's own binding, so `configuration.isOn.toggle()` writes through. Inside its own body the style resets to the automatic one, so `Toggle(configuration)` draws the stock switch |

## Environment and app structure

| Feature | Status | Phase |
| --- | --- | --- |
| `App` / `@main` / `WindowGroup` | ✅ | 3 |
| `Scene` phases | 🟡 | - | `scenePhase` reads `.active`, because the preview's one window is always on screen |
| `@State` | 🟡 | 3 | declaration initialization works; `_value = State(initialValue:)` in a custom initializer is unsupported |
| `@Binding` (and `$value` projections) | 🟡 | 6 | ordinary control/custom-view projections work; collection binding closures do not |
| Key paths (`\.self`, `\.id`) | 🟡 | 6 | applied where a view takes one (`ForEach(id:)`) and as a function (`map(\.name)`), reading computed properties, `rawValue` and tuple labels as Swift does. Not writable key paths |
| `@StateObject` / `@ObservedObject` / `ObservableObject` / `@Published` | ✅ | 7 | a class is a reference, so a change is seen everywhere. `$store.property` projects a `Binding` into the model, so `Slider(value: $ledger.monthlyBudget)` writes where it reads - the dynamic member lookup SwiftUI puts on the wrapper |
| `@AppStorage` / `@SceneStorage` | 🟡 | - | keyed by the string, so views sharing a key share a value and it outlives the view that wrote it. Held for the session rather than on disk - see approximations |
| `@FocusState` | 🟡 | - | storage the code reads and writes |
| `@ScaledMetric` | ✅ | - | the value it is given, scaled for the Dynamic Type size in force where the view is, on the curve of the text style it is `relativeTo:` (`.body` unless another is named), to a third of a point. The same curve as `.custom(_:size:relativeTo:)`; the iOS 27 simulator printed the same values for both |
| `Binding(get:set:)` / `.constant` | ✅ | - | a projection built from the user's closures, or one that reads a value and swallows writes; a control cannot tell either from `$value` |
| `.environmentObject` / `@EnvironmentObject` | ✅ | 11 | reaches views expanded while the modifier is in scope, *and* the deferred ones - a pushed `navigationDestination`, a presented `.sheet`, a `.toolbar` - which capture the frame they were written in and restore it when they run. Before that, a detail screen reading an `@EnvironmentObject` trapped |
| `.environment(\.key, …)` | ✅ | 7 | same scoping rule |
| `@Observable` / `@Bindable` / `.environment(model)` / `@Environment(Model.self)` | ✅ | - | an `@Observable` class is a reference, so a change is seen everywhere, and `@Bindable` projects `$model.name`, `@Bindable var model = model` in a body included. `.environment(model)` hands the model down by its type, by the same scoping rule. A view asking for a type no ancestor gave stops, as the app does, unless its property is optional. On a screen a link pushes, it stops when that screen is pushed, as the app does |
| `colorScheme`, `dynamicTypeSize` | ✅ | 4 |
| `locale`, `layoutDirection` | 🟡 | 7 | reported; there is no RTL layout or localisation yet |
| `horizontalSizeClass` / `verticalSizeClass` | ✅ | 7 | derived from the device size |
| `dismiss` | ✅ | 7 |
| `openURL` | 🟡 | - | callable; logs the URL rather than navigating, which would take the unsaved project with it |
| `PreferenceKey` | ✗ | - | declined: a value travelling *up* needs a second pass and a re-render when a handler writes state. `GeometryReader` covers what people reach for it for |
| `#Preview` macro | ✅ | 10 | parsed, and used as the root when nothing is `@main` |
| `PreviewProvider` (the older form) | ✅ | - | its `previews` body is the root when nothing is `@main` and there is no `#Preview` |

## Accessibility

| Modifier | Status | Phase | Notes |
| --- | --- | --- | --- |
| Implicit roles and labels | ✅ | 6 | every control renders with an ARIA role and its label |
| `.accessibilityLabel` / `Hint` / `Value` | ✅ | 7 | mapped to ARIA on the group they wrap |
| `.accessibilityHidden` | ✅ | 7 | |
| `.accessibilityElement` / `.accessibilityAddTraits` | ⬜ | - | |

## Swift language

The subset the interpreter runs. Full detail in [04-SWIFT-SUBSET.md](04-SWIFT-SUBSET.md).

| Feature | Status | Phase | Notes |
| --- | --- | --- | --- |
| `struct`, stored and computed properties, methods | ✅ | 1 | value semantics, memberwise init |
| `class`, reference semantics, `init` | ✅ | 7 | what `ObservableObject` needs |
| `enum` with raw and associated values | ✅ | 7 | methods and computed properties too |
| `switch` - value, range, `case let`, `where`, enum cases | ✅ | 7 | |
| `if let` / `guard let` / condition lists | ✅ | 7 | short-circuiting, and `guard`'s bindings escape |
| `while` / `repeat` / `break` / `continue` / `for … where` | ✅ | 7 | |
| `static` members | ✅ | 7 | |
| Key paths (`\.self`, `\.id`, `\Type.member`) | ✅ | 6 | applied where a view takes one (`ForEach(id:)`) and where a closure is expected (`map(\.name)`, `filter(\.isDone)`, `first(where:)`) |
| `as?` / `as!` / `is` | ✅ | - | compares the runtime type, the declared superclass chain and protocol conformances; generics are erased, so `[Item]` and `[String]` are both `Array` |
| Closures, trailing closures, `$0` | ✅ | 1 | |
| Contextual member syntax (`.home` for an enum) | ✅ | 7 | resolved where a declaration states the type, and carrying its associated values: `describe(.done("hi"))` binds in `case .done(let text)`. The payload used to be dropped, so the branch matched and bound nothing |
| Contextual keywords as names | ✅ | - | `open`, `some`, `any`, `where`, `final` and the rest, both declared and read. `get` and `set` are names everywhere except at the start of a computed property's body, where `{ get` is an accessor block in Swift too |
| `protocol`, requirements, `extension` | ✅ | 8 | defaults from `extension P`, merged once for the whole toolchain |
| `associatedtype` | 🟡 | 8 | the name resolves; nothing constrains it |
| `inout` parameters | ✅ | 8 | the same projection `@Binding` uses |
| Generics (`<T>`, constraints, `where`) | 🟡 | 8 | **erased** - parsed and resolvable, never enforced |
| `throws` / `try` / `try?` / `try!` / `do-catch` | ✅ | 8 | clauses match in order; an unmatched throw keeps travelling |
| Inheritance, `override`, `super` | ✅ | 8 | `super` resolves against the type that *declared* the method |
| `async` / `await` / `Task { }` | 🟡 | 8 | runs synchronously and in order; nothing suspends |
| `Task.sleep` / `Task.yield` | 🟡 | 8 | return immediately - see below |
| `typealias`, `subscript`, `operator` declarations | ✅ | - | an alias substitutes its target; a subscript is a method named `subscript`; an `infix operator` declaration parses and takes multiplication's precedence, which is Swift's own default |
| `actor`, `@Sendable`, structured concurrency | 🟡 | - | `actor` parses as a class and `async let` as a `let`; there is nothing to isolate from, since everything runs on one thread and in order |
| `@ViewBuilder` on a function or property | ✅ | 11 | a helper of several statements, an `if`/`else` or a `switch` produces all of its views. Without it only a single-expression helper worked, because the implicit return covers one expression and a builder body almost never is one |
| Multiple trailing closures | ✅ | - | `Button { } label: { }`, `Section { } header: { } footer: { }`, `.alert(…) { } message: { }` and the rest |
| Explicit `get` / `set` accessors, `willSet` / `didSet` | ✅ | - | assigning to a computed property runs its setter with `newValue` bound |
| Tuples | ✅ | - | `.0` and labels, `let (a, b) =`, `for (k, v) in`, tuple patterns in `switch`, equality |
| Operator declarations as members | ✅ | - | `static func ==`, `static func <`, `prefix func`; dispatched before the built-in table for operands the built-ins do not define |
| An operator used as a value | ✅ | - | `reduce(0, +)` is the closure `{ $0 + $1 }` |
| Variadic parameters, attributes on a parameter | ✅ | - | `Int...`; `@ViewBuilder` and `@escaping` on a parameter, which is what a custom container view needs |
| `defer`, `fallthrough`, labelled `break` | ✅ | - | `defer` runs on every exit; a label is consumed and the loop is the one it names |
| `Self` | ✅ | - | resolves to the type the code is written in |
| Nested types (`struct Item { enum Status { … } }`) | 🟡 | - | reachable as `Item.Status` and, from inside, as `Status`. The bare name is visible project-wide rather than only within its parent, which accepts code Xcode would reject |
| Bitwise operators `&` `\|` `^` `<<` `>>` | ✅ | - | 64-bit, computed in `BigInt` |
| `_ = expr` | ✅ | - | the discard; evaluates the expression and throws the answer away |
| Extensions on built-in types | ✅ | - | `extension String { var shout: String { uppercased() } }`; the receiver's own members are in scope unqualified |
| Overloading by argument label | ✅ | - | `minutes(on:)` and `minutes(of:)` are two functions, top level, local or members, chosen by the labels the call writes |
| Overloading by parameter type | 🟡 | - | `f(_ x: Int)` and `f(_ x: String)` are both kept, and a call runs the one its arguments' values suit: a whole number an `Int`, text a `String`, a project type its own. Where the values can't tell them apart (`Double` and `CGFloat`, both a number), the preview runs the first and warns at the second, where Xcode goes by the argument's declared type. Inside a type, its own members are found before top-level ones of the same name, for a read, a call, a write and a `$` binding alike, as in Swift |
| A method and a property sharing a name | ✅ | - | `var spent` and `func spent(on:)` coexist as they do in Swift; a call reaches the method and a read reaches the property |

## Standard library and Foundation

The part of the library SwiftUI code actually calls. It had no section here until the
defect register's Phase 5, which is part of why fifty-five of its calls could be
missing without anything saying so.

| Feature | Status | Phase | Notes |
| --- | --- | --- | --- |
| `String` - `count`, `uppercased`, `hasPrefix`, `contains`, `split`, `replacingOccurrences`, `trimmingCharacters` | ✅ | 2 | counted and sliced by grapheme cluster, so `"👋🏽".count` is 1 |
| `String` - `capitalized`, `prefix`, `suffix`, `dropFirst`, `dropLast`, `reversed`, `components`, `padding`, `starts(with:)`, `append` | ✅ | - | |
| `String` - `unicodeScalars` | ✅ | - | code points, which is the whole difference from `count` |
| `String` - `localizedCaseInsensitiveContains`, `localizedStandardContains` | ✅ | - | how a search box filters: without case, and the standard form without accents too, as iOS 27 answers; an empty string is in nothing |
| `Array` - `count`, `map`, `filter`, `compactMap`, `reduce`, `sorted`, `contains`, `firstIndex`, `forEach`, `joined`, `enumerated`, `min`, `max`, `prefix`, `suffix` | ✅ | 2 | `reduce(into:)` too, whose closure takes the accumulator `inout` - the standard way to build a dictionary from a sequence. `enumerated()` gives `(offset:element:)` tuples, and a closure with a parameter for each takes one apart, as `{ index, item in }` does. A range of integers answers the same methods: `(0..<3).map { … }` |
| `Array` - `allSatisfy`, `flatMap`, `dropFirst`, `dropLast`, `first(where:)`, `last(where:)`, `lastIndex`, `randomElement`, `shuffled` | ✅ | - | `shuffled` is Fisher-Yates, not the biased one-line sort |
| `Array` - `append`, `insert`, `remove`, `removeAll`, `removeFirst`, `removeLast`, `popLast`, `sort`, `reverse`, `shuffle`, `swapAt`, `replaceSubrange`, `removeSubrange` | ✅ | - | mutating, and refused on a `let` as Xcode refuses them |
| `Dictionary` - subscript, `default:`, `keys`, `values`, `updateValue`, `removeValue` | ✅ | 2 | |
| `Dictionary` - `sorted`, `mapValues`, `filter`, `map`, `contains` | ✅ | - | over `(key: , value: )` pairs; `filter` answers a dictionary and `sorted` an array |
| `Dictionary(grouping:by:)`, `Dictionary(uniqueKeysWithValues:)` | ✅ | 11 | grouping keeps the order the groups were first met, which is what a sectioned list wants and what Swift's hash order promises nothing about |
| `counts[key, default: 0] += 1` | ✅ | 11 | the default belongs to the read half of a compound assignment; without it the first occurrence of every key read nil |
| `Set` | 🟡 | 2 | `Set(_:)` and a `Set` annotation, parameter or property drop duplicates, and assignment keeps a set a set; iteration is in insertion order rather than Swift's unspecified hash order |
| `Set` - `union`, `intersection`, `subtracting`, `symmetricDifference`, `formUnion`, `formIntersection`, `subtract`, `formSymmetricDifference`, `isSubset`, `isSuperset`, `isStrictSubset`, `isStrictSuperset`, `isDisjoint`, `remove(_:)`, `update(with:)` | ✅ | - | any sequence as the other operand; `filter` answers a set; two sets compare equal regardless of order. An array has none of these, as in Swift |
| A range of `Int`s as a collection - `map`, `filter`, `reduce`, `contains(where:)` and the rest | ✅ | - | `(1...5).map { … }`; ranges of `Double` and `Date` are not sequences, as in Swift |
| `Int` / `Double` conversion from `String` | ✅ | - | failable, matched to Swift's grammar: `" 42"`, `"4_2"` and `"0x10"` are nil |
| `CGFloat`, `Float` | ✅ | - | a Double, as everywhere in the preview: `CGFloat(x)`, `Float(x)`, and a whole-number literal given to either, so `let w: CGFloat = 3` prints 3.0 |
| `Int` / `Double` - `formatted()`, `.number`, `.percent`, `.currency(code:)` | ✅ | - | as Foundation writes them in en-US, measured in the iOS 27 simulator: separators and up to six decimals, a Double's percent multiplied by 100 and an Int's not, and currency rounded half to even from the number as written. `Text(_:format:)` writes the same |
| `Int.max` / `Int.min` | 🟡 | - | 2^53 - 1, not 2^63 - 1 - see approximations |
| `Int.random(in:)`, `Double.random(in:)`, `Bool.random()` | ✅ | - | |
| `Double` - `rounded()`, `rounded(.up/.down/.towardZero)`, `squareRoot`, `truncatingRemainder`, `isMultiple(of:)` | ✅ | - | halves round away from zero, as Swift's do |
| `sqrt`, `pow`, `round`, `floor`, `ceil`, `abs`, `min`, `max` | ✅ | - | |
| `zip`, `stride(from:to:by:)`, `stride(from:through:by:)` | ✅ | - | arrays rather than lazy sequences |
| `type(of:)`, `fatalError`, `assert`, `precondition` | ✅ | - | a failed assertion is a trap reported on its line |
| Bitwise `&`, `\|`, `^`, `<<`, `>>` | ✅ | - | computed in `BigInt`, so a shift past 32 bits is not truncated |
| `UUID` | ✅ | - | random, and prints as its `uuidString` |
| `Date` | 🟡 | - | `timeIntervalSince1970`, `addingTimeInterval`, `timeIntervalSince`, comparison, `Date.now`. `formatted()` is Foundation's default, a numeric date and a short time, and `formatted(date:time:)` takes the parts it is given. No `DateFormatter` |
| `Calendar` | 🟡 | - | `Calendar.current`, in the preview's time zone: `component(_:from:)`, `date(byAdding:value:to:)`, `startOfDay(for:)`, `isDateInToday` and its neighbours, `isDate(_:inSameDayAs:)`, `isDate(_:equalTo:toGranularity:)` by year, month, week (starting on Sunday), day, hour, minute or second, and `dateComponents` from one date or between two, largest unit first |
| `Timer` | 🟡 | - | `Timer.publish(every:on:in:).autoconnect()` with `.onReceive`, and `Timer.scheduledTimer`, are accepted and never fire: the preview draws one moment, and warns where a timer is made |
| `URL` | 🟡 | - | `URL(string:)` is failable and the string is kept as written; `absoluteString`, `path`, `host`, `scheme`, `query`, `lastPathComponent`, `pathExtension`, `appendingPathComponent`. Nothing is fetched |
| `AttributedString` | 🟡 | Wave 6a | a value of runs: `AttributedString("…")` and `try AttributedString(markdown:)`, `+` and `+=`, the whole-string `.font`, `.foregroundColor`, `.backgroundColor`, `.underlineStyle`, `.strikethroughStyle`, `.kern` and `.link`, `range(of:)` with a range subscript that sets one of them, and `characters.count`; `AttributedString(localized:)`; the same attributes set through the `.swiftUI` scope (`text.swiftUI.foregroundColor = .red`), through an `AttributeContainer`, or as `inlinePresentationIntent` (`.stronglyEmphasized` is bold). `Text(attributed)` draws it, and so does a `Text` it is interpolated into, `Text("Note: \(text)")`, run by run. `.backgroundColor` is kept but not drawn, and the checker says so on an `AttributedString` only. A member it doesn't model warns rather than stopping. Before Wave 6a any use was an error that blanked the screen. Needs iOS 15 |
| `Codable` over JSON | ⬜ | - | listed in Phase 2's scope and never built |
| `DateFormatter`, `NumberFormatter`, `Measurement` | ⬜ | - | `Text`'s `format:` styles cover what view code usually needs |

## Known approximations

Listed in the exported README so nothing is a surprise on the Mac:

1. **Fonts** - `-apple-system` leads the stack, so a Mac or an iPad previews in the *real* SF Pro,
   SF Pro Rounded and SF Mono. Everywhere else a self-hosted Inter stands in for SF Pro, and
   `ui-rounded` resolves only in Safari (not in Chrome, even on a Mac), so elsewhere `.rounded`
   falls back to the default design. Layout is correct either way - the main thread measures whichever face actually resolved
   rather than reading a transcribed table - but two machines will break lines in different places,
   and neither is CoreText.
2. **SF Symbols** - supported symbol names map to bundled Ionicons assets. These are visual
   approximations, and unknown names use a fallback. Exported Swift retains `Image(systemName:)`.
3. **Springs** - `.spring()` and friends are approximated with an overshooting cubic bezier. The
   motion is recognisably springy; it is not the same solver, and it will not match frame for frame.
4. **Scrolling physics** - native browser scrolling, not iOS rubber-band deceleration.
5. **Sheet dismissal** - a preview has no swipe-down, so a sheet is dismissed by tapping outside it
   or by whatever sets its binding back.
6. **Environment scope** - SwiftUI's environment flows to every descendant. Ours flows to views
   expanded *while* the modifier is in scope, which covers `Root().environmentObject(store)` - the
   dominant idiom, where the view's body has not run yet - and not the case where the modifier sits
   above children that were already built. Views expand eagerly here; making them lazy is a larger
   change than this phase took on.
7. **Transitions are bounded.** A view animates out from an inert copy the renderer keeps for the
   length of its exit, and a re-entry cancels the stale removal. An `.asymmetric` transition plays
   its insertion when the view leaves too, and matched geometry between two views is not drawn.
8. **Concurrency does not suspend.** One rule covers all of it: everything async runs immediately
   and in order. `await` is transparent, an `async` function runs like any other, `Task { … }` runs
   its body where it is written, and `Task.sleep` returns at once. The alternatives are worse in a
   way that is hard to see up front - deferring a `Task` body, or splitting one at a `sleep`, needs
   suspension the interpreter does not have, and a half-built version would make ordering depend on
   which special case a program happened to hit. One rule that is always true beats several that are
   usually true.
9. **Generics are erased.** Parameter names resolve and constraints are recorded; nothing is
   substituted and no constraint is enforced. A dynamically typed interpreter carries the real value
   at runtime whatever the annotation said, and constraint checking is what the export hands to a
   real compiler.
10. **Performance** - the interpreter is far slower than compiled Swift; do not judge frame rates.
11. **A recognised modifier that is not applied still warns, every time.** There are around
    fifty of them and they are listed in `UNIMPLEMENTED_MODIFIERS`. The warning is the
    contract: the modifier is exported unchanged and the preview does nothing with it. A
    modifier the tables do not know at all warns too, but only where the chain it sits on
    demonstrably starts at a view - a chain rooted at a variable carries no type
    information, and a warning there would land on the project's own methods.
12. **`Int.max` is 2^53 - 1, not 2^63 - 1.** A JavaScript number is exact only to 2^53, and the
    interpreter traps rather than silently lose precision past it - so reporting Swift's real
    bound would hand back a value that prints plausibly and traps on the first arithmetic done
    with it. `Int.max` is written almost exclusively as the starting point for a minimum, where
    either bound behaves identically. The same limit is why `1 << 60` traps rather than rounding.
13. **Time stands still.** `Text(date, style: .relative)` and `.timer` are computed once, at
    render, because the preview has no clock to tick them with, and a `Timer` never fires for
    the same reason. The common `Calendar` members work; there is no `DateFormatter`.
14. **Locale-formatted output is the browser's.** `Date.formatted()`, `Text(date, style:)` and
    `Text(_, format:)` go through `Intl`, so the separators, the order and the currency symbols
    are the platform's real ones rather than a transcription - and two machines in different
    regions will legitimately show different text.
15. **A menu is drawn at the bottom of the screen, not beside its control.** A `Picker`
    or `Menu` opens onto a panel across the foot of the device, which is where iOS puts the
    same list when it is presented from a form - and is not where iOS puts it when the
    control sits mid-screen. The compositor decides what the options are before the layout
    engine decides where the control ended up, so anchoring would mean resolving the menu
    after layout. An approximation of position; the options and the tick are exact.
16. **A `ColorPicker` offers named colours, not a surface.** SwiftUI's own palette as
    swatches, because those are the colours the exported Swift can *name*. A continuous
    wheel would let a user land on a colour their code cannot express, which is a worse
    answer than a smaller choice. A `DatePicker` is the same shape of decision one level
    down: a calendar and no clock, so the time of day stays whatever the binding held.
17. **`@AppStorage` is a session, not a disk.** The value is keyed by its string and
    shared between every view naming it, and it outlives the view that wrote it - which
    is the whole difference from `@State`. It does not outlive the tab: there is no
    `UserDefaults` in a worker, and writing to browser storage would make one project's
    preview visible to another. It also follows `@State` on one point real defaults do
    not: editing the declared default re-seeds, because a user who just changed `= 0`
    to `= 10` is waiting to see 10.
18. **A `.wheel` picker is a dimmed column, not a spinner.** A wheel has depth, momentum
    and a selection band; a static column has none of them. What it carries honestly is
    which option is selected, so the chosen row is drawn at full strength and the rest
    are dimmed. The options and the selection are exact; the motion is absent rather
    than approximated.
19. **`.kerning` and `.tracking` are applied identically.** Both add advance after every
    character. Swift's `kerning` adjusts the space *between* characters and so leaves the
    last one alone, where `tracking` adds after it too - a difference of one character's
    spacing at the end of a line, well under a point at UI sizes. Stated rather than
    silently rounded away.
20. **Renaming is scoped, which means it can rename too little.** A local is renamed within
    its own body; a member is followed across the project only when no other type declares
    the same member name, and otherwise stays inside the type that declared it. The
    alternative was a textual sweep that renamed unrelated symbols, and a rename that misses
    a use leaves a name the compiler will point at, where one that renames the wrong symbol
    leaves code that compiles and is wrong.
21. **Views beside a NavigationStack or a TabView are drawn around the screen.** Since Wave
    6c a floating button in a `ZStack` beside the stack, a banner or mini player above or
    below a TabView, and an `.overlay` or `.safeAreaInset` written on the stack are drawn: the
    screen and its bars are laid out in the space left for the container, and the views
    beside it paint in the order written. Presentations open at their source, and those
    views, like the screen's own, are selected, outlined and dragged where they are drawn. A
    screen with nothing beside its containers is laid out against the device, as before. This
    is the app's outermost container only: a view beside a NavigationStack inside a tab's page
    is still left out, and warns.
22. **A trimmed fill is drawn whole.** `.trim` cuts strokes; iOS fills just the trimmed part of
    a filled shape, closed by a straight line. The fill warns.
23. **Gradients blend in sRGB.** Measured in the iOS 27 simulator, a gradient blends in Oklab,
    which keeps a red-to-blue gradient from greying in the middle. The end colours and their
    positions are the same.
24. **A tab app's search field shows from the start.** iOS 27 keeps it folded under the title
    until the list is pulled down, and the preview draws it as it is then.
25. **A search drawer shown always keeps a large title.** With
    `.navigationBarDrawer(displayMode: .always)`, iOS 27 makes the title inline, and the
    preview keeps it large.
26. **A class instance prints without its module.** `print(node)` shows `Node` where the
    app shows `MyApp.Node`: the module is the exported target's name, which the preview
    never sees. Its properties are never printed, as in Swift.
27. **Recursion stops sooner than on a device.** Each Swift call costs the interpreter
    several JavaScript frames, so a recursion a few hundred calls deep stops the preview
    with "Call depth exceeded" at the line it reached, where an iPhone would go deeper.
28. **A view that traps is drawn as stopped; iOS would crash.** A trap in a view's
    `body` (an index out of range, a nil unwrapped, a model no ancestor gave) draws that
    view as a placeholder naming it and the reason, and the rest of the screen keeps
    working, so one bad row doesn't take the Design canvas with it. A sheet, a destination,
    a toolbar, a context menu or a tab item whose own closure traps is drawn the same way,
    as "Sheet stopped" and so on, and a stopped sheet can still be closed. The error is
    reported at its line, once the view is on screen: a destination's only when it is
    pushed. The Design canvas leaves out a sheet or a destination that traps with the state
    the app has now, as the app can't show it yet. A trap in a view's stored property, as
    it is created, stops the view that creates it.
29. **A busy preview merges a control's changes.** While the app is still answering one
    event, the next keystrokes in a field, moves of a slider or a drag, and scrolls are
    merged into the latest, so a heavy screen keeps up. `.onChange(of:)` then runs once
    for the merge, where iOS runs it for each change. Nothing typed is lost: a field shows
    what was typed until the app has answered it, then the app's value.

## The strictness pass (R5)

Separate from coverage, and pointed the other way: the interpreter is *more* permissive than
`swiftc`, so a warning coded `may_not_compile_in_xcode` marks code that runs here and will not build
there. It only fires where the type involved is certain - from a literal or an explicit annotation -
because a false positive would teach people to ignore the panel.

| Check | Example that is flagged | And deliberately not |
| --- | --- | --- |
| Mixed numeric arithmetic | `let w: Int = 10; let s: Double = 1.5; w * s` | `scale * 2` - an integer literal takes its type from context |
| `Text` given a non-string | `Text(count)` | `Text("\(count)")` |
| Property wrapper on a `let` | `@State private let count = 0` | the same wrapper on a `var` |
| Assignment to a `let` | `let total = 0; total = 1` | writing an `inout` parameter, which is the caller's storage, or the property an `if let` shadows, outside that `if`'s own branch |
| Non-`mutating` method writing a property | `func bump() { count += 1 }` on a plain stored `var` | the same method writing a `@State`, `@Binding` or any other wrapped property: their setters are **nonmutating**, which is what lets `body` write them |
| `ForEach` without identity | `ForEach(items)` where the element is not `Identifiable` | a range, or an explicit `id:` |
| Omitted argument labels | `greet("Ada")` for `func greet(name:)` | a parameter declared `_` |
| Missing `return` | a multi-statement `func` body with a return type and no `return` anywhere | a body whose returns are inside a `switch`, `while`, `repeat`, `do`/`catch`, `guard`'s `else` or an `else if` chain |
| Code in a view's body | a `for`, `while` or `repeat` loop, an assignment, a `break`, `defer`, `do`/`catch` or a function, in `body`, a `@ViewBuilder` member or a view's content closure (`VStack { }`, `ForEach`, `.sheet { }`) | a body with a `return`, which is ordinary code; `let`/`var` with a value, `if`, `switch` and `do`; any of it in a button's action, an `onAppear`, a sheet's `onDismiss`, a menu's `primaryAction` or a closure that is called |
| `specifier:` or `format:` in a String | `let text = "\(km, specifier: "%.1f") km"`; the same in a `String` property, an assignment to a String, `Text(verbatim:)`, a `String` parameter of the project's own view or function, or beside a `+` | a title, such as `Text`, `Label`, a navigation title or `.badge`, and a `LocalizedStringKey`, which take both |

The right-hand column is the half that matters. A pass that cries wolf is worse than no
pass, because people stop reading the panel and then the true warnings go unread too -
and the `mutating` row was exactly that until the defect register's Phase 6: it fired on
the commonest shape in SwiftUI and offered a fix-it that broke the file it was applied to.

## False warnings fixed in Wave 6a

The checker said these real Apple names would not build in Xcode, with "Cannot find … in scope" or
"does not recognise the modifier". Each builds in Xcode 27, so each is now a known name. Where the
preview doesn't draw it yet, its warning says it is not drawn in the preview instead:

- `GlassEffectContainer`, `ToolbarSpacer` and `DefaultToolbarItem`, which Wave 6c draws;
- `SectorMark`, `.chartXAxis`, `.chartYScale`, `.chartLegend` and `.annotation` (drawn in Wave 6e);
- `AttributedString`, which was an error that blanked the screen, `AttributeContainer` and `SymbolVariants`, and `.symbolVariant(.fill.circle)`, which stopped it;
- `.font(.custom(_:size:))` with a family iOS ships, which warned that the font was not in this project;
- `.position(by:)` on a Charts mark and `.searchToolbarBehavior(.minimize)`, which both build in Xcode 27.

Two warnings were narrowed so they fire only where they are true: the one that an `AttributedString`'s `backgroundColor` is not drawn fires on an `AttributedString` alone, never on a `backgroundColor` of a project's own type, and the Design panel's "Drawn as Markdown" note shows only where Apple's parser formats something, not on every `*` or `_`.

## Additional confirmed gaps from the September 2026 audit

- Custom `EnvironmentKey.defaultValue` is not implemented.
  Missing environment values now stop with an unsupported-runtime diagnostic instead of `nil`.
- `.gridCellColumns` is explicitly recognized as unsupported. `.symbolEffect` was too, until Wave 6b drew the symbol still, and `.safeAreaPadding` until Wave 6d drew it.
- `AsyncImage` and `TimelineView` now warn about their existing partial behavior.
- See the [audit](15-SWIFTUI-COMPATIBILITY-AUDIT.md) before relying on generated code outside the tested subset.
