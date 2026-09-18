# Phase 0–1 implementation report

Baseline: `d9c283b379fd48071606d03cea39227ed37da455`. Changes are in the working tree; no commit or publication was made.

## Exit decisions

| Phase | Implementation | Acceptance |
|---|---|---|
| 0 — requirements and verification | Toolchain pinning, capability contract, baseline checks, native export/UI-test harness, evidence recording, and comparison detector implemented | **Blocked**: native execution/calibration and automated browser verification remain open |
| 1 — source-aware authoring | Source model, ownership, runtime mapping, selection reconciliation, metadata schema, and read-only inspector implemented | **Pending**: code checks pass; actual UI verification and the Phase 0 gate are outstanding |

These are not completed phase sign-offs. No native visual parity is claimed.

## Implemented behavior

- The settings panel now exposes source properties, value categories, ownership/scope, read-only explanations, and source reveal.
- The authoring model represents view definitions and call sites, local component links, branches, collection templates, and standalone previews. Unsupported source remains intact.
- Literal values, data bindings, component arguments, shared tokens, inherited styles, and computed expressions are distinguished without executing them.
- Repeated runtime rows map to a source template. Static siblings retain distinct identities.
- Selection reconciles across inserted lines, file renames, unambiguous moves, and edits within a selected expression. Deletion, ambiguous duplicate changes, stale revisions, and project changes cannot silently retarget an edit.
- Optional studio metadata has a versioned schema. The derived model is not persisted; source and native exports remain unaffected by metadata.
- Node and npm are pinned locally and in CI. Browser tests request a fresh server. CodeMirror loads in a separate chunk, fixing the baseline bundle-limit failure without raising limits.
- Verification tooling records source/export identity and command results, adds an independent XCTest target to an unchanged app export, and compares identity/state/geometry/line counts/image regions. Uncalibrated thresholds cannot pass.

Visual property writes and global code/design transaction history are deliberately reserved for Phase 2 and later. Phase 1 adds inspection, not a competing UI document.

## Verified results

| Check | Result |
|---|---|
| Clean dependency install using Node 22.23.2 / npm 11.12.1 | Passed |
| Type checking, including tests | Passed |
| ESLint | Passed |
| Complete unit/integration suite | **2,868 passed; 1 existing skip**, across 83 passing files and 1 skipped file |
| New authoring, native-export structure, and evidence-detector checks | 33 passing tests included in the complete suite |
| Normal production build | Passed |
| Client bundle budget | **492.9 KB / 600 KB** total; **125.7 KB / 172 KB** largest chunk |
| Existing performance cases | Passed, including full-pipeline and interaction limits |
| Patch whitespace check | Passed |
| Automated browser execution | Blocked before tests could run |
| Native Xcode build/execution | Failed during macro plugin execution; native UI and capture checks blocked |
| Visual review of the rendered inspector | Not performed; local-preview browser access was denied |

The original baseline had 2,835 passing tests and one skip. Its normal production build passed, but its largest client chunk exceeded the existing 172 KB limit. The new split resolves that failure. Existing budgets were retained.

The new tests cover source preservation, modifier order, strings/Unicode, binding and token provenance, lexical shadowing, duplicate definitions, inherited style, component links, inactive branches, 100 runtime rows, unsupported/invalid source, standalone previews, selection reconciliation, metadata persistence, native export structure, and intentional evidence mismatches.

## Observed blockers

1. **Chromium launch:** macOS denied the browser's MachPort rendezvous service (`bootstrap_check_in … Permission denied (1100)`). The runner failed before browser test bodies executed. The four new inspector E2E tests have been added and typechecked, but are not reported as passed.
2. **Native services:** CoreSimulator returned connection failures. Xcode's Swift macro process also reported `sandbox-exec: sandbox_apply: Operation not permitted`, followed by a malformed plugin response for `SwiftUIMacros.StateMacro`. Application source was not changed to evade that failure.
3. **Visual inspection:** the in-app browser was denied access to the local production preview. Permission to retry was requested separately; no alternate browser path was used after the denial.
4. **Calibration:** runtime/capture settings and regional image thresholds remain provisional. Native execution, the full eight-configuration matrix, and reviewed thresholds are required before Phase 0 can pass.

## Handoff

Follow `docs/authoring/README.md` and `docs/authoring/contract.json`. On an environment that permits the required processes:

```sh
npm ci
npx playwright install chromium
npm run verify:authoring
npm run verify:authoring:native -- --device DEDICATED_SIMULATOR_UUID
```

Record actual simulator configuration, review the inspector, run the matrix, and calibrate native/browser image regions. Writer-specific and asset-backed fixture coverage must be added before those later capabilities become editable. The current capability/reference mapping must not be interpreted as native coverage for every overload.

Local evidence is retained under `.verification/authoring/`, including final verification/build/budget logs and the native build/export report. The native harness has structural tests; its runtime execution remains unverified on this host. No CI run or remote native runner was claimed.
