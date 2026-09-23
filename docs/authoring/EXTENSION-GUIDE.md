# Extending source-aware authoring

## Boundaries

| Layer | Responsibility |
| --- | --- |
| `shared` | Serializable source spans, ownership, operation unions, worker protocol, capability contracts |
| `swift-syntax` / `swift-sema` | Parse, resolve, discover editable recipes, plan minimal source changes, reject ambiguity |
| `project-model` | Source files, binary image resources, metadata, versioned storage, atomic transactions and history |
| `swiftui-runtime` / `swiftui-layout` | Evaluate source, resolve appearance, measure real resource dimensions, produce render data |
| `swiftui-render-dom` | Paint render data and dispatch interactions; never regenerate Swift |
| `exporter` | Native scaffolding, resource catalogs, portable archives, bounded import, reviewed handoff merge |
| `apps/web` | Accessible controls, worker lifecycle, decode images before commit, exact-revision transaction coordination |

## Add an editable property

1. Declare its supported source forms and availability in the shared capability/writer manifests.
2. Discover a recipe from syntax and ownership. A runtime value is never proof of a writable literal.
3. Add a typed operation. Validate names, types, comments, deployment target, and scope in the worker.
4. Return minimal changes. Preserve modifier order, trivia outside the changed span, and identical bytes for no-op edits.
5. Reparse and check the complete candidate program. The store compares project identity, object, and revision again before committing.
6. Expose a labeled control with an explicit scope, a pending state, an actionable failure, and keyboard behavior.
7. Test semantic effects, wrong-target/stale rejection, source preservation, undo/redo, native source validity, and actual browser behavior independently.

`authoring-resources.ts` is the example for shared styles: immutable global/static Swift declarations are the values; metadata does not duplicate them. The three operations (shared update, link, and local override) stay distinct. Unsupported expressions remain source-owned.

## Resources and persistence

`Project.assets` holds `Uint8Array` image variants separately from `SourceFile.text`. Validate structural headers, dimensions, PNG CRC/inflation bounds, names, counts, and aggregate limits. The browser also decodes imports with `createImageBitmap` and closes each bitmap before commit. Resource changes and corresponding source patches belong to one `ProjectTransaction`.

Use the shared timeline for resource edits. Stored projects are cloned; writes are serialized. Import saves before publishing the new document and restores current work if its expected revision changes during persistence. Future project/metadata schemas fail explicitly without replacing the saved copy.

## Archive contract

- `.swiftstudio/project.json`: format/version, explicit project ID, app configuration, source path mapping and export baseline, stable asset IDs and paths. An optional `generator` names the Studio build that wrote the archive (commit and build time); import drops it unread, so archives open across builds.
- `.swiftstudio/studio.json`: optional designer-only metadata; no production layout values.
- Swift and image files: normal standalone archive entries. No derived caches are required.
- Source-baseline differences are expected during external editing. ZIP structure, CRC, and resource validation protect transport; baselines guide a visible merge and are not authentication.
- Read the complete central directory before inflation. Reject traversal, duplicate/case-colliding paths, symlinks, encrypted entries, truncation, invalid UTF-8, excess entries, oversized expansion, and missing referenced images.
- Limits: 48 MB archive bytes, 64 MB selected expansion, 512 entries, 8 MB Swift, 256 source files; per-resource limits live in `ASSET_LIMITS`. Unrelated binary entries are skipped without inflation.
- Matching IDs allow file-level three-way reconciliation. Concurrent edits to one file need a choice; the importer never invents a text merge. Images and empty-group differences require explicit review. Source references to removed images are validated in the compiler worker before commit.

Native export keeps source bytes unchanged. Asset catalogs work directly in the Xcode/XcodeGen app target. Package resources require the package's bundle: an unqualified `Image("Name")` normally searches the main bundle. See [SwiftUI image lookup](https://developer.apple.com/documentation/swiftui/image/init(_:bundle:)) and [Swift package resources](https://developer.apple.com/documentation/xcode/bundling-resources-with-a-swift-package). Do not rewrite exported source or claim package runtime parity without an intended-host test.

## Verification

Run `npm run verify`, `npm run build`, then `npm run budget`. The standard typecheck includes browser test sources. `tests/phase789.test.ts` covers resource/style/handoff behavior; `tests/authoring-release.test.ts` covers scale and isolation; `apps/web/lib/importProject.test.ts` injects persistence failures and races. The dedicated benchmark runs after functional tests, without competing workers.

Set `PHASE789_EXPORT_DIR` while running the Phase 7–9 tests to retain writer-generated exports. These exact Swift bytes are the input for Apple typechecking and native builds. `e2e/resources-handoff.spec.ts` and `e2e/authoring-latency.spec.ts` require an approved, working browser environment. Discovery is not execution.

Use the frozen visual contract and release checklist. Keep raw timings, export/resource hashes, traces, screenshots, native results, and the source snapshot identifier. Do not adjust expected output, image regions, budgets, or thresholds to conceal a regression.
