# 18 - Design flexibility audit (October 2026)

What a designer cannot do in the studio that pure SwiftUI or Figma lets them do, and why. Written from four audits run against `study/ui-design-system` (0cf5765) on 2026-10-14:

1. **Preview rendering:** 238 small apps compiled through the runtime, plus three pasted into the studio and captured.
2. **Design panel coverage:** every control and catalog entry probed through `buildAuthoringModel`, each writer's Swift output recorded, and the 26 shipped templates scanned (870 views, 788 modifiers).
3. **Code to Design round trip:** 43 constructs real and AI-written SwiftUI uses, run through `compile`, `buildAuthoringModel`, `sourceLayerRows` and `planDesignEdit`, and 4 pasted into the studio.
4. **Hands on:** 12 common iOS screens built with Design only, as a Figma user would, each blocker compared with Figma.

Every finding below was reproduced, not taken from older docs. Docs 05 and 15 are stale in both directions; see [Stale documentation](#stale-documentation).

## The short version

The rendering engine is well ahead of authoring. Code with toolbars, `searchable`, section footers, medium-detent sheets and `ContentUnavailableView` renders correctly, but Design cannot create any of them. Where the source uses the literal forms the panel knows, the panel is deep: stacks and grids beat Figma's auto layout, text detail is broad, tokens and real behaviour go beyond Figma prototyping. Everywhere else it is thin, and in a few places it is wrong.

The gaps fall into three kinds, which map onto the two concerns this audit was asked about:

| Kind | What it means | Concern |
| --- | --- | --- |
| **Can't draw** | The preview omits, approximates or blanks real SwiftUI. | 2 |
| **Can't set** | The preview draws it, but the panel has no control, or the control is partial. | 1 and 2 |
| **Can't reach** | The way people actually write it in code (helpers, labels, interpolated text, model state, common spellings) makes that part of the app invisible or read-only in Design. | 2 |

About 60% of the 12 common screens could be built in Design through workarounds a Figma user would not find; the rest needed Code. The four things that would move Design furthest are not new modifiers: sizing and alignment that behave like Figma's, direct manipulation on the canvas, layering and overlap, and conditional visibility with animation.

## Fix first: wrong output, broken Swift, blank screens

These break trust: the studio says "Design updated." and is wrong, or one ordinary line blanks a screen.

**Design writes Swift that does not build, or does the opposite of what the panel says**

| # | Problem | Evidence |
| --- | --- | --- |
| 1 | "Padding amount" next to a token or constant writes `.padding(Layout.padding, 30)` or `.padding(.space16, 24)`. Xcode rejects both; the planner accepts them because it does not type-check padding arguments. Hits the studio's own Save as token output. | `design-advanced-controls.ts:85-93` treats any member access as an edge set |
| 2 | A border on a Circle, Capsule or RoundedRectangle is drawn as a square overlay. | `authoring-border.ts:62`: `cornersOf` reads modifiers, not the shape |
| 3 | Width Fill on a styled Button writes the frame outside the style, so the button stays small while the panel says Fill. Equal-width button pairs fail silently. | frame lands after `Button {}` |
| 4 | A material background reads as "Solid"; choosing Solid does nothing; choosing Gradient replaces the material. | card summary |
| 5 | 8-digit hex (`#FFFFFF80`) is accepted with "Design updated." and the alpha is dropped. | `TokenField.tsx:107` |
| 6 | Duplicating a Picker option copies its tag, so two options share `.tag(1)`. | hands-on T4 |
| 7 | After Max width 260, the Size card also shows Max height 260 and the width select disappears. | hands-on T6 |
| 8 | A sheet's Title writes `.navigationTitle` on a sheet with no NavigationStack, so it never shows. | hands-on T8 |
| 9 | "Appear animation" is offered on views that are never inserted or removed, where it never plays. | hands-on T9 |
| 10 | `aspectRatio(.fit)` is read as Stretch, and choosing Fit then duplicates the scaling. Unknown SF Symbol names are accepted. | panel probes |

**The preview is silently wrong (no diagnostic)**

| # | Problem | Evidence |
| --- | --- | --- |
| 11 | `Color(hex:)`, or any project `extension Color { init(...) }`, is never called: the colour draws clear. | probe color-init-called |
| 12 | Gradient strokes (`.stroke(LinearGradient)`, `.strokeBorder(gradient)`, `.red.gradient`) draw solid black; so do `.foregroundStyle(.linearGradient(...))`, `Color.mix` and Canvas `.color` fills. | `to-layout.ts:1622-1625` |
| 13 | `.font(.custom(...))` keeps the size and draws the system face; `relativeTo:` is ignored. | `swiftui-host.ts:1559-1567` |
| 14 | Custom `ToggleStyle` and `LabelStyle` are ignored; a `Label { } icon: { }` icon is dropped; ProgressView and Slider labels are dropped; `.badge("New")` shows literal quotes. | probes |
| 15 | `.scrollTransition`, `.gridColumnAlignment`, `.toolbar(.hidden, for:)`, `pinnedViews`, `asymmetric` transitions and custom `Layout` do nothing, with no warning. | probes |

**One line blanks a screen, a file or all of Design**

| # | Problem | Evidence |
| --- | --- | --- |
| 16 | These trap and replace the screen with a "stopped" box: `.dateTime.weekday()`, `.hour().minute()`, `.font(.body.width(...))`, `.leading(...)`, `.smallCaps()`, `.background(.background.secondary)`, `.fill(.blue.shadow(.inner(...)))`, `Glass.regular.tint(...)`. | probes date-formats, hier-shapestyles, glass-tint |
| 17 | `#if DEBUG` inside a view is a parse error: the preview is blank and every edit in that file is refused. | round trip 40 |
| 18 | One unresolved name in an unrelated file draws nothing for the whole app and strips component, collection and token settings everywhere. | `authoring-features.ts:21` |
| 19 | A generic container (`Card(title:) { ... }` with `@ViewBuilder var content`, or stored `Content` with two or more children) draws empty. | round trip 50, 61 |
| 20 | A Chart, Map or PhotosPicker is locked, so even its own `.frame` cannot be changed, with the misleading reason "Resolve source diagnostics". | round trip 90 |

## Concern 1: designers lack the flexibility of code or Figma

Ranked by how often a designer hits each one. "Figma" says what the same task is there.

| # | Gap | Figma equivalent | Evidence |
| --- | --- | --- | --- |
| 1 | **Sizing behaves unlike auto layout.** No alignment inside a Fill or Fixed frame; no "hug up to a max width" (a short chat bubble stretches to 260 pt); min and max cannot be added to a Fixed frame; Fixed starts at 100 instead of the current size. | W/H with Hug, Fill, Fixed, min/max; alignment | `design-advanced-controls.ts:98`; hands-on T1, T6 |
| 2 | **No direct manipulation.** No resize, padding or spacing handles; dragging only reorders; arrow keys do not nudge. | drag handles, nudge | all targets |
| 3 | **No overlap or absolute placement.** No Overlay slot; negative padding refused; an Overlap group has one alignment for every child, so badges need magic offsets. An avatar overlapping a cover took four non-obvious steps. | absolute position inside auto layout | T1, T12 |
| 4 | **Modifier order is the designer's problem.** Padding and Size land before Background, so an outer margin became inner padding until moved down four times. | padding vs. spacing are separate concepts | T5, T6 |
| 5 | **Conditional visibility cannot be set.** "Shown when" is read-only, and nothing wraps a view in `if`, though Screen > States promises it. | variants, interactive components | `AuthoringInspector.tsx:149`; T9 |
| 6 | **No real animation.** Only "Appear animation"; no "animate this change", no property animation, no matched geometry. | Smart Animate | T9 |
| 7 | **Text size is locked to text styles.** A point size is reachable only through a font token; no family, width, or Dynamic-Type-relative size; no inline mixed styles (bold one word). | full type panel, mixed styles | `AuthoringInspector.tsx:64` hides `add:font`; T11 |
| 8 | **Fills are thin.** Colour menu of 25 names; hex without alpha; no opacity slider, eyedropper or swatches; gradients are two named stops with nine fixed points (no stop list, positions or angle); no material, Liquid Glass, image fill or background blur; `.tertiary` and `systemGray*` missing; border colour has no hex or token. | fills panel with stops, alpha, blur | panel, T1, T12 |
| 9 | **Corners and strokes are thin.** One radius only (no per-corner, no Circle or Capsule preset, no continuous toggle); a filled shape cannot also take a stroke and its Fill card cannot be removed; the shape kind cannot change. | independent corners, multiple strokes | panel, T1 |
| 10 | **Components are text only.** Props are strings, numbers, booleans, colours or actions on existing code, but you cannot expose an image or a nested value other than text; "Variants" are saved text presets; no swap, detach or nested overrides. | variant, boolean and instance-swap props | T2 |
| 11 | **System UI cannot be added**: toolbar items, search field, ContentUnavailableView, sheet detents and grabber, alerts and confirmation dialogs, section headers and footers, list row background and insets, swipe actions and context menus. All of these render from code. | n/a (iOS UI kit) | T4, T7, T8 |
| 12 | **Content structures are missing**: a paging carousel with dots, a full-bleed or "extend under status bar" toggle, a List or Form used as the screen itself, wrap in Scroll or List, unwrap. | n/a | T1, T3, T4 |
| 13 | **Controls are partly editable**: Picker options cannot be managed (Add inserts beside the Picker); Button has no role (adding `role:` removes When tapped, `authoring-behavior.ts:118`) and no icon; TextField axis and keyboard are missing; Menu items, Link URLs and ShareLink are not editable. | n/a | panel |
| 14 | **The Add palette is short**: about 20 views the preview draws cannot be inserted (LazyVStack/HStack, Grid, ViewThatFits, SecureField, TextEditor, Menu, DisclosureGroup, Gauge, ContentUnavailableView, ShareLink, AsyncImage, Ellipse, UnevenRoundedRectangle, Path, gradients and Color as views), and about 25 drawn modifiers have no catalog entry (overlay, mask, position, ignoresSafeArea, safeAreaInset, toolbar, alert, presentationDetents, searchable, badge, listRowBackground, contextMenu, animation, transition, trim, stroke). | assets panel, plugins | `viewCatalog.ts:21-63`, `authoring-modifiers.ts:32-105` |
| 15 | **Controls are awkward**: numbers are plain fields (no scrubbing, nudge, units or %); booleans are True/False menus; the `.padding()` card shows two "Padding" rows; Width and Height sizing are in different sections; labels such as "Frame · maxWidth" and "Text color" on a symbol; direction is disabled unless alignment is Center. | consistent fixed panel | panel UX list |

## Concern 2: code that Design cannot represent or edit

Ranked by how common the construct is in real and AI-generated SwiftUI.

| # | Construct | What happens | Fix |
| --- | --- | --- | --- |
| 1 | Computed `some View` properties, `@ViewBuilder` functions, `private extension` subviews | No node at all: an AI-written profile screen maps 8 of 21 drawn views to source; a canvas click selects the whole Scroll. The model only walks `body`. | Walk helper bodies; show each as a named group in Layers, editable in place. |
| 2 | Data-bound and interpolated text (`Text(item.title)`, `"\(n) items"`, `Text(price, format:)`) | Every row is labelled "Text"; no text field. | Label rows with the drawn value; edit the literal parts, with values as chips. |
| 3 | Apple modifiers the preview does not apply (`.swipeActions`, `.refreshable`, `.contentShape`, `.glassEffect`, `.symbolRenderingMode`, `.matchedGeometryEffect`, `.toolbar`, `.environmentObject`) | Card says "A custom modifier from your code"; **the whole Add modifier list locks** ("until its return type is known") and the quick fields disappear. 27 template views are affected. | Treat known Apple modifiers as `some View`; label them "Not drawn in the preview"; keep the catalog open. |
| 4 | Common spellings: `.font(.title2.bold())`, `.font(.headline.weight(.semibold))`, `.clipShape(Capsule())`, `Color("Asset")`, `.blue.gradient`, `.shadow(color:radius:y:)`, `.overlay(RoundedRectangle().stroke())`, `.background(.ultraThinMaterial, in: ...)` | No fields; some cannot even be removed; quick-add disappears; the only route is a second stacked modifier. | Parse these into the existing Typography, Weight, Shadow, Border and Shape controls. |
| 5 | Loading, empty and error states on a view model (`if model.isLoading`, `if items.isEmpty`) | Only the current branch draws; States only accept `@State` scalars and enums. | Offer states for Bool, optional and emptiness on models and computed properties. |
| 6 | Style helpers and custom styles (`.cardStyle()`, `.modifier(CardStyle(padding:))`, custom `ButtonStyle`) | Catalog locked; helper parameters read-only; `.buttonStyle(.primary)` has no field and the preview ignores it. | A "Style" card that edits the helper's definition and exposes its parameters; project styles in the style pickers. |
| 7 | Generic containers (`Card { ... }`) | Draws empty (above); content at the call site has no node. | Fix the runtime; walk the trailing closure as a Content slot. |
| 8 | Label closures (`Toggle(isOn:) { Text }`, `Menu {} label: {}`, `Label {} icon: {}`, `LabeledContent {}`) | Label views have no node. | Add label slots to the content walk. |
| 9 | `.sheet(item:)`, `navigationDestination(isPresented:)`, `NavigationStack(path:)`, `.alert`, `.confirmationDialog` | Not drawn as screens. | Draw `sheet(item:)` with a sample item; present alerts and dialogs as editable screens. |
| 10 | Instance constants and Font tokens (`VStack(spacing: rowSpacing)`, `.font(.heading)`) | No field ("controlled by Swift"). | Show name and value, with Edit at declaration and Detach. |
| 11 | Ternaries in numeric arguments (`.padding(sel ? 16 : 8)`) | No field; colour and symbol ternaries already get If true / If false. | Extend those fields to every numeric modifier. |
| 12 | `Text("A") + Text("B")` | No Layers row. | Show as a group of runs. |
| 13 | `#if DEBUG`, an error in another file | Blank preview, frozen file or frozen Design (above). | Parse `#if` in builders; scope errors to their file; keep the last good drawing. |
| 14 | Multiple `#Preview` blocks | None drawn with `@main`; otherwise only the first. | Each `#Preview` as a canvas frame or state. |

**These already round-trip well:** `@Observable` with `@Environment`, `ObservableObject`, ForEach and List over Identifiable data (one row design), `if`/`switch` on `@State` with Shown when, `.overlay {}` and `.background {}` builders, `sheet(isPresented:)`, `fullScreenCover`, `navigationDestination(for:)`, `extension Color` and `CGFloat` tokens, multiple files, `@Bindable`, `ViewThatFits`, `safeAreaInset`, and custom subviews with literal parameters.

**Edits that write surprising Swift:** quick-add font size writes `.font(.system(size:))`, which ignores Dynamic Type; colours are written as `Color.red` even beside `.secondary` and inside ternaries; Padding edges "all" writes `.padding(.all, 16)`; modifiers are glued after a closing brace (`}.opacity(1)`, which styles every row of a List); Wrap writes a fixed `spacing: 16`; adding Padding next to one the panel cannot edit stacks a second `.padding`; Extract component refuses a view that reads a screen `let`; helper references can be deleted but not selected, leaving dead code.

## What the preview cannot draw (top 20 by designer impact)

| # | Gap | Status |
| --- | --- | --- |
| 1 | **SF Symbols:** 243 names mapped to look-alikes; 84 of 241 common names (35%) draw "?", including person.crop.circle, ellipsis.circle, message, phone, mic, mappin, chevron.forward, arrow.up.circle.fill. Rendering modes (multicolor, hierarchical, palette), variants, effects and variable values are ignored. | Placeholder / Ignored |
| 2 | **Liquid Glass:** `.glassEffect()` ignored, `.glassEffect(.regular.tint())` traps, `GlassEffectContainer` placeholder; `.buttonStyle(.glass)` and bar glass approximated. | Ignored / Missing |
| 3 | `Color(hex:)` and Color extension initialisers draw clear (above). | Missing, silent |
| 4 | **Custom fonts** fall back to the system face; there is no way to add a font file. `.fontDesign(.rounded)` only resolves in Safari. | Ignored |
| 5 | **Views beside a NavigationStack or TabView** (floating buttons, mini players) are dropped; a page-style TabView carousel inside a screen takes the whole screen and drops its siblings and frame (`pipeline.ts:509`). | Missing / Approximate |
| 6 | Gradient strokes draw black (above). | Approximate, silent |
| 7 | **Markdown** in text literals shows raw asterisks; `AttributedString` is a blocking error. | Missing |
| 8 | Toolbar `.bottomBar` and `.principal` placements are omitted. | Missing |
| 9 | Swift Charts draw a labelled box. | Placeholder |
| 10 | `Text(Image(...))` concatenation draws nothing for the image; `"\(Image(...))"` draws "View". | Missing |
| 11 | Ordinary style chains that trap (above). | Missing, traps |
| 12 | DatePicker `.graphical` and `.wheel` styles are not drawn; the default DatePicker is a text row; ColorPicker has no swatch. | Ignored / Approximate |
| 13 | Symbol styling (rendering modes, variants, effects). | Ignored |
| 14 | Custom Toggle and Label styles, Label icon closures. | Ignored, silent |
| 15 | Shape and text masks are ignored (gradient text via overlay plus mask shows a rectangle); `.zIndex` is ignored. | Ignored |
| 16 | Motion: `matchedGeometryEffect`, `phaseAnimator`, `keyframeAnimator`, `contentTransition(.numericText())`, `scrollTransition`; `repeatForever` plays once. | Ignored |
| 17 | Carousel scrolling: `scrollTargetBehavior(.paging / .viewAligned)`, `contentMargins`, `safeAreaPadding`. | Ignored |
| 18 | Control details: ProgressView and Slider labels dropped; `TextField(axis: .vertical)` single line; `TextField(value:format:)` empty; `.labelsHidden()` unknown. | Mixed |
| 19 | MeshGradient placeholder; `AsyncImage(url:)` without a placeholder draws nothing; assets accept PNG and JPEG only (no SVG or PDF). | Mixed |
| 20 | iOS 26/27 chrome: `Tab(role: .search)` drawn as an ordinary tab; `ToolbarSpacer` placeholder; `tabViewBottomAccessory`, `navigationSubtitle`, `toolbarColorScheme` ignored. | Mixed |

Also: `.swipeActions` ignored; `EditButton` and `PhotosPicker` placeholders; ContentUnavailableView's closure form draws the stock "No Results"; right-to-left layout ignored; `.popover` always a full sheet; `Map` placeholder; `_x = State(initialValue:)` is a blocking error; `.preferredColorScheme` ignored.

**Strong today, verified:** text styles and sizes, weight, italic, serif and mono, line limits, truncation, minimum scale, line spacing, kerning, case; stacks, Spacer, frames with min, ideal and max, alignment, padding forms, overlay and background alignment, fixedSize, layoutPriority, alignment guides, Grid, lazy grids, ViewThatFits, GeometryReader, containerRelativeFrame, safeAreaInset, per-edge ignoresSafeArea; shapes with continuous corners, dashed strokes, trim, custom Shape and Path, linear, radial and conic gradients, semantic colours in light and dark; shadows, blur, colour filters, 2D and 3D transforms, clipping, 16 blend modes, gradient masks; button styles, roles, tint, sizes and shapes, custom ButtonStyle, Toggle, Slider, Stepper, menu, segmented and inline pickers, text fields, Gauge, LabeledContent; list styles, headers and footers, onDelete, badges, DisclosureGroup, GroupBox; large and inline titles, toolbar capsules, searchable, the floating tab bar, sheets with detents, height, indicator, radius and background, fullScreenCover, alerts with fields, confirmationDialog, inspector; PNG and JPEG assets; withAnimation and the opacity, slide, scale and move transitions.

## Roadmap

Ordered so each wave makes Design trustworthy before making it bigger. Each item is one vertical slice: renderer, semantic writer and reader, panel control, unit tests, e2e, and the native type-check form the authoring contract requires (`docs/authoring/README.md`, Extending a capability).

**Wave 1: Trust (one PR).** Fixes 1 to 20 above. Design never writes Swift that does not build, the panel and canvas never disagree, nothing is silently transparent or black, and no ordinary line blanks a screen or the whole of Design. Adds a type check on padding, border and frame arguments in the planner so this class of bug is caught for every writer.

**Wave 2: Figma basics (two or three PRs).**
- Layout: Hug, Fill and Fixed with min and max and an alignment on every frame; "hug up to"; Padding (inside) and Margin (outside) as separate controls that put the modifier in the right place, so order stops being the designer's problem; Fill on a Button widens the button.
- Direct manipulation: resize, padding and spacing handles; arrow-key nudge; drag to offset inside an Overlap; pin a child to a corner.
- Fills and colour: one colour control everywhere (hex with alpha, opacity %, tokens, system colours, eyedropper); a gradient editor (type, stops, positions, angle); material and Liquid Glass as fill types; background blur.
- Corners and strokes: per-corner radius, Circle and Capsule presets, continuous toggle; stroke on any shape alongside its fill; change shape kind.
- Typography: one Text panel with style, size (Dynamic-Type relative), weight, width, design, tracking and line height; restore the hidden quick fields.
- Controls: scrubbable numbers with units and %, toggles for booleans, clearer labels.

**Wave 3: Reach into real code (two PRs).** Helper views as named groups; label slots; interpolated and concatenated text; known Apple modifiers that no longer lock the catalog; the common spellings in concern 2 parsed into existing controls; constants and Font tokens shown with Detach; numeric ternaries; view-model states; alerts, dialogs and `sheet(item:)` as screens; multiple `#Preview`; errors scoped to their file.

**Wave 4: System UI in Design (two or three PRs).** Toolbar items (leading, trailing, principal, bottom bar); search field and ContentUnavailableView; sheet settings (detents, grabber, background, radius) with sheets drawn as sheets on the canvas; alerts and confirmation dialogs plus a Show alert action; Picker options; Button role and icon; section headers and footers; list row background, insets and separators; swipe actions and context menus, rendered by the preview; a paging carousel with page dots; full-bleed and List-as-screen; the missing Add palette views and catalog modifiers.

**Wave 5: States, motion and components (two PRs).** Shown when that writes `if`; "Animate this change" on tap actions; per-view transitions; numeric text transitions; matched geometry between states; component props for booleans, images and colours, visual variants, instance swap and detach.

**Wave 6: Rendering fidelity, long tail (ongoing).** SF Symbols coverage toward the most-used 600 names (look-alikes, see below); Liquid Glass and iOS 27 chrome (search tab, ToolbarSpacer, bottom accessory); custom font files in Assets, exported with `UIAppFonts`; Markdown and AttributedString; images in text; toolbar placements; date picker styles; symbol rendering modes; shape and text masks; `zIndex`; views beside NavigationStack and embedded page TabViews; MeshGradient; scroll paging and content margins; basic Charts (BarMark, LineMark, SectorMark); popovers.

## Constraints that shape the roadmap

- **JavaScript budget.** The client budget is 750 KB with 1.1 KB left (748.9 KB). Waves 2 to 5 add panel code; the semantic writers run in the compiler worker, which is also counted. A budget raise, or moving the inspector's heavier editors behind dynamic imports, is needed before Wave 2.
- **SF Symbols licensing.** Apple's symbol artwork cannot be redistributed in the browser (requirement R2), which is why symbols are drawn as look-alikes. More coverage means more look-alike drawings, prioritised by usage; the exported Xcode project always uses the real symbols.
- **Fonts.** The same applies to SF Pro on non-Apple machines. Custom fonts are different: the designer supplies the files, so they can be embedded in the preview and exported.
- **Native evidence.** Every new writer form has to type-check in Xcode 27 and match the iOS 27 simulator (`tests/xcode-build.test.ts`, `AUTHORING_WRITER_FORMS`). This is the slow part of each slice and should be planned, not skipped.
- **Deployment target.** Some fixes have iOS 26 or 27 APIs (`.buttonSizing(.flexible)`, Liquid Glass). Writers must respect the project's deployment target and fall back (for example a label-level frame for a full-width button).

## Stale documentation

Docs 05 and 15 claim these do not work, but they do now: dashed strokes, radial and conic gradients, project images (`Image("asset")`), `List($items)`, ideal frame sizes under `fixedSize`, and exit transitions. Doc 05 also says `.fontDesign(.rounded)` fails only on non-Apple systems; it fails in Chrome on a Mac too. Both docs should be updated alongside Wave 1.

## Evidence

The probe programs, raw outputs and screenshots behind this audit were kept outside the repository. Each claim above names the file and line, or describes the probe (a small app run through `compile`, `buildAuthoringModel` or `planDesignEdit`, as in `apps/web/lib/designTree.test.ts` and `packages/swift-sema/src/authoring-behavior.test.ts`), so it can be reproduced as a unit test when it is fixed.
