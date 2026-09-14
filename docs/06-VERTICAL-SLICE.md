# 06 — Vertical slice (v0.1)

The decided first build. A narrow subset of Swift and SwiftUI, carried end to end: **type it in
Chrome → see it run in an iPhone → download an Xcode project that builds.**

Target: ~5–7 focused-developer weeks. Every package in the final architecture gets its spine built
here; nothing is throwaway.

## 1. The reference app

This is the acceptance target. When this file renders interactively and exports to a project that
builds on a Mac with zero edits, the slice is done.

```swift
import SwiftUI

@main
struct CounterApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var count = 0
    @State private var name = "World"

    var body: some View {
        VStack(spacing: 16) {
            Text("Hello, \(name)!")
                .font(.largeTitle)
                .foregroundStyle(.primary)

            Text("Count: \(count)")
                .font(.title2)
                .foregroundStyle(count < 0 ? Color.red : Color.primary)

            HStack(spacing: 12) {
                Button("Minus") {
                    count -= 1
                }
                .padding()
                .background(Color.red.opacity(0.15))

                Spacer()

                Button("Plus") {
                    count += 1
                }
                .padding()
                .background(Color.green.opacity(0.15))
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
        }
        .padding()
        .background(Color(white: 0.95))
    }
}
```

It is deliberately chosen to exercise every load-bearing mechanism at once:

| Mechanism | Where it shows up |
| --- | --- |
| App entry point + scene | `@main`, `App`, `WindowGroup` |
| Struct declaration, memberwise state | `struct ContentView` |
| Property wrapper with identity-keyed storage | `@State private var count` |
| String interpolation | `"Hello, \(name)!"` |
| Result builder (`@ViewBuilder`) | the body of `VStack` |
| Closure capture + mutation | `Button("Plus") { count += 1 }` |
| Ternary + comparison operators | `count < 0 ? .red : .primary` |
| **Layout negotiation** | `Spacer()` inside `HStack` inside `frame(maxWidth: .infinity)` |
| **Modifier ordering** | `.padding().background(...)` |
| Re-render without state loss | edit a colour, `count` survives |

If the layout engine is wrong, `Spacer` + `frame(maxWidth: .infinity)` will expose it immediately.
That is the point.

## 2. Language subset for the slice

Everything else produces a "not yet supported in the preview" diagnostic naming the feature.

**In:**
- `struct` with stored properties, computed properties, memberwise init
- `func` with argument labels and default values
- `var` / `let`, type annotations, type inference for literals
- Literals: `Int`, `Double`, `String` (with interpolation), `Bool`, arrays
- Operators: arithmetic, comparison, logical, ternary, compound assignment, string `+`
- Closures: trailing syntax, `$0`, capture by reference for `@State` projections
- `if` / `else`, `for-in` over ranges and arrays
- `@State`, `@ViewBuilder`, `some View`, `@main`
- `print()`

**Out for now (diagnosed, not silently ignored):** classes, enums, protocols, extensions, generics,
optionals beyond `??`, `switch`, `guard`, `while`, error handling, async, `ObservableObject`,
`@Binding`, subscripts, property wrappers other than `@State`.

`@Binding` is the first thing to add after the slice — it is the most-missed omission on the list.

## 3. SwiftUI surface for the slice

| Views | Modifiers | Types |
| --- | --- | --- |
| `VStack` `HStack` `ZStack` | `.frame(width:height:alignment:)` | `Color` (named + `Color(white:)`) |
| `Spacer` | `.frame(maxWidth:maxHeight:)` incl. `.infinity` | `.primary` `.secondary` semantic colours |
| `Text` | `.padding` (all edge forms) | `Font` presets (`.largeTitle` … `.caption`) |
| `Button` (title + action) | `.background(Color)` | `Alignment`, `Edge.Set` |
| `Group` | `.foregroundStyle` / `.foregroundColor` | |
| `Rectangle` `RoundedRectangle` `Circle` | `.font` `.bold` | |
| `App` / `WindowGroup` | `.opacity` `.cornerRadius` | |
| | `.onTapGesture` | |

One device: **iPhone 15** (393×852 pt), light mode only. Dark mode, device picker and Dynamic Type
arrive with Phase 4.

## 4. Phase 0 task list — **complete**

Built and verified 2026-09-14. Every gate passes; see §4.1 for what deviated from the plan.

### 0.1 — Monorepo and tooling
- [x] npm workspaces + Turborepo; TypeScript strict; shared tsconfig base in `tooling/`
- [x] Package stubs: `shared`, `swift-syntax`, `swift-sema`, `swift-runtime`, `swiftui-runtime`, `swiftui-layout`, `swiftui-render-dom`, `sim-shell`, `project-model`, `exporter`
- [x] ESLint boundary rule: the pure packages may not import React/Next, nor reference `window`, `document`, `fetch` and friends
- [x] Vitest at the root, running per-package
- [x] `.gitignore`, `git init`, initial commit

### 0.2 — Next.js app shell
- [x] `apps/web` on Next.js 16 App Router, React 19, Tailwind v4
- [x] Three-pane layout: file rail | editor + console | device frame
- [x] Dark studio chrome (the *studio* is dark; the *simulated app* renders light)
- [x] `vercel.json` with build/install commands and security headers
- [ ] **Deploy to Vercel** — needs the account connection; config is ready, `vercel --prod` is the only remaining step

### 0.3 — Editor
- [x] CodeMirror 6 mounted, controlled by a Zustand store
- [x] Swift syntax highlighting
- [x] Diagnostic gutter + squiggle decorations fed from `Diagnostic[]`
- [x] Keybindings: Ctrl+S (flush save), Ctrl+/ (comment), Ctrl+B (toggle preview), Tab (indent)
- [x] Click a diagnostic in the Problems panel to reveal it in the editor

### 0.4 — Worker plumbing
- [x] Comlink worker at `apps/web/workers/compiler.worker.ts`
- [x] RPC surface: `compile` / `dispatch` / `reset`, returning a hand-built demo `RenderTree`
- [x] Debounced 150 ms pipeline from editor changes to worker
- [x] Revision guarding, so an out-of-order response never paints backwards
- [x] Worker restart-on-crash with the document treated as the durable state
- [x] `RenderTree` defined in `shared` and painted by `swiftui-render-dom` as absolutely positioned DOM
- [x] Placeholder nodes for unsupported features (FR-4.11), wired from day one

### 0.5 — Device frame
- [x] `sim-shell` with four device definitions; iPhone 15 (393×852, 59/34 safe area) is the default
- [x] CSS-drawn bezel, Dynamic Island, status bar with live clock, home indicator — no Apple artwork (R2)
- [x] Fit-to-pane scaling via `ResizeObserver`, never above 1:1

### 0.6 — Persistence and export skeleton
- [x] `project-model` VFS behind a `ProjectStore` interface, with IndexedDB and in-memory implementations
- [x] Autosave debounced 500 ms, plus forced flush on `visibilitychange` and `pagehide`
- [x] `exporter`: `fflate` zip with a README, and the byte-identity guarantee under test

### 0.7 — CI
- [x] GitHub Actions: typecheck, lint, unit tests, build, bundle budget, Playwright e2e
- [x] Bundle-size gate that fails the build (verified by forcing a violation)
- [x] Playwright suite covering all five Phase 0 gates

### Phase 0 gate — all passing

| # | Gate | Evidence |
| --- | --- | --- |
| 1 | Editing text persists across a reload | `e2e/smoke.spec.ts` "gate 1" |
| 2 | A synthetic worker diagnostic appears as an editor squiggle | "gate 2" |
| 3 | The stub render tree draws inside the device frame | "gate 3", "gate 3b" |
| 4 | The downloaded zip contains the edited text, byte-identical | "gate 4" + 33 unit tests in `packages/exporter` |
| 5 | CI fails on a deliberate bundle-budget violation | Budget forced to 100 KB exits 1; restored to 450 KB exits 0 |

Verified numbers: **11/11 packages typecheck**, **lint clean**, **50 unit tests pass**,
**7/7 e2e pass**, **client JS 324 KB gzipped against a 450 KB budget**.

### 4.1 — Deviations from the plan

| Planned | Built | Why |
| --- | --- | --- |
| pnpm workspaces | npm workspaces | `corepack enable` needs administrator rights on Windows. npm workspaces cost nothing here and Turborepo is indifferent. |
| Next.js 15 | Next.js 16 | Next 15 pulls a postcss with four open advisories. Nothing in the app was version-specific; the only fix needed was dropping the `eslint` key that Next 16 removed from `NextConfig`. |
| Lezer Swift grammar | `@codemirror/legacy-modes` Swift mode | Phase 1 replaces highlighting with semantic decorations from our own parser anyway, so a hand-written Lezer grammar would be thrown away. |
| Budget split shell/worker | One total-client-JS budget | Turbopack emits no per-route chunk manifest and hashed chunks cannot be reliably attributed to a route. Reporting a number we cannot compute is worse than reporting one we can. |
| `.js` extensions on relative imports | Extensionless | The `.js`-pointing-at-`.ts` convention is for NodeNext resolution; bundlers resolve it literally and fail. |

## 4.2 Phase 1 task list — **complete**

Built and verified 2026-09-14. Slice-scoped per the "Decided path" section in
[03-ROADMAP.md](03-ROADMAP.md).

### Lexer (`swift-syntax`)
- [x] Identifiers: `$0` shorthand, `$name` projections, backtick escapes, non-ASCII
- [x] Full keyword set — recognised even when unparsed, so diagnostics can name the feature
- [x] Numbers: decimal, hex, binary, octal, underscores, floats, exponents
- [x] Strings: escapes, `\u{...}`, interpolation, multiline with indentation stripping, raw `#"..."#`
- [x] Nested interpolation, and string literals nested inside interpolation
- [x] Operators lexed greedily, with `?.` split so member chains survive
- [x] Nested block comments
- [x] Trivia flags: `newlineBefore`, `spaceBefore`/`spaceAfter`, `column`

### Parser (`swift-syntax`)
- [x] Declarations: `import`, `struct`, `func`, `var`/`let`, `init`, attributes, modifiers
- [x] Statements: `if`/`else if`/`else`, `for-in`, `return`, expression and declaration statements
- [x] Expressions: full Swift precedence table, ternary, assignment, ranges, closures, literals
- [x] Member chains that continue across newlines — what makes SwiftUI modifier chains work
- [x] Trailing closures, suppressed in condition position so `if x { }` is not read as a call
- [x] Closure parameter detection that is not fooled by `for i in xs` inside the body
- [x] Types: named, generic, optional, array, dictionary, tuple, function, `some View`
- [x] Error recovery: error nodes, resync points, one diagnostic per mistake
- [x] Missing-brace recovery keyed on column-1 type declarations
- [x] Guaranteed progress — unbalanced input terminates rather than hanging the worker

### Checker (`swift-sema`)
- [x] Two-pass collection, so declaration order does not matter
- [x] Lexical scopes with shadowing: properties, parameters, locals, loop variables, closures
- [x] Entry-point validation: missing, duplicated, or not conforming to `App`
- [x] `View` conformance requires a `body`
- [x] Coverage diagnostics naming both the feature and the phase that adds it
- [x] Property-wrapper support split by phase
- [x] A semantic model (types, properties, methods, wrappers) for Phases 2-3 to consume

### Preview
- [x] Live structural outline of the parsed view tree, replacing the Phase 0 demo tree
- [x] Tap a row to select it — keeps the event round-trip under test, and is the
      precursor to the Phase 4 inspector
- [x] Real diagnostics in the editor gutter and the problems panel

### Phase 1 gate — all passing

| # | Gate | Result |
| --- | --- | --- |
| 1 | Corpus parses with zero unexpected errors | Reference app: **zero diagnostics of any severity** |
| 2 | A missing closing brace still yields a usable AST | Column-1 recovery, covered by unit and e2e tests |
| 3 | Keystroke to diagnostics p95 under 120 ms on 500 lines | **1.0 ms** (2,000 lines: 2.9 ms) |
| 4 | Zero false positives on the corpus | Enforced by a dedicated test group; unknown types warn rather than error |

Verified: **11/11 packages typecheck**, **lint clean**, **191 unit tests**, **12/12 e2e**,
**334 KB gzipped** against a 450 KB budget.

### 4.3 — Deviations and findings

| Planned | Actual | Why |
| --- | --- | --- |
| Incremental reparse | **Not built** | Measured: a *full* reparse of 2,000 lines takes 2.9 ms against a 120 ms budget. The assumption that made it necessary was wrong. See [02-ARCHITECTURE.md](02-ARCHITECTURE.md) section 4.2. |
| Trivia attached to tokens | Discarded, with flags kept | Trivia exists to support a source printer, and this system never prints Swift — the editor text is the source of truth. |
| Full bidirectional type checker | Resolution and coverage only | Gate 4 makes a false positive worse than a missed error. Member and argument checking needs real type information, which arrives with the interpreter in Phase 2. Unknown types warn rather than error for the same reason. |
| Errors on unrecognised constructs | Warnings naming the feature | `NavigationStack` is valid Swift; reporting "cannot find in scope" would be both wrong and unhelpful. |

## 4.4 Phase 2 task list — **complete**

Built and verified 2026-09-14. The preview now *runs* the user's code.

### Interpreter (`swift-runtime`)
- [x] Value model: struct/array/dictionary copied on assignment and argument passing; closures shared
- [x] Structs: memberwise init (labelled and positional), stored and computed properties, methods
- [x] `mutating` methods writing through to the caller's storage, refused on a `let`
- [x] Closures capturing by reference — the mechanism behind `Button { count += 1 }`
- [x] `$0` shorthand and named closure parameters
- [x] Full operator set with Swift semantics: truncating Int division, short-circuit `&&`/`||`, `??`
- [x] Traps rather than `NaN`: division by zero, index out of range, overflow, force-unwrap nil
- [x] Swift-shaped call stacks on every trap, innermost frame first
- [x] Step budget and call-depth cap, so runaway code is abandoned rather than hanging the worker
- [x] `@ViewBuilder` semantics: `buildBlock`, `buildIf`/`buildEither`, `buildArray`
- [x] Stdlib: String (grapheme-correct), Array, Dictionary, Range, numerics, `print`
- [x] `InterpreterHost` seam — the interpreter has no SwiftUI knowledge at all

### SwiftUI host and app runtime (`swiftui-runtime`)
- [x] Views, modifiers, `Color`, contextual member tokens (`.largeTitle`, `.infinity`)
- [x] User `View` structs expanded through their own `body`, recursively
- [x] A live root instance holding `@State` across re-renders and edits
- [x] Button actions dispatched by tree path, running the real Swift closure
- [x] Runtime failures reported as diagnostics rather than thrown

### Phase 2 gate — all passing

| # | Gate | Result |
| --- | --- | --- |
| 1 | A struct assigned to a second variable and mutated does not affect the first | Covered, including nested structs and structs inside arrays |
| 2 | `mutating` methods and closure capture behave per spec | Covered, plus the `let` refusal |
| 3 | Unbounded execution aborts within budget, naming the source line | Covered for both loops and recursion |
| 4 | A runtime trap points at the correct line and column | Covered for division by zero, range, overflow, force-unwrap |
| 5 | `print()` output reaches the console | Covered end to end |

Verified: **11/11 packages typecheck**, **lint clean**, **299 unit tests**, **16/16 e2e**.

### 4.5 — Deviations and findings

| Planned | Actual | Why |
| --- | --- | --- |
| Copy-on-write collections | **Eager copying** | Semantically identical — COW is purely an optimisation. Eager copying is far easier to get right, and the same rule that killed incremental reparse applies: build the optimisation when a measurement asks for it. |
| Gate: "a class shares, a struct copies" | Struct half only | Classes are outside the slice; the parser reports them as unsupported. The reference-semantics half of that gate moves to the phase that adds classes. |
| Gate: async chain with `Task.sleep` | Deferred | `async`/`await` is outside the slice. |
| `@State` preserved by property name | Preserved by **name and initialiser** | Matching on name alone keeps showing `0` after the user edits `= 0` to `= 10`, which reads as the preview being stuck. Changing an initialiser is a deliberate request to see the new value; changing anything else is not. |
| Call depth cap of 2,000 | **512** | Each Swift call costs roughly ten JS frames, so 2,000 exhausted the JS stack first and surfaced as a `RangeError` naming the interpreter's own frames instead of a diagnostic about the user's code. |

**Found by testing, worth recording:**

- `"👋🏽".count` is 1 in Swift. Spreading a JS string splits by *code point*, giving 2 —
  the emoji and its skin-tone modifier. Fixed with `Intl.Segmenter`, which is what the
  architecture doc specified for text all along.
- Swift allows `;` as a separator between *declarations*, not only statements. Found by
  an end-to-end test that typed its fixture on one line to dodge the editor's bracket
  auto-closing.
- A single-expression body must be evaluated exactly once. Running the block for effects
  and then re-evaluating the expression for its implicit return doubles every side effect
  in it.

## 5. Slice definition of done

1. The reference app in §1 renders in the device frame.
2. Tapping Plus and Minus updates the count; the colour flips at negative values.
3. `Spacer` pushes the buttons apart correctly, and `.padding().background()` renders differently
   from `.background().padding()` — both verified against hand-authored golden frames.
4. Editing `spacing: 16` to `spacing: 40` updates the preview in under 250 ms **without** resetting
   `count`.
5. An unsupported construct (say, a `class`) produces a diagnostic naming the feature, and the
   preview keeps showing the last good render rather than blanking.
6. Export produces `CounterApp.xcodeproj` which opens and runs on a Mac with zero edits.
7. Re-exporting an unchanged project produces a byte-identical zip.

## 6. What the slice deliberately leaves undone

Listed so it is a choice rather than an oversight: multi-file projects, dark mode, device picker,
navigation, lists, sheets, animation, gestures beyond tap, images and SF Symbols, `@Binding` and
`ObservableObject`, completions, the view inspector, templates, share links, `.swiftpm` export.

Each is a phase in [03-ROADMAP.md](03-ROADMAP.md) and each is additive on top of the spine the slice
builds.
