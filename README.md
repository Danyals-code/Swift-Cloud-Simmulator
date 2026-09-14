# SwiftUI Web Studio

A browser-based IDE for writing **real Swift / SwiftUI code**, previewing it live in a simulated
iPhone, and exporting a ready-to-open Xcode project — all served from Vercel, no Mac required to
author.

```
  ┌──────────────────────────┐        ┌───────────────────────┐
  │  Swift editor (Chrome)   │  ───▶  │  Live iPhone preview  │
  │  ContentView.swift       │        │  (interactive)        │
  └──────────────────────────┘        └───────────────────────┘
                │
                ▼
     Export ▸ MyApp.xcodeproj · MyApp.swiftpm · Package.swift · .zip · GitHub
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
| [01 — Requirements](docs/01-REQUIREMENTS.md) | Goals, non-goals, functional + non-functional requirements, risks, acceptance criteria |
| [02 — Architecture](docs/02-ARCHITECTURE.md) | Stack, monorepo layout, compiler pipeline, layout engine, renderer, export pipeline, Vercel topology |
| [03 — Roadmap & Phases](docs/03-ROADMAP.md) | Phase 0–7 breakdown with deliverables, acceptance gates and sizing |
| [04 — Swift language subset](docs/04-SWIFT-SUBSET.md) | Exactly which Swift features are in/out, by tier |
| [05 — SwiftUI coverage matrix](docs/05-SWIFTUI-COVERAGE.md) | Views, modifiers, styles — the living checklist |
| [06 — Vertical slice (v0.1)](docs/06-VERTICAL-SLICE.md) | **The decided first build** — reference app, subset, per-phase task lists and findings |

## Decided scope for v0.1

| | |
| --- | --- |
| **Build strategy** | Vertical slice — a narrow subset carried end to end, ~5–7 weeks |
| **Export format** | `.xcodeproj` only |
| **Storage** | Local-only: IndexedDB + share-by-URL. No accounts, no database, works offline |
| **AI features** | Deferred to Phase 7 |

## Status

**Phases 0-5 complete.** The studio parses, checks, runs and renders real Swift across
multiple files, and exports a complete Xcode project.

One gate is outstanding and cannot be closed here: **"opens in Xcode and builds with
zero edits" needs a Mac.** Everything checkable without one is checked — the pbxproj
parses, its object graph resolves, and the bundle is structurally complete. See
[docs/06-VERTICAL-SLICE.md](docs/06-VERTICAL-SLICE.md) section 4.12.

Not built: code completion (the Phase 4 gate shortfall), `.swiftpm` export, share
links, and the breadth of SwiftUI beyond the slice (Phase 6).

| Check | Result |
| --- | --- |
| Packages typechecking | 11 / 11 |
| Lint | clean |
| Unit tests | 468 passing |
| End-to-end | 26 / 26 passing |
| Templates rendering with zero placeholders | 5 / 5 |
| Full pipeline, 500-line file | 1.6 ms (budget: 120 ms) |
| Tap to repaint | 0.2 ms (budget: 32 ms) |
| Client JS | 355 KB gzipped / 450 KB budget |

Next: [Phase 6 - Coverage and fidelity](docs/03-ROADMAP.md).

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

`vercel.json` is configured for the monorepo. From the repo root:

```bash
npx vercel --prod
```

## Repository layout

```
apps/web/              Next.js app — editor, device frame, console, worker host
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
