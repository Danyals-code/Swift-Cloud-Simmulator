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
| `Spacer` | ✅ | 3 | minLength; the canonical test of the layout engine |
| `Divider` | ✅ | 6 | hairline across its stack's axis |
| `Group` | ✅ | 3 | a modifier on one applies to each *child*, as SwiftUI's does - it is not a container, so `Group { … }.font(.caption)` is the same as writing the font on both |
| `ForEach` | 🟡 | 6 | ranges, `Identifiable`, `id:` key paths, a computed `id` and `\.rawValue` included; each row is tagged with its id, as SwiftUI tags it. Binding collection closures (`ForEach($items) { $item in }`) are unsupported. Preview limit: 1,000 elements, with a diagnostic instead of truncation |
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
| `Text` | ✅ | 3 | interpolation, `verbatim:`, `format:` number styles (`.number`, `.percent`, `.currency(code:)`), and a `Date` with `style:` (`.time`, `.date`, `.relative`, `.offset`, `.timer`). `Text + Text` concatenates, and each half keeps its own face, colour and attributes, as does a `Text` interpolated into a `Text`. Interpolated into a `Button`'s or a navigation title, it is drawn as its words, without its styling |
| `Label` | ✅ | 6 | icon then title |
| `Image(systemName:)` | 🟡 | 6 | mapped Ionicons approximations; unknown names use an explicit fallback, not Apple artwork |
| `Image("asset")` | ✗ | - | a project file here is text; there is no asset catalogue to resolve a name against, so there is nothing to draw. Reported as unavailable rather than guessed at |
| `GroupBox` | ✅ | - | a titled card: the label above, the contents on a rounded secondary panel |
| `LabeledContent` | ✅ | - | label leading, value trailing in the secondary colour; both the `value:` and content forms |
| `ContentUnavailableView` | ✅ | 13 | the empty state: a large symbol over a title over a description. `.search` is the stock spelling and carries its own text |
| `ControlGroup` | 🟡 | - | its controls in a row. Drawn as the toolbar form, not the segmented form a menu gives it |
| `ScrollViewReader` | ⬜ | - | recognised and drawn as a labelled placeholder, not reported as an unknown name |
| `AsyncImage` | 🟡 | 7 | draws its `placeholder:`, because there is no network in the worker. Its content closure is not run: there is no `Image` to hand it |
| `Link` / `ShareLink` | 🟡 | 6 | drawn as iOS 27 draws them: the title or the label given, in the accent colour, and a share link without a label is the share icon and "Share…". Tapping opens nothing, and says so. `URL(string:)` exists, so the `destination:` can be written |
| `ProgressView` | ✅ | 6 | determinate bar filling from its leading edge; `.circular` and the indeterminate form are the turning activity indicator |
| `Gauge` | 🟡 | 7 | linear labelled bars and value-dependent circular arcs/markers; native metrics and all label/style arrangements remain approximate |
| `Canvas` | ✅ | 7 | `fill` and `stroke`; drawings become the same vector nodes a `Path` does |
| `TimelineView` | 🟡 | - | its content is drawn once, for the moment of the render: `context.date` is now. The schedule is a clock the preview does not run |
| `Chart` (Swift Charts) | ⬜ | - | needs a mark model and a plottable-value protocol of its own, which is a package rather than a view |
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
| `DatePicker` | 🟡 | 7 | a formatted row that opens onto a calendar: pick a day, page the month. `displayedComponents:` chooses date, time or both. No time-of-day editor, so the row's time is the binding's own |
| `ColorPicker` | 🟡 | 7 | opens onto SwiftUI's named colours as swatches. Not a continuous surface - see approximations |
| `Menu` | 🟡 | 7 | opens onto its buttons, over `ForEach` too; pressing one runs its action. Drawn at the bottom rather than anchored to the control |

## Collections and navigation

| View | Status | Phase | Notes |
| --- | --- | --- | --- |
| `List` | 🟡 | 6 | plain/grouped/sidebar styles; binding collection closures are unsupported |
| `Section` | ✅ | 6 | header and footer, the footer in the secondary colour under the card |
| `Form` | ✅ | 6 | the grouped-list form |
| `.onDelete` | ✅ | 7 | swipe a row to reveal it; `remove(atOffsets:)` included; `perform:` takes a closure or a named function, as do `.onAppear`, `.task` and `.onTapGesture` |
| `.onMove` | ⬜ | - | warns; no reorder UI or modifier callback. The array move helper is separate |
| `.swipeActions` | ⬜ | - | warns; custom actions are ignored. Standard delete requires `.onDelete` |
| `.searchable` | ✅ | 7 | a field with its magnifying glass, writing its binding. On a phone it is at the bottom of the screen, or under the title in a tab app, and on iPad in the toolbar. Written on the NavigationStack, it searches the stack's root screen only, and on a TabView without a search tab it draws nothing, as in iOS 27 |
| `.refreshable` | ⬜ | - | pull-to-refresh callback is not implemented |
| `DisclosureGroup` | ✅ | 7 | opens and closes; `isExpanded:` is read where the user gave one |
| `Table` / `OutlineGroup` | ⬜ | - | a labelled placeholder. The closure of a view the preview does not draw is no longer run, so a `TableColumn`'s row parameter cannot trap |
| `NavigationStack` + `NavigationLink` | 🟡 | 6 | destination/value links work. Bound `NavigationStack(path:)` is not synchronized and now warns |
| `.navigationDestination` | 🟡 | 6 | `for:` with a metatype, resolved on link push. `isPresented:` and `item:` overloads warn as unsupported |
| `.navigationTitle` | ✅ | 6 | large and inline, with `navigationBarTitleDisplayMode` |
| `.toolbar` | 🟡 | 6 | leading/trailing items work; keyboard, bottomBar and principal placements warn and are omitted |
| `TabView` | ✅ | 6 | tab bar with `.tabItem`, bound or unbound selection, pages from `ForEach` selected by their ids, and `.page`, whose dots are also the way through - a preview has no swipe |
| `NavigationSplitView` | 🟡 | - | collapsed sidebar stack on every device; no iPad multi-column layout |
| Back gesture | ✗ | - | the preview offers the back *button*; an edge swipe has no analogue here |

## Presentation

| Modifier | Status | Phase | Notes |
| --- | --- | --- | --- |
| `.sheet` (+ `presentationDetents`) | 🟡 | 6 | medium/large/fraction/height and supplied selection; no detent dragging |
| `.fullScreenCover` | ✅ | 6 |
| `.alert` | 🟡 | 6 | title/message, action pills and bound text/secure fields; backdrop does not dismiss. Native keyboard/focus and all overloads incomplete |
| `.confirmationDialog` | 🟡 | 6 | floating capsule-action panel matched to supplied iPhone capture; explicit title visibility, destructive actions and backdrop dismissal; platform adaptation approximate |
| `.popover` | 🟡 | - | always sheet-shaped; no anchored regular-width popover |
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
| `.frame(minWidth:idealWidth:maxWidth:...)` | 🟡 | 3 | min/max constraints and maximum infinity; ideal dimensions are not applied |
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

## Modifiers - appearance

| Modifier | Status | Phase |
| --- | --- | --- |
| `.foregroundStyle` / `.foregroundColor` | ✅ | 3 |
| `.background` (colour, gradient, shape, view) | ✅ | 6 | materials, content builders, alignment, and built-in shape clipping via `in:`; `fillStyle:` warns as unsupported. A colour, gradient or material reaches into the safe area its view touches, as the ShapeStyle form does in iOS 27; a view given as the background stays inside |
| `.overlay` | ✅ | 6 | view arguments and content builders, including interactive content and alignment |
| `.font` (text styles and `.system(size:weight:design:)`) | ✅ | 6 | |
| `.bold` / `.italic` / `.fontWeight` | ✅ | 6 | compose with `.font` in either order |
| `.opacity` | ✅ | 3 |
| `.cornerRadius` | ✅ | 3 |
| `.clipShape` / `.clipped` | ✅ | 6 | a real clipping container, so children are clipped too |
| `.shadow` | ✅ | 6 |
| `.border` | ✅ | 6 |
| `.rotationEffect` / `.scaleEffect` | ✅ | 6 | paint-time, so layout keeps the untransformed size |
| `.blur` / `.saturation` / `.brightness` / `.contrast` / `.grayscale` | ✅ | 7 |
| `.mask` | ⬜ | - | needs an arbitrary view as a mask image, which CSS can only do for a shape |
| `.blendMode` | 🟡 | - | the sixteen modes CSS shares with SwiftUI; `.plusLighter` and the `sourceAtop` family warn rather than drawing the nearest one |
| `.hueRotation` / `.colorMultiply` | ✅ | - | the multiply is an overlay, since no CSS filter multiplies by a colour |
| `.rotation3DEffect` | ✅ | - | a real rotation with a perspective, about the axis vector given |
| `.redacted` / `.unredacted` | ✅ | - | text and images become bars of the size the engine laid out for them |
| `.tint` / `.accentColor` | ✅ | 6 |
| `.buttonStyle` | 🟡 | 6 | `.bordered` and `.borderedProminent`; others fall back to plain. `.controlSize` scales it and `.buttonBorderShape` rounds it |
| `.toggleStyle` | ✅ | - | `.switch`, `.button` and `.checkbox` each draw differently, and all three stay pressable |
| `.pickerStyle` | 🟡 | - | segmented/menu/inline selection; wheel is a dimmed column. Navigation-link and palette styles warn. Menu displays the selected label |
| `.labelStyle` | ✅ | - | `.iconOnly` and `.titleOnly` drop the half they name; inherited, so a Button can set it for its Label |
| `.controlSize` / `.buttonBorderShape` | ✅ | - | the first scales a bordered button's padding, the second its corner |
| `.listStyle` / `.textFieldStyle` | ✅ | 6 |
| `.lineLimit` / `.multilineTextAlignment` / `.textCase` | ✅ | 7 | inherited, so a stack can set them for its text. The `2...4` form reserves its floor as well as capping at its ceiling |
| `.monospaced` | ✅ | 7 |
| `.fontDesign` | ✅ | 10 | inherited separately from size, as in SwiftUI |
| `.underline` / `.strikethrough` | ✅ | - | inherited like the font, and each takes the `Bool` form so a binding can switch one off |
| `.kerning` / `.tracking` | ✅ | - | measured, not painted: the extra advance is in the width the engine reports. The two are applied identically - see approximations |
| `.baselineOffset` / `.lineSpacing` | ✅ | - | `lineSpacing` is a gap *between* lines, so a single line is unaffected |
| `.minimumScaleFactor` | ✅ | - | re-measures at smaller sizes until the text fits its line limit, then truncates what is still over. Stepped in tenths of the range rather than continuously |
| `.truncationMode` | ✅ | - | `.head`, `.middle` and `.tail`, decided against the whole remaining text rather than the last visible line |
| `.allowsTightening` | ✅ | - | condenses up to half a point per character, and only where the text would otherwise break |
| `.monospacedDigit` | ✅ | - | every digit takes the widest one's advance, in the measured frame as well as the paint |
| `.symbolRenderingMode` / `.symbolVariant` | ⬜ | - | the substitute glyphs have no multicolour variants |

## Shapes and styles

| Item | Status | Phase |
| --- | --- | --- |
| `Rectangle` `RoundedRectangle` `Circle` `Ellipse` `Capsule` | ✅ | 3 |
| `Path` (custom) | ✅ | 7 | lines, curves, arcs, rects and ellipses, serialised to SVG |
| `.fill` / `.stroke` | 🟡 | 7 | takes a colour, a gradient or a `StrokeStyle`'s `lineWidth`; a `StrokeStyle` dash pattern is not drawn |
| `.trim` | 🟡 | 7 | on shapes and paths, from where iOS 27 starts each shape (3 o'clock; a rectangle's top-left corner) and in an arc's own direction. On the built-in shapes, strokes only: a trimmed fill, or a trimmed stroke with a dash pattern, is drawn whole and warns. A path's arcs are trimmed whether filled or stroked |
| `.strokeBorder` | ⬜ | - |
| Custom `Shape` conformances | ✅ | 11 | `struct Arc: Shape { func path(in rect: CGRect) -> Path }`, with `.fill`, `.stroke` and `.trim` on the path it draws and `.frame` on the box it draws into. The rect is the one the shape was laid out in last pass, converging on the next - the same answer `GeometryReader` gives to the same ordering problem. `rect.minX` and the rest are derived, as `CGRect` derives them |
| `Color` literals and semantic colours (`.primary`, `.secondary`, `.accentColor`) | ✅ | 3 | and the iOS 27 system, label, fill and grey colours by any of their names (`Color(.systemGray6)`, `Color(uiColor:)`, `UIColor.systemGray6`), the hierarchy down to `.quinary` including a colour's own (`.blue.secondary`), and `hue:saturation:brightness:`; measured in the iOS 27 simulator. An unknown name warns |
| Dark-mode colour resolution | ✅ | 4 |
| `LinearGradient` | ✅ | 6 | named unit points |
| `RadialGradient` / `AngularGradient` | 🟡 | 6 | accepted and drawn as a linear gradient |
| `Material` (`.ultraThinMaterial` etc.) | ✅ | 7 | a real translucent, blurred panel via `backdrop-filter`. `Material.ultraThin` and `.ultraThinMaterial` are the same value |
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
| `.disabled` / `.allowsHitTesting` | ✅ | 7 |
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
| Curves: `.linear .easeIn .easeOut .easeInOut` | ✅ | 6 | CSS timing functions |
| `.spring` (and `.bouncy` / `.snappy` / `.smooth`) | 🟡 | 6 | an overshooting bezier, not a real solver |
| `.transition` (`.slide .opacity .scale .move`) | 🟡 | 7 | entry only; exit would need the renderer to outlive the view |
| `AnyTransition.combined(with:)` | 🟡 | - | constructs, and the preview draws the first of the two: the render tree carries one transition kind per node |
| `matchedGeometryEffect` | ✗ | - | FLIP across an identity change needs the renderer to own both trees at once - the same shadow copy exit transitions need |
| `.phaseAnimator` / `.keyframeAnimator` | ✗ | - | both drive frames from a clock the preview does not run |
| `Animatable` / `animatableData` | ✗ | - | interpolating an arbitrary value needs an animation system that owns the frames; ours is CSS keyframes, deliberately |
| Custom `ViewModifier` + `.modifier(…)` | ✅ | 8 | `body(content:)` is called with the view as a value |
| `extension View { func … }` | ✅ | 8 | the idiom for a reusable modifier chain |
| Custom `ButtonStyle` | ✅ | 9 | applies to every button below it, not only the one it is written on |
| Custom `ToggleStyle` / `LabelStyle` | ✗ | - | the same mechanism as `ButtonStyle`, except a Toggle's configuration carries a *binding* the style writes through. Half of that is worse than none |

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
| Overloading by argument label | ✅ | - | `minutes(on:)` and `minutes(of:)` are two members, chosen by the labels the call writes. Overloading by parameter *type* alone is not: the interpreter is untyped, so `f(_ x: Int)` and `f(_ x: String)` still collapse to whichever was written last |
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
| `Array` - `count`, `map`, `filter`, `compactMap`, `reduce`, `sorted`, `contains`, `firstIndex`, `forEach`, `joined`, `enumerated`, `min`, `max`, `prefix`, `suffix` | ✅ | 2 | `reduce(into:)` too, whose closure takes the accumulator `inout` - the standard way to build a dictionary from a sequence. `enumerated()` gives `(offset:element:)` tuples, and a closure with a parameter for each takes one apart, as `{ index, item in }` does. A range of integers answers the same methods: `(0..<3).map { … }` |
| `Array` - `allSatisfy`, `flatMap`, `dropFirst`, `dropLast`, `first(where:)`, `last(where:)`, `lastIndex`, `randomElement`, `shuffled` | ✅ | - | `shuffled` is Fisher-Yates, not the biased one-line sort |
| `Array` - `append`, `insert`, `remove`, `removeAll`, `removeFirst`, `removeLast`, `popLast`, `sort`, `reverse`, `shuffle`, `swapAt`, `replaceSubrange`, `removeSubrange` | ✅ | - | mutating, and refused on a `let` as Xcode refuses them |
| `Dictionary` - subscript, `default:`, `keys`, `values`, `updateValue`, `removeValue` | ✅ | 2 | |
| `Dictionary` - `sorted`, `mapValues`, `filter`, `map`, `contains` | ✅ | - | over `(key: , value: )` pairs; `filter` answers a dictionary and `sorted` an array |
| `Dictionary(grouping:by:)`, `Dictionary(uniqueKeysWithValues:)` | ✅ | 11 | grouping keeps the order the groups were first met, which is what a sectioned list wants and what Swift's hash order promises nothing about |
| `counts[key, default: 0] += 1` | ✅ | 11 | the default belongs to the read half of a compound assignment; without it the first occurrence of every key read nil |
| `Set` | 🟡 | 2 | `Set(_:)` and a `Set` annotation drop duplicates; iteration is in insertion order rather than Swift's unspecified hash order |
| `Int` / `Double` conversion from `String` | ✅ | - | failable, matched to Swift's grammar: `" 42"`, `"4_2"` and `"0x10"` are nil |
| `Int.max` / `Int.min` | 🟡 | - | 2^53 - 1, not 2^63 - 1 - see approximations |
| `Int.random(in:)`, `Double.random(in:)`, `Bool.random()` | ✅ | - | |
| `Double` - `rounded()`, `rounded(.up/.down/.towardZero)`, `squareRoot`, `truncatingRemainder`, `isMultiple(of:)` | ✅ | - | halves round away from zero, as Swift's do |
| `sqrt`, `pow`, `round`, `floor`, `ceil`, `abs`, `min`, `max` | ✅ | - | |
| `zip`, `stride(from:to:by:)`, `stride(from:through:by:)` | ✅ | - | arrays rather than lazy sequences |
| `type(of:)`, `fatalError`, `assert`, `precondition` | ✅ | - | a failed assertion is a trap reported on its line |
| Bitwise `&`, `\|`, `^`, `<<`, `>>` | ✅ | - | computed in `BigInt`, so a shift past 32 bits is not truncated |
| `UUID` | ✅ | - | random, and prints as its `uuidString` |
| `Date` | 🟡 | - | `timeIntervalSince1970`, `addingTimeInterval`, `timeIntervalSince`, comparison, `Date.now`. `formatted()` is Foundation's default, a numeric date and a short time, and `formatted(date:time:)` takes the parts it is given. No `DateFormatter` |
| `Calendar` | 🟡 | - | `Calendar.current`, in the preview's time zone: `component(_:from:)`, `date(byAdding:value:to:)`, `startOfDay(for:)`, `isDateInToday` and its neighbours, `isDate(_:inSameDayAs:)`, and `dateComponents` from one date or between two, largest unit first |
| `Timer` | 🟡 | - | `Timer.publish(every:on:in:).autoconnect()` with `.onReceive`, and `Timer.scheduledTimer`, are accepted and never fire: the preview draws one moment, and warns where a timer is made |
| `URL` | 🟡 | - | `URL(string:)` is failable and the string is kept as written; `absoluteString`, `path`, `host`, `scheme`, `query`, `lastPathComponent`, `pathExtension`, `appendingPathComponent`. Nothing is fetched |
| `Codable` over JSON | ⬜ | - | listed in Phase 2's scope and never built |
| `DateFormatter`, `NumberFormatter`, `Measurement` | ⬜ | - | `Text`'s `format:` styles cover what view code usually needs |

## Known approximations

Listed in the exported README so nothing is a surprise on the Mac:

1. **Fonts** - `-apple-system` leads the stack, so a Mac or an iPad previews in the *real* SF Pro,
   SF Pro Rounded and SF Mono. Everywhere else a self-hosted Inter stands in for SF Pro, and
   `ui-rounded` resolves to nothing outside Apple platforms, so `.rounded` falls back to the default
   design. Layout is correct either way - the main thread measures whichever face actually resolved
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
7. **Transitions are entry only.** Animating a view *out* means keeping it alive after the state
   says it is gone, which needs the renderer to own a shadow copy of the tree. A half-built version
   of that is worse than none: a view that lingers is a preview telling a lie.
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
21. **Views beside a NavigationStack or a TabView are not drawn.** A screen is the content of
    its container, so a floating button in a `ZStack` beside the stack, a banner above a
    TabView, and an `.overlay` or `.safeAreaInset` written on the stack are left out. Each one
    warns where it is written. Sheets, alerts and search written on the containers do show.
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
| Assignment to a `let` | `let total = 0; total = 1` | writing an `inout` parameter, which is the caller's storage |
| Non-`mutating` method writing a property | `func bump() { count += 1 }` on a plain stored `var` | the same method writing a `@State`, `@Binding` or any other wrapped property: their setters are **nonmutating**, which is what lets `body` write them |
| `ForEach` without identity | `ForEach(items)` where the element is not `Identifiable` | a range, or an explicit `id:` |
| Omitted argument labels | `greet("Ada")` for `func greet(name:)` | a parameter declared `_` |
| Missing `return` | a multi-statement `func` body with a return type and no `return` anywhere | a body whose returns are inside a `switch`, `while`, `repeat`, `do`/`catch`, `guard`'s `else` or an `else if` chain |

The right-hand column is the half that matters. A pass that cries wolf is worse than no
pass, because people stop reading the panel and then the true warnings go unread too -
and the `mutating` row was exactly that until the defect register's Phase 6: it fired on
the commonest shape in SwiftUI and offered a fix-it that broke the file it was applied to.

## Additional confirmed gaps from the September 2026 audit

- Custom `EnvironmentKey.defaultValue` is not implemented.
  Missing environment values now stop with an unsupported-runtime diagnostic instead of `nil`.
- `.safeAreaPadding`, `.gridCellColumns`, and `.symbolEffect` are explicitly recognized as unsupported.
- `AsyncImage` and `TimelineView` now warn about their existing partial behavior.
- See the [audit](15-SWIFTUI-COMPATIBILITY-AUDIT.md) before relying on generated code outside the tested subset.
