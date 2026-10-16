# iOS 27 comparison procedure

The profile is provisional. The browser snapshots protect against regressions;
six original light/default-text phone images and their measurements now live in
[native/iphone18pro-light](native/iphone18pro-light/measurements.json). This is a
partial reference set, with runtime/text-size/source settings still operator-assumed.

An additional 15 light/dark control and presentation images are in
[native/iphone18pro-controls](native/iphone18pro-controls/measurements.json), paired with
`tests/fixtures/ios27-visual-stress.swift`. See [the measurement report](../17-IOS-CONTROL-PARITY.md).
iPhone is the current priority; the broader iPad/accessibility matrix remains pending.

28 light images in [native/iphone18pro-misrenders](native/iphone18pro-misrenders/measurements.json),
paired with `tests/fixtures/ios27-misrenders.swift`, measure what the study build's preview
fixes rely on: the system and hierarchical colours, where `trim` starts and which way paths
run, which backgrounds reach under the safe area, the navigation and tab bars over them,
where presentations and search written on a NavigationStack or TabView appear, and where
the search field goes with and without a tab bar. Each
screen is launched with `-screen <name>`, so the captures need no tapping. The tests that
use a value cite this set.

18 more in [native/iphone18pro-misrenders-ii](native/iphone18pro-misrenders-ii/measurements.json),
paired with `tests/fixtures/ios27-misrenders-ii.swift`, measure the second set: which
`ForEach` rows a Picker or TabView selects without a `.tag`, which appear hooks run and in
what order, what a GeometryReader reports where it is placed, how links and share links
draw, and where a ScrollView puts a lone child. Those screens also print what they
measure, kept by launching through `simctl launch --console-pty`.

18 more in [native/iphone18pro-system-ui](native/iphone18pro-system-ui/measurements.json),
paired with `tests/fixtures/ios27-system-ui-4a.swift`, measure the system UI Wave 4a draws:
leading and trailing swipe actions with icons, titles or both, a full swipe before and after
it arms, `.onDelete` beside a leading action, an open context menu, where its panel goes
beside a view at the screen's edge or bottom, an action tinted from around its list, and
list rows with a background, insets and a tinted separator. `tooling/capture-ios27.mjs`
takes the fixture as an argument, and its screen names as the states to capture.

16 more in the same folder, paired with `tests/fixtures/ios27-system-ui-4b.swift`, measure
what Wave 4b draws. They cover:
- a `.principal` item in place of an inline title, and above a large one;
- a bottom bar split by a `Spacer`, two items sharing one capsule, and the bar beside a tab
  bar of two tabs and under one of four;
- a search field beside a bottom bar, folded away until the list is pulled down;
- a tab bar hidden from its tab;
- `ContentUnavailableView.search(text:)`, `.search`, and the closure form with actions;
- sheets at the medium detent, at medium and large, at `.height(200)` with a grabber, and
  with their own background and corner radius, each up over the screen that opens it.

Every sheet is up at launch, so only the pulled-down search needed a gesture.
`tests/system-ui-bars.test.ts` cites these.

13 more in the same folder, paired with `tests/fixtures/ios27-system-ui-4c.swift`, measure
what Wave 4c draws. They cover:
- a page-style `TabView` 240 tall between a title and a button, drawn in place with both
  kept, on white pages and on coloured ones;
- its dots shown automatically, always and never, for one page and for several, with the
  second of four selected, and on the capsule `.indexViewStyle(.page(backgroundDisplayMode:
  .always))` gives them;
- a root `TabView` in the page style, whose page fills the safe area under its dots;
- a `ScrollView` with `.scrollTargetBehavior(.paging)`, at rest and after a swipe, with and
  without `.contentMargins(16, for: .scrollContent)`.

The dots are white over any page, so on a white one they can't be seen in iOS either; the
others are white at 0.44, or black at 0.24 on the capsule. A swipe pages by the scroll view's
width; with content margins it moves the content by 378, which the preview doesn't draw.
`tests/system-ui-pager.test.ts` cites these.

36 frames in [native/iphone18pro-motion](native/iphone18pro-motion/measurements.json),
paired with `tests/fixtures/ios27-motion.swift`, measure how Wave 5a moves views. Each screen
changes on its own inside `withAnimation(.linear(duration: 4))`, so a screenshot lands part
way through, and a bar drawn in the same transaction says how far. They cover:
- an `if` with no transition, which fades, while the view below it moves;
- `.move(edge: .top)`, `.push(from: .trailing)`, `.scale`, `.blurReplace`, `.slide`, a move
  combined with `.opacity`, and `asymmetric(insertion: .scale, removal: .opacity)`, each
  coming in and going out;
- a transition with no animation, which doesn't play, and `.animation(_:value:)` on a stack
  holding only the `if`;
- `.contentTransition(.numericText())` and `numericText(value:)` counting up and down, read
  from a screen recording, and a text that changes with `.opacity` or nothing;
- an if/else with and without `matchedGeometryEffect`.

A `curves` screen logs each of Apple's animations frame by frame. `.default`, `.smooth`,
`.spring` and `.interpolatingSpring` are one spring of 0.5 s that doesn't overshoot, `.snappy`
and `.bouncy` bounce 0.15 and 0.3, and the ease curves take 0.35 s. A digit rolls in about half a
second, whatever the change's own timing. `tests/motion-runtime.test.ts` and the render-dom
`motion` and `transition-presence` tests cite these.

8 light images in [native/iphone18pro-text](native/iphone18pro-text/measurements.json),
paired with `tests/fixtures/ios27-text-6a.swift`, measure what Wave 6a draws. Each screen
prints the frames of what it measures, kept by launching through `simctl launch --console-pty`.
They cover:
- Markdown in literal Text, Button and Label titles: `**` is `.bold()`, `*` is `.italic()`,
  `` ` `` is `.monospaced()`, and a link is drawn in the tint, rgb(0, 136, 255), even under a
  `.foregroundStyle`; asterisks that don't flank a word stay;
- a String put into a literal, which keeps its asterisks while the literal around it is read;
- `AttributedString` joined, with its own fonts and colours, and from Markdown;
- an image in text, which adds 22 pt to a body line and 44 to a large title one for a star,
  its ink about centred on the capitals;
- symbol variant chains, composed in SF Symbols' order, and the base where none exists;
- built-in font families by family and PostScript name, and their line heights at 22 pt;
- a gradient masked by text, spread across the gradient's frame, shape and symbol masks,
  a mask placed by alignment, and `zIndex`.

6 more, from the fixture's parser, attributed-more, titles-more and tab screens (built with an
asset catalog holding a 40 x 30 pt "photo"), measure what the Wave 6a fixes draw:
- Apple's parser in Text: bare URLs, emails, `www.` and `<url>` are links, a single `~` strikes,
  entities are read, a link URL keeps balanced parentheses, and a value put into a literal counts
  as punctuation, while Markdown still reads across a Text or an image put in;
- an AttributedString put into a literal, the `.swiftUI` scope, `AttributedString(localized:)`,
  `AttributeContainer` with `mergeAttributes` and `setAttributes`, and each inline presentation intent;
- Markdown in Toggle, Link and NavigationLink titles, `\.symbolVariants` in the environment, a
  gradient across a symbol in text, an asset image in text at its own size, and a mask painted at 30%;
- a TabView's symbols, which stay filled under `.symbolVariant(.none)`.

`tests/text-trust-runtime.test.ts` cites these.

1. Generate a comparison Xcode project from the exact tested Swift source:

   ```sh
   WRITE_IOS27_EXPORT=/tmp/ios27-comparison npm test -- tests/ios27-export.test.ts
   ```

   Open the generated `.xcodeproj`, build using Xcode 27 / SDK 27, and run an iOS 27
   simulator. The fixture export uses deployment target 27.0 for modern Tab APIs;
   ordinary user projects keep their own deployment target. There must be only one
   App declaration. The visual-stress fixture was built and run with Xcode 27.0 (27A266a).

2. Start with iPhone 18 Pro, light appearance, Large/default text to match the supplied
   402 × 874 reference. Capture Library at
   rest and after scrolling, Details, Settings, the Compose sheet, the Details alert,
   and the Options menu. Repeat selected screens in dark mode; use the matrix in
   `ios27.json` for the smaller phone, iPad, and Accessibility 3. Set text size in
   Simulator before capture; the capture command records it as operator-declared.

3. Capture the selected screen without cropping or resizing:

   ```sh
   xcrun simctl list devices booted
   node tooling/capture-ios27.mjs SIMULATOR_UUID library /tmp/ios27-native large
   ```

   Replace `library` with the relevant state. Use `accessibility3` for that size.
   The command neither boots a device nor changes its appearance. It refuses an
   ambiguous device, a non-iOS-27 runtime, or a non-27 SDK. Keep the PNG and JSON
   together. The command cannot verify which app is displayed; visually check that
   it is the current fixture and that its source hash matches the exported source.

4. Open the same Swift fixture in the web app with the same device/appearance/text
   settings. Wait for text measurement to settle. Compare row/card/section bounds,
   title baselines, line counts, search placement, tab geometry, and overlay bounds
   in logical points (native pixels divided by device scale). Check solid colors
   separately from blur. Ionicons deliberately differ in silhouette from SF Symbols.

Record measurements and source/capture hashes in the report before changing profile
constants. Native image thresholds must be selected from actual repeat-capture
noise; none are invented in advance. Review screenshot differences alongside the
geometry tests. Update `nativeCaptures`, `nativeMeasurements`, and profile status
only after the reference matrix passes. Adding files alone does not verify parity.

CI already runs the geometry snapshots and browser interaction matrix and attaches
browser screenshots. A pinned Mac runner and native pixel-comparison gate still
need provisioning; the supplied images do not establish repeat-capture noise thresholds. Ubuntu images
must be reviewed for font substitutions separately from macOS images.
