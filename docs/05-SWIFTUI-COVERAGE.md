# 05 - SwiftUI coverage matrix

The public contract for what renders. Updated in the same PR as any runtime change.

Status: ✅ done · 🟡 partial (limitations noted) · ⬜ planned, phase given · ✗ declined (reason given)

Last updated after the honesty pass (defect register phases 1-3), which changed what several
rows claim rather than what they draw. The headline counts are deliberately not restated here
until the full reconciliation: a total that is one pass out of date is worse than none.

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
| `GeometryReader` | ✅ | 7 | reports its real size, and is its own coordinate space |
| `LazyVStack` / `LazyHStack` | 🟡 | 6 | laid out as stacks - correct, but not virtualised |
| `LazyVGrid` / `LazyHGrid` | ✅ | 6 | fixed, flexible and adaptive columns |
| `Grid` / `GridRow` | ✅ | 7 | columns align across rows |
| `ViewThatFits` | ✅ | 7 | |
| `AnyView` | ✅ | 7 | erasure is a compile-time concern; at runtime it is its content |
| `Layout` protocol (custom layouts) | ⬜ | - | our engine already speaks this protocol |
| `AnyLayout` | ⬜ | - | |

## Content views

| View | Status | Phase | Notes |
| --- | --- | --- | --- |
| `Text` | 🟡 | 3 | interpolation, and `format:` number styles (`.number`, `.percent`, `.currency(code:)`). **`Text + Text` concatenation is not implemented**, and `Date` does not exist at runtime, so `Text(date, style:)` traps |
| `Label` | ✅ | 6 | icon then title |
| `Image(systemName:)` | 🟡 | 6 | ~80 names drawn as shapes, the rest Unicode substitutes (R2) - see approximations |
| `Image("asset")` | ⬜ | - | reported as unavailable rather than drawn as a grey box |
| `GroupBox` `LabeledContent` `ControlGroup` `ScrollViewReader` | ⬜ | - | recognised and drawn as a labelled placeholder, not reported as an unknown name |
| `AsyncImage` | 🟡 | 7 | draws its `placeholder:`; there is no network in the worker |
| `Link` / `ShareLink` | ✅ | 6 | drawn tinted; does not open a URL or a share sheet |
| `ProgressView` | 🟡 | 6 | determinate bar; the indeterminate form is a static ring |
| `Gauge` | 🟡 | 7 | drawn as a labelled bar, whatever the gauge style |
| `Canvas` | ✅ | 7 | `fill` and `stroke`; drawings become the same vector nodes a `Path` does |
| `TimelineView` | ⬜ | - | needs a clock the preview does not run |
| `Chart` (Swift Charts) | ⬜ | - | bar, line, point only |
| `Map` (MapKit) | ✗ | - | Needs a licensed tile source; placeholder with a note |
| `UIViewRepresentable` | ✗ | - | Cannot run UIKit; labelled placeholder |

## Controls

| View | Status | Phase |
| --- | --- | --- |
| `Button` | ✅ | 3 |
| `Toggle` | ✅ | 6 |
| `Slider` | ✅ | 6 |
| `Stepper` | 🟡 | 6 | drawn and laid out; the two halves are not separately tappable yet |
| `TextField` / `SecureField` | 🟡 | 6 | a real input with a caret; `SecureField` does not mask yet |
| `TextEditor` | 🟡 | 7 | a single-line field; no multi-line editing |
| `Picker` | 🟡 | 6 | drawn in the menu style, showing its selection; not yet openable |
| `DatePicker` / `ColorPicker` | 🟡 | 7 | drawn as a labelled row; not yet openable |
| `Menu` | 🟡 | 7 | drawn as its label; not yet openable |

## Collections and navigation

| View | Status | Phase | Notes |
| --- | --- | --- | --- |
| `List` | 🟡 | 6 | plain and the grouped styles; no sidebar style |
| `Section` | 🟡 | 6 | header; footers are not drawn yet |
| `Form` | ✅ | 6 | the grouped-list form |
| `.onDelete` | ✅ | 7 | swipe a row to reveal it; `remove(atOffsets:)` included |
| `.onMove` | 🟡 | 7 | `move(fromOffsets:toOffset:)` works; there is no drag-to-reorder UI |
| `.swipeActions` | 🟡 | 7 | recognised; the revealed action is the standard Delete |
| `.searchable` | ✅ | 7 | a field above the content, writing its binding |
| `.refreshable` | ⬜ | - | pull-to-refresh has no meaning in a static preview |
| `DisclosureGroup` | 🟡 | 7 | label and content; the chevron does not collapse it |
| `Table` / `OutlineGroup` | ⬜ | - | |
| `NavigationStack` + `NavigationLink` | ✅ | 6 | both the `destination:` and `value:` forms |
| `.navigationDestination` | ✅ | 6 | `for:` with a metatype, resolved on push |
| `.navigationTitle` | ✅ | 6 | large and inline, with `navigationBarTitleDisplayMode` |
| `.toolbar` | 🟡 | 6 | bar buttons, leading and trailing; no `ToolbarItemGroup` placements |
| `TabView` | 🟡 | 6 | tab bar with `.tabItem`, bound or unbound selection; no page style |
| `NavigationSplitView` | ⬜ | - | iPad only |
| Back gesture | ✗ | - | the preview offers the back *button*; an edge swipe has no analogue here |

## Presentation

| Modifier | Status | Phase |
| --- | --- | --- |
| `.sheet` (+ `presentationDetents`) | ✅ | 6 |
| `.fullScreenCover` | ✅ | 6 |
| `.alert` | 🟡 | 6 | title, message and buttons; no text-field alerts |
| `.confirmationDialog` | 🟡 | 6 | anchored to the bottom edge |
| `.popover` | ⬜ | - |
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
| `.safeAreaInset` | ⬜ | - | |
| `.alignmentGuide` | ⬜ | - | |
| `.containerRelativeFrame` | ⬜ | - | |

## Modifiers - appearance

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
| `.blur` / `.saturation` / `.brightness` / `.contrast` / `.grayscale` | ✅ | 7 |
| `.mask` | ⬜ | - |
| `.tint` / `.accentColor` | ✅ | 6 |
| `.buttonStyle` | 🟡 | 6 | `.bordered` and `.borderedProminent`; others fall back to plain |
| `.toggleStyle` / `.pickerStyle` / `.labelStyle` | 🟡 | 7 | recognised; every style draws the same |
| `.listStyle` / `.textFieldStyle` | ✅ | 6 |
| `.lineLimit` / `.multilineTextAlignment` / `.textCase` | ✅ | 7 | inherited, so a stack can set them for its text |
| `.monospaced` | ✅ | 7 |
| `.fontDesign` | ✅ | 10 | inherited separately from size, as in SwiftUI |
| `.kerning` / `.minimumScaleFactor` | ⬜ | - | both change *measured* width, so neither is a paint-only change |
| `.symbolRenderingMode` / `.symbolVariant` | ⬜ | - | the substitute glyphs have no multicolour variants |

## Shapes and styles

| Item | Status | Phase |
| --- | --- | --- |
| `Rectangle` `RoundedRectangle` `Circle` `Ellipse` `Capsule` | ✅ | 3 |
| `Path` (custom) | ✅ | 7 | lines, curves, arcs, rects and ellipses, serialised to SVG |
| `.fill` / `.stroke` | ✅ | 7 |
| `.trim` | 🟡 | 7 | exact for arcs - progress rings - approximate elsewhere |
| `.strokeBorder` | ⬜ | - |
| `Color` literals and semantic colours (`.primary`, `.secondary`, `.accentColor`) | ✅ | 3 |
| Dark-mode colour resolution | ✅ | 4 |
| `LinearGradient` | ✅ | 6 | named unit points |
| `RadialGradient` / `AngularGradient` | 🟡 | 6 | accepted and drawn as a linear gradient |
| `Material` (`.ultraThinMaterial` etc.) | ✅ | 7 | a real translucent, blurred panel via `backdrop-filter` |
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
| `.onReceive` | ⬜ | - | needs Combine |
| `.disabled` / `.allowsHitTesting` | ✅ | 7 |
| `.focused` | ⬜ | - |

## Animation

| Feature | Status | Phase | Notes |
| --- | --- | --- | --- |
| `withAnimation` | ✅ | 6 | animates every change in its transaction, for one frame |
| `.animation(_:value:)` | 🟡 | 6 | animates its subtree; the `value:` gate is not honoured |
| Curves: `.linear .easeIn .easeOut .easeInOut` | ✅ | 6 | CSS timing functions |
| `.spring` (and `.bouncy` / `.snappy` / `.smooth`) | 🟡 | 6 | an overshooting bezier, not a real solver |
| `.transition` (`.slide .opacity .scale .move`) | 🟡 | 7 | entry only; exit would need the renderer to outlive the view |
| `matchedGeometryEffect` | ⬜ | - | FLIP across identity change |
| `.phaseAnimator` / `.keyframeAnimator` | ⬜ | - | |
| `Animatable` / `animatableData` | ⬜ | - | |
| Custom `ViewModifier` + `.modifier(…)` | ✅ | 8 | `body(content:)` is called with the view as a value |
| `extension View { func … }` | ✅ | 8 | the idiom for a reusable modifier chain |
| Custom `ButtonStyle` | ✅ | 9 | applies to every button below it, not only the one it is written on |
| Custom `ToggleStyle` / `LabelStyle` | ⬜ | - | the same mechanism, but a Toggle's configuration carries a *binding* |

## Environment and app structure

| Feature | Status | Phase |
| --- | --- | --- |
| `App` / `@main` / `WindowGroup` | ✅ | 3 |
| `Scene` phases | ⬜ | - |
| `@State` | ✅ | 3 |
| `@Binding` (and `$value` projections) | ✅ | 6 | passes down any number of views |
| Key paths (`\.self`, `\.id`) | 🟡 | 6 | applied where a view takes one (`ForEach(id:)`); **not where a closure is expected**, so `map(\.name)` is rejected |
| `@StateObject` / `@ObservedObject` / `ObservableObject` / `@Published` | ✅ | 7 | a class is a reference, so a change is seen everywhere |
| `.environmentObject` / `@EnvironmentObject` | 🟡 | 7 | reaches views expanded while the modifier is in scope - see below |
| `.environment(\.key, …)` | 🟡 | 7 | same scoping rule |
| `colorScheme`, `dynamicTypeSize` | ✅ | 4 |
| `locale`, `layoutDirection` | 🟡 | 7 | reported; there is no RTL layout or localisation yet |
| `horizontalSizeClass` / `verticalSizeClass` | ✅ | 7 | derived from the device size |
| `dismiss` | ✅ | 7 |
| `openURL` | ⬜ | - |
| `PreferenceKey` | ⬜ | - | needs a value to travel *up* the tree |
| `#Preview` macro | ✅ | 10 | parsed, and used as the root when nothing is `@main` |
| `PreviewProvider` (the older form) | ⬜ | - | |

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
| Key paths (`\.self`, `\.id`, `\Type.member`) | 🟡 | 6 | applied where a view takes one (`ForEach(id:)`); **not where a closure is expected**, so `map(\.name)` is rejected |
| `as?` / `as!` / `is` | ✅ | - | compares the runtime type, the declared superclass chain and protocol conformances; generics are erased, so `[Item]` and `[String]` are both `Array` |
| Closures, trailing closures, `$0` | ✅ | 1 | |
| Contextual member syntax (`.home` for an enum) | ✅ | 7 | resolved where a declaration states the type |
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
12. **Renaming is scoped, which means it can rename too little.** A local is renamed within
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
