# 05 — SwiftUI coverage matrix

The public contract for what renders. Updated in the same PR as any runtime change.

Status: ✅ done · 🟡 partial (limitations noted) · ⬜ planned, phase given · ✗ declined (reason given)

Last updated after Phase 6.

Anything not listed renders a labelled placeholder box and is counted by the coverage telemetry
(FR-4.11, NFR-6). Those counts are visible in the studio's **Coverage** panel and never leave the
browser; they are what decides what gets built next.

A ⬜ row is not a promise of a date — it is a statement that the construct is recognised, reported by
name, and exported to Xcode unchanged. Phase 7 is where the remaining rows are picked up, ordered by
what the telemetry says people actually reach for.

## Layout

| View | Status | Phase | Notes |
| --- | --- | --- | --- |
| `VStack` / `HStack` / `ZStack` | ✅ | 3 | alignment, spacing |
| `Spacer` | ✅ | 3 | minLength; the canonical test of the layout engine |
| `Divider` | ✅ | 6 | hairline across its stack's axis |
| `Group` | ✅ | 3 | |
| `ForEach` | ✅ | 6 | ranges, `Identifiable`, `id:` key paths; identity follows the element |
| `ScrollView` | ✅ | 6 | both axes; scrolls natively, so the physics are the browser's |
| `GeometryReader` | ⬜ | 7 | |
| `LazyVStack` / `LazyHStack` | 🟡 | 6 | laid out as stacks — correct, but not virtualised |
| `LazyVGrid` / `LazyHGrid` | ✅ | 6 | fixed, flexible and adaptive columns |
| `Grid` / `GridRow` | ⬜ | 7 | the 2-D table form, distinct from the lazy grids above |
| `ViewThatFits` | ⬜ | 7 | |
| `Layout` protocol (custom layouts) | ⬜ | 7 | our engine already speaks this protocol |
| `AnyLayout` | ⬜ | 7 | |

## Content views

| View | Status | Phase | Notes |
| --- | --- | --- | --- |
| `Text` | ✅ | 3 | interpolation, concatenation, `Date`/number formatting in 6 |
| `Label` | ✅ | 6 | icon then title |
| `Image(systemName:)` | 🟡 | 6 | SF Symbol names map to open substitutes (R2) — see approximations |
| `Image("asset")` | ⬜ | 7 | reported as unavailable rather than drawn as a grey box |
| `AsyncImage` | ⬜ | 7 | |
| `Link` | ✅ | 6 | drawn tinted; does not open a URL |
| `ProgressView` | 🟡 | 6 | determinate bar; the indeterminate form is a static ring |
| `Gauge` | ⬜ | 7 | |
| `Canvas` | ⬜ | 7 | 2D context drawing |
| `TimelineView` | ⬜ | 7 | |
| `Chart` (Swift Charts) | ⬜ | 7 | bar, line, point only |
| `Map` (MapKit) | ✗ | — | Needs a licensed tile source; placeholder with a note |
| `UIViewRepresentable` | ✗ | — | Cannot run UIKit; labelled placeholder |

## Controls

| View | Status | Phase |
| --- | --- | --- |
| `Button` | ✅ | 3 |
| `Toggle` | ✅ | 6 |
| `Slider` | ✅ | 6 |
| `Stepper` | 🟡 | 6 | drawn and laid out; the two halves are not separately tappable yet |
| `TextField` / `SecureField` | 🟡 | 6 | a real input with a caret; `SecureField` does not mask yet |
| `TextEditor` | ⬜ | 7 |
| `Picker` | 🟡 | 6 | drawn in the menu style, showing its selection; not yet openable |
| `DatePicker` | ⬜ | 7 |
| `ColorPicker` | ⬜ | 7 |
| `Menu` | ⬜ | 7 |
| `ShareLink` | ⬜ | 7 |

## Collections and navigation

| View | Status | Phase | Notes |
| --- | --- | --- | --- |
| `List` | 🟡 | 6 | plain and the grouped styles; no sidebar style |
| `Section` | 🟡 | 6 | header; footers are not drawn yet |
| `Form` | ✅ | 6 | the grouped-list form |
| `.onDelete` / `.onMove` / swipe actions | ⬜ | 7 | |
| `.refreshable` / `.searchable` | ⬜ | 7 | |
| `NavigationStack` + `NavigationLink` | ✅ | 6 | both the `destination:` and `value:` forms |
| `.navigationDestination` | ✅ | 6 | `for:` with a metatype, resolved on push |
| `.navigationTitle` | ✅ | 6 | large and inline, with `navigationBarTitleDisplayMode` |
| `.toolbar` | 🟡 | 6 | bar buttons, leading and trailing; no `ToolbarItemGroup` placements |
| `TabView` | 🟡 | 6 | tab bar with `.tabItem`, bound or unbound selection; no page style |
| `NavigationSplitView` | ⬜ | 7 | iPad only |
| Back gesture | ✗ | — | the preview offers the back *button*; an edge swipe has no analogue here |

## Presentation

| Modifier | Status | Phase |
| --- | --- | --- |
| `.sheet` (+ `presentationDetents`) | ✅ | 6 |
| `.fullScreenCover` | ✅ | 6 |
| `.alert` | 🟡 | 6 | title, message and buttons; no text-field alerts |
| `.confirmationDialog` | 🟡 | 6 | anchored to the bottom edge |
| `.popover` | ⬜ | 7 |
| `@Environment(\.dismiss)` | ⬜ | 7 | dismiss by setting the binding, or by tapping outside |

## Modifiers — layout and sizing

| Modifier | Status | Phase | Notes |
| --- | --- | --- | --- |
| `.frame(width:height:alignment:)` | ✅ | 3 | |
| `.frame(minWidth:idealWidth:maxWidth:...)` | ✅ | 3 | the flexible form; `.infinity` handling |
| `.padding` | ✅ | 3 | all edge-set forms |
| `.fixedSize` | ✅ | 6 | both the whole-view and per-axis forms |
| `.layoutPriority` | ⬜ | 7 | |
| `.offset` | ✅ | 6 | paint-time, so neighbours do not move |
| `.position` | ⬜ | 7 | |
| `.aspectRatio` / `.scaledToFit` / `.scaledToFill` | ⬜ | 7 | |
| `.safeAreaInset` / `.ignoresSafeArea` | ⬜ | 7 | |
| `.alignmentGuide` | ⬜ | 7 | |
| `.containerRelativeFrame` | ⬜ | 7 | |

## Modifiers — appearance

| Modifier | Status | Phase |
| --- | --- | --- |
| `.foregroundStyle` / `.foregroundColor` | ✅ | 3 |
| `.background` (colour, gradient, shape, view) | 🟡 | 6 | materials are not drawn |
| `.overlay` | ✅ | 6 | |
| `.font` (text styles and `.system(size:weight:design:)`) | ✅ | 6 | |
| `.bold` / `.italic` / `.fontWeight` | ✅ | 6 | compose with `.font` in either order |
| `.opacity` | ✅ | 3 |
| `.cornerRadius` | ✅ | 3 |
| `.clipShape` / `.clipped` | ✅ | 6 | a real clipping container, so children are clipped too |
| `.shadow` | ✅ | 6 |
| `.border` | ✅ | 6 |
| `.rotationEffect` / `.scaleEffect` | ✅ | 6 | paint-time, so layout keeps the untransformed size |
| `.blur` / `.saturation` / `.brightness` / `.contrast` | ⬜ | 7 |
| `.mask` | ⬜ | 7 |
| `.tint` / `.accentColor` | ✅ | 6 |
| `.buttonStyle` | 🟡 | 6 | `.bordered` and `.borderedProminent`; others fall back to plain |
| `.toggleStyle` / `.pickerStyle` / `.labelStyle` | ⬜ | 7 |
| `.listStyle` / `.textFieldStyle` | ✅ | 6 |
| `.symbolRenderingMode` / `.symbolVariant` | ⬜ | 7 | the substitute glyphs have no multicolour variants |

## Shapes and styles

| Item | Status | Phase |
| --- | --- | --- |
| `Rectangle` `RoundedRectangle` `Circle` `Ellipse` `Capsule` | ✅ | 3 |
| `Path` (custom) | ⬜ | 7 |
| `.fill` / `.stroke` / `.strokeBorder` / `trim` | ⬜ | 7 |
| `Color` literals and semantic colours (`.primary`, `.secondary`, `.accentColor`) | ✅ | 3 |
| Dark-mode colour resolution | ✅ | 4 |
| `LinearGradient` | ✅ | 6 | named unit points |
| `RadialGradient` / `AngularGradient` | 🟡 | 6 | accepted and drawn as a linear gradient |
| `Material` (`.ultraThinMaterial` etc.) | ⬜ | 7 | |
| `ShapeStyle` conformances generally | 🟡 | 6 | colours, tokens and gradients anywhere a style is taken |

## Interaction and lifecycle

| Modifier | Status | Phase |
| --- | --- | --- |
| `.onTapGesture` | ✅ | 6 |
| `.onLongPressGesture` | 🟡 | 6 | fires on tap; the press duration is not modelled |
| `DragGesture` / `MagnificationGesture` / `RotationGesture` | ⬜ | 7 |
| `.simultaneousGesture` / `.sequenced` / `.exclusively` | ⬜ | 7 |
| `.onAppear` / `.onDisappear` | ⬜ | 7 |
| `.task` | ⬜ | 7 |
| `.onChange(of:)` | ⬜ | 7 |
| `.onReceive` | ⬜ | 7 |
| `.disabled` | ✅ | 6 |
| `.allowsHitTesting` | ⬜ | 7 |
| `.focused` | ⬜ | 7 |

## Animation

| Feature | Status | Phase | Notes |
| --- | --- | --- | --- |
| `withAnimation` | ✅ | 6 | animates every change in its transaction, for one frame |
| `.animation(_:value:)` | 🟡 | 6 | animates its subtree; the `value:` gate is not honoured |
| Curves: `.linear .easeIn .easeOut .easeInOut` | ✅ | 6 | CSS timing functions |
| `.spring` (and `.bouncy` / `.snappy` / `.smooth`) | 🟡 | 6 | an overshooting bezier, not a real solver |
| `.transition` (`.slide .opacity .scale .move`) | ⬜ | 7 | parsed and carried; insertion is not animated yet |
| `matchedGeometryEffect` | ⬜ | 7 | FLIP across identity change |
| `.phaseAnimator` / `.keyframeAnimator` | ⬜ | 7 | |
| `Animatable` / `animatableData` | ⬜ | 7 | |

## Environment and app structure

| Feature | Status | Phase |
| --- | --- | --- |
| `App` / `@main` / `WindowGroup` | ✅ | 3 |
| `Scene` phases | ⬜ | 7 |
| `@State` | ✅ | 3 |
| `@Binding` (and `$value` projections) | ✅ | 6 | passes down any number of views |
| Key paths (`\.self`, `\.id`) | ✅ | 6 | applied, not type-checked |
| `.environment` / `.environmentObject` | ⬜ | 7 |
| `@StateObject` / `@ObservedObject` / `ObservableObject` | ⬜ | 7 |
| `colorScheme`, `dynamicTypeSize` | ✅ | 4 |
| `locale`, `layoutDirection` | ⬜ | 7 |
| `horizontalSizeClass` / `verticalSizeClass` | ⬜ | 7 |
| `dismiss`, `openURL` | ⬜ | 7 |
| `PreferenceKey` | ⬜ | 7 |
| `#Preview` macro / `PreviewProvider` | ⬜ | 7 |

## Accessibility

| Modifier | Status | Phase | Notes |
| --- | --- | --- | --- |
| Implicit roles and labels | ✅ | 6 | every control renders with an ARIA role and its label |
| `.accessibilityLabel` / `Hint` / `Value` | ⬜ | 7 | would override the implicit label |
| `.accessibilityHidden` / `.accessibilityElement` | ⬜ | 7 | |
| `.accessibilityAddTraits` | ⬜ | 7 | |

## Known approximations

Listed in the exported README so nothing is a surprise on the Mac:

1. **Fonts** — an open metric-compatible stack stands in for SF Pro. Line breaking is very close but
   not identical to CoreText.
2. **SF Symbols** — Apple's symbol font cannot be redistributed to a browser (R2), so each name maps
   to a Unicode substitute that carries the same *meaning* at a similar weight. Shapes differ, and
   the inspector marks every symbol as approximated. The exported Swift still says
   `Image(systemName:)`, so the real symbol appears the moment the project is built in Xcode.
3. **Springs** — `.spring()` and friends are approximated with an overshooting cubic bezier. The
   motion is recognisably springy; it is not the same solver, and it will not match frame for frame.
4. **Scrolling physics** — native browser scrolling, not iOS rubber-band deceleration.
5. **Sheet dismissal** — a preview has no swipe-down, so a sheet is dismissed by tapping outside it
   or by whatever sets its binding back.
6. **Performance** — the interpreter is far slower than compiled Swift; do not judge frame rates.

## The strictness pass (R5)

Separate from coverage, and pointed the other way: the interpreter is *more* permissive than
`swiftc`, so a warning coded `may_not_compile_in_xcode` marks code that runs here and will not build
there. It only fires where the type involved is certain — from a literal or an explicit annotation —
because a false positive would teach people to ignore the panel.

| Check | Example that is flagged |
| --- | --- |
| Mixed numeric arithmetic | `let w: Int = 10; let s: Double = 1.5; w * s` |
| `Text` given a non-string | `Text(count)` |
| Property wrapper on a `let` | `@State private let count = 0` |
| Assignment to a `let` | `let total = 0; total = 1` |
| Non-`mutating` method writing a property | `func bump() { count += 1 }` |
| `ForEach` without identity | `ForEach(items)` where the element is not `Identifiable` |
| Omitted argument labels | `greet("Ada")` for `func greet(name:)` |
| Missing `return` | a multi-statement `func` body with a return type and no `return` |
