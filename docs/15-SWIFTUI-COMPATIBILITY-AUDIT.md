# SwiftUI compatibility audit, 2026-09-17

Follow-up: [visual and interaction checklist](16-SWIFTUI-VISUAL-CHECKLIST.md), including
new control/presentation fixes and the limits of native comparison.

The app does **not** implement all of SwiftUI or Swift. It evaluates a Swift subset in a
worker and draws a browser approximation. A green preview is not proof that the same
source builds in Xcode, and a recognized view name is not proof that all its overloads work.

## What was tested

- 48 independent snippets, composed without the app templates, in light and dark mode.
- Actual render content, finite layout bounds, input values, button actions, tabs,
  sheets, bindings, and lifecycle callbacks, not just successful parsing.
- Focused regressions for layers, shapes, multiline editing, mixed navigation/alert
  flows, malformed source, runtime traps, large allocations, nested collections, and recovery.
- Worker deadline tests for successful calls, hangs, queued requests, crashes,
  disposal, and late responses.
- Existing integration and appearance regression suites.

The stress suite separates **working behavior**, **known unsupported behavior with a report**,
and **invalid/resource-heavy code that must stop safely**. Passing an unsupported case
means its limitation is exposed; it does not mean the feature now works.

This is a bounded audit, not exhaustive testing of Apple's SDK. These new snippets have
not been compared pixel by pixel with native Xcode output. Existing native-reference
appearance tests remain useful, but cover a small screen fixture.

Run the focused checks with `npm run test:stress`; run type checking, lint and all unit
checks with `npm run verify`. Shared integration tests are now included in type checking.

## Fixed in this pass

| Failure found | Result after the change |
| --- | --- |
| `.background { ... }` and `.overlay { ... }` silently discarded their content | Builders render; layer controls and lifecycle handlers are registered; alignment is applied to view content |
| Valid `.background(.blue, in: RoundedRectangle(...))` reported an invalid argument | Built-in shape clipping works; valid labels are recognized; unsupported `fillStyle:` warns |
| `TextEditor(text:)` exposed no editable input | A multiline textarea reads and writes the String binding; preserves newlines |
| `.bold(false)` / `.italic(false)` enabled styling | The false argument is respected for the tested text/font forms |
| Two-parameter `onChange` received new/nil instead of old/new | Explicit old/new parameters receive the correct values; `initial: true` works; separate modifiers maintain separate previous values |
| `ForEach` ranges silently stopped after 1,000 rows | Oversized range and array collections produce an explicit preview-limit error |
| Negative repeat counts returned empty arrays/strings | They produce a runtime diagnostic |
| Huge array/range/string construction could bypass the statement budget | Materialization, repetition, concatenation, append, and nested repeat copies now have limits |
| Nested collections could construct excessive numbers of views | A per-pass view-construction limit stops them |
| Invalid frame sizes leaked negative/nonfinite render bounds | Invalid fixed/minimum sizes are rejected; maximum infinity remains supported; a final geometry check rejects invalid render bounds |
| A failure after an initial lifecycle update could be hidden by the earlier screen | The failed evaluation is reported |
| Missing environment values silently became `nil` | An explicit unsupported-runtime diagnostic identifies the environment lookup |
| Worker RPCs could wait indefinitely; failed workers were dropped without termination | RPC deadlines reject pending calls and terminate the worker; the next edit/Run can start a fresh worker |
| Generated-project validation ignored lifecycle error logs | Initial lifecycle failures appear in the validation issues |

These changes preserve the Swift source for export. Preview resource limits are tool
limits, not claims about what native Swift supports.

## Important remaining gaps

| Area | What currently works | What is missing or approximate |
| --- | --- | --- |
| Basic layouts | Stacks, spacers, grids, padding, ordinary frames, scrolling | Custom `Layout`/`AnyLayout`; grid spans; ideal frame dimensions; coordinate-space APIs; full layout parity |
| Collections | Plain/range `ForEach`, common lists/forms/sections, identity, deletion | `List($items)` / `ForEach($items) { $item in ... }`; lazy virtualization; full move/swipe behavior; large datasets |
| Navigation | Destination/value `NavigationLink`, `navigationDestination(for:)`, ordinary tabs | `NavigationStack(path:)` synchronization; `navigationDestination(isPresented:)` and `item:`; full split-view behavior; interactive back gesture |
| Text entry | String-backed `TextField`, masked `SecureField`, multiline `TextEditor` | `TextField(value:format:/formatter:)`; multiline `axis:` fields; native focus/keyboard behavior; advanced editor selection APIs |
| State and models | Common `@State`, `@Binding`, observable objects, declaration initializers | `_count = State(initialValue:)`; `@Bindable`; custom property-wrapper semantics; full Observation behavior |
| Environment | Built-in keys and scoped injections | Custom `EnvironmentKey.defaultValue`, type-based environment lookup, full environment/trait behavior |
| Lifecycle | Common appear/disappear, tested one-value and explicit zero/two-parameter changes | Full native lifecycle scheduling; shorthand two-argument change-closure inference; every overload is not audited |
| Images and symbols | Ionicons mappings for system-image names; AsyncImage placeholders | Actual SF Symbols parity, arbitrary asset catalogs, remote image loading, AsyncImage phase handling |
| Time and concurrency | Date values and some formatting; synchronous task bodies | Real suspension, cancellation and scheduling; `Task.sleep` delays; TimelineView updates/context; Calendar/DateFormatter |
| Persistence and system APIs | Preview state and session-scoped AppStorage | Durable UserDefaults parity, SwiftData/Core Data, networking/services, platform permissions, UIKit/AppKit views |
| Effects and animation | Common transforms, opacity, blur, basic CSS animations | Many masks/compositing/symbol effects; matched geometry; keyframe/phase animators; native spring/transition semantics |
| Swift language checking | Many declarations, expressions, control flow and basic Foundation shims | Real Swift type checking, generic constraints, complete overload resolution, actors, general macros, arbitrary packages/frameworks |

Some valid Swift still receives an unresolved-name error, for example binding-collection
closure aliases and wrapper backing storage. Those are preview gaps, not mistakes in the
user's Swift source.

### Known unsupported views and related constructors

The registry explicitly lists:

- `EquatableView`, `Table`, `TableColumn`, `OutlineGroup`, `MultiDatePicker`.
- `Chart`, `BarMark`, `LineMark`, `PointMark`, `AreaMark`, `RuleMark`.
- `Map`, `Marker`, `Annotation`, `VideoPlayer`, `SceneView`, `PhotosPicker`.
- `Settings`, `MenuBarExtra`, `DocumentGroup`.
- `EditButton`, `PasteButton`, `RenameButton`.
- `AnyShape`, `MeshGradient`.

This list includes framework helpers as well as views. It is not an exhaustive list of
Apple APIs missing from the preview. The full in-repo registries live in
[`builtins.ts`](../packages/swift-sema/src/builtins.ts); known modifier gaps include
`safeAreaPadding`, `gridCellColumns`, `symbolEffect`, masks, z-index, scroll positioning,
refreshing, several toolbar settings, drag/drop and advanced accessibility.

## Preview safety boundaries

| Boundary | Limit / behavior |
| --- | --- |
| Statement execution | Existing 5,000,000-step budget |
| Swift call recursion | Existing 512-call budget |
| Recursive view expansion | Existing 120-level guard |
| One collection of views | 1,000 elements, reported rather than silently truncated |
| Constructed framework views | 10,000 per evaluation pass |
| Guarded array/range materialization and array growth | 100,000 elements |
| Guarded string repetition/concatenation | 1,000,000 characters |
| Nested repeated value copies | 1,000,000 estimated copied values; bounded nesting |
| Worker request | 12 seconds before all pending requests are rejected and the worker terminates |

These guards reduce specific CPU/memory risks found in testing. They are **not** a complete
memory sandbox: all standard-library allocations and all pathological parser inputs are
not yet individually bounded. Browser memory pressure and native-worker startup failures
still need broader testing. The worker deadline protects responsiveness when cooperative
runtime checks cannot run.

## Recommended implementation order

1. **Common generated-code compatibility:** collection bindings, state backing initializers,
   `@Bindable`, and numeric/multiline TextField overloads. Add interaction regressions for each.
2. **Programmatic navigation and environment:** bound paths, binding-driven destinations,
   custom environment defaults, and supported focus behavior.
3. **Safe generation feedback:** extend the existing preview validation into a bounded repair
   loop with explicit unresolved issues. Retain the user's source when conversion is incomplete.
4. **Scale and semantic coverage:** virtualization, parser-depth/source-size guards,
   remaining allocation paths, lifecycle scheduling, and a larger independent snippet corpus.
5. **Native comparison:** compile the same fixtures with the selected Xcode SDK; compare
   interactions and screenshots per device/text size. Treat browser-only successes as provisional.

Full Apple framework execution requires a native build/runtime path. A browser subset can
be useful and robust, but should report its boundaries rather than promise universal SwiftUI.

API behavior references: Apple's [layering content guide](https://developer.apple.com/tutorials/swiftui-concepts/layering-content),
[onChange](https://developer.apple.com/documentation/swiftui/view/onchange(of:initial:_:)),
and [bold](https://developer.apple.com/documentation/swiftui/view/bold(_:)).

## Validation from this pass

- Full unit/integration run: **2,233 passed, 1 intentionally skipped**.
- New focused stress checks: **130 tests** across the corpus, regressions,
  generated-preview validation, and worker deadlines; included in the full run.
- Production build, lint, workspace type checks, and shared integration-test type checks passed.
- Bundle budget passed with warnings: 459.7 KB gzip of a 470 KB total allowance;
  162.4 KB largest chunk of a 172 KB allowance.
- Production browser check: edited a real multiline textarea; observed the bound Text update;
  clicked an overlay button; observed count and old/new callback output; checked that a
  billion-character repeat request was rejected and the next valid edit rendered normally.
- No new native Xcode comparison or complete Playwright E2E run was performed in this pass.
  Local Playwright launch was blocked by macOS sandbox restrictions in the preceding checks;
  the browser verification above used the available in-app browser.
