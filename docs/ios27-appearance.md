# iOS 27 appearance: phases 1–9

The preview now targets an `ios-27` runtime, SDK, and appearance profile. This is
an approximation profile, not a native iOS runtime or a claim of pixel parity.
The light/default-text phone defaults now use the six supplied native screenshots.
Other devices, text sizes, and appearances still need native acceptance.
Materials intentionally use different blur strengths and opacities.

## Phase 1: one place for defaults

- `packages/shared/src/appearance.ts` defines the preview target. Existing saved
  projects and old share links migrate to it; new projects and share links store it.
- `packages/swiftui-runtime/src/appearance/ios27.ts` holds the initial semantic
  light/dark colors, text styles, spacing, button geometry, switch sizes, and blur levels.
- The compiler receives the target and the preview displays an iOS 27 badge.
  The exported minimum deployment target remains separate.

## Phase 2: make parent styles reach children

- Tint, supported control styles, control size, disabled state, and image scale
  propagate through containers, custom views, toolbars, and presented content.
- Child overrides take precedence. Tint colors controls without recoloring plain
  body text. Destructive buttons use the destructive color.
- `@Environment` values are available when custom view bodies are evaluated;
  sibling views keep separate environments. Local color schemes also affect paint.
- Bordered buttons use capsule defaults; explicit rounded rectangles remain
  available. Glass button styles use simple blur approximations.
- Disabled inputs remain visible and inert. Native browser controls receive the
  preview color scheme so their default surfaces adapt in dark mode.

## Phase 3: consistent Ionicons

- `packages/shared/src/symbol-map.ts` maps exact SF Symbol names to Ionicons or
  explicit geometric fallbacks. The original Swift source keeps its SF Symbol names.
- Filled, crossed-out, enclosed, and directional variants retain their meaning.
  Unmapped symbols display a placeholder and remain visible to coverage reporting.
- Worker measurement and browser rendering share icon dimensions and image scale.
- Ionicons 8.0.13 is pinned. A local SVG sprite avoids a CDN dependency and a large
  JavaScript icon bundle. The license is included with the package and public asset.

After changing icon mappings, run `node tooling/generate-ionicons.mjs` and commit
the generated `apps/web/public/ionicons-8.0.13.svg` alongside the mapping. The sprite
is served from the application root, like the existing root-based app routes.

## Phase 4: text uses measured fonts

- `appearance/typography.ts` defines separate point-size and line-height curves for
  all twelve named Dynamic Type categories. Explicit `.system(size:)` stays fixed.
  The preview picker and supported `.dynamicTypeSize(...)` values use those names.
- Text layout caches shaped strings by font family, size, weight, italic, tracking,
  and number features. It measures kerning and joined glyphs together instead of
  adding individual letter widths. Wrapping preserves grapheme clusters and keeps a word that exactly fits before
  a space, including when placement measures the line again at its intrinsic width.
- Workers use canvas metrics only after their font probe matches the browser's.
  Otherwise, the main thread measures missing runs in batches. CSS-only features
  such as tabular numbers use a hidden DOM span with the same font styling.
- Font readiness and late loading trigger fresh layout without clearing Swift
  state. Revision and font-generation checks reject stale measurements. Refinement
  is bounded to eight passes; unusually large cases can remain partially estimated,
  which the Timings panel reports explicitly.
- Line heights, ascent/descent, mixed-run baselines, tightening, and truncation
  now share measurements with painting. This matches the browser's actual font;
  it does not turn a substitute font into Apple's font on other operating systems.
- A block of text is as tall as its first line's glyphs (1.19336 times the point
  size, rounded up to a third of a point) plus the style's line height for each
  further line, as measured in the iOS 27 simulator: body text is 20.33, 42.33 and
  64.33 pt tall for one, two and three lines. A `.system(size:)` font adds nothing
  between lines. Alert titles and messages, which UIKit draws, keep the full line
  height on every line.

## Phase 5: spacing and alignment

- Omitted stack spacing resolves per adjacent pair, using preferences supplied by
  text, icons, controls, and wrappers. Explicit zero, fractional, and negative gaps
  stay unchanged. The layout engine does not inspect SwiftUI type names.
- Default padding and spacer minimums come from the appearance profile. Automatic
  spacing does not add an extra gap beside a spacer. EmptyView contributes no gap.
- First and last text baseline alignment account for mixed fonts, multiline text,
  padding, frames, and nested stack placement.
- Device display scale reaches layout and Swift environment readers. General dividers
  use one physical pixel; the measured list separators use one logical point and
  overlay the row edge so they do not accumulate extra row height.
- Existing proposal, fixedSize, layoutPriority, and modifier-order tests remain in
  the full regression suite. The spacing values are initial profile estimates and
  still require native calibration.

## Phase 6: shapes and controls

- Shared shape geometry distinguishes circles, capsules, circular corners, and an
  approximate continuous corner. SVG strokes can sit on or inside the boundary;
  `.strokeBorder` also accepts the supported StrokeStyle line width.
- Control metrics live in `appearance/controls.ts`; reusable font and switch
  construction lives in `controls/primitives.ts`. Button styles use per-size fonts
  and padding. Circular buttons have equal width and height and circular edges.
- Switches use the captured 64 × 28-point track with a 38 × 24-point capsule
  thumb, semantic off fill, and inherited tint. Sliders paint their track, fill, thumb, and supported discrete ticks while
  retaining native input range, step, focus, and keyboard behavior.
- Text fields retain native editing/IME and secure entry, with scoped browser
  style resets and font-aware height. Steppers honor range limits. Progress and
  segmented controls use shared metrics and selection colors.
- Enabled buttons and toggles support keyboard activation and focus feedback;
  disabled inputs stay visible and inert. Button press feedback is deliberately
  simple. Material rendering remains blur-based.

## Phase 7: lists and forms

- `containers/list.ts` owns list construction; `appearance/surfaces.ts` holds the
  provisional metrics. Rows have a 52-point minimum, grow with their contents,
  and use shared padding. Inset groups have measured 16-point outer margins and
  approximate continuous 26-point corners. Headers default to 17-point semibold.
- Plain, grouped, inset-grouped, and sidebar layouts have separate surfaces.
  Automatic ordinary lists use the sidebar approximation at regular width;
  forms keep grouped cards, with a maximum readable width.
- Section headers preserve supplied capitalization. Custom header/footer views
  retain their styling. Footer text aligns with row text. Apple's current
  [adoption guidance](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)
  describes title-style section headings, increased row padding, and rounder groups.
- Row insets, solid/gradient row backgrounds, separator visibility/edges, numeric
  row/section spacing, and hidden scroll backgrounds are honored. Navigation rows
  remain fully tappable; editable fields stay inside their content insets.

## Phase 8: composed screens

- Primary scroll content extends beneath floating bars with resting content insets.
  Large titles collapse through DOM scroll state and CSS variables; scrolling does
  not dispatch Swift events or recompile the program. Nested scrollers do not drive
  the outer title. A presented sheet owns its own title-collapse state. System bar
  controls keep compact fonts while page content grows with Dynamic Type. The search
  drawer uses a neutral fill, and disappears with its scrolling content. The collapsed
  navigation background uses simple blur.
- Both ordinary `Tab(...)` and existing `.tabItem` declarations work with selection
  bindings. Phone tabs float near the bottom; regular-width tabs use a narrower top
  surface. Selection uses a neutral rounded background, a tinted filled icon, and the same
  Ionicons adapter. Two phone tabs measure 188 × 62 points.
- Automatic search inside a phone NavigationStack lives below the large title,
  in the primary scroller, matching this native fixture. Regular-width automatic
  search remains a toolbar approximation; an explicit drawer stays in the scroller.
  Search inputs retain a real caret, placeholder, and binding.
- Sheets compose their own navigation, search, tabs, and supported nested overlays.
  Detents are resolved using the actual device height; a selection binding takes
  priority. Corner radius, grabber visibility, and interactive-dismiss disabling
  are read from presented content. Background controls become inert while a modal
  is active. On iPad the sheet is centered and width-limited.
- Alert/dialog actions dismiss their presentation automatically and retain the
  action’s state changes. Alerts use the measured 320-point panel and separated 140 × 48-point action
  pills. Back navigation uses a 44-point icon-only control with its accessible label. Menus anchor beside their opening control,
  accounting for browser scroll and preview zoom, and clamp to the preview bounds.
- Materials remain simple blur. Interactive sheet resizing, keyboard-driven safe
  areas, search-tab roles, tab minimization, full iPad split-view adaptation, sticky
  section headers, and all search placements are not implemented by this work.

## Phase 9: partial native calibration and regression gates

- `tests/fixtures/ios27-screens.swift` is the shared list/detail/settings/sheet fixture.
- `tests/ios27-screens.test.ts` exercises modifiers, navigation, detents, nested
  presentations, and the phone/iPad matrix. `tests/ios27-regression.test.ts` records
  geometry, typography, semantic colors, controls, and materials for eight contexts.
  Its committed snapshots describe the browser implementation, not native truth.
- `e2e/ios27.spec.ts` adds browser interaction gates and PNG review artifacts for the
  same matrix, plus scroll-without-recompile and menu anchoring checks. Existing
  Ubuntu CI runs these with the rest of Playwright; reports upload even on success.
  This session verified representative flows through Computer Use, but did not run
  the entire Playwright runner or an Ubuntu browser.
- `docs/parity/ios27.json` records the matrix and the supplied native evidence.
  `APPEARANCE_CALIBRATION` and the preview badge keep the profile provisional.
  No other iOS version is advertised as a measured alias.
- `tests/ios27-export.test.ts` verifies unchanged Swift source in a generated iOS 27
  Xcode project. `tooling/capture-ios27.mjs` captures an explicitly named, already
  booted iOS 27 simulator and records toolchain, runtime, appearance, PNG dimensions,
  and source/image hashes. See [the capture procedure](parity/README.md).

Run `npm run typecheck`, `npm run lint`, `npm test -- --maxWorkers=4`,
`npm run build`, `npm run budget`, and `npm run e2e` in a browser-capable environment.
Review geometry snapshot changes with `npm test -- tests/ios27-regression.test.ts -u`;
never treat an updated snapshot as proof of native parity.

The complete native acceptance matrix remains unfinished. Six supplied original
1206 × 2622 PNGs, hashes, assumptions, and pixel-derived measurements are in
[the native evidence manifest](parity/native/iphone18pro-light/measurements.json).
`tests/ios27-native.test.ts` checks provenance, measured major bounds, and interaction.
The 402 × 874 reference viewport is available as iPhone 18 Pro; safe areas and 3×
scale are recorded calibration assumptions, not machine-verified device metadata.
Native SDK builds, remaining capture contexts, pixel thresholds, non-Mac font
comparisons, and controlled before/after edit-to-preview latency remain pending.
A release claiming measured parity is gated on those results. Browser compilation
checks and snapshots cannot establish that the same source matches Xcode exactly.

The intended native gates remain: major bounds/baselines within about one point,
matching line counts/truncation, and matching solid semantic colors. Ionicons artwork
and blur interiors are intentional differences; do not mask complete controls or
bars to hide geometry errors. Continuous corners are approximate, and full CoreText
line breaking, Dynamic Type ranges, and custom alignment-guide propagation remain
outside the claimed coverage.

Other relevant Apple references:
[Typography](https://developer.apple.com/design/human-interface-guidelines/typography),
[DynamicTypeSize](https://developer.apple.com/documentation/swiftui/dynamictypesize),
[HStack spacing](https://developer.apple.com/documentation/swiftui/hstack/init(alignment:spacing:content:)),
[ListStyle](https://developer.apple.com/documentation/swiftui/liststyle), and
[presentationCornerRadius](https://developer.apple.com/documentation/swiftui/view/presentationcornerradius(_:)).

## Known visual differences

The profile remains provisional. The medium sheet is about 3 points taller than
the supplied capture; custom inset rows and resulting lower section bounds still
differ by about 2 points. Exact material appearance and icon silhouettes are outside
the measured match. The profile is not pixel-perfect.
