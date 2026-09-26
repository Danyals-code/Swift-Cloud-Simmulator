# 01 - Requirements

## 1. Product summary

A web application, deployed on Vercel and used in Chrome, that lets a developer:

1. Write Swift source code with SwiftUI structure, in a real code editor, across multiple files.
2. See that code render **live** as an interactive iOS app inside a simulated device frame.
3. Interact with the preview (tap buttons, type in fields, navigate, toggle state) and watch real
   Swift state mutate.
4. Export the project as something Xcode (or Swift Playgrounds) opens and builds unchanged.

The target user has an idea and a browser - possibly on Windows or a Chromebook - and wants to get
to a working SwiftUI codebase without first buying a Mac.

## 2. Goals

| ID | Goal |
| --- | --- |
| G1 | **Author real Swift.** The editor holds genuine `.swift` text; no DSL, no JSON, no visual-builder intermediate format. |
| G2 | **Fast, honest feedback.** Sub-250 ms edit-to-preview. Where the preview cannot be faithful, say so loudly rather than rendering a lie. |
| G3 | **Lossless export.** A downloaded project opens in Xcode and builds with zero manual fixes. |
| G4 | **Runs on Vercel.** No GPU, no container, no Swift toolchain needed for the core product. Everything heavy runs client-side in a Web Worker. |
| G5 | **Teach correct SwiftUI.** Diagnostics mirror real swiftc / SwiftUI error wording so skills transfer to Xcode. |
| G6 | **Zero-install.** No account required to start; open the URL and type. |

## 3. Non-goals

| ID | Non-goal | Why |
| --- | --- | --- |
| NG1 | Being a Swift compiler | We interpret a subset for preview purposes. Byte-accurate swiftc semantics are explicitly out of scope. |
| NG2 | Running arbitrary third-party SwiftPM packages | Dependencies can be *declared* and exported, but they will not resolve or execute in the preview. |
| NG3 | UIKit / AppKit / Objective-C interop | SwiftUI only. `UIViewRepresentable` renders as a labelled placeholder box. |
| NG4 | Replacing Xcode | This is an authoring and prototyping environment. Building, signing, profiling and shipping stay on a Mac. |
| NG5 | Pixel-perfect Apple rendering | Apple's fonts and symbols are not licensed for web redistribution (see R2). We target *structural and metric* fidelity, not pixel identity. |
| NG6 | Native performance emulation | The interpreter is orders of magnitude slower than compiled Swift. Not a benchmarking tool. |

## 4. Personas

- **P1 - Windows/Linux developer.** Wants to learn SwiftUI and produce a real project to hand to a
  Mac later. Cares most about export correctness and honest diagnostics.
- **P2 - Designer/PM prototyping a screen.** Cares about speed to a shareable interactive link and
  a good template library. Rarely exports.
- **P3 - Educator/student.** Cares about zero install, shareable snippets, embeddable previews, and
  error messages that match Xcode's.
- **P4 - iOS developer on the wrong machine.** Wants to sketch a view, check layout behaviour, and
  paste the result into a real project.

## 5. Functional requirements

### FR-1 - Code editor

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-1.1 | Swift syntax highlighting, bracket matching, auto-indent, comment toggling | Must |
| FR-1.2 | Inline diagnostics (error/warning squiggles plus hover detail) driven by our own parser and type checker | Must |
| FR-1.3 | Multi-file tabs and a project file tree with create/rename/delete/move | Must |
| FR-1.4 | Find/replace within file and across project | Should |
| FR-1.5 | Code completion: members, types, SwiftUI modifiers, SF Symbol names, snippet completions for `VStack` / `ForEach` etc. | Should |
| FR-1.6 | Go-to-definition and hover type info within the project | Could |
| FR-1.7 | Format-on-save (swift-format style rules, implemented in TS) | Could |
| FR-1.8 | Keyboard-first: Ctrl+S save, Ctrl+P file switcher, Ctrl+/ comment, Ctrl+B toggle preview | Should |
| FR-1.9 | Edits persist across reload without explicit save | Must |

### FR-2 - Project model

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-2.1 | Virtual file system: `Sources/**.swift`, `Resources/`, `Assets/`, plus a `studio.json` manifest (name, bundle id, deployment target, device, dependencies) | Must |
| FR-2.2 | A project has exactly one `@main` App entry point; missing or duplicate is a hard diagnostic | Must |
| FR-2.3 | Image asset import (PNG/JPEG/SVG) referenced by `Image("name")`, stored as blobs, exported into an `.xcassets` catalogue | Should |
| FR-2.4 | Colour assets and an app-icon slot | Could |
| FR-2.5 | Template gallery: Blank, List + Detail, Tab app, Form/Settings, Onboarding flow, Grid gallery, Timer, Networking demo | Should |
| FR-2.6 | Import an existing project by dropping a `.zip` or a folder of `.swift` files | Could |

### FR-3 - Swift language support

Full detail in [04-SWIFT-SUBSET.md](04-SWIFT-SUBSET.md). Summary:

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-3.1 | Tier 1 subset (structs, enums, classes, protocols, extensions, closures, optionals, collections, control flow, generics-lite, error handling) | Must |
| FR-3.2 | Value semantics for `struct` / `enum`, reference semantics for `class`, correct `mutating` rules | Must |
| FR-3.3 | Result builders sufficient for `@ViewBuilder` (including `buildIf` / `buildEither` / `buildArray`) | Must |
| FR-3.4 | Property wrappers: `@State @Binding @StateObject @ObservedObject @EnvironmentObject @Environment @AppStorage @SceneStorage @FocusState @Published`, plus user-defined wrappers | Must |
| FR-3.5 | `ObservableObject` plus `objectWillChange`, and the `@Observable` macro shape | Must |
| FR-3.6 | `async` / `await`, `Task`, `MainActor`, `Task.sleep`, `async let` - cooperatively scheduled on the worker's microtask queue | Should |
| FR-3.7 | Standard library shims: `String`, `Array`, `Dictionary`, `Set`, `Optional`, `Result`, `Date`, `UUID`, `Int`/`Double` maths, `Codable` via JSON | Must |
| FR-3.8 | `URLSession` shim backed by `fetch` (with a per-project allowlist and a mock mode) | Could |
| FR-3.9 | Unsupported syntax must produce a clear "not supported in preview" diagnostic that names the feature - never a silent wrong result | Must |

### FR-4 - SwiftUI runtime

Full matrix in [05-SWIFTUI-COVERAGE.md](05-SWIFTUI-COVERAGE.md). Summary:

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-4.1 | Core layout: `VStack HStack ZStack Spacer Divider Group ForEach ScrollView LazyVStack LazyHStack LazyVGrid GeometryReader` | Must |
| FR-4.2 | Core views: `Text Image Button Toggle TextField SecureField Slider Stepper Picker List Section Label ProgressView Link Menu DatePicker ColorPicker TextEditor` | Must |
| FR-4.3 | Shapes and styling: `Rectangle RoundedRectangle Circle Capsule Ellipse Path`, `Color` (including semantic and dark mode), gradients, materials | Must |
| FR-4.4 | Navigation: `NavigationStack`, `NavigationLink`, `navigationDestination`, `navigationTitle`, `toolbar`, `TabView`, `NavigationSplitView` | Must |
| FR-4.5 | Presentation: `sheet`, `fullScreenCover`, `alert`, `confirmationDialog`, `popover`, detents | Should |
| FR-4.6 | Gestures: tap, long-press, drag, magnify; `@GestureState` | Should |
| FR-4.7 | Animation: `withAnimation`, `.animation(_:value:)`, `.transition`, spring and easing curves, `matchedGeometryEffect` | Should |
| FR-4.8 | Lifecycle: `onAppear onDisappear task onChange onReceive refreshable searchable` | Should |
| FR-4.9 | Environment: colour scheme, dynamic type size, locale, size classes, safe-area insets | Should |
| FR-4.10 | `PreviewProvider` / `#Preview` macro - pick which preview to display | Could |
| FR-4.11 | Any unimplemented view or modifier renders a visible, labelled placeholder and logs a diagnostic - never fails silently | Must |

### FR-5 - Simulator / preview surface

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-5.1 | Device frames with correct logical point sizes and safe areas: iPhone SE (3rd gen), iPhone 15/16, 16 Pro Max, iPad 11-inch | Must |
| FR-5.2 | Interactive: real pointer and touch events dispatched into the interpreted view tree | Must |
| FR-5.3 | Hot reload that **preserves `@State`** where view identity is unchanged; full reset button available | Must |
| FR-5.4 | Light/dark toggle, Dynamic Type slider, orientation toggle, locale/RTL toggle | Should |
| FR-5.5 | Status bar, home indicator, and a working keyboard inset when a text field focuses | Should |
| FR-5.6 | Zoom/fit controls; side-by-side or stacked editor and preview layouts | Should |
| FR-5.7 | Runtime console: `print()` output, warnings, unsupported-feature notices, crash traces with Swift line numbers | Must |
| FR-5.8 | View-tree inspector: hover a rendered element to highlight it, show the view path, computed frame, applied modifiers, and jump to source | Should |
| FR-5.9 | Record an interaction as an animated GIF or MP4 for sharing | Could |

### FR-6 - Diagnostics and errors

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-6.1 | Every diagnostic carries file, line, column, length, severity, message, and optional fix-it | Must |
| FR-6.2 | Messages mirror real Swift wording where an equivalent exists (for example "Cannot convert value of type 'Int' to expected argument type 'String'") | Should |
| FR-6.3 | Parse errors must not blank the preview - keep showing the last good render, dimmed, with an error banner | Must |
| FR-6.4 | Runtime traps (force-unwrap nil, index out of range, arithmetic overflow) surface as a red overlay naming the Swift source line | Must |
| FR-6.5 | Infinite loop and runaway recursion guard: execution budget per render pass, then abort with a diagnostic | Must |

### FR-7 - Export

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-7.1 | `.zip` containing a generated `MyApp.xcodeproj` that opens and builds in Xcode with no edits | Must |
| FR-7.2 | `Package.swift` (SwiftPM form) for the sources | Should |
| FR-7.3 | `.swiftpm` app package that opens in **Swift Playgrounds** on iPad or Mac | Should |
| FR-7.4 | `project.yml` for XcodeGen as a human-readable fallback | Could |
| FR-7.5 | Copy single file, and copy whole project, to clipboard | Must |
| FR-7.6 | Push to a GitHub repo via OAuth | Could |
| FR-7.7 | Exported bundle includes assets catalogue, Info.plist values, deployment target, and a README with build instructions | Must |
| FR-7.8 | Export must be byte-identical to editor content for all `.swift` files, apart from the studio's own markers for hidden views and switched-off modifiers, which the native formats leave out (verified by test) | Must |
| FR-7.9 | Every archive carries the project's event log, `.swiftstudio/events.jsonl`: timestamped design edits with their change and layer type, bursts of typing, Undo and Redo, AI requests and how each ended, mode switches, reloads, recoveries and exports, with the build. Prompts are kept as written; the designer's code, text and values, and API keys, never are | Must |

### FR-8 - Persistence and sharing

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-8.1 | Local-first: projects live in IndexedDB, survive reload and offline | Must |
| FR-8.2 | Share by URL - small projects compressed into the URL fragment (no server round-trip, no account) | Should |
| FR-8.3 | Optional account (GitHub OAuth) with cloud projects, fork, and a stable short link | Could |
| FR-8.4 | Embeddable read-only preview iframe for blogs and docs | Could |
| FR-8.5 | Export and import a project as a single `.json` or `.zip` for manual backup | Should |

### FR-9 - AI assistance (optional, gated)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-9.1 | "Describe a screen, generate SwiftUI" using a hosted model API via a Vercel route handler | Could |
| FR-9.2 | "Explain this error" / "fix it" acting on a selected diagnostic | Could |
| FR-9.3 | Generated code is inserted as an editable diff the user approves - never applied silently | Must (if FR-9 ships) |
| FR-9.4 | API key held server-side only; per-IP rate limiting | Must (if FR-9 ships) |

## 6. Non-functional requirements

### NFR-1 - Performance budgets

| Metric | Budget |
| --- | --- |
| Shell JS (initial, gzipped) | 350 KB or less |
| Compiler/runtime worker bundle (lazy, gzipped) | 450 KB or less |
| First contentful paint, 4G, mid-tier laptop | 1.5 s or less |
| Time to first interactive preview (template project) | 3 s or less |
| Keystroke to diagnostics, 500-line file, p95 | 120 ms or less |
| Keystroke to preview repaint, p95 | 250 ms or less |
| UI interaction to state update to repaint, tree of 500 nodes or fewer | 32 ms or less |
| Export zip, 50 files | 2 s or less |
| Main-thread long tasks while typing | none over 50 ms |

### NFR-2 - Platform support

- **Primary:** Chrome/Edge 111+ on desktop (the explicit target).
- **Secondary:** Safari 16.4+, Firefox 115+.
- **Tolerated:** iPad Safari - editor usable, preview read-only.
- Requires: Web Workers, `structuredClone`, `Intl.Segmenter`, `OffscreenCanvas` (with fallback),
  IndexedDB, CSS container queries.

### NFR-3 - Reliability

- A worker crash must not take down the editor; the worker is restartable and the document is the
  durable state.
- All user code executes inside the worker with a wall-clock budget; runaway code is terminated, not
  left to hang the tab.
- Autosave debounced at 500 ms, plus save on blur and `visibilitychange`.

### NFR-4 - Security

- Interpreted user code never reaches `eval` or `new Function` - it runs on our own AST interpreter,
  so it cannot touch the DOM, `window`, cookies, or the network except through shims we provide.
- Network shims (`URLSession`) are opt-in per project and route through a Vercel proxy with an
  allowlist, preventing the app from being used as an open CORS relay.
- Shared or imported projects are treated as untrusted data: rendered, never executed outside the
  interpreter sandbox.
- No secrets in client bundles; any AI key stays in a server route handler.

### NFR-5 - Accessibility

- Editor and chrome meet WCAG 2.2 AA: keyboard-navigable, visible focus, 4.5:1 contrast.
- The *simulated app* renders SwiftUI `accessibilityLabel` and friends into ARIA attributes, so the
  preview is itself inspectable with a screen reader.
- Respect `prefers-reduced-motion` in the studio UI. The simulated app still animates, since that is
  the thing under test.

### NFR-6 - Observability

- Client error reporting with source maps.
- Anonymous, opt-out telemetry recording which SwiftUI views and modifiers hit the "unsupported"
  path. This directly prioritises the coverage backlog and is the single most valuable metric in the
  product.

## 7. Constraints and risks

| ID | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| R1 | **SwiftUI layout is not CSS.** Parent-proposes / child-responds cannot be faithfully emulated with flexbox; a naive mapping diverges on `Spacer`, `frame`, `fixedSize`, `layoutPriority`. | High | Implement a real two-pass layout engine (see Architecture). Do not build on flexbox. Budget a full phase. |
| R2 | **Apple asset licensing.** SF Pro and SF Symbols are not licensed for web redistribution; neither are device bezel images. | High | Ship an open font stack metric-matched to SF, and map SF Symbol *names* to an open icon set. Draw device frames in CSS, not Apple artwork. Show a "preview approximates system fonts and symbols" note. |
| R3 | **Scope explosion.** SwiftUI's surface area is enormous and growing. | High | The coverage matrix is the contract; everything outside it renders a labelled placeholder. Telemetry drives what gets built next, not guesswork. |
| R4 | **Trademark.** "Xcode", "SwiftUI", "iPhone" are Apple marks. | Medium | Nominative use only; no Apple logos; clear "not affiliated with Apple" footer; product name avoids "Xcode" and "Playground". |
| R5 | **Interpreter correctness drift.** Preview says fine, Xcode says error. | High | **Mitigated in Phase 6:** a strictness lint pass flags ten classes of construct the interpreter tolerates and swiftc rejects, most with a fix-it, reported as `may_not_compile_in_xcode`. Plus the golden-test corpus, and the optional Phase 7 real-swiftc verification service for the rest. |
| R6 | Text measurement differences (web text shaping vs CoreText) cause layout drift. | Medium | Centralise all measurement in one module with a metric-compatible font; snapshot-test line breaking. |
| R7 | Vercel serverless limits (bundle size, execution time) make server-side Swift impossible. | Medium | Accepted: core is 100% client-side. Any real toolchain work lives in a separate long-running service, off the critical path. |
| R8 | Interpreting a large view tree on every keystroke becomes slow. | Medium | Incremental reparse, memoised type resolution, dependency-tracked re-render so only subtrees whose observed state changed are invalidated. |

## 8. Definition of done (v1.0)

1. A new user opens the URL, picks the "List + Detail" template, and has an interactive preview in
   under 5 seconds with no account.
2. They edit a view, see it update in under 250 ms, and tap through navigation in the preview.
3. They add a second file, define an `ObservableObject`, wire it with `@StateObject`, and see state
   propagate.
4. They export a `.zip`, open it on a Mac, and a build-and-run succeeds with **zero** edits.
5. The 40 sample projects in the conformance corpus all render without an "unsupported" placeholder.
6. All NFR-1 budgets are met on the reference machine.

## 9. Decisions

Settled 2026-09-14. See [06-VERTICAL-SLICE.md](06-VERTICAL-SLICE.md) for the resulting build plan.

| # | Question | Decision | Consequence |
| --- | --- | --- | --- |
| Q1 | Build scope for the first pass | **Vertical slice first** - a narrow language and view subset carried all the way through to a working `.xcodeproj` export | Roughly 5-7 weeks to a demonstrable end-to-end product. Everything built is on the path to the full roadmap; nothing is throwaway. Breadth comes after the spine works. |
| Q2 | Export target priority | **`.xcodeproj` first** | Phase 5 builds the `project.pbxproj` generator. `.swiftpm`, `Package.swift` and `project.yml` follow once the VFS and asset pipeline exist. Gate verification needs Mac access. |
| Q3 | Accounts and storage | **Local-only** - IndexedDB plus share-by-URL-fragment | No database, no auth, no backend cost. The app is effectively a static site and works offline as a PWA. FR-8.3 (accounts) and `/api/share` move to Phase 7b; the project-model package must keep storage behind an interface so cloud can be added later without rework. |
| Q4 | Model-assisted code generation | **Deferred to Phase 7c** | No model API route, no key management, no rate limiting in v1. The product's headline is "browser IDE with a real preview", not "prompt to app". |
| Q5 | Fidelity ceiling | Client-side interpretation is the answer for v1; the real-swiftc verifier stays **optional (Phase 7a)** | R5 (interpreter drift) is managed by the golden corpus and the Phase 6 strictness linter rather than by a build service. |

Still open, not blocking: licence and business model (open source vs freemium vs private), which
affects the R2/R4 posture but nothing before public launch.
