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
