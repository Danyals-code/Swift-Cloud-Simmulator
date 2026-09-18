# Phase 4–6 implementation and verification

Date: 2026-09-18. Baseline: `5e11a2b43c4b08c6512ef5feb1a141fd92e77882`. Changes are in the working tree; no commit or push was made.

## Exit decision

**Acceptance blocked.** The collection, component and local-behavior workflows are connected to the application and verified through the source planner, runtime, transactions and export tests. Browser execution and native visual/interaction acceptance are still unavailable. These phases are not declared fully accepted.

The existing device/appearance/text-size matrix, image thresholds and performance limits were not relaxed. An unavailable test is not counted as passing.

## Phase 4 — Logical layers and editable collections

**Goal demonstrated:** a collection has one editable source template, regardless of the number of rendered records. Heterogeneous static rows stay separate.

- Design Layers show screens, instances, collections, row templates, branches and Section headers/footers. Runtime detail retains the evaluated hierarchy. Template entry supports double-click and Enter, a breadcrumb and explicit all-rows scope; collapse retains selection.
- The inspector separates adding a static row, adding a template element, applying preview records and changing Swift initial data. List styles respect the deployment target. A single literal Text row can convert to a typed collection; destructive mixed-row conversion is refused.
- Local `Identifiable` record structs support stable String/Int IDs; String, Int, Double and Bool fields; optional values and defaults. The editor can insert, delete and reorder records and add fields with defaults that preserve existing constructors and developer actions. Limits are 32 fields, 1,000 records and bounded text. Remote/computed collections, arbitrary record constructors and implicit or typed closure parameters remain developer-owned.
- Field mapping preserves arbitrary formatting expressions. Mutable row controls generate `List($items) { $item in ... }` and real field bindings in one edit. The interpreter and semantic checker now support these forms; writes follow stable IDs after reordering.
- An empty-state command writes a real conditional branch. Preview records live in scenario metadata and leave Swift/exported defaults unchanged.

**Evidence:** 100-record/one-template checks; 0/1/many records; optional and missing fields; invalid mappings and duplicate IDs; static versus repeated content; row identity through reorder; exact source preservation; cross-file schema changes; runtime toggle writes and exported source identity. Actual browser interaction and native row geometry/scrolling remain pending.

**Requirement coverage:** implementation and automated evidence for R02–R10 and R16; browser/native proof for R10/R13–R15 remains open.

## Phase 5 — Components and explicit edit scope

**Goal demonstrated:** two component instances can differ through explicit inputs while sharing one definition.

- Instance arguments are the default editing scope. Entering a shared definition identifies affected call sites, including repeated usage. Shared-definition selection also lists its instances.
- Unique local nongeneric View structs expose inferred memberwise inputs: literal scalars, simple enum variants and named colors. Omitted arguments use Swift defaults and are inserted in declaration order. Unsupported internal code does not prevent editing an independently supported input.
- Versioned descriptions provide labels, descriptions, numeric limits and groups. Descriptions must match the current Swift interface signature; renamed or changed interfaces invalidate them safely. Explicit descriptions enable bounded `() -> AnyView` slots and `() -> Void` action inputs.
- Extraction parameterizes supported scalar/record dependencies, local state, editable row bindings and named callbacks. The new Swift file and replacement call site commit as one reversible transaction. Ambiguous names, self references, uncertain closure-local captures and unsupported initializers are refused.

**Evidence:** independent instance overrides, shared definition changes, defaults, variants, slots, callback execution, stale metadata, computed argument preservation, optional/binding dependencies, multi-file extraction/undo and Apple type checking of generated extraction forms. Native variant/layout comparisons remain pending.

**Requirement coverage:** implementation and automated evidence for R02–R07/R09/R12/R16; browser/native proof for R10/R13–R15 remains open.

## Phase 6 — State, actions and scenarios

**Goal demonstrated:** designer commands generate executable local Swift behavior, and preview scenarios do not become production data.

- Controls create or bind real local state. Nonoptional controls reject optional state; duplicate/shadowed names and arbitrary binding implementations are protected.
- Button actions support set/toggle, named synchronous no-argument functions, navigation in an existing navigation container, sheet presentation/dismissal and local record append/delete. Existing actions, including comments, require explicit replacement. Named function bodies remain untouched; recursive/incompatible functions are rejected.
- Direct custom-view NavigationLink destinations now expand correctly in the preview runtime. Sheet dismissal uses a real environment action when the current presentation is selected.
- Content/empty/loading/error scenarios use explicit source inputs and existing branches. Validated initializers are substituted into the evaluation AST only, including qualified nested owners. Scenarios/descriptions persist through storage, sharing and undo. Unsupported hooks are preserved but never executed.
- Project/scenario boundaries discard worker state and pending handlers. Reset handles stale source/context safely. Invalid scenarios stay invalid through reset rather than resurrecting the previous app.
- Transition writing is bounded to opacity/slide/scale, ease-in-out, 0–2 seconds and a local state value. For conditional content, the animation is attached to a surviving container. Existing animation code is preserved. Reduced-motion preferences disable preview animation. Removed nodes retain an inert visual snapshot for their exit; reentry cancels removal. Delayed completions use exit tokens so an older animation cannot remove a newer view. Source, project, scenario and reset boundaries clear retained presentation state. Transition duration is inherited from the configured Swift animation, including before its value is first changed.

**Evidence:** runtime text input, toggle/picker changes, navigation, sheets/dismissal, append/delete and duplicate protection; 50 scenario/project switches; state/type/recursion guards; source invariance, stale scenario rejection, metadata round trips, conditional animation source placement, configured durations and five transition-lifecycle tests covering exit, reentry, stale completions, reduced motion and resource bounds.

**Motion boundaries:** exit snapshots are limited to 64 roots per container, 256 nodes per retained subtree and durations up to 2 seconds. Oversized/unsupported exits remove immediately. CSS motion remains an approximation; interruption cancels stale removals, but native trajectory/velocity and screenshot parity still require actual browser/native evidence. Neither pure transition-state tests nor generated Swift type checking count as visual acceptance.

**Requirement coverage:** implementation and automated evidence for R02–R07/R09/R11/R12/R16; actual design/live interaction, motion and browser/native equivalence for R10/R11/R13–R15 remain open.

## Checks run

| Check | Result |
|---|---|
| TypeScript, including test code | Pass |
| ESLint | Pass |
| Full regression suite | 2,973 passed; one pre-existing skipped helper |
| New source/runtime workflow tests | 36 passed |
| Transition lifecycle tests | 5 passed |
| Production build | Pass |
| Bundle limits | Pass; 520.4 / 600 KB total, 125.8 / 172 KB largest (gzip); total is at the tool’s warning level |
| 2,000-line full pipeline | 37.87 ms / 120 ms |
| Six-page gallery | 14.18 ms / 120 ms; existing ratio check passes |
| Tap to repaint | 0.66 ms / 32 ms |
| Apple Swift type check of generated independent forms | Pass |
| New browser test discovery | 8 found; not executed |
| Stateful native export build-for-testing | Blocked, exit 65 |
| Browser/native visual matrix and native UI execution | Blocked |

The Apple API/type check uses Swift 6.4, the iOS 27 simulator SDK and an iOS 17 deployment target. Forms are generated by actual writer commands for records/default fields, empty states, component inputs/variants, slots, navigation extraction and conditional transitions. The row-binding and motion harnesses replace their state initializers with an injected `@Binding` to avoid the unavailable State macro plugin; generated view bodies are unchanged. This checks APIs/types, not visual parity or native state execution.

The stateful exported project includes an independent XCTest covering catalog content, a toggle action, item insertion, navigation/back and sheet presentation/dismissal. Its exported Swift source is byte-identical to the tested source. The build failed because the host denies the State macro plugin sandbox (`sandbox_apply: Operation not permitted`, malformed `SwiftUIMacros.StateMacro` response); CoreSimulator connectivity is also unavailable. No native screenshots or successful UI run are claimed.

The earlier browser-access denial remains in effect. Only Playwright discovery was run; no alternate browser or hidden automation was used. New browser cases cover template entry/collapse, preview versus app records, instance/shared scope, design versus live actions, persisted scenarios, reduced motion and editable row bindings and timed exit/reentry behavior. Existing layer tests explicitly choose Runtime detail so their evaluated-hierarchy assertions remain intact.

Evidence identity (SHA-256):

- Generated Swift type-check forms: `791b2e687af7c9d7b7f8528559dabbf3ed5b6e640775d145cd2814e0e9981582`
- Stateful exported App.swift: `979eb650b9bdbdbc3a17c1af96594d82175c0e2de942614b90a63a8b8c6a9eb6`
- Baseline and every modified source-file hash are recorded in the portable archive’s manifest.

## Code-quality review

- Swift discovery, validation and writing remain in semantic modules. React submits typed commands and never supplies source offsets or constructs Swift patches.
- Source, files and metadata use the established atomic transaction/history path. Planner validation is repeated against the full project revision before commit.
- The review added protection for comments, local shadowing, optional bindings, nested scenario ownership, memberwise argument order, stable row writes, stale handlers and deployment availability. Existing binding-list stress fixtures were upgraded from an expected unsupported diagnostic to successful output assertions.
- Capabilities and exact writer boundaries are documented separately from native verification. No dependency, lockfile or test-threshold changes were needed.

## Reproduce

Use Node 22.23.2 and npm 11.12.1.

```sh
npm run verify
npm run build
npm run budget
npm run e2e -- --list e2e/authoring-workflows.spec.ts

AUTHORING_456_EXPORT_DIR=.verification/phase-4-5-6/export \
AUTHORING_456_NATIVE_FORMS=.verification/phase-4-5-6/NativeForms.swift \
npm test -- tests/authoring-workflows.test.ts

xcrun --sdk iphonesimulator swiftc -typecheck -parse-as-library \
  -target arm64-apple-ios17.0-simulator \
  -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  -module-cache-path .verification/phase-4-5-6/ModuleCache \
  .verification/phase-4-5-6/NativeForms.swift
```

In an environment with browser/native access:

```sh
npm run e2e -- e2e/authoring-workflows.spec.ts e2e/authoring.spec.ts e2e/design.spec.ts e2e/workspace.spec.ts
xcodebuild build-for-testing \
  -project .verification/phase-4-5-6/export/AuthoringWorkflows/AuthoringWorkflows.xcodeproj \
  -scheme AuthoringVerification -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .verification/phase-4-5-6/DerivedData CODE_SIGNING_ALLOWED=NO
```

The native UI tests then need execution on the dedicated reference simulators. Run the live motion tests and collect the unchanged reference matrix before accepting Phase 6. The portable evidence archive contains logs, source snapshots, hashes, generated forms and the stateful Xcode fixture; dependency caches and DerivedData are excluded.
