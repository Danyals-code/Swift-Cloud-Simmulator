# iPhone control parity: screenshot follow-up, 2026-09-17

The supplied screenshots showed real default-shape differences, not just missing glass.
This pass focuses on the iPhone renderer. Materials remain blur approximations and symbols
remain Ionicons. It does not establish complete SwiftUI compatibility.

## Evidence

The 15 original PNGs are preserved under
[parity/native/iphone18pro-controls](parity/native/iphone18pro-controls/measurements.json).
The manifest records image hashes, original filenames, dimensions, measured values and the
hash of [the comparison Swift source](../tests/fixtures/ios27-visual-stress.swift).
Each image is 1206 × 2622 pixels, corresponding to 402 × 874 logical points at 3×.
The screenshots include light/dark controls, expanded/collapsed lists, presentations,
alerts and keyboard states. Slider/count values differ because the controls were exercised.

Appearance and default text size are inferred from the images; their exact runtime build
is not embedded. The comparison project previously built and ran with Xcode 27.0 (27A266a).
No new native execution or native pixel-difference score is claimed for this follow-up.

## Visual corrections

| Area | Change checked against the reference |
| --- | --- |
| Segmented picker | 32-point capsule track and selection; corrected dark selected fill |
| Bordered buttons / button toggles | Capsule shapes, 34-point regular height, revised padding and tinted fills |
| Slider | 36 × 24-point capsule handle and 6-point track; endpoints retain a full-width track |
| Stepper | Capsule group and 24-point center divider |
| System blue | Light `#0088FF`, dark `#0091FF`, sampled from solid control regions |
| Progress and gauges | Body-sized progress label; separate 16-point default gauge bar; 58-point circular gauges with 6-point strokes and appropriate labels/marker |
| List controls | Row padding tuned so the first Controls card matches the native bounds within 3 points |
| DisclosureGroup | Expanded children become separate rows, indented 20 points, with matching separators |
| GroupBox | Header inside the panel; body centered beneath it; corrected background and radius |
| Text-only Grid | Compact row spacing while preserving explicit spacing |
| Navigation | Pushed screens inherit automatic large-title behavior; explicit inline titles remain inline |
| Alert input | 48-point capsule field, 16-point inset, light/dark gray fill; bindings retained |
| Confirmation dialog | Floating 240-point panel with pill actions and a pointer; explicit title visibility, destructive tint, no redundant cancel row |
| Fixed-height sheet | Corrected floating bottom margin: the 200-point example renders at 226 points, within 2 points of the measured image |
| Tab indicators | Count badges and the missing stacked-rectangle Ionicon asset |

These checks protect selected geometry, colors and interactions. They do not compare every
pixel: native keyboard placement, text antialiasing, material rendering and symbol artwork
differ from the browser.

## Added behavior

- `.badge`: integer/string/Text labels on tabs and list rows; a zero integer hides the
  badge. A row badge cannot leak onto its containing tab.
- `.contextMenu`: action builders open by stationary hold, right-click or Shift-F10.
  A short press still performs the original button action; moving cancels the hold.
  Container menus propagate to child controls. Explicit `menuItems:` builders work.
  Custom previews and selection-based menus report unsupported diagnostics.
- `.presentationBackgroundInteraction`: enabled/disabled and `enabled(upThrough:)`
  control background hit testing at the selected sheet height. This follows Apple's
  [documented detent threshold](https://developer.apple.com/documentation/swiftui/view/presentationbackgroundinteraction(_:)).
- `.inspector`: a binding-driven sheet for the iPhone case, consistent with Apple's
  [compact-width adaptation](https://developer.apple.com/documentation/swiftui/view/inspector(ispresented:content:)).
  There is no iPad trailing-column implementation yet.
- `.onSubmit`: Enter invokes the common text-field submit closure, including an inherited
  handler. IME composition, multiline editing and Shift-Enter do not trigger it.
- `.keyboardType`, `.submitLabel`, `.textInputAutocapitalization` and
  `.autocorrectionDisabled`: browser input hints. These do not draw an iOS keyboard.

## Validation

- Full type checks, lint and unit/regression suite passed: **2,757 passed, one skipped**.
- The 503-case visual stress suite covers small/large iPhones, light/dark, accessibility
  text and secondary iPad configurations. Gap diagnostics count as tests, not support.
- Screenshot provenance and measured control/list/presentation checks are in
  `tests/ios27-controls-native.test.ts`. Gesture arbitration has separate timer tests.
- The production build and bundle budget pass. Client JavaScript remains close to the
  existing ceiling (approximately 463.1 KB against 470 KB); the budget was not increased.
- Browser smoke checks on the production build: light/dark controls, tab changes,
  disclosure expansion, large-title navigation, alert edit persistence, floating choices,
  sheet geometry, slider/gauge updates, context actions, keyboard menu access and submit.
  Inspector dismissal and exposed-background interaction also passed; taps inside the
  sheet no longer reach covered controls. No browser console errors were observed.
- `e2e/visual-stress.spec.ts` includes alert/sheet and context/submit regressions. Its local
  automated run could not launch because Playwright's Chromium headless-shell 1243 was
  absent. **This is not a passing E2E run.** CI already installs Chromium before its run.
- No commit or push was made.

## Still missing or partial

The [complete checklist](16-SWIFTUI-VISUAL-CHECKLIST.md) is updated rather than claiming all
SwiftUI views work. The next iPhone priorities are native keyboard/focus behavior,
keyboard/bottom toolbars, custom swipe actions, row reordering, refresh callbacks,
draggable sheet detents and richer date/time/color pickers. Nested context menus and
custom previews remain incomplete. Photos, files, clipboard, sharing and TipKit need
platform integrations or explicit browser substitutes. Additional iPhone/accessibility
captures come before iPad tables, split navigation and adaptive side panels.
