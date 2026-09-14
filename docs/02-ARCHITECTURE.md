# 02 — Architecture

## 1. The shape of the system

```
┌─ Main thread (React / Next.js) ──────────────┐   ┌─ Web Worker ─────────────────────────┐
│                                              │   │                                      │
│  CodeMirror editor ──── edits ──────────────────▶ │  1. Lexer        (swift-syntax)      │
│  File tree / tabs                            │   │  2. Parser  → AST                    │
│  Device chrome + controls                    │   │  3. Sema    → resolved AST + types   │
│                                              │   │  4. Interpreter (swift-runtime)      │
│  Renderer  ◀──── RenderTree (structuredClone) │◀──│  5. View graph  (swiftui-runtime)    │
│    · absolutely positioned DOM               │   │  6. Layout pass (swiftui-layout)     │
│    · animations, gestures                    │   │                                      │
│  Events   ─────── UIEvent ──────────────────────▶ │  7. Event dispatch → state mutation  │
│  Console / diagnostics panel  ◀── Diagnostic ─────│     → invalidate → re-render         │
└──────────────────────────────────────────────┘   └──────────────────────────────────────┘
                    │
                    ▼
            Exporter (main thread, lazy) → JSZip → .xcodeproj / .swiftpm / Package.swift
```

Two hard rules:

1. **The worker owns all Swift execution.** The main thread never evaluates user code. It receives a
   serialisable `RenderTree` and sends back `UIEvent`s. This keeps typing at 60 fps and makes
   runaway user code a terminable worker, not a frozen tab.
2. **Text measurement is the one exception** and is therefore isolated behind a single async port
   (see §7), because only the main thread has real fonts.

## 2. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js 16, App Router, Turbopack, TypeScript strict** | First-class on Vercel; route handlers for share links and AI; RSC for the marketing/landing shell. |
| Editor | **CodeMirror 6** | ~1/5 of Monaco's bundle, better touch support, and we are supplying our own parser and diagnostics anyway — Monaco's main advantage (its LSP client) is irrelevant here. A Lezer grammar handles highlighting; semantic decorations come from our own AST. |
| UI | React 19 + Tailwind v4 + Radix primitives | Fast to build, tiny runtime, accessible primitives for menus/dialogs. |
| State (studio) | Zustand | Small, no context re-render storms, easy to persist. |
| Worker RPC | Comlink | Removes hand-rolled postMessage protocol boilerplate; supports transferables. |
| Persistence | IndexedDB via `idb` | Local-first, offline, no account. |
| Zip | `fflate` | ~8 KB, faster and smaller than JSZip. |
| Tests | Vitest (unit/golden) + Playwright (e2e/visual) | Golden AST and render-tree tests are the backbone of correctness. |
| Monorepo | npm workspaces + Turborepo | Package boundaries keep the compiler independent of React, which matters for testability. (pnpm was the original pick; `corepack enable` needs administrator rights on the target machine, and npm workspaces cost nothing here.) |

## 3. Repository layout

```
swiftui-web-studio/
├─ apps/
│  └─ web/                        Next.js app deployed to Vercel
│     ├─ app/                     routes: /, /new, /p/[id], /embed/[id], /api/*
│     ├─ components/              editor, file tree, device chrome, inspector, console
│     └─ workers/                 worker entry that wires the packages together
├─ packages/
│  ├─ swift-syntax/               lexer, parser, AST, source ranges, incremental reparse, printer
│  ├─ swift-sema/                 name resolution, scopes, type checker, diagnostics, completions
│  ├─ swift-runtime/              interpreter, value model, stdlib shims, async scheduler
│  ├─ swiftui-runtime/            View protocol, ViewBuilder, modifiers, state/observation, identity
│  ├─ swiftui-layout/             proposal/response layout engine + text metrics client
│  ├─ swiftui-render-dom/         RenderTree → React DOM, animation, gesture recognisers
│  ├─ sim-shell/                  device definitions, safe areas, status bar, keyboard inset
│  ├─ project-model/              VFS, manifest schema, templates, import/export of project JSON
│  ├─ exporter/                   pbxproj generator, .swiftpm, Package.swift, xcassets, zip
│  └─ shared/                     Diagnostic, SourceRange, RenderTree types, IDs, telemetry events
└─ tooling/                       eslint, tsconfig bases, vitest setup, playwright config
```

`packages/swift-*` and `packages/swiftui-*` must not import React or touch the DOM. Enforced by an
ESLint `no-restricted-imports` rule. This is what allows the whole compiler to be unit-tested in
Node and, later, reused headlessly (CI conformance runs, a CLI, a VS Code extension).

## 4. Compiler front end (`swift-syntax`, `swift-sema`)

### 4.1 Pipeline

```
source text
   │  lexer         → Token[]  (trivia preserved: comments + whitespace attached to tokens)
   │  parser        → AST      (every node carries a SourceRange; error nodes are first-class)
   │  binder        → Scope tree, symbol table, module-level declarations
   │  type checker  → TypedAST (each expression annotated with a resolved Type)
   ▼
TypedAST + Diagnostic[]
```

**Error recovery is a requirement, not a nicety.** The user is mid-keystroke most of the time. The
parser inserts `ErrorNode`s and resynchronises at statement and declaration boundaries so a single
unbalanced brace does not invalidate the whole file. FR-6.3 (keep showing the last good render)
depends on this.

### 4.2 Incremental reparse — deferred, and here is why

This section originally specified incremental reparse as a Phase 1 requirement, on the assumption
that *"without this, a 2,000-line project blows the 120 ms diagnostics budget"*.

**Measured after Phase 1 landed, that assumption is simply wrong:**

| Project size | Full lex + parse + check + outline |
| --- | --- |
| 500 lines | **1.0 ms** |
| 2,000 lines | **2.9 ms** |

Against a 120 ms budget. A full reparse is roughly 40x under budget at the size where the incremental
path was supposed to become necessary, and the benchmark (`packages/swiftui-runtime/src/bench.test.ts`)
runs in CI so the claim stays honest.

Incremental reparse is therefore **not built**. It would add a splice-and-shift path through the most
correctness-critical code in the system — source ranges that drift by one character produce
diagnostics pointing at the wrong text — in exchange for saving single-digit milliseconds nobody can
perceive.

The design that made this possible is worth keeping in mind rather than the optimisation that turned
out to be unnecessary: a hand-written lexer and recursive-descent parser over a plain token array,
with no backtracking and no regex-driven scanning in the hot path. Revisit only if the benchmark
crosses ~40 ms, which on this trend means somewhere north of 25,000 lines.

### 4.3 Type checker scope

Deliberately a *simplified bidirectional* checker, not Swift's full constraint solver:

- Bottom-up inference for literals and calls; top-down propagation of expected types into closures,
  collection literals, and `some View` returns.
- Overload resolution by arity and argument-label match first, then by parameter type; ambiguity
  resolves to the first candidate with a warning rather than erroring out.
- Generics: type parameters are erased at runtime; constraints are checked only for conformance
  membership, not for associated-type inference.
- Protocol witness tables built at bind time; `some View` treated as an opaque box over the concrete
  type recorded at the return site.

The checker's job is to catch the mistakes people actually make (wrong type passed, missing
argument, unknown member, missing conformance) and to power completions. It is explicitly allowed to
be more permissive than swiftc — R5 covers the drift, and the strictness lint pass flags the gap.

## 5. Runtime (`swift-runtime`)

### 5.1 Value model

```ts
type SwiftValue =
  | { k: 'int';    v: number }      // Int, with 64-bit trap checks on overflow
  | { k: 'double'; v: number }
  | { k: 'bool';   v: boolean }
  | { k: 'string'; v: string }      // grapheme-aware via Intl.Segmenter
  | { k: 'struct'; type: TypeRef; fields: Map<string, SwiftValue> }   // copied on assign
  | { k: 'class';  ref: ObjectRef }                                   // shared
  | { k: 'enum';   type: TypeRef; case: string; payload: SwiftValue[] }
  | { k: 'array';  buf: SwiftValue[]; cow: boolean }
  | { k: 'dict' | 'set' | 'closure' | 'optional' | 'tuple' | 'function' | 'nil', ... }
```

Value semantics are the thing most JS-based Swift emulators get wrong, and getting it wrong makes
`@State` behave subtly incorrectly. Structs are copied on assignment and on parameter pass;
copy-on-write is used for arrays and dictionaries so the copies stay cheap. `inout` parameters are
implemented as explicit write-back at call return, matching Swift's copy-in/copy-out semantics
rather than aliasing.

### 5.2 Execution

A tree-walking interpreter over the TypedAST, with:

- An explicit frame stack (so we can print Swift stack traces on a trap).
- A **step budget** per render pass — default 5 million steps, then abort with
  "Execution took too long; possible infinite loop at `Foo.swift:42`". This satisfies FR-6.5.
- Traps (`nil` force-unwrap, out-of-range index, overflow, failed `as!`) raised as a `SwiftTrap`
  carrying the source range, surfaced as the red overlay in FR-6.4.

### 5.3 Concurrency

`async`/`await` is implemented by making the interpreter's evaluator a generator: an `await` yields
a continuation the scheduler resumes when the awaited job settles. A single cooperative queue plus a
`MainActor` marker is enough for realistic SwiftUI code (`.task {}`, `Task.sleep`, async data
loading) without implementing real actor isolation. Structured concurrency cancellation is modelled
as a cancellation flag checked at suspension points.

## 6. SwiftUI runtime (`swiftui-runtime`)

### 6.1 From `body` to a view graph

`@ViewBuilder` is a result builder; our interpreter already supports result builders (FR-3.3), so
`body` naturally evaluates to a nested tree of view values. That tree is *not* the render tree — it
is a description. We then build a **view graph** whose nodes are stable across re-renders.

### 6.2 View identity — the key correctness problem

`@State` must survive a re-render. SwiftUI derives identity structurally: the path of a view through
the tree, plus explicit `.id()` and `ForEach` element ids. We compute a `ViewIdentity` for each node:

```
identity = parentIdentity + structuralSlot + (explicitID ?? forEachID ?? typeName)
```

State boxes are stored in a `Map<ViewIdentity, StateBox[]>`. On re-render, a node with a matching
identity reuses its boxes; a node whose identity changed gets fresh ones. This is also exactly what
makes **hot reload preserve state** (FR-5.3): a code edit re-parses and re-evaluates, but identities
are unchanged for untouched views, so their `@State` survives.

### 6.3 Observation and invalidation

Reading `@State` / `@ObservedObject` during a `body` evaluation records a dependency edge from the
state box to that view node. A mutation marks dependent nodes dirty and schedules a re-render of
**only those subtrees**. Without this we would re-evaluate the whole app on every keystroke in a
`TextField`, and blow the 32 ms interaction budget.

### 6.4 Modifiers

Modifiers are not wrappers around DOM nodes; they are entries in an ordered list attached to a view
node — because in SwiftUI `.padding().background()` and `.background().padding()` genuinely differ.
The layout engine consumes that ordered list. Modelling them as nested DOM elements would make that
ordering unrepresentable.

## 7. Layout engine (`swiftui-layout`) — the hardest part

### 7.1 Why not flexbox

SwiftUI layout is a negotiation: a parent *proposes* a size, each child *responds* with the size it
wants, then the parent *places* children. `Spacer` responds with "as much as offered", `Text`
responds with its ideal size unless squeezed, `.frame(maxWidth: .infinity)` changes the proposal not
the response. CSS flexbox resolves a different algorithm and diverges quickly on exactly the cases
people hit first. So we implement the real thing.

### 7.2 The protocol

```ts
interface LayoutNode {
  sizeThatFits(proposal: ProposedSize, cache: Cache): Size   // pass 1
  place(bounds: Rect, cache: Cache): PlacedNode[]            // pass 2
}
type ProposedSize = { width: number | null | 'infinity', height: ... }  // null = "ideal size"
```

- **Pass 1 (measure):** root receives the device's safe-area rect as a proposal; recurses down,
  memoising `(nodeId, proposal) → size`.
- **Pass 2 (place):** assigns each node an absolute `Rect` in device coordinates.
- Output is a flat `RenderTree`: an array of nodes with absolute frames, z-order, clip paths, and
  paint attributes. Fully `structuredClone`-able, so it crosses the worker boundary cheaply.

This makes `GeometryReader` trivially correct (it just reads its own placed rect) and gives the
inspector (FR-5.8) exact frames for free.

### 7.3 Text measurement

The one thing the worker cannot do alone. A `TextMetrics` service on the main thread wraps a shared
`OffscreenCanvas` (or a hidden DOM span as fallback) and answers:

```
measure(runs, font, maxWidth) → { lines: LineBox[], width, height, baseline }
```

Line breaking uses `Intl.Segmenter` for word and grapheme boundaries plus a greedy fill, matching
CoreText closely enough for layout purposes. Results are cached hard, keyed by
`(text, font, maxWidth)` — text measurement is the dominant cost in a text-heavy view, and the cache
hit rate on re-render is near 100%.

Fonts: an open, metric-compatible stack (Inter / IBM Plex Sans tuned to SF Pro metrics), because R2
rules out shipping SF Pro. Per-weight metric tables are baked in so line heights match Apple's.

## 8. Renderer (`swiftui-render-dom`)

- Consumes `RenderTree`, emits absolutely positioned `div`s inside a single positioned container.
  No flexbox, no CSS layout — layout is already resolved, CSS only paints.
- Diffed by `ViewIdentity`, so React reuses DOM nodes and CSS transitions can run.
- **Animation:** when a re-render is wrapped in `withAnimation` or a node carries
  `.animation(_:value:)`, we FLIP between the previous and new `Rect` using the Web Animations API,
  translating SwiftUI curves (`.spring(response:dampingFraction:)`, `.easeInOut`) into equivalent
  spring/cubic-bezier easings. `matchedGeometryEffect` is the same mechanism across identity change.
- **Gestures:** pointer events hit-test against the `RenderTree` (top-most hit wins, respecting
  `.allowsHitTesting` and clip rects), then post a `UIEvent` to the worker. Drag/long-press/magnify
  are recognised on the main thread and delivered as high-level gesture phases, so a slow worker
  cannot make scrolling feel janky.
- **Scrolling:** native overflow scrolling on the scroll container, with the worker told the
  content offset so `ScrollViewReader` and lazy stacks work.
- **Accessibility:** SwiftUI accessibility modifiers map to ARIA roles/labels on the emitted nodes.

## 9. Export pipeline (`exporter`)

Runs on the main thread, lazily imported (it is dead weight until someone clicks Export).

### 9.1 `.xcodeproj`

We generate `project.pbxproj` directly — it is a stable, well-understood plist format. The generator
emits `PBXProject`, `PBXGroup` (mirroring the source tree), `PBXFileReference`, `PBXBuildFile`,
`PBXSourcesBuildPhase`, `PBXResourcesBuildPhase`, `PBXNativeTarget`, and
`XCBuildConfiguration` (Debug/Release) nodes. Object IDs are **24-hex, deterministically derived
from a hash of the object's path and role**, so re-exporting the same project produces a
byte-identical file — which makes the export diffable and the golden tests trivial.

Also emitted: `Assets.xcassets` (with `Contents.json` per image set, AppIcon slot, AccentColor),
`Info.plist` keys, `.gitignore`, and a `README.md` with build steps.

### 9.2 `.swiftpm`

A Swift Package using `AppleProductTypes` with an `.iOSApplication` product — the format Swift
Playgrounds opens directly. Cheap to generate once the VFS exists, and it is the fastest path from
"I wrote this in Chrome on a PC" to "it is running on my iPad".

### 9.3 Guarantee

`.swift` files are copied byte-for-byte from the editor buffers. A test asserts
`exportedBytes(file) === editorBytes(file)` for every file in the corpus. That is FR-7.8, and it is
what makes G3 a property of the design rather than a promise.

## 10. Vercel topology

| Route | Runtime | Purpose |
| --- | --- | --- |
| `/`, `/new`, `/p/[id]` | Static + RSC | Shell; editor and worker are client components loaded after hydration. |
| `/embed/[id]` | Static | Read-only preview iframe (FR-8.4), stripped of the editor bundle. |
| `/api/share` | Edge | POST a project, get a short id (only when accounts/cloud storage exist). |
| `/api/proxy` | Node | Allowlisted CORS proxy for the `URLSession` shim (FR-3.8). |
| `/api/ai/*` | Node | Claude API calls, key server-side, rate-limited (FR-9). |
| `/api/telemetry` | Edge | Unsupported-feature counters (NFR-6). |

Storage, only if Q3 says cloud: Vercel Postgres for project metadata, Vercel Blob for file contents,
Vercel KV for rate limits.

**Nothing on the critical path requires a server.** With storage off, the app is effectively a static
site, so it is free to host and works offline as a PWA.

## 11. Testing strategy

| Level | Tool | What it guards |
| --- | --- | --- |
| Lexer/parser golden | Vitest snapshots | `source → AST` for a corpus of Swift files; catches regressions in error recovery too. |
| Type checker | Vitest table tests | `snippet → expected diagnostics` (including *absence* of false positives, which is the more damaging failure). |
| Interpreter | Vitest | Value semantics, mutating, COW, optionals, closures capture, async ordering. |
| Layout | Vitest golden | `view → RenderTree` with exact frames. Baselines authored by hand from real SwiftUI behaviour. |
| Visual | Playwright screenshots | Whole-screen renders vs. baselines captured once from real Xcode Previews on a Mac. |
| Export | Vitest | Deterministic pbxproj bytes; byte-identity of `.swift` files; zip opens. |
| E2E | Playwright | Load template, edit, preview updates, tap, export downloads. |
| Conformance | CI job | 40-project corpus renders with zero unsupported placeholders. Blocks merge. |

The **layout golden tests are the load-bearing ones.** Every layout bug found in the wild becomes a
new golden case before it is fixed.

## 12. Key decisions, recorded

| # | Decision | Rejected alternative | Rationale |
| --- | --- | --- | --- |
| D1 | Interpret a Swift subset in TypeScript | Compile Swift to Wasm server-side (SwiftWasm + Tokamak) | Needs a container and 10–60 s builds; impossible within Vercel's limits and fatal to the sub-250 ms feedback goal. Revisit only as the optional Phase 7 verifier. |
| D2 | Custom two-pass layout engine | Map SwiftUI onto CSS flexbox | Flexbox resolves a different algorithm; divergence appears immediately on `Spacer` and `frame`. See R1. |
| D3 | Source of truth is Swift text | Store an AST/JSON document and print Swift on export | Keeps export lossless by construction and lets people paste code in and out freely. |
| D4 | CodeMirror 6 | Monaco | Bundle size; we supply our own language services regardless. |
| D5 | All execution in a Web Worker | Run on the main thread | Typing must stay at 60 fps and runaway user code must be terminable. |
| D6 | Open font and icon substitutes | Ship SF Pro / SF Symbols | Licensing (R2). Metric-compatible substitutes preserve layout correctness, which is what actually matters. |
| D7 | Deterministic hashed pbxproj IDs | Random UUIDs | Reproducible, diffable exports and testable output. |
