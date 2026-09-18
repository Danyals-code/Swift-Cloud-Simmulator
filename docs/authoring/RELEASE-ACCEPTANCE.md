# Designer authoring release gate

**Status: pending.** Automated source/resource checks and a native resource-fixture build do not replace the browser, simulator, accessibility, and independent-designer gates below.

Use one reviewed source snapshot and the pinned toolchain in `contract.json`. Commit that snapshot for the release run; preserve its commit ID, working-tree status, tool versions, logs, and artifact hashes. Any implementation fix requires rerunning the affected gates against the new snapshot.

## Automated evidence

```sh
npm run verify
npm run build
npm run budget
PHASE789_EXPORT_DIR=.verification/phase-7-8-9/export npm test -- tests/phase789.test.ts
AUTHORING_RELEASE_METRICS=.verification/phase-7-8-9/metrics.json npm test -- tests/authoring-release-bench.test.ts
```

In a permitted browser environment, run:

```sh
npm run e2e -- e2e/authoring.spec.ts e2e/authoring-workflows.spec.ts e2e/resources-handoff.spec.ts e2e/authoring-latency.spec.ts --workers=1 --trace=on
```

The handoff workflow runs twice in fresh Playwright contexts. It covers list preview data, component instance scope, shared styles, imported images, live actions/navigation, editable download, reload, a real external file edit, reviewed reimport, exact Swift/resource bytes, and continued use. Separate unit tests cover conflicting edits, additional/deleted source files, renamed fields/components, computed/custom logic, invalid resources, and interrupted persistence. Browser cases must execute before being marked passed.

## Native and visual matrix

Keep the existing `contract.json` targets: **iPhone 15 and iPhone 18 Pro × light and dark × Large and Accessibility 3**, portrait, `en_US`, UTC. Run all eight configurations for each reference screen, including the resource fixture and collection/detail/settings states.

- Build and launch the exact exported source with the configured deployment target and bundle ID. Test the runnable formats in their intended host; inspect package formats according to their documented bundle contract.
- Exercise actions and editable rows, navigation/back, sheet present/dismiss, preview reset, loading/empty/error states, animations and interruption.
- Capture native and browser images with device scale and content origins recorded. Check geometry within 1 point, line counts, clipping, appearance, image aspect/scale, focus, and hit targets.
- Capture each stable reference five times. Calibrate region noise before approving image thresholds with `tooling/authoring-evidence.mjs`. A null threshold is blocked, not passing.
- Record symbol/material/font differences explicitly. Do not crop out app content, hide a failed region, or update a baseline merely to make a comparison pass.

## UI performance, accessibility, and retention

Keep existing ceilings: 600 KB total gzip, 172 KB largest chunk, 120 ms pipeline, 32 ms tap. Preserve the original benchmark methodology and report the added authoring measurements separately.

| Required measurement | Procedure and gate | Current acceptance |
| --- | --- | --- |
| Selection and input | Five warmups, 100 samples each; browser event to visible inspector/input plus settled paint; p95 ≤100 ms | Pending browser run |
| Inspector to preview | 2,000-line/100-record fixture; five warmups, 100 samples; p95 ≤500 ms | Pending browser run; headless component timing is supplementary |
| Drag frame time | Record RAF intervals during a continuous canvas/layout drag on the same fixture; retain ≥100 samples after five warmups; p95 ≤32 ms | Pending |
| Worker/listener/handler teardown | Record counts before opening, after each of 50 project/scenario switches, and after teardown; no orphan instances | Pending actual browser measurement |
| Memory trend | Repeat five batches of 50 switches; record settled heap and retained worker/DOM objects at the same checkpoints, with GC policy recorded; investigate monotonic retained growth | Pending; a single heap reading is insufficient |
| Accessibility | Keyboard-only traversal and recovery, visible focus, announcements/errors, scope clarity, reduced-motion review, readable controls at supported sizes | Pending manual browser/native review |

Headless tests cover 100/1,000 records, deep layouts, long source, 50 state/scenario boundaries, and retired action handlers. These establish functional isolation, not browser listener or heap behavior.

## Independent designer sessions

Use three representative designers who did not implement the feature. Give each a fresh copy of the same fixture and the tasks below without coaching. Record experience level, device/browser, snapshot ID, start/end time, completion, wrong-scope changes, recovery, and questions. Do not fill a participant row without an actual session.

1. Change the shared row style while keeping an intentional local override.
2. Add a preview record without changing the app's initial data.
3. Override one component instance while leaving another intact.
4. Navigate to a detail view in Live mode and return.
5. Add an image, export/save, reopen, and verify the project remains editable.

| Participant | Session evidence | Completed independently | Wrong-scope changes | Fix/retest |
| --- | --- | --- | --- | --- |
| Designer 1 | Not conducted | Pending | Unknown | Pending |
| Designer 2 | Not conducted | Pending | Unknown | Pending |
| Designer 3 | Not conducted | Pending | Unknown | Pending |

Any unintended source/data scope change or unfinished essential task requires a fix and a repeat of the affected tasks. All three participants must complete the fixed tasks before this gate passes.

## Release decision

Trace R01–R16 to evidence from the same release snapshot. Do not approve while data loss, wrong-target edits, broken bindings, source corruption, native build/launch failures, required visual mismatches, or essential accessibility issues remain open. Pending environment or participant checks keep the release gate pending.
