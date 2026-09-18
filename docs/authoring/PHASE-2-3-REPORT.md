# Phase 2–3 implementation and verification

Date: 2026-09-18. Baseline: `d9c283b379fd48071606d03cea39227ed37da455` plus the existing Phase 0–1 working tree. Changes remain uncommitted.

## Status

**Implemented; acceptance pending.** The transactional source editor and functional inspector are connected to the application. Automated source, project, runtime and export checks pass. Browser interaction execution and native visual/behavior acceptance remain blocked; these phases are not being declared fully verified.

The request to proceed with Phases 2–3 authorized implementation while the previously reported infrastructure gates remained open. The native matrix, screenshot tolerances and performance limits were not relaxed.

## Phase 2: transactions

- Commands carry project identity, document revision, source span/fingerprint, owner, deployment target and operation. The worker reconstructs source recipes; UI code cannot supply property patch offsets.
- Property, insert, delete, reorder, reparent, hide and restore operations share the worker planner. The former direct canvas edit RPC and separate canvas undo history were removed.
- Commit checks the exact project object and revision again. Typing, file changes, metadata changes, switching projects, or an undo back to identical bytes cannot revive an old plan.
- Source changes, file creation and validated studio metadata commit atomically. Batch planning supports independent commands across files and rejects conflicting edits or invalid new source before committing anything.
- Typing and design edits use one bounded document history. Typing groups contiguous changes; design gestures have their own entries. Undo/redo restores source and metadata together, including source selection translated through typing and file renames.
- Selection anchors are rebuilt from committed source; stale preview results remain subject to the existing worker/project guards. A late property response does not override a newer user selection.

**Validation policy:** syntax recovery anywhere in the project prevents design mutation. Semantic errors overlapping the target also prevent mutation. Unrelated existing semantic diagnostics may remain, but a plan cannot introduce additional errors recognized by the subset checker. This checker does not replace Apple’s type checker. Stale plans fail recoverably and require a fresh request; they never reuse old offsets against new text.

## Phase 3: inspector and layout

The inspector supports literal text and image names; font presets and system size/weight/design; named colors; padding, spacing and alignment; fixed/content/fill sizing; corner radius, opacity, line limits and text alignment; basic accessibility; scroll direction and existing indicator flags. Basic shape fill and radius edits are included.

Bindings, computed expressions, user-defined tokens, unsupported overloads and action closures retain their original source. Controls show ownership and how their source recipe behaves. Inherited styles receive explicit local overrides; shared declarations are not silently changed.

Keyboard behavior includes Enter/blur commit, Escape cancellation, invalid/intermediate numeric values, focus restoration and a staged opacity slider with one commit on release. CodeMirror keyboard and browser undo events use the document history. Existing layer/canvas layout operations retain their source-based semantics; phone positioning code was not changed.

**Explicit boundaries:** stack-axis conversion is withheld when an axis-specific alignment is declared; a stack with spacing cannot convert directly to Overlay. Computed, ranged, repeated, unsupported or commented frame constraints cannot change sizing mode, although supported literal arguments remain editable. Content means natural SwiftUI sizing; Fill depends on the parent’s finite size proposal. Fixed starts at 100 points. Colors are the named SwiftUI subset, with deployment checks. Arbitrary Swift remains developer-owned.

The exact accepted frame forms and simple `fill` form were added to the capability manifest to cover these approved core layout/shape workflows. These are documented writer boundaries, not an assertion that all SwiftUI overloads or custom layouts are editable.

## Verification results

| Check | Result |
|---|---|
| Type checking, including tests | Pass |
| ESLint | Pass |
| Unit/integration regression suite | 2,932 passed; one pre-existing skipped export helper |
| Production build | Pass |
| Bundle limits | Pass; 501.0 / 600 KB total, 125.8 / 172 KB largest (gzip) |
| 2,000-line pipeline | 53.55 ms / 120 ms |
| Six-page gallery | 34.98 ms / 120 ms; existing ratio assertion passes |
| Tap to repaint | 1.80 ms / 32 ms |
| Exact source preservation and export | Pass |
| Apple Swift type check of 21 generated writer forms | Pass |
| Browser test discovery | 9 tests found; execution blocked |
| Stateful Xcode export build | Blocked, exit 65 |
| Native visual matrix | Blocked |

The independent native forms are generated by the real command planner and type-checked by Apple Swift 6.4 against the iOS 27 simulator SDK with an iOS 17 deployment target. They establish API/type correctness for those 21 forms, not rendering parity or state behavior.

The stateful writer reference is also generated by real edits. Its source SHA-256 is `bec1f76b8f97f0eb544986af9d16faec916cdbf809a5933b8e73a6c4fc4d0b1e`. The exported application source is byte-identical to the committed source. An independent XCTest target checks the edited title and the preserved increment action.

## Open acceptance gates

1. **Actual browser execution:** nine authoring tests are discovered but have not run. The earlier local-browser access denial remains in effect. These cover source-preserving inspection, selection, computed content, action isolation, editing/cancel/focus, mixed undo, numeric blur validation, card restyling and slider cancellation/undo. Existing design/workspace tests also need execution.
2. **Native app build and behavior:** Xcode `build-for-testing` exits 65. The host sandbox prevents the Swift `@State` macro plugin from running (`sandbox_apply: Operation not permitted`, malformed `SwiftUIMacros.StateMacro` response). No successful native UI execution or captures are claimed.
3. **Visual parity:** the two-device × two-appearance × two-text-size matrix and calibrated image regions are still pending. Internal render-tree checks and successful Swift type checks do not close this gate.

Full-suite runs exposed performance contention and a gallery ratio failure. The benchmark now runs after functional tests in its own Vitest execution group. Extra gallery images also skip rebuilding the complete Layers hierarchy, which is already supplied by the live pass; rendering and action behavior remain covered by the existing gallery tests. Benchmark fixtures and limits are unchanged. Both failure logs are retained alongside the final run.

## Reproduce

```sh
npm run verify
npm run build
npm run budget
npm run e2e -- e2e/authoring.spec.ts e2e/design.spec.ts e2e/workspace.spec.ts

AUTHORING_WRITER_EXPORT_DIR=.verification/writer/export npm test -- tests/authoring-writer-native.test.ts
AUTHORING_WRITER_FORMS=.verification/writer/NativeWriterForms.swift npm test -- tests/design-edit.test.ts
xcrun --sdk iphonesimulator swiftc -typecheck -parse-as-library \
  -target arm64-apple-ios17.0-simulator \
  -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  -module-cache-path .verification/writer/ModuleCache \
  .verification/writer/NativeWriterForms.swift
xcodebuild build-for-testing \
  -project .verification/writer/export/WriterReference/WriterReference.xcodeproj \
  -scheme AuthoringVerification -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .verification/writer/DerivedData CODE_SIGNING_ALLOWED=NO
```

Run browser and simulator commands only in an environment where access is available. Evidence for this implementation is under `.verification/phase-2-3*`; the portable evidence archive excludes dependency caches and Xcode derived data.
