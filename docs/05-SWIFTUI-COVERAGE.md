# 05 - SwiftUI coverage matrix

The public contract for what renders. Updated in the same PR as any runtime change.

Status: ✅ done · 🟡 partial (limitations noted) · ⬜ planned, phase given · ✗ declined (reason given)

Last updated after the picker and view pass (defect register phases 9.1 and 9.6), which
gave `DatePicker` a calendar and `ColorPicker` a palette, and drew the views that only
ever needed drawing.

**155 ✅ · 48 🟡 · 12 ⬜ · 11 ✗**, over 226 rows, counted from this file rather than carried
forward. That is a count of what the matrix *claims*; checking every claim against the code
is the defect register's 10.1, and it is still open for the rows no recent phase touched.

Anything not listed renders a labelled placeholder box and is counted by the coverage telemetry
(FR-4.11, NFR-6). Those counts are visible in the studio's **Coverage** panel and never leave the
browser; they are what decides what gets built next.

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
| `Group` | ✅ | 3 | |
| `ForEach` | ✅ | 6 | ranges, `Identifiable`, `id:` key paths; identity follows the element |
| `ScrollView` | ✅ | 6 | both axes; scrolls natively, so the physics are the browser's |
| `GeometryReader` | ✅ | 7 | reports its real size through `size` and `frame(in:)`, and is its own coordinate space |
| `LazyVStack` / `LazyHStack` | 🟡 | 6 | laid out as stacks: correct, and not virtualised. A 200-row stack measures in 7.6 ms against a 120 ms budget, so the cost is real and not yet worth the identity complexity |
| `LazyVGrid` / `LazyHGrid` | ✅ | 6 | fixed, flexible and adaptive columns |
| `Grid` / `GridRow` | ✅ | 7 | columns align across rows |
| `ViewThatFits` | ✅ | 7 | |
| `AnyView` | ✅ | 7 | erasure is a compile-time concern; at runtime it is its content |
| `Layout` protocol (custom layouts) | ✗ | - | needs a `Subviews` proxy and callbacks from the engine back into the interpreter for sizing as well as placement - a real seam, and custom conformances are rare in app code |
| `AnyLayout` | ✗ | - | the same seam |

## Content views

| View | Status | Phase | Notes |
| --- | --- | --- | --- |
| `Text` | ✅ | 3 | interpolation, `verbatim:`, `format:` number styles (`.number`, `.percent`, `.currency(code:)`), and a `Date` with `style:` (`.time`, `.date`, `.relative`, `.offset`, `.timer`). `Text + Text` concatenates, and each half keeps its own face, colour and attributes |
| `Label` | ✅ | 6 | icon then title |
| `Image(systemName:)` | 🟡 | 6 | ~80 names drawn as shapes, the rest Unicode substitutes (R2) - see approximations |
| `Image("asset")` | ✗ | - | a project file here is text; there is no asset catalogue to resolve a name against, so there is nothing to draw. Reported as unavailable rather than guessed at |
| `GroupBox` | ✅ | - | a titled card: the label above, the contents on a rounded secondary panel |
| `LabeledContent` | ✅ | - | label leading, value trailing in the secondary colour; both the `value:` and content forms |
| `ControlGroup` | 🟡 | - | its controls in a row. Drawn as the toolbar form, not the segmented form a menu gives it |
| `ScrollViewReader` | ⬜ | - | recognised and drawn as a labelled placeholder, not reported as an unknown name |
| `AsyncImage` | 🟡 | 7 | draws its `placeholder:`, because there is no network in the worker. Its content closure is not run: there is no `Image` to hand it |
| `Link` / `ShareLink` | ✅ | 6 | drawn tinted; does not open a URL or a share sheet. `URL(string:)` exists, so the `destination:` can be written |
| `ProgressView` | ✅ | 6 | determinate bar; `.circular` and the indeterminate form are a ring |
| `Gauge` | 🟡 | 7 | `.gaugeStyle` chooses a ring or a bar; the ring does not show the value as an arc |
| `Canvas` | ✅ | 7 | `fill` and `stroke`; drawings become the same vector nodes a `Path` does |
| `TimelineView` | 🟡 | - | its content is drawn once, at the moment of the render. The schedule is a clock the preview does not run, and the `context` is not supplied |
| `Chart` (Swift Charts) | ⬜ | - | needs a mark model and a plottable-value protocol of its own, which is a package rather than a view |
| `Map` (MapKit) | ✗ | - | Needs a licensed tile source; placeholder with a note |
| `UIViewRepresentable` | ✗ | - | Cannot run UIKit; labelled placeholder |

## Controls

| View | Status | Phase | Notes |
| --- | --- | --- | --- |
| `Button` | ✅ | 3 | |
| `Toggle` | ✅ | 6 | |
| `Slider` | ✅ | 6 | |
| `Stepper` | ✅ | 6 | each half is its own target; `step:` and `in:` are both honoured |
| `TextField` / `SecureField` | 🟡 | 6 | a real input with a caret; `SecureField` does not mask yet |
| `TextEditor` | 🟡 | 7 | a single-line field; no multi-line editing |
| `Picker` | 🟡 | 6 | opens onto its options, ticks the chosen one, writes the selection. `.segmented`, `.inline` and `.wheel` draw them in place instead. The popup is drawn at the bottom rather than anchored to the control |
| `DatePicker` | 🟡 | 7 | a formatted row that opens onto a calendar: pick a day, page the month. `displayedComponents:` chooses date, time or both. No time-of-day editor, so the row's time is the binding's own |
| `ColorPicker` | 🟡 | 7 | opens onto SwiftUI's named colours as swatches. Not a continuous surface - see approximations |
| `Menu` | 🟡 | 7 | opens onto its buttons; pressing one runs its action. Drawn at the bottom rather than anchored to the control |

## Collections and navigation

| View | Status | Phase | Notes |
| --- | --- | --- | --- |
| `List` | ✅ | 6 | plain, the grouped styles and `.sidebar`, which names its sections in sentence case on the grouped background |
| `Section` | ✅ | 6 | header and footer, the footer in the secondary colour under the card |
| `Form` | ✅ | 6 | the grouped-list form |
| `.onDelete` | ✅ | 7 | swipe a row to reveal it; `remove(atOffsets:)` included |
| `.onMove` | 🟡 | 7 | `move(fromOffsets:toOffset:)` works; there is no drag-to-reorder UI |
| `.swipeActions` | 🟡 | 7 | recognised; the revealed action is the standard Delete |
| `.searchable` | ✅ | 7 | a field above the content, writing its binding |
| `.refreshable` | ⬜ | - | pull-to-refresh has no meaning in a static preview |
| `DisclosureGroup` | ✅ | 7 | opens and closes; `isExpanded:` is read where the user gave one |
| `Table` / `OutlineGroup` | ⬜ | - | a labelled placeholder. The closure of a view the preview does not draw is no longer run, so a `TableColumn`'s row parameter cannot trap |
| `NavigationStack` + `NavigationLink` | ✅ | 6 | both the `destination:` and `value:` forms |
| `.navigationDestination` | ✅ | 6 | `for:` with a metatype, resolved on push |
| `.navigationTitle` | ✅ | 6 | large and inline, with `navigationBarTitleDisplayMode` |
| `.toolbar` | ✅ | 6 | bar buttons leading and trailing, singly or in a `ToolbarItemGroup` |
| `TabView` | ✅ | 6 | tab bar with `.tabItem`, bound or unbound selection, and `.page`, whose dots are also the way through - a preview has no swipe |
| `NavigationSplitView` | ✅ | - | collapses to a navigation stack showing the sidebar, which is what a phone does |
| Back gesture | ✗ | - | the preview offers the back *button*; an edge swipe has no analogue here |

## Presentation

| Modifier | Status | Phase |
| --- | --- | --- |
| `.sheet` (+ `presentationDetents`) | ✅ | 6 |
| `.fullScreenCover` | ✅ | 6 |
| `.alert` | 🟡 | 6 | title, message and buttons; no text-field alerts |
| `.confirmationDialog` | 🟡 | 6 | anchored to the bottom edge |
| `.popover` | ✅ | - | presented as a sheet, which is what iOS does at this width |
| `@Environment(\.dismiss)` | ✅ | 7 | closes whatever is presented when it is called |

## Modifiers - layout and sizing

| Modifier | Status | Phase | Notes |
| --- | --- | --- | --- |
| `.frame(width:height:alignment:)` | ✅ | 3 | |
| `.frame(minWidth:idealWidth:maxWidth:...)` | ✅ | 3 | the flexible form; `.infinity` handling |
| `.padding` | ✅ | 3 | all edge-set forms |
| `.fixedSize` | ✅ | 6 | both the whole-view and per-axis forms |
| `.layoutPriority` | ✅ | 7 | the highest-priority group takes its space first |
| `.offset` | ✅ | 6 | paint-time, so neighbours do not move |
| `.position` | ✅ | 7 | centres the view on a point in its parent's space |
| `.aspectRatio` / `.scaledToFit` / `.scaledToFill` | ✅ | 7 | |
| `.ignoresSafeArea` | ✅ | 7 | resolved by the pipeline, which owns the device's edges |
| `.safeAreaInset` | ✅ | - | all four edges; the content is *inset*, not overlaid, so a bar drawn this way does not cover the last row |
| `.alignmentGuide` | ✅ | - | the stack aligns guides rather than edges, so a guide can be replaced. `d.width`, `d.height` and `d[.leading]` and friends all read |
| `.containerRelativeFrame` | 🟡 | - | takes the container's size along the named axes, divided by `count`. The container is whatever proposed the size, which is the scroll view or stack above it |

## Modifiers - appearance

| Modifier | Status | Phase |
| --- | --- | --- |
| `.foregroundStyle` / `.foregroundColor` | ✅ | 3 |
| `.background` (colour, gradient, shape, view) | ✅ | 6 | materials included - see the `Material` row |
| `.overlay` | ✅ | 6 | |
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
| `.pickerStyle` | ✅ | - | `.segmented`, `.inline` and `.wheel` draw their options on screen, each option pressable; `.menu` and `.navigationLink` open onto them. The wheel is a dimmed column, not a spinner |
| `.labelStyle` | ✅ | - | `.iconOnly` and `.titleOnly` drop the half they name; inherited, so a Button can set it for its Label |
| `.controlSize` / `.buttonBorderShape` | ✅ | - | the first scales a bordered button's padding, the second its corner |
| `.listStyle` / `.textFieldStyle` | ✅ | 6 |
| `.lineLimit` / `.multilineTextAlignment` / `.textCase` | ✅ | 7 | inherited, so a stack can set them for its text |
| `.monospaced` | ✅ | 7 |
| `.fontDesign` | ✅ | 10 | inherited separately from size, as in SwiftUI |
| `.underline` / `.strikethrough` | ✅ | - | inherited like the font, and each takes the `Bool` form so a binding can switch one off |
| `.kerning` / `.tracking` | ✅ | - | measured, not painted: the extra advance is in the width the engine reports. The two are applied identically - see approximations |
| `.baselineOffset` / `.lineSpacing` | ✅ | - | `lineSpacing` is a gap *between* lines, so a single line is unaffected |
| `.minimumScaleFactor` | ✅ | - | re-measures at smaller sizes until the text fits its line limit, then truncates what is still over. Stepped in tenths of the range rather than continuously |
| `.truncationMode` | ✅ | - | `.head`, `.middle` and `.tail`, decided against the whole remaining text rather than the last visible line |
| `.allowsTightening` | ⬜ | - | condensing letter spacing to avoid a break, which needs a second measuring pass per line |
| `.symbolRenderingMode` / `.symbolVariant` | ⬜ | - | the substitute glyphs have no multicolour variants |

## Shapes and styles

| Item | Status | Phase |
| --- | --- | --- |
| `Rectangle` `RoundedRectangle` `Circle` `Ellipse` `Capsule` | ✅ | 3 |
| `Path` (custom) | ✅ | 7 | lines, curves, arcs, rects and ellipses, serialised to SVG |
| `.fill` / `.stroke` | 🟡 | 7 | takes a colour, a gradient or a `StrokeStyle`'s `lineWidth`; a `StrokeStyle` dash pattern is not drawn |
| `.trim` | 🟡 | 7 | exact for arcs - progress rings - approximate elsewhere |
| `.strokeBorder` | ⬜ | - |
| `Color` literals and semantic colours (`.primary`, `.secondary`, `.accentColor`) | ✅ | 3 |
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
| `.onAppear` / `.onDisappear` | ✅ | 7 | run once per appearance, not per render |
| `.task` | 🟡 | 7 | run synchronously; the preview has no concurrency |
| `.onChange(of:)` | ✅ | 7 | not fired for the initial value, as SwiftUI does not |
| `.onReceive` | ⬜ | - | needs Combine, which needs publishers and a scheduler the preview does not have |
| `.disabled` / `.allowsHitTesting` | ✅ | 7 |
| `.focused` | 🟡 | - | `@FocusState` is storage the code reads and writes; nothing focuses a field from outside the program, since the preview has no keyboard |

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
| `@State` | ✅ | 3 |
| `@Binding` (and `$value` projections) | ✅ | 6 | passes down any number of views |
| Key paths (`\.self`, `\.id`) | 🟡 | 6 | applied where a view takes one (`ForEach(id:)`); **not where a closure is expected**, so `map(\.name)` is rejected |
| `@StateObject` / `@ObservedObject` / `ObservableObject` / `@Published` | ✅ | 7 | a class is a reference, so a change is seen everywhere |
| `@AppStorage` / `@SceneStorage` | 🟡 | - | keyed by the string, so views sharing a key share a value and it outlives the view that wrote it. Held for the session rather than on disk - see approximations |
| `@FocusState` | 🟡 | - | storage the code reads and writes |
| `Binding(get:set:)` / `.constant` | ✅ | - | a projection built from the user's closures, or one that reads a value and swallows writes; a control cannot tell either from `$value` |
| `.environmentObject` / `@EnvironmentObject` | 🟡 | 7 | reaches views expanded while the modifier is in scope - see below |
| `.environment(\.key, …)` | 🟡 | 7 | same scoping rule |
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
| Contextual member syntax (`.home` for an enum) | ✅ | 7 | resolved where a declaration states the type |
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

## Standard library and Foundation

The part of the library SwiftUI code actually calls. It had no section here until the
defect register's Phase 5, which is part of why fifty-five of its calls could be
missing without anything saying so.

| Feature | Status | Phase | Notes |
| --- | --- | --- | --- |
| `String` - `count`, `uppercased`, `hasPrefix`, `contains`, `split`, `replacingOccurrences`, `trimmingCharacters` | ✅ | 2 | counted and sliced by grapheme cluster, so `"👋🏽".count` is 1 |
| `String` - `capitalized`, `prefix`, `suffix`, `dropFirst`, `dropLast`, `reversed`, `components`, `padding`, `starts(with:)`, `append` | ✅ | - | |
| `String` - `unicodeScalars` | ✅ | - | code points, which is the whole difference from `count` |
| `Array` - `count`, `map`, `filter`, `compactMap`, `reduce`, `sorted`, `contains`, `firstIndex`, `forEach`, `joined`, `enumerated`, `min`, `max`, `prefix`, `suffix` | ✅ | 2 | |
| `Array` - `allSatisfy`, `flatMap`, `dropFirst`, `dropLast`, `first(where:)`, `last(where:)`, `lastIndex`, `randomElement`, `shuffled` | ✅ | - | `shuffled` is Fisher-Yates, not the biased one-line sort |
| `Array` - `append`, `insert`, `remove`, `removeAll`, `removeFirst`, `removeLast`, `popLast`, `sort`, `reverse`, `shuffle`, `swapAt`, `replaceSubrange`, `removeSubrange` | ✅ | - | mutating, and refused on a `let` as Xcode refuses them |
| `Dictionary` - subscript, `default:`, `keys`, `values`, `updateValue`, `removeValue` | ✅ | 2 | |
| `Dictionary` - `sorted`, `mapValues`, `filter`, `map`, `contains` | ✅ | - | over `(key: , value: )` pairs; `filter` answers a dictionary and `sorted` an array |
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
| `Date` | 🟡 | - | `timeIntervalSince1970`, `addingTimeInterval`, `timeIntervalSince`, `formatted()`, comparison, `Date.now`. No calendar: there is no `Calendar`, no `DateComponents` and no `DateFormatter` |
| `URL` | 🟡 | - | `URL(string:)` is failable and the string is kept as written; `absoluteString`, `path`, `host`, `scheme`, `query`, `lastPathComponent`, `pathExtension`, `appendingPathComponent`. Nothing is fetched |
| `Codable` over JSON | ⬜ | - | listed in Phase 2's scope and never built |
| `Calendar`, `DateFormatter`, `NumberFormatter`, `Measurement` | ⬜ | - | `Text`'s `format:` styles cover what view code usually needs |

## Known approximations

Listed in the exported README so nothing is a surprise on the Mac:

1. **Fonts** - `-apple-system` leads the stack, so a Mac or an iPad previews in the *real* SF Pro,
   SF Pro Rounded and SF Mono. Everywhere else a self-hosted Inter stands in for SF Pro, and
   `ui-rounded` resolves to nothing outside Apple platforms, so `.rounded` falls back to the default
   design. Layout is correct either way - the main thread measures whichever face actually resolved
   rather than reading a transcribed table - but two machines will break lines in different places,
   and neither is CoreText.
2. **SF Symbols** - Apple's symbol artwork cannot be redistributed to a browser (R2). About eighty
   names are *drawn*, as shapes on a 24-unit monoline grid at the proportions SF Symbols uses;
   everything else falls back to a Unicode character carrying the same meaning. Both are
   approximations, the shapes differ from Apple's, and the inspector marks every symbol as
   approximated. The exported Swift still says `Image(systemName:)`, so the real symbol appears the
   moment the project is built in Xcode.
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
13. **A `Date` has no calendar.** Intervals, comparison and formatting work; there is no
    `Calendar`, `DateComponents` or `DateFormatter`, so "the start of this month" cannot be
    computed. `Text(date, style: .relative)` and `.timer` are computed once, at render, because
    the preview has no clock to tick them with.
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
