# Source-aware authoring

Swift remains the source of truth. The inspector derives editable controls from parsed source; every design edit is planned in the compiler worker and committed against one exact project revision.

Phases 2–6 have implementations for the documented subset. Browser interaction checks, native behavior and visual acceptance remain pending. The native matrix and image thresholds in `contract.json` are unchanged.

## Implementation

- **Source model:** `packages/swift-sema/src/authoring.ts` preserves ownership, branches, templates, expressions and source ranges. Runtime rows map back to one source template.
- **Writers:** `design-controls.ts` discovers literal and known-preset controls and supplies minimal patches. `design-edit.ts` validates source identity, scope, deployment target, syntax and semantic diagnostics before returning a plan.
- **Transactions:** `packages/project-model/src/transactions.ts` atomically applies source changes, new files and studio metadata. The store rechecks the project object and revision when a worker reply arrives.
- **History:** code typing, canvas operations, file changes and inspector edits share one project timeline. A numeric drag stages its value locally and commits once on release; Escape discards the draft.
- **UI:** the inspector shows real controls, ownership, source reveal and read-only explanations. CodeMirror forwards undo/redo to the project timeline. Swift parsing stays in the worker.
- **Collections:** `authoring-collections.ts` owns typed records, safe field creation, static conversion and field bindings. Source Layers show one template; Runtime detail retains evaluated rows.
- **Components:** `authoring-components.ts` owns inferred instance properties, signature-checked descriptions, bounded slots/actions and dependency-aware extraction.
- **Behavior:** `authoring-behavior.ts` generates explicit Swift state, bindings, actions and transitions. `authoring-scenarios.ts` substitutes validated inputs into the evaluation AST only.

`packages/shared/src/authoring-capabilities.ts` defines exact source forms. `authoring-writers.ts` documents writer boundaries. Implemented editing and native verification are separate statuses.

## Supported controls

Text and image names; font presets and literal system-font arguments; named colors; spacing, padding and alignment; fixed/content/fill sizing; corner radius, opacity and line limits; basic accessibility; scroll axes and existing indicator arguments. Existing structural operations—insert, delete, move, reparent, hide and restore—use the same planner.

Collections expose separate operations for a static row, a template element, a preview record and Swift initial data. Records use stable String/Int IDs and typed String/Int/Double/Bool fields, including optional values and defaults. Adding a field preserves existing constructors through a default. Editable row controls write through real collection bindings.

Component instance arguments are independent from shared definitions. Straightforward scalars, enum variants and named colors are editable; explicitly described content/action slots use bounded local interfaces. Extraction creates a file and replacement instance in one undo step. Unsupported dependencies are refused.

Actions cover local set/toggle, picker selection, navigation, sheet presentation/dismissal and collection insertion/deletion. Named developer functions retain their bodies. Preview scenarios select existing content/loading/error branches through declared inputs; they never overwrite Swift defaults. Metadata travels through storage and sharing and is excluded from app behavior.

Computed expressions, user-defined tokens and unknown overloads stay developer-owned. Arbitrary binding logic is preserved; replacing existing action source is explicit. Layout boundaries from Phases 2–3 remain in place: axis-specific alignment prevents axis conversion, and complex/repeated/commented frame constraints cannot change sizing mode. Transition generation is bounded to opacity/slide/scale and 0–2 seconds; the renderer retains bounded inert exit snapshots and cancels stale removals on reentry. Browser/native motion acceptance remains open.

## Verification

Use Node 22.23.2 and npm 11.12.1.

```sh
npm run verify
npm run build
npm run budget
npm run e2e -- e2e/authoring.spec.ts e2e/authoring-workflows.spec.ts e2e/design.spec.ts e2e/workspace.spec.ts
```

The source/transaction tests include exact bytes, Unicode, comments, modifier order, computed values, project-switch races, atomic multi-file failure, mixed undo, layout geometry and export identity. Browser tests exercise the actual controls, keyboard editing, blur/cancel, focus and slider undo.

`tests/authoring-writer-native.test.ts` exports a card produced by real writer commands, plus an independent XCTest action test. Set `AUTHORING_WRITER_EXPORT_DIR` to retain its Xcode project. `tests/design-edit.test.ts` can also write 21 independent SwiftUI writer forms when `AUTHORING_WRITER_FORMS` is set. Those forms check Swift API/type correctness; they do not establish native rendering or state behavior.

`tests/authoring-workflows.test.ts` exercises the Phase 4–6 planner, runtime, transactions, metadata and exports. Set `AUTHORING_456_EXPORT_DIR` and `AUTHORING_456_NATIVE_FORMS` to retain its stateful Xcode fixture and independent Apple type-check forms. The macro-free binding harness injects storage through `@Binding`; it does not replace a stateful app build.

For the original source fixture and full reference harness:

```sh
npm run verify:authoring:environment
npm run verify:authoring:native -- --device DEDICATED_SIMULATOR_UUID
```

`tooling/authoring-evidence.mjs` compares source/scenario identity, state, geometry, line counts and calibrated image regions. Missing native captures or unapproved thresholds remain blocked, never passing. Keep evidence under `.verification/`, outside Playwright's cleared output directory.

## Extending a capability

Add its exact source form and writer boundary to the shared manifests. Implement discovery and writing together in the semantic layer; never infer editability from rendered values or put source offsets in React. Add preservation, invalid-input and runtime tests, then generate an independent native form from the actual command. A UI control is not accepted until its browser interaction and native comparison evidence pass.

See [Phase 0–1 evidence](PHASE-0-1-REPORT.md), [Phase 2–3 evidence](PHASE-2-3-REPORT.md), [Phase 4–6 evidence](PHASE-4-5-6-REPORT.md), and [the fixed contract](contract.json).
