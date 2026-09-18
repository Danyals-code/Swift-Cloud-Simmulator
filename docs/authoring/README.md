# Source-aware authoring

Swift remains the source of truth. The inspector derives editable controls from parsed source; every design edit is planned in the compiler worker and committed against one exact project revision.

Phases 2–3 are implemented for the documented subset. Browser interaction checks and native visual acceptance remain pending. The native matrix and image thresholds in `contract.json` are unchanged.

## Implementation

- **Source model:** `packages/swift-sema/src/authoring.ts` preserves ownership, branches, templates, expressions and source ranges. Runtime rows map back to one source template.
- **Writers:** `design-controls.ts` discovers literal and known-preset controls and supplies minimal patches. `design-edit.ts` validates source identity, scope, deployment target, syntax and semantic diagnostics before returning a plan.
- **Transactions:** `packages/project-model/src/transactions.ts` atomically applies source changes, new files and studio metadata. The store rechecks the project object and revision when a worker reply arrives.
- **History:** code typing, canvas operations, file changes and inspector edits share one project timeline. A numeric drag stages its value locally and commits once on release; Escape discards the draft.
- **UI:** the inspector shows real controls, ownership, source reveal and read-only explanations. CodeMirror forwards undo/redo to the project timeline. Swift parsing stays in the worker.

`packages/shared/src/authoring-capabilities.ts` defines exact source forms. `authoring-writers.ts` documents writer boundaries. Implemented editing and native verification are separate statuses.

## Supported controls

Text and image names; font presets and literal system-font arguments; named colors; spacing, padding and alignment; fixed/content/fill sizing; corner radius, opacity and line limits; basic accessibility; scroll axes and existing indicator arguments. Existing structural operations—insert, delete, move, reparent, hide and restore—use the same planner.

Bindings, computed expressions, user-defined tokens, unknown overloads and action closures are preserved. Inherited styles can receive explicit local overrides. Stack-axis conversion requires no axis-specific alignment; spacing prevents conversion to Overlay. Complex, repeated or commented frame constraints retain their literal controls but cannot be converted between sizing modes. The inspector describes the affected source scope and parent sizing rules.

## Verification

Use Node 22.23.2 and npm 11.12.1.

```sh
npm run verify
npm run build
npm run budget
npm run e2e -- e2e/authoring.spec.ts e2e/design.spec.ts e2e/workspace.spec.ts
```

The source/transaction tests include exact bytes, Unicode, comments, modifier order, computed values, project-switch races, atomic multi-file failure, mixed undo, layout geometry and export identity. Browser tests exercise the actual controls, keyboard editing, blur/cancel, focus and slider undo.

`tests/authoring-writer-native.test.ts` exports a card produced by real writer commands, plus an independent XCTest action test. Set `AUTHORING_WRITER_EXPORT_DIR` to retain its Xcode project. `tests/design-edit.test.ts` can also write 21 independent SwiftUI writer forms when `AUTHORING_WRITER_FORMS` is set. Those forms check Swift API/type correctness; they do not establish native rendering or state behavior.

For the original source fixture and full reference harness:

```sh
npm run verify:authoring:environment
npm run verify:authoring:native -- --device DEDICATED_SIMULATOR_UUID
```

`tooling/authoring-evidence.mjs` compares source/scenario identity, state, geometry, line counts and calibrated image regions. Missing native captures or unapproved thresholds remain blocked, never passing. Keep evidence under `.verification/`, outside Playwright's cleared output directory.

See [Phase 0–1 evidence](PHASE-0-1-REPORT.md), [Phase 2–3 evidence](PHASE-2-3-REPORT.md), and [the fixed contract](contract.json).
