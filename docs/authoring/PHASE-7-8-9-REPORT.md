# Phases 7–9 implementation and verification

Date: 18 September 2026.

**Assets, shared styles, editable archives, and reviewed reimport are implemented for the supported subset. Automated verification passes. The phase exit gates remain pending where they require actual browser use, native execution/visual comparison, or independent designer sessions.**

No release commit was created. The changes are in the working tree based on `9c6d2238e409d7220fa73fa410bb1fd37920e6db`. The non-Markdown source snapshot is:

`53a14c09e30fa67edf58098f4d327994e983c0b75056db85e79cd5fb02c7e9a8`

`release-snapshot.json` contains the individual hashes for 367 project files and 46 export artifacts. Ignored dependencies/build outputs are excluded. The final contract edit updates capability prose and test references only; device targets, thresholds, and budgets are unchanged.

## Phase 7: resources and shared styles

- **Project resources** imports PNG/JPEG images with stable IDs, names, pixel scale, and an optional dark variant. Preview rendering uses the imported image's real dimensions and selected appearance.
- Rename and deletion planning checks supported `Image`/`Label` references. Source and resource changes commit and undo together. A referenced deletion requires an explicit replacement; dynamic names and unsupported bundle expressions require source review.
- Import validates paths, names, collisions, bytes, dimensions, total decoded pixels, and resource counts before committing. PNG checks include chunk CRCs and bounded inflation; the browser additionally decodes imported images before use.
- Shared colors, spacing, and text styles live in actual immutable Swift declarations. The inspector distinguishes updating a shared value, linking a property, and applying a local override, with source ownership and affected references.
- Writers preserve unrelated code, reject unsupported/commented/ambiguous forms, retain no-op bytes, and enforce deployment availability. New style names cannot shadow framework types.
- All four native export formats carry resource catalogs. Xcode and XcodeGen use an app asset catalog; package formats declare their resources explicitly.

The supported image subset is deliberately bounded: non-interlaced PNG or JPEG, one 1×/2×/3× scale per image, and matching dimensions for light/dark variants. Maximums are 64 images, 4 MB per variant, 32 MB total image bytes, 4096 pixels per dimension, 4 megapixels per variant, and 16 megapixels total decoded variants.

**Native package limitation:** unchanged bare `Image("Name")` source looks in the main bundle. Swift package consumers must use the resource bundle or integrate the catalog into the host app. No source is silently rewritten. Package/Playgrounds image behavior still requires an intended-host test. See [Apple's package resource documentation](https://developer.apple.com/documentation/xcode/bundling-resources-with-a-swift-package) and [SwiftUI image lookup](https://developer.apple.com/documentation/swiftui/image/init(_:bundle:)).

## Phase 8: editable files and developer handoff

- **Save editable** downloads Swift, images, configuration, explicit project identity, and versioned studio metadata in a `.swiftstudio.zip`.
- Native archives also contain a handoff manifest. Real external Swift edits can return through a visible file-level three-way comparison. Identity uses the project ID; a matching name never authorizes a merge.
- Conflicting files/configuration/resources require a choice. The importer does not invent textual merges. A separate-copy option preserves the current project and assigns a new identity.
- Merge validation checks the selected source against removed images. Missing resources, invalid schemas, ambiguous changes, and stale revisions cannot partially replace the open project.
- Serialized persistence prevents older saves from finishing over newer work. Import persists before publishing and restores the current document if typing changes it during the save. Fault/race tests exercise these paths.
- Legacy projects migrate without discarding visual metadata. Removing studio metadata leaves app source/resources intact; future schemas fail explicitly. Standalone source bundles can retain supported native image sets.
- Loose Swift import preserves BOM, CRLF, Unicode, and trailing bytes. Invalid UTF-8, unsafe/colliding names, or an oversized selection is rejected before any file opens.
- ZIP import checks directory/local-entry agreement, paths, symlinks, encryption, CRCs, counts, expansion limits, and required resources. Unrelated binary entries are skipped without inflation.
- Existing Xcode, XcodeGen, Swift package, and Playgrounds exports remain available. Deployment targets, bundle IDs, source bytes, and resource hashes are preserved in the covered round trips.

Archive limits are 48 MB compressed, 64 MB selected expansion, 512 entries, 256 Swift files, and 8 MB Swift text. The export baseline guides review; it is not an authenticity signature.

## Verification results

The final implementation run used Node 22.23.2 and npm 11.12.1 on macOS 27.0/arm64. Apple verification used Xcode 27.0 and its iPhoneSimulator 27.0 SDK.

| Check | Result and scope |
| --- | --- |
| Complete test suite | **3,027 passed, 1 existing skip**; 93 test files passed, 1 skipped. Includes 54 new tests. |
| Type checks and lint | Passed, including all browser test sources. |
| Production build | Passed. |
| Bundle budget | Passed: **549.0 KB / 600 KB** total gzip; **125.8 KB / 172 KB** largest chunk. Total size triggers the existing 92%-usage warning. |
| Existing pipeline benchmark | 2,000-line fixture: **37.59 ms**, against 120 ms. Six-page gallery: 13.65 ms. |
| Existing interaction benchmark | Tap and pipeline repaint: **0.67 ms**, against 32 ms. This is not DOM paint timing. |
| New authoring component benchmark | 2,186 lines, 100 records, five warmups and 100 samples: planning + headless pipeline **p95 108.11 ms**; planning alone p95 63.58 ms. |
| Scale/isolation tests | Passed for 100/1,000 records, 30 nested layout levels, 50 project/scenario boundaries, retired action handlers, and bounded invalid inputs. |
| Persistence fault/race tests | Five passed; invalid/oversized loose-source import has three additional tests. |
| Handoff/export checks | Passed for exact source/resource bytes, all four native formats, editable archive, real external file edits, renamed fields/components, and preserved custom logic. |
| Apple Swift typecheck | Passed for the writer-generated resource fixture with an iOS 18 target. |
| Apple asset compilation | Passed; `Assets.car` produced. |
| Native Xcode build | **BUILD SUCCEEDED** for the exact exported macro-free `ResourceReference` Simulator app, including its resource catalog. No app launch is claimed. |
| Browser test discovery | 20 cases discovered in the resource, latency, and existing workflow suites; 12 newly added. **Not executed.** |
| Patch whitespace | Passed. |

The new source/resource suite has 36 tests; the release integration suite has 9; the added benchmark has 1; persistence has 5; loose-source import has 3. The existing export-import test now requires traversal archives to fail instead of sanitizing them into another filename.

Raw authoring samples are retained in `phase789-metrics.json`. These measure source planning and the worker pipeline, excluding IPC, DOM, input, and paint latency. Uncontrolled-GC heap samples are investigative data, not proof of browser leak freedom.

## Phase 9: implemented checks and remaining gates

The implementation audit covered mutation ownership, source/resource atomicity, stale worker results, merge reference safety, storage ordering, parser/import bounds, and source-byte preservation. It found and fixed resource-only projects being treated as pristine, mixed merge choices leaving image references unresolved, and loose-file imports dropping BOMs.

The [designer guide](DESIGNER-GUIDE.md), [extension guide](EXTENSION-GUIDE.md), and [release checklist](RELEASE-ACCEPTANCE.md) are ready. New browser cases cover two fresh full handoffs, eight resource capture configurations, corrupt-image rollback, and real UI latency sampling.

The following gates remain open:

1. **Real browser workflows and visual review.** Earlier Chromium launch failed at macOS MachPort rendezvous (`Permission denied (1100)`), and the local production preview was denied in the in-app browser. That access denial remains in effect; no alternate browser route was used. Listing/typechecking tests does not count as running them.
2. **Native execution and the frozen comparison matrix.** CoreSimulator remains unavailable. The macro-free resource app builds successfully, but the earlier stateful fixture's macro-sandbox failure is not resolved by that result. Native actions, state, navigation, motion, and image appearance still need execution.
3. **All eight visual configurations.** iPhone 15 and iPhone 18 Pro × light/dark × Large/Accessibility 3 remain required. Runtime identity, repeat-capture calibration, and region thresholds are still pending; a null threshold is not a pass.
4. **UI performance, retention, and accessibility.** Browser selection/input p95 ≤100 ms, inspector-to-preview p95 ≤500 ms, drag frames p95 ≤32 ms, actual worker/listener teardown, repeatable memory trends, keyboard focus, errors, and reduced motion need real measurements/review.
5. **Three independent designers.** No sessions have been conducted. All three must complete the fixed tasks without coaching or unintended scope changes; any issues require fixes and retesting.
6. **Release snapshot.** A reviewed release commit and evidence from that exact commit are still required for sign-off. The current hash records an uncommitted implementation snapshot.

## Requirement trace

| Requirements | Available evidence | Remaining acceptance |
| --- | --- | --- |
| R01: source authority | Real Swift style definitions, metadata removal and exact resource/source checks | Native execution of the complete fixtures |
| R02, R07: ownership and selection | Source recipes, explicit IDs, stale-reference rejection, external rename/reimport and continued-edit tests | Actual UI selection recovery after handoff |
| R03–R06: preservation and atomicity | No-op bytes, minimal patches, resource/source undo, race/failure rollback, invalid archive/schema rejection | Full browser workflows twice |
| R08–R09: template and scope | Existing collection/component tests plus shared/local style and preview-data isolation checks | Independent designer scope tasks |
| R10–R11: real controls and behavior | Typed writers and state/action integration; real browser cases prepared | Browser controls and native action equivalence |
| R12: portability | Source, images, configuration, metadata, schema, four-format export and reviewed reimport tests | Visual/interaction continuity in actual hosts |
| R13: native validity | Resource fixture typecheck, asset compilation, and app build | Stateful fixture build/launch and each format's intended-host check |
| R14: parity | Existing contract retained; eight resource capture cases prepared | Native/browser captures and calibrated comparisons |
| R15: responsiveness and isolation | Existing budgets, added headless timings, bounded input and 50-boundary functional checks | Real UI latency, teardown, memory, accessibility |
| R16: evidence and maintainability | Package boundaries documented, tests/typecheck/lint/build, raw logs and hashes retained | Same-commit release run and independent usability evidence |

## Reproduction and retained evidence

```sh
npm run verify
npm run build
npm run budget
PHASE789_EXPORT_DIR=.verification/phase-7-8-9/export npm test -- tests/phase789.test.ts
AUTHORING_RELEASE_METRICS=.verification/phase-7-8-9/metrics.json npm test -- tests/authoring-release-bench.test.ts
xcodebuild -project .verification/phase-7-8-9/export/xcodeproj/ResourceReference/ResourceReference.xcodeproj -scheme ResourceReference -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath .verification/phase-7-8-9/DerivedData CODE_SIGNING_ALLOWED=NO build
```

Use the release checklist for browser/native execution when those environments are available. The verification archive contains this report and guides, final verification/build/budget logs, native logs, browser discovery, raw timings, the snapshot manifest, exported archives/files, and the working-tree patch plus newly added source files. Compiled applications and dependency directories are excluded.
