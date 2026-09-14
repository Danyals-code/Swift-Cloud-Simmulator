# 03 — Roadmap and phases

## How to read this

Each phase has a **goal**, a **scope**, **deliverables**, and an **acceptance gate**. The gate is a
demonstrable, testable statement — if it does not pass, the phase is not done and the next phase
does not start. Sizing is given as focused-developer weeks; treat it as relative weight rather than
a promise, and expect it to compress substantially when the implementation is AI-assisted.

The sequencing principle: **prove the riskiest thing earliest.** The two things most likely to sink
this project are the layout engine (R1) and export correctness (G3). Both are forced to the front —
export ships as a walking skeleton in Phase 0, and layout lands in Phase 3 rather than being
deferred to a polish pass.

```
P0 Skeleton ─▶ P1 Parser ─▶ P2 Runtime ─▶ P3 SwiftUI + Layout ─▶ P4 IDE ─▶ P5 Export ─▶ P6 Breadth
                                                │                                          │
                                                └──────────── vertical slice demo ─────────┘
                                                                                           ▼
                                                                            P7 Optional (verify, AI, cloud)
```

---

## Phase 0 — Skeleton and deployment (≈1 week)

**Goal:** A URL on Vercel that loads an editor, round-trips text through a Web Worker, and downloads
a zip. Nothing Swift-aware. This de-risks the whole toolchain before any hard work begins.

**Scope**
- npm workspaces + Turborepo monorepo, TypeScript strict, ESLint boundary rule (`swift-*` may not import React).
- Next.js 16 app, deployed to Vercel on push, preview deployments on PRs.
- CodeMirror 6 mounted with a placeholder Swift highlighter (Lezer grammar).
- Comlink worker wired end-to-end: send text, receive a fake diagnostic, render it as a squiggle.
- Split-pane layout: file tree | editor | device frame (empty).
- IndexedDB persistence of a single hard-coded file.
- `fflate` export of the raw files as a `.zip` — the walking skeleton of Phase 5.
- CI: typecheck, lint, unit tests, Playwright smoke, bundle-size budget check.

**Deliverables:** deployed URL, green CI, `ARCHITECTURE.md` links resolving to real packages.

**Gate**
1. Editing text persists across reload.
2. A synthetic diagnostic from the worker appears as an editor squiggle.
3. Downloaded zip contains the edited text, byte-identical.
4. CI fails if the shell bundle exceeds 350 KB gzipped.

**Risk addressed:** deployment, worker, and bundle-budget surprises found on day 3, not month 3.

---

## Phase 1 — Swift front end (≈3–4 weeks)

**Goal:** Real Swift parsing with real diagnostics. No execution yet.

**Scope**
- `swift-syntax`: complete lexer (including string interpolation, multiline strings, raw strings,
  operators, trivia) and a recursive-descent parser covering the Tier 1 grammar in
  [04-SWIFT-SUBSET.md](04-SWIFT-SUBSET.md).
- First-class error recovery: `ErrorNode`, resynchronisation at `{` `}` and declaration keywords.
- Every AST node carries a `SourceRange`.
- Incremental reparse driven by CodeMirror change sets.
- `swift-sema`: scope building, symbol table, module-level declaration collection, the simplified
  bidirectional type checker, protocol conformance checking.
- Diagnostic model with Swift-matching wording and fix-its.
- Editor integration: semantic highlighting, squiggles, hover types, problems panel.

**Deliverables:** parser golden-test corpus (150+ snippets), type-checker table tests, live
diagnostics in the editor.

**Gate**
1. The 40-project conformance corpus parses with zero unexpected errors.
2. Deleting a closing brace mid-file still yields a usable AST for the rest of the file.
3. Keystroke-to-diagnostics p95 under 120 ms on a 500-line file (measured in CI).
4. Zero false-positive errors on the corpus — a false error is worse than a missed one.

---

## Phase 2 — Swift runtime (≈3–4 weeks)

**Goal:** Execute Swift. Still no UI — verified through a REPL-style console and `print()`.

**Scope**
- `swift-runtime`: tree-walking interpreter over the TypedAST.
- The value model: struct/enum value semantics, class reference semantics, COW arrays and
  dictionaries, `inout` copy-in/copy-out, `mutating` enforcement.
- Closures with correct capture semantics; escaping vs non-escaping.
- Optionals, `if let`/`guard let`/`??`, optional chaining.
- Protocols, witness tables, extensions, default implementations, generics-lite (erased).
- `throws` / `try` / `do-catch` / `Result`.
- Stdlib shims: `String` (grapheme-correct), `Array`, `Dictionary`, `Set`, numerics with overflow
  traps, `Date`, `UUID`, `Codable` over JSON, `print`.
- Step budget, Swift-style stack traces, `SwiftTrap` for runtime failures.
- Async scheduler: generator-based `await`, `Task`, `Task.sleep`, `MainActor`, `async let`.
- A temporary console page: run a `.swift` file, see `print` output and traps.

**Deliverables:** interpreter test suite, console playground page.

**Gate**
1. A struct assigned to a second variable and mutated does not affect the first; a class does.
2. `inout` write-back, `mutating` methods, and closure capture all behave per the Swift spec tests.
3. An infinite `while true` aborts inside the budget with a diagnostic naming the source line.
4. Force-unwrapping nil produces a trace pointing at the correct line and column.
5. An async chain with `Task.sleep` resolves in the right order.

---

## Phase 3 — SwiftUI runtime, layout, and live preview (≈5–7 weeks) ★ the hard one

**Goal:** The core promise. Type SwiftUI, see an interactive iPhone.

**Scope**

*3a — view graph*
- `@ViewBuilder` result builder support, `some View`, view value trees.
- `ViewIdentity` computation; state boxes keyed by identity.
- Property wrappers: `@State`, `@Binding`, `@StateObject`, `@ObservedObject`, `@EnvironmentObject`,
  `@Environment`; `ObservableObject` + `@Published`; the `@Observable` macro shape.
- Dependency tracking and subtree invalidation.

*3b — layout engine*
- `ProposedSize` / `sizeThatFits` / `place` protocol.
- `VStack HStack ZStack Spacer Divider Group ForEach ScrollView GeometryReader`.
- Modifier list semantics with correct ordering: `frame padding background overlay fixedSize
  layoutPriority offset aspectRatio clipShape`.
- Text measurement service on the main thread with hard caching, `Intl.Segmenter` line breaking, and
  the metric-compatible font stack.
- Flat `RenderTree` output with absolute frames.

*3c — renderer and shell*
- Absolutely positioned DOM renderer, diffed by identity.
- Core views: `Text Image Button Toggle TextField Slider Stepper ProgressView Label`, shapes,
  `Color` (including semantic colours and dark mode), gradients.
- SF Symbol name → open icon set mapping, with an "approximated" badge in the inspector.
- Hit testing, tap dispatch back into the worker, state mutation, re-render.
- Device chrome: iPhone SE / 15 / 16 Pro Max frames, safe areas, status bar, home indicator.
- Hot reload preserving `@State`; explicit reset control.
- Console panel; unsupported-feature placeholders (FR-4.11).

**Deliverables:** layout golden-test suite, visual baselines, working interactive preview.

**Gate**
1. A counter app — `@State`, a `Button`, a `Text` — increments in the preview on tap.
2. `HStack { Text("a"); Spacer(); Text("b") }` places both texts exactly as SwiftUI does, verified
   against a hand-authored golden frame set.
3. `.padding().background()` and `.background().padding()` render differently and correctly.
4. `GeometryReader` reports the correct size in a nested stack.
5. Editing a view's colour updates the preview in under 250 ms **without** resetting an unrelated
   counter's `@State`.
6. An `ObservableObject` shared by two sibling views updates both on mutation.
7. All NFR-1 interaction budgets met.

**Why this is the hard one:** every decision in [02-ARCHITECTURE.md](02-ARCHITECTURE.md) §6–§8 gets
tested for real here. If the layout engine is going to be wrong, it will be wrong in this phase, and
the two-pass design exists specifically so the wrongness is localised and fixable rather than
structural.

---

## Phase 4 — IDE experience (≈3 weeks)

**Goal:** Make it feel like a tool rather than a demo.

**Scope**
- Multi-file projects: file tree with create/rename/delete/move, tabs, Ctrl+P switcher.
- Cross-file name resolution and diagnostics.
- Project manifest (`studio.json`): app name, bundle id, deployment target, default device.
- Completions from the symbol table: members, types, modifiers, SF Symbol names, snippets.
- Find/replace across the project.
- Template gallery (8 templates) and a sample-project browser.
- View inspector: hover to highlight, frame and modifier readout, jump to source.
- Preview controls: dark mode, Dynamic Type, orientation, device picker, zoom.
- Asset import with an `Image("name")` resolver.
- Onboarding: first-run tour, keyboard shortcut sheet.

**Gate**
1. Create a second file, define a type, use it from the first — completions and diagnostics work
   across the boundary.
2. Every template loads and renders with zero unsupported placeholders.
3. Clicking a rendered element in the inspector jumps the editor to the right line.
4. Dark mode and Dynamic Type changes re-render correctly without losing state.

---

## Phase 5 — Export (≈2–3 weeks)

**Goal:** The output is real. This is the phase that makes the product worth using rather than
worth playing with.

**Scope**
- `exporter`: deterministic `project.pbxproj` generator (groups, file refs, build phases, native
  target, Debug/Release configs, deterministic hashed 24-hex IDs).
- `Assets.xcassets` generation with per-set `Contents.json`, AppIcon, AccentColor.
- `Info.plist` values from the manifest.
- `.swiftpm` app package (`AppleProductTypes`, `.iOSApplication` product).
- `Package.swift` SwiftPM form.
- `project.yml` for XcodeGen.
- `README.md` with build instructions and an explicit note listing anything the preview approximated.
- Zip assembly with `fflate`; copy-file and copy-project to clipboard.
- Share-by-URL: project compressed into the URL fragment.
- Byte-identity test across the whole corpus.

**Gate**
1. Export the List + Detail template, open on a Mac, build and run — **zero** edits required.
2. Re-exporting an unchanged project produces a byte-identical zip.
3. `.swiftpm` opens and runs in Swift Playgrounds on iPad.
4. Every `.swift` file in the export is byte-identical to the editor buffer (automated).
5. A share URL round-trips a project into a fresh browser profile.

**Note:** gate 1 and 3 need a Mac and an iPad to verify. Plan for that access before the phase
starts — it is the one external dependency in the whole roadmap.

---

## Phase 6 — Coverage and fidelity (≈4–6 weeks, continuous thereafter)

**Goal:** Handle the SwiftUI people actually write. Driven by telemetry, not guesswork.

**Scope**
- Navigation: `NavigationStack`, `NavigationLink`, `navigationDestination`, `navigationTitle`,
  `toolbar`, `TabView`, `NavigationSplitView`, back gesture.
- Lists: `List`, `Section`, `Form`, styles, swipe actions, `onDelete`/`onMove`, `refreshable`,
  `searchable`.
- Presentation: `sheet` (with detents), `fullScreenCover`, `alert`, `confirmationDialog`, `popover`.
- Animation: `withAnimation`, `.animation(_:value:)`, transitions, spring curves,
  `matchedGeometryEffect`, `phaseAnimator`.
- Gestures: drag, long-press, magnify, rotate, simultaneous and sequenced composition,
  `@GestureState`.
- Grids: `LazyVGrid`, `LazyHGrid`, `Grid`, adaptive columns.
- Lazy stacks with real virtualisation.
- `Canvas`, `Path`, `TimelineView`, `Chart` basics.
- `URLSession` shim + proxy + mock mode; `AsyncImage`.
- Environment breadth: locale, RTL, size classes, accessibility settings.
- Strictness lint pass (R5): flag constructs the interpreter tolerates but swiftc would reject.
- Telemetry dashboard ranking unsupported features by hit count.

**Gate**
1. Corpus grows to 100 projects, all rendering without placeholders.
2. Top 20 telemetry-reported unsupported features are implemented or explicitly, publicly declined.
3. A three-screen navigation flow with a sheet and animated transitions works end to end.
4. The strictness linter catches a curated set of "works here, fails in Xcode" cases.

**Status (first pass complete):** gates 3 and 4 pass. Gate 1 stands at 11 corpus projects, not 100 —
see [06-VERTICAL-SLICE.md](06-VERTICAL-SLICE.md) §4.15 for why a hundred authored in one pass would
be padding rather than coverage. Gate 2 cannot be met until the tool is used by someone: the
telemetry instrument is built and visible in the studio, and its ranking is empty by construction
until there is usage to rank. Navigation, lists, presentation, grids, controls, bindings, animation
and the strictness pass all landed; gestures beyond tap, `matchedGeometryEffect`, virtualisation,
`Canvas`/`Chart`, networking and environment breadth moved to Phase 7.

---

## Phase 7 — Optional extensions (scoped individually)

These are independent; pick per the answers to the open questions in
[01-REQUIREMENTS.md](01-REQUIREMENTS.md) §9.

| Item | Size | Notes |
| --- | --- | --- |
| **7a — Real swiftc verification service** | ≈2 weeks | A container (Fly.io / Railway — *not* Vercel, which cannot host the Swift toolchain) running `swiftc -typecheck` against SwiftUI interface stubs. Gives a "verified compiles" badge and settles R5 permanently. Roughly $20–40/mo. |
| **7b — Accounts and cloud projects** | ≈2 weeks | GitHub OAuth, Vercel Postgres + Blob, short links, forking, project gallery. |
| **7c — AI codegen** | ≈2 weeks | Claude API via a Node route handler; describe-a-screen, explain-this-error, fix-it. Always presented as an approvable diff (FR-9.3). |
| **7d — GitHub export** | ≈1 week | Push the project to a new or existing repo via OAuth. |
| **7e — Embeddable previews** | ≈1 week | `/embed/[id]` read-only iframe for docs and blog posts. |
| **7f — Collaboration** | ≈3 weeks | CRDT (Yjs) multiplayer editing with shared preview. Substantial; only if there is real demand. |
| **7g — macOS / visionOS targets** | ≈3 weeks | Different device chrome, different default styles, `WindowGroup` semantics. |

### 7h — SwiftUI breadth — **done (2026-09-14)**

Not in the original list, because the original plan assumed Phase 6 would finish the coverage
matrix. It did not: Phase 6 built the navigation and list spine and moved the rest here. This is
that rest, and it is what was chosen when Phase 7 opened.

**Language first, because the views needed it.** `ObservableObject` requires reference semantics,
and the parser rejected `class`, `enum`, `switch`, `guard`, `while` and optional binding outright —
a bigger fidelity gap than any single view. Classes, enums with raw and associated values, pattern
matching, condition lists, loops and `static` members all landed, along with the observation
wrappers built on them.

**Then the views:** `GeometryReader` (two-pass), `Grid`, `ViewThatFits`, gestures with
`@GestureState`, the lifecycle modifiers, `Path` and `Canvas`, filters, materials, transitions,
`.searchable`, `.onDelete` with a real swipe, and the accessibility modifiers.

The matrix moved from 51 ✅ to 89 ✅. What remains ⬜ is now mostly marked "—" rather than a phase:
each is either genuinely out of scope for a browser preview (`.refreshable`, `TimelineView`,
`.onReceive`) or a larger piece of work that should be chosen deliberately rather than swept up
(generics, `async`/`await`, `matchedGeometryEffect`, real lazy virtualisation).

---

## Phase 8 — Language depth and IDE depth — **done (2026-09-14)**

Not in the original plan either. Phase 7 closed with the coverage matrix at 89 ✅, and what
remained split cleanly in two: constructs the *language* could not express, and an editor that
had syntax colouring and diagnostics and nothing else. Both were chosen together, and the order
was forced — the editor features need a symbol index, and the language decides what symbols
exist.

### The language half

| | |
| --- | --- |
| **8a** | `protocol`, requirements, `extension`, protocol defaults, class inheritance |
| **8b** | generics, erased |
| **8c** | `throws` / `try` / `do-catch`, `inout`, `super` |
| **8d** | `async` / `await` / `Task`, run synchronously |
| **8e** | custom `ViewModifier`, `extension View` |

**One merge, shared.** Once `extension` exists a declaration no longer knows all of its own
members — they may be written in the type, in any number of extensions, in a protocol it conforms
to, or in a superclass. `collectConformance` does that merge once, in `swift-syntax`, because the
checker and the interpreter are sibling packages and anything either derived privately would
drift. Precedence and emission order turned out to be separate questions: own beats extension
beats protocol default beats inherited, but they are *emitted* in declaration order, which is what
stored-property initialisation needs.

Three decisions worth keeping:

- **Generics are erased.** A dynamically typed interpreter carries the real value whatever the
  annotation said, so a substitution pass would compute something nothing reads. Names resolve,
  constraints are recorded, nothing is enforced.
- **Concurrency does not suspend**, and that is one rule rather than several special cases. The
  alternatives need suspension the interpreter does not have, and a half-built version would make
  ordering depend on which case a program happened to hit.
- **`super` resolves against the type that declared the running method**, not the receiver's type.
  The two agree at two levels and disagree at three, where the receiver reading recurses forever.

### The IDE half

| | |
| --- | --- |
| **8f** | the symbol index: completion, go to definition, hover, references |
| **8g** | quick fixes — "did you mean", "add a body", "mark as mutating" |

This is Phase 4's shortfall. `@codemirror/autocomplete` was not installed.

The governing rule is the editor's version of gate 4: **a wrong answer is worse than no answer.**
A list that omits something costs a keystroke; one that offers a name which does not exist, or
jumps to the wrong declaration, teaches the user not to trust the editor — and then the feature is
worse than absent. So a `.` whose receiver cannot be resolved offers modifiers and nothing else, a
contextual `.home` matching two enums offers no jump at all, and a typo suggests a replacement only
when the edit distance is small relative to the name's length.

The index is stateless. Completion could reuse the parse from the last compile, but the editor asks
*between* compiles — that is what the debounce is for — so the cached tree is one keystroke stale
exactly when it is consulted.

**What Phase 8 found by accident**, each shipped in an earlier phase and each fixed here: a parser
that hung on `case .some(let v)` because `some` is a keyword and `expectIdentifier` reports without
advancing; two loops with no progress guard; a `catch` clause whose span ended at its own opening
brace; a `static let` counted as a stored property; `Rect(width: 3)` storing an `Int` in a `Double`
field; and the host shadowing a project's own `Task` type, which is Swift's rule backwards.

The matrix moved from 89 ✅ to **95 ✅ · 39 🟡 · 29 ⬜ · 3 ✗**.

Still unbuilt and marked as such: `ButtonStyle` and friends (the style has to travel down the
environment), `Layout`, `PreferenceKey` (a value travelling *up* the tree), `Animatable`, and
structured concurrency.

---

## Phase 9 — The deferred items that need no one else's servers — **done (2026-09-14)**

Phase 8 closed with a short list of things marked "still unbuilt", and a separate list
of Phase 7's à-la-carte items that each need a container host, an API key or an OAuth
app. This phase is everything in the first list that could be finished without
anything in the second.

| | |
| --- | --- |
| **9a** | custom `ButtonStyle` |
| **9b** | `.swiftpm`, `Package.swift` and `project.yml` exports |
| **9c** | share links, carried in the URL |

**9a — the resolver is the only traversal that sees the whole tree.** A style is not a
modifier on the view it is written on: it applies to every `Button` *below* it, which
is what makes one line at the top of a screen restyle all of them. So the resolver
carries a stack of styles in scope rather than each button reading a modifier where it
sits. The `Button` itself survives and only its label changes — its action, path and
hit target are the button's *behaviour*, and a style describes appearance.

**9b — three formats, three different questions.** `.swiftpm` is the only route from
the browser to a real device that does not involve a Mac. `Package.swift` is for
depending on the code. `project.yml` is for teams who would rather generate the Xcode
project than commit it. Phase 5's gate 2 now applies across the format list rather
than per format, so a format added later cannot opt out of "the bytes arrive
unchanged" quietly.

**9c — the local-only decision made share links easier, not harder.** Phase 0 recorded
"no `/api/share`, no database, no accounts", which reads like a reason links could not
exist. A link that needs a server needs an owner, a retention policy and a bill, and
rots when any lapses; a link that carries its own payload needs none of them. The cost
is a size limit, and the limit is set by chat clients rather than browsers.

### What Phase 9 deliberately did not build

Each of these was looked at and left, with the reason:

| | Why |
| --- | --- |
| Custom `ToggleStyle` / `LabelStyle` | The same mechanism as `ButtonStyle`, except a Toggle's configuration carries a **binding** the style writes through. Half of that is worse than none. |
| `Layout` protocol / `AnyLayout` | Needs a `Subviews` proxy and callbacks from `swiftui-layout` back into the interpreter — a real seam, and custom layout conformances are rare in app code. |
| `PreferenceKey` | A value travelling *up* the tree needs a second pass and a re-render when a handler writes state. `GeometryReader` already covers most of what people reach for it for. |
| `Animatable` | Interpolating an arbitrary value needs an animation system that owns the frames. Ours is CSS keyframes, deliberately. |

The matrix moved to **96 ✅ · 39 🟡 · 29 ⬜ · 3 ✗**.

---

## Phase 10 — Loose ends, and measuring the right thing — **done (2026-09-14)**

No new pillar. Three things that had been carried for several phases, each because it
looked smaller than the next feature.

| | |
| --- | --- |
| **10a** | project-wide rename, and in-file find/replace |
| **10b** | the bundle gate was measuring bytes nobody downloads |
| **10c** | `#Preview`, which was a parse error |

**10a.** Phase 8 built a `references` worker API and never called it; Phase 4 listed
find/replace as not built. Writing the tests changed the implementation: references
are matched on **lexer tokens**, not text, because the lexer already knows what a
comment and a string literal are — and those are the two places a textual rename
corrupts something that leaves no compile error behind. The opposite case needed work
too: a string interpolation is code inside a literal and is not in the flat token
stream, so a rename would have stopped at the quote.

What it still cannot do is tell two different symbols sharing a spelling apart. So the
rename bar states the count and the spread *before* anything changes: "12 occurrences
in 3 files" is how ambiguity the analyser cannot resolve gets handed to the person who
can.

**10b.** The budget had read WARN for four phases while the README said "worth
watching". Watching it properly found that Next's polyfill bundle — served behind
`nomodule`, so no browser that can run a Web Worker ever fetches it — was counted in
full. That is 38 KB, a tenth of the budget, and it would eventually have forced a real
feature to be cut to pay for bytes that were never sent. Excluding it took the
measured number from 405.8 KB to **367.2 KB** without a byte changing hands, which is
recorded in the script's history note, because a number that falls for a reason other
than a change in the payload has to say so.

The second half of that correction matters more than the first. The gate claimed to
measure "everything the browser downloads to open the editor". It measures total
shipped bytes — a legitimate ratchet, but a poor proxy for load time, and the two
*disagree*: moving code behind a dynamic import makes the first paint smaller and the
total very slightly larger. A gate that punishes making the app faster will eventually
be obeyed.

**10c.** `#` was an unexpected character, so a file with a `#Preview` block produced
three blocking errors — and modern SwiftUI almost always has one. Pasting real code in
gave a blank screen and a complaint about a character. The most expensive gap left in
the product, and three lines of lexer. A `#Preview` now also serves as the entry point
when nothing is `@main`, because a view plus its preview is an ordinary thing to paste
and is what Xcode itself renders.

### The shape of this phase

Every item was found by looking at something already shipped rather than by adding to
it: an API with no callers, a gate with a wrong metric, an error message about a
character. Each had been visible for phases. That is worth a note, because the reason
they survived is that a new feature is always more interesting than a number that has
said WARN four times.

Coverage: **98 ✅ · 39 🟡 · 29 ⬜ · 3 ✗**.

---

## Cross-cutting workstreams

Running through every phase, not bolted on at the end:

- **Conformance corpus.** Starts at 40 projects in Phase 1, grows to 100 by Phase 6. Every bug found
  in the wild becomes a corpus entry before it is fixed.
- **Performance budgets.** Enforced in CI from Phase 0. A PR that busts a budget fails.
- **Accessibility.** Audited at the end of each phase, not deferred.
- **Legal posture (R2/R4).** Font and icon substitution decided in Phase 3; attribution and
  "not affiliated with Apple" notices in place before any public launch.
- **Docs.** The coverage matrix ([05-SWIFTUI-COVERAGE.md](05-SWIFTUI-COVERAGE.md)) is updated in the
  same PR as any runtime change. It is the public contract for what works.

## Critical path and rough totals

| Path | Weeks (focused solo) |
| --- | --- |
| P0 → P1 → P2 → P3 | 12–16 — first genuinely impressive demo |
| + P4 → P5 | 17–22 — **usable v1.0**, meets the Definition of Done |
| + P6 | 21–28 — credible for real work |
| + P7 items | à la carte |

**Earliest meaningful milestone:** end of Phase 3 — a counter app and a styled layout, typed in
Chrome, running interactively. That is the moment the concept is proven or disproven, and it is
worth optimising the first three phases purely for reaching it.

## Decided path (2026-09-14)

Per [01-REQUIREMENTS.md](01-REQUIREMENTS.md) §9, the first pass is a **vertical slice**: a narrow
language and view subset carried all the way through to a working `.xcodeproj` export, rather than
each phase completed to full breadth in turn.

Concretely, that means phases run in order but each is *depth-limited* to what the slice needs:

| Phase | Full scope | Slice scope |
| --- | --- | --- |
| 0 | As written | **Unchanged** — the skeleton is the skeleton |
| 1 | Full Tier 1 grammar | Structs, functions, closures, literals, `if` / `for`, `@State` attribute parsing |
| 2 | Protocols, generics, async, full stdlib | Only what the above needs — no protocols, no generics, no async, minimal stdlib |
| 3 | All of 3a/3b/3c | `VStack` `HStack` `ZStack` `Text` `Button` `Color` `Spacer`, plus `frame` `padding` `background` `font` `foregroundStyle`, with `@State` |
| 4 | Full IDE | Deferred — single file is enough for the slice |
| 5 | Four export formats | `.xcodeproj` only |
| 6 | Breadth | **Reopened and largely built** — navigation, lists, presentation, grids, controls, bindings, animation, strictness lint, telemetry |
| 7 | Optional | 7a/7b/7c all deferred |

Roughly 5–7 weeks to something that types real Swift, renders a real interactive iPhone, and exports
a project Xcode opens. The exact slice contents and the Phase 0 task list are in
[06-VERTICAL-SLICE.md](06-VERTICAL-SLICE.md).

After the slice lands, the phases reopen in order to their full scope — the slice deliberately
builds the *spine* of every package, so widening each one is additive.

## Decisions recorded against this roadmap

- **Local-only storage.** No `/api/share`, no Postgres, no Blob, no auth in v1 — but
  `project-model` keeps persistence behind an interface so Phase 7b can add cloud without rework.
- **No AI features in v1.** Phase 7c only.
- **`.xcodeproj` is the one export format for v1.** `.swiftpm` / `Package.swift` / `project.yml`
  follow in the full Phase 5.
- **Mac access is required to close the Phase 5 gate** and is the only external dependency in the
  plan. Worth lining up before Phase 5 starts.
