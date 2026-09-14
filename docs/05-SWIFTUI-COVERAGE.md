# 05 — SwiftUI coverage matrix

The public contract for what renders. Updated in the same PR as any runtime change.

Status: ✅ done · 🟡 partial (limitations noted) · ⬜ planned, phase given · ✗ declined (reason given)

Last updated after Phase 3. 🟡 entries: `.background` takes colours and views but not materials;
`.font` takes text styles but not `.bold`/`.italic`/custom weights; `.cornerRadius` rounds fills but
does not yet clip arbitrary content.

Anything not listed renders a labelled placeholder box and logs a telemetry event (FR-4.11, NFR-6).
Those telemetry counts are what decide what gets built next.

## Layout

| View | Status | Phase | Notes |
| --- | --- | --- | --- |
| `VStack` / `HStack` / `ZStack` | ✅ | 3 | alignment, spacing |
| `Spacer` | ✅ | 3 | minLength; the canonical test of the layout engine |
| `Divider` | ⬜ | 3 | |
| `Group` | ✅ | 3 | |
| `ForEach` | ⬜ | 3 | ranges, `Identifiable`, `id:` key paths |
| `ScrollView` | ⬜ | 3 | axes, indicators, `ScrollViewReader` in 6 |
| `GeometryReader` | ⬜ | 3 | |
| `LazyVStack` / `LazyHStack` | ⬜ | 6 | real virtualisation |
| `LazyVGrid` / `LazyHGrid` | ⬜ | 6 | fixed, flexible, adaptive columns |
| `Grid` / `GridRow` | ⬜ | 6 | |
| `ViewThatFits` | ⬜ | 6 | |
| `Layout` protocol (custom layouts) | ⬜ | 6 | our engine already speaks this protocol |
| `AnyLayout` | ⬜ | 6 | |

## Content views

| View | Status | Phase | Notes |
| --- | --- | --- | --- |
| `Text` | ✅ | 3 | interpolation, concatenation, `Date`/number formatting in 6 |
| `Label` | ⬜ | 3 | |
| `Image` | ⬜ | 3 | SF Symbol names mapped to an open icon set (R2); asset images in 4 |
| `AsyncImage` | ⬜ | 6 | |
| `Link` | ⬜ | 4 | |
| `ProgressView` | ⬜ | 3 | linear + circular, determinate + indeterminate |
| `Gauge` | ⬜ | 6 | |
| `Canvas` | ⬜ | 6 | 2D context drawing |
| `TimelineView` | ⬜ | 6 | |
| `Chart` (Swift Charts) | ⬜ | 6 | bar, line, point only |
| `Map` (MapKit) | ✗ | — | Needs a licensed tile source; placeholder with a note |
| `UIViewRepresentable` | ✗ | — | Cannot run UIKit; labelled placeholder |

## Controls

| View | Status | Phase |
| --- | --- | --- |
| `Button` | ✅ | 3 |
| `Toggle` | ⬜ | 3 |
| `Slider` | ⬜ | 3 |
| `Stepper` | ⬜ | 3 |
| `TextField` / `SecureField` | ⬜ | 3 |
| `TextEditor` | ⬜ | 4 |
| `Picker` (menu, segmented, wheel, inline) | ⬜ | 4 |
| `DatePicker` | ⬜ | 6 |
| `ColorPicker` | ⬜ | 6 |
| `Menu` | ⬜ | 6 |
| `ShareLink` | ⬜ | 6 |

## Collections and navigation

| View | Status | Phase | Notes |
| --- | --- | --- | --- |
| `List` | ⬜ | 6 | plain, inset, grouped, sidebar styles |
| `Section` | ⬜ | 6 | header, footer |
| `Form` | ⬜ | 6 | |
| `.onDelete` / `.onMove` / swipe actions | ⬜ | 6 | |
| `.refreshable` / `.searchable` | ⬜ | 6 | |
| `NavigationStack` + `NavigationLink` | ⬜ | 6 | value-based and destination-based |
| `.navigationDestination` | ⬜ | 6 | |
| `.navigationTitle` / `.toolbar` | ⬜ | 6 | |
| `TabView` | ⬜ | 6 | tab bar + page style |
| `NavigationSplitView` | ⬜ | 6 | iPad only |

## Presentation

| Modifier | Status | Phase |
| --- | --- | --- |
| `.sheet` (+ `presentationDetents`) | ⬜ | 6 |
| `.fullScreenCover` | ⬜ | 6 |
| `.alert` | ⬜ | 6 |
| `.confirmationDialog` | ⬜ | 6 |
| `.popover` | ⬜ | 6 |

## Modifiers — layout and sizing

| Modifier | Status | Phase | Notes |
| --- | --- | --- | --- |
| `.frame(width:height:alignment:)` | ✅ | 3 | |
| `.frame(minWidth:idealWidth:maxWidth:...)` | ✅ | 3 | the flexible form; `.infinity` handling |
| `.padding` | ✅ | 3 | all edge-set forms |
| `.fixedSize` | ⬜ | 3 | |
| `.layoutPriority` | ⬜ | 3 | |
| `.offset` / `.position` | ⬜ | 3 | |
| `.aspectRatio` / `.scaledToFit` / `.scaledToFill` | ⬜ | 3 | |
| `.safeAreaInset` / `.ignoresSafeArea` | ⬜ | 6 | |
| `.alignmentGuide` | ⬜ | 6 | |
| `.containerRelativeFrame` | ⬜ | 6 | |

## Modifiers — appearance

| Modifier | Status | Phase |
| --- | --- | --- |
| `.foregroundStyle` / `.foregroundColor` | ✅ | 3 |
| `.background` (colour, shape, view, material) | 🟡 | 3 |
| `.overlay` | ⬜ | 3 |
| `.font` / `.bold` / `.italic` / `.fontWeight` / `.fontDesign` | 🟡 | 3 |
| `.opacity` | ✅ | 3 |
| `.cornerRadius` / `.clipShape` / `.clipped` | 🟡 | 3 |
| `.shadow` | ⬜ | 3 |
| `.border` | ⬜ | 3 |
| `.rotationEffect` / `.scaleEffect` | ⬜ | 3 |
| `.blur` / `.saturation` / `.brightness` / `.contrast` | ⬜ | 6 |
| `.mask` | ⬜ | 6 |
| `.tint` / `.accentColor` | ⬜ | 4 |
| `.buttonStyle` / `.toggleStyle` / `.listStyle` / `.textFieldStyle` | ⬜ | 4/6 |
| `.symbolRenderingMode` / `.symbolVariant` | 🟡 | 6 | approximated — the open icon set has no multicolour variants |

## Shapes and styles

| Item | Status | Phase |
| --- | --- | --- |
| `Rectangle` `RoundedRectangle` `Circle` `Ellipse` `Capsule` | ✅ | 3 |
| `Path` (custom) | ⬜ | 6 |
| `.fill` / `.stroke` / `.strokeBorder` / `trim` | ⬜ | 3/6 |
| `Color` literals and semantic colours (`.primary`, `.secondary`, `.accentColor`) | ✅ | 3 |
| Dark-mode colour resolution | ⬜ | 3 |
| `LinearGradient` / `RadialGradient` / `AngularGradient` | ⬜ | 3 |
| `Material` (`.ultraThinMaterial` etc.) | 🟡 | 6 | CSS `backdrop-filter` approximation |
| `ShapeStyle` conformances generally | ⬜ | 6 |

## Interaction and lifecycle

| Modifier | Status | Phase |
| --- | --- | --- |
| `.onTapGesture` | ⬜ | 3 |
| `.onLongPressGesture` | ⬜ | 6 |
| `DragGesture` / `MagnificationGesture` / `RotationGesture` | ⬜ | 6 |
| `.simultaneousGesture` / `.sequenced` / `.exclusively` | ⬜ | 6 |
| `.onAppear` / `.onDisappear` | ⬜ | 3 |
| `.task` | ⬜ | 4 |
| `.onChange(of:)` | ⬜ | 4 |
| `.onReceive` | ⬜ | 6 |
| `.disabled` / `.allowsHitTesting` | ⬜ | 3 |
| `.focused` | ⬜ | 6 |

## Animation

| Feature | Status | Phase | Notes |
| --- | --- | --- | --- |
| `withAnimation` | ⬜ | 6 | |
| `.animation(_:value:)` | ⬜ | 6 | |
| Curves: `.linear .easeIn .easeOut .easeInOut .spring` | ⬜ | 6 | mapped to WAAPI easings / spring solver |
| `.transition` (`.slide .opacity .scale .move`) | ⬜ | 6 | |
| `matchedGeometryEffect` | ⬜ | 6 | FLIP across identity change |
| `.phaseAnimator` / `.keyframeAnimator` | ⬜ | 6 | |
| `Animatable` / `animatableData` | ⬜ | 6 | |

## Environment and app structure

| Feature | Status | Phase |
| --- | --- | --- |
| `App` / `@main` / `WindowGroup` | ✅ | 3 |
| `Scene` phases | ⬜ | 6 |
| `.environment` / `.environmentObject` | ⬜ | 4 |
| `colorScheme`, `dynamicTypeSize`, `locale`, `layoutDirection` | ⬜ | 4 |
| `horizontalSizeClass` / `verticalSizeClass` | ⬜ | 6 |
| `dismiss`, `openURL` | ⬜ | 6 |
| `PreferenceKey` | ⬜ | 6 |
| `#Preview` macro / `PreviewProvider` | ⬜ | 4 |

## Accessibility

| Modifier | Status | Phase | Notes |
| --- | --- | --- | --- |
| `.accessibilityLabel` / `Hint` / `Value` | ⬜ | 4 | mapped to ARIA on the rendered nodes |
| `.accessibilityHidden` / `.accessibilityElement` | ⬜ | 4 | |
| `.accessibilityAddTraits` | ⬜ | 6 | |

## Known approximations

Listed in the exported README so nothing is a surprise on the Mac:

1. **Fonts** — an open metric-compatible stack stands in for SF Pro. Line breaking is very close but
   not identical to CoreText.
2. **SF Symbols** — names map to an open icon set. Glyph shapes differ; multicolour and hierarchical
   rendering modes are approximated.
3. **Materials and blur** — CSS `backdrop-filter`, not Apple's exact blur.
4. **Scrolling physics** — native browser scrolling, not iOS rubber-band deceleration.
5. **Performance** — the interpreter is far slower than compiled Swift; do not judge frame rates.
