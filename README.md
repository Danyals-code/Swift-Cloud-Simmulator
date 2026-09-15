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

## Decided scope for v0.1

| | |
| --- | --- |
| **Build strategy** | Vertical slice - a narrow subset carried end to end, ~5-7 weeks |
| **Export format** | `.xcodeproj` only |
| **Storage** | Local-only: IndexedDB + share-by-URL. No accounts, no database, works offline |
| **AI features** | Deferred to Phase 7 |

## Status

**Phases 0-10 complete.** The studio parses, checks, runs and renders real Swift
across multiple files, exports to four project formats, and shares a project
through a link that needs no server.

What it handles now is most of the SwiftUI people actually write:

- **Language** - structs and classes with inheritance and `super`, protocols and
  extensions, enums with raw and associated values, `switch` with pattern
  matching, `if let` and `guard let`, loops, closures, key paths, generics,
  `throws` / `do-catch`, `inout`.
- **Structure** - navigation stacks and links, tabs, lists, forms, sheets,
  alerts, scroll views, grids, `ForEach`.
- **State** - `@State`, `@Binding`, `ObservableObject` with `@StateObject` and
  `@ObservedObject`, `@EnvironmentObject`, `@Environment`.
- **Interaction** - the form controls, drag and magnify gestures with
  `@GestureState`, `.onAppear` / `.onChange`, swipe-to-delete, `.searchable`.
- **Drawing** - `Path`, `Canvas`, shapes with `.fill` and `.stroke`, gradients,
  materials, colour filters, `withAnimation` and transitions.
- **Reuse** - custom `ViewModifier`, `extension View { func … }` and custom
  `ButtonStyle`: the three ways a real codebase names a look and applies it.
- **The editor** - completion from the project's own declarations as well as
  SwiftUI's, go to definition, hover, quick fixes that apply themselves, and
  rename across every file.
- **Paste and go** - `#Preview` blocks parse, and a view with only a preview
  renders rather than reporting that the project has no entry point.

The [coverage matrix](docs/05-SWIFTUI-COVERAGE.md) is the exact contract, and it
is honest about the 🟡 rows as well as the ✅ ones.

Three things are outstanding, and none of them is hidden:

- **"Opens in Xcode and builds with zero edits" needs a Mac**, and `.swiftpm`
  needs an iPad for the same reason. Everything checkable without them is checked
  - the pbxproj parses, its object graph resolves, every bundle is structurally
  complete, and each format carries the user's bytes unchanged. See
  [docs/06-VERTICAL-SLICE.md](docs/06-VERTICAL-SLICE.md) section 4.12.
- **The conformance corpus is 17 projects, not the 100 Phase 6's first gate asks
  for.** Eighty-five more authored in a single pass would be padding; the corpus
  grows as real projects arrive. See section 4.15.
- **Coverage telemetry has no data**, because nothing has shipped and nothing is
  transmitted. The instrument is built and visible in the studio's Coverage
  panel; its ranking is empty by construction until someone uses it.

Two limitations are worth knowing before you meet them, and both are stated in
the matrix rather than discovered: **concurrency does not suspend** - everything
async runs immediately and in order - and **generics are erased**, so constraints
are recorded and never enforced.

Not built: custom `ToggleStyle`, the `Layout` protocol, `PreferenceKey`,
`Animatable`, and the remaining ⬜ rows in the coverage matrix - each marked "-"
rather than a phase, because a phase number is a promise, and each with its reason
recorded in [the roadmap](docs/03-ROADMAP.md#what-phase-9-deliberately-did-not-build).

| Check | Result |
| --- | --- |
| Packages typechecking | 11 / 11 |
| Lint | clean |
| Unit tests | 1043 passing |
| End-to-end | 51 / 51 passing |
| Templates rendering with zero placeholders | 17 / 17 |
| Export formats | 4 - .xcodeproj, .swiftpm, Package.swift, project.yml |
| Coverage matrix | 98 ✅ · 39 🟡 · 29 ⬜ · 3 ✗ |
| Full pipeline, 500-line file | 2 ms (budget: 120 ms) |
| Tap to repaint | 0.2 ms (budget: 32 ms) |
| Client JS | 367 KB gzipped / 450 KB budget (82%) |

Next: [Phase 7's à-la-carte items](docs/03-ROADMAP.md) - a real `swiftc`
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

`vercel.json` at the repo root configures the monorepo build: the project's root
directory stays the repository root, and the build command targets the web
workspace. Node is pinned to 22.x in `package.json` so the deployed build does not
drift with whatever the platform defaults to.

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
