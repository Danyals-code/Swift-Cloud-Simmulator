# SwiftUI Web Studio

A browser-based IDE for writing **real Swift / SwiftUI code**, previewing it live in a simulated
iPhone, and exporting a ready-to-open Xcode project - all served from Vercel, no Mac required to
author.

```
  ┌──────────────────────────┐        ┌───────────────────────┐
  │  Swift editor (Chrome)   │  ───▶  │  Live iPhone preview  │
  │  ContentView.swift       │        │  (interactive)        │
  └──────────────────────────┘        └───────────────────────┘
                │
                ▼
     Export ▸ MyApp.xcodeproj · MyApp.swiftpm · Package.swift · project.yml
```

## The one design principle everything follows

> **The source of truth is real, unmodified Swift text.**

We never transpile the user's code into another language and export *that*. The browser contains a
Swift *interpreter* used **only to drive the preview**. Export is a file copy plus project
scaffolding, so what you write is exactly what Xcode compiles. This makes export lossless by
construction and keeps the product honest: the preview can be imperfect, the output never is.

## Documentation

| Doc | What's in it |
| --- | --- |
| [01 - Requirements](docs/01-REQUIREMENTS.md) | Goals, non-goals, functional + non-functional requirements, risks, acceptance criteria |
| [02 - Architecture](docs/02-ARCHITECTURE.md) | Stack, monorepo layout, compiler pipeline, layout engine, renderer, export pipeline, Vercel topology |
| [03 - Roadmap & Phases](docs/03-ROADMAP.md) | Phase 0-7 breakdown with deliverables, acceptance gates and sizing |
| [04 - Swift language subset](docs/04-SWIFT-SUBSET.md) | Exactly which Swift features are in/out, by tier |
| [05 - SwiftUI coverage matrix](docs/05-SWIFTUI-COVERAGE.md) | Views, modifiers, styles - the living checklist |
| [06 - Vertical slice (v0.1)](docs/06-VERTICAL-SLICE.md) | **The decided first build** - reference app, subset, per-phase task lists and findings |
| [07 - Defect register](docs/07-DEFECT-REGISTER.md) | **The working backlog** - what an 870-check sweep found, in twelve closed phases, plus a thirteenth, open, that seven sample screens turned up. What is closed and what is not |

## Decided scope for v0.1

| | |
| --- | --- |
| **Build strategy** | Vertical slice - a narrow subset carried end to end, ~5-7 weeks |
| **Export format** | `.xcodeproj` only |
| **Storage** | Local-only: IndexedDB + share-by-URL. No accounts, no database, works offline |
| **AI features** | Deferred to Phase 7 |

## Status

**Phases 0-10 complete, and the defect register's ten phases with them.** The
studio parses, checks, runs and renders real Swift across multiple files, exports
to four project formats, and shares a project through a link that needs no server.

The register's eleventh and twelfth phases are worth reading before the rest of this.
Four multi-screen templates were written against the real pipeline, and ordinary Swift
found eighteen defects that ten phases of sweeping had not: an overload resolved to the
wrong function, a `@ViewBuilder` helper that drew nothing, an enum case that lost its
payload on the way into a function. Two of them returned a *wrong answer* with a clean
Problems pane, which is the one failure this product cannot have. All eighteen are
closed, and the lesson is in the phases: a sweep tests the claims in the matrix, and
almost every one of these lived in the space between two claims that were each true.

**The register's thirteenth phase is open, and fourteen of its seventeen items are
closed.** The same rule turned on the chrome: seven sample screens, rendered and then
measured against what iOS draws, found seventeen defects a sweep by name cannot see.
Three of them blanked the preview from ordinary Swift - `.shadow(color: .black.opacity(0.1))`
and `.font(.title.bold())` both trapped - and four were one missing tint showing up on
every screen at once. The rest were the chrome: an alert built like an alert, a search
field with its magnifying glass, a spinner that spins. What is left is one item that
needs content to compose *under* the bars rather than below them, and the symbol table,
which is finite by construction.

What it handles now is most of the SwiftUI people actually write:

- **Language** - structs and classes with inheritance and `super`, protocols and
  extensions, enums with raw and associated values, nested types, `switch` with
  pattern matching, `if let` and `guard let`, loops, closures, key paths,
  generics, `throws` / `do-catch`, `inout`. Words Swift lets you use as names -
  `open`, `some`, `any`, `where` - are names wherever you write them.
- **The standard library** - the `String`, `Array`, `Dictionary` and `Set`
  members real code calls, the maths functions, `zip` and `stride`, and the
  Foundation corner SwiftUI leans on: `UUID` for an `Identifiable` id, `Date`
  with intervals and comparison, and a `URL` for `Link` and `AsyncImage`.
- **Structure** - navigation stacks and links (including `NavigationSplitView`,
  collapsed as a phone collapses it), tabs with a bar or with page dots, lists in
  every style, forms, sections with headers *and* footers, sheets, popovers,
  alerts, scroll views, grids, `ForEach`, `GroupBox`, `LabeledContent`.
- **State** - `@State`, `@Binding`, `ObservableObject` with `@StateObject` and
  `@ObservedObject`, `@EnvironmentObject`, `@Environment`, and `@AppStorage`,
  which is keyed by its string and outlives the view that wrote it.
- **Interaction** - the form controls, drag and magnify gestures with
  `@GestureState`, `.onAppear` / `.onChange`, swipe-to-delete, `.searchable`.
  Every control that is drawn answers to a press: a `Stepper` counts by its step,
  a `Picker` opens or lays its options out in place, a `DatePicker` opens onto a
  calendar and a `ColorPicker` onto a palette.
- **Text** - the attributes, not just the size and the weight: underline,
  strikethrough, tracking, line spacing, baseline offset, monospaced digits, and
  the three that ask measurement to answer back - shrink-to-fit, tightening, and
  truncation at whichever end you asked for. `Text + Text` renders with a face
  per half.
- **Drawing** - `Path`, `Canvas`, shapes with `.fill` and `.stroke`, gradients,
  materials, colour filters, blend modes, 3D rotation, redaction,
  `withAnimation` and transitions. `.animation(_:value:)` animates only when its
  value changed.
- **Layout** - the proposal/response engine, and a stack that aligns its
  children's *guides* rather than their edges, so `.alignmentGuide` means
  something. `.safeAreaInset` insets rather than overlays.
- **Reuse** - custom `ViewModifier`, `extension View { func … }` and custom
  `ButtonStyle`: the three ways a real codebase names a look and applies it.
- **The editor** - Xcode's Default (Dark) palette, a jump bar over every file,
  quick fixes that apply themselves, and rename across every file. Completion
  knows what a value *is*: a String offers `uppercased` rather than 159 view
  modifiers, a model struct offers its own members, and a view offers both. Go to
  definition follows a member through its receiver, and hover describes the
  standard library and the property wrappers as well as the project's own names.
- **The studio around it** - a project navigator with real groups you can make,
  rename and drag files between; draggable pane dividers; Xcode's own keyboard
  shortcuts for showing and hiding them; and a Pause that stops the preview
  recompiling while you type.
- **Paste and go** - `#Preview` blocks parse, `PreviewProvider` is read as a root,
  and a view with only a preview renders rather than reporting that the project
  has no entry point.
- **A share link is treated as a stranger's bytes** - every value it carries is
  validated before it becomes a project, and the exporter refuses to write an
  entry outside the archive's own root whatever it is handed.
- **Projects, plural** - every project gets its own id and the welcome sheet lists
  what is in this browser, so creating from a template no longer destroys what was
  there. A project you edited is kept when you start another; one you never touched
  is not, because a template can be recreated in two clicks and a list that only
  grows is a list nobody reads.
- **Somewhere to start** - twenty-two templates behind one sheet that asks the
  only question a new session has: *where does this project come from*. Three
  answers, and they are the three things down its left edge - what is already in
  this browser, a whole **app** to start from, or one **feature** to read. The
  split is the point: four of the templates are real multi-screen projects
  (`Trailhead`, `Ledger`, `Kitchen`, `Pulse`) with a model, a store and folders
  that mean something, and eighteen are one file teaching one idea. A pile of
  twenty-two cards sorted by name cannot tell you which is which.

  All of them are written the way people write rather than the way this is easy:
  `UUID` identities, dates, `allCases`, both spellings of `Button`, explicit
  getters, `$store.property` bound straight into a model.
- **A way back in** - the sheet is the app icon in the top-left corner, so
  starting over is one click from anywhere. It asks before it replaces work, and
  only when there is work to lose: a project still identical to the template it
  came from is replaced without a dialog nobody would have read.
- **Files can come back** - the counterpart to Export, and the round trip the whole
  product is built around. Pick the `.swift` files from a project you exported and
  have since edited on a Mac, *or the `.zip` the export itself wrote* - all four
  formats read back, with the wrapper folders peeled and your bytes unchanged.
  Nothing is uploaded; the picker is the browser's own, and an archive is treated as
  what it is: a stranger's bytes, capped and re-normalised before anything is opened.

The [coverage matrix](docs/05-SWIFTUI-COVERAGE.md) is the exact contract, and it
is honest about the 🟡 rows as well as the ✅ ones.

Three things are outstanding, and none of them is hidden:

- **"Opens in Xcode and builds with zero edits" needs a Mac**, and `.swiftpm`
  needs an iPad for the same reason. Everything checkable without them is checked
  - the pbxproj parses, its object graph resolves, every bundle is structurally
  complete, and each format carries the user's bytes unchanged. See
  [docs/06-VERTICAL-SLICE.md](docs/06-VERTICAL-SLICE.md) section 4.12.
- **The conformance corpus is 22 projects, not the 100 Phase 6's first gate asks
  for.** Seventy-eight more authored in a single pass would be padding; the corpus
  grows as real projects arrive. See section 4.15.
- **Coverage telemetry has no data**, because nothing has shipped and nothing is
  transmitted. The instrument is built and visible in the studio's Coverage
  panel; its ranking is empty by construction until someone uses it.

Two limitations are worth knowing before you meet them, and both are stated in
the matrix rather than discovered: **concurrency does not suspend** - everything
async runs immediately and in order - and **generics are erased**, so constraints
are recorded and never enforced.

Not built, each with its reason recorded in the matrix and the [defect
register](docs/07-DEFECT-REGISTER.md) rather than a phase number: custom
`ToggleStyle` and `LabelStyle`, the `Layout` protocol, `PreferenceKey`,
`Animatable`, `matchedGeometryEffect`, exit transitions, Combine, `Chart`,
`Table`, `OutlineGroup`, `ScrollViewReader`, and `Image("asset")` - which cannot
work here at all, because a project file is text and there is no asset catalogue
for a name to resolve against.

| Check | Result |
| --- | --- |
| Packages typechecking | 11 / 11 |
| Lint | clean |
| Unit tests | 1616 passing |
| End-to-end | 52 / 52 passing |
| Templates rendering with zero placeholders | 19 / 19 |
| Export formats | 4 - .xcodeproj, .swiftpm, Package.swift, project.yml |
| Coverage matrix | 157 ✅ · 48 🟡 · 11 ⬜ · 11 ✗ |
| Full pipeline, 500-line file | 2 ms (budget: 120 ms) |
| Tap to repaint | 0.4 ms (budget: 32 ms) |
| Client JS | 411 KB gzipped / 450 KB budget (91%) |

Next is the [roadmap's à-la-carte Phase 7](docs/03-ROADMAP.md) - a real `swiftc`
verification service, accounts, AI codegen, GitHub export - each of which needs
hosting, a key or an OAuth app; and whatever the coverage telemetry says people
reached for.

## Getting started

```bash
npm install
npm run dev --workspace @studio/web
```

Then open http://localhost:3000.

| Command | Does |
| --- | --- |
| `npm run verify` | typecheck + lint + unit tests |
| `npm test` | unit tests only |
| `npm run build` | production build |
| `npm run budget` | bundle-size gate (needs a build first) |
| `npm run e2e` | Playwright end-to-end suite (needs a build first) |

### Deploying

The project's root directory is `apps/web`, which is what makes the platform read
`apps/web/vercel.json` and install from the workspace root on its own. That file
carries the framework marker and the security headers and overrides nothing else:
the detected defaults are already right, and every override is a second place for
the build to be wrong.

```bash
npx vercel --prod
```

A failed deployment is redeployed by pushing, not by pressing Redeploy: that button
replays the commit the deployment was built from, so a fix that has since been
committed will not be in it. Check the commit hash on the deployment against the
branch before concluding that a change had no effect.

If a build fails on the platform but succeeds locally, the first thing to check is
which bundler ran. `next build` uses Turbopack, a native binary; `next build
--webpack` is the fallback. Webpack produces a larger bundle here (464 KB against
Turbopack's 367 KB, over the 450 KB budget), so it is a diagnostic rather than a
default.

## Repository layout

```
apps/web/              Next.js app - editor, device frame, console, worker host
packages/
  shared/              SourceSpan, Diagnostic, RenderTree, worker protocol
  swift-syntax/        lexer, parser, AST                        (Phase 1)
  swift-sema/          name resolution, scopes, coverage checks   (Phase 1)
  swift-runtime/       the interpreter, value model, traps       (Phase 2)
  swiftui-runtime/     SwiftUI host, view identity, @State boxes (Phase 3)
  swiftui-layout/      proposal/response layout engine, metrics  (Phase 3)
  swiftui-render-dom/  RenderTree → absolutely positioned DOM
  sim-shell/           device specs, safe areas
  project-model/       virtual file system, persistence, template gallery
  exporter/            .xcodeproj generation, asset catalogue, zip
```

The `swift-*`, `swiftui-runtime`, `swiftui-layout`, `sim-shell` and `shared` packages are forbidden
by lint rule from importing React or touching any DOM global. They run in a Web Worker and must stay
unit-testable in plain Node.
